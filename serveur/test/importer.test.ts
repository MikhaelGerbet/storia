import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { streamingWav } from '../../generator/test/mock-services.ts';
import { Library } from '../src/bibliotheque.ts';
import { importStories } from '../src/importer.ts';
import { tempDir } from './aides.ts';

test('les histoires du générateur entrent dans la bibliothèque, une seule fois', async (t) => {
  const dir = await tempDir(t);
  const sorties = path.join(dir, 'sorties');
  const libraryDir = path.join(dir, 'bibliotheque');
  await mkdir(libraryDir, { recursive: true });

  // Une histoire récente, avec sa fiche, son image et le dossier de travail de Wan.
  const recent = path.join(sorties, '2026-10-02_09h15m00-la-boussole-qui-chantait');
  await mkdir(path.join(recent, 'wan', 'image'), { recursive: true });
  await writeFile(path.join(recent, 'index.html'), '<html></html>');
  await writeFile(path.join(recent, 'image.jpg'), 'jpg');
  await writeFile(path.join(recent, 'wan', 'image.log'), 'journal');
  await writeFile(
    path.join(recent, 'fiche.json'),
    JSON.stringify({ titre: 'La Boussole qui chantait', accroche: 'Une renarde.', motsCles: ['pirates', 'boussole'], texte: 'Il était une fois une boussole.', theme: 'pirates', age: '6-8', dureeSecondes: 75, image: 'image.jpg', page: 'index.html' }),
  );

  // Une intro plus ancienne, sans fiche : sa scène et la page suffisent.
  const old = path.join(sorties, '2026-09-28_21h03m10-la-lanterne-du-capitaine-brume');
  await mkdir(path.join(old, 'voix'), { recursive: true });
  await writeFile(path.join(old, 'voix', '01.wav'), streamingWav(2));
  await writeFile(
    path.join(old, 'scene.json'),
    JSON.stringify({ title: 'La Lanterne du Capitaine Brume', audience: 'tout-petits (3-5 ans)', intro: 1.8, segments: [{ text: 'Plic… ploc…', pause: 1 }], cues: [] }),
  );
  const pkg = JSON.stringify({ version: 1, teaser: 'Un vieux navire attend.', audienceLabel: 'tout-petits (3-5 ans)' });
  await writeFile(path.join(old, 'index.html'), `<html><script id="storia-package" type="application/json">${pkg}</script></html>`);

  await mkdir(path.join(sorties, 'vide'));

  const library = new Library(':memory:');
  const first = await importStories(library, libraryDir, [sorties]);
  assert.equal(first.importees.length, 2);
  assert.deepEqual(first.ignorees, ['vide']);

  const [boussole, lanterne] = ['La Boussole qui chantait', 'La Lanterne du Capitaine Brume'].map((titre) => library.search().histoires.find((h) => h.titre === titre));
  assert.ok(boussole && lanterne);
  assert.equal(boussole.image, 'image.jpg');
  assert.equal(boussole.creeLe, new Date(2026, 9, 2, 9, 15, 0).toISOString());
  assert.ok(existsSync(path.join(libraryDir, boussole.dossier, 'index.html')));
  assert.equal(existsSync(path.join(libraryDir, boussole.dossier, 'wan')), false);
  assert.equal(lanterne.age, '3-5');
  assert.equal(lanterne.accroche, 'Un vieux navire attend.');
  assert.equal(lanterne.theme, 'pirates');
  assert.equal(lanterne.dureeSecondes, Math.round(2 + 1 + 1.8 + 3));
  assert.ok(lanterne.motsCles.includes('lanterne'));
  assert.equal(library.search({ q: 'brume' }).total, 1);

  const second = await importStories(library, libraryDir, [sorties]);
  assert.equal(second.importees.length, 0);
  assert.equal(second.dejaLa.length, 2);
  assert.equal(library.stats().histoires, 2);
});
