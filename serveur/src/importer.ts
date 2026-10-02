// Range dans la bibliothèque les histoires déjà fabriquées par le générateur :
//   npm run importer                      (generator/sorties)
//   npm run importer -- <dossier> [<dossier>…]
import { cp, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { findTheme } from '../../generator/src/catalogue.ts';
import type { StoryMeta } from '../../generator/src/pipeline.ts';
import { slugify } from '../../generator/src/pipeline.ts';
import { AGE_BANDS, AGE_PROFILES } from '../../generator/src/scene.ts';
import type { AgeBand, PlayerScene } from '../../generator/src/scene.ts';
import { wavInfo } from '../../generator/src/wav.ts';
import { Library } from './bibliotheque.ts';
import type { NewStory } from './bibliotheque.ts';
import { ROOT_DIR, SERVEUR_DIR } from './config.ts';

const PAGE = /^(index|voix-[A-H])\.html$/;
const SMALL_WORDS = new Set(['dans', 'avec', 'pour', 'sous', 'sur', 'des', 'les', 'une', 'qui', 'que', 'aux', 'du', 'de', 'la', 'le', 'un', 'et']);

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Date d'un dossier du générateur : 2026-10-02_01h43m00-titre. */
function folderDate(name: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})h(\d{2})m(\d{2})/.exec(name);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).toISOString() : null;
}

/** Ce qu'on sait d'une histoire faite avant fiche.json : sa scène, et le paquet glissé dans sa page. */
async function metaFromScene(dir: string, page: string): Promise<(StoryMeta & { creeLe?: string }) | null> {
  const scene = await readJson<PlayerScene>(path.join(dir, 'scene.json'));
  if (!scene?.title || !Array.isArray(scene.segments)) return null;
  const html = await readFile(path.join(dir, page), 'utf8');
  const raw = /<script id="storia-package" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  const pkg = raw ? (JSON.parse(raw) as { teaser?: string; audienceLabel?: string; createdAt?: string } | null) : null;
  const age = AGE_BANDS.find((a) => AGE_PROFILES[a].label === pkg?.audienceLabel) ?? '6-8';
  let spoken = 0;
  try {
    const voices = path.join(dir, 'voix');
    for (const file of (await readdir(voices)).filter((f) => f.endsWith('.wav'))) spoken += wavInfo(await readFile(path.join(voices, file))).duration;
  } catch {
    spoken = scene.segments.reduce((sum, s) => sum + s.text.length / 14, 0);
  }
  const theme = scene.theme ?? 'pirates'; // les premières scènes étaient toutes l'intro de la grotte pirate
  const label = findTheme(theme).label.toLowerCase();
  const words = scene.title
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length > 3 && !SMALL_WORDS.has(w));
  return {
    titre: scene.title,
    accroche: pkg?.teaser ?? '',
    motsCles: [...new Set([label, ...words])].slice(0, 8),
    texte: scene.segments.map((s) => s.text).join(' '),
    theme,
    ambiance: scene.ambiance,
    age: age as AgeBand,
    dureeSecondes: Math.round(spoken + scene.segments.reduce((sum, s) => sum + s.pause, 0) + (scene.intro ?? 1.8) + 3),
    page,
    creeLe: pkg?.createdAt,
  };
}

async function findMedia(dir: string, pattern: RegExp): Promise<string | undefined> {
  return (await readdir(dir)).find((f) => pattern.test(f));
}

export interface ImportReport {
  importees: string[];
  dejaLa: string[];
  ignorees: string[];
}

/** Importe chaque dossier d'histoire trouvé (le dossier lui-même ou ses sous-dossiers). Une histoire déjà importée est passée. */
export async function importStories(library: Library, libraryDir: string, sources: string[], log: (line: string) => void = () => {}): Promise<ImportReport> {
  const report: ImportReport = { importees: [], dejaLa: [], ignorees: [] };
  const candidates: string[] = [];
  for (const source of sources) {
    const files = await readdir(source).catch(() => null);
    if (!files) {
      log(`Dossier introuvable : ${source}`);
      continue;
    }
    if (files.some((f) => PAGE.test(f))) candidates.push(source);
    else {
      for (const name of files.sort()) {
        if ((await stat(path.join(source, name))).isDirectory()) candidates.push(path.join(source, name));
      }
    }
  }
  for (const dir of candidates) {
    const name = path.basename(dir);
    const files = await readdir(dir);
    const page = files.includes('index.html') ? 'index.html' : files.filter((f) => PAGE.test(f)).sort()[0];
    if (!page) {
      report.ignorees.push(name);
      continue;
    }
    // Même dossier, même identifiant : importer deux fois ne fait pas de doublon.
    const id = `i-${slugify(name).slice(0, 48)}`;
    if (library.get(id)) {
      report.dejaLa.push(name);
      continue;
    }
    const fiche = await readJson<StoryMeta>(path.join(dir, 'fiche.json'));
    const meta: (StoryMeta & { creeLe?: string }) | null = fiche ?? (await metaFromScene(dir, page));
    if (!meta) {
      report.ignorees.push(name);
      continue;
    }
    const dest = path.join(libraryDir, id);
    await mkdir(dest, { recursive: true });
    // Le dossier de travail de Wan (réglages, journaux, essais) reste où il est.
    await cp(dir, dest, { recursive: true, filter: (src) => path.relative(dir, src).split(path.sep)[0] !== 'wan' });
    const story: NewStory = {
      id,
      titre: meta.titre,
      accroche: meta.accroche,
      theme: meta.theme ?? null,
      age: meta.age,
      dureeSecondes: meta.dureeSecondes,
      motsCles: meta.motsCles,
      texte: meta.texte,
      composition: null,
      dossier: id,
      image: meta.image ?? (await findMedia(dest, /^image\.(png|jpe?g|webp)$/)) ?? null,
      animation: meta.animation ?? (await findMedia(dest, /^animation\.(mp4|webm|m4v)$/)) ?? null,
      page: meta.page ?? page,
      creeLe: folderDate(name) ?? meta.creeLe ?? (await stat(dir)).mtime.toISOString(),
    };
    library.add(story);
    report.importees.push(name);
    log(`  + « ${story.titre} »`);
  }
  return report;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: { bibliotheque: { type: 'string', default: path.join(SERVEUR_DIR, 'bibliotheque') } },
    allowPositionals: true,
  });
  const libraryDir = path.resolve(values.bibliotheque);
  await mkdir(libraryDir, { recursive: true });
  const library = new Library(path.join(libraryDir, 'bibliotheque.sqlite'));
  const sources = positionals.length ? positionals.map((p) => path.resolve(p)) : [path.join(ROOT_DIR, 'generator', 'sorties')];
  console.log(`Import depuis ${sources.join(', ')}…`);
  const report = await importStories(library, libraryDir, sources, (line) => console.log(line));
  library.close();
  console.log(
    `${report.importees.length} histoire${report.importees.length > 1 ? 's' : ''} importée${report.importees.length > 1 ? 's' : ''}` +
      (report.dejaLa.length ? `, ${report.dejaLa.length} déjà dans la bibliothèque` : '') +
      (report.ignorees.length ? `, ${report.ignorees.length} dossier${report.ignorees.length > 1 ? 's' : ''} sans histoire` : '') +
      '.',
  );
}

// Lancé directement (npm run importer), pas importé par un test.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
}
