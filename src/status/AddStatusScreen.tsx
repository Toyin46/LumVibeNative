// src/status/AddStatusScreen.tsx
//
// "Add status" — photo, video or text, with the privacy you choose:
//   Friends only (private)  ·  Public (friends + followers + profile visitors)
//   and, when opened from a chat's "+", also "Only in this chat".
// It does not depend on the big Create/camera screen, so it opens instantly.
// Route: AddStatus  { contextType?, contextId?, contextLabel?, mode?: 'text' }

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Dimensions, Image, Keyboard, Platform, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioPlayer, useAudioRecorder } from 'expo-audio';
import { useNavigation, useRoute } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { supabase } from '../config/supabase';
import { useAuthStore } from '../store/authStore';
import { postStatus, uploadStatusMedia } from './statusApi';

const GREEN = '#00ff88';
const { height: H } = Dimensions.get('window');
const BG_COLORS = ['#128c7e', '#075e54', '#6a1b9a', '#c2185b', '#e65100', '#1565c0', '#37474f', '#000000'];
type Vis = 'friends' | 'public' | 'private';
type Picked = { uri: string; type: 'image' | 'video'; duration?: number };
type Sound  = { uri: string; kind: 'voice' | 'music'; title: string; duration: number };
// voice notes: mono, 32 kbps — clear for speech and small to upload
const VOICE_PRESET = { ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, sampleRate: 22050, bitRate: 32000 };
const fmt = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;

function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, p => { p.loop = true; p.muted = true; p.play(); });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} surfaceType="textureView" />;
}

export default function AddStatusScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useAuthStore();
  const { contextType, contextId, contextLabel, mode: startMode } = (route.params || {}) as any;
  const inChat = !!contextType && !!contextId;

  const [mode, setMode]       = useState<'choose' | 'media' | 'text'>(startMode === 'text' ? 'text' : 'choose');
  const [asset, setAsset]     = useState<Picked | null>(null);
  const [caption, setCaption] = useState('');
  const [text, setText]       = useState('');
  const [bg, setBg]           = useState(BG_COLORS[0]);
  const [vis, setVis]         = useState<Vis>(inChat ? 'private' : 'public');
  const [busy, setBusy]       = useState(false);
  const [pct, setPct]         = useState(0);
  const [lift, setLift]       = useState(0);
  const boxRef = useRef<View>(null);

  // ── voice note / music ──
  const [sound, setSound]       = useState<Sound | null>(null);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs]   = useState(0);
  const recorder   = useAudioRecorder(VOICE_PRESET as any);
  const recTimer   = useRef<ReturnType<typeof setInterval> | null>(null);
  const recStart   = useRef(0);
  const preview    = useAudioPlayer(sound ? { uri: sound.uri } : null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => () => {                       // leaving the screen: stop everything cleanly
    if (recTimer.current) clearInterval(recTimer.current);
    try { recorder.stop(); } catch {}
  }, []);

  const startVoice = async () => {
    if (recording) return;
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Please allow microphone access.'); return; }
      try { await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true }); } catch {}
      await recorder.prepareToRecordAsync();
      recorder.record();
      recStart.current = Date.now(); setRecSecs(0); setRecording(true);
      recTimer.current = setInterval(() => {
        const d = Math.floor((Date.now() - recStart.current) / 1000);
        setRecSecs(d);
        if (d >= 60) stopVoice();                // 60-second limit
      }, 250);
    } catch (e) { setRecording(false); Alert.alert('Could not record', 'Please try again.'); }
  };
  const stopVoice = async () => {
    if (recTimer.current) { clearInterval(recTimer.current); recTimer.current = null; }
    setRecording(false);
    const secs = Math.max(1, Math.round((Date.now() - recStart.current) / 1000));
    try {
      await recorder.stop();
      try { await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); } catch {}
      if (recorder.uri) setSound({ uri: recorder.uri, kind: 'voice', title: 'Voice note', duration: Math.min(secs, 60) });
    } catch { Alert.alert('Could not save the recording', 'Please try again.'); }
  };
  const pickMusic = async () => {
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true, multiple: false });
      if (r.canceled || !r.assets?.[0]) return;
      const a: any = r.assets[0];
      if (a.size && a.size > 20 * 1024 * 1024) { Alert.alert('File too big', 'Choose a song smaller than 20 MB.'); return; }
      setSound({ uri: a.uri, kind: 'music', title: String(a.name || 'Music').replace(/\.[^.]+$/, ''), duration: 30 });
    } catch { Alert.alert('Could not open the file', 'Please try another one.'); }
  };
  const togglePreview = () => {
    try { if (playing) { preview.pause(); setPlaying(false); } else { preview.seekTo(0); preview.play(); setPlaying(true); } } catch {}
  };
  useEffect(() => { setPlaying(false); }, [sound?.uri]);

  // remember what the person chose as their usual privacy
  useEffect(() => {
    if (inChat || !user?.id) return;
    supabase.from('users').select('status_privacy').eq('id', user.id).maybeSingle().then(({ data, error }) => {
      const v = (data as any)?.status_privacy;
      if (!error && (v === 'friends' || v === 'public')) setVis(v);
    });
  }, [user?.id, inChat]);

  // keep the caption box above the keyboard on Android
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const s = Keyboard.addListener('keyboardDidShow', (e: any) => {
      boxRef.current?.measureInWindow((_x, y, _w, h) => setLift(Math.max(0, Math.round(y + h - e.endCoordinates.screenY))));
    });
    const h = Keyboard.addListener('keyboardDidHide', () => setLift(0));
    return () => { s.remove(); h.remove(); };
  }, []);

  const accept = (a: any) => {
    const duration = a.duration ? (a.duration > 1000 ? a.duration / 1000 : a.duration) : undefined;
    if (a.type === 'video' && duration && duration > 60) { Alert.alert('Video too long', 'A status video can be up to 60 seconds.'); return; }
    setAsset({ uri: a.uri, type: a.type === 'video' ? 'video' : 'image', duration });
    setMode('media');
  };

  const takeCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Please allow camera access.'); return; }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, videoMaxDuration: 60, quality: 0.7 });
    if (!r.canceled && r.assets?.[0]) accept(r.assets[0]);
  };
  const pickGallery = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Please allow gallery access.'); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, quality: 0.7 });
    if (!r.canceled && r.assets?.[0]) accept(r.assets[0]);
  };

  const options: { key: Vis; icon: string; title: string; sub: string }[] = [
    ...(inChat ? [{ key: 'private' as Vis, icon: 'chatbubbles', title: `Only ${contextLabel || 'this chat'}`, sub: 'Visible only inside this chat for 24 hours' }] : []),
    { key: 'friends', icon: 'lock-closed', title: 'Friends only', sub: 'Private — only your friends can see it' },
    { key: 'public',  icon: 'earth',       title: 'Public',       sub: 'Friends, followers and people who open your profile' },
  ];

  const post = async () => {
    if (busy) return;
    setBusy(true); setPct(0);
    try {
      try { preview.pause(); } catch {}
      let mediaUrl = '';
      if (mode === 'media' && asset) {
        const url = await uploadStatusMedia(asset.uri, asset.type, setPct);
        if (!url) { Alert.alert('Upload failed', 'Please check your internet and try again.'); return; }
        mediaUrl = url;
      }
      let audioUrl: string | undefined;
      if (sound) {
        setPct(0);
        const au = await uploadStatusMedia(sound.uri, 'audio', setPct);
        if (!au) { Alert.alert('Upload failed', 'The sound could not be uploaded. Please try again.'); return; }
        audioUrl = au;
      }
      const r = await postStatus({
        audioUrl, audioKind: sound?.kind, audioTitle: sound?.title,
        audioDuration: sound ? (sound.kind === 'music' ? Math.min(Math.round(preview.duration || 0) || 30, 30) : sound.duration) : undefined,
        mediaUrl, mediaType: mode === 'text' ? 'text' : asset!.type,
        caption: mode === 'media' ? caption : undefined, text: mode === 'text' ? text : undefined, bg: mode === 'text' ? bg : undefined,
        visibility: vis, contextType: inChat && vis === 'private' ? contextType : undefined, contextId: inChat && vis === 'private' ? contextId : undefined,
      });
      if (!r.success) { Alert.alert('Could not post', r.error || 'Please try again.'); return; }
      const where = vis === 'private' ? `Only visible in ${contextLabel || 'this chat'} for 24 hours.`
        : vis === 'friends' ? 'Only your friends can see it, for 24 hours.'
        : 'Friends, followers and people who open your profile can see it, for 24 hours.';
      Alert.alert('Status posted 🎉', where, [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } finally { setBusy(false); }
  };

  const soundPicker = (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>Add sound</Text>
      {recording ? (
        <TouchableOpacity style={[styles.opt, { borderColor: '#ff4d4d' }]} onPress={stopVoice} activeOpacity={0.85}>
          <View style={styles.recDot} />
          <Text style={[styles.optTitle, { flex: 1 }]}>Recording… {fmt(recSecs)}</Text>
          <Text style={{ color: '#ff6b6b', fontWeight: '800' }}>Tap to stop</Text>
        </TouchableOpacity>
      ) : sound ? (
        <View style={[styles.opt, styles.optOn]}>
          <TouchableOpacity onPress={togglePreview} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name={playing ? 'pause-circle' : 'play-circle'} size={34} color={GREEN} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.optTitle} numberOfLines={1}>{sound.kind === 'voice' ? '🎤 Voice note' : `🎵 ${sound.title}`}</Text>
            <Text style={styles.optSub}>{sound.kind === 'voice' ? fmt(sound.duration) : 'Plays with your status (up to 30 seconds)'}</Text>
          </View>
          <TouchableOpacity onPress={() => { try { preview.pause(); } catch {} setSound(null); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={24} color="#8a8f93" />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity style={[styles.opt, { flex: 1, justifyContent: 'center' }]} onPress={startVoice} activeOpacity={0.85}>
            <Ionicons name="mic" size={20} color={GREEN} /><Text style={styles.optTitle}>Voice note</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.opt, { flex: 1, justifyContent: 'center' }]} onPress={pickMusic} activeOpacity={0.85}>
            <Ionicons name="musical-notes" size={20} color={GREEN} /><Text style={styles.optTitle}>Music</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const privacyPicker = (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>Who can see this?</Text>
      {options.map(o => (
        <TouchableOpacity key={o.key} style={[styles.opt, vis === o.key && styles.optOn]} onPress={() => setVis(o.key)} activeOpacity={0.85}>
          <Ionicons name={o.icon as any} size={20} color={vis === o.key ? GREEN : '#9aa0a6'} />
          <View style={{ flex: 1 }}>
            <Text style={styles.optTitle}>{o.title}</Text>
            <Text style={styles.optSub}>{o.sub}</Text>
          </View>
          <Ionicons name={vis === o.key ? 'radio-button-on' : 'radio-button-off'} size={20} color={vis === o.key ? GREEN : '#555'} />
        </TouchableOpacity>
      ))}
    </View>
  );

  const header = (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => (mode === 'choose' || startMode === 'text') ? navigation.goBack() : setMode('choose')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name={mode === 'choose' ? 'close' : 'arrow-back'} size={26} color="#fff" />
      </TouchableOpacity>
      <Text style={styles.title}>{mode === 'choose' ? 'Add status' : mode === 'text' ? 'Text status' : 'New status'}</Text>
      <View style={{ width: 26 }} />
    </View>
  );

  if (mode === 'choose') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {header}
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          {inChat && <Text style={styles.hint}>For {contextLabel || 'this chat'}</Text>}
          <TouchableOpacity style={styles.big} onPress={takeCamera}>
            <View style={styles.bigIcon}><Ionicons name="camera" size={26} color="#000" /></View>
            <View style={{ flex: 1 }}><Text style={styles.bigTitle}>Camera</Text><Text style={styles.bigSub}>Take a photo or record a video</Text></View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.big} onPress={pickGallery}>
            <View style={styles.bigIcon}><Ionicons name="images" size={26} color="#000" /></View>
            <View style={{ flex: 1 }}><Text style={styles.bigTitle}>Gallery</Text><Text style={styles.bigSub}>Choose a photo or video</Text></View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.big} onPress={() => setMode('text')}>
            <View style={styles.bigIcon}><Ionicons name="text" size={26} color="#000" /></View>
            <View style={{ flex: 1 }}><Text style={styles.bigTitle}>Text</Text><Text style={styles.bigSub}>Write something on a colour</Text></View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.big} onPress={() => { setMode('text'); setTimeout(startVoice, 300); }}>
            <View style={styles.bigIcon}><Ionicons name="mic" size={26} color="#000" /></View>
            <View style={{ flex: 1 }}><Text style={styles.bigTitle}>Voice note</Text><Text style={styles.bigSub}>Record up to 60 seconds</Text></View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.link}
            onPress={() => navigation.replace('Story', { contextType, contextId, contextLabel })}>
            <Text style={styles.linkText}>Use the camera with effects instead</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (mode === 'text') {
    return (
      <View style={{ flex: 1, backgroundColor: bg }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          {header}
          <View ref={boxRef} collapsable={false} style={{ flex: 1, paddingBottom: lift }}>
            <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled">
              <TextInput style={styles.textInput} value={text} onChangeText={setText} multiline maxLength={400} autoFocus
                placeholder="Type a status" placeholderTextColor="rgba(255,255,255,0.55)" textAlign="center" />
            </ScrollView>
            <View style={styles.sheet}>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {BG_COLORS.map(c => <TouchableOpacity key={c} onPress={() => setBg(c)} style={[styles.swatch, { backgroundColor: c }, c === bg && { borderColor: '#fff' }]} />)}
              </View>
              {soundPicker}
              {privacyPicker}
              <TouchableOpacity style={[styles.post, ((!text.trim() && !sound) || busy) && { opacity: 0.5 }]} disabled={(!text.trim() && !sound) || busy || recording} onPress={post}>
                {busy ? <ActivityIndicator color="#000" /> : <Text style={styles.postText}>Post status</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {header}
      <View ref={boxRef} collapsable={false} style={{ flex: 1, paddingBottom: lift }}>
        <View style={styles.preview}>
          {asset?.type === 'video' ? <VideoPreview uri={asset.uri} /> : <Image source={{ uri: asset!.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />}
        </View>
        <ScrollView style={{ maxHeight: H * 0.46 }} contentContainerStyle={styles.sheetScroll} keyboardShouldPersistTaps="handled">
          <TextInput style={styles.caption} value={caption} onChangeText={setCaption} placeholder="Add a caption…" placeholderTextColor="#777" maxLength={300} />
          {soundPicker}
          {privacyPicker}
          <TouchableOpacity style={[styles.post, busy && { opacity: 0.7 }]} disabled={busy || recording} onPress={post}>
            {busy ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><ActivityIndicator color="#000" /><Text style={styles.postText}>{pct > 0 && pct < 100 ? `Uploading ${pct}%` : 'Posting…'}</Text></View>
                  : <Text style={styles.postText}>Post status</Text>}
          </TouchableOpacity>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  hint: { color: '#8a8f93', fontSize: 13.5, textAlign: 'center', marginBottom: 2 },
  big: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#111', borderRadius: 18, borderWidth: 1, borderColor: '#222', padding: 16 },
  bigIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' },
  bigTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  bigSub: { color: '#8a8f93', fontSize: 13.5, marginTop: 2 },
  link: { alignItems: 'center', paddingVertical: 14 },
  linkText: { color: GREEN, fontSize: 14, fontWeight: '600' },
  preview: { flex: 1, backgroundColor: '#050505', borderRadius: 14, marginHorizontal: 12, overflow: 'hidden' },
  sheetScroll: { padding: 14, gap: 12 },
  caption: { backgroundColor: '#161616', color: '#fff', fontSize: 15, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11 },
  label: { color: '#9aa0a6', fontSize: 13, fontWeight: '700', marginTop: 2 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#111', borderRadius: 14, borderWidth: 1, borderColor: '#222', padding: 12 },
  optOn: { borderColor: GREEN, backgroundColor: 'rgba(0,255,136,0.07)' },
  optTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  optSub: { color: '#8a8f93', fontSize: 12.5, marginTop: 1 },
  post: { backgroundColor: GREEN, borderRadius: 14, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  postText: { color: '#000', fontSize: 16, fontWeight: '800' },
  textInput: { color: '#fff', fontSize: 30, fontWeight: '700', textAlign: 'center', maxHeight: 340 },
  sheet: { backgroundColor: 'rgba(0,0,0,0.55)', padding: 14, gap: 10, borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#ff4d4d' },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: 'transparent' },
});
