// La chaîne complète : texte, puis voix et image en parallèle, puis assemblage.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateImage, prepareWorkflow } from './comfy.ts';
import { writeDraft } from './ollama.ts';
import { buildPlayerHtml, toDataUri } from './package.ts';
import type { StoryPackage } from './package.ts';
import { AGE_PROFILES, arrangeEffects, imagePrompt, loopPrompt, toPlayerScene } from './scene.ts';
import type { AgeBand, PlayerScene } from './scene.ts';
import { NarrationUnsupported, narrate, releaseVoice, synthesize } from './tts.ts';
import { findWan, loopSettings, runWan, stillSettings } from './wan.ts';
import type { NarrationEvent } from './tts.ts';
import { wavInfo } from './wav.ts';

export interface WanOptions {
  /** Dossier de Wan2GP, celui qui contient wgp.py. Sinon, cherché dans Pinokio. */
  dir?: string;
  /** Modèle de l'image fixe dans Wan2GP (z_image par défaut). */
  imageModel: string;
  /** Étapes de l'animation : 4 avec les accélérateurs Lightning, 30 pour la qualité d'origine. */
  steps: number;
  /** Affiche la progression de Wan2GP dans le terminal. */
  echo?: boolean;
}

export interface PipelineOptions {
  age: AgeBand;
  idea?: string;
  /** Reprend le texte et les repères d'une scène déjà écrite (scene.json) au lieu d'appeler Ollama. */
  sceneFile?: string;
  model: string;
  voice: string;
  voiceSamplePath?: string;
  workflowPath: string;
  /** Image déjà faite (par exemple avec Wan 2.2) : remplace celle de ComfyUI. */
  imagePath?: string;
  /** Animation en boucle déjà faite (MP4 ou WebM), jouée à la place de l'image. */
  videoPath?: string;
  /** Image puis animation en boucle fabriquées par Wan2GP (Wan 2.2 dans Pinokio). */
  wan?: WanOptions;
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
const MIME_OF: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm' };

async function readMedia(file: string, kind: 'image' | 'video'): Promise<{ bytes: Uint8Array; mime: string; name: string }> {
  const mime = MIME_OF[path.extname(file).toLowerCase()];
  if (!mime?.startsWith(kind)) {
    throw new Error(kind === 'image' ? `Image non reconnue : ${file}. Formats possibles : PNG, JPG, WebP.` : `Animation non reconnue : ${file}. Formats possibles : MP4, WebM.`);
  }
  try {
    return { bytes: await readFile(file), mime, name: path.basename(file) };
  } catch {
    throw new Error(`${kind === 'image' ? 'Image' : 'Animation'} introuvable : ${file}`);
  }
}
const LETTERS = 'ABCDEFGH';

/** Une voix pour toute la scène : un WAV par segment, les pauses recalées sur sa lecture, et son bilan. */
interface VoiceSet {
  voices: Uint8Array[];
  pauses: number[];
  report: NarrationEvent[];
}

const duration = (seconds: number) => (seconds < 60 ? `${seconds.toFixed(1)} s` : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`);

function describeEvent(event: NarrationEvent): string[] {
  if (event.type === 'debut') return [`${event.phrases} phrase${(event.phrases ?? 0) > 1 ? 's' : ''} à lire, chacune d'un seul souffle${event.relecture ? `, relues par ${event.relecture}` : ''}`];
  const details = [`${event.parole} s de parole`];
  if ((event.essais ?? 1) > 1) details.push(`${event.essais} lectures`);
  if (event.ressemblance != null) details.push(`relue à ${Math.round(event.ressemblance * 100)} %`);
  const lines = [`phrase ${event.numero}/${event.total} lue en ${duration(event.secondes ?? 0)} (${details.join(', ')})`];
  if (event.alerte) lines.push(`  attention : ${event.alerte}`);
  return lines;
}

export async function runPipeline(o: PipelineOptions): Promise<PipelineResult> {
  const start = performance.now();
  const elapsed = () => `${((performance.now() - start) / 1000).toFixed(1)} s`;
  if (o.withVoice && o.ttsUrls.length > LETTERS.length) throw new Error(`Au plus ${LETTERS.length} voix à comparer.`);

  // On vérifie tout ce qui est local avant de solliciter les modèles.
  if (o.wan && o.videoPath) throw new Error("--wan fabrique l'animation : retire --animation, ou retire --wan pour garder la tienne.");
  if (o.wan && !o.withImage) throw new Error("--wan fabrique l'image puis l'anime : retire --sans-image.");
  const template = await readFile(o.playerPath, 'utf8');
  const givenImage = o.imagePath ? await readMedia(o.imagePath, 'image') : undefined;
  let video = o.videoPath ? await readMedia(o.videoPath, 'video') : undefined;
  if (video && video.bytes.length > 60_000_000) o.log(`Attention : l'animation pèse ${Math.round(video.bytes.length / 1e6)} Mo, la page sera lourde à ouvrir.`);
  const wan = o.wan ? await findWan(o.wan.dir) : undefined;
  if (wan) o.log(`Wan2GP ${wan.version} : ${wan.appDir}`);
  const workflowRaw = o.withImage && !givenImage && !wan
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
  const comparing = ttsUrls.length > 1;
  const folder = path.join(o.outDir, `${timestamp()}-${slugify(scene.title)}${comparing ? '-comparaison' : ''}`);
  await mkdir(folder, { recursive: true });
  const media = [comparing ? `${ttsUrls.length} voix` : ttsUrls.length ? 'voix' : '', o.withImage && !wan ? 'image' : ''].filter(Boolean).join(' et ');
  const wanStep = wan ? `${givenImage ? 'animation' : 'image et animation'} avec Wan 2.2` : '';
  const step = [media, wanStep].filter(Boolean).join(', puis ') || 'rien à générer';
  o.log(`2/3 ${step[0].toUpperCase()}${step.slice(1)}…`);
  const voicesTask = (async () => {
    const sets: VoiceSet[] = [];
    const n = scene.segments.length;
    for (const url of ttsUrls) {
      const tag = `    voix${ttsUrls.length > 1 ? ` ${url}` : ''} : `;
      let set: VoiceSet | undefined;
      try {
        // Toute la scène d'un coup : le serveur lit chaque phrase d'un seul souffle et vérifie chaque lecture.
        const told = await narrate(
          scene.segments.map((s) => ({ text: s.text, pause: s.pause })),
          { url, voice: o.voice, voiceSample, onEvent: (event) => describeEvent(event).forEach((line) => o.log(tag + line)) },
        );
        set = { voices: told.clips, pauses: told.pauses, report: told.report };
      } catch (err) {
        if (!(err instanceof NarrationUnsupported)) throw err;
      }
      if (!set) {
        // Serveur qui ne lit que phrase par phrase (Pocket TTS) : un segment après l'autre.
        const voices: Uint8Array[] = [];
        for (const [i, segment] of scene.segments.entries()) {
          const begun = performance.now();
          const voice = await synthesize(segment.text, { url, voice: o.voice, voiceSample });
          voices.push(voice);
          o.log(`${tag}phrase ${i + 1}/${n} lue en ${duration((performance.now() - begun) / 1000)} (${wavInfo(voice).duration.toFixed(1)} s de parole)`);
        }
        set = { voices, pauses: scene.segments.map((s) => s.pause), report: [] };
      }
      const total = set.voices.reduce((sum, v) => sum + wavInfo(v).duration, 0);
      const doubtful = set.report.filter((e) => e.alerte).length;
      o.log(`${tag}terminée, ${total.toFixed(1)} s de parole (${elapsed()})${doubtful ? `. Attention : ${doubtful} phrase${doubtful > 1 ? 's' : ''} douteuse${doubtful > 1 ? 's' : ''}, écoute-les (voix/rapport.json)` : ''}`);
      sets.push(set);
    }
    return sets;
  })();
  const imageTask = (async () => {
    if (givenImage) return givenImage;
    if (!workflowRaw) return null;
    const seed = o.seed ?? Math.floor(Math.random() * 2 ** 32);
    const image = await generateImage({ url: o.comfyUrl, workflow: prepareWorkflow(workflowRaw, prompt, seed) });
    o.log(`    image : graine ${seed} (${elapsed()})`);
    return image;
  })();
  const [voiceSets, made] = await Promise.all([voicesTask, imageTask]);
  let image = made;

  const motion = loopPrompt(o.age);
  if (wan && o.wan) {
    // La carte graphique passe à Wan : le serveur de voix libère d'abord la sienne (il la reprendra au besoin).
    await Promise.all(ttsUrls.map((url) => releaseVoice(url)));
    const run = { install: wan, jobDir: path.join(folder, 'wan'), echo: o.wan.echo };
    const seed = o.seed ?? Math.floor(Math.random() * 2 ** 31);
    let still = o.imagePath;
    if (!still) {
      o.log(`    image : ${o.wan.imageModel} dans Wan2GP, graine ${seed}…`);
      still = await runWan(run, 'image', stillSettings({ prompt, seed, model: o.wan.imageModel }), 'image');
      image = await readMedia(still, 'image');
      o.log(`    image : prête (${elapsed()})`);
    }
    o.log(`    animation : Wan 2.2, ${o.wan.steps} étapes, boucle de 5 secondes. Compte plusieurs minutes…`);
    video = await readMedia(await runWan(run, 'animation', loopSettings({ prompt: motion, image: still, seed, steps: o.wan.steps }), 'video'), 'video');
    o.log(`    animation : prête (${elapsed()})`);
  }

  o.log('3/3 Assemblage…');
  await writeFile(path.join(folder, 'scene.json'), `${JSON.stringify(scene, null, 2)}\n`);
  await writeFile(path.join(folder, 'prompt-image.txt'), `${prompt}\n`);
  if (wan) await writeFile(path.join(folder, 'prompt-animation.txt'), `${motion}\n`);
  if (image) await writeFile(path.join(folder, `image.${IMAGE_EXT[image.mime] ?? 'png'}`), image.bytes);
  const imageUri = image ? toDataUri(image.bytes, image.mime) : undefined;
  if (video) await writeFile(path.join(folder, `animation${path.extname(video.name).toLowerCase()}`), video.bytes);
  const videoUri = video ? toDataUri(video.bytes, video.mime) : undefined;

  const voiceCredit = !o.withVoice ? 'celle du navigateur' : voiceSample ? `imitée de ${voiceSample.name}` : `« ${o.voice} »`;
  const page = (set: VoiceSet | undefined, credits: string): StoryPackage => ({
    version: 1,
    // Les pauses suivent la lecture de cette voix-là : chaque page a les siennes.
    scene: set ? { ...scene, segments: scene.segments.map((s, i) => ({ ...s, pause: set.pauses[i] ?? s.pause })) } : scene,
    teaser,
    audienceLabel: AGE_PROFILES[o.age].label,
    credits,
    effects: { waterline: o.waterline },
    image: imageUri,
    video: videoUri,
    voices: set?.voices.length ? set.voices.map((v) => toDataUri(v, 'audio/wav')) : undefined,
    createdAt: new Date().toISOString(),
  });
  const imageCredit = wan
    ? `${givenImage ? givenImage.name : o.wan?.imageModel}, animée par Wan 2.2`
    : video
      ? `animation ${video.name}`
      : givenImage
        ? givenImage.name
        : o.withImage
          ? 'ComfyUI'
          : 'illustration provisoire';
  const textCredit = o.sceneFile ? path.basename(o.sceneFile) : o.model;

  const saveVoice = async (set: VoiceSet, dir: string) => {
    await mkdir(dir, { recursive: true });
    await Promise.all(set.voices.map((v, i) => writeFile(path.join(dir, `${String(i + 1).padStart(2, '0')}.wav`), v)));
    if (set.report.length) await writeFile(path.join(dir, 'rapport.json'), `${JSON.stringify(set.report, null, 2)}\n`);
  };
  const htmlPaths: string[] = [];
  if (!comparing) {
    const set = voiceSets[0];
    if (set) await saveVoice(set, path.join(folder, 'voix'));
    const htmlPath = path.join(folder, 'index.html');
    const credits = `Texte : ${textCredit} · Voix : ${set ? voiceCredit : 'celle du navigateur'} · Image : ${imageCredit}. Tout a été généré sur ton PC.`;
    await writeFile(htmlPath, buildPlayerHtml(template, page(set, credits)));
    htmlPaths.push(htmlPath);
  } else {
    // Comparaison à l'aveugle : la lettre de chaque page est tirée au sort, la correspondance est à part.
    const order = shuffled(voiceSets.map((set, i) => ({ set, url: ttsUrls[i] })));
    const mapping: string[] = [];
    for (const [i, { set, url }] of order.entries()) {
      const letter = LETTERS[i];
      await saveVoice(set, path.join(folder, 'voix', letter));
      const htmlPath = path.join(folder, `voix-${letter}.html`);
      await writeFile(htmlPath, buildPlayerHtml(template, page(set, `Comparaison à l'aveugle : voix ${letter}. Texte : ${textCredit} · Image : ${imageCredit}.`)));
      htmlPaths.push(htmlPath);
      mapping.push(`Voix ${letter} : ${url}`);
    }
    await writeFile(path.join(folder, 'correspondance.txt'), `${mapping.join('\n')}\n`);
  }
  return { folder, htmlPaths, scene, seconds: (performance.now() - start) / 1000 };
}
