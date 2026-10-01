import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareWorkflow, PROMPT_TOKEN } from '../src/comfy.ts';
import { buildPlayerHtml, PACKAGE_SLOT } from '../src/package.ts';
import type { StoryPackage } from '../src/package.ts';
import { fixWavHeader, wavInfo } from '../src/wav.ts';
import { streamingWav } from './mock-services.ts';

test('l’en-tête WAV de Pocket TTS est réparé', () => {
  const wav = streamingWav(0.5);
  const fixed = fixWavHeader(wav);
  const view = Buffer.from(fixed);
  assert.equal(view.readUInt32LE(4), fixed.length - 8);
  assert.equal(view.readUInt32LE(40), fixed.length - 44);
  const info = wavInfo(fixed);
  assert.equal(info.sampleRate, 24000);
  assert.ok(Math.abs(info.duration - 0.5) < 0.001);
});

test('un fichier qui n’est pas un WAV est refusé', () => {
  assert.throws(() => wavInfo(new TextEncoder().encode('pas un wav du tout')), /WAV/);
});

test('le prompt et la graine sont placés dans le workflow ComfyUI', () => {
  const raw = {
    '3': { class_type: 'KSampler', inputs: { seed: 1, steps: 4, model: ['4', 0] } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: `${PROMPT_TOKEN}, masterpiece` } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry' } },
  };
  const wf = prepareWorkflow(raw, 'a pirate ship', 1234);
  assert.equal(wf['6'].inputs?.text, 'a pirate ship, masterpiece');
  assert.equal(wf['7'].inputs?.text, 'blurry');
  assert.equal(wf['3'].inputs?.seed, 1234);
  assert.equal(raw['6'].inputs.text, `${PROMPT_TOKEN}, masterpiece`); // l'original n'est pas modifié
});

test('les erreurs de workflow expliquent quoi faire', () => {
  assert.throws(() => prepareWorkflow({ nodes: [], links: [] }, 'p', 1), /Export \(API\)/);
  assert.throws(() => prepareWorkflow({ '6': { inputs: { text: 'sans jeton' } } }, 'p', 1), /\{\{PROMPT\}\}/);
});

test('le paquet est intégré au lecteur sans pouvoir fermer la balise script', () => {
  const template = `<title>Ancien</title>\n${PACKAGE_SLOT}\n<script>/* lecteur */</script>`;
  const pkg: StoryPackage = {
    version: 1,
    scene: { title: 'Le <Trésor> & la Lune', audience: 'enfants', intro: 1.8, segments: [{ text: '</script><b>$&', pause: 0.5 }], cues: [] },
    teaser: '',
    audienceLabel: 'enfants',
    credits: '',
    effects: { waterline: 0.62 },
    createdAt: '2026-10-01T00:00:00.000Z',
  };
  const html = buildPlayerHtml(template, pkg);
  assert.match(html, /<title>Le &lt;Trésor&gt; &amp; la Lune<\/title>/);
  const json = /<script id="storia-package" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
  assert.equal(JSON.parse(json).scene.segments[0].text, '</script><b>$&');
  assert.throws(() => buildPlayerHtml('<html></html>', pkg), /emplacement/);
});
