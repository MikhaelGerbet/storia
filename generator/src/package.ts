// Assemble une histoire jouable : le lecteur du prototype, avec la scène, la voix et l'image intégrées.
import type { PlayerScene } from './scene.ts';

/** Emplacement prévu dans prototype/intro-pirate/index.html. */
export const PACKAGE_SLOT = '<script id="storia-package" type="application/json">null</script>';

export interface StoryPackage {
  version: 1;
  scene: PlayerScene;
  teaser: string;
  audienceLabel: string;
  credits: string;
  effects: { waterline: number };
  /** Image en data URI. Absente : l'illustration provisoire est gardée. */
  image?: string;
  /** Une voix par segment, en data URI. Absente : la voix du navigateur est gardée. */
  voices?: string[];
  createdAt: string;
}

export function toDataUri(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')}`;
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

export function buildPlayerHtml(template: string, pkg: StoryPackage): string {
  if (!template.includes(PACKAGE_SLOT)) {
    throw new Error("Le lecteur n'a pas d'emplacement pour l'histoire : mets à jour prototype/intro-pirate/index.html.");
  }
  // « < » échappé : le texte ne peut pas fermer la balise <script> qui l'entoure.
  const json = JSON.stringify(pkg).replace(/</g, '\\u003c');
  return template
    .replace(PACKAGE_SLOT, () => `<script id="storia-package" type="application/json">${json}</script>`)
    .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(pkg.scene.title)}</title>`);
}
