// L'API du gardien (node:http, sans dépendance) et sa page d'état.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import type { Gardien } from './gardien.ts';
import { PAGE } from './page.ts';
import { PRIORITIES } from './reservations.ts';
import type { Priority, Reservation } from './reservations.ts';
import { taskView } from './taches.ts';

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 2_000_000) throw new HttpError(413, 'Requête trop grosse.');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    const data = JSON.parse(text) as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'JSON illisible (un objet est attendu).');
  }
}

function send(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function priority(value: unknown, fallback: Priority): Priority {
  if (value === undefined || value === null || value === '') return fallback;
  if ((PRIORITIES as readonly string[]).includes(String(value))) return value as Priority;
  throw new HttpError(400, `Priorité inconnue : ${String(value)} (haute, normale ou basse).`);
}

function clientName(value: unknown): string {
  const name = String(value ?? '').trim();
  if (!/^[\p{L}\p{N} _.-]{1,40}$/u.test(name)) throw new HttpError(400, 'Indique qui demande la carte : « client » (par exemple storia ou oula).');
  return name;
}

export function createApi(g: Gardien): http.Server {
  const scheduler = g.scheduler;
  scheduler.setMaxListeners(0); // une attente longue par programme qui patiente

  const reservationView = (r: Reservation) => ({
    id: r.id,
    client: r.client,
    motif: r.motif,
    priorite: r.priorite,
    etat: r.etat,
    position: scheduler.position(r.id),
    attente: scheduler.reason(r.id),
    accordeeLe: r.accordeeLe ? new Date(r.accordeeLe).toISOString() : null,
  });

  /** Attend que la réservation change (état ou rang), au plus `ms` : le programme est prévenu tout de suite. */
  const waitForChange = (id: string, ms: number, req: http.IncomingMessage) =>
    new Promise<void>((resolve) => {
      const snapshot = () => {
        const r = scheduler.get(id);
        return r ? `${r.etat}|${scheduler.position(id)}|${scheduler.reason(id)}` : 'absente';
      };
      const before = snapshot();
      const done = () => {
        clearTimeout(timer);
        scheduler.off('change', onChange);
        req.off('close', done);
        resolve();
      };
      const onChange = () => {
        if (snapshot() !== before) done();
      };
      const timer = setTimeout(done, ms);
      scheduler.on('change', onChange);
      req.on('close', done);
    });

  const routes: [string, RegExp, (req: http.IncomingMessage, res: http.ServerResponse, params: string[], url: URL) => Promise<unknown>][] = [
    ['GET', /^\/api\/etat$/, async () => g.state()],
    [
      'POST',
      /^\/api\/reservations$/,
      async (req, res) => {
        const body = await readJson(req);
        const r = scheduler.request({
          client: clientName(body.client),
          motif: String(body.motif ?? '').slice(0, 120),
          priorite: priority(body.priorite, 'normale'),
          reprise: body.reprise === true,
        });
        res.statusCode = 201;
        return reservationView(r);
      },
    ],
    [
      'GET',
      /^\/api\/reservations\/([\w-]+)$/,
      async (req, _res, [id], url) => {
        if (!scheduler.touch(id)) throw new HttpError(404, 'Réservation inconnue : demande-la à nouveau.');
        const wait = Math.min(Math.max(Number(url.searchParams.get('attendre') ?? 0) || 0, 0), 30);
        // « depuis » : l'état que le programme connaît. S'il a déjà changé (la carte vient d'être accordée), on répond tout de suite.
        const known = url.searchParams.get('depuis');
        const current = scheduler.get(id)?.etat;
        if (wait > 0 && (!known || known === current)) await waitForChange(id, wait * 1000, req);
        const r = scheduler.touch(id);
        if (!r) throw new HttpError(404, 'Réservation inconnue : demande-la à nouveau.');
        const view = reservationView(r);
        // Le programme sait qu'il a perdu la carte : la réservation n'a plus de raison d'être.
        if (r.etat === 'revoquee') scheduler.release(r.id);
        return view;
      },
    ],
    [
      'DELETE',
      /^\/api\/reservations\/([\w-]+)$/,
      async (_req, _res, [id]) => {
        if (!scheduler.release(id)) throw new HttpError(404, 'Réservation inconnue.');
        return { rendue: true };
      },
    ],
    [
      'POST',
      /^\/api\/pause$/,
      async () => {
        g.pause();
        return g.state();
      },
    ],
    [
      'POST',
      /^\/api\/reprise$/,
      async () => {
        g.resume();
        return g.state();
      },
    ],
    [
      'POST',
      /^\/api\/menage$/,
      async () => {
        if (scheduler.holder()) throw new HttpError(409, `La carte est utilisée par ${scheduler.holder()?.client} : le ménage attendra qu'elle soit rendue.`);
        return { libere: await g.cleanup('demandé') };
      },
    ],
    [
      'POST',
      /^\/api\/wan$/,
      async (req, res) => {
        const body = await readJson(req);
        const reglages = body.reglages;
        if (!reglages || typeof reglages !== 'object' || Array.isArray(reglages) || typeof (reglages as Record<string, unknown>).model_type !== 'string') {
          throw new HttpError(400, 'Envoie les réglages Wan2GP dans « reglages », avec au moins « model_type » (bouton « Export Settings » de Wan2GP).');
        }
        const attendu = body.attendu === 'image' ? 'image' : 'video';
        const dossier = typeof body.dossier === 'string' && body.dossier.trim() ? path.resolve(body.dossier) : undefined;
        const task = g.tasks.submit({
          client: clientName(body.client),
          motif: typeof body.motif === 'string' ? body.motif.slice(0, 120) : undefined,
          priorite: priority(body.priorite, 'basse'),
          reglages: reglages as Record<string, unknown>,
          attendu,
          dossier,
        });
        res.statusCode = 201;
        return taskView(task, scheduler.position(task.reservation));
      },
    ],
    [
      'GET',
      /^\/api\/wan\/([\w-]+)$/,
      async (_req, _res, [id]) => {
        const task = g.tasks.tasks.get(id);
        if (!task) throw new HttpError(404, 'Tâche inconnue.');
        return taskView(task, scheduler.position(task.reservation));
      },
    ],
    [
      'DELETE',
      /^\/api\/wan\/([\w-]+)$/,
      async (_req, _res, [id]) => {
        if (!g.tasks.cancel(id)) throw new HttpError(404, 'Tâche inconnue.');
        return { annulee: true };
      },
    ],
    [
      'POST',
      /^\/api\/services\/([\w-]+)\/demarrer$/,
      async (_req, _res, [nom]) => {
        const state = await g.ensureService(nom);
        if (!state) throw new HttpError(404, `Aucun service « ${nom} » dans les réglages du gardien.`);
        return state;
      },
    ],
  ];

  const sendFile = async (res: http.ServerResponse, file: string) => {
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) throw new HttpError(404, 'Fichier introuvable.');
    const ext = path.extname(file).toLowerCase();
    const type = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[ext] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'content-length': info.size, 'content-disposition': `attachment; filename="${path.basename(file)}"` });
    createReadStream(file).pipe(res);
  };

  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    void (async () => {
      try {
        if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          return res.end(PAGE);
        }
        const file = /^\/api\/wan\/([\w-]+)\/fichier$/.exec(url.pathname);
        if (req.method === 'GET' && file) {
          const task = g.tasks.tasks.get(file[1]);
          if (!task?.fichier) throw new HttpError(404, 'Pas encore de fichier pour cette tâche.');
          return await sendFile(res, task.fichier);
        }
        // Les demandes qui changent quelque chose sont en JSON : une page web ne peut pas les envoyer à ton insu.
        if (req.method === 'POST' && !/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
          throw new HttpError(415, 'Envoie du JSON (content-type: application/json).');
        }
        let known = false;
        for (const [method, pattern, handler] of routes) {
          const match = pattern.exec(url.pathname);
          if (!match) continue;
          known = true;
          if (method !== req.method) continue;
          const data = await handler(req, res, match.slice(1), url);
          return send(res, res.statusCode === 201 ? 201 : 200, data);
        }
        throw new HttpError(known ? 405 : 404, known ? 'Méthode non prise en charge.' : 'Adresse inconnue.');
      } catch (err) {
        if (res.headersSent) return res.destroy();
        if (err instanceof HttpError) return send(res, err.status, { erreur: err.message });
        return send(res, 500, { erreur: (err as Error).message ?? String(err) });
      }
    })();
  });
}
