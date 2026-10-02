import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createApi } from '../src/api.ts';
import { reserveGpu } from '../src/client.ts';
import type { GardienConfig } from '../src/config.ts';
import { Gardien } from '../src/gardien.ts';
import type { GardienOptions } from '../src/gardien.ts';
import { DEFAULT_GAME_RULES } from '../src/jeux.ts';

type After = { after: (fn: () => unknown) => void };

async function listen(t: After, server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Faux Ollama (un modèle chargé) et faux serveur de voix : ils notent ce qu'on leur demande. */
async function fakeResidents(t: After) {
  const calls: string[] = [];
  let loaded = ['mistral-small3.2:latest'];
  const server = http.createServer(async (req, res) => {
    for await (const _ of req) {
      // on lit le corps sans s'en servir
    }
    calls.push(`${req.method} ${req.url}`);
    if (req.url === '/api/ps') return res.end(JSON.stringify({ models: loaded.map((name) => ({ name, model: name })) }));
    if (req.url === '/api/generate') {
      loaded = [];
      return res.end('{}');
    }
    if (req.url === '/liberer') return res.end('{"libere":true}');
    res.writeHead(404).end();
  });
  const url = await listen(t, server);
  return { url, calls, load: () => (loaded = ['mistral-small3.2:latest']) };
}

async function startGardien(t: After, o: { cfg?: Partial<GardienConfig>; options?: Partial<GardienOptions> } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gardien-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const residents = await fakeResidents(t);
  const lines: string[] = [];
  const cfg: GardienConfig = {
    port: 0,
    hote: '127.0.0.1',
    ollama: residents.url,
    inactiviteMs: 60_000,
    leaseMs: 90_000,
    jeux: { actif: false, interrompre: true, regles: DEFAULT_GAME_RULES },
    services: {},
    liberer: [`${residents.url}/liberer`],
    wan: {},
    travaux: path.join(dir, 'travaux'),
    journaux: path.join(dir, 'journaux'),
    fichier: null,
    ...o.cfg,
  };
  const gardien = new Gardien(cfg, { log: (l) => lines.push(l), revokeGraceMs: 0, tickMs: 50, ...o.options });
  gardien.start();
  t.after(() => gardien.stop());
  const url = await listen(t, createApi(gardien));
  const call = async (method: string, route: string, body?: unknown) => {
    const res = await fetch(url + route, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: (await res.json()) as any };
  };
  return { gardien, url, call, residents, lines, dir };
}

const until = async (check: () => boolean | Promise<boolean>, what: string, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`${what} : toujours pas`);
};

test('deux programmes : le second attend, et l’apprend dès que la carte se libère', async (t) => {
  const { call } = await startGardien(t);
  const oula = (await call('POST', '/api/reservations', { client: 'oula', motif: 'avatar 1', priorite: 'basse' })).data;
  assert.equal(oula.etat, 'accordee');
  const storia = (await call('POST', '/api/reservations', { client: 'storia', motif: 'La boussole', priorite: 'haute' })).data;
  assert.equal(storia.etat, 'attente');
  assert.equal(storia.attente, 'est utilisée par oula');
  const waiting = call('GET', `/api/reservations/${storia.id}?attendre=10`);
  const begun = Date.now();
  setTimeout(() => void call('DELETE', `/api/reservations/${oula.id}`), 200);
  const granted = (await waiting).data;
  assert.ok(Date.now() - begun < 3000); // pas besoin d'attendre la fin des 10 secondes
  assert.equal(granted.etat, 'attente'); // le ménage passe d'abord (Oula a pu laisser des modèles)
  const after = (await call('GET', `/api/reservations/${storia.id}?attendre=5`)).data;
  assert.equal(after.etat, 'accordee');
  assert.equal((await call('GET', '/api/etat')).data.carte.detenteur.client, 'storia');
});

test('une attente longue répond tout de suite si la carte a déjà été accordée entre-temps', async (t) => {
  const { call } = await startGardien(t);
  const first = (await call('POST', '/api/reservations', { client: 'storia' })).data;
  const second = (await call('POST', '/api/reservations', { client: 'storia' })).data;
  await call('DELETE', `/api/reservations/${first.id}`); // même programme : accordée sans ménage
  const begun = Date.now();
  const view = (await call('GET', `/api/reservations/${second.id}?attendre=20&depuis=attente`)).data;
  assert.equal(view.etat, 'accordee');
  assert.ok(Date.now() - begun < 1000);
});

test('entre deux programmes, la carte est vidée : modèles d’Ollama et voix', async (t) => {
  const { call, residents, gardien } = await startGardien(t);
  const storia = (await call('POST', '/api/reservations', { client: 'storia' })).data;
  const oula = (await call('POST', '/api/reservations', { client: 'oula' })).data;
  await call('DELETE', `/api/reservations/${storia.id}`);
  await until(async () => (await call('GET', `/api/reservations/${oula.id}`)).data.etat === 'accordee', 'Oula obtient la carte');
  assert.ok(residents.calls.includes('POST /api/generate'), 'Ollama déchargé');
  assert.ok(residents.calls.includes('POST /liberer'), 'voix libérée');
  assert.deepEqual(gardien.lastCleanup?.freed.sort(), ['Ollama (mistral-small3.2:latest)', new URL(residents.url).host].sort());
});

test('quand plus personne ne s’en sert, la carte est vidée après le délai', async (t) => {
  const { call, residents } = await startGardien(t, { cfg: { inactiviteMs: 150 } });
  const storia = (await call('POST', '/api/reservations', { client: 'storia' })).data;
  await call('DELETE', `/api/reservations/${storia.id}`);
  assert.equal(residents.calls.filter((c) => c === 'POST /liberer').length, 0); // on garde les modèles un moment
  await until(() => residents.calls.includes('POST /liberer'), 'ménage après inactivité', 2000);
});

test('mode jeu : le programme qui tient la carte est prévenu tout de suite, les autres attendent', async (t) => {
  const { call, url, residents } = await startGardien(t);
  const lease = await reserveGpu({ url, client: 'storia', motif: 'La boussole', priorite: 'haute' });
  const other = (await call('POST', '/api/reservations', { client: 'oula', priorite: 'basse' })).data;
  const revokedAt = new Promise<number>((resolve) => lease.revoked.addEventListener('abort', () => resolve(Date.now()), { once: true }));
  const paused = Date.now();
  assert.equal((await call('POST', '/api/pause', {})).data.carte.etat, 'pause');
  assert.ok((await revokedAt) - paused < 2000);
  assert.equal(await lease.check(), false);
  await until(() => residents.calls.includes('POST /liberer'), 'ménage pour le jeu');
  assert.equal((await call('GET', `/api/reservations/${other.id}`)).data.attente, 'est en pause');
  assert.notEqual((await call('POST', '/api/reprise', {})).data.carte.etat, 'pause');
  await until(async () => (await call('GET', `/api/reservations/${other.id}`)).data.etat === 'accordee', 'reprise'); // Oula attendait : il passe
  await lease.release();
});

test('le mode jeu automatique suit le jeu, et la reprise manuelle laisse jouer sans réserver', async (t) => {
  let running: string[] = [];
  const { gardien, call } = await startGardien(t, {
    cfg: { jeux: { actif: true, interrompre: true, regles: DEFAULT_GAME_RULES } },
    options: { listProcesses: async () => running },
  });
  running = ['D:\\SteamLibrary\\steamapps\\common\\Hades\\Hades.exe'];
  await gardien.watcher?.scan();
  const state = (await call('GET', '/api/etat')).data;
  assert.deepEqual([state.carte.etat, state.carte.pause.detail, state.jeux.detecte], ['pause', 'Hades.exe', 'Hades.exe']);
  await call('POST', '/api/reprise', {}); // « je joue à un petit jeu, continue »
  await gardien.watcher?.scan();
  assert.equal((await call('GET', '/api/etat')).data.carte.etat, 'libre');
});

test('une tâche Wan confiée au gardien attend son tour, reprend après un jeu, et rend son fichier', async (t) => {
  let runs = 0;
  const { call, url } = await startGardien(t, {
    options: {
      runWan: async (task, signal, onSteps) => {
        runs++;
        onSteps(0.5);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, runs === 1 ? 5000 : 50);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Wan2GP arrêté'));
          });
        });
        const file = path.join(task.dossier, 'avatar.mp4');
        await writeFile(file, 'vidéo').catch(async () => {
          const { mkdir } = await import('node:fs/promises');
          await mkdir(task.dossier, { recursive: true });
          await writeFile(file, 'vidéo');
        });
        return file;
      },
    },
  });
  assert.equal((await call('POST', '/api/wan', { client: 'oula', reglages: { prompt: 'x' } })).status, 400); // model_type manquant
  const task = (await call('POST', '/api/wan', { client: 'oula', motif: 'avatar 1', reglages: { model_type: 'i2v_2_2', prompt: 'sourire' } })).data;
  await until(async () => (await call('GET', `/api/wan/${task.id}`)).data.etat === 'en_cours', 'tâche lancée');
  await call('POST', '/api/pause', {}); // un jeu démarre : Wan2GP est arrêté, la tâche repasse en tête
  await until(async () => (await call('GET', `/api/wan/${task.id}`)).data.etat === 'attente', 'tâche remise en attente');
  await call('POST', '/api/reprise', {});
  await until(async () => (await call('GET', `/api/wan/${task.id}`)).data.etat === 'terminee', 'tâche terminée');
  assert.equal(runs, 2);
  const file = await fetch(`${url}/api/wan/${task.id}/fichier`);
  assert.equal(await file.text(), 'vidéo');
  const waiting = (await call('POST', '/api/reservations', { client: 'storia' })).data;
  await until(async () => (await call('GET', `/api/reservations/${waiting.id}`)).data.etat === 'accordee', 'Storia a la carte'); // après le ménage
  const queued = (await call('POST', '/api/wan', { client: 'oula', reglages: { model_type: 'i2v_2_2' } })).data;
  assert.equal(queued.position, 1);
  assert.equal((await call('DELETE', `/api/wan/${queued.id}`)).data.annulee, true);
  assert.equal((await call('GET', `/api/wan/${queued.id}`)).data.etat, 'annulee');
  await call('DELETE', `/api/reservations/${waiting.id}`);
});

test('un service est lancé à la demande, une seule fois même si on le demande deux fois', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gardien-service-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const probe = http.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as AddressInfo).port;
  await new Promise((resolve) => probe.close(resolve));
  const script = path.join(dir, 'faux-service.js');
  await writeFile(script, `setTimeout(() => require('http').createServer((q, r) => r.end('{"status":"ok"}')).listen(${port}, '127.0.0.1'), 300);`);
  const { call, gardien } = await startGardien(t, {
    cfg: { services: { voix: { commande: [process.execPath, script], sante: `http://127.0.0.1:${port}/health`, delaiSecondes: 10 } } },
  });
  t.after(() => gardien.stop());
  const [a, b] = await Promise.all([call('POST', '/api/services/voix/demarrer', {}), call('POST', '/api/services/voix/demarrer', {})]);
  assert.deepEqual([a.data.ok, b.data.ok, a.data.lance], [true, true, true]);
  assert.equal((await call('POST', '/api/services/inconnu/demarrer', {})).status, 404);
  const services = (await call('GET', '/api/etat')).data.services;
  assert.deepEqual(services.map((s: { nom: string; ok: boolean }) => [s.nom, s.ok]), [['voix', true]]);
});

test('l’API refuse ce qu’une autre page web pourrait envoyer, et les demandes mal formées', async (t) => {
  const { url, call } = await startGardien(t);
  const form = await fetch(`${url}/api/pause`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
  assert.equal(form.status, 415);
  assert.equal((await call('POST', '/api/reservations', { client: '' })).status, 400);
  assert.equal((await call('POST', '/api/reservations', { client: 'oula', priorite: 'urgente' })).status, 400);
  assert.equal((await call('GET', '/api/reservations/inconnue')).status, 404);
  assert.match(await (await fetch(url)).text(), /Gardien de la carte graphique/);
});
