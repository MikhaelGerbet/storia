import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runPipeline } from '../src/pipeline.ts';
import type { PipelineOptions } from '../src/pipeline.ts';
import { wavInfo } from '../src/wav.ts';
import { SAMPLE_DRAFT, startMockServices } from './mock-services.ts';

const playerPath = path.resolve(import.meta.dirname, '..', '..', 'prototype', 'intro-pirate', 'index.html');

async function tempDir(t: { after: (fn: () => Promise<void>) => void }): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'storia-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function options(dir: string, url: string, extra: Partial<PipelineOptions> = {}): PipelineOptions {
  return {
    age: '6-8',
    model: 'mistral-small3.2',
    voice: 'estelle',
    workflowPath: path.join(dir, 'workflow.json'),
    withVoice: true,
    withImage: true,
    outDir: dir,
    playerPath,
    ollamaUrl: url,
    ttsUrl: url,
    comfyUrl: url,
    waterline: 0.62,
    log: () => {},
    ...extra,
  };
}

const packageOf = (html: string) =>
  JSON.parse(/<script id="storia-package" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? 'null');

test('la chaîne complète produit une histoire jouable', async (t) => {
  const mock = await startMockServices({ draft: SAMPLE_DRAFT });
  t.after(() => mock.close());
  const dir = await tempDir(t);
  await writeFile(
    path.join(dir, 'workflow.json'),
    JSON.stringify({
      '3': { class_type: 'KSampler', inputs: { seed: 1, steps: 4 } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: '{{PROMPT}}' } },
      '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'storia' } },
    }),
  );

  const result = await runPipeline(options(dir, mock.url, { idea: 'un perroquet qui parle', seed: 42 }));

  // Texte : schéma imposé, souhait délimité, modèle déchargé avant l'image
  const chat = mock.calls.chat[0] as { format: { type: string }; messages: { content: string }[] };
  assert.equal(mock.calls.chat.length, 1);
  assert.equal(chat.format.type, 'object');
  assert.match(chat.messages[1].content, /<souhait>un perroquet qui parle<\/souhait>/);
  assert.deepEqual(mock.calls.unload, [{ model: 'mistral-small3.2', keep_alive: 0 }]);
  // Voix : une requête par segment, dans l'ordre
  assert.deepEqual(mock.calls.tts, result.scene.segments.map((s) => s.text));
  // Image : prompt et graine injectés
  const workflow = (mock.calls.prompts[0] as { prompt: Record<string, { inputs: Record<string, unknown> }> }).prompt;
  assert.match(String(workflow['6'].inputs.text), /pirate ship/);
  assert.equal(workflow['3'].inputs.seed, 42);
  // Mise en son : révélation au segment du bateau, cloche déplacée à la fin
  assert.deepEqual(result.scene.cues.filter((c) => c.run === 'revealShip'), [{ at: 2, when: 'start', delay: 0, run: 'revealShip' }]);
  assert.deepEqual(result.scene.cues.find((c) => c.run === 'bell'), { at: 5, when: 'end', delay: 0.3, run: 'bell' });
  // Fichiers rangés et WAV réparés
  assert.deepEqual((await readdir(result.folder)).sort(), ['image.png', 'index.html', 'prompt-image.txt', 'scene.json', 'voix']);
  assert.equal((await readdir(path.join(result.folder, 'voix'))).length, 6);
  const wav = await readFile(path.join(result.folder, 'voix', '01.wav'));
  assert.equal(wav.readUInt32LE(40), wav.length - 44);
  assert.ok(Math.abs(wavInfo(wav).duration - 0.6) < 0.01);
  // Page : histoire intégrée
  const html = await readFile(result.htmlPath, 'utf8');
  const pkg = packageOf(html);
  assert.equal(pkg.voices.length, 6);
  assert.match(pkg.image, /^data:image\/png;base64,/);
  assert.equal(pkg.scene.title, 'La Lanterne du Capitaine Brume');
  assert.match(html, /<title>La Lanterne du Capitaine Brume<\/title>/);
});

test('sans voix ni image, la page garde la voix du navigateur et l’illustration provisoire', async (t) => {
  const mock = await startMockServices({ draft: SAMPLE_DRAFT });
  t.after(() => mock.close());
  const dir = await tempDir(t);
  const result = await runPipeline(options(dir, mock.url, { withVoice: false, withImage: false }));
  assert.equal(mock.calls.tts.length, 0);
  assert.equal(mock.calls.prompts.length, 0);
  assert.equal(mock.calls.unload.length, 0);
  assert.deepEqual((await readdir(result.folder)).sort(), ['index.html', 'prompt-image.txt', 'scene.json']);
  const pkg = packageOf(await readFile(result.htmlPath, 'utf8'));
  assert.equal(pkg.voices, undefined);
  assert.equal(pkg.image, undefined);
  assert.match(pkg.credits, /celle du navigateur/);
});

test('messages clairs quand un service manque', async (t) => {
  const dir = await tempDir(t);
  await assert.rejects(runPipeline(options(dir, 'http://127.0.0.1:9', { withImage: false })), /Ollama ne répond pas/);
  await assert.rejects(runPipeline(options(dir, 'http://127.0.0.1:9')), /Workflow d'image introuvable/);
});
