// ─────────────────────────────────────────────────────────────
// src/crowdcam/CrowdCamModal.tsx
// The whole Crowd Cam screen. create.tsx only renders <CrowdCamModal .../>
// and receives the finished film through onFilmReady.
//
// Flow:  home (create / join)
//        -> camera (your camera big, other phones as tiles on the right)
//        -> recording (host presses the red button for everyone)
//        -> uploading -> wrap (host waits for every clip)
//        -> result (film preview + angles + "Continue to post")
// ─────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, Modal, ActivityIndicator,
  StyleSheet, Alert, Share, Platform, StatusBar, Image, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { VideoView, useVideoPlayer } from 'expo-video';
import {
  Camera, useCameraDevice, useCameraFormat,
  useCameraPermission, useMicrophonePermission,
} from 'react-native-vision-camera';
import { useAuthStore } from '../store/authStore';
import {
  CrowdRoom, CrowdPerson, LiveChannel,
  createRoom, joinRoom, getRoom, setRoomStatus, watchRoom,
  listPeople, uploadClip, openLiveChannel,
} from './crowdCamApi';
import { analyzeRoom, renderFilm, debugSummary, BuildStage, FilmResult, RoomAnalysis, SoundChoice } from './buildFilm';
// Effects under the record button (same live GL effects + same recorder as the normal camera in create.tsx)
import { LiveEffectPreview } from 'modules/video-baker/android/src/main/java/com/lumvibe/videobaker/LiveEffectPreview';
import type { LiveEffectPreviewHandle } from 'modules/video-baker/android/src/main/java/com/lumvibe/videobaker/LiveEffectPreview';
import { CROWD_FX, crowdFxById } from './crowdFx';
import SongPicker, { fmtTime, type PickedSong } from './SongPicker';

// ── Crowd Cam shows the SAME effects as the camera in create.tsx (and the website): every effect below, minus the hidden ones.
// Entries already in ./crowdFx keep their cover image; the rest get an emoji tile. To bring a hidden effect back, delete its name from CROWD_HIDDEN.
const CROWD_EXTRA = [
  { id: 'vintage_flicker', name: 'Old Film', emoji: '🎞️', gl: 'vintage_flicker' },
  { id: 'neon_edge', name: 'Neon Trace', emoji: '💡', gl: 'neon_edge' },
  { id: 'duotone_pulse', name: 'Duo Pulse', emoji: '🔵', gl: 'duotone_pulse' },
  { id: 'liquid_chrome', name: 'Liquid Chrome', emoji: '🌊', gl: 'liquid_chrome' },
  { id: 'ink_wash', name: 'Ink Wash', emoji: '🖌️', gl: 'ink_wash' },
  { id: 'mood_ring', name: 'Mood Ring', emoji: '💍', gl: 'mood_ring' },
  { id: 'smile_shatter', name: 'Smile Shatter', emoji: '💥', gl: 'smile_shatter' },
  { id: 'head_tilt_zoom', name: 'Tilt Zoom', emoji: '🎯', gl: 'head_tilt_zoom' },
  { id: 'color_drain', name: 'Color Drain', emoji: '🩶', gl: 'color_drain' },
  { id: 'silence_ripple', name: 'Silence Ripple', emoji: '🔵', gl: 'silence_ripple' },
  { id: 'split_prism', name: 'Split Prism', emoji: '🔺', gl: 'split_prism' },
  { id: 'double_take', name: 'Double Take', emoji: '👥', gl: 'double_take' },
  { id: 'skin_smooth', name: 'Skin Smooth', emoji: '🌸', gl: 'skin_smooth' },
  { id: 'snow_fall', name: 'Snow Fall', emoji: '❄️', gl: 'snow_fall' },
  { id: 'retro_vhs', name: 'Retro VHS', emoji: '📼', gl: 'retro_vhs' },
  { id: 'light_leak', name: 'Light Leak', emoji: '🌅', gl: 'light_leak' },
  { id: 'palm_magic', name: 'Palm Magic', emoji: '✨', gl: 'palm_magic' },
  { id: 'spin_effect', name: 'Spin Effect', emoji: '🌀', gl: 'spin_effect' },
  { id: 'stickers_react', name: 'Stickers React', emoji: '💕', gl: 'stickers_react' },
  { id: 'finger_draw', name: 'Finger Draw', emoji: '✍️', gl: 'finger_draw' },
  { id: 'eye_laser', name: 'Eye Laser', emoji: '🔴', gl: 'eye_laser' },
  { id: 'demon_eyes', name: 'Demon Eyes', emoji: '👹', gl: 'demon_eyes' },
  { id: 'gaze_trail', name: 'Gaze Trail', emoji: '👀', gl: 'gaze_trail' },
  { id: 'aura_glow', name: 'Aura Glow', emoji: '🌟', gl: 'aura_glow' },
  { id: 'big_head', name: 'Big Head', emoji: '🗣️', gl: 'big_head' },
  { id: 'beat_reactor', name: 'Beat Reactor', emoji: '🎵', gl: 'beat_reactor' },
  { id: 'beat_shake', name: 'Beat Shake', emoji: '📳', gl: 'beat_shake' },
  { id: 'drop_transform', name: 'Drop Transform', emoji: '💥', gl: 'drop_transform' },
  { id: 'voice_halo', name: 'Voice Halo', emoji: '⭕', gl: 'voice_halo' },
  { id: 'cinematic_glow', name: 'Cinematic Glow', emoji: '🎬', gl: 'cinematic_glow' },
  { id: 'flash_camera', name: 'Flash Camera', emoji: '📸', gl: 'flash_camera' },
  { id: 'rich_camera', name: 'Rich Camera', emoji: '🎞️', gl: 'rich_camera' },
  { id: 'golden_hour', name: 'Golden Hour', emoji: '🌅', gl: 'golden_hour' },
  { id: 'gold_skin', name: 'Gold Skin', emoji: '👑', gl: 'gold_skin' },
  { id: 'particle_flow', name: 'Particle Flow', emoji: '💫', gl: 'particle_flow' },
  { id: 'rain_fall', name: 'Rain Drop', emoji: '🌧️', gl: 'rain_fall' },
  { id: 'tap_shockwave', name: 'Tap Shockwave', emoji: '💥', gl: 'tap_shockwave' },
  { id: 'thermal_pulse', name: 'Thermal Pulse', emoji: '🌡️', gl: 'thermal_pulse' },
] as unknown as typeof CROWD_FX;
const CROWD_HIDDEN = new Set<string>(['wink_spark', 'blink_freeze', 'mouth_words', 'rock_paper_scissors', 'bokeh_lights', 'clap_burst', 'depth_bloom', 'face_morph', 'fire_book', 'fist_bump_boom', 'freeze_touch', 'glitch_wave', 'hand_portal', 'lightning_hands', 'mouth_fire', 'raise_eyebrow', 'space_background', 'superpower', 'throw_confetti', 'tiny_body', 'two_hand_frame', 'face_explosion']);
const CROWD_ALL = [...CROWD_FX, ...CROWD_EXTRA.filter(e => !CROWD_FX.some(f => (f as any).gl === (e as any).gl))]
  .filter(f => !CROWD_HIDDEN.has((f as any).gl)) as unknown as Array<(typeof CROWD_FX)[number]>;
const crowdFxFind = (id: string | null) => (id ? CROWD_ALL.find(f => f.id === id) ?? null : null);

const ACCENT = '#00ff88';
const BG = '#050b09';
const CARD = '#0b1512';
const EDGE = 'rgba(0,255,136,0.28)';
const MAX_TAKE_SEC = 90;      // auto-stop: keeps files (and mobile data) small
const MAX_FILM_SEC = 45;      // keep the joined-up film URL short for the first tests
const LIVE_EVERY_MS = 2000;   // how often each phone sends its tiny preview picture
const LIVE_WIDTH = 90;        // preview picture width in pixels (about 2-4 KB)

type Step = 'home' | 'camera' | 'uploading' | 'wrap' | 'result';

export interface CrowdFilmResult {
  localUri: string;
  contributors: string[];
  durationSec: number;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onFilmReady: (r: CrowdFilmResult) => void;
  /**
   * OPTIONAL override. Normally NOT needed: Crowd Cam has its own built-in song picker (SongPicker.tsx).
   * Pass this only if you want to open your own picker instead; it must return { publicId, title }
   * where publicId is the song's Cloudinary public id.
   */
  pickSong?: () => Promise<PickedSong | null>;
}

const STAGE_TEXT: Record<BuildStage, string> = {
  listing: "Finding everyone's clips…",
  audio: 'Listening to each phone…',
  syncing: 'Lining the clips up…',
  cutting: 'Choosing the best angles…',
  rendering: 'Building your film (can take a minute)…',
  downloading: 'Downloading the finished film…',
  done: 'Done',
};

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec) % 60).padStart(2, '0')}`;
const initials = (name: string | null) => (name ? name.replace('@', '').slice(0, 2).toUpperCase() : '?');

// ── small pieces ─────────────────────────────────────────────
type TileState = 'joined' | 'recording' | 'uploaded';
const STATE_COLOR: Record<TileState, string> = { joined: '#f5b301', recording: '#ff453a', uploaded: ACCENT };
const STATE_TEXT: Record<TileState, string> = { joined: 'In room', recording: 'Recording', uploaded: 'Uploaded' };

function PhoneTile(props: { label: string; sub: string; frame?: string; state: TileState; style?: any }) {
  const { label, sub, frame, state } = props;
  return (
    <View style={[s.tile, props.style]}>
      {frame ? (
        <Image source={{ uri: `data:image/jpeg;base64,${frame}` }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={s.tilePlaceholder}>
          <Text style={s.tileInitials}>{initials(sub)}</Text>
        </View>
      )}
      <View style={s.tileShade} />
      <View style={s.tileBottom}>
        <Ionicons name={state === 'uploaded' ? 'checkmark-circle' : 'mic'} size={13} color={STATE_COLOR[state]} />
        <View style={{ marginLeft: 5, flex: 1 }}>
          <Text style={s.tileLabel} numberOfLines={1}>{label}</Text>
          <Text style={[s.tileState, { color: STATE_COLOR[state] }]} numberOfLines={1}>{STATE_TEXT[state]}</Text>
        </View>
      </View>
    </View>
  );
}

function FilmPreview({ uri, playing, onToggle }: { uri: string; playing: boolean; onToggle: () => void }) {
  const player = useVideoPlayer(uri, (p: any) => { p.loop = true; });
  useEffect(() => {
    try { playing ? player.play() : player.pause(); } catch { /* player not ready yet */ }
  }, [playing, player]);
  return (
    <TouchableOpacity activeOpacity={1} onPress={onToggle} style={StyleSheet.absoluteFill}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
      {!playing && (
        <View style={s.playOverlay}>
          <View style={s.playCircle}><Ionicons name="play" size={30} color="#fff" style={{ marginLeft: 3 }} /></View>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── the screen ───────────────────────────────────────────────
export default function CrowdCamModal({ visible, onClose, onFilmReady, pickSong }: Props) {
  const { user } = useAuthStore();
  const userId: string | undefined = (user as any)?.id;

  const [step, setStep] = useState<Step>('home');
  const [room, setRoom] = useState<CrowdRoom | null>(null);
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<CrowdPerson[]>([]);
  const [frames, setFrames] = useState<Record<string, string>>({});
  const [isRecording, setIsRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [buildText, setBuildText] = useState('');
  const [building, setBuilding] = useState(false);
  const [useFront, setUseFront] = useState(false);
  const [liveOn, setLiveOn] = useState(true);
  const [liveWorks, setLiveWorks] = useState(true);
  const [camReady, setCamReady] = useState(false);
  const [result, setResult] = useState<FilmResult | null>(null);
  const [seed, setSeed] = useState(1);
  const [soundMode, setSoundMode] = useState<'room' | 'song'>('room');
  const [song, setSong] = useState<PickedSong | null>(null);
  const [songPickerOpen, setSongPickerOpen] = useState(false);
  const [editingPart, setEditingPart] = useState(false); // true = the picker opens straight on the trim screen
  const [playing, setPlaying] = useState(false);
  const [recordedAtDate, setRecordedAtDate] = useState<Date>(new Date());

  const isHost = !!room && !!userId && room.host_id === userId;

  // camera
  const { hasPermission: hasCam, requestPermission: reqCam } = useCameraPermission();
  const { hasPermission: hasMic, requestPermission: reqMic } = useMicrophonePermission();
  const device = useCameraDevice(useFront ? 'front' : 'back');
  const format = useCameraFormat(device, [
    { videoResolution: { width: 1280, height: 720 } },
    { fps: 30 },
  ]);
  const cameraRef = useRef<any>(null);

  // ── effects: null = plain camera (VisionCamera, exactly as before). An effect id swaps in LiveEffectPreview,
  // which records the effect-composited video itself (same path create.tsx uses). Chosen per phone; each phone's clip carries its own look.
  const [selectedFx, setSelectedFx] = useState<string | null>(null);
  const liveFx = crowdFxFind(selectedFx) ?? crowdFxById(selectedFx);
  const fxPreviewRef = useRef<LiveEffectPreviewHandle>(null);
  const liveFxRef = useRef(false);
  liveFxRef.current = !!liveFx;
  const recViaFxRef = useRef(false);

  // refs so timers / callbacks always see fresh values
  const stepRef = useRef<Step>('home');
  const roomRef = useRef<CrowdRoom | null>(null);
  const recordingRef = useRef(false);
  const camReadyRef = useRef(false);
  const recSecRef = useRef(0);
  const recStartedAt = useRef<Date | null>(null);
  const pendingFile = useRef<{ uri: string; durationSec: number; recordedAt: Date } | null>(null);
  const analysisRef = useRef<RoomAnalysis | null>(null);
  const liveRef = useRef<LiveChannel | null>(null);
  useEffect(() => { stepRef.current = step; }, [step]);
  useEffect(() => { roomRef.current = room; }, [room]);
  useEffect(() => { camReadyRef.current = camReady; }, [camReady]);
  useEffect(() => { recSecRef.current = recSec; }, [recSec]);

  // permissions
  useEffect(() => {
    if (!visible) return;
    (async () => {
      if (!hasCam) await reqCam();
      if (!hasMic) await reqMic();
    })();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // full reset when the modal closes
  const resetAll = useCallback(() => {
    setStep('home'); setRoom(null); setCode(''); setTitle(''); setBusy(false);
    setPeople([]); setFrames({}); setIsRecording(false); setRecSec(0);
    setUploadPct(0); setUploadErr(null); setBuildText(''); setBuilding(false);
    setCamReady(false); setResult(null); setSeed(1); setPlaying(false);
    setSoundMode('room'); setSong(null); setSongPickerOpen(false); setEditingPart(false);
    recordingRef.current = false; pendingFile.current = null; analysisRef.current = null;
  }, []);
  useEffect(() => { if (!visible) resetAll(); }, [visible, resetAll]);

  // ── recording ──────────────────────────────────────────────
  const beginUpload = useCallback(async () => {
    const f = pendingFile.current;
    const r = roomRef.current;
    if (!f || !r || !userId) return;
    setStep('uploading');
    setUploadErr(null);
    setUploadPct(0);
    try {
      await uploadClip(
        { roomId: r.id, userId, localUri: f.uri, durationSec: f.durationSec, recordedAt: f.recordedAt },
        setUploadPct,
      );
      setStep('wrap');
    } catch (e: any) {
      setUploadErr(e?.message || 'Upload failed');
    }
  }, [userId]);

  const startRecording = useCallback(() => {
    if (recordingRef.current) return;
    if (liveFxRef.current) {
      // effect on → record through LiveEffectPreview's own recorder (view stays mounted, so nothing jumps)
      if (!fxPreviewRef.current) return;
      recordingRef.current = true; recViaFxRef.current = true;
      recStartedAt.current = new Date();
      setRecordedAtDate(new Date());
      setRecSec(0);
      setIsRecording(true);
      const stamp = Date.now();
      const videoOnlyPath = `${FileSystem.cacheDirectory}cc_fx_video_${stamp}.mp4`.replace('file://', '');
      const pcmPath = `${FileSystem.cacheDirectory}cc_fx_audio_${stamp}.pcm`.replace('file://', '');
      fxPreviewRef.current.startRecording(videoOnlyPath, pcmPath).catch((err: any) => {
        recordingRef.current = false; recViaFxRef.current = false;
        setIsRecording(false);
        Alert.alert('Recording problem', String(err?.message || err));
      });
      return;
    }
    if (!cameraRef.current) return;
    recordingRef.current = true;
    recViaFxRef.current = false;
    recStartedAt.current = new Date();
    setRecordedAtDate(new Date());
    setRecSec(0);
    setIsRecording(true);
    cameraRef.current.startRecording({
      onRecordingFinished: (video: any) => {
        recordingRef.current = false;
        setIsRecording(false);
        const path: string = video.path;
        const uri = Platform.OS === 'android' && !path.startsWith('file://') ? `file://${path}` : path;
        pendingFile.current = {
          uri,
          durationSec: Math.round((video.duration ?? recSecRef.current) * 100) / 100,
          recordedAt: recStartedAt.current ?? new Date(),
        };
        beginUpload();
      },
      onRecordingError: (err: any) => {
        recordingRef.current = false;
        setIsRecording(false);
        Alert.alert('Recording problem', String(err?.message || err));
      },
    });
  }, [beginUpload]);

  const stopRecording = useCallback(async () => {
    if (!recordingRef.current) return;
    if (recViaFxRef.current) {
      const finalPath = `${FileSystem.cacheDirectory}cc_fx_final_${Date.now()}.mp4`.replace('file://', '');
      try {
        const res = await fxPreviewRef.current?.stopRecording(finalPath);
        const path = res?.path || finalPath;
        const dur = recSecRef.current;
        recordingRef.current = false; recViaFxRef.current = false;
        setIsRecording(false);
        pendingFile.current = {
          uri: path.startsWith('file://') ? path : `file://${path}`,
          durationSec: Math.round(dur * 100) / 100,
          recordedAt: recStartedAt.current ?? new Date(),
        };
        beginUpload();
      } catch (err: any) {
        recordingRef.current = false; recViaFxRef.current = false;
        setIsRecording(false);
        Alert.alert('Recording problem', String(err?.message || err));
      }
      return;
    }
    try { await cameraRef.current?.stopRecording(); } catch { /* finished callback still fires */ }
  }, [beginUpload]);

  // timer + auto stop
  useEffect(() => {
    if (!isRecording) return;
    const t = setInterval(() => setRecSec(x => x + 1), 1000);
    return () => clearInterval(t);
  }, [isRecording]);
  useEffect(() => {
    if (isRecording && recSec >= MAX_TAKE_SEC) stopRecording();
  }, [recSec, isRecording, stopRecording]);

  // ── reacting to the room (realtime + a slow poll as a safety net) ──
  const applyRoom = useCallback((r: CrowdRoom) => {
    setRoom(r);
    if (r.status === 'recording' && stepRef.current === 'camera' && !recordingRef.current && camReadyRef.current) startRecording();
    if (r.status === 'closed' && recordingRef.current) stopRecording();
  }, [startRecording, stopRecording]);

  useEffect(() => {
    if (!room?.id) return;
    const unwatch = watchRoom(room.id, applyRoom);
    const poll = setInterval(async () => {
      try {
        const r = await getRoom(room.id);
        if (r) applyRoom(r);
        setPeople(await listPeople(room.id));
      } catch { /* offline for a moment: try again next tick */ }
    }, 2500);
    listPeople(room.id).then(setPeople).catch(() => {});
    return () => { unwatch(); clearInterval(poll); };
  }, [room?.id, applyRoom]);

  // ── near-live preview pictures between phones ──────────────
  useEffect(() => {
    if (!room?.id || !userId) return;
    const ch = openLiveChannel(room.id, (from, b64) => {
      if (from !== userId) setFrames(prev => ({ ...prev, [from]: b64 }));
    });
    liveRef.current = ch;
    return () => { ch.close(); liveRef.current = null; };
  }, [room?.id, userId]);

  const othersCount = Math.max(0, people.length - 1);
  useEffect(() => {
    if (!(isRecording && liveOn && liveWorks && othersCount > 0 && userId)) return;
    let stopped = false;
    let busyNow = false;
    let fails = 0;
    const tick = async () => {
      if (stopped || busyNow) return;
      busyNow = true;
      try {
        if (liveFxRef.current) { busyNow = false; return; } // effect view has no snapshot API: thumbnails pause, recording is unaffected
        const cam = cameraRef.current;
        if (!cam || typeof cam.takeSnapshot !== 'function') throw new Error('snapshots not supported');
        const snap = await cam.takeSnapshot({ quality: 30, skipMetadata: true });
        const src = String(snap.path).startsWith('file://') ? snap.path : `file://${snap.path}`;
        const small = await ImageManipulator.manipulateAsync(
          src, [{ resize: { width: LIVE_WIDTH } }],
          { compress: 0.3, format: ImageManipulator.SaveFormat.JPEG, base64: true },
        );
        if (small.base64) liveRef.current?.send(userId, small.base64);
        FileSystem.deleteAsync(src, { idempotent: true }).catch(() => {});
        FileSystem.deleteAsync(small.uri, { idempotent: true }).catch(() => {});
        fails = 0;
      } catch {
        fails += 1;
        if (fails >= 3) { stopped = true; setLiveWorks(false); } // this phone can't do it: stop trying, recording is unaffected
      }
      busyNow = false;
    };
    const t = setInterval(tick, LIVE_EVERY_MS);
    return () => { stopped = true; clearInterval(t); };
  }, [isRecording, liveOn, liveWorks, othersCount, userId]);

  // ── actions ────────────────────────────────────────────────
  const onCreate = async () => {
    if (!userId) return Alert.alert('Sign in first');
    setBusy(true);
    try {
      const r = await createRoom(title || 'Crowd Cam');
      setRoom(r); setStep('camera');
    } catch (e: any) { Alert.alert('Could not create room', e?.message || ''); }
    setBusy(false);
  };

  const onJoin = async () => {
    if (!userId) return Alert.alert('Sign in first');
    if (code.trim().length < 4) return Alert.alert('Enter the room code');
    setBusy(true);
    try {
      const r = await joinRoom(code);
      setRoom(r); setStep('camera');
    } catch (e: any) { Alert.alert('Could not join', e?.message || ''); }
    setBusy(false);
  };

  const onHostStart = async () => {
    if (!room) return;
    setBusy(true);
    try { await setRoomStatus(room.id, 'recording'); startRecording(); }
    catch (e: any) { Alert.alert('Could not start', e?.message || ''); }
    setBusy(false);
  };

  const onHostStop = async () => {
    if (!room) return;
    try { await setRoomStatus(room.id, 'closed'); } catch { /* still stop our own phone */ }
    stopRecording();
  };

  const shareCode = () => {
    if (!room) return;
    Share.share({ message: `Join my LumVibe Crowd Cam "${room.title}". Room code: ${room.join_code}` });
  };

  const showFailure = (e: any) => {
    const details: string | undefined = e?.details;
    Alert.alert(
      'Could not make the film',
      String(e?.message || 'Unknown error'),
      details
        ? [{ text: 'Share details', onPress: () => Share.share({ message: details }) }, { text: 'OK' }]
        : [{ text: 'OK' }],
    );
  };

  const makeFilm = async (nextSeed: number, reuse: boolean) => {
    if (!room) return;
    setBuilding(true);
    try {
      const onStage = (st: BuildStage, d?: string) => setBuildText(STAGE_TEXT[st] + (d ? ` ${d}` : ''));
      if (!reuse || !analysisRef.current) analysisRef.current = await analyzeRoom(room.id, onStage);
      const sound: SoundChoice = soundMode === 'song' && song ? { mode: 'song', publicId: song.publicId, title: song.title, startSec: song.startSec, endSec: song.endSec } : { mode: 'room' };
      const film = await renderFilm(analysisRef.current, { seed: nextSeed, maxFilmSec: MAX_FILM_SEC, onStage, sound });
      setSeed(nextSeed);
      setResult(film);
      setPlaying(false);
      setStep('result');
    } catch (e: any) {
      if (analysisRef.current && !e?.details) e.details = debugSummary(analysisRef.current);
      showFailure(e);
    }
    setBuilding(false);
    setBuildText('');
  };

  const chooseSong = async () => {
    if (!pickSong) { setEditingPart(false); setSongPickerOpen(true); return; } // built-in picker
    try {
      const picked = await pickSong();
      if (picked?.publicId) { setSong(picked); setSoundMode('song'); }
    } catch (e: any) { Alert.alert('Could not add the song', String(e?.message || '')); }
  };

  // the host picks the soundtrack BEFORE the film is built, because the cuts follow its beat
  const SoundPicker = isHost && !building ? (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.soundCap}>Soundtrack</Text>
      <View style={s.soundRow}>
        <TouchableOpacity style={[s.soundChip, soundMode === 'room' && s.soundChipOn]} onPress={() => setSoundMode('room')}>
          <Ionicons name="mic-outline" size={15} color={soundMode === 'room' ? '#000' : ACCENT} />
          <Text style={[s.soundChipTxt, soundMode === 'room' && { color: '#000' }]}>  Room sound</Text>
        </TouchableOpacity>
        {(
          <TouchableOpacity style={[s.soundChip, soundMode === 'song' && s.soundChipOn]} onPress={() => (song && soundMode !== 'song' ? setSoundMode('song') : chooseSong())}>
            <Ionicons name="musical-notes-outline" size={15} color={soundMode === 'song' ? '#000' : ACCENT} />
            <Text style={[s.soundChipTxt, soundMode === 'song' && { color: '#000' }]} numberOfLines={1}>  {song ? (song.title || 'Your song') : 'Add a song'}</Text>
          </TouchableOpacity>
        )}
      </View>
      <Text style={s.hint}>
        {soundMode === 'song' && song
          ? (song.endSec
              ? `Plays ${fmtTime(song.startSec ?? 0)} to ${fmtTime(song.endSec)} of the song, and the cuts follow its beat. The film is that long.`
              : "The song plays under the whole film and the cuts follow its beat.")
          : "One steady soundtrack from the room, and the cuts follow its beat."}
      </Text>
      {soundMode === 'song' && !!song?.previewUri && (
        <TouchableOpacity onPress={() => { setEditingPart(true); setSongPickerOpen(true); }}>
          <Text style={s.changePart}>✂  Change part</Text>
        </TouchableOpacity>
      )}
    </View>
  ) : null;

  const continueToPost = () => {
    if (!result) return;
    onFilmReady({ localUri: result.localUri, contributors: result.contributors, durationSec: result.durationSec });
  };

  const leave = () => {
    if (recordingRef.current) return Alert.alert('You are recording', 'Stop recording first.');
    onClose();
  };

  // ── derived UI data ────────────────────────────────────────
  const others = people.filter(p => p.user_id !== userId);
  const roomRecording = room?.status === 'recording';
  const tileStateOf = (p: CrowdPerson): TileState => (p.has_clip ? 'uploaded' : roomRecording ? 'recording' : 'joined');
  const labelOf = (p: CrowdPerson) => `Camera ${people.indexOf(p) + 1}${p.is_host ? ' · Host' : ''}`;
  const uploadedCount = people.filter(p => p.has_clip).length;
  const showCamera = visible && step === 'camera' && hasCam && hasMic && !!device && !liveFx;
  const showLiveFx = visible && step === 'camera' && hasCam && hasMic && !!liveFx;
  // LiveEffectPreview has no onInitialized: treat it as ready shortly after it mounts (or after a flip)
  useEffect(() => {
    if (!showLiveFx) return;
    setCamReady(false);
    const t = setTimeout(() => setCamReady(true), 700);
    return () => clearTimeout(t);
  }, [showLiveFx, selectedFx, useFront]);
  const permsOk = hasCam && hasMic;

  const CodeStrip = (
    <View style={s.codeStrip}>
      <View style={s.codeIcon}><Ionicons name="link" size={18} color={ACCENT} /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.codeCap}>Share this code</Text>
        <Text style={s.codeSmall}>Others join by entering it in their Crowd Cam</Text>
      </View>
      <Text style={s.codeBig}>{room?.join_code}</Text>
      <TouchableOpacity onPress={shareCode} style={{ padding: 8 }}>
        <Ionicons name="share-outline" size={20} color={ACCENT} />
      </TouchableOpacity>
    </View>
  );

  // ── UI ─────────────────────────────────────────────────────
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={leave} statusBarTranslucent>
      <StatusBar barStyle="light-content" />
      <View style={s.root}>
        {/* header (all steps except result, which has its own) */}
        {step !== 'result' && (
          <View style={s.header}>
            <TouchableOpacity style={s.roundBtn} onPress={leave}>
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
            <View style={{ alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="videocam" size={18} color={ACCENT} />
                <Text style={s.headerTitle}>  Crowd Cam</Text>
              </View>
              {step === 'camera' && room && (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                  <View style={[s.dot, { backgroundColor: isRecording ? '#ff453a' : ACCENT }]} />
                  <Text style={s.headerSub}>{isRecording ? `Recording LIVE  ·  ${mmss(recSec)}` : 'Ready'}</Text>
                </View>
              )}
            </View>
            <View style={s.roundBtn}>
              {room ? (
                <>
                  <Ionicons name="people" size={20} color="#fff" />
                  <View style={s.badge}><Text style={s.badgeTxt}>{people.length || 1}</Text></View>
                </>
              ) : null}
            </View>
          </View>
        )}

        {!permsOk && (
          <View style={s.center}>
            <Text style={s.h1}>Camera and microphone needed</Text>
            <TouchableOpacity style={s.primary} onPress={async () => { await reqCam(); await reqMic(); }}>
              <Text style={s.primaryTxt}>Allow access</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* HOME */}
        {permsOk && step === 'home' && (
          <View style={s.panel}>
            <Text style={s.h1}>Film an event with friends' phones</Text>
            <Text style={s.sub}>Everyone films. LumVibe lines the clips up and cuts one film from all the angles.</Text>

            <Text style={s.label}>Start a room</Text>
            <TextInput style={s.input} value={title} onChangeText={setTitle} placeholder="Event name (e.g. Tunde's wedding)"
              placeholderTextColor="#666" maxLength={60} />
            <TouchableOpacity style={[s.primary, busy && s.dim]} disabled={busy} onPress={onCreate}>
              {busy ? <ActivityIndicator color="#000" /> : <Text style={s.primaryTxt}>Create room</Text>}
            </TouchableOpacity>

            <View style={s.divider} />

            <Text style={s.label}>Join a room</Text>
            <TextInput style={[s.input, s.codeInput]} value={code} onChangeText={(t: string) => setCode(t.toUpperCase())}
              placeholder="ROOM CODE" placeholderTextColor="#666" autoCapitalize="characters" maxLength={8} />
            <TouchableOpacity style={[s.secondary, busy && s.dim]} disabled={busy} onPress={onJoin}>
              <Text style={s.secondaryTxt}>Join</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* CAMERA + RECORDING */}
        {permsOk && step === 'camera' && room && (
          <View style={s.cameraBody}>
            <View style={s.gridRow}>
              <View style={s.mainTile}>
                {showLiveFx && (
                  <LiveEffectPreview
                    ref={fxPreviewRef}
                    effect={liveFx!.gl}
                    facing={useFront ? 'front' : 'back'}
                    style={StyleSheet.absoluteFill}
                  />
                )}
                {showCamera && (
                  <Camera
                    ref={cameraRef}
                    style={StyleSheet.absoluteFill}
                    device={device!}
                    format={format}
                    fps={30}
                    isActive={true}
                    video={true}
                    audio={true}
                    onInitialized={() => setCamReady(true)}
                  />
                )}
                <View style={s.hostPill}>
                  <Ionicons name={isHost ? 'ribbon' : 'person'} size={13} color={ACCENT} />
                  <Text style={s.hostPillTxt}> {isHost ? 'Host (You)' : 'You'}</Text>
                </View>
                <View style={s.mainBottom}>
                  <Ionicons name="mic" size={14} color="#fff" />
                  <Text style={s.mainBottomTxt}>  {useFront ? 'Front camera' : 'Back camera'}</Text>
                </View>
              </View>

              <View style={s.sideCol}>
                {others.length === 0 ? (
                  <View style={[s.tile, s.emptySide]}>
                    <Ionicons name="people-outline" size={22} color="#4d6b60" />
                    <Text style={s.emptySideTxt}>Other phones appear here when they join</Text>
                  </View>
                ) : (
                  <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
                    {others.slice(0, 8).map(p => (
                      <PhoneTile
                        key={p.user_id}
                        label={labelOf(p)}
                        sub={p.username ?? ''}
                        frame={liveOn ? frames[p.user_id] : undefined}
                        state={tileStateOf(p)}
                        style={{ height: 118, marginBottom: 8 }}
                      />
                    ))}
                  </ScrollView>
                )}
              </View>
            </View>

            {liveFx && isRecording && othersCount > 0 && (
              <Text style={s.liveNote}>Live thumbnails pause while an effect is on. Recording is not affected.</Text>
            )}
            {!liveWorks && isRecording && !liveFx && (
              <Text style={s.liveNote}>Live thumbnails aren't available on this phone. Recording is not affected.</Text>
            )}

            <View style={s.controls}>
              <TouchableOpacity style={[s.sideBtn, isRecording && s.dim]} disabled={isRecording} onPress={() => { setCamReady(false); setUseFront(v => !v); }}>
                <Ionicons name="camera-reverse-outline" size={20} color="#fff" />
                <Text style={s.sideBtnTxt}>Flip</Text>
              </TouchableOpacity>

              {isRecording ? (
                <TouchableOpacity style={s.recBtn} onPress={isHost ? onHostStop : stopRecording}>
                  <View style={s.stopSquare} />
                </TouchableOpacity>
              ) : isHost ? (
                <TouchableOpacity style={[s.recBtn, (!camReady || busy) && s.dim]} disabled={!camReady || busy} onPress={onHostStart}>
                  <View style={s.recDotBig} />
                </TouchableOpacity>
              ) : (
                <View style={[s.recBtn, s.dim]}><Ionicons name="hourglass-outline" size={26} color="#fff" /></View>
              )}

              <TouchableOpacity style={s.sideBtn} onPress={() => setLiveOn(v => !v)}>
                <Ionicons name={liveOn ? 'eye-outline' : 'eye-off-outline'} size={20} color={liveOn ? ACCENT : '#fff'} />
                <Text style={[s.sideBtnTxt, liveOn && { color: ACCENT }]}>Live view</Text>
              </TouchableOpacity>
            </View>
            {/* Effects — under the record button, same look as the camera's strip. Locked while recording. */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[s.fxStrip, isRecording && s.dim]} contentContainerStyle={{ gap: 10, paddingHorizontal: 4 }} pointerEvents={isRecording ? 'none' : 'auto'}>
              <TouchableOpacity style={s.fxItem} onPress={() => { if (selectedFx) { setCamReady(false); setSelectedFx(null); } }}>
                <View style={[s.fxThumb, !selectedFx && s.fxThumbOn, { backgroundColor: '#1a1a1a' }]}>
                  <Ionicons name="ban-outline" size={18} color="#888" />
                  {!selectedFx && <View style={s.fxCheck}><Ionicons name="checkmark" size={11} color="#000" /></View>}
                </View>
                <Text style={[s.fxName, !selectedFx && { color: ACCENT }]} numberOfLines={1}>None</Text>
              </TouchableOpacity>
              {CROWD_ALL.map(f => (
                <TouchableOpacity key={f.id} style={s.fxItem} onPress={() => { if (selectedFx !== f.id) { setCamReady(false); setSelectedFx(f.id); } }}>
                  <View style={[s.fxThumb, selectedFx === f.id && s.fxThumbOn]}>
                    {f.image
                      ? <Image source={f.image} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                      : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a1a' }}><Text style={{ fontSize: 20 }}>{f.emoji}</Text></View>}
                    {selectedFx === f.id && <View style={s.fxCheck}><Ionicons name="checkmark" size={11} color="#000" /></View>}
                  </View>
                  <Text style={[s.fxName, selectedFx === f.id && { color: ACCENT }]} numberOfLines={1}>{f.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={s.hint}>
              {isRecording
                ? (isHost ? 'Tap the square to stop everyone' : 'The host controls the recording. Tap to stop your phone only.')
                : (isHost ? (camReady ? 'Tap the red button to start recording on every phone' : 'Getting camera ready…') : 'Waiting for the host to start…')}
            </Text>

            {CodeStrip}
          </View>
        )}

        {/* UPLOADING */}
        {step === 'uploading' && (
          <View style={s.center}>
            {uploadErr ? (
              <>
                <Text style={s.h1}>Upload failed</Text>
                <Text style={s.sub}>{uploadErr}</Text>
                <TouchableOpacity style={s.primary} onPress={beginUpload}><Text style={s.primaryTxt}>Try again</Text></TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={s.h1}>Uploading your clip…</Text>
                <View style={s.barBg}><View style={[s.barFill, { width: `${uploadPct}%` }]} /></View>
                <Text style={s.sub}>{uploadPct}%  ·  keep the app open</Text>
              </>
            )}
          </View>
        )}

        {/* WRAP: wait for everyone's clip, host builds the film */}
        {step === 'wrap' && room && (
          <View style={s.wrapBody}>
            <View style={{ alignItems: 'center', marginTop: 8 }}>
              <Ionicons name="checkmark-circle" size={48} color={ACCENT} />
              <Text style={s.h1}>Your clip is uploaded</Text>
              <Text style={s.sub}>{uploadedCount} of {people.length} phone{people.length === 1 ? '' : 's'} have uploaded</Text>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={s.wrapGrid}>
              {people.map(p => (
                <PhoneTile
                  key={p.user_id}
                  label={p.user_id === userId ? (p.is_host ? 'You · Host' : 'You') : labelOf(p)}
                  sub={p.username ?? ''}
                  state={p.has_clip ? 'uploaded' : 'recording'}
                  style={{ width: '31%', height: 120, marginBottom: 8 }}
                />
              ))}
            </ScrollView>
            {isHost ? (
              building ? (
                <View style={{ alignItems: 'center', paddingBottom: 30 }}>
                  <ActivityIndicator color={ACCENT} />
                  <Text style={[s.sub, { marginTop: 10 }]}>{buildText}</Text>
                </View>
              ) : (
                <View style={{ paddingHorizontal: 20, paddingBottom: 28 }}>
                  {SoundPicker}
                  <TouchableOpacity style={[s.primary, uploadedCount < 2 && s.dim]} disabled={uploadedCount < 2} onPress={() => makeFilm(1, false)}>
                    <Text style={s.primaryTxt}>Make the film</Text>
                  </TouchableOpacity>
                  <Text style={s.hint}>{uploadedCount < 2 ? 'Waiting for at least 2 clips…' : 'Wait until everyone has uploaded, then tap.'}</Text>
                </View>
              )
            ) : (
              <Text style={[s.hint, { paddingBottom: 34 }]}>The host will build the film and post it. You'll be credited.</Text>
            )}
          </View>
        )}

        {/* RESULT */}
        {step === 'result' && result && room && (
          <View style={{ flex: 1 }}>
            <View style={s.header}>
              <TouchableOpacity style={s.roundBtn} onPress={() => { setPlaying(false); setStep('wrap'); }}>
                <Ionicons name="chevron-back" size={22} color="#fff" />
              </TouchableOpacity>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="videocam" size={18} color={ACCENT} />
                <Text style={s.headerTitle}>  Crowd Cam</Text>
              </View>
              <View style={{ width: 40 }} />
            </View>

            <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 30 }}>
              <View style={s.previewRow}>
                <View style={s.previewMain}>
                  <FilmPreview key={result.localUri} uri={result.localUri} playing={playing} onToggle={() => setPlaying(p => !p)} />
                  <View style={s.pillLeft}>
                    <Ionicons name="videocam" size={12} color={ACCENT} />
                    <Text style={s.pillTxt}> {result.angles.length} Cameras</Text>
                  </View>
                  <View style={s.pillRight}><Text style={s.pillTxt}>{mmss(result.durationSec)}</Text></View>
                </View>
                <View style={s.thumbCol}>
                  {result.angles.slice(0, 4).map(a => (
                    <View key={a.clipId} style={[s.thumb, a.usedInFilm && { borderColor: ACCENT }]}>
                      <Image source={{ uri: a.thumbUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                      {a.method === 'start-time' && <View style={s.thumbWarn}><Ionicons name="time-outline" size={11} color="#000" /></View>}
                    </View>
                  ))}
                </View>
              </View>

              <View style={s.doneCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={s.checkRing}><Ionicons name="checkmark" size={26} color={ACCENT} /></View>
                  <View style={{ marginLeft: 14, flex: 1 }}>
                    <Text style={s.doneTitle}>Your film is ready!</Text>
                    <Text style={s.doneSub}>Cut from {result.angles.length} camera{result.angles.length === 1 ? '' : 's'}, {result.shots} shots.</Text>
                  </View>
                </View>
                <View style={s.statsRow}>
                  <View style={s.stat}><Text style={s.statBig}>{result.angles.length}</Text><Text style={s.statCap}>Cameras</Text></View>
                  <View style={s.stat}><Text style={s.statBig}>{mmss(result.durationSec)}</Text><Text style={s.statCap}>Duration</Text></View>
                  <View style={s.stat}>
                    <Text style={s.statBig}>{recordedAtDate.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</Text>
                    <Text style={s.statCap}>{recordedAtDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</Text>
                  </View>
                </View>
              </View>

              <Text style={s.hint}>
                {result.beatBpm ? `Cuts follow the beat (about ${Math.round(result.beatBpm)} BPM).` : 'No steady beat found, so the cuts are spread out evenly.'}
              </Text>
              {!!result.note && <Text style={s.warn}>{result.note}</Text>}

              {result.angles.some(a => a.method === 'start-time') && (
                <Text style={s.warn}>
                  Some cameras were lined up by start time because their sound didn't match. They may be slightly off (marked with a clock).
                </Text>
              )}
              {result.angles.some(a => a.silent) && (
                <Text style={s.warn}>One camera recorded no sound. Check that its microphone is allowed.</Text>
              )}

              <View style={s.codeStripFlat}>
                <Ionicons name="link" size={18} color={ACCENT} />
                <Text style={s.codeCap2}>Share code again</Text>
                <Text style={s.codeMid}>{room.join_code}</Text>
              </View>

              <TouchableOpacity style={s.primary} onPress={continueToPost}>
                <Ionicons name="arrow-forward-circle" size={20} color="#000" />
                <Text style={[s.primaryTxt, { marginLeft: 8 }]}>Continue to post</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.secondary} onPress={() => setPlaying(p => !p)}>
                <Ionicons name={playing ? 'pause' : 'play'} size={16} color={ACCENT} />
                <Text style={s.secondaryTxt}>  {playing ? 'Pause film' : 'Watch full film'}</Text>
              </TouchableOpacity>
              {SoundPicker}
              <TouchableOpacity style={[s.ghost, building && s.dim]} disabled={building} onPress={() => makeFilm(seed + 1, true)}>
                {building ? <ActivityIndicator color={ACCENT} /> : <Text style={s.ghostTxt}>Try a different cut</Text>}
              </TouchableOpacity>
              {building && <Text style={s.hint}>{buildText}</Text>}
            </ScrollView>
          </View>
        )}

        {/* built-in song picker, drawn on top of everything inside Crowd Cam */}
        <SongPicker
          visible={songPickerOpen}
          maxSec={MAX_FILM_SEC}
          editSong={editingPart ? song : null}
          onClose={() => { setSongPickerOpen(false); setEditingPart(false); }}
          onPick={picked => { setSong(picked); setSoundMode('song'); setSongPickerOpen(false); setEditingPart(false); }}
        />
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  header: { paddingTop: 44, paddingHorizontal: 14, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { color: '#fff', fontSize: 19, fontWeight: '800' },
  headerSub: { color: '#b8ccc4', fontSize: 12, marginLeft: 6, fontWeight: '600' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  roundBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeTxt: { color: '#000', fontSize: 11, fontWeight: '800' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  panel: { flex: 1, paddingHorizontal: 22, paddingTop: 20 },
  h1: { color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  sub: { color: '#9bb0a8', fontSize: 13, textAlign: 'center', marginBottom: 14, lineHeight: 19 },
  label: { color: '#d3e2dc', fontSize: 13, fontWeight: '700', marginTop: 10, marginBottom: 8 },
  input: { backgroundColor: CARD, borderWidth: 1, borderColor: EDGE, borderRadius: 12, color: '#fff', paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 12 },
  codeInput: { letterSpacing: 4, textAlign: 'center', fontSize: 20, fontWeight: '800' },
  primary: { flexDirection: 'row', backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', marginTop: 10, alignSelf: 'stretch' },
  primaryTxt: { color: '#000', fontSize: 15, fontWeight: '800' },
  secondary: { flexDirection: 'row', borderWidth: 1, borderColor: ACCENT, borderRadius: 14, paddingVertical: 13, alignItems: 'center', justifyContent: 'center', marginTop: 10, alignSelf: 'stretch' },
  secondaryTxt: { color: ACCENT, fontSize: 14, fontWeight: '700' },
  ghost: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  ghostTxt: { color: '#9bb0a8', fontSize: 14, fontWeight: '700' },
  dim: { opacity: 0.45 },
  divider: { height: 1, backgroundColor: '#1b2a25', marginVertical: 18 },

  cameraBody: { flex: 1, paddingHorizontal: 12, paddingBottom: 14 },
  gridRow: { flex: 1, flexDirection: 'row' },
  mainTile: { flex: 1, borderRadius: 22, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1, borderColor: EDGE },
  sideCol: { width: '31%', marginLeft: 8 },
  hostPill: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  hostPillTxt: { color: '#fff', fontWeight: '700', fontSize: 12 },
  mainBottom: { position: 'absolute', bottom: 10, left: 10, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4 },
  mainBottomTxt: { color: '#fff', fontSize: 12, fontWeight: '600' },
  tile: { borderRadius: 14, overflow: 'hidden', backgroundColor: CARD, borderWidth: 1, borderColor: EDGE },
  tilePlaceholder: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f1e19' },
  tileInitials: { color: '#3f6b5a', fontSize: 26, fontWeight: '900' },
  tileShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 44, backgroundColor: 'rgba(0,0,0,0.55)' },
  tileBottom: { position: 'absolute', left: 6, right: 6, bottom: 5, flexDirection: 'row', alignItems: 'center' },
  tileLabel: { color: '#fff', fontSize: 11, fontWeight: '700' },
  tileState: { fontSize: 10, fontWeight: '700' },
  emptySide: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 8 },
  emptySideTxt: { color: '#557267', fontSize: 11, textAlign: 'center', marginTop: 6 },
  liveNote: { color: '#f5b301', fontSize: 11, textAlign: 'center', marginTop: 6 },

  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: CARD, borderRadius: 22, paddingVertical: 12, paddingHorizontal: 16, marginTop: 10, borderWidth: 1, borderColor: '#14231d' },
  sideBtn: { width: 92, height: 54, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  sideBtnTxt: { color: '#fff', fontSize: 11, fontWeight: '700', marginTop: 3 },
  recBtn: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: '#ff453a', alignItems: 'center', justifyContent: 'center' },
  recDotBig: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#ff453a' },
  stopSquare: { width: 28, height: 28, borderRadius: 6, backgroundColor: '#ff453a' },
  fxStrip: { marginTop: 10, flexGrow: 0 },
  fxItem: { alignItems: 'center', width: 60 },
  fxThumb: { width: 54, height: 54, borderRadius: 12, borderWidth: 2, borderColor: '#1a1a1a', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  fxThumbOn: { borderColor: ACCENT },
  fxCheck: { position: 'absolute', top: 3, right: 3, width: 16, height: 16, borderRadius: 8, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  fxName: { color: '#7f958c', fontSize: 10, fontWeight: '600', marginTop: 4, textAlign: 'center' },
  changePart: { color: ACCENT, fontSize: 13, fontWeight: '800', textAlign: 'center', marginTop: 8 },
  soundCap: { color: '#9bb0a8', fontSize: 12, fontWeight: '700', marginBottom: 6, textAlign: 'center' },
  soundRow: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  soundChip: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: EDGE, maxWidth: '55%' },
  soundChipOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  soundChipTxt: { color: ACCENT, fontSize: 13, fontWeight: '700' },
  hint: { color: '#7f958c', fontSize: 12, textAlign: 'center', marginTop: 8 },

  codeStrip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: EDGE, backgroundColor: CARD, borderRadius: 18, paddingVertical: 10, paddingHorizontal: 12, marginTop: 10 },
  codeIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,255,136,0.12)', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  codeCap: { color: ACCENT, fontSize: 13, fontWeight: '800' },
  codeSmall: { color: '#7f958c', fontSize: 10, marginTop: 2 },
  codeBig: { color: ACCENT, fontSize: 24, fontWeight: '900', letterSpacing: 3, marginLeft: 6 },

  wrapBody: { flex: 1 },
  wrapGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 14 },

  previewRow: { flexDirection: 'row', height: 300 },
  previewMain: { flex: 1, borderRadius: 20, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1, borderColor: EDGE },
  thumbCol: { width: '24%', marginLeft: 8, justifyContent: 'space-between' },
  thumb: { height: 70, borderRadius: 12, overflow: 'hidden', backgroundColor: CARD, borderWidth: 1, borderColor: '#1e3029' },
  thumbWarn: { position: 'absolute', top: 4, right: 4, backgroundColor: '#f5b301', borderRadius: 8, padding: 2 },
  pillLeft: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  pillRight: { position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  pillTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },
  playOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  playCircle: { width: 64, height: 64, borderRadius: 32, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },

  doneCard: { marginTop: 14, backgroundColor: CARD, borderRadius: 20, borderWidth: 1, borderColor: EDGE, padding: 16 },
  checkRing: { width: 52, height: 52, borderRadius: 26, borderWidth: 3, borderColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  doneSub: { color: '#9bb0a8', fontSize: 13, marginTop: 2 },
  statsRow: { flexDirection: 'row', marginTop: 14, borderWidth: 1, borderColor: '#14231d', borderRadius: 14, paddingVertical: 10 },
  stat: { flex: 1, alignItems: 'center' },
  statBig: { color: '#fff', fontSize: 16, fontWeight: '800' },
  statCap: { color: '#7f958c', fontSize: 11, marginTop: 2 },
  warn: { color: '#f5b301', fontSize: 12, marginTop: 10, lineHeight: 17 },
  codeStripFlat: { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: EDGE, padding: 14, marginTop: 12 },
  codeCap2: { color: ACCENT, fontWeight: '800', fontSize: 13, marginLeft: 10, flex: 1 },
  codeMid: { color: ACCENT, fontSize: 22, fontWeight: '900', letterSpacing: 3 },

  barBg: { alignSelf: 'stretch', height: 8, borderRadius: 4, backgroundColor: '#14231d', overflow: 'hidden', marginVertical: 14 },
  barFill: { height: 8, backgroundColor: ACCENT },
});
