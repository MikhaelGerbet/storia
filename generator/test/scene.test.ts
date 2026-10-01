import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AGE_PROFILES, arrangeEffects, findAvoided, imagePrompt, parseDraft, pauseFor, toPlayerScene } from '../src/scene.ts';
import type { DraftSegment } from '../src/scene.ts';

const seg = (texte: string, effet: DraftSegment['effet'] = 'aucun'): DraftSegment => ({ texte, effet });

test('parseDraft nettoie la réponse du modèle', () => {
  const draft = parseDraft(
    {
      titre: '  Le  Navire ',
      accroche: 'Une accroche.',
      segments: [{ texte: ' Un ', effet: 'tonnerre' }, { texte: '' }, { texte: 'Deux', effet: 'goutte' }, { texte: 'Trois' }],
      decor_en: 'Moonlight.',
    },
    AGE_PROFILES['6-8'],
  );
  assert.equal(draft.titre, 'Le Navire');
  assert.deepEqual(draft.segments, [seg('Un'), seg('Deux', 'goutte'), seg('Trois')]);
});

test('parseDraft refuse une réponse trop courte', () => {
  assert.throws(() => parseDraft({ titre: 'T', segments: [{ texte: 'Seul', effet: 'aucun' }] }, AGE_PROFILES['6-8']), /segment/);
});

test('la révélation est placée là où le bateau apparaît', () => {
  const { segments, notes } = arrangeEffects([seg('Une grotte.'), seg('La mer chante.', 'vague'), seg('Un vieux navire dort.'), seg('La suite.')]);
  assert.equal(segments[2].effet, 'revelation');
  assert.ok(notes.some((n) => n.includes('segment 3')));
});

test('la cloche ne sonne qu’à la fin, la lanterne après la révélation', () => {
  const { segments } = arrangeEffects([
    seg('A', 'lanterne'),
    seg('B', 'cloche'),
    seg('Le bateau apparaît.', 'revelation'),
    seg('C', 'lanterne'),
    seg('D'),
  ]);
  assert.deepEqual(
    segments.map((s) => s.effet),
    ['aucun', 'aucun', 'revelation', 'lanterne', 'cloche'],
  );
});

test('une seule révélation : la première est gardée', () => {
  const { segments } = arrangeEffects([seg('A'), seg('Le bateau.', 'revelation'), seg('Le navire.', 'revelation'), seg('D')]);
  assert.deepEqual(segments.map((s) => s.effet), ['aucun', 'revelation', 'aucun', 'aucun']);
});

test('pas plus d’un bruitage tous les deux segments (hors révélation)', () => {
  const { segments } = arrangeEffects([
    seg('A', 'goutte'),
    seg('B', 'vague'),
    seg('C', 'grincement'),
    seg('Le bateau.', 'revelation'),
    seg('E', 'goutte'),
    seg('F', 'vague'),
  ]);
  const sounds = segments.filter((s) => s.effet !== 'aucun' && s.effet !== 'revelation');
  assert.equal(sounds.length, 3);
});

test('garde-fou de vocabulaire selon l’âge', () => {
  assert.deepEqual(findAvoided(['Le pirate n’a pas peur.'], AGE_PROFILES['3-5']), ['peur']);
  assert.deepEqual(findAvoided(['Une épée brille.'], AGE_PROFILES['3-5']), ['épée']);
  assert.deepEqual(findAvoided(['Des cristaux scintillent.', 'Le drapeau à tête de mort.'], AGE_PROFILES['6-8']), []);
  assert.deepEqual(findAvoided(['Ils allaient mourir.'], AGE_PROFILES['6-8']), ['mourir']);
});

test('pauses et repères de la scène jouable', () => {
  assert.equal(pauseFor('Une goutte tombe.', 'goutte', false), 1.0);
  assert.equal(pauseFor('Et pourtant…', 'aucun', false), 0.8);
  assert.equal(pauseFor('Jusqu’à cette nuit.', 'cloche', true), 0.3);
  const scene = toPlayerScene(
    { titre: 'T', accroche: 'A', decor_en: '', segments: [seg('Un.', 'goutte'), seg('Le bateau.', 'revelation'), seg('Fin.', 'cloche')] },
    '6-8',
  );
  assert.deepEqual(scene.cues.map((c) => c.run), ['ambience', 'dawn', 'drip', 'drip', 'revealShip', 'creak', 'bell', 'endCard']);
  assert.deepEqual(scene.cues.find((c) => c.at === 0), { at: 0, when: 'end', delay: 0, run: 'drip' });
  assert.equal(scene.audience, 'enfants (6-8 ans)');
});

test('le prompt d’image impose la composition et la douceur pour les petits', () => {
  const prompt = imagePrompt({ titre: 'T', accroche: '', segments: [], decor_en: 'Glowworms on the ceiling.' }, '6-8');
  assert.match(prompt, /lower third/);
  assert.match(prompt, /Glowworms on the ceiling\./);
  assert.match(prompt, /not scary/);
  assert.doesNotMatch(imagePrompt({ titre: 'T', accroche: '', segments: [], decor_en: '' }, 'adultes'), /not scary/);
});
