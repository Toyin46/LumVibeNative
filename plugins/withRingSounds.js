// plugins/withRingSounds.js   (REPLACES the previous one)
//
// Copies your two ringtones into the Android app under names Android accepts,
// AND repeats each one until it lasts RING_SECONDS (90 s).
//
// Why: your ringtones are ~11 s long. The notification that rings when the app
// is closed plays the file once and relies on Android to repeat it — many phones
// (Infinix/Tecno/Xiaomi/…) don't, so the ring stopped after 11 s. A 90-second
// file simply keeps ringing for the whole ring time on every phone.
//
//   src/assets/sounds/ringtone.mp3.wav      -> res/raw/call_ringtone.wav
//   src/assets/sounds/cowatch ringtone.mp3  -> res/raw/cowatch_ringtone.mp3
//
// Your original files are NOT modified (the in-app player still uses them).
// If a file can't be understood, it is copied unchanged, so the build never fails.
const fs = require('fs');
const path = require('path');

let withDangerousMod;
try { ({ withDangerousMod } = require('expo/config-plugins')); }
catch (_) { ({ withDangerousMod } = require('@expo/config-plugins')); }

const RING_SECONDS = 90;
const MAX_BYTES = 9 * 1024 * 1024; // keep the app small

const SOUNDS = [
  { from: 'src/assets/sounds/ringtone.mp3.wav', to: 'call_ringtone.wav' },
  { from: 'src/assets/sounds/cowatch ringtone.mp3', to: 'cowatch_ringtone.mp3' },
];

// ── WAV (PCM) ────────────────────────────────────────────────────────────
function extendWav(buf, seconds) {
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const start = pos + 8;
    if (id === 'fmt ') fmt = buf.subarray(start, start + size);
    if (id === 'data') { data = buf.subarray(start, Math.min(start + size, buf.length)); break; }
    pos = start + size + (size % 2);
  }
  if (!fmt || !data) return null;
  const audioFormat = fmt.readUInt16LE(0);
  let channels = fmt.readUInt16LE(2);
  const sampleRate = fmt.readUInt32LE(4);
  let blockAlign = fmt.readUInt16LE(12);
  const bits = fmt.readUInt16LE(14);
  if (audioFormat !== 1 || !channels || !blockAlign) return null; // only plain PCM

  const oneSecond = sampleRate * blockAlign;
  const clipSeconds = data.length / oneSecond;
  if (clipSeconds < 0.5) return null;
  if (clipSeconds >= seconds) return buf; // already long enough

  let clip = data.subarray(0, data.length - (data.length % blockAlign));
  // too big for the app? 16-bit stereo -> mono halves it
  if (Math.ceil(seconds / clipSeconds) * clip.length > MAX_BYTES && bits === 16 && channels === 2) {
    const mono = Buffer.alloc(clip.length / 2);
    for (let i = 0, o = 0; i < clip.length; i += 4, o += 2) {
      mono.writeInt16LE(Math.round((clip.readInt16LE(i) + clip.readInt16LE(i + 2)) / 2), o);
    }
    clip = mono; channels = 1; blockAlign = 2;
  }
  const wantBytes = Math.floor(seconds * sampleRate) * blockAlign;
  const out = Buffer.alloc(wantBytes);
  for (let o = 0; o < wantBytes; o += clip.length) clip.copy(out, o, 0, Math.min(clip.length, wantBytes - o));

  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + out.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32); header.writeUInt16LE(bits, 34);
  header.write('data', 36); header.writeUInt32LE(out.length, 40);
  return Buffer.concat([header, out]);
}

// ── MP3 (also handles an MP3 that was renamed to .wav) ───────────────────
const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
function extendMp3(buf, seconds) {
  let start = 0;
  if (buf.toString('ascii', 0, 3) === 'ID3') {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    start = 10 + size;
  }
  let end = buf.length;
  if (end - 128 >= start && buf.toString('ascii', end - 128, end - 125) === 'TAG') end -= 128;
  if (!(buf[start] === 0xff && (buf[start + 1] & 0xe0) === 0xe0)) return null; // not an MP3 frame
  const audio = buf.subarray(start, end);

  // duration from the first frame's bitrate (constant-bitrate ringtones)
  let kbps = 128;
  const idx = (buf[start + 2] >> 4) & 0x0f;
  if (idx > 0 && idx < 15) kbps = BITRATES_V1_L3[idx];
  const clipSeconds = (audio.length * 8) / (kbps * 1000);
  if (clipSeconds < 0.5) return null;
  if (clipSeconds >= seconds) return buf;
  const repeats = Math.ceil(seconds / clipSeconds);
  if (repeats * audio.length > MAX_BYTES * 2) return null;
  return Buffer.concat(Array(repeats).fill(audio));
}

function extend(buf) {
  try {
    const isWav = buf.length > 44 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE';
    const out = isWav ? extendWav(buf, RING_SECONDS) : extendMp3(buf, RING_SECONDS);
    return out || buf;
  } catch (e) {
    console.warn('[withRingSounds] could not lengthen a ringtone, copying it unchanged:', e.message);
    return buf;
  }
}

module.exports = function withRingSounds(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const rawDir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'raw');
      fs.mkdirSync(rawDir, { recursive: true });
      for (const { from, to } of SOUNDS) {
        const src = path.join(cfg.modRequest.projectRoot, from);
        if (!fs.existsSync(src)) {
          console.warn(`[withRingSounds] missing ${from} — that ring will use the default sound`);
          continue;
        }
        const original = fs.readFileSync(src);
        const lengthened = extend(original);
        fs.writeFileSync(path.join(rawDir, to), lengthened);
        console.log(`[withRingSounds] ${to}: ${(original.length / 1024).toFixed(0)} KB -> ${(lengthened.length / 1024).toFixed(0)} KB`);
      }
      return cfg;
    },
  ]);
};

module.exports.extend = extend; // (for testing)
