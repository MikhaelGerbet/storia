// La chaîne complète : texte, puis voix et image en parallèle, puis assemblage.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateImage, prepareWorkflow } from './comfy.ts';
import { writeDraft } from './ollama.ts';
import { buildPlayerHtml, toDataUri } from './package.ts';
import type { StoryPackage } from './package.ts';
import { AGE_PROFILES, arrangeEffects, imagePrompt, toPlayerScene } from './scene.ts';
import type { AgeBand, PlayerScene } from './scene.ts';
import { synthesize } from './tts.ts';
import { wavInfo } from './wav.ts';

export interface PipelineOptions {
  age: AgeBand;
  idea?: string;
  /** Reprend le texte et les repères d'une scène déjà écrite (scene.json) au lieu d'appeler Ollama. */
  sceneFile?: string;
  model: string;
  voice: string;
  voiceSamplePath?: string;
  workflowPath: string;
  withVoice: boolean;
  withImage: boolean;
  outDir: string;
  playerPath: string;
  ollamaUrl: string;
  /** Un serveur de voix, ou plusieurs pour les comparer à l'aveugle sur le même texte. */
  ttsUrls: string[];
  comfyUrl: string;
  waterline: number;
  seed?: number;
  log: (message: string) => void;
}

export interface PipelineResult {
  folder: string;
  /** Une page par voix comparée, sinon une seule. */
  htmlPaths: string[];
  scene: PlayerScene;
  seconds: number;
}

export function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug || 'histoire';
}

function timestamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}h${pad(d.getMinutes())}m${pad(d.getSeconds())}`;
}

async function readJsonFile(file: string, missing: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new Error(missing);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${file} n'est pas un JSON valide.`);
  }
}

async function readScene(file: string): Promise<PlayerScene> {
  const raw = (await readJsonFile(file, `Scène introuvable : ${file}`)) as Partial<PlayerScene> | null;
  const valid =
    raw &&
    typeof raw.title === 'string' &&
    Array.isArray(raw.segments) &&
    raw.segments.length > 0 &&
    raw.segments.every((s) => typeof s?.text === 'string' && typeof s?.pause === 'number') &&
    Array.isArray(raw.cues);
  if (!valid) throw new Error(`${file} n'a pas la forme d'une scène (title, segments, cues).`);
  return { audience: '', intro: 1.8, ...raw } as PlayerScene;
}

/** Ordre aléatoire, pour que la lettre d'une voix ne trahisse pas son moteur. */
function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const LETTERS = 'ABCDEFGH';

export async function runPipeline(o: PipelineOptions): Promise<PipelineResult> {
  const start = performance.now();
  const elapsed = () => `${((performance.now() - start) / 1000).toFixed(1)} s`;
  if (o.withVoice && o.ttsUrls.length > LETTERS.length) throw new Error(`Au plus ${LETTERS.length} voix à comparer.`);

  // On vérifie tout ce qui est local avant de solliciter les modèles.
  const template = await readFile(o.playerPath, 'utf8');
  const workflowRaw = o.withImage
    ? await readJsonFile(o.workflowPath, `Workflow d'image introuvable : ${o.workflowPath}. Exporte-le depuis ComfyUI (voir le README du générateur), ou lance avec --sans-image.`)
    : null;
  const voiceSample = o.voiceSamplePath ? { bytes: await readFile(o.voiceSamplePath), name: path.basename(o.voiceSamplePath) } : undefined;

  let scene: PlayerScene;
  let teaser = '';
  let prompt: string;
  if (o.sceneFile) {
    scene = await readScene(o.sceneFile);
    prompt = imagePrompt({ titre: scene.title, accroche: '', segments: [], decor_en: '' }, o.age);
    o.log(`1/3 Texte repris de ${path.basename(o.sceneFile)} : « ${scene.title} », ${scene.segments.length} segments`);
  } else {
    o.log(`1/3 Écriture du texte avec ${o.model}…`);
    const written = await writeDraft({ url: o.ollamaUrl, model: o.model, age: o.age, idea: o.idea, unload: o.withImage, log: o.log });
    const arranged = arrangeEffects(written.segments);
    const draft = { ...written, segments: arranged.segments };
    scene = toPlayerScene(draft, o.age);
    teaser = draft.accroche;
    prompt = imagePrompt(draft, o.age);
    o.log(`    « ${scene.title} » : ${scene.segments.length} segments (${elapsed()})`);
    draft.segments.forEach((s, i) => o.log(`    ${i + 1}. ${s.texte}${s.effet === 'aucun' ? '' : `   [${s.effet}]`}`));
    arranged.notes.forEach((note) => o.log(`    · ${note}`));
  }

  const ttsUrls = o.withVoice ? o.ttsUrls : [];
  o.log(`2/3 ${[ttsUrls.length > 1 ? `${ttsUrls.length} voix` : ttsUrls.length && 'Voix', o.withImage && 'image'].filter(Boolean).join(' et ') || 'Rien à générer'}…`);
  const voicesTask = (async () => {
    const sets: Uint8Array[][] = [];
    for (const url of ttsUrls) {
      const voices: Uint8Array[] = [];
      for (const segment of scene.segments) voices.push(await synthesize(segment.text, { url, voice: o.voice, voiceSample }));
      const total = voices.reduce((sum, v) => sum + wavInfo(v).duration, 0);
      o.log(`    voix ${url} : ${total.toFixed(1)} s de parole (${elapsed()})`);
      sets.push(voices);
    }
    return sets;
  })();
  const imageTask = (async () => {
    if (!workflowRaw) return null;
    const seed = o.seed ?? Math.floor(Math.random() * 2 ** 32);
    const image = await generateImage({ url: o.comfyUrl, workflow: prepareWorkflow(workflowRaw, prompt, seed) });
    o.log(`    image : graine ${seed} (${elapsed()})`);
    return image;
  })();
  const [voiceSets, image] = await Promise.all([voicesTask, imageTask]);

  o.log('3/3 Assemblage…');
  const comparing = voiceSets.length > 1;
  const folder = path.join(o.outDir, `${timestamp()}-${slugify(scene.title)}${comparing ? '-comparaison' : ''}`);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'scene.json'), `${JSON.stringify(scene, null, 2)}\n`);
  await writeFile(path.join(folder, 'prompt-image.txt'), `${prompt}\n`);
  if (image) await writeFile(path.join(folder, `image.${IMAGE_EXT[image.mime] ?? 'png'}`), image.bytes);
  const imageUri = image ? toDataUri(image.bytes, image.mime) : undefined;

  const voiceCredit = !o.withVoice ? 'celle du navigateur' : voiceSample ? `imitée de ${voiceSample.name}` : `« ${o.voice} »`;
  const page = (voices: Uint8Array[], credits: string): StoryPackage => ({
    version: 1,
    scene,
    teaser,
    audienceLabel: AGE_PROFILES[o.age].label,
    credits,
    effects: { waterline: o.waterline },
    image: imageUri,
    voices: voices.length ? voices.map((v) => toDataUri(v, 'audio/wav')) : undefined,
    createdAt: new Date().toISOString(),
  });
  const imageCredit = o.withImage ? 'ComfyUI' : 'illustration provisoire';
  const textCredit = o.sceneFile ? path.basename(o.sceneFile) : o.model;

  const htmlPaths: string[] = [];
  if (!comparing) {
    const voices = voiceSets[0] ?? [];
    if (voices.length) {
      await mkdir(path.join(folder, 'voix'), { recursive: true });
      await Promise.all(voices.map((v, i) => writeFile(path.join(folder, 'voix', `${String(i + 1).padStart(2, '0')}.wav`), v)));
    }
    const htmlPath = path.join(folder, 'index.html');
    const credits = `Texte : ${textCredit} · Voix : ${voices.length ? voiceCredit : 'celle du navigateur'} · Image : ${imageCredit}. Tout a été généré sur ton PC.`;
    await writeFile(htmlPath, buildPlayerHtml(template, page(voices, credits)));
    htmlPaths.push(htmlPath);
  } else {
    // Comparaison à l'aveugle : la lettre de chaque page est tirée au sort, la correspondance est à part.
    const order = shuffled(voiceSets.map((voices, i) => ({ voices, url: ttsUrls[i] })));
    const mapping: string[] = [];
    for (const [i, { voices, url }] of order.entries()) {
      const letter = LETTERS[i];
      await mkdir(path.join(folder, 'voix', letter), { recursive: true });
      await Promise.all(voices.map((v, k) => writeFile(path.join(folder, 'voix', letter, `${String(k + 1).padStart(2, '0')}.wav`), v)));
      const htmlPath = path.join(folder, `voix-${letter}.html`);
      await writeFile(htmlPath, buildPlayerHtml(template, page(voices, `Comparaison à l'aveugle : voix ${letter}. Texte : ${textCredit} · Image : ${imageCredit}.`)));
      htmlPaths.push(htmlPath);
      mapping.push(`Voix ${letter} : ${url}`);
    }
    await writeFile(path.join(folder, 'correspondance.txt'), `${mapping.join('\n')}\n`);
  }
  return { folder, htmlPaths, scene, seconds: (performance.now() - start) / 1000 };
}
