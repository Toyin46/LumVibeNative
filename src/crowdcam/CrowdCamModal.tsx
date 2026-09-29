// ─────────────────────────────────────────────────────────────
// src/crowdcam/CrowdCamModal.tsx
// The whole Crowd Cam screen. create.tsx only renders <CrowdCamModal .../>
// and receives the finished film through onFilmReady.
//
// Flow:  home (create / join) -> lobby (camera preview + code)
//        -> recording (everyone, started by the host) -> uploading
//        -> film (host builds the film from all uploaded clips)
// ─────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, Modal, ActivityIndicator,
  StyleSheet, Alert, Share, Platform, StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Camera, useCameraDevice, useCameraFormat,
  useCameraPermission, useMicrophonePermission, VideoFile,
} from 'react-native-vision-camera';
import { useAuthStore } from '../store/authStore';
import {
  CrowdRoom, createRoom, joinRoom, getRoom, setRoomStatus, watchRoom,
  countMembers, listClips, uploadClip,
} from './crowdCamApi';
import { buildCrowdFilm, BuildStage } from './buildFilm';

const ACCENT = '#00ff88';
const MAX_TAKE_SEC = 90;   // auto-stop: keeps files (and mobile data) small
const MAX_FILM_SEC = 45;   // keep the spliced URL short for the first tests

type Step = 'home' | 'lobby' | 'recording' | 'uploading' | 'film';

export interface CrowdFilmResult {
  localUri: string;
  contributors: string[];
  durationSec: number;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onFilmReady: (r: CrowdFilmResult) => void;
}

const STAGE_TEXT: Record<BuildStage, string> = {
  listing: 'Finding everyone\'s clips…',
  audio: 'Listening to each phone…',
  syncing: 'Lining the clips up…',
  cutting: 'Choosing the best angles…',
  rendering: 'Building your film (can take a minute)…',
  downloading: 'Downloading the finished film…',
  done: 'Done',
};

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

export default function CrowdCamModal({ visible, onClose, onFilmReady }: Props) {
  const { user } = useAuthStore();
  const userId: string | undefined = (user as any)?.id;

  const [step, setStep] = useState<Step>('home');
  const [room, setRoom] = useState<CrowdRoom | null>(null);
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState(1);
  const [clipCount, setClipCount] = useState(0);
  const [recSec, setRecSec] = useState(0);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [myClipUploaded, setMyClipUploaded] = useState(false);
  const [buildText, setBuildText] = useState('');
  const [building, setBuilding] = useState(false);

  const isHost = !!room && !!userId && room.host_id === userId;

  // camera
  const { hasPermission: hasCam, requestPermission: reqCam } = useCameraPermission();
  const { hasPermission: hasMic, requestPermission: reqMic } = useMicrophonePermission();
  const device = useCameraDevice('back');
  const format = useCameraFormat(device, [
    { videoResolution: { width: 1280, height: 720 } },
    { fps: 30 },
  ]);
  const cameraRef = useRef<Camera>(null);
  const [camReady, setCamReady] = useState(false);

  // refs so timers/callbacks always see fresh values
  const stepRef = useRef<Step>('home');
  const roomRef = useRef<CrowdRoom | null>(null);
  const recordingRef = useRef(false);
  const recStartedAt = useRef<Date | null>(null);
  const pendingFile = useRef<{ uri: string; durationSec: number; recordedAt: Date } | null>(null);
  const recSecRef = useRef(0);
  useEffect(() => { stepRef.current = step; }, [step]);
  useEffect(() => { roomRef.current = room; }, [room]);

  // ask for permissions when the modal opens
  useEffect(() => {
    if (!visible) return;
    (async () => {
      if (!hasCam) await reqCam();
      if (!hasMic) await reqMic();
    })();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // full reset when the modal is closed
  const resetAll = useCallback(() => {
    setStep('home'); setRoom(null); setCode(''); setTitle(''); setBusy(false);
    setMembers(1); setClipCount(0); setRecSec(0); setUploadPct(0); setUploadErr(null);
    setMyClipUploaded(false); setBuildText(''); setBuilding(false); setCamReady(false);
    recordingRef.current = false; pendingFile.current = null;
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
      setMyClipUploaded(true);
      setStep('film');
    } catch (e: any) {
      setUploadErr(e?.message || 'Upload failed');
    }
  }, [userId]);

  const startRecording = useCallback(() => {
    if (recordingRef.current || !cameraRef.current) return;
    recordingRef.current = true;
    recStartedAt.current = new Date();
    setRecSec(0);
    setStep('recording');
    cameraRef.current.startRecording({
      onRecordingFinished: (video: VideoFile) => {
        recordingRef.current = false;
        const uri = Platform.OS === 'android' && !video.path.startsWith('file://') ? `file://${video.path}` : video.path;
        pendingFile.current = {
          uri,
          durationSec: Math.round((video.duration ?? recSecRef.current) * 100) / 100,
          recordedAt: recStartedAt.current ?? new Date(),
        };
        beginUpload();
      },
      onRecordingError: (err: any) => {
        recordingRef.current = false;
        setStep('lobby');
        Alert.alert('Recording problem', String(err?.message || err));
      },
    });
  }, [beginUpload]);

  const stopRecording = useCallback(async () => {
    if (!recordingRef.current) return;
    try { await cameraRef.current?.stopRecording(); } catch { /* finished callback still fires */ }
  }, []);

  // recording timer + auto stop
  useEffect(() => { recSecRef.current = recSec; }, [recSec]);
  useEffect(() => {
    if (step !== 'recording') return;
    const t = setInterval(() => setRecSec(x => x + 1), 1000);
    return () => clearInterval(t);
  }, [step]);
  useEffect(() => {
    if (step === 'recording' && recSec >= MAX_TAKE_SEC) stopRecording();
  }, [recSec, step, stopRecording]);

  // ── reacting to the room (realtime + a slow poll as a safety net) ──
  const applyRoom = useCallback((r: CrowdRoom) => {
    setRoom(r);
    const s = stepRef.current;
    if (r.status === 'recording' && s === 'lobby') startRecording();
    if (r.status === 'closed' && s === 'recording') stopRecording();
  }, [startRecording, stopRecording]);

  useEffect(() => {
    if (!room?.id) return;
    const unwatch = watchRoom(room.id, applyRoom);
    const poll = setInterval(async () => {
      try {
        const r = await getRoom(room.id);
        if (r) applyRoom(r);
        setMembers(await countMembers(room.id));
        if (stepRef.current === 'film' || stepRef.current === 'uploading') {
          setClipCount((await listClips(room.id)).length);
        }
      } catch { /* offline for a moment: try again next tick */ }
    }, 2500);
    return () => { unwatch(); clearInterval(poll); };
  }, [room?.id, applyRoom]);

  // ── actions ────────────────────────────────────────────────
  const onCreate = async () => {
    if (!userId) return Alert.alert('Sign in first');
    setBusy(true);
    try {
      const r = await createRoom(title || 'Crowd Cam');
      setRoom(r); setStep('lobby');
    } catch (e: any) { Alert.alert('Could not create room', e?.message || ''); }
    setBusy(false);
  };

  const onJoin = async () => {
    if (!userId) return Alert.alert('Sign in first');
    if (code.trim().length < 4) return Alert.alert('Enter the room code');
    setBusy(true);
    try {
      const r = await joinRoom(code);
      setRoom(r); setStep('lobby');
      if (r.status === 'recording') setTimeout(() => applyRoom(r), 600); // joined late: start straight away
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

  const onShare = () => {
    if (!room) return;
    Share.share({ message: `Join my LumVibe Crowd Cam "${room.title}". Room code: ${room.join_code}` });
  };

  const onMakeFilm = async () => {
    if (!room) return;
    setBuilding(true);
    try {
      const res = await buildCrowdFilm(room.id, {
        maxFilmSec: MAX_FILM_SEC,
        onStage: (s, d) => setBuildText(STAGE_TEXT[s] + (d ? ` ${d}` : '')),
      });
      if (res.failedClipIds.length) {
        Alert.alert(
          'Some clips were left out',
          `${res.failedClipIds.length} clip(s) could not be lined up with the others (the sound was too different, or they don't overlap in time).`,
        );
      }
      onFilmReady({ localUri: res.localUri, contributors: res.contributors, durationSec: res.durationSec });
    } catch (e: any) {
      Alert.alert('Could not make the film', e?.message || 'Unknown error');
    }
    setBuilding(false);
    setBuildText('');
  };

  const leave = () => {
    if (recordingRef.current) {
      Alert.alert('You are recording', 'Stop recording first.');
      return;
    }
    onClose();
  };

  // ── UI ─────────────────────────────────────────────────────
  const showCamera = visible && (step === 'lobby' || step === 'recording') && hasCam && hasMic && !!device;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={leave} statusBarTranslucent>
      <StatusBar barStyle="light-content" />
      <View style={s.root}>
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

        <View style={s.topRow}>
          <TouchableOpacity style={s.iconBtn} onPress={leave}>
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={s.topTitle}>Crowd Cam</Text>
          <View style={{ width: 40 }} />
        </View>

        {(!hasCam || !hasMic) && (
          <View style={s.center}>
            <Text style={s.h1}>Camera and microphone needed</Text>
            <TouchableOpacity style={s.primary} onPress={async () => { await reqCam(); await reqMic(); }}>
              <Text style={s.primaryTxt}>Allow access</Text>
            </TouchableOpacity>
          </View>
        )}

        {hasCam && hasMic && step === 'home' && (
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
            <TextInput style={[s.input, s.codeInput]} value={code} onChangeText={t => setCode(t.toUpperCase())}
              placeholder="ROOM CODE" placeholderTextColor="#666" autoCapitalize="characters" maxLength={8} />
            <TouchableOpacity style={[s.secondary, busy && s.dim]} disabled={busy} onPress={onJoin}>
              <Text style={s.secondaryTxt}>Join</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 'lobby' && room && (
          <View style={s.bottomCard}>
            <Text style={s.label}>{room.title}</Text>
            <Text style={s.code}>{room.join_code}</Text>
            <Text style={s.sub}>{members} phone{members === 1 ? '' : 's'} in the room</Text>
            <TouchableOpacity style={s.secondary} onPress={onShare}>
              <Ionicons name="share-outline" size={16} color={ACCENT} />
              <Text style={s.secondaryTxt}>  Share code</Text>
            </TouchableOpacity>
            {isHost ? (
              <TouchableOpacity style={[s.primary, (!camReady || busy) && s.dim]} disabled={!camReady || busy} onPress={onHostStart}>
                <Text style={s.primaryTxt}>{camReady ? 'Start recording for everyone' : 'Getting camera ready…'}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={s.wait}>Waiting for the host to start…{'\n'}Point your phone at the action.</Text>
            )}
          </View>
        )}

        {step === 'recording' && (
          <>
            <View style={s.recBadge}>
              <View style={s.recDot} />
              <Text style={s.recTxt}>{fmt(recSec)}</Text>
            </View>
            <View style={s.recBottom}>
              <TouchableOpacity style={s.stopBtn} onPress={isHost ? onHostStop : stopRecording}>
                <View style={s.stopSquare} />
              </TouchableOpacity>
              <Text style={s.hint}>{isHost ? 'Tap to stop everyone' : 'Tap to stop your phone'}</Text>
            </View>
          </>
        )}

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

        {step === 'film' && room && (
          <View style={s.center}>
            <Ionicons name="checkmark-circle" size={54} color={ACCENT} />
            <Text style={s.h1}>{myClipUploaded ? 'Your clip is uploaded' : 'Clip uploaded'}</Text>
            <Text style={s.sub}>{clipCount} of {members} clip{members === 1 ? '' : 's'} in the room</Text>
            {isHost ? (
              building ? (
                <>
                  <ActivityIndicator color={ACCENT} style={{ marginTop: 18 }} />
                  <Text style={[s.sub, { marginTop: 10 }]}>{buildText}</Text>
                </>
              ) : (
                <>
                  <TouchableOpacity style={[s.primary, clipCount < 2 && s.dim]} disabled={clipCount < 2} onPress={onMakeFilm}>
                    <Text style={s.primaryTxt}>Make the film</Text>
                  </TouchableOpacity>
                  <Text style={s.hint}>{clipCount < 2 ? 'Waiting for at least 2 clips…' : 'Wait until everyone has uploaded, then tap.'}</Text>
                </>
              )
            ) : (
              <Text style={s.wait}>The host will build the film and post it.{'\n'}You'll be credited.</Text>
            )}
          </View>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  topRow: { position: 'absolute', top: 44, left: 0, right: 0, zIndex: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  topTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  panel: { flex: 1, paddingHorizontal: 22, paddingTop: 110 },
  h1: { color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  sub: { color: '#9a9a9a', fontSize: 13, textAlign: 'center', marginBottom: 14, lineHeight: 19 },
  label: { color: '#cfcfcf', fontSize: 13, fontWeight: '700', marginTop: 10, marginBottom: 8 },
  input: { backgroundColor: '#151515', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 12, color: '#fff', paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 12 },
  codeInput: { letterSpacing: 4, textAlign: 'center', fontSize: 20, fontWeight: '800' },
  primary: { backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', marginTop: 8, alignSelf: 'stretch' },
  primaryTxt: { color: '#000', fontSize: 15, fontWeight: '800' },
  secondary: { flexDirection: 'row', borderWidth: 1, borderColor: ACCENT, borderRadius: 14, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', marginTop: 8, alignSelf: 'stretch' },
  secondaryTxt: { color: ACCENT, fontSize: 14, fontWeight: '700' },
  dim: { opacity: 0.45 },
  divider: { height: 1, backgroundColor: '#222', marginVertical: 18 },
  bottomCard: { position: 'absolute', left: 14, right: 14, bottom: 26, backgroundColor: 'rgba(10,10,10,0.88)', borderRadius: 20, padding: 18, borderWidth: 1, borderColor: '#222' },
  code: { color: ACCENT, fontSize: 38, fontWeight: '900', letterSpacing: 8, textAlign: 'center', marginVertical: 6 },
  wait: { color: '#bdbdbd', textAlign: 'center', marginTop: 14, lineHeight: 20 },
  hint: { color: '#8a8a8a', fontSize: 12, textAlign: 'center', marginTop: 10 },
  recBadge: { position: 'absolute', top: 100, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ff3b30', marginRight: 8 },
  recTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
  recBottom: { position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center' },
  stopBtn: { width: 74, height: 74, borderRadius: 37, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  stopSquare: { width: 28, height: 28, borderRadius: 6, backgroundColor: '#ff3b30' },
  barBg: { alignSelf: 'stretch', height: 8, borderRadius: 4, backgroundColor: '#222', overflow: 'hidden', marginVertical: 14 },
  barFill: { height: 8, backgroundColor: ACCENT },
});
