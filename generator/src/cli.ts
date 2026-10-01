// Générateur d'intro « grotte pirate » : npm run generer -- --age 6-8 --idee "…"
import path from 'node:path';
import { parseArgs } from 'node:util';
import { runPipeline } from './pipeline.ts';
import { AGE_BANDS } from './scene.ts';
import type { AgeBand } from './scene.ts';

const root = path.resolve(import.meta.dirname, '..');

const HELP = `Génère l'intro « grotte pirate » de bout en bout sur ton PC :
texte (Ollama), voix (Pocket TTS) et image (ComfyUI), assemblés dans une page à ouvrir.

Utilisation :
  npm run generer -- [options]

Options :
  --age <tranche>        3-5, 6-8 (défaut), 9-12, ados ou adultes
  --idee "<texte>"       souhait de l'auditeur (par exemple dicté)
  --scene <json>         reprend le texte d'une scène déjà écrite au lieu d'appeler Ollama
                         (par exemple scenes/navire-endormi.json, ou le scene.json d'un essai)
  --modele <nom>         modèle Ollama (défaut : mistral-small3.2)
  --voix <nom>           voix Pocket TTS (défaut : estelle)
  --voix-fichier <wav>   extrait d'une voix à imiter, dont tu as les droits
  --workflow <json>      workflow ComfyUI au format API (défaut : workflow-image.json)
  --image <fichier>      image déjà faite (PNG, JPG, WebP), à la place de ComfyUI
  --animation <fichier>  animation en boucle (MP4, WebM), par exemple faite avec Wan 2.2,
                         jouée à la place de l'image
  --sans-voix            garde la voix du navigateur
  --sans-image           garde l'illustration provisoire
  --ligne-eau <nombre>   hauteur de la surface de l'eau sur l'image, de 0.3 à 0.9 (défaut : 0.62)
  --graine <nombre>      graine de l'image, pour reproduire un résultat
  --sortie <dossier>     où ranger les histoires (défaut : sorties)
  --ollama <url>         défaut : http://localhost:11434
  --tts <url>            serveur de voix (défaut : http://localhost:8001). Répète l'option pour
                         comparer plusieurs voix à l'aveugle sur le même texte
  --comfy <url>          défaut : http://127.0.0.1:8000 (ComfyUI Desktop ; 8188 pour une installation manuelle)
  -h, --aide             affiche cette aide`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      age: { type: 'string', default: '6-8' },
      idee: { type: 'string' },
      scene: { type: 'string' },
      modele: { type: 'string', default: 'mistral-small3.2' },
      voix: { type: 'string', default: 'estelle' },
      'voix-fichier': { type: 'string' },
      workflow: { type: 'string', default: path.join(root, 'workflow-image.json') },
      image: { type: 'string' },
      animation: { type: 'string' },
      'sans-voix': { type: 'boolean', default: false },
      'sans-image': { type: 'boolean', default: false },
      'ligne-eau': { type: 'string', default: '0.62' },
      graine: { type: 'string' },
      sortie: { type: 'string', default: path.join(root, 'sorties') },
      ollama: { type: 'string', default: 'http://localhost:11434' },
      tts: { type: 'string', multiple: true, default: ['http://localhost:8001'] },
      comfy: { type: 'string', default: 'http://127.0.0.1:8000' },
      aide: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });
  if (values.aide) {
    console.log(HELP);
    return;
  }
  if (!(AGE_BANDS as readonly string[]).includes(values.age)) {
    throw new Error(`Tranche d'âge inconnue : ${values.age}. Choix possibles : ${AGE_BANDS.join(', ')}.`);
  }
  const waterline = Number(values['ligne-eau']);
  if (!(waterline >= 0.3 && waterline <= 0.9)) throw new Error('--ligne-eau attend un nombre entre 0.3 et 0.9.');
  const seed = values.graine === undefined ? undefined : Number(values.graine);
  if (seed !== undefined && !Number.isSafeInteger(seed)) throw new Error('--graine attend un nombre entier.');
  const trimUrl = (url: string) => url.replace(/\/+$/, '');

  const result = await runPipeline({
    age: values.age as AgeBand,
    idea: values.idee,
    sceneFile: values.scene === undefined ? undefined : path.resolve(values.scene),
    model: values.modele,
    voice: values.voix,
    voiceSamplePath: values['voix-fichier'],
    workflowPath: path.resolve(values.workflow),
    imagePath: values.image === undefined ? undefined : path.resolve(values.image),
    videoPath: values.animation === undefined ? undefined : path.resolve(values.animation),
    withVoice: !values['sans-voix'],
    withImage: !values['sans-image'],
    outDir: path.resolve(values.sortie),
    playerPath: path.join(root, '..', 'prototype', 'intro-pirate', 'index.html'),
    ollamaUrl: trimUrl(values.ollama),
    ttsUrls: values.tts.map(trimUrl),
    comfyUrl: trimUrl(values.comfy),
    waterline,
    seed,
    log: (message) => console.log(message),
  });
  const pages = result.htmlPaths.map((p) => `  ${p}`).join('\n');
  const what = result.htmlPaths.length > 1 ? 'Écoute ces pages sans regarder correspondance.txt, puis compare' : 'Ouvre ce fichier dans ton navigateur';
  console.log(`\nTerminé en ${result.seconds.toFixed(0)} s. ${what} :\n${pages}`);
}

main().catch((err: unknown) => {
  console.error(`\nErreur : ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
