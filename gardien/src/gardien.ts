// Le gardien : la file de la carte graphique, le ménage quand plus personne ne s'en sert, le mode jeu,
// les tâches Wan confiées par les autres programmes et les serveurs lancés à la demande.
import type { GardienConfig } from './config.ts';
import { GameWatcher } from './jeux.ts';
import { freeGpu } from './menage.ts';
import { Scheduler } from './reservations.ts';
import type { Pause, Reservation } from './reservations.ts';
import { ManagedService } from './services.ts';
import { TaskRunner } from './taches.ts';
import type { TaskRunnerOptions } from './taches.ts';

export interface GardienOptions {
  log: (line: string) => void;
  /** Remplace la liste des programmes en cours (tests). */
  listProcesses?: () => Promise<string[]>;
  /** Remplace Wan2GP (tests). */
  runWan?: TaskRunnerOptions['run'];
  /** Délai laissé au programme interrompu par un jeu pour s'arrêter avant le ménage (3 s). */
  revokeGraceMs?: number;
  tickMs?: number;
  now?: () => number;
}

export class Gardien {
  readonly scheduler: Scheduler;
  readonly tasks: TaskRunner;
  readonly services = new Map<string, ManagedService>();
  readonly watcher: GameWatcher | null;
  readonly cfg: GardienConfig;
  /** Le dernier ménage : quand, et ce qui a été libéré. */
  lastCleanup: { at: number; freed: string[]; raison: string } | null = null;
  private readonly o: GardienOptions;
  private idleTimer: NodeJS.Timeout | undefined;
  private ticker: NodeJS.Timeout | undefined;
  /** Un jeu pour lequel on a repris la main : on n'y touche plus jusqu'à ce qu'il se ferme. */
  private ignoredGame: string | null = null;

  constructor(cfg: GardienConfig, o: GardienOptions) {
    this.cfg = cfg;
    this.o = o;
    this.scheduler = new Scheduler({ leaseMs: cfg.leaseMs, now: o.now, beforeSwitch: (previous) => this.cleanup(`passage de ${previous} au suivant`) });
    for (const [nom, s] of Object.entries(cfg.services)) this.services.set(nom, new ManagedService(nom, s, cfg.journaux, o.log));
    this.tasks = new TaskRunner(this.scheduler, { wanDir: cfg.wan.dossier, modelsDir: cfg.wan.modeles, workDir: cfg.travaux, log: o.log, run: o.runWan });
    this.scheduler.on('grant', (r: Reservation) => {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
      this.o.log(`Carte graphique → ${r.client}${r.motif ? ` (${r.motif})` : ''}`);
    });
    this.scheduler.on('abandon', (r: Reservation) => this.o.log(`${r.client} ne donne plus signe de vie : sa réservation est rendue.`));
    this.scheduler.on('change', () => {
      if (!this.scheduler.isIdle()) {
        clearTimeout(this.idleTimer);
        this.idleTimer = undefined;
      }
    });
    this.scheduler.on('idle', () => {
      // Plus personne : on garde les modèles un moment (une demande peut suivre), puis on vide la carte.
      if (this.idleTimer || this.scheduler.lastClient === null) return;
      this.idleTimer = setTimeout(() => {
        this.idleTimer = undefined;
        if (this.scheduler.isIdle()) void this.cleanup('plus personne ne s’en sert');
      }, cfg.inactiviteMs);
    });
    this.watcher = cfg.jeux.actif ? new GameWatcher({ rules: cfg.jeux.regles, list: o.listProcesses, now: o.now }) : null;
    this.watcher?.on('debut', (game: string) => this.onGameStart(game));
    this.watcher?.on('fin', (game: string) => this.onGameEnd(game));
  }

  start(): void {
    this.ticker = setInterval(() => {
      this.scheduler.tick();
      this.tasks.purge();
    }, this.o.tickMs ?? 2000);
    if (this.watcher && (process.platform === 'win32' || this.o.listProcesses)) this.watcher.start();
  }

  stop(): void {
    clearInterval(this.ticker);
    clearTimeout(this.idleTimer);
    this.watcher?.stop();
    this.tasks.abortAll();
    for (const s of this.services.values()) s.stop();
  }

  /** Vide la carte : modèles d'Ollama, serveurs qui savent rendre leur mémoire. */
  async cleanup(raison: string): Promise<string[]> {
    const liberer = [...this.cfg.liberer, ...[...this.services.values()].map((s) => s.cfg.liberer).filter((u): u is string => Boolean(u))];
    const freed = await freeGpu({ ollama: this.cfg.ollama, liberer });
    this.lastCleanup = { at: Date.now(), freed, raison };
    this.scheduler.cleaned();
    this.o.log(freed.length ? `Ménage (${raison}) : ${freed.join(', ')}` : `Ménage (${raison}) : la carte était déjà libre.`);
    return freed;
  }

  /** Mode jeu manuel (le bouton). */
  pause(): void {
    this.setPause({ raison: 'manuel', depuis: Date.now() });
  }

  /** Reprise manuelle. Si un jeu tourne encore, on le laisse jouer sans lui réserver la carte. */
  resume(): void {
    if (this.scheduler.pause?.raison === 'jeu' && this.watcher?.current) this.ignoredGame = this.watcher.current;
    this.scheduler.setPause(null);
    this.o.log('Reprise : la carte graphique est de nouveau partagée.');
  }

  private setPause(pause: Pause): void {
    const revoked = this.scheduler.setPause(pause, this.cfg.jeux.interrompre);
    this.o.log(pause.raison === 'jeu' ? `Mode jeu (${pause.detail}) : la carte est réservée au jeu.` : 'Mode jeu : la carte est réservée.');
    if (revoked) this.o.log(`${revoked.client} doit rendre la carte : sa tâche reprendra après.`);
    // Le programme interrompu a quelques secondes pour s'arrêter, puis on vide la carte.
    setTimeout(() => void this.cleanup('mode jeu'), revoked ? (this.o.revokeGraceMs ?? 3000) : 0);
  }

  private onGameStart(game: string): void {
    if (game === this.ignoredGame || this.scheduler.pause) return;
    this.setPause({ raison: 'jeu', detail: game, depuis: Date.now() });
  }

  private onGameEnd(game: string): void {
    this.ignoredGame = null;
    if (this.scheduler.pause?.raison !== 'jeu') return;
    this.scheduler.setPause(null);
    this.o.log(`Fin de ${game} : la carte graphique est de nouveau partagée.`);
  }

  /** Démarre un service à la demande (et attend qu'il soit prêt). */
  async ensureService(nom: string) {
    const service = this.services.get(nom);
    if (!service) return null;
    return service.ensure();
  }

  /** Tout ce que la page et l'API montrent. */
  async state() {
    const holder = this.scheduler.holder();
    const pause = this.scheduler.pause;
    const view = (r: Reservation) => ({
      id: r.id,
      client: r.client,
      motif: r.motif,
      priorite: r.priorite,
      etat: r.etat,
      depuis: new Date(r.accordeeLe ?? r.demandeeLe).toISOString(),
    });
    return {
      carte: {
        etat: pause ? 'pause' : holder ? 'occupee' : 'libre',
        detenteur: holder ? view(holder) : null,
        pause: pause ? { raison: pause.raison, detail: pause.detail ?? null, depuis: new Date(pause.depuis).toISOString() } : null,
      },
      attente: this.scheduler.waiting().map(view),
      taches: [...this.tasks.tasks.values()]
        .sort((a, b) => b.demandeeLe - a.demandeeLe)
        .slice(0, 20)
        .map((t) => ({ id: t.id, client: t.client, motif: t.motif, etat: t.etat, avancement: t.avancement, erreur: t.erreur })),
      services: await Promise.all([...this.services.values()].map((s) => s.state())),
      jeux: { actif: Boolean(this.watcher), detecte: this.watcher?.current ?? null },
      menage: this.lastCleanup ? { ...this.lastCleanup, at: new Date(this.lastCleanup.at).toISOString() } : null,
    };
  }
}
