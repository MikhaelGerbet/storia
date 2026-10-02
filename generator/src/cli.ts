// Générateur d'intro « grotte pirate » : npm run generer -- --age 6-8 --idee "…"
import path from 'node:path';
import { parseArgs } from 'node:util';
import { gardienState, reserveGpu } from '../../gardien/src/client.ts';
import type { GpuLease } from '../../gardien/src/client.ts';
import { runPipeline } from './pipeline.ts';
import { AGE_BANDS } from './scene.ts';
import type { AgeBand } from './scene.ts';

const root = path.resolve(import.meta.dirname, '..');

const HELP = `Génère l'intro « grotte pirate » de bout en bout sur ton PC :
texte (Ollama), voix (voix/serveur_voix.py ou Pocket TTS), image (ComfyUI) ou image et animation
en boucle (Wan 2.2), assemblés dans une page à ouvrir.

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
  --wan                  fabrique l'image puis l'animation en boucle avec Wan 2.2 (Wan2GP dans
                         Pinokio), sans passer par son interface. Avec --image, anime ton image
  --wan-dossier <dir>    dossier de Wan2GP, celui qui contient wgp.py (défaut : cherché dans Pinokio)
  --wan-etapes <n>       étapes de l'animation : 4 (défaut, accélérateurs Lightning) ou 30 (plus lent)
  --wan-modeles <dir>    dossier où Wan2GP télécharge ses modèles, par exemple sur un autre disque
                         (P:/wan-modeles). Réglage gardé par Wan2GP : une fois suffit
  --wan-image <modele>   modèle de l'image dans Wan2GP (défaut : z_image ; aussi flux2_klein_4b,
                         qwen_image_20B…)
  --sans-voix            garde la voix du navigateur
  --sans-image           garde l'illustration provisoire
  --ligne-eau <nombre>   hauteur de la surface de l'eau sur l'image, de 0.3 à 0.9 (défaut : 0.62)
  --graine <nombre>      graine de l'image, pour reproduire un résultat
  --sortie <dossier>     où ranger les histoires (défaut : sorties)
  --ollama <url>         défaut : http://localhost:11434
  --tts <url>            serveur de voix (défaut : http://localhost:8001). Répète l'option pour
                         comparer plusieurs voix à l'aveugle sur le même texte
  --comfy <url>          défaut : http://127.0.0.1:8000 (ComfyUI Desktop ; 8188 pour une installation manuelle)
  --gardien <url>        gardien de la carte graphique : s'il tourne, on lui réserve la carte d'abord
                         (défaut : http://127.0.0.1:7870)
  --sans-gardien         ne réserve pas la carte graphique
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
      wan: { type: 'boolean', default: false },
      'wan-dossier': { type: 'string' },
      'wan-etapes': { type: 'string', default: '4' },
      'wan-image': { type: 'string', default: 'z_image' },
      'wan-modeles': { type: 'string' },
      'sans-voix': { type: 'boolean', default: false },
      'sans-image': { type: 'boolean', default: false },
      'ligne-eau': { type: 'string', default: '0.62' },
      graine: { type: 'string' },
      sortie: { type: 'string', default: path.join(root, 'sorties') },
      ollama: { type: 'string', default: 'http://localhost:11434' },
      tts: { type: 'string', multiple: true, default: ['http://localhost:8001'] },
      comfy: { type: 'string', default: 'http://127.0.0.1:8000' },
      gardien: { type: 'string', default: 'http://127.0.0.1:7870' },
      'sans-gardien': { type: 'boolean', default: false },
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
  const wanSteps = Number(values['wan-etapes']);
  if (!Number.isInteger(wanSteps) || wanSteps < 2 || wanSteps > 60) throw new Error('--wan-etapes attend un nombre entier entre 2 et 60.');

  // Si le gardien tourne, on lui réserve la carte : Oula ou une histoire du studio ne la prendront pas en même temps.
  let lease: GpuLease | null = null;
  if (!values['sans-gardien'] && (await gardienState(values.gardien))) {
    let shown: string | null = null;
    lease = await reserveGpu({
      url: values.gardien,
      client: 'storia-generateur',
      motif: values.scene ? path.basename(values.scene) : 'génération en ligne de commande',
      priorite: 'normale',
      onWait: (why) => {
        if (why && why !== shown) console.log(`La carte graphique ${why}…`);
        shown = why;
      },
    });
  }
  const released = () => lease?.release();
  process.once('exit', () => void released());
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
    wan: values.wan
      ? {
          dir: values['wan-dossier'] && path.resolve(values['wan-dossier']),
          imageModel: values['wan-image'],
          steps: wanSteps,
          echo: true,
          modelsDir: values['wan-modeles'] && path.resolve(values['wan-modeles']),
        }
      : undefined,
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
    signal: lease?.revoked,
  }).finally(released);
  const pages = result.htmlPaths.map((p) => `  ${p}`).join('\n');
  const what = result.htmlPaths.length > 1 ? 'Écoute ces pages sans regarder correspondance.txt, puis compare' : 'Ouvre ce fichier dans ton navigateur';
  console.log(`\nTerminé en ${result.seconds.toFixed(0)} s. ${what} :\n${pages}`);
}

main().catch((err: unknown) => {
  console.error(`\nErreur : ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
