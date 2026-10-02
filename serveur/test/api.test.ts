import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import { SAMPLE_STORY, startMockServices } from '../../generator/test/mock-services.ts';
import { createApi } from '../src/api.ts';
import { Library } from '../src/bibliotheque.ts';
import type { Config } from '../src/config.ts';
import { Studio, redisOptions } from '../src/file.ts';
import { abilities } from '../src/services.ts';
import type { Health } from '../src/services.ts';
import { startWorker } from '../src/travailleur.ts';
import { HAS_REDIS, startRedis, tempDir, testConfig, until } from './aides.ts';

type After = { after: (fn: () => unknown) => void };

const HEALTHY: Health = {
  file: { ok: true, detail: 'Redis' },
  texte: { ok: true, detail: 'Ollama' },
  voix: { ok: true, detail: 'Voix' },
  image: { ok: true, detail: 'aucune', moteur: null, animation: false },
  travailleur: true,
};

async function serve(t: After, config: Config, library: Library, studio: Studio): Promise<string> {
  const server: http.Server = createApi({ config, library, studio, abilities: abilities(config, null), health: async () => HEALTHY });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function call(base: string, method: string, url: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(base + url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

test('de la demande à la bibliothèque, avec la vraie chaîne de fabrication', { skip: !HAS_REDIS }, async (t) => {
  const redis = await startRedis(t);
  const dir = await tempDir(t);
  const mock = await startMockServices({ draft: SAMPLE_STORY, narration: {} });
  t.after(() => mock.close());
  const config = testConfig({ redis, bibliotheque: path.join(dir, 'bibliotheque'), ollama: mock.url, tts: mock.url });
  const library = new Library(':memory:');
  const connection = redisOptions(redis);
  const studio = new Studio(connection);
  studio.worker = startWorker({ connection, config, library, wan: null, log: () => {} });
  t.after(async () => {
    await studio.worker?.close(true);
    await studio.close();
  });
  const base = await serve(t, config, library, studio);

  const catalogue = await call(base, 'GET', '/api/catalogue');
  assert.equal(catalogue.data.themes.length, 8);
  assert.deepEqual(catalogue.data.capacites, { voix: true, image: null, animation: false });

  // Le dé : ce qui est choisi reste, le reste est tiré au sort.
  const drawn = await call(base, 'POST', '/api/composition/hasard', { theme: 'pirates', heros: 'renarde', age: '3-5', duree: 'moyenne' });
  assert.equal(drawn.status, 200);
  assert.equal(drawn.data.theme, 'pirates');
  assert.equal(drawn.data.heros, 'renarde');
  assert.equal(drawn.data.age, '3-5');
  for (const kind of ['lieu', 'compagnon', 'objet', 'rebondissement']) assert.ok(drawn.data[kind], kind);
  assert.equal((await call(base, 'POST', '/api/composition/hasard', { heros: 'godzilla' })).status, 400);

  const created = await call(base, 'POST', '/api/creations', { composition: { theme: 'pirates', heros: 'renarde', lieu: 'ile', compagnon: 'perroquet', objet: 'boussole', age: '6-8' }, animation: true });
  assert.equal(created.status, 201);
  assert.equal(created.data.animation, false); // pas de Wan : pas d'animation
  const id = created.data.id as string;
  const done = await until(async () => (await call(base, 'GET', `/api/creations/${id}`)).data, (v) => v.etat === 'terminee' || v.etat === 'echec', 'histoire prête');
  assert.equal(done.erreur, null);
  assert.equal(done.titre, 'La Boussole qui chantait');
  assert.equal(done.progression.global, 1);

  const list = await call(base, 'GET', '/api/histoires');
  assert.equal(list.data.total, 1);
  const card = list.data.histoires[0];
  assert.equal(card.id, id);
  assert.equal(card.texte, undefined); // la liste reste légère
  assert.equal(card.couverture, null);
  assert.equal(card.lecteur, `/bibliotheque/${id}/index.html`);
  assert.ok(card.motsCles.includes('pirates'));
  assert.ok(list.data.motsCles.some((k: { motCle: string }) => k.motCle === 'boussole'));

  const page = await fetch(base + card.lecteur);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await page.text(), /<title>La Boussole qui chantait<\/title>/);

  assert.equal((await call(base, 'GET', '/api/histoires?q=tempete')).data.total, 1);
  assert.equal((await call(base, 'GET', '/api/histoires?q=licorne')).data.total, 0);
  assert.match((await call(base, 'GET', `/api/histoires/${id}`)).data.texte, /boussole qui chantait/);
  assert.equal((await call(base, 'POST', `/api/histoires/${id}/lecture`, {})).data.lectures, 1);
  assert.equal((await call(base, 'POST', `/api/histoires/${id}/favori`, { favori: true })).data.favori, true);
  assert.equal((await call(base, 'GET', '/api/histoires?favoris=1')).data.total, 1);
  assert.ok((await call(base, 'GET', `/api/creations/${id}/journal`)).data.lignes.length > 3);

  assert.equal((await call(base, 'DELETE', `/api/histoires/${id}`)).status, 200);
  assert.equal((await fetch(base + card.lecteur)).status, 404);
  assert.equal((await call(base, 'GET', `/api/histoires/${id}`)).status, 404);
});

test('les fichiers : morceaux de vidéo, application et adresses refusées', async (t) => {
  const dir = await tempDir(t);
  const config = testConfig({ redis: 'redis://127.0.0.1:9', bibliotheque: path.join(dir, 'bibliotheque'), app: path.join(dir, 'app') });
  await mkdir(path.join(config.bibliotheque, 'h-1'), { recursive: true });
  await writeFile(path.join(config.bibliotheque, 'h-1', 'animation.mp4'), Buffer.from('0123456789'));
  await writeFile(path.join(config.bibliotheque, 'bibliotheque.sqlite'), 'secret');
  const library = new Library(':memory:');
  const studio = new Studio(redisOptions(config.redis));
  studio.queue.on('error', () => {});
  t.after(() => studio.close());
  const base = await serve(t, config, library, studio);

  const part = await fetch(`${base}/bibliotheque/h-1/animation.mp4`, { headers: { range: 'bytes=2-5' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await part.text(), '2345');
  assert.equal((await fetch(`${base}/bibliotheque/h-1/animation.mp4`, { headers: { range: 'bytes=20-' } })).status, 416);
  const whole = await fetch(`${base}/bibliotheque/h-1/animation.mp4`);
  assert.equal(whole.headers.get('content-type'), 'video/mp4');
  const again = await fetch(`${base}/bibliotheque/h-1/animation.mp4`, { headers: { 'if-modified-since': whole.headers.get('last-modified') ?? '' } });
  assert.equal(again.status, 304);
  for (const url of ['/bibliotheque/bibliotheque.sqlite', '/bibliotheque/h-1%2F..%2F..%2Fbibliotheque.sqlite/x', '/bibliotheque/h-1/..%2Fbibliotheque.sqlite']) {
    assert.equal((await fetch(base + url)).status, 404, url);
  }

  // Sans application compilée : une page qui explique quoi faire.
  assert.match(await (await fetch(`${base}/histoire/h-1`)).text(), /flutter build web/);
  await mkdir(config.app, { recursive: true });
  await writeFile(path.join(config.app, 'index.html'), '<html>app</html>');
  await writeFile(path.join(config.app, 'main.dart.js'), 'main()');
  assert.equal(await (await fetch(`${base}/`)).text(), '<html>app</html>');
  assert.equal(await (await fetch(`${base}/histoire/h-1`)).text(), '<html>app</html>'); // adresse de l'application
  assert.match((await fetch(`${base}/main.dart.js`)).headers.get('content-type') ?? '', /javascript/);
  assert.equal((await fetch(`${base}/absent.js`)).status, 404);
});

test('l’API se protège : JSON obligatoire, origines locales seulement, Redis absent signalé', async (t) => {
  const dir = await tempDir(t);
  const config = testConfig({ redis: 'redis://127.0.0.1:9', bibliotheque: dir });
  const studio = new Studio(redisOptions(config.redis));
  studio.queue.on('error', () => {});
  t.after(() => studio.close());
  const base = await serve(t, config, new Library(':memory:'), studio);

  // Un formulaire d'une autre page ne peut pas déclencher de création.
  const form = await fetch(`${base}/api/creations`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
  assert.equal(form.status, 415);
  const preflight = await fetch(`${base}/api/creations`, { method: 'OPTIONS', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' } });
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  const stranger = await fetch(`${base}/api/creations`, { method: 'OPTIONS', headers: { origin: 'https://exemple.fr', 'access-control-request-method': 'POST' } });
  assert.equal(stranger.headers.get('access-control-allow-origin'), null);

  const queued = await call(base, 'POST', '/api/creations', { composition: { theme: 'espace', age: '6-8' } });
  assert.equal(queued.status, 503);
  assert.match(queued.data.erreur, /Redis/);
  assert.equal((await call(base, 'POST', '/api/creations', { composition: { theme: 'licornes' } })).status, 400);
  assert.equal((await call(base, 'GET', '/api/histoires')).status, 200); // la bibliothèque marche sans Redis
  assert.equal((await call(base, 'GET', '/api/inconnue')).status, 404);
  assert.equal((await call(base, 'DELETE', '/api/catalogue')).status, 405);
  assert.deepEqual((await call(base, 'GET', '/api/sante')).data, HEALTHY);
});
