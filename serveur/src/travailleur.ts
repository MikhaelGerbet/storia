// Le travailleur : prend les demandes une à une dans la file et fabrique chaque histoire avec la chaîne du générateur.
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { UnrecoverableError, Worker } from 'bullmq';
import type { Job, RedisOptions } from 'bullmq';
import { runPipeline } from '../../generator/src/pipeline.ts';
import type { PipelineOptions, PipelineProgress, PipelineResult, PipelineStep } from '../../generator/src/pipeline.ts';
import type { WanInstall } from '../../generator/src/wan.ts';
import type { Library } from './bibliotheque.ts';
import type { Config } from './config.ts';
import { ANNULEE, QUEUE } from './file.ts';
import type { CreationData, CreationProgress, CreationResult } from './file.ts';
import { abilities, checkOllama, checkVoice } from './services.ts';

/** Poids de chaque étape dans l'avancement global, d'après leur durée habituelle sur une RX 7900 XT. */
const WEIGHTS: Record<PipelineStep, number> = { texte: 8, voix: 30, image: 12, animation: 45, assemblage: 5 };

export function plannedSteps(config: Config, wan: WanInstall | null, animation: boolean): PipelineStep[] {
  const can = abilities(config, wan);
  const steps: PipelineStep[] = ['texte'];
  if (can.voix) steps.push('voix');
  if (can.image) steps.push('image');
  if (can.animation && animation) steps.push('animation');
  steps.push('assemblage');
  return steps;
}

/** Suit l'avancement de chaque étape et l'envoie à la file, sans l'inonder (au plus deux fois par seconde). */
export class ProgressTracker {
  private readonly done = new Map<PipelineStep, number>();
  private current: CreationProgress;
  private timer: NodeJS.Timeout | undefined;
  private last = 0;
  private stopped = false;
  private readonly steps: PipelineStep[];
  private readonly send: (progress: CreationProgress) => void;

  constructor(steps: PipelineStep[], send: (progress: CreationProgress) => void) {
    this.steps = steps;
    this.send = send;
    this.current = { etape: steps[0], avancement: 0, global: 0, etapes: steps.map((id) => ({ id, avancement: 0 })) };
  }

  update(p: PipelineProgress): void {
    if (!this.steps.includes(p.etape)) return;
    const changed = p.etape !== this.current.etape || p.avancement === 0 || p.avancement === 1;
    this.done.set(p.etape, Math.min(1, Math.max(0, p.avancement)));
    const total = this.steps.reduce((sum, s) => sum + WEIGHTS[s], 0);
    const global = this.steps.reduce((sum, s) => sum + WEIGHTS[s] * (this.done.get(s) ?? 0), 0) / total;
    this.current = {
      etape: p.etape,
      avancement: p.avancement,
      global: Math.round(global * 1000) / 1000,
      detail: p.detail,
      // Le titre arrive avec la fin de l'écriture, puis reste.
      titre: p.etape === 'texte' && p.avancement === 1 && p.detail ? p.detail : this.current.titre,
      etapes: this.steps.map((id) => ({ id, avancement: this.done.get(id) ?? 0 })),
    };
    this.push(changed);
  }

  /** Ce qui bloque la fabrication (un service à lancer), ou null quand tout est là. */
  waiting(attente: string | null): void {
    const { attente: _, ...rest } = this.current;
    this.current = attente ? { ...rest, attente } : rest;
    this.push(true);
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private push(now: boolean): void {
    if (this.stopped) return;
    clearTimeout(this.timer);
    const wait = 500 - (Date.now() - this.last);
    if (now || wait <= 0) {
      this.last = Date.now();
      this.send(this.current);
    } else {
      this.timer = setTimeout(() => this.push(true), wait);
    }
  }
}

export interface WorkerOptions {
  connection: RedisOptions;
  config: Config;
  library: Library;
  wan: WanInstall | null;
  log: (line: string) => void;
  /** Remplace la chaîne de fabrication (tests). */
  pipeline?: (o: PipelineOptions) => Promise<PipelineResult>;
  /** Intervalle entre deux vérifications des services absents (5 s). */
  retryMs?: number;
}

/**
 * Attend qu'Ollama et le serveur de voix répondent, en le disant dans la progression.
 * Lancer un service oublié suffit alors : la fabrication repart d'elle-même. Un modèle absent, lui, ne viendra pas seul.
 */
async function waitForServices(o: WorkerOptions, tracker: ProgressTracker, signal: AbortSignal | undefined): Promise<void> {
  for (;;) {
    const problems: string[] = [];
    const text = await checkOllama(o.config.ollama, o.config.modele);
    if (text.modeleManquant) throw new UnrecoverableError(text.detail);
    if (!text.ok) problems.push(text.detail);
    if (o.config.tts) {
      const voice = await checkVoice(o.config.tts);
      if (!voice.ok) problems.push(voice.detail);
    }
    tracker.waiting(problems.length ? problems.join(' ') : null);
    if (!problems.length) return;
    await sleep(o.retryMs ?? 5000, undefined, { signal });
  }
}

export function startWorker(o: WorkerOptions): Worker<CreationData, CreationResult> {
  const pipeline = o.pipeline ?? runPipeline;
  const { config, library } = o;
  // Trois paramètres : BullMQ ne fournit le signal d'annulation qu'à un processeur qui le déclare.
  const processor = async (job: Job<CreationData, CreationResult>, _token?: string, signal?: AbortSignal): Promise<CreationResult> => {
    const { histoireId, composition, animation } = job.data;
    const folder = path.join(config.bibliotheque, histoireId);
    const log = (line: string) => {
      o.log(`[${histoireId}] ${line}`);
      job.log(line).catch(() => {});
    };
    const tracker = new ProgressTracker(plannedSteps(config, o.wan, animation), (p) => {
      job.updateProgress(p).catch(() => {});
    });
    try {
      await waitForServices(o, tracker, signal);
      const result = await pipeline({
        age: composition.age,
        composition,
        folder,
        model: config.modele,
        voice: 'estelle', // voix de Pocket TTS ; le serveur de voix du projet a déjà la sienne
        workflowPath: config.workflow ?? '',
        withVoice: config.tts !== null,
        withImage: Boolean(o.wan || config.workflow),
        outDir: config.bibliotheque,
        playerPath: config.lecteur,
        ollamaUrl: config.ollama,
        ttsUrls: config.tts ? [config.tts] : [],
        comfyUrl: config.comfy,
        waterline: 0.62,
        wan: o.wan ? { dir: o.wan.appDir, imageModel: config.wan.image, steps: config.wan.etapes, modelsDir: config.wan.modeles, animate: animation } : undefined,
        log,
        onProgress: (p) => tracker.update(p),
        signal,
      });
      tracker.stop();
      const meta = result.meta;
      // Après un arrêt brutal du serveur, la tâche reprend du début : l'histoire a pu être rangée entre-temps.
      if (library.get(histoireId)) library.remove(histoireId);
      library.add({
        id: histoireId,
        titre: meta.titre,
        accroche: meta.accroche,
        theme: meta.theme ?? composition.theme,
        age: meta.age,
        dureeSecondes: meta.dureeSecondes,
        motsCles: meta.motsCles,
        texte: meta.texte,
        composition: { ...composition },
        dossier: histoireId,
        image: meta.image ?? null,
        animation: meta.animation ?? null,
        page: meta.page,
      });
      log(`Prête : « ${meta.titre} » (${Math.round(result.seconds)} s de fabrication)`);
      return { histoireId, titre: meta.titre };
    } catch (err) {
      tracker.stop();
      if (signal?.aborted) {
        await rm(folder, { recursive: true, force: true });
        log('Annulée.');
        throw new UnrecoverableError(ANNULEE);
      }
      log(`Échec : ${(err as Error).message ?? err}`);
      throw err instanceof Error ? err : new Error(String(err));
    }
  };
  return new Worker<CreationData, CreationResult>(QUEUE, processor, {
    connection: { ...o.connection, maxRetriesPerRequest: null },
    concurrency: 1,
    lockDuration: 60_000,
    stalledInterval: 60_000,
    maxStalledCount: 1, // après un arrêt brutal, la fabrication reprend une fois du début
  });
}
