// Pour les programmes en TypeScript ou JavaScript (Storia, et Oula s'il l'est) : réserver la carte graphique
// auprès du gardien, être prévenu tout de suite si un jeu la réclame, la rendre à la fin.
//
//   const carte = await reserveGpu({ url: 'http://127.0.0.1:7870', client: 'oula', priorite: 'basse' });
//   try {
//     await fabriquer({ signal: carte.revoked }); // s'arrête si un jeu démarre
//   } finally {
//     await carte.release();
//   }

export type Priority = 'haute' | 'normale' | 'basse';

export interface ReservationView {
  id: string;
  etat: 'attente' | 'accordee' | 'revoquee' | 'terminee';
  position: number | null;
  /** Pourquoi on attend : « est utilisée par oula, 1 demande avant toi », « est réservée au jeu (…) ». */
  attente: string | null;
}

export interface GpuLease {
  id: string;
  /** Déclenché quand le gardien reprend la carte (mode jeu) ou l'a perdue (redémarrage) : arrête-toi au plus vite. */
  revoked: AbortSignal;
  /** Vérifie tout de suite si la carte est toujours à nous (après une erreur, par exemple). */
  check(): Promise<boolean>;
  release(): Promise<void>;
}

export interface ReserveOptions {
  url: string;
  client: string;
  motif?: string;
  priorite?: Priority;
  /** Une tâche interrompue par un jeu : elle repasse devant. */
  reprise?: boolean;
  signal?: AbortSignal;
  /** Appelé tant qu'on attend, avec la raison (null quand c'est notre tour). */
  onWait?: (reason: string | null) => void;
  fetch?: typeof fetch;
}

class Gone extends Error {}

const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

export async function reserveGpu(o: ReserveOptions): Promise<GpuLease> {
  const http = o.fetch ?? fetch;
  const base = o.url.replace(/\/+$/, '');
  const call = async (method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<ReservationView> => {
    const res = await http(base + path, {
      method,
      signal,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 404) throw new Gone();
    if (!res.ok) throw new Error(`Le gardien a répondu ${res.status} : ${await res.text()}`);
    return (await res.json()) as ReservationView;
  };
  const request = () => call('POST', '/api/reservations', { client: o.client, motif: o.motif, priorite: o.priorite ?? 'normale', reprise: o.reprise ?? false }, o.signal);

  // 1. Demander la carte, puis attendre son tour (le gardien répond dès que quelque chose change).
  let view: ReservationView | undefined;
  for (;;) {
    o.signal?.throwIfAborted();
    try {
      view ??= await request();
      if (view.etat === 'accordee') break;
      o.onWait?.(view.attente);
      view = await call('GET', `/api/reservations/${view.id}?attendre=20&depuis=attente`, undefined, o.signal);
      if (view.etat === 'accordee') break;
      if (view.etat === 'revoquee' || view.etat === 'terminee') view = undefined;
    } catch (err) {
      if (o.signal?.aborted) {
        if (view) await call('DELETE', `/api/reservations/${view.id}`).catch(() => {});
        throw o.signal.reason;
      }
      if (err instanceof Gone) {
        view = undefined; // le gardien a redémarré : on redemande
        continue;
      }
      o.onWait?.('ne peut pas être réservée : le gardien ne répond pas');
      await pause(5000, o.signal);
    }
  }
  o.onWait?.(null);

  // 2. Tant qu'on la tient : une attente longue qui revient dès que le gardien la reprend.
  const id = view.id;
  const revoked = new AbortController();
  const stopWatching = new AbortController();
  void (async () => {
    while (!stopWatching.signal.aborted && !revoked.signal.aborted) {
      try {
        const now = await call('GET', `/api/reservations/${id}?attendre=25&depuis=accordee`, undefined, stopWatching.signal);
        if (now.etat !== 'accordee') revoked.abort('jeu');
      } catch (err) {
        if (stopWatching.signal.aborted) return;
        if (err instanceof Gone) revoked.abort('perdue');
        else await pause(2000, stopWatching.signal).catch(() => {});
      }
    }
  })();

  return {
    id,
    revoked: revoked.signal,
    async check() {
      if (revoked.signal.aborted) return false;
      try {
        const now = await call('GET', `/api/reservations/${id}`);
        if (now.etat !== 'accordee') revoked.abort('jeu');
      } catch (err) {
        if (err instanceof Gone) revoked.abort('perdue');
      }
      return !revoked.signal.aborted;
    },
    async release() {
      stopWatching.abort();
      await call('DELETE', `/api/reservations/${id}`).catch(() => {});
    },
  };
}

/** Demande au gardien de lancer un de ses services (le serveur de voix…) et attend qu'il soit prêt. null : service inconnu ou gardien absent. */
export async function ensureService(url: string, nom: string, signal?: AbortSignal): Promise<{ ok: boolean; detail: string } | null> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/api/services/${encodeURIComponent(nom)}/demarrer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6 * 60_000)]) : AbortSignal.timeout(6 * 60_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as { ok: boolean; detail: string };
  } catch {
    return null;
  }
}

/** L'état de la carte graphique selon le gardien, ou null s'il ne répond pas. */
export async function gardienState(url: string): Promise<{ carte: { etat: string; detenteur: { client: string } | null; pause: { raison: string; detail: string | null } | null } } | null> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/api/etat`, { signal: AbortSignal.timeout(2500) });
    return res.ok ? ((await res.json()) as Awaited<ReturnType<typeof gardienState>>) : null;
  } catch {
    return null;
  }
}
