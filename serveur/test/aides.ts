// Outils des tests : un vrai Redis jetable, une configuration, et une chaîne de fabrication factice qu'on pilote.
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { PipelineOptions, PipelineResult } from '../../generator/src/pipeline.ts';
import type { PlayerScene } from '../../generator/src/scene.ts';
import type { Config } from '../src/config.ts';
import { ROOT_DIR } from '../src/config.ts';

type After = { after: (fn: () => unknown) => void };

/** redis-server est-il installé ? Sinon, les tests de la file sont passés. */
export const HAS_REDIS = spawnSync('redis-server', ['--version']).status === 0;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Lance un Redis jetable, sans sauvegarde sur disque. À arrêter avec stop() APRÈS avoir fermé files et travailleurs :
 * node:test exécute les t.after dans l'ordre où ils sont posés, et une file dont Redis a disparu ferme mal.
 */
export async function startRedis(): Promise<{ url: string; stop: () => void }> {
  const port = await freePort();
  const child = spawn('redis-server', ['--port', String(port), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
  const stop = () => {
    child.kill();
  };
  process.once('exit', stop); // filet de sécurité : jamais de Redis orphelin
  for (let i = 0; i < 100; i++) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
    });
    if (ok) return { url: `redis://127.0.0.1:${port}`, stop };
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  stop();
  throw new Error('redis-server ne démarre pas');
}

export async function tempDir(t: After, prefix = 'storia-serveur-'): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

export function testConfig(o: Partial<Config> & Pick<Config, 'bibliotheque' | 'redis'>): Config {
  return {
    port: 0,
    hote: '127.0.0.1',
    ollama: 'http://127.0.0.1:9',
    modele: 'mistral-small3.2',
    tts: null,
    wan: { actif: false, etapes: 4, image: 'z_image' },
    comfy: 'http://127.0.0.1:9',
    app: path.join(o.bibliotheque, '..', 'app-absente'),
    lecteur: path.join(ROOT_DIR, 'prototype', 'intro-pirate', 'index.html'),
    travailleur: true,
    gardien: null,
    ...o,
  };
}

export async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, what: string, timeoutMs = 8000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  do {
    last = await read();
    if (ok(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 40));
  } while (Date.now() < deadline);
  throw new Error(`${what} : toujours pas, dernier état ${JSON.stringify(last)}`);
}

export interface FakeRun {
  options: PipelineOptions;
  /** Termine la fabrication avec succès. */
  finish: () => void;
}

/** Chaîne factice : annonce le texte, puis attend qu'on la libère (ou qu'on l'annule). */
export function fakePipeline() {
  const runs: FakeRun[] = [];
  const pipeline = async (o: PipelineOptions): Promise<PipelineResult> => {
    const c = o.composition;
    const titre = `Histoire ${runs.length + 1}`;
    let finish!: () => void;
    const released = new Promise<void>((resolve, reject) => {
      finish = resolve;
      o.signal?.addEventListener('abort', () => reject(o.signal?.reason), { once: true });
    });
    runs.push({ options: o, finish });
    o.onProgress?.({ etape: 'texte', avancement: 0 });
    o.onProgress?.({ etape: 'texte', avancement: 1, detail: titre });
    o.log('texte écrit');
    o.onProgress?.({ etape: 'voix', avancement: 0.5, detail: 'phrase 2 sur 4' });
    await mkdir(o.folder as string, { recursive: true });
    await writeFile(path.join(o.folder as string, 'brouillon.txt'), 'en cours');
    await released;
    await writeFile(path.join(o.folder as string, 'index.html'), `<title>${titre}</title>`);
    o.onProgress?.({ etape: 'assemblage', avancement: 1 });
    return {
      folder: o.folder as string,
      htmlPaths: [path.join(o.folder as string, 'index.html')],
      scene: { title: titre } as PlayerScene,
      seconds: 1,
      meta: {
        titre,
        accroche: 'Une petite histoire de test.',
        motsCles: [c?.theme ?? 'test', 'test'],
        texte: 'Il était une fois un test.',
        theme: c?.theme,
        age: o.age,
        dureeSecondes: 61,
        page: 'index.html',
      },
    };
  };
  return { runs, pipeline };
}
