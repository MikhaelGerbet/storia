// Animation : Wan2GP (« Wan 2.2 » dans Pinokio), piloté sans son interface.
// `wgp.py --process réglages.json --output-dir dossier` génère sans ouvrir l'interface, puis s'arrête.
// Deux passages : l'image fixe (Z-Image Turbo par défaut), puis la boucle : Wan 2.2 anime l'image en
// partant d'elle et en revenant à elle (même image au début et à la fin), la vidéo tourne donc en boucle.
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface WanInstall {
  /** Dossier qui contient wgp.py (dans Pinokio : api/<appli>/app). */
  appDir: string;
  python: string;
  version: string;
  /** Modèles utiles déjà téléchargés (Wan 2.2 image vers vidéo, Z-Image) : autant de gigaoctets en moins à télécharger. */
  models: string[];
}

/** Fichiers des modèles dont on se sert, dans le dossier ckpts de Wan2GP, avec leur poids approximatif en Go. */
const MODEL_FILES: [string, RegExp, number][] = [
  ['Wan 2.2 image vers vidéo', /^wan2\.2_image2video_14B_/i, 30],
  ['Z-Image Turbo', /^ZImageTurbo/i, 11],
];
const savedGb = (x: WanInstall) => MODEL_FILES.filter(([name]) => x.models.includes(name)).reduce((sum, [, , gb]) => sum + gb, 0);

/** `--process` sait lire un fichier de réglages .json depuis la 9.82. */
export const MIN_VERSION = 9.82;

/** Accélérateurs « Lightning » de Wan 2.2 : 4 étapes au lieu de 30. Wan2GP les télécharge au premier usage. */
const LIGHTNING_LORAS = [
  'https://huggingface.co/DeepBeepMeep/Wan2.2/resolve/main/loras_accelerators/Wan2.2_I2V_A14B_HIGH_lightx2v_MoE_distill_lora_rank_64_bf16.safetensors',
  'https://huggingface.co/DeepBeepMeep/Wan2.2/resolve/main/loras_accelerators/Wan2.2_I2V_A14B_LOW_4steps_lora_rank64_Seko_V1_forKJ.safetensors',
];

const IMAGE_FILE = /\.(jpe?g|png|webp)$/i;
const VIDEO_FILE = /\.(mp4|webm|mkv|mov)$/i;
const forward = (p: string) => p.replace(/\\/g, '/');

function pythonOf(appDir: string): string | undefined {
  for (const rel of ['env/Scripts/python.exe', 'venv/Scripts/python.exe', 'env/bin/python', 'venv/bin/python']) {
    if (existsSync(path.join(appDir, rel))) return path.join(appDir, rel);
  }
  return undefined;
}

/** Les réglages de Wan2GP (wgp_config.json, à côté de wgp.py), ou undefined s'il n'a jamais été lancé. */
async function readWanConfig(appDir: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path.join(appDir, 'wgp_config.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Dossiers où Wan2GP range et cherche ses modèles (« Model Checkpoint Folders ») ; le premier reçoit les téléchargements. */
function checkpointRoots(appDir: string, config: Record<string, unknown> | undefined): string[] {
  const listed = Array.isArray(config?.checkpoints_paths) ? (config.checkpoints_paths as unknown[]).map(String).filter(Boolean) : [];
  return (listed.length ? listed : ['ckpts', '.']).map((p) => path.resolve(appDir, p));
}

async function describeInstall(dir: string): Promise<WanInstall | undefined> {
  const appDir = existsSync(path.join(dir, 'wgp.py')) ? dir : existsSync(path.join(dir, 'app', 'wgp.py')) ? path.join(dir, 'app') : undefined;
  if (!appDir) return undefined;
  const python = pythonOf(appDir);
  if (!python) return undefined;
  const version = /WanGP_version\s*=\s*["']([\d.]+)["']/.exec(await readFile(path.join(appDir, 'wgp.py'), 'utf8'))?.[1] ?? '0';
  const files: string[] = [];
  for (const root of checkpointRoots(appDir, await readWanConfig(appDir))) files.push(...(await readdir(root).catch(() => [] as string[])));
  const models = MODEL_FILES.filter(([, pattern]) => files.some((f) => pattern.test(f))).map(([name]) => name);
  return { appDir, python, version, models };
}

/** Trouve Wan2GP : le dossier donné, sinon, parmi les applications de Pinokio, celle qui a déjà nos modèles, puis la plus récente. */
export async function findWan(explicit?: string, homes: string[] = defaultPinokioHomes()): Promise<WanInstall> {
  const candidates: string[] = [];
  if (explicit) candidates.push(explicit);
  else {
    for (const home of homes) {
      try {
        for (const entry of await readdir(path.join(home, 'api'), { withFileTypes: true })) {
          if (entry.isDirectory()) candidates.push(path.join(home, 'api', entry.name));
        }
      } catch {
        // pas de Pinokio ici
      }
    }
  }
  const found = (await Promise.all(candidates.map(describeInstall))).filter((x): x is WanInstall => !!x);
  if (!found.length) {
    throw new Error(
      explicit
        ? `Wan2GP introuvable dans ${explicit} : donne le dossier de Wan dans Pinokio, celui qui contient wgp.py (par exemple C:/pinokio/api/wan2gp-amd.git/app).`
        : 'Wan2GP introuvable dans Pinokio. Donne son dossier avec --wan-dossier, par exemple C:/pinokio/api/wan2gp-amd.git/app.',
    );
  }
  const recent = (x: WanInstall) => Number.parseFloat(x.version) >= MIN_VERSION;
  const usable = found.filter(recent);
  if (!usable.length) {
    const newest = found.sort((a, b) => Number.parseFloat(b.version) - Number.parseFloat(a.version))[0];
    throw new Error(`Wan2GP ${newest.version} est trop ancien pour être piloté (version ${MIN_VERSION} au moins) : mets-le à jour dans Pinokio (« Update »).`);
  }
  // Chaque installation télécharge ses propres modèles : on évite d'en retélécharger des dizaines de gigaoctets.
  usable.sort((a, b) => savedGb(b) - savedGb(a) || Number.parseFloat(b.version) - Number.parseFloat(a.version));
  return usable[0];
}

function defaultPinokioHomes(): string[] {
  return [process.env.PINOKIO_HOME, 'C:/pinokio', 'D:/pinokio', path.join(os.homedir(), 'pinokio')].filter((x): x is string => !!x);
}

/**
 * Fait télécharger les modèles de Wan2GP dans `dir` (un autre disque, par exemple) : ce dossier devient le premier de
 * ses « Model Checkpoint Folders ». Les modèles déjà téléchargés restent trouvés là où ils sont. Renvoie false si
 * c'était déjà le cas. L'interface de Wan dans Pinokio prendra le réglage à son prochain démarrage.
 */
export async function useModelsFolder(install: WanInstall, dir: string): Promise<boolean> {
  const configPath = path.join(install.appDir, 'wgp_config.json');
  const config = await readWanConfig(install.appDir);
  if (!config) throw new Error(`Réglages de Wan2GP introuvables (${configPath}) : lance Wan une fois dans Pinokio, puis réessaie.`);
  const target = forward(path.resolve(dir));
  const same = (p: string) => forward(path.resolve(install.appDir, p)).toLowerCase() === target.toLowerCase();
  const current = Array.isArray(config.checkpoints_paths) && config.checkpoints_paths.length ? (config.checkpoints_paths as unknown[]).map(String) : ['ckpts', '.'];
  await mkdir(dir, { recursive: true });
  if (same(current[0])) return false;
  config.checkpoints_paths = [target, ...current.filter((p) => !same(p))];
  const temporary = `${configPath}.storia`;
  await writeFile(temporary, JSON.stringify(config, null, 4));
  await rename(temporary, configPath); // jamais de fichier de réglages à moitié écrit
  return true;
}

/** Réglages de l'image fixe : format paysage, comme la vidéo qui en partira. */
export function stillSettings(o: { prompt: string; seed: number; model: string }): Record<string, unknown> {
  const settings: Record<string, unknown> = { model_type: o.model, prompt: o.prompt, resolution: '1280x720', seed: o.seed };
  if (o.model === 'z_image') Object.assign(settings, { num_inference_steps: 8, guidance_scale: 0 });
  if (o.model.startsWith('t2v')) settings.image_mode = 1; // Wan 2.2 en mode « texte vers image »
  return settings;
}

/** Réglages de la boucle : Wan 2.2 image vers vidéo, 81 images (5 s), même image au début et à la fin. */
export function loopSettings(o: { prompt: string; image: string; seed: number; steps: number }): Record<string, unknown> {
  const image = forward(o.image);
  const settings: Record<string, unknown> = {
    model_type: 'i2v_2_2',
    prompt: o.prompt,
    resolution: '832x480',
    video_length: 81,
    seed: o.seed,
    num_inference_steps: o.steps,
    image_prompt_type: 'SE', // S : image de départ, E : image de fin. Sans E, Wan2GP ignore l'image de fin.
    image_start: image,
    image_end: image,
  };
  if (o.steps <= 8) {
    Object.assign(settings, {
      guidance_phases: 2,
      model_switch_phase: 1,
      switch_threshold: 876,
      guidance_scale: 1,
      guidance2_scale: 1,
      flow_shift: 5,
      sample_solver: 'euler',
      loras_multipliers: '1;0 0;1',
      activated_loras: LIGHTNING_LORAS,
    });
  }
  return settings;
}

/** Variables d'environnement de Pinokio, pour retrouver ses téléchargements, et réglage AMD. */
function wanEnv(appDir: string): NodeJS.ProcessEnv {
  // Sans PYTHONUNBUFFERED, Python garde ses messages en mémoire quand on les lit par un tuyau : ils se perdent s'il plante.
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' };
  env.MIOPEN_FIND_MODE ??= 'FAST'; // cartes AMD : évite une longue recherche de calculs à chaque nouvelle taille
  const home = path.resolve(appDir, '..', '..', '..');
  for (const key of ['HF_HOME', 'TORCH_HOME']) {
    const dir = path.join(home, 'cache', key);
    if (!env[key] && existsSync(dir)) env[key] = dir;
  }
  return env;
}

export interface WanRun {
  install: WanInstall;
  /** Dossier de travail : réglages et résultats de chaque passage. */
  jobDir: string;
  /** Affiche la progression de Wan2GP dans ce terminal (sinon, elle est ignorée). */
  echo?: boolean;
  log?: (message: string) => void;
  /** Temps laissé à Wan2GP pour s'arrêter seul une fois sa file terminée (20 s par défaut). */
  graceMs?: number;
  /** Silence au-delà duquel Wan2GP est considéré comme bloqué (30 minutes par défaut). */
  silenceMs?: number;
}

/** Lance un passage de Wan2GP et renvoie le fichier produit. */
export async function runWan(run: WanRun, name: string, settings: Record<string, unknown>, want: 'image' | 'video'): Promise<string> {
  const outDir = path.join(run.jobDir, name);
  await mkdir(outDir, { recursive: true });
  const settingsPath = path.join(run.jobDir, `${name}.json`);
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  const started = Date.now();
  // Tout ce qu'affiche Wan2GP est aussi gardé dans un journal, et ses dernières lignes en mémoire pour un message d'erreur.
  const logPath = path.join(run.jobDir, `${name}.log`);
  const logFile = createWriteStream(logPath);
  let recent = '';
  const { code, stopped } = await new Promise<{ code: number | null; stopped: 'fini' | 'muet' | null }>((resolve, reject) => {
    const child = spawn(run.install.python, ['wgp.py', '--process', forward(settingsPath), '--output-dir', forward(outDir), '--attention', 'sdpa'], {
      cwd: run.install.appDir, // wgp.py lit ses réglages par défaut à partir de son dossier
      env: wanEnv(run.install.appDir),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stopped: 'fini' | 'muet' | null = null;
    let tail = '';
    let grace: NodeJS.Timeout | undefined;
    let silence: NodeJS.Timeout | undefined;
    const stop = (why: 'fini' | 'muet') => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      stopped = why;
      child.kill();
    };
    const alive = () => {
      clearTimeout(silence);
      silence = setTimeout(() => stop('muet'), run.silenceMs ?? 30 * 60_000);
    };
    const onData = (chunk: Buffer, out: NodeJS.WriteStream) => {
      if (run.echo) out.write(chunk);
      logFile.write(chunk);
      alive();
      recent = (recent + chunk.toString('utf8')).slice(-6000);
      tail = (tail + chunk.toString('utf8')).slice(-500);
      // Sous Windows avec une carte AMD, un processus PyTorch peut rester bloqué au moment de quitter
      // (pytorch/pytorch#160759) : une fois la file terminée, on lui laisse un moment, puis on l'arrête.
      if (!grace && /Queue completed/.test(tail)) grace = setTimeout(() => stop('fini'), run.graceMs ?? 20_000);
    };
    child.stdout.on('data', (chunk: Buffer) => onData(chunk, process.stdout));
    child.stderr.on('data', (chunk: Buffer) => onData(chunk, process.stderr));
    alive();
    // Ctrl+C : Wan2GP s'arrête avec le générateur, sans rester en arrière-plan à occuper la carte graphique.
    const interrupt = () => {
      child.kill();
      process.exit(130);
    };
    process.on('SIGINT', interrupt);
    const done = () => {
      clearTimeout(grace);
      clearTimeout(silence);
      process.off('SIGINT', interrupt);
    };
    child.on('error', (err) => {
      done();
      reject(new Error(`Impossible de lancer Wan2GP (${run.install.python}) : ${err.message}`));
    });
    child.on('close', (exitCode) => {
      done();
      resolve({ code: exitCode, stopped });
    });
  });
  await new Promise((resolve) => logFile.end(resolve));
  // Sous Windows, un code négatif apparaît comme un grand nombre : 4294967295 pour -1.
  const shownCode = code !== null && code > 0x7fffffff ? code - 0x100000000 : code;
  const lastLines = recent.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean).slice(-12);
  const lastWords = lastLines.length
    ? `Ses derniers messages :\n${lastLines.map((l) => `      ${l}`).join('\n')}\n`
    : "Il n'a rien affiché : il s'est sans doute arrêté brutalement (plantage, mémoire épuisée).\n";
  if (stopped === 'fini') run.log?.("    (Wan2GP avait fini mais ne s'arrêtait pas, un défaut connu de PyTorch pour AMD sous Windows : arrêté.)");
  if (stopped === 'muet') {
    throw new Error(`Wan2GP n'a plus rien affiché pendant ${Math.round((run.silenceMs ?? 30 * 60_000) / 60_000)} minutes : il semblait bloqué, il a été arrêté. ${lastWords}Journal complet : ${logPath}`);
  }
  // Un code 0 ne prouve rien : une tâche refusée ou une mise à jour manquante s'arrêtent aussi sans erreur.
  const pattern = want === 'image' ? IMAGE_FILE : VIDEO_FILE;
  const files = [];
  for (const file of await readdir(outDir)) {
    if (!pattern.test(file)) continue;
    const info = await stat(path.join(outDir, file));
    if (info.mtimeMs >= started - 2000) files.push({ file, time: info.mtimeMs });
  }
  if (!files.length) {
    throw new Error(
      `Wan2GP s'est arrêté (code ${shownCode}) sans produire ${want === 'image' ? "d'image" : 'de vidéo'}. ${lastWords}` +
        `Journal complet : ${logPath}\nRéglages envoyés : ${settingsPath}`,
    );
  }
  files.sort((a, b) => b.time - a.time);
  return path.join(outDir, files[0].file);
}
