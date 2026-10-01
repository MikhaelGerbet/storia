// Lecture et réparation d'en-têtes WAV.
// Pocket TTS envoie le son en flux : son en-tête annonce une taille fictive, qu'on remplace par la vraie.

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataBytes: number;
  duration: number;
}

export function wavInfo(bytes: Uint8Array): WavInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error("Ce n'est pas un fichier WAV.");
  let fmt: { channels: number; sampleRate: number; bits: number } | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      fmt = { channels: view.getUint16(body + 2, true), sampleRate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) };
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV sans description du format.');
      const available = bytes.length - body;
      const dataBytes = size === 0 || size > available ? available : size;
      const frameBytes = (fmt.channels * fmt.bits) / 8;
      return {
        sampleRate: fmt.sampleRate,
        channels: fmt.channels,
        bitsPerSample: fmt.bits,
        dataOffset: body,
        dataBytes,
        duration: dataBytes / (fmt.sampleRate * frameBytes),
      };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('WAV sans données audio.');
}

/** Renvoie une copie du WAV avec des tailles exactes dans l'en-tête. */
export function fixWavHeader(bytes: Uint8Array): Uint8Array {
  const info = wavInfo(bytes);
  const frameBytes = (info.channels * info.bitsPerSample) / 8;
  const dataBytes = info.dataBytes - (info.dataBytes % frameBytes);
  const out = bytes.slice(0, info.dataOffset + dataBytes);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(4, out.length - 8, true);
  view.setUint32(info.dataOffset - 4, dataBytes, true);
  return out;
}
