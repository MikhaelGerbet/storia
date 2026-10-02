// La file de création : chaque demande d'histoire devient une tâche BullMQ, gardée dans Redis.
// Une seule histoire est fabriquée à la fois : texte, voix, image et animation se partagent la carte graphique.
import { Queue } from 'bullmq';
import type { Job, RedisOptions, Worker } from 'bullmq';
import type { Composition } from '../../generator/src/catalogue.ts';
import type { PipelineStep } from '../../generator/src/pipeline.ts';
import { newStoryId } from './bibliotheque.ts';

export const QUEUE = 'histoires';
/** Raison d'échec d'une fabrication arrêtée à la demande. */
export const ANNULEE = 'Annulée.';
/** Au-delà, la file refuse les nouvelles demandes : un enfant qui appuie dix fois n'occupe pas la nuit. */
export const MAX_ATTENTE = 12;

export interface CreationData {
  histoireId: string;
  composition: Composition;
  /** Image animée par Wan 2.2 (plusieurs minutes de plus), ou image fixe. */
  animation: boolean;
}

export interface StepProgress {
  id: PipelineStep;
  avancement: number;
}

export interface CreationProgress {
  etape: PipelineStep;
  /** Avancement de l'étape en cours, de 0 à 1. */
  avancement: number;
  /** Avancement de toute la fabrication, de 0 à 1. */
  global: number;
  detail?: string;
  /** Connu dès que le texte est écrit. */
  titre?: string;
  /** Ce qui manque pour avancer (un service à lancer), sinon absent. */
  attente?: string;
  etapes: StepProgress[];
}

export interface CreationResult {
  histoireId: string;
  titre: string;
}

export type CreationState = 'attente' | 'en_cours' | 'terminee' | 'echec' | 'annulee';

export interface CreationView {
  id: string;
  etat: CreationState;
  /** Rang dans la file d'attente : 1 pour la prochaine. */
  position: number | null;
  composition: Composition;
  animation: boolean;
  histoireId: string;
  titre: string | null;
  progression: CreationProgress | null;
  erreur: string | null;
  demandeeLe: string;
  commenceeLe: string | null;
  termineeLe: string | null;
}

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** redis://[utilisateur:motdepasse@]hote:port/base, ou rediss:// pour une connexion chiffrée. */
export function redisOptions(url: string): RedisOptions {
  const u = new URL(url);
  if (u.protocol !== 'redis:' && u.protocol !== 'rediss:') throw new Error(`Adresse Redis inattendue : ${url} (redis://hote:port attendu).`);
  const db = u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0;
  if (!Number.isInteger(db) || db < 0) throw new Error(`Base Redis inattendue dans ${url}.`);
  return {
    host: u.hostname.replace(/^\[|\]$/g, '') || '127.0.0.1',
    port: u.port ? Number(u.port) : 6379,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db,
    tls: u.protocol === 'rediss:' ? {} : undefined,
  };
}

type CreationJob = Job<CreationData, CreationResult>;

const iso = (ms: number | undefined) => (ms ? new Date(ms).toISOString() : null);

function stateOf(job: CreationJob, state: string): CreationState {
  if (state === 'active') return 'en_cours';
  if (state === 'completed') return 'terminee';
  if (state === 'failed') return job.failedReason === ANNULEE ? 'annulee' : 'echec';
  return 'attente';
}

function toView(job: CreationJob, state: string, position: number | null): CreationView {
  const etat = stateOf(job, state);
  let progress = job.progress && typeof job.progress === 'object' ? (job.progress as CreationProgress) : null;
  if (progress?.attente && etat !== 'en_cours') {
    const { attente: _, ...rest } = progress; // ce qui manquait n'a plus d'importance
    progress = rest;
  }
  return {
    id: job.id as string,
    etat,
    position: etat === 'attente' ? position : null,
    composition: job.data.composition,
    animation: job.data.animation,
    histoireId: job.data.histoireId,
    titre: job.returnvalue?.titre ?? progress?.titre ?? null,
    progression: progress,
    erreur: etat === 'echec' ? job.failedReason || 'Erreur inconnue.' : null,
    demandeeLe: new Date(job.timestamp).toISOString(),
    commenceeLe: iso(job.processedOn),
    termineeLe: etat === 'terminee' || etat === 'echec' || etat === 'annulee' ? iso(job.finishedOn) : null,
  };
}

/** Les demandes d'histoires : en ajouter, suivre leur fabrication, en annuler, en relancer. */
export class Studio {
  readonly queue: Queue<CreationData, CreationResult>;
  /** Le travailleur de ce processus, s'il y en a un : lui seul peut arrêter une fabrication en cours. */
  worker: Worker<CreationData, CreationResult> | null = null;

  constructor(connection: RedisOptions) {
    this.queue = new Queue<CreationData, CreationResult>(QUEUE, {
      // Sans Redis, les demandes échouent tout de suite au lieu d'attendre indéfiniment.
      connection: { ...connection, enableOfflineQueue: false },
      defaultJobOptions: {
        attempts: 1, // un échec demande en général d'agir (lancer un service) : on ne recommence pas tout seul
        removeOnComplete: { age: 14 * 86_400, count: 200 },
        removeOnFail: { age: 30 * 86_400, count: 100 },
        keepLogs: 400,
      },
    });
  }

  /** Vérifie que Redis répond. */
  async ping(timeoutMs = 2000): Promise<boolean> {
    try {
      const client = await Promise.race([this.queue.client, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('délai')), timeoutMs))]);
      await client.get('storia:ping'); // une lecture qui aboutit suffit
      return true;
    } catch {
      return false;
    }
  }

  async create(data: Omit<CreationData, 'histoireId'>): Promise<CreationView> {
    const counts = await this.queue.getJobCounts('waiting', 'prioritized', 'delayed');
    if (Object.values(counts).reduce((a, b) => a + b, 0) >= MAX_ATTENTE) {
      throw new HttpError(429, `Déjà ${MAX_ATTENTE} histoires en attente : attends que les premières soient prêtes.`);
    }
    const histoireId = newStoryId();
    await this.queue.add('histoire', { ...data, histoireId }, { jobId: histoireId });
    return (await this.view(histoireId)) as CreationView;
  }

  /** Les fabrications en cours, puis la file d'attente dans l'ordre, puis les plus récentes terminées. */
  async list(finished = 30): Promise<CreationView[]> {
    const [active, waiting, completed, failed] = await Promise.all([
      this.queue.getJobs(['active']),
      this.queue.getJobs(['waiting', 'prioritized', 'delayed'], 0, -1, true),
      this.queue.getJobs(['completed'], 0, finished - 1),
      this.queue.getJobs(['failed'], 0, finished - 1),
    ]);
    const seen = new Set<string>();
    const views: CreationView[] = [];
    const push = (job: CreationJob | undefined, state: string, position: number | null) => {
      if (!job?.id || seen.has(job.id)) return; // une tâche peut changer de liste entre deux lectures
      seen.add(job.id);
      views.push(toView(job, state, position));
    };
    for (const job of active) push(job, 'active', null);
    waiting.forEach((job, i) => push(job, 'waiting', i + 1));
    const ended = [...completed.map((job) => ({ job, state: 'completed' })), ...failed.map((job) => ({ job, state: 'failed' }))];
    ended.sort((a, b) => (b.job.finishedOn ?? 0) - (a.job.finishedOn ?? 0));
    for (const { job, state } of ended.slice(0, finished)) push(job, state, null);
    return views;
  }

  async view(id: string): Promise<CreationView | null> {
    const job = (await this.queue.getJob(id)) as CreationJob | undefined;
    if (!job) return null;
    const state = await job.getState();
    let position: number | null = null;
    if (state === 'waiting' || state === 'prioritized' || state === 'delayed') {
      const waiting = await this.queue.getJobs(['waiting', 'prioritized', 'delayed'], 0, -1, true);
      position = waiting.findIndex((j) => j.id === id) + 1 || null;
    }
    return toView(job, state, position);
  }

  async journal(id: string): Promise<string[] | null> {
    if (!(await this.queue.getJob(id))) return null;
    return (await this.queue.getJobLogs(id, 0, -1, true)).logs;
  }

  /**
   * Annule une fabrication : retirée de la file si elle attend, arrêtée si elle est en cours.
   * Une fabrication terminée, échouée ou annulée est simplement retirée de la liste.
   */
  async cancel(id: string): Promise<{ action: 'retiree' | 'arretee'; histoireId: string } | null> {
    const job = (await this.queue.getJob(id)) as CreationJob | undefined;
    if (!job) return null;
    const histoireId = job.data.histoireId;
    if ((await job.getState()) !== 'active') {
      try {
        await job.remove();
        return { action: 'retiree', histoireId };
      } catch (err) {
        // Elle vient de commencer : on l'arrête.
        if ((await job.getState()) !== 'active') throw err;
      }
    }
    if (this.worker?.cancelJob(id)) return { action: 'arretee', histoireId };
    throw new HttpError(409, "Cette histoire est fabriquée par un autre processus : arrête-la depuis celui-ci, ou attends qu'elle soit prête.");
  }

  /** Recommence une fabrication échouée ou annulée, avec la même composition. */
  async retry(id: string): Promise<{ creation: CreationView; ancienneHistoireId: string } | null> {
    const job = (await this.queue.getJob(id)) as CreationJob | undefined;
    if (!job) return null;
    if ((await job.getState()) !== 'failed') throw new HttpError(409, "Seule une histoire qui a échoué ou qui a été annulée peut être relancée.");
    const creation = await this.create({ composition: job.data.composition, animation: job.data.animation });
    await job.remove();
    return { creation, ancienneHistoireId: job.data.histoireId };
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
