import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { AMBIANCES, INGREDIENTS, THEMES, checkComposition, drawComposition } from '../src/catalogue.ts';
import type { Composition } from '../src/catalogue.ts';
import { arrangeStoryEffects, parseStory, storyKeywords, storySystemPrompt, toStoryScene } from '../src/conte.ts';
import { runPipeline } from '../src/pipeline.ts';
import type { PipelineProgress } from '../src/pipeline.ts';
import { AGE_BANDS } from '../src/scene.ts';
import { startMockServices } from './mock-services.ts';

const playerPath = path.resolve(import.meta.dirname, '..', '..', 'prototype', 'intro-pirate', 'index.html');

export const SAMPLE_STORY = {
  titre: 'La Boussole qui chantait',
  accroche: 'Une petite renarde suit une boussole qui fredonne vers une île oubliée.',
  ambiance: 'mer',
  segments: [
    { texte: 'Il était une fois une petite renarde curieuse…', effet: 'aucun' },
    { texte: 'qui trouva, au fond d’un coffre, une boussole qui chantait.', effet: 'magie' },
    { texte: 'La boussole fredonnait toujours la même chanson :', effet: 'aucun' },
    { texte: '« Vers l’île aux trésors, petite renarde ! »', effet: 'vague' },
    { texte: 'Avec son ami le perroquet, elle prit la mer.', effet: 'vent' },
    { texte: 'Soudain, une tempête se leva…', effet: 'vent' },
    { texte: 'La renarde chanta avec la boussole, et le ciel se calma.', effet: 'lumiere' },
    { texte: 'Sur l’île, un trésor brillait : des étoiles de mer qui riaient.', effet: 'revelation' },
    { texte: 'Le soir venu, la renarde s’endormit en souriant.', effet: 'cloche' },
  ],
  mots_cles: ['Renarde', 'boussole', 'île', 'tempête'],
  decor_en: 'A little fox on a small sailboat at sunset near a tropical island',
  mouvement_en: 'The sea gently sways, the sail breathes in the wind, sparkles drift in the air',
};

const composition: Composition = { theme: 'pirates', heros: 'renarde', lieu: 'ile', compagnon: 'perroquet', objet: 'boussole', rebondissement: 'tempete', age: '6-8', duree: 'courte' };

test('le catalogue est cohérent : emojis, thèmes et ambiances', () => {
  for (const t of THEMES) assert.ok((AMBIANCES as readonly string[]).includes(t.ambiance), t.id);
  for (const items of Object.values(INGREDIENTS)) {
    for (const i of items) {
      assert.ok(i.emoji && i.texte && i.label, i.id);
      for (const t of i.themes ?? []) assert.ok(THEMES.some((x) => x.id === t), `${i.id} → ${t}`);
    }
  }
});

test('le tirage au sort respecte le thème imposé et ce qui est déjà choisi', () => {
  let seed = 42;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let k = 0; k < 50; k++) {
    const c = drawComposition({ theme: 'espace', heros: 'robot', age: '6-8', duree: 'courte' }, random);
    assert.equal(c.theme, 'espace');
    assert.equal(c.heros, 'robot');
    const lieu = INGREDIENTS.lieu.find((i) => i.id === c.lieu);
    assert.ok(!lieu?.themes || lieu.themes.includes('espace'), `lieu ${c.lieu} hors thème`);
  }
  const drawn = drawComposition({ age: '3-5', duree: 'longue' }, random);
  assert.ok(THEMES.some((t) => t.id === drawn.theme));
  for (const kind of ['heros', 'lieu', 'compagnon', 'objet', 'rebondissement'] as const) assert.ok(drawn[kind], kind);
});

test('une composition reçue de l’application est vérifiée', () => {
  assert.deepEqual(checkComposition({ ...composition, idee: '  un  perroquet   qui garde un secret ' }, AGE_BANDS), { ...composition, idee: 'un perroquet qui garde un secret' });
  assert.throws(() => checkComposition({ theme: 'licornes', age: '6-8' }, AGE_BANDS), /Thème inconnu/);
  assert.throws(() => checkComposition({ theme: 'espace', heros: 'godzilla', age: '6-8' }, AGE_BANDS), /heros inconnu/);
  assert.throws(() => checkComposition({ theme: 'espace', age: '99' }, AGE_BANDS), /Tranche d'âge/);
});

test('la consigne d’écriture reprend les ingrédients choisis', () => {
  const prompt = storySystemPrompt(composition);
  for (const words of ['une petite renarde curieuse', 'une île aux trésors', 'un perroquet bavard', 'une boussole qui chante', 'une tempête soudaine']) {
    assert.ok(prompt.includes(words), words);
  }
});

test('l’histoire est nettoyée, ses bruitages comptés et sa scène construite', () => {
  const story = parseStory(SAMPLE_STORY, composition);
  assert.deepEqual(story.mots_cles, ['renarde', 'boussole', 'île', 'tempête']);
  const { segments, notes } = arrangeStoryEffects(story.segments);
  assert.equal(segments.filter((s) => s.effet !== 'aucun' && s.effet !== 'revelation').length, 3); // au plus un tiers
  assert.ok(notes.some((n) => /trop de bruitages/.test(n)));
  const scene = toStoryScene({ ...story, segments }, composition);
  assert.equal(scene.ambiance, 'mer');
  assert.equal(scene.theme, 'pirates');
  assert.ok(scene.cues.some((c) => c.run === 'reveal'));
  assert.ok(scene.cues.some((c) => c.run === 'magic'));
  const keywords = storyKeywords(story, composition);
  for (const k of ['pirates', 'perroquet', 'renarde', 'île au trésor']) assert.ok(keywords.includes(k), k);
  assert.equal(new Set(keywords).size, keywords.length); // sans doublon
});

test('une composition donne une histoire complète, sa fiche et sa progression', async (t) => {
  const mock = await startMockServices({ draft: SAMPLE_STORY, narration: {} });
  t.after(() => mock.close());
  const dir = await mkdtemp(path.join(os.tmpdir(), 'storia-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const steps: PipelineProgress[] = [];
  const folder = path.join(dir, 'histoire-1');
  const result = await runPipeline({
    age: '6-8', composition, folder, model: 'mistral-small3.2', voice: 'x', workflowPath: path.join(dir, 'absent.json'),
    withVoice: true, withImage: false, outDir: dir, playerPath, ollamaUrl: mock.url, ttsUrls: [mock.url], comfyUrl: mock.url,
    waterline: 0.62, log: () => {}, onProgress: (p) => steps.push(p),
  });
  assert.equal(result.folder, folder);
  const chat = mock.calls.chat[0] as { messages: { content: string }[]; format: { properties: Record<string, unknown> } };
  assert.ok('mots_cles' in chat.format.properties);
  assert.match(chat.messages[0].content, /une boussole qui chante/);
  assert.equal(result.meta.titre, 'La Boussole qui chantait');
  assert.equal(result.meta.theme, 'pirates');
  assert.equal(result.meta.ambiance, 'mer');
  assert.ok(result.meta.motsCles.includes('pirates'));
  assert.ok(result.meta.dureeSecondes > 5);
  assert.match(result.meta.texte, /boussole qui chantait/);
  assert.deepEqual(JSON.parse(await readFile(path.join(folder, 'fiche.json'), 'utf8')), JSON.parse(JSON.stringify(result.meta)));
  assert.deepEqual([...new Set(steps.map((s) => s.etape))], ['texte', 'voix', 'assemblage']);
  assert.equal(steps.at(-1)?.avancement, 1);
  const unload = mock.calls.unload as { keep_alive: number }[];
  assert.equal(unload[0].keep_alive, 0); // le modèle de texte laisse la carte graphique à la voix
});
