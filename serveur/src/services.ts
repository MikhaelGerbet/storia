// Les services dont le studio a besoin, et leur état : Redis, Ollama, le serveur de voix, l'image.
import { gardienState } from '../../gardien/src/client.ts';
import type { WanInstall } from '../../generator/src/wan.ts';
import { splitVoiceUrl } from '../../generator/src/tts.ts';
import type { Config } from './config.ts';

export interface ServiceState {
  ok: boolean;
  detail: string;
}

export interface Health {
  file: ServiceState;
  texte: ServiceState;
  /** null : la voix du navigateur (--sans-voix). */
  voix: ServiceState | null;
  image: ServiceState & { moteur: 'wan' | 'comfy' | null; animation: boolean };
  /** La carte graphique selon le gardien ; null : Storia ne la réserve pas. */
  carte: ServiceState | null;
  travailleur: boolean;
}

/** Ce que le studio sait faire, d'après ses réglages et ce qu'il a trouvé au démarrage. */
export interface Abilities {
  voix: boolean;
  image: 'wan' | 'comfy' | null;
  animation: boolean;
}

export function abilities(config: Config, wan: WanInstall | null): Abilities {
  const image = wan ? 'wan' : config.workflow ? 'comfy' : null;
  return { voix: config.tts !== null, image, animation: image === 'wan' };
}

/** Joint un service. Une réponse HTTP, même une erreur, prouve qu'il tourne ; seule l'absence de réponse compte. */
async function probe(url: string, timeoutMs: number): Promise<Response | null> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return null;
  }
}

export async function checkOllama(url: string, model: string, timeoutMs = 2500): Promise<ServiceState & { modeleManquant?: boolean }> {
  const res = await probe(`${url}/api/tags`, timeoutMs);
  if (!res) return { ok: false, detail: `Ollama ne répond pas (${url}) : lance Ollama.` };
  const tags = (await res.json().catch(() => ({}))) as { models?: { name?: string }[] };
  const names = (tags.models ?? []).map((m) => m.name ?? '');
  if (!names.some((n) => n === model || n === `${model}:latest`)) {
    return { ok: false, modeleManquant: true, detail: `Le modèle ${model} n'est pas installé dans Ollama. Installe-le avec : ollama pull ${model}` };
  }
  return { ok: true, detail: `Ollama, modèle ${model}` };
}

export async function checkVoice(url: string, timeoutMs = 2500): Promise<ServiceState> {
  const { base } = splitVoiceUrl(url);
  const res = await probe(`${base}/health`, timeoutMs);
  if (!res) return { ok: false, detail: `Le serveur de voix ne répond pas (${base}) : lance-le, puis attends « Voix prête ».` };
  const health = (await res.json().catch(() => ({}))) as { moteur?: string };
  return { ok: true, detail: health.moteur ? `Voix ${health.moteur}` : 'Voix prête' };
}

export async function checkGpu(url: string): Promise<ServiceState> {
  const state = await gardienState(url);
  if (!state) return { ok: false, detail: `Le gardien de la carte graphique ne répond pas (${url}) : lance-le (voir gardien/README.md).` };
  const { carte } = state;
  if (carte.pause) return { ok: true, detail: carte.pause.raison === 'jeu' ? `Mode jeu (${carte.pause.detail}) : les histoires attendent la fin de la partie.` : 'Mode jeu : les histoires attendent.' };
  return { ok: true, detail: carte.detenteur ? `Carte graphique utilisée par ${carte.detenteur.client}` : 'Carte graphique libre' };
}

export async function checkImage(config: Config, wan: WanInstall | null): Promise<Health['image']> {
  if (wan) {
    const animation = { ok: true, moteur: 'wan' as const, animation: true };
    return { ...animation, detail: `Wan2GP ${wan.version}${wan.models.length ? ` (${wan.models.join(', ')})` : ', modèles à télécharger au premier usage'}` };
  }
  if (config.workflow) {
    const res = await probe(`${config.comfy}/system_stats`, 2500);
    return res
      ? { ok: true, moteur: 'comfy', animation: false, detail: 'ComfyUI' }
      : { ok: false, moteur: 'comfy', animation: false, detail: `ComfyUI ne répond pas (${config.comfy}) : lance-le.` };
  }
  return { ok: true, moteur: null, animation: false, detail: "Pas d'illustration : chaque histoire a le ciel de son thème." };
}
