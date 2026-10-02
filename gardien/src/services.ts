// Les serveurs que le gardien lance lui-même quand on en a besoin (par exemple le serveur de voix de Storia).
// Après un redémarrage du PC, rien n'est à lancer à la main : le premier qui demande la voix la fait démarrer.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export interface ServiceConfig {
  /** La commande, programme puis arguments : ["C:/…/python.exe", "voix/serveur_voix.py", …]. */
  commande: string[];
  /** Dossier dans lequel la lancer. */
  dossier?: string;
  /** Adresse qui répond quand le service est prêt (GET). */
  sante: string;
  /** Adresse qui lui fait rendre la mémoire de la carte graphique (POST), s'il en a une. */
  liberer?: string;
  /** Temps laissé au démarrage (5 minutes : la voix charge ses modèles). */
  delaiSecondes?: number;
}

export interface ServiceState {
  nom: string;
  ok: boolean;
  /** Lancé par le gardien (sinon : lancé à la main, ou arrêté). */
  lance: boolean;
  detail: string;
}

async function responds(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2500) })).ok;
  } catch {
    return false;
  }
}

export class ManagedService {
  readonly nom: string;
  readonly cfg: ServiceConfig;
  private child: ChildProcess | null = null;
  private starting: Promise<ServiceState> | null = null;
  private readonly logDir: string;
  private readonly log: (line: string) => void;

  constructor(nom: string, cfg: ServiceConfig, logDir: string, log: (line: string) => void) {
    this.nom = nom;
    this.cfg = cfg;
    this.logDir = logDir;
    this.log = log;
  }

  async state(): Promise<ServiceState> {
    const ok = await responds(this.cfg.sante);
    return { nom: this.nom, ok, lance: this.child !== null, detail: ok ? 'prêt' : this.child ? 'démarre…' : 'arrêté' };
  }

  /** Démarre le service s'il ne répond pas, et attend qu'il soit prêt. Plusieurs appels se partagent le même démarrage. */
  ensure(): Promise<ServiceState> {
    this.starting ??= this.start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async start(): Promise<ServiceState> {
    if (await responds(this.cfg.sante)) return { nom: this.nom, ok: true, lance: this.child !== null, detail: 'prêt' };
    if (!this.child) {
      const [program, ...args] = this.cfg.commande;
      if (!program) return { nom: this.nom, ok: false, lance: false, detail: 'aucune commande configurée' };
      mkdirSync(this.logDir, { recursive: true });
      const logFile = createWriteStream(path.join(this.logDir, `${this.nom}.log`), { flags: 'a' });
      logFile.write(`\n=== ${new Date().toLocaleString('fr-FR')} : démarrage ===\n`);
      this.log(`Démarrage du service ${this.nom}…`);
      const child = spawn(program, args, {
        cwd: this.cfg.dossier,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
      });
      child.stdout?.pipe(logFile, { end: false });
      child.stderr?.pipe(logFile, { end: false });
      child.on('error', (err) => logFile.write(`Impossible de lancer ${program} : ${err.message}\n`));
      child.on('exit', (code) => {
        logFile.end(`=== arrêté (code ${code}) ===\n`);
        if (this.child === child) this.child = null;
        this.log(`Le service ${this.nom} s'est arrêté (code ${code}).`);
      });
      this.child = child;
    }
    const deadline = Date.now() + (this.cfg.delaiSecondes ?? 300) * 1000;
    while (Date.now() < deadline) {
      if (await responds(this.cfg.sante)) {
        this.log(`Service ${this.nom} prêt.`);
        return { nom: this.nom, ok: true, lance: true, detail: 'prêt' };
      }
      if (!this.child) break; // il s'est arrêté : son journal dit pourquoi
      await sleep(1000);
    }
    const journal = path.join(this.logDir, `${this.nom}.log`);
    return { nom: this.nom, ok: false, lance: this.child !== null, detail: `ne démarre pas : voir ${journal}` };
  }

  /** Arrête le service s'il a été lancé par le gardien. */
  stop(): void {
    this.child?.kill();
    this.child = null;
  }
}
