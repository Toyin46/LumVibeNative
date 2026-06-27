// ═══════════════════════════════════════════════════════════
// types.ts — LumVibe Shared TypeScript Types
// All types used across create, studio, coach, camera screens
// ═══════════════════════════════════════════════════════════

export type MediaType  = 'image' | 'video' | 'text' | 'voice' | null;
export type CameraMode = 'video' | 'picture';
export type ScreenView = 'camera' | 'compose' | 'drafts';
export type CameraFeature = 'normal' | 'animatedbg' | 'effectburst' | 'dualcam';
export type FacingMode = 'front' | 'back';
export type FlashMode = 'off' | 'on';

// ─── VOICE EFFECT ─────────────────────────────────────────
export interface VoiceEffect {
  id: string;
  name: string;
  emoji: string;
  category: string;
  desc: string;
  explain: string;
  cloudinaryPitch?: number | null;
  cloudinaryVolume?: number | null;
  cloudinaryReverse?: boolean;
  rate: number;
  previewVolume: number;
  reverb: number;
  echo: number;
  chorus: boolean;
  compress: boolean;
  highpass: number;
  lowpass: number;
  presence: number;
}

// ─── FX EFFECT ────────────────────────────────────────────
export interface FxEffect {
  id: string;
  name: string;
  emoji: string;
  category: string;
  desc: string;
  brightness: number;
  contrast: number;
  saturation: number;
}

// ─── FILTER ───────────────────────────────────────────────
export interface FilterDef {
  id: string;
  name: string;
  emoji: string;
  tintColor: string | null;
  dbTint: string | null;
  dbKey: string;
  cinematicBars: boolean;
  glitchEffect?: boolean;
  manipulator: { brightness: number; contrast: number; saturate?: number };
}

// ─── DRAFT ────────────────────────────────────────────────
export interface Draft {
  id: string;
  createdAt: string;
  mediaUri: string | null;
  originalMediaUri: string | null;
  mediaType: MediaType;
  caption: string;
  statusContent: string;
  statusType: 'text' | 'voice';
  statusBackground: string;
  statusVoiceUri: string | null;
  statusVoiceDuration: number;
  filter: string;
  speedId: string;
  blurEnabled: boolean;
  selectedVibe: string | null;
  selectedFx: string;
  selectedMusic: string | null;
  selectedMusicName: string | null;
  musicArtist: string | null;
  musicVolume: number;
  originalVolume: number;
  location: string | null;
  locationCoords: { latitude: number; longitude: number } | null;
  addWatermark: boolean;
  autoOptimize: boolean;
  isScheduled: boolean;
  scheduledFor: string | null;
}

// ─── POST INSERT DATA ──────────────────────────────────────
export interface PostInsertData {
  user_id: string;
  caption: string;
  likes_count: number;
  comments_count: number;
  views_count: number;
  coins_received: number;
  created_at: string;
  is_published: boolean;
  scheduled_for: string | null;
  has_watermark: boolean;
  auto_optimized: boolean;
  applied_filter: string;
  video_effect: string;
  video_filter_tint: string | null;
  playback_rate: number | null;
  vibe_type: string | null;
  voice_auto_tune: boolean;
  blur_enabled: boolean;
  media_url?: string;
  media_type?: string;
  cloudinary_public_id?: string;
  status_background?: string;
  voice_duration?: number;
  location?: string;
  latitude?: number;
  longitude?: number;
  music_name?: string;
  music_artist?: string;
  music_volume?: number;
  original_volume?: number;
  music_url?: string;
  marketplace_listing_id?: string;
  marketplace_price?: string | null;
  marketplace_title?: string | null;
  watermarked_url?: string | null;
}

// ─── FREESOUND RESULT ─────────────────────────────────────
export interface FreesoundResult {
  id: number;
  name: string;
  username: string;
  duration: number;
  previews: { 'preview-hq-mp3': string; 'preview-lq-mp3': string };
  tags: string[];
}

// ─── BEAT MARKER ──────────────────────────────────────────
export interface BeatMarker {
  time: number;
  intensity: number;
}

// ─── STYLE EFFECT ─────────────────────────────────────────
export interface StyleEffect {
  id: string;
  name: string;
  emoji: string;
  desc: string;
  ffmpegFilter: string;
}

// ─── STUDIO EDIT STATE ────────────────────────────────────
export interface StudioEdit {
  trimStart: number;
  trimEnd: number;
  reverse: boolean;
  chorus: boolean;
  normalise: boolean;
  noiseGate: boolean;
  delay: number;        // ms echo delay
  reverbLevel: number;  // 0-1
  pitchShift: number;   // semitones -12 to +12
}

// ─── AR EFFECT DEFINITION ─────────────────────────────────
export interface AREffect {
  id: string;
  name: string;
  emoji: string;
  type: 'none' | 'float' | 'face_top' | 'face_mid' | 'face_left' | 'face_right' | 'top';
  skiaAnchor: string | null;
  offsetY: number;
  size: number;
}

// ─── AI COACH STATE ───────────────────────────────────────
export interface AICoachState {
  isActive: boolean;
  currentNote: string;
  targetNote: string;
  pitchAccuracy: number;
  feedback: string;
  coachTip: string;
  sessionScore: number;
  recordingTakes: number;
  lastCoachTime: number;
  vuLevel: number;
  frequency: number;
  mood: 'encouraging' | 'strict' | 'celebrating' | 'correcting' | 'idle';
  correctionCount: number;    // how many times coach corrected same section
  ignored: boolean;           // user ignored correction 3 times — coach backed off
  contentAdvice: ContentAdvice | null;
}

// ─── CONTENT ADVICE (post-session) ────────────────────────
export interface ContentAdvice {
  platforms: string[];          // ['TikTok', 'Instagram Reels', 'YouTube Shorts']
  contentTypes: string[];       // ['cover song', 'behind the scenes', 'tutorial']
  postingTimes: string[];       // ['7pm–9pm WAT weekdays', 'Saturday noon']
  captionTips: string[];
  hashtagSets: string[];
  genreStrengths: string[];
  improvementAreas: string[];
}

// ─── MOVIE STUDIO SCENE ───────────────────────────────────
export interface MovieScene {
  id: string;
  order: number;
  videoUri: string | null;
  audioUri: string | null;
  duration: number;
  label: string;              // 'Verse 1', 'Chorus', 'Bridge', etc.
  filter: string;
  voiceEffectId: string;
  backgroundId: string;
  arEffectId: string;
  trimStart: number;
  trimEnd: number;
  isRendered: boolean;
  renderedUri: string | null;
}

// ─── MOVIE PROJECT ────────────────────────────────────────
export interface MovieProject {
  id: string;
  createdAt: string;
  title: string;
  scenes: MovieScene[];
  musicUri: string | null;
  musicName: string | null;
  musicVolume: number;
  finalUri: string | null;
  isComplete: boolean;
}

// ─── COLLAB SESSION ───────────────────────────────────────
export interface CollabSession {
  id: string;
  hostId: string;
  guestId: string | null;
  status: 'waiting' | 'live' | 'ended';
  hostAudioUri: string | null;
  guestAudioUri: string | null;
  mergedUri: string | null;
  chatMessages: CollabChatMessage[];
}

export interface CollabChatMessage {
  id: string;
  userId: string;
  username: string;
  text: string;
  createdAt: string;
} 
