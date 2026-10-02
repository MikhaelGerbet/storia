import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Library, ftsQuery } from '../src/bibliotheque.ts';
import type { NewStory } from '../src/bibliotheque.ts';

function story(o: Partial<NewStory> & Pick<NewStory, 'titre'>): NewStory {
  return {
    accroche: '',
    theme: 'pirates',
    age: '6-8',
    dureeSecondes: 90,
    motsCles: [],
    texte: '',
    composition: null,
    dossier: 'x',
    image: null,
    animation: null,
    page: 'index.html',
    ...o,
  };
}

function sample(): Library {
  const library = new Library(':memory:');
  library.add(story({ id: 'a', titre: 'La Boussole qui chantait', motsCles: ['pirates', 'île', 'boussole'], texte: 'Une renarde trouve une boussole.', creeLe: '2026-10-01T10:00:00Z' }));
  library.add(story({ id: 'b', titre: 'Le Robot des étoiles', theme: 'espace', motsCles: ['espace', 'robot'], texte: 'Un robot rêve d’une île dans le ciel.', dureeSecondes: 40, creeLe: '2026-10-02T10:00:00Z' }));
  library.add(story({ id: 'c', titre: 'Dodo le dragonneau', theme: 'dragons', age: '3-5', motsCles: ['dragons', 'grotte'], texte: 'Un dragonneau a peur du noir.', creeLe: '2026-09-30T10:00:00Z' }));
  return library;
}

test('la recherche ignore les accents et la casse, et cherche le début des mots', () => {
  const library = sample();
  assert.deepEqual(library.search({ q: 'ile' }).histoires.map((h) => h.id).sort(), ['a', 'b']);
  assert.deepEqual(library.search({ q: 'ÉTOI' }).histoires.map((h) => h.id), ['b']);
  assert.deepEqual(library.search({ q: 'bous' }).histoires.map((h) => h.id), ['a']);
  assert.deepEqual(library.search({ q: 'robot ciel' }).histoires.map((h) => h.id), ['b']); // tous les mots
  assert.equal(library.search({ q: 'licorne' }).total, 0);
  assert.equal(library.search({ q: '"); DROP TABLE histoires; --' }).total, 0); // la saisie n'est jamais du SQL
  assert.equal(library.stats().histoires, 3);
});

test('le titre compte plus que le texte', () => {
  const library = sample();
  library.add(story({ id: 'd', titre: 'Une nuit tranquille', texte: 'Le robot dort.', creeLe: '2026-10-03T10:00:00Z' }));
  assert.deepEqual(library.search({ q: 'robot' }).histoires.map((h) => h.id), ['b', 'd']);
});

test('filtres et tris : thème, âge, favoris, plus écoutées, dernières écoutées', () => {
  const library = sample();
  assert.deepEqual(library.search().histoires.map((h) => h.id), ['b', 'a', 'c']); // plus récentes d'abord
  assert.deepEqual(library.search({ theme: 'dragons' }).histoires.map((h) => h.id), ['c']);
  assert.deepEqual(library.search({ age: '3-5' }).histoires.map((h) => h.id), ['c']);
  library.countRead('c');
  library.countRead('c');
  library.countRead('a');
  assert.deepEqual(library.search({ tri: 'populaires' }).histoires.map((h) => [h.id, h.lectures]), [['c', 2], ['a', 1], ['b', 0]]);
  assert.equal(library.search({ tri: 'ecoutees' }).histoires.at(-1)?.id, 'b'); // jamais écoutée : à la fin
  assert.deepEqual(library.search({ tri: 'courtes' }).histoires[0].id, 'b');
  library.setFavorite('a', true);
  assert.deepEqual(library.search({ favoris: true }).histoires.map((h) => h.id), ['a']);
  assert.ok(library.get('c')?.derniereLecture);
});

test('une histoire supprimée disparaît aussi de la recherche', () => {
  const library = sample();
  assert.equal(library.remove('a'), true);
  assert.equal(library.remove('a'), false);
  assert.equal(library.search({ q: 'boussole' }).total, 0);
  assert.equal(library.get('a'), undefined);
});

test('les mots-clés les plus fréquents servent de suggestions', () => {
  const library = sample();
  library.add(story({ id: 'e', titre: 'Encore des pirates', motsCles: ['pirates', 'trésor'] }));
  assert.deepEqual(library.topKeywords(2), [{ motCle: 'pirates', histoires: 2 }, { motCle: 'boussole', histoires: 1 }]);
  assert.equal(ftsQuery('  '), null);
  assert.equal(ftsQuery('l’île'), '"île"*');
  assert.equal(ftsQuery('a'), '"a"*');
});
