import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { encodeMultipart, synthesize } from '../src/tts.ts';
import { wavInfo } from '../src/wav.ts';
import { streamingWav } from './mock-services.ts';

async function startServer(t: { after: (fn: () => Promise<void>) => void }, handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test('une phrase lente ne coupe plus au bout de 5 minutes : le délai est le nôtre, avec un message clair', async (t) => {
  const url = await startServer(t, (req, res) => {
    req.resume();
    setTimeout(() => {
      if (res.destroyed) return; // le client a déjà abandonné
      res.writeHead(200, { 'content-type': 'audio/wav' });
      res.end(streamingWav(0.2));
    }, 300);
  });
  await assert.rejects(synthesize('Bonjour', { url, timeoutMs: 100 }), /n'a pas répondu en/);
  const wav = await synthesize('Bonjour', { url, timeoutMs: 5000 });
  assert.ok(Math.abs(wavInfo(wav).duration - 0.2) < 0.01);
});

test('le formulaire transmet le texte accentué et l’extrait de voix', async (t) => {
  let received = '';
  let type = '';
  const url = await startServer(t, (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      received = Buffer.concat(chunks).toString('latin1');
      type = req.headers['content-type'] ?? '';
      res.writeHead(200, { 'content-type': 'audio/wav' });
      res.end(streamingWav(0.1));
    });
  });
  await synthesize('Jusqu’à cette nuit…', { url, voiceSample: { bytes: new Uint8Array([82, 73, 70, 70]), name: 'conteur.wav' } });
  const boundary = /boundary=(.+)$/.exec(type)?.[1] ?? '';
  assert.ok(boundary.startsWith('----storia'));
  assert.ok(received.includes('name="text"\r\n\r\n' + Buffer.from('Jusqu’à cette nuit…', 'utf8').toString('latin1') + '\r\n'));
  assert.match(received, /name="voice_wav"; filename="conteur\.wav"\r\nContent-Type: audio\/wav\r\n\r\nRIFF\r\n/);
  assert.ok(received.endsWith(`--${boundary}--\r\n`));
});

test('serveur de voix absent : message clair', async () => {
  await assert.rejects(synthesize('Bonjour', { url: 'http://127.0.0.1:9' }), /Aucun serveur de voix ne répond/);
});

test('encodeMultipart produit un corps valide', () => {
  const body = encodeMultipart([{ name: 'text', value: 'a' }], 'B').toString();
  assert.equal(body, '--B\r\nContent-Disposition: form-data; name="text"\r\n\r\na\r\n--B--\r\n');
});
