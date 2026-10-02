// Le studio Storia : npm start, puis ouvre http://localhost:3000
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findWan } from '../../generator/src/wan.ts';
import type { WanInstall } from '../../generator/src/wan.ts';
import { createApi } from './api.ts';
import { Library } from './bibliotheque.ts';
import { HELP, readConfig } from './config.ts';
import type { Config } from './config.ts';
import { Studio, redisOptions } from './file.ts';
import { abilities, checkImage, checkOllama, checkVoice } from './services.ts';
import type { Health } from './services.ts';
import { startWorker } from './travailleur.ts';

const log = (line: string) => console.log(`${new Date().toLocaleTimeString('fr-FR')} ${line}`);

/** Adresses de ce PC sur le réseau local, pour ouvrir l'application depuis une tablette. */
function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => (a as os.NetworkInterfaceInfo).address);
}

async function main(): Promise<void> {
  let config: Config | null;
  try {
    config = readConfig(process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    console.error('La liste des options : npm start -- --aide');
    process.exit(2);
  }
  if (!config) {
    console.log(HELP);
    return;
  }
  const cfg = config;

  await mkdir(cfg.bibliotheque, { recursive: true });
  const library = new Library(path.join(cfg.bibliotheque, 'bibliotheque.sqlite'));

  let wan: WanInstall | null = null;
  if (cfg.wan.actif) {
    try {
      wan = await findWan(cfg.wan.dossier);
    } catch (err) {
      log(`Wan2GP : ${(err as Error).message.split('\n')[0]}`);
    }
  }
  const can = abilities(cfg, wan);

  const connection = redisOptions(cfg.redis);
  const studio = new Studio(connection);
  // Sans Redis, ioredis réessaie sans cesse : on le dit une fois par minute, pas à chaque tentative.
  let lastRedisError = 0;
  const redisDown = (err: Error) => {
    if (Date.now() - lastRedisError < 60_000) return;
    lastRedisError = Date.now();
    log(`Redis ne répond pas sur ${cfg.redis} (${err.message}). La bibliothèque marche, mais pas la création : lance Redis (voir docs/demarrer-sous-windows.md). Je réessaie en continu.`);
  };
  studio.queue.on('error', redisDown);
  if (cfg.travailleur) {
    const worker = startWorker({ connection, config: cfg, library, wan, log });
    worker.on('error', redisDown);
    studio.worker = worker;
  }

  const health = async (): Promise<Health> => {
    const [redis, texte, voix, image] = await Promise.all([
      studio.ping(),
      checkOllama(cfg.ollama, cfg.modele),
      cfg.tts ? checkVoice(cfg.tts) : Promise.resolve(null),
      checkImage(cfg, wan),
    ]);
    return {
      file: redis ? { ok: true, detail: 'Redis' } : { ok: false, detail: `Redis ne répond pas (${cfg.redis}) : lance-le pour créer des histoires.` },
      texte: { ok: texte.ok, detail: texte.detail },
      voix,
      image,
      travailleur: cfg.travailleur,
    };
  };

  const server = createApi({ config: cfg, library, studio, abilities: can, health, log });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') console.error(`Le port ${cfg.port} est déjà pris : un autre studio tourne peut-être déjà. Sinon, choisis-en un autre avec --port 3001.`);
    else console.error(err.message);
    process.exit(1);
  });
  await new Promise<void>((resolve) => server.listen(cfg.port, cfg.hote, resolve));

  const stats = library.stats();
  console.log(`\nStoria est prêt : http://localhost:${cfg.port}`);
  if (cfg.hote === '0.0.0.0') {
    for (const address of lanAddresses()) console.log(`  Sur une tablette ou un téléphone du même Wi-Fi : http://${address}:${cfg.port}`);
  }
  console.log(`  Bibliothèque : ${stats.histoires} histoire${stats.histoires > 1 ? 's' : ''} (${cfg.bibliotheque})`);
  if (!existsSync(path.join(cfg.app, 'index.html'))) console.log("  L'application n'est pas encore compilée : cd app, puis flutter build web");
  const h = await health();
  const line = (label: string, s: { ok: boolean; detail: string } | null) => s && console.log(`  ${s.ok ? '✓' : '✗'} ${label} : ${s.detail}`);
  line('File de création', h.file);
  line('Texte', h.texte);
  line('Voix', h.voix ?? { ok: true, detail: 'celle du navigateur (--sans-voix)' });
  line('Image', h.image);
  if (!cfg.travailleur) console.log('  Fabrication : par un autre processus (--sans-travailleur)');
  console.log('  Ctrl+C pour arrêter.\n');

  let closing = false;
  const shutdown = async () => {
    if (closing) process.exit(1); // deuxième Ctrl+C : tout de suite
    closing = true;
    log('Arrêt du studio… Une histoire en cours de fabrication reprendra au prochain démarrage.');
    server.close();
    server.closeAllConnections();
    const timeout = new Promise((resolve) => setTimeout(resolve, 3000));
    await Promise.race([Promise.all([studio.worker?.close(true), studio.close()]), timeout]);
    library.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
