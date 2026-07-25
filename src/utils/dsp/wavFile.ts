// ═══════════════════════════════════════════════════════════
// wavFile.ts — Encode raw PCM float channels into a playable .wav file
// src/utils/dsp/wavFile.ts
// WAV is uncompressed PCM with a 44-byte header — simple enough to write
// by hand, so we need zero external encoder/binary for this step.
// ═══════════════════════════════════════════════════════════

import { File, Paths } from 'expo-file-system';
import { encode as base64Encode } from 'base64-arraybuffer';

function clampSample(x: number): number {
  return Math.max(-1, Math.min(1, x));
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/**
* Interleaves N float channels (range -1..1) into a 16-bit PCM WAV byte buffer.
* Returns the raw ArrayBuffer (not a Uint8Array view) — Uint8Array.buffer is
* typed as ArrayBufferLike in current TS lib defs (to allow SharedArrayBuffer),
* which base64-arraybuffer's encode() correctly refuses. Returning the buffer
* we constructed ourselves sidesteps that ambiguity entirely.
*/
export function encodePcm16Wav(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const numChannels   = channels.length;
  const numFrames     = channels[0]?.length ?? 0;
  const bytesPerSample= 2;
  const blockAlign    = numChannels * bytesPerSample;
  const byteRate      = sampleRate * blockAlign;
  const dataSize       = numFrames * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view   = new DataView(buffer);

  // RIFF/WAVE header
  writeAscii(view, 0,  'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8,  'WAVE');

  // fmt chunk
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);                  // PCM fmt chunk size
  view.setUint16(20, 1, true);                   // audio format = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);  // bits per sample

  // data chunk
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = clampSample(channels[c][i]);
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return buffer;
}

/**
* Encodes channels to WAV and writes them to the app's cache directory.
* Returns a file:// URI usable anywhere a recording URI is expected
* (playback, upload, onComplete callback).
*/
export async function saveBufferAsWav(
  channels:   Float32Array[],
  sampleRate: number,
  fileName:   string,
): Promise<string> {
  const wavBuffer = encodePcm16Wav(channels, sampleRate);
  const base64    = base64Encode(wavBuffer);

  const file = new File(Paths.cache, fileName);
  await file.write(base64, { encoding: 'base64' });
  return file.uri;
} 
