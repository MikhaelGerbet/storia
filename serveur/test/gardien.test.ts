import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import { createApi as createGardienApi } from '../../gardien/src/api.ts';
import type { GardienConfig } from '../../gardien/src/config.ts';
import { Gardien } from '../../gardien/src/gardien.ts';
import { DEFAULT_GAME_RULES } from '../../gardien/src/jeux.ts';
import type { Composition } from '../../generator/src/catalogue.ts';
import { startMockServices } from '../../generator/test/mock-services.ts';
import { Library } from '../src/bibliotheque.ts';
import { Studio, redisOptions } from '../src/file.ts';
import type { CreationView } from '../src/file.ts';
import { startWorker } from '../src/travailleur.ts';
import { HAS_REDIS, fakePipeline, startRedis, tempDir, testConfig, until } from './aides.ts';

type After = { after: (fn: () => unknown) => void };

const composition: Composition = { theme: 'pirates', heros: 'renarde', age: '6-8', duree: 'courte' };

async function freePort(): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function setup(t: After, o: { services?: GardienConfig['services']; tts?: string } = {}) {
  const dir = await tempDir(t);
  // Le gardien, avec sa vraie API.
  const gardien = new Gardien(
    {
      port: 0,
      hote: '127.0.0.1',
      ollama: null,
      inactiviteMs: 60_000,
      leaseMs: 90_000,
      jeux: { actif: false, interrompre: true, regles: DEFAULT_GAME_RULES },
      services: o.services ?? {},
      liberer: [],
      wan: {},
      travaux: path.join(dir, 'travaux'),
      journaux: path.join(dir, 'journaux'),
      fichier: null,
    },
    { log: () => {}, revokeGraceMs: 0, tickMs: 50 },
  );
  gardien.start();
  const server = createGardienApi(gardien);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const gardienUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Le studio : Redis, le travailleur et une chaîne factice.
  const redis = await startRedis();
  const mock = await startMockServices({ draft: {} });
  const config = testConfig({ redis: redis.url, bibliotheque: path.join(dir, 'bibliotheque'), ollama: mock.url, tts: o.tts ?? null, gardien: gardienUrl });
  const connection = redisOptions(redis.url);
  const studio = new Studio(connection);
  const fake = fakePipeline();
  const worker = startWorker({ connection, config, library: new Library(':memory:'), wan: null, log: () => {}, pipeline: fake.pipeline, retryMs: 50 });
  studio.worker = worker;
  t.after(async () => {
    await worker.close(true);
    await studio.close();
    redis.stop();
    await mock.close();
    gardien.stop();
    server.closeAllConnections();
    server.close();
  });
  const call = async (method: string, route: string, body?: unknown) =>
    (await (await fetch(gardienUrl + route, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })).json()) as any;
  const view = (id: string) => studio.view(id) as Promise<CreationView>;
  return { studio, fake, call, view, gardien };
}

test('une histoire attend que la carte graphique se libère, en disant qui s’en sert', { skip: !HAS_REDIS }, async (t) => {
  const { studio, fake, call, view } = await setup(t);
  const oula = await call('POST', '/api/reservations', { client: 'oula', motif: 'avatar', priorite: 'basse' });
  assert.equal(oula.etat, 'accordee');
  const story = await studio.create({ composition, animation: false });
  const waiting = await until(() => view(story.id), (v) => /La carte graphique est utilisée par oula/.test(v.progression?.attente ?? ''), 'Storia attend la carte');
  assert.equal(waiting.etat, 'en_cours');
  assert.equal(fake.runs.length, 0);
  await call('DELETE', `/api/reservations/${oula.id}`);
  await until(async () => fake.runs.length, (n) => n === 1, 'Storia a la carte');
  assert.equal((await call('GET', '/api/etat')).carte.detenteur.motif, 'Histoire · Pirates · Renarde');
  fake.runs[0].finish();
  await until(() => view(story.id), (v) => v.etat === 'terminee', 'histoire prête');
  await until(() => call('GET', '/api/etat'), (s) => s.carte.etat === 'libre', 'carte rendue');
});

test('un jeu interrompt l’histoire, qui recommence quand la partie est finie', { skip: !HAS_REDIS }, async (t) => {
  const { studio, fake, call, view } = await setup(t);
  const story = await studio.create({ composition, animation: false });
  await until(async () => fake.runs.length, (n) => n === 1, 'fabrication lancée');
  await call('POST', '/api/pause', {});
  const paused = await until(() => view(story.id), (v) => /La carte graphique est en pause/.test(v.progression?.attente ?? ''), 'histoire en pause');
  assert.equal(paused.etat, 'en_cours'); // ni échouée ni annulée : elle attend
  await call('POST', '/api/reprise', {});
  await until(async () => fake.runs.length, (n) => n === 2, 'fabrication relancée');
  fake.runs[1].finish();
  const done = await until(() => view(story.id), (v) => v.etat === 'terminee', 'histoire prête');
  assert.equal(done.erreur, null);
});

test('après un redémarrage du PC, le gardien lance la voix pour la première histoire', { skip: !HAS_REDIS }, async (t) => {
  const dir = await tempDir(t);
  const port = await freePort();
  const script = path.join(dir, 'fausse-voix.js');
  await writeFile(script, `require('http').createServer((q, r) => r.end('{"status":"ok","moteur":"faux"}')).listen(${port}, '127.0.0.1');`);
  const { studio, fake, view, gardien } = await setup(t, {
    tts: `http://127.0.0.1:${port}`,
    services: { voix: { commande: [process.execPath, script], sante: `http://127.0.0.1:${port}/health`, delaiSecondes: 10 } },
  });
  const story = await studio.create({ composition, animation: false });
  await until(async () => fake.runs.length, (n) => n === 1, 'voix lancée, fabrication commencée');
  fake.runs[0].finish();
  await until(() => view(story.id), (v) => v.etat === 'terminee', 'histoire prête');
  assert.deepEqual((await gardien.state()).services.map((s) => [s.nom, s.ok, s.lance]), [['voix', true, true]]);
});
