// ═══════════════════════════════════════════════════════════
// constants.ts — LumVibe Shared Constants
// Preserves ALL original data from create.tsx exactly
// ═══════════════════════════════════════════════════════════

import type { VoiceEffect, FxEffect, FilterDef, AREffect } from './types';

// ─── CLOUDINARY ───────────────────────────────────────────
export const CLOUDINARY_CLOUD_NAME    = 'dvllxm0wg';
export const CLOUDINARY_UPLOAD_PRESET = 'Kinsta_unsigned';
export const FREESOUND_API_KEY        = 'K5SiYeV1UYuTfxh5iHcNwNgB6yTvWkAuKaqbpLdK';
export const DRAFTS_STORAGE_KEY       = 'lumvibe_drafts_v1';
export const MAX_DRAFTS               = 20;
export const VIDEO_SIZE_LIMIT_MB      = 50;
export const MUSIC_UPLOAD_LIMIT_MB    = 15;

// ─── VOICE EFFECTS — exact from original create.tsx ──────
export const VOICE_EFFECTS: VoiceEffect[] = [
  {
    id:'none', name:'Original', emoji:'🎤', category:'Basic',
    desc:'Your real voice', explain:'No processing.',
    cloudinaryPitch:null, cloudinaryVolume:null, cloudinaryReverse:false,
    rate:1.0, previewVolume:1.0, reverb:0, echo:0,
    chorus:false, compress:false, highpass:80, lowpass:18000, presence:0,
  },
  {
    id:'deep', name:'Deep Voice', emoji:'🎙️', category:'Pitch',
    desc:'Rich, low & authoritative', explain:'Pitch shifted down 4 semitones.',
    cloudinaryPitch:-400, cloudinaryVolume:null, cloudinaryReverse:false,
    rate:0.92, previewVolume:1.0, reverb:0.15, echo:0,
    chorus:false, compress:true, highpass:60, lowpass:16000, presence:-2,
  },
  {
    id:'helium', name:'Helium', emoji:'🎈', category:'Pitch',
    desc:'High-pitched & playful', explain:'Classic chipmunk pitch-up.',
    cloudinaryPitch:500, cloudinaryVolume:null, cloudinaryReverse:false,
    rate:1.18, previewVolume:0.9, reverb:0, echo:0,
    chorus:false, compress:false, highpass:200, lowpass:18000, presence:3,
  },
  {
    id:'robot', name:'Robot', emoji:'🤖', category:'FX',
    desc:'Synthetic & mechanical', explain:'Ring modulation simulation.',
    cloudinaryPitch:null, cloudinaryVolume:null, cloudinaryReverse:false,
    rate:1.0, previewVolume:1.0, reverb:0.05, echo:120,
    chorus:false, compress:true, highpass:300, lowpass:6000, presence:5,
  },
  {
    id:'echo', name:'Canyon Echo', emoji:'🏔️', category:'Space',
    desc:'Huge reverberant space', explain:'Long reverb tail.',
    cloudinaryPitch:null, cloudinaryVolume:null, cloudinaryReverse:false,
    rate:1.0, previewVolume:0.85, reverb:0.75, echo:350,
    chorus:false, compress:true, highpass:100, lowpass:15000, presence:1,
  },
  {
    id:'studio', name:'Studio Pro', emoji:'🎚️', category:'Studio',
    desc:'Clean professional sound', explain:'Compression + light reverb.',
    cloudinaryPitch:null, cloudinaryVolume:null, cloudinaryReverse:false,
    rate:1.0, previewVolume:1.0, reverb:0.22, echo:0,
    chorus:false, compress:true, highpass:90, lowpass:16500, presence:2,
  },
  {
    id:'telephone', name:'Telephone', emoji:'📞', category:'FX',
    desc:'Retro phone filter', explain:'Narrow bandpass 300–3400Hz.',
    cloudinaryPitch:null, cloudinaryVolume:null, cloudinaryReverse:false,
    rate:1.0, previewVolume:0.9, reverb:0.05, echo:0,
    chorus:false, compress:true, highpass:300, lowpass:3400, presence:4,
  },
  {
    id:'chorus', name:'Choir', emoji:'🎶', category:'Space',
    desc:'Multiple voices together', explain:'Chorus effect — 3 pitch layers.',
    cloudinaryPitch:null, cloudinaryVolume:null, cloudinaryReverse:false,
    rate:1.0, previewVolume:0.88, reverb:0.45, echo:60,
    chorus:true, compress:false, highpass:100, lowpass:16000, presence:0,
  },
  {
    id:'afrobeats', name:'Afrobeats', emoji:'🥁', category:'Studio',
    desc:'Lagos studio warmth', explain:'Mid-forward EQ, warm low-end.',
    cloudinaryPitch:null, cloudinaryVolume:null, cloudinaryReverse:false,
    rate:1.0, previewVolume:1.0, reverb:0.18, echo:0,
    chorus:false, compress:true, highpass:85, lowpass:17000, presence:3,
  },
  {
    id:'reverse', name:'Reverse', emoji:'🔄', category:'FX',
    desc:'Backwards audio magic', explain:'Audio reversed.',
    cloudinaryPitch:null, cloudinaryVolume:null, cloudinaryReverse:true,
    rate:1.0, previewVolume:1.0, reverb:0, echo:0,
    chorus:false, compress:false, highpass:80, lowpass:18000, presence:0,
  },
  {
    id:'underwater', name:'Underwater', emoji:'🌊', category:'FX',
    desc:'Submerged & dreamy', explain:'Heavy low-pass + chorus.',
    cloudinaryPitch:null, cloudinaryVolume:null, cloudinaryReverse:false,
    rate:0.96, previewVolume:0.8, reverb:0.6, echo:200,
    chorus:true, compress:false, highpass:80, lowpass:800, presence:-3,
  },
  {
    id:'autotune', name:'Auto-Tune', emoji:'🎵', category:'Studio',
    desc:'Melodic pitch correction', explain:'Chromatic scale snapping.',
    cloudinaryPitch:null, cloudinaryVolume:null, cloudinaryReverse:false,
    rate:1.0, previewVolume:1.0, reverb:0.12, echo:0,
    chorus:false, compress:true, highpass:90, lowpass:16000, presence:4,
  },
];

// ─── FX EFFECTS — exact from original create.tsx ─────────
export const FX_EFFECTS: FxEffect[] = [
  { id:'fx_none',           name:'None',           emoji:'✖️', category:'Basic',   desc:'No FX',              brightness:1,    contrast:1,    saturation:1    },
  { id:'fx_duotone_purple', name:'Purple Duotone', emoji:'💜', category:'Duotone', desc:'Purple wash',        brightness:1,    contrast:1.1,  saturation:0.8  },
  { id:'fx_duotone_gold',   name:'Gold Duotone',   emoji:'✨', category:'Duotone', desc:'Gold wash',          brightness:1.05, contrast:1.05, saturation:0.85 },
  { id:'fx_light_leak',     name:'Light Leak',     emoji:'🌟', category:'Film',    desc:'Warm light bleed',   brightness:1.1,  contrast:0.95, saturation:1.1  },
  { id:'fx_bleach',         name:'Bleach',         emoji:'⬜', category:'Film',    desc:'Bleach bypass',      brightness:1.08, contrast:1.2,  saturation:0.6  },
  { id:'fx_noir_contrast',  name:'Noir',           emoji:'🎬', category:'Film',    desc:'High contrast noir', brightness:0.9,  contrast:1.5,  saturation:0    },
  { id:'fx_sunrise',        name:'Sunrise',        emoji:'🌅', category:'Warm',    desc:'Warm sunrise glow',  brightness:1.1,  contrast:1.05, saturation:1.2  },
  { id:'fx_deep_ocean',     name:'Deep Ocean',     emoji:'🌊', category:'Cool',    desc:'Deep blue tones',    brightness:0.95, contrast:1.1,  saturation:0.9  },
  { id:'fx_lomo',           name:'Lomo',           emoji:'📷', category:'Film',    desc:'Lomography look',    brightness:0.95, contrast:1.25, saturation:1.3  },
  { id:'fx_teal_orange',    name:'Teal & Orange',  emoji:'🎥', category:'Cinema',  desc:'Cinematic grade',    brightness:1,    contrast:1.15, saturation:1.1  },
  { id:'fx_grunge',         name:'Grunge',         emoji:'🤘', category:'Gritty',  desc:'Dirty, raw',         brightness:0.9,  contrast:1.3,  saturation:0.7  },
  { id:'fx_pastel',         name:'Pastel',         emoji:'🎀', category:'Soft',    desc:'Soft pastel tones',  brightness:1.1,  contrast:0.85, saturation:0.9  },
  { id:'fx_midnight',       name:'Midnight',       emoji:'🌙', category:'Dark',    desc:'Deep midnight blue', brightness:0.8,  contrast:1.3,  saturation:0.7  },
  { id:'fx_chrome',         name:'Chrome',         emoji:'⚙️', category:'Metal',   desc:'Cold chrome finish', brightness:1.05, contrast:1.2,  saturation:0.5  },
  { id:'fx_pop_art',        name:'Pop Art',        emoji:'🎨', category:'Art',     desc:'Vivid pop art',      brightness:1.05, contrast:1.2,  saturation:2.0  },
  { id:'fx_cross_process',  name:'Cross Process',  emoji:'🔬', category:'Film',    desc:'Cross-processed film',brightness:1,   contrast:1.15, saturation:1.4  },
  { id:'fx_aura',           name:'Aura',           emoji:'💫', category:'Glow',    desc:'Soft aura glow',     brightness:1.08, contrast:0.95, saturation:1.1  },
];

// ─── FILTERS — exact from original create.tsx ─────────────
export const FILTERS: FilterDef[] = [
  { id:'original', name:'Original', emoji:'✨', tintColor:null,                      dbTint:null,                      dbKey:'none',      cinematicBars:false, manipulator:{brightness:1,    contrast:1,    saturate:1   } },
  { id:'beauty',   name:'Beauty',   emoji:'💄', tintColor:'rgba(255,200,200,0.18)',  dbTint:'rgba(255,200,200,0.18)',  dbKey:'beauty',    cinematicBars:false, manipulator:{brightness:1.04, contrast:0.95, saturate:1.15} },
  { id:'vintage',  name:'Vintage',  emoji:'📷', tintColor:'rgba(180,120,60,0.25)',   dbTint:'rgba(180,120,60,0.25)',   dbKey:'vintage',   cinematicBars:false, manipulator:{brightness:0.98, contrast:0.9,  saturate:0.7 } },
  { id:'cool',     name:'Cool',     emoji:'❄️', tintColor:'rgba(100,180,255,0.22)',  dbTint:'rgba(100,180,255,0.22)',  dbKey:'cool',      cinematicBars:false, manipulator:{brightness:1.0,  contrast:1.1,  saturate:0.9 } },
  { id:'warm',     name:'Warm',     emoji:'🔥', tintColor:'rgba(255,160,50,0.22)',   dbTint:'rgba(255,160,50,0.22)',   dbKey:'warm',      cinematicBars:false, manipulator:{brightness:1.03, contrast:1.05, saturate:1.2 } },
  { id:'dramatic', name:'Dramatic', emoji:'🎭', tintColor:'rgba(0,0,0,0.35)',        dbTint:'rgba(0,0,0,0.35)',        dbKey:'dramatic',  cinematicBars:false, manipulator:{brightness:0.95, contrast:1.5,  saturate:0.85} },
  { id:'bright',   name:'Bright',   emoji:'☀️', tintColor:'rgba(255,255,200,0.18)',  dbTint:'rgba(255,255,200,0.18)',  dbKey:'bright',    cinematicBars:false, manipulator:{brightness:1.1,  contrast:0.95, saturate:1.1 } },
  { id:'noir',     name:'Noir',     emoji:'🎬', tintColor:'rgba(0,0,0,0.5)',         dbTint:'rgba(0,0,0,0.5)',         dbKey:'noir',      cinematicBars:false, manipulator:{brightness:0.96, contrast:1.6,  saturate:0.0 } },
  { id:'neon',     name:'Neon',     emoji:'💚', tintColor:'rgba(0,255,136,0.2)',     dbTint:'rgba(0,255,136,0.2)',     dbKey:'neon',      cinematicBars:false, manipulator:{brightness:1.0,  contrast:1.3,  saturate:2.0 } },
  { id:'sunset',   name:'Sunset',   emoji:'🌅', tintColor:'rgba(255,80,80,0.25)',    dbTint:'rgba(255,80,80,0.25)',    dbKey:'sunset',    cinematicBars:false, manipulator:{brightness:1.02, contrast:1.2,  saturate:1.4 } },
  { id:'cinematic',name:'Cinematic',emoji:'🎥', tintColor:'rgba(20,10,40,0.45)',     dbTint:'rgba(20,10,40,0.45)',     dbKey:'cinematic', cinematicBars:true,  manipulator:{brightness:0.97, contrast:1.25, saturate:0.8 } },
  { id:'golden',   name:'Golden',   emoji:'✨', tintColor:'rgba(255,200,50,0.22)',   dbTint:'rgba(255,200,50,0.22)',   dbKey:'golden',    cinematicBars:false, manipulator:{brightness:1.04, contrast:1.08, saturate:1.3 } },
  { id:'rose',     name:'Rose',     emoji:'🌸', tintColor:'rgba(255,100,150,0.22)',  dbTint:'rgba(255,100,150,0.22)', dbKey:'rose',      cinematicBars:false, manipulator:{brightness:1.03, contrast:1.0,  saturate:1.1 } },
  { id:'glitch',   name:'Glitch',   emoji:'⚡', tintColor:'rgba(255,0,80,0.15)',     dbTint:'rgba(255,0,80,0.15)',     dbKey:'glitch',    cinematicBars:false, glitchEffect:true, manipulator:{brightness:1.0, contrast:1.35, saturate:1.8} },
];

// ─── AR EFFECTS — exact from original create.tsx ─────────
export const AR_EFFECTS: AREffect[] = [
  { id:'ar_none',      name:'None',       emoji:'✖️', type:'none',     skiaAnchor:null,      offsetY:0,    size:0  },
  { id:'ar_flowers',   name:'Flowers',    emoji:'🌸', type:'float',    skiaAnchor:null,      offsetY:0,    size:36 },
  { id:'ar_stars',     name:'Stars',      emoji:'⭐', type:'float',    skiaAnchor:null,      offsetY:0,    size:30 },
  { id:'ar_hearts',    name:'Hearts',     emoji:'❤️', type:'float',    skiaAnchor:null,      offsetY:0,    size:32 },
  { id:'ar_money',     name:'Money Rain', emoji:'💸', type:'float',    skiaAnchor:null,      offsetY:0,    size:32 },
  { id:'ar_fire',      name:'Fire',       emoji:'🔥', type:'float',    skiaAnchor:null,      offsetY:0,    size:36 },
  { id:'ar_bunny',     name:'Bunny Face', emoji:'🐰', type:'face_top', skiaAnchor:'noseTip', offsetY:-120, size:80 },
  { id:'ar_crown',     name:'Crown',      emoji:'👑', type:'face_top', skiaAnchor:'noseTip', offsetY:-130, size:90 },
  { id:'ar_glasses',   name:'Glasses',    emoji:'🕶️', type:'face_mid', skiaAnchor:'noseTip', offsetY:-30,  size:80 },
  { id:'ar_party',     name:'Party',      emoji:'🎉', type:'float',    skiaAnchor:null,      offsetY:0,    size:32 },
  { id:'ar_sparkle',   name:'Sparkle',    emoji:'✨', type:'float',    skiaAnchor:null,      offsetY:0,    size:28 },
  { id:'ar_rainbow',   name:'Rainbow',    emoji:'🌈', type:'top',      skiaAnchor:null,      offsetY:0,    size:72 },
  { id:'ar_sunflower', name:'Sunflower',  emoji:'🌻', type:'float',    skiaAnchor:null,      offsetY:0,    size:34 },
  { id:'ar_diamond',   name:'Diamonds',   emoji:'💎', type:'float',    skiaAnchor:null,      offsetY:0,    size:30 },
];

// ─── ANIMATED BACKGROUNDS — exact from original ───────────
export const ANIMATED_BACKGROUNDS = [
  { id:'bg_none',   name:'None',         emoji:'✖️', type:'solid',    value:'transparent', colors:[] as string[] },
  { id:'bg_city',   name:'City Night',   emoji:'🌃', type:'animated', value:'',            colors:['#0a0a2e','#1a1a4e','#0d0d1f'] },
  { id:'bg_beach',  name:'Beach Sunset', emoji:'🏖️', type:'animated', value:'',            colors:['#ff6b35','#f7c59f','#4ecdc4'] },
  { id:'bg_space',  name:'Deep Space',   emoji:'🌌', type:'animated', value:'',            colors:['#0a0010','#1a0030','#000820'] },
  { id:'bg_club',   name:'Club Lights',  emoji:'🎉', type:'animated', value:'',            colors:['#ff0080','#7c3aed','#00ff88'] },
  { id:'bg_forest', name:'Forest',       emoji:'🌲', type:'animated', value:'',            colors:['#134e5e','#71b280','#1a3a1a'] },
  { id:'bg_fire',   name:'Fire Inferno', emoji:'🔥', type:'animated', value:'',            colors:['#ff4500','#ff8c00','#cc0000'] },
  { id:'bg_ocean',  name:'Deep Ocean',   emoji:'🌊', type:'animated', value:'',            colors:['#001219','#0077b6','#00b4d8'] },
  { id:'bg_gold',   name:'Golden Hour',  emoji:'✨', type:'animated', value:'',            colors:['#f9c74f','#f8961e','#f3722c'] },
  { id:'bg_matrix', name:'Matrix',       emoji:'💻', type:'animated', value:'',            colors:['#000000','#003300','#00ff00'] },
  { id:'bg_white',  name:'Pure White',   emoji:'⬜', type:'solid',    value:'#ffffff',     colors:[] as string[] },
  { id:'bg_black',  name:'Pure Black',   emoji:'⬛', type:'solid',    value:'#000000',     colors:[] as string[] },
];

// ─── VIBE TYPES — exact from original ─────────────────────
export const VIBE_TYPES = [
  {id:'fire',    label:'Fire',      emoji:'🔥',color:'#ff4500',description:'Hot & trending'  },
  {id:'funny',   label:'Funny',     emoji:'😂',color:'#ffd700',description:'Made me laugh'   },
  {id:'shocking',label:'Shocking',  emoji:'😱',color:'#ff6b35',description:"Can't believe it"},
  {id:'love',    label:'Love',      emoji:'❤️',color:'#ff1744',description:'Heartfelt'       },
  {id:'mindblow',label:'Mind-blown',emoji:'🤯',color:'#aa00ff',description:'This is crazy'   },
  {id:'dead',    label:'Dead 💀',   emoji:'💀',color:'#00e5ff',description:'Too funny'       },
  {id:'hype',    label:'Hype',      emoji:'🚀',color:'#00ff88',description:'Gets you hyped'  },
  {id:'sad',     label:'Sad',       emoji:'😢',color:'#448aff',description:'Emotional'       },
];

// ─── SPEED OPTIONS — exact from original ──────────────────
export const SPEED_OPTIONS = [
  {id:'slow_025',label:'0.25x',emoji:'🐌',rate:0.25,dbKey:'slow_025'},
  {id:'slow_05', label:'0.5x', emoji:'🐢',rate:0.5, dbKey:'slow_05' },
  {id:'normal',  label:'1x',   emoji:'▶️', rate:1.0, dbKey:'none'    },
  {id:'fast_15', label:'1.5x', emoji:'⚡', rate:1.5, dbKey:'fast_15' },
  {id:'fast_2',  label:'2x',   emoji:'🚀',rate:2.0, dbKey:'fast_2'  },
];

// ─── EFFECT BURSTS — exact from original ──────────────────
export const EFFECT_BURSTS = [
  { id:'burst_fireworks', emoji:'🎆', name:'Fireworks', effect:'fireworks' },
  { id:'burst_hearts',    emoji:'❤️', name:'Hearts',    effect:'hearts'    },
  { id:'burst_explosion', emoji:'💥', name:'Explosion', effect:'explosion' },
  { id:'burst_rainbow',   emoji:'🌈', name:'Rainbow',   effect:'rainbow'   },
  { id:'burst_lightning', emoji:'⚡', name:'Lightning', effect:'lightning' },
  { id:'burst_sparkle',   emoji:'✨', name:'Sparkle',   effect:'sparkle'   },
];

// ─── STYLE EFFECTS — exact from original ──────────────────
export const STYLE_EFFECTS = [
  { id:'style_none',   name:'None',          emoji:'✖️', desc:'No style effect',                  ffmpegFilter:'' },
  { id:'style_anime',  name:'Anime',         emoji:'🎌', desc:'Edge detection, flat colors',       ffmpegFilter:'edgedetect=low=0.1:high=0.4:mode=colormix,eq=saturation=2.5:contrast=1.6' },
  { id:'style_comic',  name:'Comic Book',    emoji:'💥', desc:'Posterization and halftone',        ffmpegFilter:'curves=preset=strong_contrast,eq=saturation=2.2,erosion' },
  { id:'style_pixar',  name:'Pixar 3D',      emoji:'✨', desc:'Skin smoothing, warm highlights',   ffmpegFilter:'unsharp=5:5:1.2:5:5:0,eq=brightness=0.04:saturation=1.3:contrast=1.05,colorchannelmixer=1.02:0:0:0:0:0.98:0:0:0:0:0.95' },
  { id:'style_sketch', name:'Pencil Sketch', emoji:'✏️', desc:'Grayscale Gaussian blur',           ffmpegFilter:'format=gray,unsharp=5:5:3:5:5:0,eq=contrast=2.5:brightness=0.1' },
  { id:'style_neon',   name:'Neon Cyberpunk',emoji:'🌆', desc:'Edge neon, scanlines',              ffmpegFilter:'edgedetect=low=0.05:high=0.2:mode=colormix,eq=saturation=3.0:contrast=1.8,rgbashift=rh=2:bh=-2' },
];

// ─── FFMPEG VIDEO FILTERS — exact from original ───────────
export const FFMPEG_VIDEO_FILTERS: Record<string, string> = {
  original:  '',
  beauty:    'unsharp=5:5:1.5:5:5:0,eq=brightness=0.05:contrast=1.1:saturation=1.2',
  vintage:   'curves=vintage,eq=saturation=0.7:brightness=-0.05',
  cool:      'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131,eq=contrast=1.1',
  warm:      'eq=saturation=1.3:brightness=0.05,colorchannelmixer=1.1:0:0:0:0:0.9:0:0:0:0:0:0.8',
  dramatic:  'eq=contrast=1.4:brightness=-0.1:saturation=1.5,vignette',
  bright:    'eq=brightness=0.08:contrast=0.95:saturation=1.1',
  noir:      'colorchannelmixer=.299:.587:.114:0:.299:.587:.114:0:.299:.587:.114,eq=contrast=1.6:brightness=-0.04',
  neon:      'eq=contrast=1.3:saturation=2.0,hue=s=2',
  sunset:    'eq=saturation=1.4:brightness=0.02:contrast=1.2,colorchannelmixer=1.1:0:0:0:0:0.9:0:0:0:0:0:0.8',
  cinematic: 'curves=preset=strong_contrast,vignette,pad=iw:ih+80:0:40:black,crop=iw:ih-80:0:40',
  golden:    'eq=brightness=0.04:contrast=1.08:saturation=1.3,colorchannelmixer=1.1:0:0:0:0:0.95:0:0:0:0:0:0.85',
  rose:      'eq=brightness=0.03:saturation=1.1,colorchannelmixer=1.05:0:0:0:0:0.9:0:0:0:0:0:0.95',
  glitch:    'rgbashift=rh=3:bh=-3,chromashift=cbh=2:crh=-2,eq=contrast=1.35:saturation=1.8',
};

// ─── MUSICAL NOTES ────────────────────────────────────────
export const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

export function frequencyToNote(freq: number): { note: string; octave: number; cents: number } {
  if (freq <= 0) return { note: '—', octave: 0, cents: 0 };
  const semitones = 12 * Math.log2(freq / 440) + 57;
  const rounded   = Math.round(semitones);
  const note      = NOTE_NAMES[((rounded % 12) + 12) % 12];
  const octave    = Math.floor(rounded / 12);
  const cents     = Math.round((semitones - rounded) * 100);
  return { note, octave, cents };
}

// ─── SCENE LABELS ─────────────────────────────────────────
export const SCENE_LABELS = [
  'Intro', 'Verse 1', 'Pre-Chorus', 'Chorus', 'Verse 2',
  'Bridge', 'Outro', 'Hook', 'Skit', 'Ad-lib',
];

export const MAX_RECORD_SECS   = 180;
export const MAX_SCENE_SECS    = 60;
export const METRONOME_MIN_BPM = 40;
export const METRONOME_MAX_BPM = 220; 
