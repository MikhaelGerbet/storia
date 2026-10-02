import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { Composition } from '../../generator/src/catalogue.ts';
import { startMockServices } from '../../generator/test/mock-services.ts';
import { Library } from '../src/bibliotheque.ts';
import { Studio, redisOptions } from '../src/file.ts';
import type { CreationView } from '../src/file.ts';
import { ProgressTracker, startWorker } from '../src/travailleur.ts';
import { HAS_REDIS, fakePipeline, startRedis, tempDir, testConfig, until } from './aides.ts';

const composition: Composition = { theme: 'espace', heros: 'robot', age: '6-8', duree: 'courte' };

async function setup(t: { after: (fn: () => unknown) => void }, o: { models?: string[] } = {}) {
  const redis = await startRedis();
  const dir = await tempDir(t);
  const mock = await startMockServices({ draft: {}, models: o.models });
  t.after(() => mock.close());
  const config = testConfig({ redis: redis.url, bibliotheque: dir, ollama: mock.url, tts: mock.url });
  const library = new Library(':memory:');
  const connection = redisOptions(redis.url);
  const studio = new Studio(connection);
  const fake = fakePipeline();
  const worker = startWorker({ connection, config, library, wan: null, log: () => {}, pipeline: fake.pipeline, retryMs: 50 });
  studio.worker = worker;
  t.after(async () => {
    await worker.close(true);
    await studio.close();
    redis.stop();
  });
  const view = (id: string) => studio.view(id) as Promise<CreationView>;
  return { studio, library, fake, config, view };
}

test('l’adresse de Redis donne les réglages de connexion', () => {
  assert.deepEqual(redisOptions('redis://127.0.0.1:6380/2'), { host: '127.0.0.1', port: 6380, username: undefined, password: undefined, db: 2, tls: undefined });
  const secure = redisOptions('rediss://moi:mot%20de%20passe@exemple.fr');
  assert.equal(secure.password, 'mot de passe');
  assert.equal(secure.port, 6379);
  assert.deepEqual(secure.tls, {});
  assert.throws(() => redisOptions('http://localhost:6379'), /redis:\/\/hote:port/);
});

test('l’avancement global pèse chaque étape et garde le titre', () => {
  const sent: { global: number; titre?: string; etape: string }[] = [];
  const tracker = new ProgressTracker(['texte', 'voix', 'assemblage'], (p) => sent.push(p));
  tracker.update({ etape: 'texte', avancement: 1, detail: 'Le Robot des étoiles' });
  tracker.update({ etape: 'voix', avancement: 0.5, detail: 'phrase 2 sur 4' });
  tracker.stop();
  assert.equal(sent.at(-1)?.titre, 'Le Robot des étoiles');
  assert.equal(sent.at(-1)?.global, Math.round(((8 + 15) / 43) * 1000) / 1000);
});

test('la file garde l’ordre, montre l’avancement, et range chaque histoire', { skip: !HAS_REDIS }, async (t) => {
  const { studio, library, fake, config, view } = await setup(t);
  const a = await studio.create({ composition, animation: false });
  const b = await studio.create({ composition: { ...composition, heros: 'chaton' }, animation: false });
  const c = await studio.create({ composition: { ...composition, heros: 'licorne' }, animation: false });
  assert.equal(a.id, a.histoireId);

  const running = await until(() => view(a.id), (v) => v.etat === 'en_cours' && v.titre === 'Histoire 1' && v.progression?.etape === 'voix', 'A en cours');
  assert.deepEqual(running.progression?.etapes.map((s) => s.id), ['texte', 'voix', 'assemblage']); // sans image : pas d'étape image
  assert.equal(running.progression?.detail, 'phrase 2 sur 4');
  assert.ok((running.progression?.global ?? 0) > 0.3);
  assert.deepEqual((await studio.list()).map((v) => [v.id, v.etat, v.position]), [
    [a.id, 'en_cours', null],
    [b.id, 'attente', 1],
    [c.id, 'attente', 2],
  ]);
  assert.equal((await view(c.id)).position, 2);

  // Une demande en attente est simplement retirée.
  assert.deepEqual(await studio.cancel(c.id), { action: 'retiree', histoireId: c.histoireId });
  assert.equal(await studio.view(c.id), null);

  fake.runs[0].finish();
  const done = await until(() => view(a.id), (v) => v.etat === 'terminee', 'A terminée');
  assert.equal(done.titre, 'Histoire 1');
  assert.ok(done.termineeLe);
  const stored = library.get(a.histoireId);
  assert.equal(stored?.titre, 'Histoire 1');
  assert.equal(stored?.dossier, a.histoireId);
  assert.deepEqual(stored?.composition, composition);
  assert.equal(fake.runs[0].options.folder, path.join(config.bibliotheque, a.histoireId));
  assert.ok((await studio.journal(a.id))?.some((line) => /Prête : « Histoire 1 »/.test(line)));

  // La suivante démarre ; arrêtée en route, elle ne laisse aucun fichier.
  await until(() => view(b.id), (v) => v.etat === 'en_cours' && fake.runs.length === 2, 'B en cours');
  assert.equal(fake.runs[1].options.composition?.heros, 'chaton');
  assert.deepEqual(await studio.cancel(b.id), { action: 'arretee', histoireId: b.histoireId });
  await until(() => view(b.id), (v) => v.etat === 'annulee', 'B annulée');
  assert.equal(existsSync(path.join(config.bibliotheque, b.histoireId)), false);
  assert.equal(library.get(b.histoireId), undefined);

  // Relancée : une nouvelle demande, la même composition.
  const again = await studio.retry(b.id);
  assert.ok(again);
  assert.equal(again.ancienneHistoireId, b.histoireId);
  assert.equal(again.creation.composition.heros, 'chaton');
  assert.equal(await studio.view(b.id), null);
  await until(() => view(again.creation.id), (v) => v.etat === 'en_cours' && fake.runs.length === 3, 'relance en cours');
  fake.runs[2].finish();
  await until(() => view(again.creation.id), (v) => v.etat === 'terminee', 'relance terminée');
  await assert.rejects(studio.retry(again.creation.id), /Seule une histoire qui a échoué/);
  assert.equal(library.stats().histoires, 2);
});

test('un modèle absent fait échouer la demande avec la commande pour l’installer', { skip: !HAS_REDIS }, async (t) => {
  const { studio, fake, view } = await setup(t, { models: ['gemma4:12b'] });
  const a = await studio.create({ composition, animation: false });
  const failed = await until(() => view(a.id), (v) => v.etat === 'echec', 'A en échec');
  assert.match(failed.erreur ?? '', /ollama pull mistral-small3\.2/);
  assert.equal(fake.runs.length, 0);
});

test('la file refuse une demande de trop', { skip: !HAS_REDIS }, async (t) => {
  const redis = await startRedis();
  const studio = new Studio(redisOptions(redis.url)); // sans travailleur : tout reste en attente
  t.after(async () => {
    await studio.close();
    redis.stop();
  });
  for (let i = 0; i < 12; i++) await studio.create({ composition, animation: false });
  await assert.rejects(studio.create({ composition, animation: false }), (err: Error & { status?: number }) => err.status === 429);
  const list = await studio.list();
  assert.deepEqual(list.map((v) => v.position), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test('sans Redis, la file le dit au lieu d’attendre', async (t) => {
  const studio = new Studio(redisOptions('redis://127.0.0.1:9'));
  studio.queue.on('error', () => {});
  t.after(() => studio.close());
  const begun = Date.now();
  assert.equal(await studio.ping(500), false);
  assert.ok(Date.now() - begun < 2000);
});

test('le studio se ferme sans attendre quand Redis s’est arrêté avant lui', { skip: !HAS_REDIS }, async () => {
  const redis = await startRedis();
  const studio = new Studio(redisOptions(redis.url));
  studio.queue.on('error', () => {});
  assert.equal(await studio.ping(), true);
  redis.stop();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const begun = Date.now();
  await studio.close();
  assert.ok(Date.now() - begun < 3000);
});
