// Réglages du gardien : quelques options en ligne de commande, et un fichier gardien.json pour ce qui est propre
// au PC (le serveur de voix à lancer, les jeux à reconnaître…). Modèle : gardien.exemple.json.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_GAME_RULES } from './jeux.ts';
import type { GameRules } from './jeux.ts';
import type { ServiceConfig } from './services.ts';

export const GARDIEN_DIR = path.resolve(import.meta.dirname, '..');

export interface GardienConfig {
  port: number;
  hote: string;
  /** Ollama, dont les modèles sont déchargés au moment du ménage ; null : pas d'Ollama. */
  ollama: string | null;
  /** Combien de temps garder les modèles chargés quand plus personne ne demande la carte, avant le ménage. */
  inactiviteMs: number;
  /** Sans signe de vie pendant ce temps, une réservation est rendue. */
  leaseMs: number;
  jeux: { actif: boolean; interrompre: boolean; regles: GameRules };
  services: Record<string, ServiceConfig>;
  /** Autres adresses à appeler (POST) pour qu'un serveur rende la mémoire de la carte. */
  liberer: string[];
  wan: { dossier?: string; modeles?: string };
  travaux: string;
  journaux: string;
  fichier: string | null;
}

export const HELP = `Le gardien de la carte graphique : une file d'attente pour tous les programmes qui s'en servent.

Utilisation :
  npm start -- [options]

Options :
  --port <n>          port du gardien (défaut : 7870)
  --reseau            accepte les programmes des autres machines du réseau
  --config <json>     fichier de réglages (défaut : gardien/gardien.json s'il existe)
  --sans-jeux         pas de mode jeu automatique
  -h, --aide          affiche cette aide

Le reste se règle dans gardien.json (voir gardien.exemple.json) : le serveur de voix à lancer
à la demande, Ollama, les jeux à reconnaître, le dossier de Wan2GP.`;

interface FileConfig {
  port?: number;
  ollama?: string | null;
  inactiviteMinutes?: number;
  jeux?: { actif?: boolean; interrompre?: boolean; dossiers?: string[]; executables?: string[]; ignorer?: string[] };
  services?: Record<string, ServiceConfig>;
  liberer?: string[];
  wan?: { dossier?: string | null; modeles?: string | null };
}

function readFileConfig(file: string): FileConfig {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as FileConfig;
  } catch (err) {
    throw new Error(`${file} est illisible : ${(err as Error).message}`);
  }
}

/** Lit les options ; null quand l'aide est demandée. */
export function readConfig(args: string[]): GardienConfig | null {
  const { values } = parseArgs({
    args,
    options: {
      port: { type: 'string' },
      reseau: { type: 'boolean', default: false },
      config: { type: 'string' },
      'sans-jeux': { type: 'boolean', default: false },
      aide: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });
  if (values.aide) return null;
  const defaultFile = path.join(GARDIEN_DIR, 'gardien.json');
  const file = values.config ? path.resolve(values.config) : existsSync(defaultFile) ? defaultFile : null;
  if (values.config && !existsSync(file as string)) throw new Error(`Réglages introuvables : ${file}`);
  const f = file ? readFileConfig(file) : {};
  const port = Number(values.port ?? f.port ?? 7870);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port attend un nombre entre 1 et 65535.');
  const rules = DEFAULT_GAME_RULES;
  const services = f.services ?? {};
  for (const [nom, s] of Object.entries(services)) {
    if (!Array.isArray(s.commande) || !s.commande.length || typeof s.sante !== 'string') {
      throw new Error(`Le service « ${nom} » de ${file} doit avoir une « commande » (liste) et une adresse « sante ».`);
    }
  }
  return {
    port,
    hote: values.reseau ? '0.0.0.0' : '127.0.0.1',
    ollama: f.ollama === undefined ? 'http://localhost:11434' : f.ollama,
    inactiviteMs: Math.max(0, f.inactiviteMinutes ?? 2) * 60_000,
    leaseMs: 90_000,
    jeux: {
      actif: !values['sans-jeux'] && f.jeux?.actif !== false,
      interrompre: f.jeux?.interrompre !== false,
      regles: {
        dossiers: [...rules.dossiers, ...(f.jeux?.dossiers ?? [])],
        executables: [...rules.executables, ...(f.jeux?.executables ?? [])],
        ignorer: [...rules.ignorer, ...(f.jeux?.ignorer ?? [])],
      },
    },
    services,
    liberer: f.liberer ?? [],
    wan: { dossier: f.wan?.dossier ?? undefined, modeles: f.wan?.modeles ?? undefined },
    travaux: path.join(GARDIEN_DIR, 'travaux'),
    journaux: path.join(GARDIEN_DIR, 'journaux'),
    fichier: file,
  };
}
