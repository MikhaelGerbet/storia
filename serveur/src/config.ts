// Réglages du studio, lus sur la ligne de commande : npm start -- --reseau --modele gemma4:12b
import path from 'node:path';
import { parseArgs } from 'node:util';

export const SERVEUR_DIR = path.resolve(import.meta.dirname, '..');
export const ROOT_DIR = path.resolve(SERVEUR_DIR, '..');

export interface Config {
  port: number;
  hote: string;
  redis: string;
  /** Dossier des histoires et de leur base (bibliotheque.sqlite). */
  bibliotheque: string;
  ollama: string;
  modele: string;
  /** Serveur de voix ; null : la voix du navigateur. */
  tts: string | null;
  wan: {
    /** false : Wan2GP n'est pas cherché, l'image vient de ComfyUI ou il n'y en a pas. */
    actif: boolean;
    dossier?: string;
    etapes: number;
    image: string;
    modeles?: string;
  };
  /** Workflow ComfyUI pour l'image, quand Wan2GP n'est pas là. */
  workflow?: string;
  comfy: string;
  /** Application Flutter compilée (flutter build web). */
  app: string;
  lecteur: string;
  /** false : l'API seulement, les histoires sont fabriquées par un autre processus. */
  travailleur: boolean;
  /** Le gardien de la carte graphique (gardien/), à qui l'on réserve la carte avant chaque histoire ; null : on ne la réserve pas. */
  gardien: string | null;
}

export const HELP = `Le studio Storia : l'application, la bibliothèque d'histoires et la file de création.

Utilisation :
  npm start -- [options]

Options :
  --port <n>             port de l'application (défaut : 3000)
  --reseau               ouvre l'application aux autres appareils du réseau (tablette, téléphone)
  --redis <url>          Redis, pour la file de création (défaut : redis://127.0.0.1:6379)
  --bibliotheque <dir>   dossier des histoires (défaut : serveur/bibliotheque)
  --ollama <url>         défaut : http://localhost:11434
  --modele <nom>         modèle Ollama (défaut : mistral-small3.2)
  --tts <url>            serveur de voix (défaut : http://localhost:8001)
  --sans-voix            garde la voix du navigateur
  --sans-wan             ne cherche pas Wan2GP : pas d'illustration, sauf avec --workflow
  --wan-dossier <dir>    dossier de Wan2GP, celui qui contient wgp.py (défaut : cherché dans Pinokio)
  --wan-etapes <n>       étapes de l'animation : 4 (défaut, accélérateurs Lightning) ou 30
  --wan-image <modele>   modèle de l'image dans Wan2GP (défaut : z_image)
  --wan-modeles <dir>    dossier où Wan2GP télécharge ses modèles (par exemple P:/wan-modeles)
  --workflow <json>      image avec ComfyUI (workflow au format API) quand Wan2GP n'est pas là
  --comfy <url>          défaut : http://127.0.0.1:8000
  --app <dir>            application compilée (défaut : app/build/web)
  --sans-travailleur     l'API seulement : un autre processus fabrique les histoires
  --gardien <url>        le gardien de la carte graphique (défaut : http://127.0.0.1:7870)
  --sans-gardien         ne réserve pas la carte graphique (si rien d'autre ne s'en sert)
  -h, --aide             affiche cette aide`;

function number(value: string, name: string, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`--${name} attend un nombre entier entre ${min} et ${max}.`);
  return n;
}

/** Lit les options ; null quand l'aide est demandée. */
export function readConfig(args: string[]): Config | null {
  const { values } = parseArgs({
    args,
    options: {
      port: { type: 'string', default: '3000' },
      reseau: { type: 'boolean', default: false },
      redis: { type: 'string', default: 'redis://127.0.0.1:6379' },
      bibliotheque: { type: 'string', default: path.join(SERVEUR_DIR, 'bibliotheque') },
      ollama: { type: 'string', default: 'http://localhost:11434' },
      modele: { type: 'string', default: 'mistral-small3.2' },
      tts: { type: 'string', default: 'http://localhost:8001' },
      'sans-voix': { type: 'boolean', default: false },
      'sans-wan': { type: 'boolean', default: false },
      'wan-dossier': { type: 'string' },
      'wan-etapes': { type: 'string', default: '4' },
      'wan-image': { type: 'string', default: 'z_image' },
      'wan-modeles': { type: 'string' },
      workflow: { type: 'string' },
      comfy: { type: 'string', default: 'http://127.0.0.1:8000' },
      app: { type: 'string', default: path.join(ROOT_DIR, 'app', 'build', 'web') },
      'sans-travailleur': { type: 'boolean', default: false },
      gardien: { type: 'string', default: 'http://127.0.0.1:7870' },
      'sans-gardien': { type: 'boolean', default: false },
      aide: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });
  if (values.aide) return null;
  const url = (value: string, name: string) => {
    try {
      return new URL(value).href.replace(/\/+$/, '');
    } catch {
      throw new Error(`--${name} attend une adresse, par exemple http://localhost:8001 (reçu : ${value}).`);
    }
  };
  return {
    port: number(values.port, 'port', 1, 65535),
    hote: values.reseau ? '0.0.0.0' : '127.0.0.1',
    redis: url(values.redis, 'redis'),
    bibliotheque: path.resolve(values.bibliotheque),
    ollama: url(values.ollama, 'ollama'),
    modele: values.modele,
    // Les réglages éventuels de la voix (?etapes=24) sont gardés : le serveur de voix les lit.
    tts: values['sans-voix'] ? null : values.tts.replace(/\/+$/, ''),
    wan: {
      actif: !values['sans-wan'],
      dossier: values['wan-dossier'],
      etapes: number(values['wan-etapes'], 'wan-etapes', 2, 60),
      image: values['wan-image'],
      modeles: values['wan-modeles'],
    },
    workflow: values.workflow ? path.resolve(values.workflow) : undefined,
    comfy: url(values.comfy, 'comfy'),
    app: path.resolve(values.app),
    lecteur: path.join(ROOT_DIR, 'prototype', 'intro-pirate', 'index.html'),
    travailleur: !values['sans-travailleur'],
    gardien: values['sans-gardien'] ? null : url(values.gardien, 'gardien'),
  };
}
