// Voix : Pocket TTS (Kyutai), lancé localement avec « pocket-tts serve --language french --port 8001 »
// (le port 8000 est celui de ComfyUI Desktop).
import { fixWavHeader } from './wav.ts';

export interface TtsOptions {
  url: string;
  /** Voix intégrée (par exemple « estelle »), ou adresse http(s):// ou hf:// d'un extrait de voix. */
  voice?: string;
  /** Extrait WAV d'une voix à imiter (dont tu as les droits). Prioritaire sur `voice`. */
  voiceSample?: { bytes: Uint8Array; name: string };
}

export async function synthesize(text: string, o: TtsOptions): Promise<Uint8Array> {
  const form = new FormData();
  form.append('text', text);
  if (o.voiceSample) form.append('voice_wav', new Blob([o.voiceSample.bytes.slice()], { type: 'audio/wav' }), o.voiceSample.name);
  else if (o.voice) form.append('voice_url', o.voice);
  let res: Response;
  try {
    res = await fetch(`${o.url}/tts`, { method: 'POST', body: form });
  } catch {
    throw new Error(`Pocket TTS ne répond pas sur ${o.url}. Lance-le avec : pocket-tts serve --language french --port 8001`);
  }
  if (!res.ok) throw new Error(`Pocket TTS a renvoyé l'erreur ${res.status} : ${(await res.text()).slice(0, 300)}`);
  return fixWavHeader(new Uint8Array(await res.arrayBuffer()));
}
