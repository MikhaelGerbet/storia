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
  model: string;
  voice: string;
  voiceSamplePath?: string;
  workflowPath: string;
  withVoice: boolean;
  withImage: boolean;
  outDir: string;
  playerPath: string;
  ollamaUrl: string;
  ttsUrl: string;
  comfyUrl: string;
  waterline: number;
  seed?: number;
  log: (message: string) => void;
}

export interface PipelineResult {
  folder: string;
  htmlPath: string;
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

async function readWorkflow(file: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new Error(`Workflow d'image introuvable : ${file}. Exporte-le depuis ComfyUI (voir le README du générateur), ou lance avec --sans-image.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Le workflow ${file} n'est pas un JSON valide.`);
  }
}

const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export async function runPipeline(o: PipelineOptions): Promise<PipelineResult> {
  const start = performance.now();
  const elapsed = () => `${((performance.now() - start) / 1000).toFixed(1)} s`;

  // On vérifie tout ce qui est local avant de solliciter les modèles.
  const template = await readFile(o.playerPath, 'utf8');
  const workflowRaw = o.withImage ? await readWorkflow(o.workflowPath) : null;
  const voiceSample = o.voiceSamplePath ? { bytes: await readFile(o.voiceSamplePath), name: path.basename(o.voiceSamplePath) } : undefined;

  o.log(`1/3 Écriture du texte avec ${o.model}…`);
  const written = await writeDraft({ url: o.ollamaUrl, model: o.model, age: o.age, idea: o.idea, unload: o.withImage, log: o.log });
  const arranged = arrangeEffects(written.segments);
  const draft = { ...written, segments: arranged.segments };
  const scene = toPlayerScene(draft, o.age);
  o.log(`    « ${scene.title} » : ${scene.segments.length} segments (${elapsed()})`);
  draft.segments.forEach((s, i) => o.log(`    ${i + 1}. ${s.texte}${s.effet === 'aucun' ? '' : `   [${s.effet}]`}`));
  arranged.notes.forEach((note) => o.log(`    · ${note}`));

  const prompt = imagePrompt(draft, o.age);
  o.log(`2/3 ${[o.withVoice && 'Voix', o.withImage && 'image'].filter(Boolean).join(' et ') || 'Rien à générer'}…`);
  const voicesTask = (async () => {
    if (!o.withVoice) return [] as Uint8Array[];
    const voices: Uint8Array[] = [];
    for (const segment of scene.segments) voices.push(await synthesize(segment.text, { url: o.ttsUrl, voice: o.voice, voiceSample }));
    const total = voices.reduce((sum, v) => sum + wavInfo(v).duration, 0);
    o.log(`    voix : ${voices.length} segments, ${total.toFixed(1)} s de parole (${elapsed()})`);
    return voices;
  })();
  const imageTask = (async () => {
    if (!workflowRaw) return null;
    const seed = o.seed ?? Math.floor(Math.random() * 2 ** 32);
    const image = await generateImage({ url: o.comfyUrl, workflow: prepareWorkflow(workflowRaw, prompt, seed) });
    o.log(`    image : graine ${seed} (${elapsed()})`);
    return image;
  })();
  const [voices, image] = await Promise.all([voicesTask, imageTask]);

  o.log('3/3 Assemblage…');
  const folder = path.join(o.outDir, `${timestamp()}-${slugify(scene.title)}`);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'scene.json'), `${JSON.stringify(scene, null, 2)}\n`);
  await writeFile(path.join(folder, 'prompt-image.txt'), `${prompt}\n`);
  if (voices.length) {
    await mkdir(path.join(folder, 'voix'), { recursive: true });
    await Promise.all(voices.map((v, i) => writeFile(path.join(folder, 'voix', `${String(i + 1).padStart(2, '0')}.wav`), v)));
  }
  if (image) await writeFile(path.join(folder, `image.${IMAGE_EXT[image.mime] ?? 'png'}`), image.bytes);

  const voiceCredit = !o.withVoice ? 'celle du navigateur' : voiceSample ? `Pocket TTS, imitée de ${voiceSample.name}` : `Pocket TTS, voix « ${o.voice} »`;
  const pkg: StoryPackage = {
    version: 1,
    scene,
    teaser: draft.accroche,
    audienceLabel: AGE_PROFILES[o.age].label,
    credits: `Texte : ${o.model} · Voix : ${voiceCredit} · Image : ${o.withImage ? 'ComfyUI' : 'illustration provisoire'}. Tout a été généré sur ton PC.`,
    effects: { waterline: o.waterline },
    image: image ? toDataUri(image.bytes, image.mime) : undefined,
    voices: voices.length ? voices.map((v) => toDataUri(v, 'audio/wav')) : undefined,
    createdAt: new Date().toISOString(),
  };
  const htmlPath = path.join(folder, 'index.html');
  await writeFile(htmlPath, buildPlayerHtml(template, pkg));
  return { folder, htmlPath, scene, seconds: (performance.now() - start) / 1000 };
}
