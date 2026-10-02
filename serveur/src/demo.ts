// Mode démo : le studio complet, mais avec un faux conteur à la place d'Ollama, sans voix ni image.
// Pour découvrir l'application ou travailler son interface sans lancer les modèles : npm run demo
// Il lui faut seulement Redis. Ses histoires sont rangées à part (serveur/bibliotheque-demo).
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { INGREDIENTS, THEMES, drawComposition } from '../../generator/src/catalogue.ts';
import type { Ingredient, Kind } from '../../generator/src/catalogue.ts';
import { SERVEUR_DIR } from './config.ts';
import { startStudio } from './principal.ts';

const KINDS_IN_PROMPT: Record<string, Kind> = { Héros: 'heros', Lieu: 'lieu', Compagnon: 'compagnon', 'Objet magique': 'objet', Rebondissement: 'rebondissement' };

/** Retrouve les ingrédients d'après les lignes « - Héros : une petite renarde curieuse » de la consigne. */
function readPrompt(prompt: string): { theme: string; parts: Partial<Record<Kind, Ingredient>> } {
  const parts: Partial<Record<Kind, Ingredient>> = {};
  let theme = THEMES[0].label;
  for (const [, key, value] of prompt.matchAll(/^- ([^:\n]+) : (.+)$/gm)) {
    if (key === 'Thème') theme = value.replace(/\s*\(.*\)$/, '');
    const kind = KINDS_IN_PROMPT[key];
    const ingredient = kind && INGREDIENTS[kind].find((i) => i.texte === value);
    if (kind && ingredient) parts[kind] = ingredient;
  }
  return { theme, parts };
}

const feminine = (i: Ingredient) => i.texte.startsWith('une ');

/** « la renarde », « l'étoile filante », « le hibou » (h aspiré : pas d'élision). */
function the(i: Ingredient): string {
  const label = i.label.toLowerCase();
  if (/^[aeiouyéèêîôâ]/i.test(label)) return `l’${label}`;
  return `${feminine(i) ? 'la' : 'le'} ${label}`;
}

/** « de la boussole », « du chapeau magique », « de l'étoile filante ». */
const of = (i: Ingredient) => the(i).replace(/^le /, 'du ').replace(/^(la |l’)/, 'de $1');

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Une petite histoire écrite d'après la composition, au format attendu du vrai conteur. */
export function demoStory(prompt: string) {
  const { theme, parts } = readPrompt(prompt);
  const hero = parts.heros ?? INGREDIENTS.heros[0];
  const place = parts.lieu ?? INGREDIENTS.lieu[0];
  const friend = parts.compagnon ?? INGREDIENTS.compagnon[0];
  const thing = parts.objet ?? INGREDIENTS.objet[0];
  const twist = parts.rebondissement ?? INGREDIENTS.rebondissement[0];
  const she = feminine(hero) ? 'elle' : 'il';
  const titles = [`${capitalize(the(hero))} et ${the(thing)}`, `Le secret ${of(thing)}`, `${capitalize(the(hero))} et ${the(friend)}`];
  const titre = titles[(hero.id.length + thing.id.length) % titles.length];
  const themeInfo = THEMES.find((t) => t.label === theme) ?? THEMES[0];
  return {
    titre,
    accroche: `${capitalize(hero.texte)}, ${friend.texte} et ${thing.texte} : une aventure pleine de surprises.`,
    ambiance: themeInfo.ambiance,
    segments: [
      { texte: `Il était une fois ${hero.texte}…`, effet: 'aucun' },
      { texte: `Un beau matin, ${she} partit vers ${place.texte}.`, effet: 'vent' },
      { texte: `Avec ${she === 'elle' ? 'elle' : 'lui'}, il y avait ${friend.texte}.`, effet: 'aucun' },
      { texte: `Et dans sa poche, ${she} gardait précieusement ${thing.texte}.`, effet: 'magie' },
      { texte: 'Tout était calme… bien trop calme.', effet: 'aucun' },
      { texte: `Quand soudain : ${twist.texte} !`, effet: 'revelation' },
      { texte: `« Pas de panique, dit ${the(friend)}. Ensemble, on va trouver une idée. »`, effet: 'aucun' },
      { texte: `Alors ${the(hero)} se souvint ${of(thing)}…`, effet: 'lumiere' },
      { texte: 'Et petit à petit, tout redevint doux et tranquille.', effet: 'aucun' },
      { texte: `Ce soir-là, ${the(hero)} s’endormit en souriant, ${the(friend)} tout près.`, effet: 'cloche' },
    ],
    mots_cles: [theme.toLowerCase(), hero.label.toLowerCase(), place.label.toLowerCase(), thing.label.toLowerCase()],
    decor_en: themeInfo.decor_en,
    mouvement_en: 'Soft light gently pulses, tiny sparkles drift slowly in the air, the camera is perfectly still.',
  };
}

/** Le faux Ollama : il écrit en quelques secondes, le temps de voir l'atelier travailler. */
async function startFakeWriter(model: string, delayMs: number): Promise<string> {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const send = (data: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (req.url === '/api/tags') return send({ models: [{ name: `${model}:latest` }] });
    if (req.url === '/api/generate') return send({ done: true });
    if (req.url === '/api/chat') {
      const request = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { messages: { content: string }[] };
      await sleep(delayMs);
      return send({ model, message: { role: 'assistant', content: JSON.stringify(demoStory(request.messages[0]?.content ?? '')) }, done: true });
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const writer = await startFakeWriter('mistral-small3.2', 4000);
  const running = await startStudio(
    ['--bibliotheque', path.join(SERVEUR_DIR, 'bibliotheque-demo'), ...args, '--ollama', writer, '--modele', 'mistral-small3.2', '--sans-voix', '--sans-wan'],
    'Storia (démo, faux conteur et voix du navigateur)',
  );
  if (!running) return;
  // Une bibliothèque vide se remplit de quelques histoires, une par univers, pour voir la file à l'œuvre.
  if (running.library.stats().histoires === 0 && (await running.studio.ping())) {
    for (const theme of THEMES.slice(0, 6)) {
      await running.studio.create({ composition: drawComposition({ theme: theme.id, age: '6-8', duree: 'courte' }), animation: false });
    }
    console.log('  Six histoires de démonstration sont en préparation : regarde l’atelier.');
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
