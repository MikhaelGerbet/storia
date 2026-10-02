// Faux Ollama, Pocket TTS et ComfyUI sur un même port, pour tester la chaîne sans modèles.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

export const SAMPLE_DRAFT = {
  titre: 'La Lanterne du Capitaine Brume',
  accroche: 'Dans une grotte que la mer garde secrète, un vieux navire attend son heure.',
  segments: [
    { texte: 'Plic… ploc… Dans la grotte, la mer respire tout doucement.', effet: 'goutte' },
    { texte: 'La lune glisse un rayon d’argent sur l’eau noire…', effet: 'vague' },
    { texte: 'et là, au milieu des reflets, un vieux bateau pirate sommeille.', effet: 'aucun' },
    { texte: 'Ses voiles rapiécées frissonnent à peine.', effet: 'aucun' },
    { texte: 'Personne ne l’a vu depuis cent ans…', effet: 'cloche' },
    { texte: 'Jusqu’à cette nuit.', effet: 'aucun' },
  ],
  decor_en: 'Glowworms twinkle like tiny blue stars on the cave ceiling.',
};

/** Histoire complète écrite d'après une composition (pirates, renarde, île, perroquet, boussole, tempête). */
export const SAMPLE_STORY = {
  titre: 'La Boussole qui chantait',
  accroche: 'Une petite renarde suit une boussole qui fredonne vers une île oubliée.',
  ambiance: 'mer',
  segments: [
    { texte: 'Il était une fois une petite renarde curieuse…', effet: 'aucun' },
    { texte: 'qui trouva, au fond d’un coffre, une boussole qui chantait.', effet: 'magie' },
    { texte: 'La boussole fredonnait toujours la même chanson :', effet: 'aucun' },
    { texte: '« Vers l’île aux trésors, petite renarde ! »', effet: 'vague' },
    { texte: 'Avec son ami le perroquet, elle prit la mer.', effet: 'vent' },
    { texte: 'Soudain, une tempête se leva…', effet: 'vent' },
    { texte: 'La renarde chanta avec la boussole, et le ciel se calma.', effet: 'lumiere' },
    { texte: 'Sur l’île, un trésor brillait : des étoiles de mer qui riaient.', effet: 'revelation' },
    { texte: 'Le soir venu, la renarde s’endormit en souriant.', effet: 'cloche' },
  ],
  mots_cles: ['Renarde', 'boussole', 'île', 'tempête'],
  decor_en: 'A little fox on a small sailboat at sunset near a tropical island',
  mouvement_en: 'The sea gently sways, the sail breathes in the wind, sparkles drift in the air',
};

/** WAV 16 bits mono comme ceux de Pocket TTS : l'en-tête annonce un milliard d'échantillons. */
export function streamingWav(seconds: number, rate = 24000, freq = 220): Buffer {
  const n = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + 1_000_000_000 * 2, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(1_000_000_000 * 2, 40);
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, i / 600, (n - i) / 600);
    b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 8000 * fade), 44 + i * 2);
  }
  return b;
}

export interface MockServices {
  url: string;
  calls: { chat: unknown[]; unload: unknown[]; tts: string[]; recit: { segments: { text: string; pause: number }[]; reglages?: Record<string, string> }[]; prompts: unknown[] };
  close: () => Promise<void>;
}

export interface MockOptions {
  draft: unknown;
  image?: Buffer;
  wavSeconds?: (text: string) => number;
  /** Sait lire une scène entière (POST /recit), comme voix/serveur_voix.py ; sinon, phrase par phrase seulement. */
  narration?: { alerte?: string };
  /** Modèles installés dans le faux Ollama (GET /api/tags). */
  models?: string[];
}

export async function startMockServices(options: MockOptions): Promise<MockServices> {
  const calls: MockServices['calls'] = { chat: [], unload: [], tts: [], recit: [], prompts: [] };
  let polls = 0;
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (req.method === 'POST' && pathname === '/api/chat') {
      const request = JSON.parse(body.toString()) as { model: string };
      calls.chat.push(request);
      return json(200, { model: request.model, message: { role: 'assistant', content: JSON.stringify(options.draft) }, done: true });
    }
    if (req.method === 'GET' && pathname === '/api/tags') {
      return json(200, { models: (options.models ?? ['mistral-small3.2:latest']).map((name) => ({ name })) });
    }
    if (req.method === 'GET' && pathname === '/health') {
      return json(200, { status: 'ok', moteur: 'faux', recit: Boolean(options.narration) });
    }
    if (req.method === 'POST' && pathname === '/api/generate') {
      calls.unload.push(JSON.parse(body.toString()));
      return json(200, { done: true, done_reason: 'unload' });
    }
    if (req.method === 'POST' && pathname === '/tts') {
      const text = /name="text"\r\n\r\n([\s\S]*?)\r\n--/.exec(body.toString('utf8'))?.[1] ?? '';
      calls.tts.push(text);
      res.writeHead(200, { 'content-type': 'audio/wav' });
      return res.end(streamingWav(options.wavSeconds?.(text) ?? 0.6));
    }
    if (req.method === 'POST' && pathname === '/recit' && options.narration) {
      const request = JSON.parse(body.toString()) as { segments: { text: string; pause: number }[]; reglages?: Record<string, string> };
      calls.recit.push(request);
      const line = (event: unknown) => res.write(`${JSON.stringify(event)}\n`);
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      line({ type: 'debut', phrases: 1, relecture: 'faux-whisper' });
      line({ type: 'phrase', numero: 1, total: 1, secondes: 1.5, parole: 3.2, essais: 2, ressemblance: 0.97, entendu: 'texte', alerte: options.narration.alerte ?? null });
      const segments = request.segments.map((s) => ({ wav: streamingWav(options.wavSeconds?.(s.text) ?? 0.6).toString('base64'), pause: s.pause + 0.1 }));
      return res.end(`${JSON.stringify({ type: 'fin', segments })}\n`);
    }
    if (req.method === 'POST' && pathname === '/prompt') {
      calls.prompts.push(JSON.parse(body.toString()));
      return json(200, { prompt_id: 'p1', number: 1, node_errors: {} });
    }
    if (req.method === 'GET' && pathname === '/history/p1') {
      polls++;
      if (polls < 2) return json(200, {});
      return json(200, {
        p1: { outputs: { '9': { images: [{ filename: 'storia_00001_.png', subfolder: '', type: 'output' }] } }, status: { status_str: 'success', completed: true } },
      });
    }
    if (req.method === 'GET' && pathname === '/view') {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(options.image ?? TINY_PNG);
    }
    return json(404, { error: 'not found' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
