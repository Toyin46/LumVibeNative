// plugins/withRingSounds.js   (NEW FILE)
//
// Copies your two ringtones into the Android app under names Android accepts.
// Android resource names must be lowercase letters / digits / underscores, so
// "cowatch ringtone.mp3" (space) and "ringtone.mp3.wav" (extra dot) can't be
// used as-is by the notification channel. Your original files stay untouched
// (the in-app player still loads them from src/assets/sounds).
//
//   src/assets/sounds/ringtone.mp3.wav      -> res/raw/call_ringtone.wav
//   src/assets/sounds/cowatch ringtone.mp3  -> res/raw/cowatch_ringtone.mp3
const fs = require('fs');
const path = require('path');

let withDangerousMod;
try { ({ withDangerousMod } = require('expo/config-plugins')); }
catch (_) { ({ withDangerousMod } = require('@expo/config-plugins')); }

const SOUNDS = [
  { from: 'src/assets/sounds/ringtone.mp3.wav', to: 'call_ringtone.wav' },
  { from: 'src/assets/sounds/cowatch ringtone.mp3', to: 'cowatch_ringtone.mp3' },
];

module.exports = function withRingSounds(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const rawDir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'raw');
      fs.mkdirSync(rawDir, { recursive: true });
      for (const { from, to } of SOUNDS) {
        const src = path.join(cfg.modRequest.projectRoot, from);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(rawDir, to));
        } else {
          console.warn(`[withRingSounds] missing ${from} — that ring will use the default sound`);
        }
      }
      return cfg;
    },
  ]);
};
