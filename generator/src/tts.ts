// Voix : un serveur local qui parle le langage de Pocket TTS (POST /tts, formulaire multipart).
// Ce peut être Pocket TTS lui-même ou voix/serveur_voix.py (VoxCPM2, Chatterbox), sur le port 8001.
// La requête passe par node:http plutôt que fetch : fetch abandonne au bout de 5 minutes sans réponse,
// or une phrase peut prendre plus longtemps quand la voix est générée sur le processeur.
import http from 'node:http';
import https from 'node:https';
import { fixWavHeader } from './wav.ts';

export interface TtsOptions {
  url: string;
  /** Voix intégrée de Pocket TTS (par exemple « estelle »). Ignorée par les autres moteurs. */
  voice?: string;
  /** Extrait WAV d'une voix à imiter (dont tu as les droits). Prioritaire sur `voice`. */
  voiceSample?: { bytes: Uint8Array; name: string };
  /** Délai maximal pour une phrase, en millisecondes (30 minutes par défaut). */
  timeoutMs?: number;
}

interface FormField {
  name: string;
  value: string | Uint8Array;
  filename?: string;
  type?: string;
}

export function encodeMultipart(fields: FormField[], boundary: string): Buffer {
  const parts: Buffer[] = [];
  for (const field of fields) {
    const file = field.filename ? `; filename="${field.filename.replace(/"/g, '')}"` : '';
    const type = field.filename ? `Content-Type: ${field.type ?? 'application/octet-stream'}\r\n` : '';
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"${file}\r\n${type}\r\n`, 'utf8'));
    parts.push(typeof field.value === 'string' ? Buffer.from(field.value, 'utf8') : Buffer.from(field.value));
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(parts);
}

function post(url: URL, body: Buffer, contentType: string, timeoutMs: number): Promise<{ status: number; body: Buffer }> {
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(url, { method: 'POST', headers: { 'content-type': contentType, 'content-length': body.length } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error('délai dépassé'), { code: 'STORIA_TIMEOUT' })));
    req.on('error', reject);
    req.end(body);
  });
}

export async function synthesize(text: string, o: TtsOptions): Promise<Uint8Array> {
  const fields: FormField[] = [{ name: 'text', value: text }];
  if (o.voiceSample) fields.push({ name: 'voice_wav', value: o.voiceSample.bytes, filename: o.voiceSample.name, type: 'audio/wav' });
  else if (o.voice) fields.push({ name: 'voice_url', value: o.voice });
  const boundary = `----storia${crypto.randomUUID()}`;
  const timeoutMs = o.timeoutMs ?? 30 * 60_000;
  let res: { status: number; body: Buffer };
  try {
    res = await post(new URL(`${o.url}/tts`), encodeMultipart(fields, boundary), `multipart/form-data; boundary=${boundary}`, timeoutMs);
  } catch (err) {
    if ((err as { code?: string }).code === 'STORIA_TIMEOUT') {
      throw new Error(`Le serveur de voix n'a pas répondu en ${Math.round(timeoutMs / 60_000)} minutes pour une seule phrase. Regarde sa fenêtre : s'il tourne sur le processeur, installe PyTorch pour ta carte graphique (voir voix/README.md).`);
    }
    throw new Error(`Aucun serveur de voix ne répond sur ${o.url}. Lance-le d'abord (voir voix/README.md), puis attends qu'il affiche « Voix prête ».`);
  }
  if (res.status !== 200) throw new Error(`Le serveur de voix a renvoyé l'erreur ${res.status} : ${res.body.toString('utf8').slice(0, 300)}`);
  return fixWavHeader(new Uint8Array(res.body));
}
