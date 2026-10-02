import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runPipeline } from '../src/pipeline.ts';
import { findWan, loopSettings, runWan, useModelsFolder } from '../src/wan.ts';

const playerPath = path.resolve(import.meta.dirname, '..', '..', 'prototype', 'intro-pirate', 'index.html');
const sceneFile = path.resolve(import.meta.dirname, '..', 'scenes', 'navire-endormi.json');
const unix = process.platform !== 'win32'; // le faux Python est un script shell

/** Faux Wan2GP : note chaque appel, et produit une image ou une vidéo selon le modèle demandé. */
const FAKE_WGP = `
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const settings = JSON.parse(fs.readFileSync(args[args.indexOf('--process') + 1], 'utf8'));
const out = args[args.indexOf('--output-dir') + 1];
fs.appendFileSync(path.join(__dirname, 'appels.jsonl'), JSON.stringify({ cwd: process.cwd(), args, settings, miopen: process.env.MIOPEN_FIND_MODE }) + '\\n');
if (process.env.FAUX_WAN_RATE) {
  console.log('[ERROR] Task 1 failed: modèle introuvable');
  process.exit(0);
}
if (process.env.FAUX_WAN_MUET) setInterval(() => {}, 1000); // ne dit plus rien et ne s'arrête jamais
else {
  if (settings.model_type === 'i2v_2_2') {
    if (!fs.existsSync(settings.image_start)) process.exit(1);
    fs.writeFileSync(path.join(out, 'boucle_seed1.mp4'), 'fausse vidéo');
  } else {
    fs.writeFileSync(path.join(out, 'image_seed1.jpg'), 'fausse image');
  }
  console.log('Queue completed: 1/1 tasks in 1s');
  if (process.env.FAUX_WAN_BLOQUE) setInterval(() => {}, 1000); // a fini, mais ne quitte pas (PyTorch AMD sous Windows)
}
`;

async function fakeWan(t: { after: (fn: () => Promise<void>) => void }, version = '13.141') {
  const home = await mkdtemp(path.join(os.tmpdir(), 'storia-pinokio-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const appDir = path.join(home, 'api', 'wan2gp-amd.git', 'app');
  await mkdir(path.join(appDir, 'env', 'bin'), { recursive: true });
  await writeFile(path.join(appDir, 'wgp.py'), `${FAKE_WGP}\n// WanGP_version = "${version}"\n`);
  const python = path.join(appDir, 'env', 'bin', 'python');
  await writeFile(python, `#!/bin/sh\nexec "${process.execPath}" "$@"\n`);
  await chmod(python, 0o755);
  const calls = async () => (await readFile(path.join(appDir, 'appels.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  return { home, appDir, calls };
}

test('Wan2GP est trouvé dans Pinokio, et la version la plus récente l’emporte', { skip: !unix }, async (t) => {
  const recent = await fakeWan(t, '13.141');
  const old = path.join(recent.home, 'api', 'wan.git', 'app');
  await mkdir(path.join(old, 'venv', 'bin'), { recursive: true });
  await writeFile(path.join(old, 'wgp.py'), 'WanGP_version = "9.9"\n');
  await writeFile(path.join(old, 'venv', 'bin', 'python'), '');
  const found = await findWan(undefined, [recent.home]);
  assert.equal(found.appDir, recent.appDir);
  assert.equal(found.version, '13.141');
  // Une installation plus ancienne qui a déjà Wan 2.2 passe devant : pas de dizaines de Go à retélécharger
  await writeFile(path.join(old, 'wgp.py'), 'WanGP_version = "12.5"\n');
  await mkdir(path.join(old, 'ckpts'));
  await writeFile(path.join(old, 'ckpts', 'wan2.2_image2video_14B_high_quanto_mbf16_int8.safetensors'), '');
  const withModels = await findWan(undefined, [recent.home]);
  assert.equal(withModels.appDir, old);
  assert.deepEqual(withModels.models, ['Wan 2.2 image vers vidéo']);
  // Z-Image d'un côté, Wan 2.2 de l'autre : Wan 2.2 pèse le plus lourd
  await mkdir(path.join(recent.appDir, 'ckpts'));
  await writeFile(path.join(recent.appDir, 'ckpts', 'ZImageTurbo_quanto_bf16_int8.safetensors'), '');
  assert.equal((await findWan(undefined, [recent.home])).appDir, old);
  await writeFile(path.join(old, 'wgp.py'), 'WanGP_version = "9.9"\n');
  await writeFile(path.join(recent.appDir, 'wgp.py'), 'WanGP_version = "9.8"\n');
  await rm(old, { recursive: true });
  await assert.rejects(findWan(undefined, [recent.home]), /trop ancien/);
});

test('la boucle part de l’image et y revient, en 4 étapes avec Lightning', () => {
  const settings = loopSettings({ prompt: 'mer calme', image: 'C:\\storia\\image.jpg', seed: 7, steps: 4 });
  assert.equal(settings.image_prompt_type, 'SE');
  assert.equal(settings.image_start, 'C:/storia/image.jpg');
  assert.equal(settings.image_end, settings.image_start);
  assert.equal((settings.activated_loras as string[]).length, 2);
  assert.equal(loopSettings({ prompt: 'mer calme', image: 'a.jpg', seed: 7, steps: 30 }).activated_loras, undefined);
});

test('avec --wan, la page reçoit l’image puis l’animation fabriquées par Wan2GP', { skip: !unix }, async (t) => {
  const wan = await fakeWan(t);
  const out = await mkdtemp(path.join(os.tmpdir(), 'storia-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  const result = await runPipeline({
    age: '6-8', sceneFile, model: 'x', voice: 'x', workflowPath: path.join(out, 'absent.json'),
    withVoice: false, withImage: true, outDir: out, playerPath, ollamaUrl: 'http://127.0.0.1:9', ttsUrls: [],
    comfyUrl: 'http://127.0.0.1:9', waterline: 0.62, seed: 42, log: () => {},
    wan: { dir: wan.appDir, imageModel: 'z_image', steps: 4 },
  });
  const [still, loop] = await wan.calls();
  assert.equal(still.settings.model_type, 'z_image');
  assert.equal(still.settings.resolution, '1280x720');
  assert.equal(still.cwd, wan.appDir); // wgp.py lit ses réglages depuis son dossier
  assert.equal(still.miopen, process.env.MIOPEN_FIND_MODE ?? 'FAST');
  assert.equal(loop.settings.model_type, 'i2v_2_2');
  assert.equal(loop.settings.image_start, path.join(result.folder, 'wan', 'image', 'image_seed1.jpg').replace(/\\/g, '/'));
  assert.equal(loop.settings.image_end, loop.settings.image_start);
  const html = await readFile(path.join(result.folder, 'index.html'), 'utf8');
  const pkg = JSON.parse(/<script id="storia-package" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? 'null');
  assert.match(pkg.image, /^data:image\/jpeg;base64,/);
  assert.match(pkg.video, /^data:video\/mp4;base64,/);
  assert.match(pkg.credits, /z_image, animée par Wan 2\.2/);
  assert.match(await readFile(path.join(result.folder, 'prompt-animation.txt'), 'utf8'), /camera is perfectly still/);
});

test('Wan2GP qui s’arrête sans rien produire donne un message utile', { skip: !unix }, async (t) => {
  const wan = await fakeWan(t);
  const out = await mkdtemp(path.join(os.tmpdir(), 'storia-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  process.env.FAUX_WAN_RATE = '1';
  t.after(() => {
    delete process.env.FAUX_WAN_RATE;
  });
  await assert.rejects(
    runPipeline({
      age: '6-8', sceneFile, model: 'x', voice: 'x', workflowPath: path.join(out, 'absent.json'),
      withVoice: false, withImage: true, outDir: out, playerPath, ollamaUrl: 'http://127.0.0.1:9', ttsUrls: [],
      comfyUrl: 'http://127.0.0.1:9', waterline: 0.62, log: () => {},
      wan: { dir: wan.appDir, imageModel: 'z_image', steps: 4 },
    }),
    (err: Error) => /Wan2GP s'est arrêté \(code 0\) sans produire d'image/.test(err.message) && /Task 1 failed: modèle introuvable/.test(err.message) && /image\.log/.test(err.message),
  );
});

test('Wan2GP qui a fini mais ne quitte pas est arrêté, et son image est gardée', { skip: !unix }, async (t) => {
  const wan = await fakeWan(t);
  const jobDir = await mkdtemp(path.join(os.tmpdir(), 'storia-wan-'));
  t.after(() => rm(jobDir, { recursive: true, force: true }));
  process.env.FAUX_WAN_BLOQUE = '1';
  t.after(() => {
    delete process.env.FAUX_WAN_BLOQUE;
  });
  const install = await findWan(wan.appDir);
  const lines: string[] = [];
  const file = await runWan({ install, jobDir, graceMs: 200, log: (l) => lines.push(l) }, 'image', { model_type: 'z_image' }, 'image');
  assert.equal(path.basename(file), 'image_seed1.jpg');
  assert.ok(lines.some((l) => /ne s'arrêtait pas/.test(l)));
});

test('Wan2GP muet trop longtemps est arrêté avec un message clair', { skip: !unix }, async (t) => {
  const wan = await fakeWan(t);
  const jobDir = await mkdtemp(path.join(os.tmpdir(), 'storia-wan-'));
  t.after(() => rm(jobDir, { recursive: true, force: true }));
  process.env.FAUX_WAN_MUET = '1';
  t.after(() => {
    delete process.env.FAUX_WAN_MUET;
  });
  const install = await findWan(wan.appDir);
  await assert.rejects(runWan({ install, jobDir, silenceMs: 300 }, 'image', { model_type: 'z_image' }, 'image'), /semblait bloqué/);
});

test('les modèles de Wan2GP peuvent aller sur un autre disque, sans perdre ceux déjà téléchargés', { skip: !unix }, async (t) => {
  const wan = await fakeWan(t);
  const configPath = path.join(wan.appDir, 'wgp_config.json');
  await assert.rejects(useModelsFolder(await findWan(wan.appDir), path.join(wan.home, 'modeles')), /lance Wan une fois/);
  await writeFile(configPath, JSON.stringify({ checkpoints_paths: ['ckpts', '.'], UI_theme: 'default' }, null, 4));
  const elsewhere = path.join(wan.home, 'autre-disque', 'wan-modeles');
  assert.equal(await useModelsFolder(await findWan(wan.appDir), elsewhere), true);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  assert.deepEqual(config.checkpoints_paths, [elsewhere.replace(/\\/g, '/'), 'ckpts', '.']);
  assert.equal(config.UI_theme, 'default'); // le reste des réglages est gardé
  assert.equal(await useModelsFolder(await findWan(wan.appDir), elsewhere), false); // déjà fait
  // Un modèle téléchargé dans le nouveau dossier compte pour le choix de l'installation
  await writeFile(path.join(elsewhere, 'wan2.2_image2video_14B_low_quanto_mbf16_int8.safetensors'), '');
  assert.deepEqual((await findWan(wan.appDir)).models, ['Wan 2.2 image vers vidéo']);
});
