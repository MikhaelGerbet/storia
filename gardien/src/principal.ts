// Le gardien de la carte graphique : npm start, puis http://localhost:7870
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createApi } from './api.ts';
import { HELP, readConfig } from './config.ts';
import type { GardienConfig } from './config.ts';
import { Gardien } from './gardien.ts';

async function main(): Promise<void> {
  let cfg: GardienConfig | null;
  try {
    cfg = readConfig(process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    console.error('La liste des options : npm start -- --aide');
    process.exit(2);
  }
  if (!cfg) {
    console.log(HELP);
    return;
  }
  // Le gardien tourne souvent caché (lancé à l'ouverture de session) : tout ce qu'il dit va aussi dans un journal.
  mkdirSync(cfg.journaux, { recursive: true });
  const journal = path.join(cfg.journaux, 'gardien.log');
  const log = (line: string) => {
    const stamped = `${new Date().toLocaleString('fr-FR')} ${line}`;
    console.log(stamped);
    try {
      appendFileSync(journal, `${stamped}\n`);
    } catch {
      // Journal inaccessible : la console suffit.
    }
  };

  const gardien = new Gardien(cfg, { log });
  const server = createApi(gardien);
  const port = cfg.port;
  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(err.code === 'EADDRINUSE' ? `Le port ${port} est déjà pris : un gardien tourne sans doute déjà.` : err.message);
    process.exit(1);
  });
  await new Promise<void>((resolve) => server.listen(port, cfg.hote, resolve));
  gardien.start();

  log(`Gardien de la carte graphique prêt : http://localhost:${port}`);
  if (cfg.fichier) log(`  Réglages : ${cfg.fichier}`);
  log(`  Mode jeu automatique : ${gardien.watcher ? (process.platform === 'win32' ? 'oui' : 'non (seulement sous Windows)') : 'non'}`);
  for (const nom of gardien.services.keys()) log(`  Service lancé à la demande : ${nom}`);
  log(`  Ménage après ${Math.round(cfg.inactiviteMs / 60_000)} min sans demande.`);

  let closing = false;
  const shutdown = () => {
    if (closing) process.exit(1);
    closing = true;
    log('Arrêt du gardien.');
    gardien.stop();
    server.close();
    server.closeAllConnections();
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
