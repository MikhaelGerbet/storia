// L'API du studio, les fichiers des histoires et l'application, sur un seul port (node:http, sans framework).
import { createReadStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { DUREES, KINDS, checkComposition, drawComposition, findIngredient, findTheme, publicCatalogue } from '../../generator/src/catalogue.ts';
import type { Composition, Duree } from '../../generator/src/catalogue.ts';
import { AGE_BANDS, AGE_PROFILES } from '../../generator/src/scene.ts';
import type { AgeBand } from '../../generator/src/scene.ts';
import type { Library, StoryRecord } from './bibliotheque.ts';
import type { Config } from './config.ts';
import { HttpError } from './file.ts';
import type { Studio } from './file.ts';
import type { Abilities, Health } from './services.ts';

export interface ApiOptions {
  config: Config;
  library: Library;
  studio: Studio;
  abilities: Abilities;
  health: () => Promise<Health>;
  log?: (line: string) => void;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export const AGES = AGE_BANDS.map((id) => ({ id, label: AGE_PROFILES[id].label }));

/** Une histoire telle que l'application la montre, avec les adresses de ses fichiers. */
export function storyCard(r: StoryRecord, withText = false) {
  const base = `/bibliotheque/${encodeURIComponent(r.dossier)}/`;
  const { texte, dossier: _, ...rest } = r;
  return {
    ...rest,
    couverture: r.image ? base + encodeURIComponent(r.image) : null,
    boucle: r.animation ? base + encodeURIComponent(r.animation) : null,
    lecteur: base + encodeURIComponent(r.page),
    ...(withText ? { texte } : {}),
  };
}

/** Ce qui est imposé avant de tirer le reste au sort : chaque choix est vérifié, rien n'est obligatoire. */
function lockedChoices(raw: unknown): Partial<Composition> & Pick<Composition, 'age' | 'duree'> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const age = String(r.age ?? '6-8');
  if (!(AGE_BANDS as readonly string[]).includes(age)) throw new HttpError(400, `Tranche d'âge inconnue : ${age}.`);
  const duree = String(r.duree ?? 'courte');
  if (!(DUREES as readonly string[]).includes(duree)) throw new HttpError(400, `Durée inconnue : ${duree}.`);
  const base: Partial<Composition> & Pick<Composition, 'age' | 'duree'> = { age: age as AgeBand, duree: duree as Duree };
  if (r.theme) base.theme = findTheme(String(r.theme)).id;
  for (const kind of KINDS) {
    const id = r[kind];
    if (id === undefined || id === null || id === '') continue;
    if (!findIngredient(kind, String(id))) throw new HttpError(400, `${kind} inconnu : ${String(id)}.`);
    base[kind] = String(id);
  }
  if (typeof r.idee === 'string' && r.idee.trim()) base.idee = r.idee.replace(/\s+/g, ' ').trim().slice(0, 300);
  return base;
}

async function readJson(req: http.IncomingMessage, limit = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'Requête trop grosse.');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'JSON illisible.');
  }
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  res.end(body);
}

/** Envoie un fichier, par morceaux si le navigateur le demande (vidéos), avec revalidation par date. */
async function sendFile(req: http.IncomingMessage, res: http.ServerResponse, file: string, cache: string): Promise<boolean> {
  let info;
  try {
    info = await stat(file);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const modified = info.mtime.toUTCString();
  const headers: http.OutgoingHttpHeaders = { 'content-type': type, 'last-modified': modified, 'cache-control': cache, 'accept-ranges': 'bytes' };
  const since = req.headers['if-modified-since'];
  if (since && !req.headers.range && Math.floor(info.mtimeMs / 1000) <= Math.floor(Date.parse(since) / 1000)) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    const size = info.size;
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      res.writeHead(416, { 'content-range': `bytes */${size}` });
      res.end();
      return true;
    }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file, { start, end }).pipe(res);
    return true;
  }
  res.writeHead(200, { ...headers, 'content-length': info.size });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
  return true;
}

const NO_APP = `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Storia</title><body style="font-family:system-ui,sans-serif;background:#060a14;color:#e9ecf5;display:grid;place-items:center;min-height:100vh;margin:0">
<main style="max-width:34rem;padding:2rem;line-height:1.5"><h1 style="color:#f2a65a">Le studio tourne&nbsp;!</h1>
<p>Il manque seulement l'application. Compile-la une fois&nbsp;:</p>
<pre style="background:#111a2e;padding:1rem;border-radius:12px">cd app
flutter build web</pre><p>puis recharge cette page. L'API répond déjà sur <a style="color:#f2a65a" href="/api/sante">/api/sante</a>.</p></main></body></html>`;

/** Accepte l'application en développement (flutter run, autre port de la même machine). */
function allowedOrigin(origin: string | undefined): string | null {
  return origin && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin) ? origin : null;
}

type Handler = (ctx: { req: http.IncomingMessage; res: http.ServerResponse; params: string[]; query: URLSearchParams }) => Promise<unknown>;

export function createApi(o: ApiOptions): http.Server {
  const { library, studio, config } = o;
  const libraryDir = config.bibliotheque;
  const queueDown = 'La file de création ne répond pas : Redis est-il lancé ? (voir docs/demarrer-sous-windows.md)';

  /** Les appels à Redis échouent vite quand il est absent : on le dit clairement, sans attendre. */
  const queue = async <T>(fn: () => Promise<T>): Promise<T> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([fn(), new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new HttpError(503, queueDown)), 3000)))]);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(503, queueDown);
    } finally {
      clearTimeout(timer);
    }
  };

  const story = (id: string) => {
    const record = library.get(id);
    if (!record) throw new HttpError(404, 'Histoire introuvable.');
    return record;
  };

  /** Efface le dossier d'une histoire, jamais en dehors de la bibliothèque. */
  const removeFolder = async (dossier: string) => {
    if (!/^[\w.-]+$/.test(dossier) || dossier.startsWith('.')) return;
    await rm(path.join(libraryDir, dossier), { recursive: true, force: true });
  };

  const routes: [string, RegExp, Handler][] = [
    ['GET', /^\/api\/sante$/, () => o.health()],
    ['GET', /^\/api\/catalogue$/, async () => ({ ...publicCatalogue(AGES), capacites: o.abilities })],
    [
      'POST',
      /^\/api\/composition\/hasard$/,
      async ({ req }) => {
        try {
          return drawComposition(lockedChoices(await readJson(req)));
        } catch (err) {
          throw err instanceof HttpError ? err : new HttpError(400, (err as Error).message);
        }
      },
    ],
    [
      'GET',
      /^\/api\/histoires$/,
      async ({ query }) => {
        const number = (name: string) => (query.get(name) ? Number(query.get(name)) || 0 : undefined);
        const found = library.search({
          q: query.get('q') ?? undefined,
          theme: query.get('theme') ?? undefined,
          age: query.get('age') ?? undefined,
          favoris: query.get('favoris') === '1' || query.get('favoris') === 'true',
          tri: query.get('tri') ?? undefined,
          limite: number('limite'),
          decalage: number('decalage'),
        });
        return { histoires: found.histoires.map((r) => storyCard(r)), total: found.total, motsCles: library.topKeywords(16), stats: library.stats() };
      },
    ],
    ['GET', /^\/api\/histoires\/([\w-]+)$/, async ({ params }) => storyCard(story(params[0]), true)],
    ['POST', /^\/api\/histoires\/([\w-]+)\/lecture$/, async ({ params }) => storyCard(library.countRead(story(params[0]).id) as StoryRecord)],
    [
      'POST',
      /^\/api\/histoires\/([\w-]+)\/favori$/,
      async ({ req, params }) => {
        const body = (await readJson(req)) as { favori?: unknown };
        return storyCard(library.setFavorite(story(params[0]).id, body.favori !== false) as StoryRecord);
      },
    ],
    [
      'DELETE',
      /^\/api\/histoires\/([\w-]+)$/,
      async ({ params }) => {
        const record = story(params[0]);
        library.remove(record.id);
        await removeFolder(record.dossier);
        return { supprimee: record.id };
      },
    ],
    [
      'POST',
      /^\/api\/creations$/,
      async ({ req, res }) => {
        const body = (await readJson(req)) as { composition?: unknown; animation?: unknown };
        let composition: Composition;
        try {
          composition = checkComposition(body.composition, AGE_BANDS);
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
        const animation = o.abilities.animation && body.animation !== false;
        res.statusCode = 201;
        return queue(() => studio.create({ composition, animation }));
      },
    ],
    ['GET', /^\/api\/creations$/, async () => ({ creations: await queue(() => studio.list()) })],
    [
      'GET',
      /^\/api\/creations\/([\w-]+)$/,
      async ({ params }) => {
        const view = await queue(() => studio.view(params[0]));
        if (!view) throw new HttpError(404, 'Demande introuvable.');
        return view;
      },
    ],
    [
      'GET',
      /^\/api\/creations\/([\w-]+)\/journal$/,
      async ({ params }) => {
        const lines = await queue(() => studio.journal(params[0]));
        if (!lines) throw new HttpError(404, 'Demande introuvable.');
        return { lignes: lines };
      },
    ],
    [
      'DELETE',
      /^\/api\/creations\/([\w-]+)$/,
      async ({ params }) => {
        const done = await queue(() => studio.cancel(params[0]));
        if (!done) throw new HttpError(404, 'Demande introuvable.');
        // Une demande retirée avant d'être rangée ne laisse rien derrière elle.
        if (done.action === 'retiree' && !library.get(done.histoireId)) await removeFolder(done.histoireId);
        return done;
      },
    ],
    [
      'POST',
      /^\/api\/creations\/([\w-]+)\/relancer$/,
      async ({ params, res }) => {
        const again = await queue(() => studio.retry(params[0]));
        if (!again) throw new HttpError(404, 'Demande introuvable.');
        if (!library.get(again.ancienneHistoireId)) await removeFolder(again.ancienneHistoireId);
        res.statusCode = 201;
        return again.creation;
      },
    ],
  ];

  const handleApi = async (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => {
    const origin = allowedOrigin(req.headers.origin);
    if (origin) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
    }
    if (req.method === 'OPTIONS') {
      if (origin) {
        res.setHeader('access-control-allow-methods', 'GET, POST, DELETE');
        res.setHeader('access-control-allow-headers', 'content-type');
        res.setHeader('access-control-max-age', '600');
      }
      res.writeHead(204);
      return res.end();
    }
    // Les requêtes qui modifient quelque chose doivent être en JSON : une autre page web ne peut pas les envoyer à ton insu.
    if (req.method === 'POST' && !/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
      return sendJson(res, 415, { erreur: 'Envoie du JSON (content-type: application/json).' });
    }
    let methodAllowed = false;
    for (const [method, pattern, handler] of routes) {
      const match = pattern.exec(url.pathname);
      if (!match) continue;
      if (method !== req.method) {
        methodAllowed = true;
        continue;
      }
      try {
        const data = await handler({ req, res, params: match.slice(1), query: url.searchParams });
        return sendJson(res, res.statusCode === 201 ? 201 : 200, data);
      } catch (err) {
        if (err instanceof HttpError) return sendJson(res, err.status, { erreur: err.message });
        o.log?.(`Erreur sur ${req.method} ${url.pathname} : ${(err as Error).stack ?? err}`);
        return sendJson(res, 500, { erreur: (err as Error).message ?? 'Erreur inconnue.' });
      }
    }
    return sendJson(res, methodAllowed ? 405 : 404, { erreur: methodAllowed ? 'Méthode non prise en charge.' : 'Adresse inconnue.' });
  };

  const handleLibraryFile = async (req: http.IncomingMessage, res: http.ServerResponse, pathname: string) => {
    // /bibliotheque/<dossier>/<fichier> : seulement l'intérieur des dossiers d'histoires, jamais la base elle-même.
    let parts: string[];
    try {
      parts = pathname.split('/').slice(2).map(decodeURIComponent);
    } catch {
      parts = [];
    }
    const safe = parts.length >= 2 && parts.every((p) => p && p !== '.' && p !== '..' && !/[\\/\0]/.test(p)) && /^[\w-]+$/.test(parts[0]);
    const file = path.join(libraryDir, ...parts);
    if (safe && file.startsWith(libraryDir + path.sep) && (await sendFile(req, res, file, 'no-cache'))) return;
    sendJson(res, 404, { erreur: 'Fichier introuvable.' });
  };

  const handleApp = async (req: http.IncomingMessage, res: http.ServerResponse, pathname: string) => {
    let relative: string;
    try {
      relative = decodeURIComponent(pathname).replace(/^\/+/, '');
    } catch {
      relative = '';
    }
    const file = path.join(config.app, relative);
    if (relative && file.startsWith(config.app + path.sep) && (await sendFile(req, res, file, 'no-cache'))) return;
    // Une adresse de l'application (/histoire/…) : c'est index.html qui s'en occupe.
    if (!path.extname(relative) && (await sendFile(req, res, path.join(config.app, 'index.html'), 'no-cache'))) return;
    if (!path.extname(relative)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(NO_APP);
    }
    sendJson(res, 404, { erreur: 'Fichier introuvable.' });
  };

  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const task = url.pathname.startsWith('/api/')
      ? handleApi(req, res, url)
      : req.method !== 'GET' && req.method !== 'HEAD'
        ? Promise.resolve(sendJson(res, 405, { erreur: 'Méthode non prise en charge.' }))
        : url.pathname.startsWith('/bibliotheque/')
          ? handleLibraryFile(req, res, url.pathname)
          : handleApp(req, res, url.pathname);
    task.catch((err: Error) => {
      o.log?.(`Erreur sur ${req.method} ${url.pathname} : ${err.stack ?? err}`);
      if (!res.headersSent) sendJson(res, 500, { erreur: err.message });
      else res.destroy();
    });
  });
}
