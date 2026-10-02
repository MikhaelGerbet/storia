// Voix : un serveur local qui parle le langage de Pocket TTS (POST /tts, formulaire multipart).
// Ce peut être Pocket TTS lui-même ou voix/serveur_voix.py (VoxCPM2, Chatterbox), sur le port 8001.
// voix/serveur_voix.py sait aussi lire une scène entière (POST /recit) : chaque phrase d'un seul souffle,
// relue par Whisper, puis découpée en segments. Le générateur s'en sert quand le serveur le propose.
// Les requêtes passent par node:http plutôt que fetch : fetch abandonne au bout de 5 minutes sans réponse,
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

/** Une adresse de serveur de voix peut porter des réglages, pour les comparer : http://localhost:8001?etapes=24&cfg=2.5 */
export function splitVoiceUrl(url: string): { base: string; settings: Record<string, string> } {
  const question = url.indexOf('?');
  if (question < 0) return { base: url.replace(/\/+$/, ''), settings: {} };
  return { base: url.slice(0, question).replace(/\/+$/, ''), settings: Object.fromEntries(new URLSearchParams(url.slice(question + 1))) };
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
    res = await post(new URL(`${splitVoiceUrl(o.url).base}/tts`), encodeMultipart(fields, boundary), `multipart/form-data; boundary=${boundary}`, timeoutMs);
  } catch (err) {
    if ((err as { code?: string }).code === 'STORIA_TIMEOUT') {
      throw new Error(`Le serveur de voix n'a pas répondu en ${Math.round(timeoutMs / 60_000)} minutes pour une seule phrase. Regarde sa fenêtre : s'il tourne sur le processeur, installe PyTorch pour ta carte graphique (voir voix/README.md).`);
    }
    throw new Error(`Aucun serveur de voix ne répond sur ${o.url}. Lance-le d'abord (voir voix/README.md), puis attends qu'il affiche « Voix prête ».`);
  }
  if (res.status !== 200) throw new Error(`Le serveur de voix a renvoyé l'erreur ${res.status} : ${res.body.toString('utf8').slice(0, 300)}`);
  return fixWavHeader(new Uint8Array(res.body));
}

export interface NarrationSegment {
  text: string;
  pause: number;
}

/** Progression envoyée par le serveur de voix, une ligne par phrase lue. */
export interface NarrationEvent {
  type: 'debut' | 'phrase';
  phrases?: number;
  relecture?: string | null;
  numero?: number;
  total?: number;
  secondes?: number;
  parole?: number;
  essais?: number;
  texte?: string;
  ressemblance?: number | null;
  entendu?: string | null;
  alerte?: string | null;
}

export interface Narration {
  /** Un WAV par segment de la scène. */
  clips: Uint8Array[];
  /** Pauses après chaque segment, recalées sur le rythme de la lecture. */
  pauses: number[];
  /** Ce que le serveur a dit de chaque phrase : durée, lectures, ce que Whisper a entendu. */
  report: NarrationEvent[];
}

/** Le serveur ne sait lire que phrase par phrase (Pocket TTS, ou une version précédente du serveur). */
export class NarrationUnsupported extends Error {}

/** Envoie une requête et transmet la réponse ligne par ligne, au fil de l'eau. */
function postLines(url: URL, body: Buffer, timeoutMs: number, onLine: (line: string) => void): Promise<{ status: number; text: string }> {
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': body.length } }, (res) => {
      const status = res.statusCode ?? 0;
      let pending = '';
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        if (status !== 200) {
          text += chunk;
          return;
        }
        pending += chunk;
        let newline: number;
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline).trim();
          pending = pending.slice(newline + 1);
          if (line) onLine(line);
        }
      });
      res.on('end', () => {
        if (status === 200 && pending.trim()) onLine(pending.trim());
        resolve({ status, text });
      });
      res.on('error', reject);
    });
    // Délai d'inactivité : il repart à chaque phrase reçue, quelle que soit la longueur de la scène.
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error('délai dépassé'), { code: 'STORIA_TIMEOUT' })));
    req.on('error', reject);
    req.end(body);
  });
}

/** Fait lire toute une scène au serveur de voix (POST /recit), en suivant sa progression. */
export async function narrate(segments: NarrationSegment[], o: TtsOptions & { onEvent?: (event: NarrationEvent) => void }): Promise<Narration> {
  const { base, settings } = splitVoiceUrl(o.url);
  const request = {
    segments,
    voice_wav: o.voiceSample ? Buffer.from(o.voiceSample.bytes).toString('base64') : undefined,
    voice_name: o.voiceSample?.name,
    reglages: Object.keys(settings).length ? settings : undefined,
  };
  const timeoutMs = o.timeoutMs ?? 30 * 60_000;
  const report: NarrationEvent[] = [];
  let done: { segments: { wav: string; pause: number }[] } | undefined;
  let failure: string | undefined;
  let started = false;
  let res: { status: number; text: string };
  try {
    res = await postLines(new URL(`${base}/recit`), Buffer.from(JSON.stringify(request)), timeoutMs, (line) => {
      const event = JSON.parse(line) as Omit<NarrationEvent, 'type'> & { type: string; detail?: string; segments?: { wav: string; pause: number }[] };
      started = true;
      if (event.type === 'fin') done = { segments: event.segments ?? [] };
      else if (event.type === 'erreur') failure = event.detail ?? 'erreur inconnue';
      else if (event.type === 'debut' || event.type === 'phrase') {
        const progress = event as NarrationEvent;
        if (progress.type === 'phrase') report.push(progress);
        o.onEvent?.(progress);
      }
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'STORIA_TIMEOUT') {
      throw new Error(`Le serveur de voix n'a pas avancé en ${Math.round(timeoutMs / 60_000)} minutes. Regarde sa fenêtre : s'il tourne sur le processeur, installe PyTorch pour ta carte graphique (voir voix/README.md).`);
    }
    if (started) throw new Error("Le serveur de voix s'est arrêté au milieu du récit. Regarde sa fenêtre pour en voir la raison.");
    throw new Error(`Aucun serveur de voix ne répond sur ${o.url}. Lance-le d'abord (voir voix/README.md), puis attends qu'il affiche « Voix prête ».`);
  }
  if (res.status === 404 || res.status === 405) throw new NarrationUnsupported(`${o.url} ne lit que phrase par phrase`);
  if (res.status !== 200) throw new Error(`Le serveur de voix a renvoyé l'erreur ${res.status} : ${res.text.slice(0, 300)}`);
  if (failure) throw new Error(`Le serveur de voix a échoué : ${failure}`);
  if (!done || done.segments.length !== segments.length) throw new Error('Le serveur de voix a coupé le récit avant la fin. Regarde sa fenêtre.');
  return {
    clips: done.segments.map((s) => fixWavHeader(new Uint8Array(Buffer.from(s.wav, 'base64')))),
    pauses: done.segments.map((s, i) => (Number.isFinite(s.pause) ? s.pause : segments[i].pause)),
    report,
  };
}

/** Demande au serveur de voix de libérer la carte graphique pour une autre application ; il rechargera son modèle au besoin. */
export async function releaseVoice(url: string): Promise<boolean> {
  try {
    return (await post(new URL(`${splitVoiceUrl(url).base}/liberer`), Buffer.alloc(0), 'application/json', 60_000)).status === 200;
  } catch {
    return false;
  }
}
