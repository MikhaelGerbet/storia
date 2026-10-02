// Les tâches Wan confiées au gardien : un programme (Oula…) envoie ses réglages Wan2GP, le gardien attend
// son tour, lance Wan2GP sans interface, puis rend le fichier produit. Wan2GP s'arrête après chaque tâche :
// la carte graphique est libre dès qu'il n'y a plus rien à faire.
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { findWan, runWan, useModelsFolder } from '../../generator/src/wan.ts';
import type { WanInstall } from '../../generator/src/wan.ts';
import type { Priority, Reservation, Scheduler } from './reservations.ts';

export type TaskState = 'attente' | 'en_cours' | 'terminee' | 'echec' | 'annulee';

export interface WanTask {
  id: string;
  client: string;
  motif: string;
  priorite: Priority;
  /** Réglages Wan2GP, tels qu'exportés depuis son interface (« Export Settings »). */
  reglages: Record<string, unknown>;
  attendu: 'image' | 'video';
  /** Dossier de travail : réglages, journal et résultat. */
  dossier: string;
  etat: TaskState;
  reservation: string;
  avancement: number;
  fichier: string | null;
  erreur: string | null;
  demandeeLe: number;
  commenceeLe: number | null;
  termineeLe: number | null;
}

export interface TaskRunnerOptions {
  /** Dossier de Wan2GP (sinon : cherché dans Pinokio). */
  wanDir?: string;
  /** Dossier des modèles de Wan2GP, s'il est ailleurs. */
  modelsDir?: string;
  /** Où ranger les tâches qui ne donnent pas de dossier. */
  workDir: string;
  log: (line: string) => void;
  /** Remplace Wan2GP (tests). */
  run?: (task: WanTask, signal: AbortSignal, onSteps: (fraction: number) => void) => Promise<string>;
  /** Combien de temps garder les tâches finies (24 h). */
  keepMs?: number;
}

/** Ce que le gardien montre d'une tâche (sans ses réglages, parfois longs). */
export function taskView(t: WanTask, position: number | null) {
  const { reglages: _, reservation: __, ...rest } = t;
  return { ...rest, position: t.etat === 'attente' ? position : null };
}

export class TaskRunner {
  readonly tasks = new Map<string, WanTask>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly scheduler: Scheduler;
  private readonly o: TaskRunnerOptions;
  private install: Promise<WanInstall> | null = null;

  constructor(scheduler: Scheduler, o: TaskRunnerOptions) {
    this.scheduler = scheduler;
    this.o = o;
    scheduler.on('grant', (r: Reservation) => {
      const task = this.byReservation(r.id);
      if (task) void this.execute(task);
    });
    scheduler.on('revoke', (r: Reservation) => {
      // Un jeu réclame la carte : on arrête Wan2GP, la tâche repassera en tête de file.
      const task = this.byReservation(r.id);
      if (task) this.controllers.get(task.id)?.abort('jeu');
    });
  }

  submit(o: { client: string; motif?: string; priorite?: Priority; reglages: Record<string, unknown>; attendu?: 'image' | 'video'; dossier?: string }): WanTask {
    const id = randomUUID();
    const task: WanTask = {
      id,
      client: o.client,
      motif: o.motif ?? String(o.reglages.prompt ?? '').slice(0, 80),
      priorite: o.priorite ?? 'basse',
      reglages: o.reglages,
      attendu: o.attendu ?? 'video',
      dossier: o.dossier ?? path.join(this.o.workDir, id),
      etat: 'attente',
      reservation: '',
      avancement: 0,
      fichier: null,
      erreur: null,
      demandeeLe: Date.now(),
      commenceeLe: null,
      termineeLe: null,
    };
    this.tasks.set(id, task);
    this.enqueue(task, false);
    return task;
  }

  cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (task.etat === 'attente') {
      this.scheduler.release(task.reservation);
      this.finish(task, 'annulee', null);
    } else if (task.etat === 'en_cours') {
      this.controllers.get(id)?.abort('annulee');
    } else {
      this.tasks.delete(id); // déjà finie : on l'oublie
    }
    return true;
  }

  /** Oublie les tâches finies depuis longtemps. */
  purge(now = Date.now()): void {
    for (const [id, t] of this.tasks) {
      if (t.termineeLe && now - t.termineeLe > (this.o.keepMs ?? 86_400_000)) this.tasks.delete(id);
    }
  }

  /** Arrête toutes les tâches en cours (arrêt du gardien). */
  abortAll(): void {
    for (const c of this.controllers.values()) c.abort('arret');
  }

  private byReservation(id: string): WanTask | undefined {
    for (const t of this.tasks.values()) if (t.reservation === id) return t;
    return undefined;
  }

  private enqueue(task: WanTask, reprise: boolean): void {
    // Réservation tenue par le gardien lui-même : il n'a pas besoin de donner signe de vie.
    const r = this.scheduler.request({ client: task.client, motif: task.motif, priorite: task.priorite, reprise, interne: true });
    task.reservation = r.id;
    // La carte était libre : la file l'a donnée pendant la demande, avant que la tâche connaisse sa réservation.
    if (r.etat === 'accordee') void this.execute(task);
  }

  private finish(task: WanTask, etat: TaskState, erreur: string | null): void {
    task.etat = etat;
    task.erreur = erreur;
    task.termineeLe = Date.now();
  }

  private wan(): Promise<WanInstall> {
    this.install ??= (async () => {
      const install = await findWan(this.o.wanDir);
      if (this.o.modelsDir) await useModelsFolder(install, this.o.modelsDir);
      return install;
    })().catch((err: unknown) => {
      this.install = null; // on réessaiera à la prochaine tâche
      throw err;
    });
    return this.install;
  }

  private async execute(task: WanTask): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(task.id, controller);
    task.etat = 'en_cours';
    task.commenceeLe ??= Date.now();
    task.avancement = 0;
    this.o.log(`Wan pour ${task.client} : ${task.motif || task.id}`);
    try {
      const onSteps = (fraction: number) => {
        task.avancement = fraction;
      };
      const file = this.o.run
        ? await this.o.run(task, controller.signal, onSteps)
        : await runWan({ install: await this.wan(), jobDir: task.dossier, signal: controller.signal, onSteps, log: this.o.log }, 'tache', task.reglages, task.attendu);
      task.fichier = file;
      task.avancement = 1;
      this.finish(task, 'terminee', null);
      this.o.log(`Wan pour ${task.client} : terminé (${path.basename(file)})`);
    } catch (err) {
      if (controller.signal.reason === 'jeu') {
        // Interrompue par un jeu : elle reprendra du début, en tête de file.
        task.etat = 'attente';
        task.avancement = 0;
        this.controllers.delete(task.id);
        this.scheduler.release(task.reservation);
        this.enqueue(task, true);
        return;
      }
      if (controller.signal.reason === 'annulee' || controller.signal.reason === 'arret') {
        this.finish(task, 'annulee', null);
      } else {
        const message = (err as Error).message ?? String(err);
        this.finish(task, 'echec', message);
        this.o.log(`Wan pour ${task.client} : échec. ${message.split('\n')[0]}`);
      }
    } finally {
      if (this.controllers.get(task.id) === controller) this.controllers.delete(task.id);
      if (task.etat !== 'attente') this.scheduler.release(task.reservation);
    }
  }
}
