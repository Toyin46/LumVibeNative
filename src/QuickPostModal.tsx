// src/quickpost/QuickPostModal.tsx   (new file)
//
// The TEXT and PHOTOS options on the Create screen. This only PREPARES the post:
//   TEXT    - type your words, pick one of 5 clean templates, tap Next -> the finished card goes to the compose
//             screen, where you can add music, location, vibe, schedule and post (one place for everything).
//             Tip: put *stars* around a word to highlight it, like  Clean designs impress, but *bold* ones stay
//   PHOTOS  - pick up to 10 photos at once, tap Next -> they go to the compose screen, same as above.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Image, Alert, ActivityIndicator,
  StyleSheet, Dimensions, Platform, KeyboardAvoidingView, Switch, Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { captureRef } from 'react-native-view-shot';
import { supabase } from '../config/supabase';
import { useAuthStore } from '../store/authStore';

const { width: SW } = Dimensions.get('window');
const MAX_TEXT = 300;
const MAX_PHOTOS = 10;
const GREEN = '#00ff88';

// ─────────────────────────── TEMPLATES ───────────────────────────
type Tpl = {
  id: string; name: string;
  outer: [string, string];          // background gradient
  card?: [string, string];          // inner rounded card (framed look)
  text: string; accent: string; muted: string;
  serif?: boolean;
  pill?: { bg: string; fg: string };
};
const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' });

const TEMPLATES: Tpl[] = [
  { id: 'lilac',    name: 'Lilac',    outer: ['#0c0814', '#2b1655'], card: ['#ffffff', '#f6e7ff'], text: '#15101f', accent: '#7c3aed', muted: '#7c3aed', pill: { bg: '#7c3aed', fg: '#ffffff' } },
  { id: 'midnight', name: 'Midnight', outer: ['#07070a', '#17172b'], text: '#ffffff', accent: GREEN, muted: '#8a8aa0' },
  { id: 'sunset',   name: 'Sunset',   outer: ['#ff6b6b', '#ffa94d'], text: '#ffffff', accent: '#3b0764', muted: 'rgba(255,255,255,0.85)' },
  { id: 'ocean',    name: 'Ocean',    outer: ['#0f2027', '#2c5364'], text: '#f0fdfa', accent: '#5eead4', muted: '#99f6e4', serif: true },
  { id: 'paper',    name: 'Paper',    outer: ['#f7f1e6', '#efe6d4'], text: '#2b2118', accent: '#c2410c', muted: '#8a7560', serif: true },
];

const plainText = (t: string) => t.replace(/\*([^*\n]+)\*/g, '$1');

function renderRich(text: string, accent: string) {
  return text.split(/(\*[^*\n]+\*)/g).map((p, i) =>
    /^\*[^*\n]+\*$/.test(p)
      ? <Text key={i} style={{ color: accent, fontWeight: '800' }}>{p.slice(1, -1)}</Text>
      : <Text key={i}>{p}</Text>,
  );
}

function fontSizeFor(len: number, scale: number) {
  const base = len <= 40 ? 40 : len <= 80 ? 34 : len <= 140 ? 28 : len <= 220 ? 23 : 19;
  return base * scale;
}

// The card that becomes the picture. 4:5 shape (1080 x 1350 when saved).
function TextCard({
  tpl, text, signature, handle, width, mini,
}: { tpl: Tpl; text: string; signature?: string; handle?: string; width: number; mini?: boolean }) {
  const sc = width / 360;
  const shown = mini ? 'Aa' : (text.trim() || 'Your words go here');
  const empty = !mini && !text.trim();
  const fs = mini ? 30 * sc : fontSizeFor(plainText(shown).length, sc);
  const family = tpl.serif ? SERIF : undefined;

  const textBlock = (
    <Text
      style={{
        color: empty ? tpl.muted : tpl.text, fontFamily: family, fontSize: fs, lineHeight: fs * 1.22,
        fontWeight: tpl.serif ? '600' : '600', textAlign: 'center', letterSpacing: tpl.serif ? 0 : -0.5,
        opacity: empty ? 0.6 : 1,
      }}
    >
      {mini ? shown : renderRich(shown, tpl.accent)}
    </Text>
  );

  return (
    <View collapsable={false} style={{ width, height: width * 1.25, overflow: 'hidden' }}>
      <LinearGradient colors={tpl.outer} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {/* soft decorative glow */}
      <View style={{ position: 'absolute', top: -width * 0.25, right: -width * 0.2, width: width * 0.7, height: width * 0.7, borderRadius: width, backgroundColor: tpl.accent, opacity: 0.12 }} />
      <View style={{ position: 'absolute', bottom: -width * 0.3, left: -width * 0.25, width: width * 0.8, height: width * 0.8, borderRadius: width, backgroundColor: tpl.accent, opacity: 0.08 }} />

      {tpl.card ? (
        <>
          <View style={{ position: 'absolute', left: width * 0.08, right: width * 0.08, top: width * 0.08, bottom: width * 0.2, borderRadius: width * 0.07, overflow: 'hidden' }}>
            <LinearGradient colors={tpl.card} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            {!mini && (
              <View style={{ position: 'absolute', top: width * 0.06, left: width * 0.07, right: width * 0.07, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ height: 1, flex: 0.62, backgroundColor: 'rgba(21,16,31,0.35)' }} />
                <Text style={{ color: 'rgba(21,16,31,0.55)', fontSize: 12 * sc, letterSpacing: 2 }}>○○○</Text>
              </View>
            )}
            <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: width * 0.09, paddingTop: width * 0.05 }}>
              {textBlock}
              {!mini && !!signature && (
                <Text style={{ color: tpl.muted, fontSize: 14 * sc, textAlign: 'center', marginTop: 18 * sc, fontFamily: family }}>- {signature}</Text>
              )}
            </View>
          </View>
          {!mini && (
            <View style={{ position: 'absolute', left: width * 0.08, right: width * 0.08, bottom: width * 0.065, height: width * 0.085, borderRadius: width, backgroundColor: tpl.pill?.bg ?? tpl.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: tpl.pill?.fg ?? '#fff', fontSize: 12 * sc, fontWeight: '600' }}>{handle ? `@${handle}  ·  LumVibe` : 'LumVibe'}</Text>
            </View>
          )}
        </>
      ) : (
        <>
          <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: width * 0.1 }}>
            {!mini && <Text style={{ color: tpl.accent, fontSize: 64 * sc, lineHeight: 64 * sc, fontFamily: SERIF, marginBottom: 4 * sc, textAlign: 'center' }}>“</Text>}
            {textBlock}
            {!mini && !!signature && (
              <Text style={{ color: tpl.muted, fontSize: 14 * sc, textAlign: 'center', marginTop: 20 * sc, fontFamily: family }}>- {signature}</Text>
            )}
          </View>
          {!mini && (
            <Text style={{ position: 'absolute', bottom: width * 0.06, alignSelf: 'center', color: tpl.muted, fontSize: 11 * sc, letterSpacing: 1.5, fontWeight: '600', opacity: 0.9 }}>
              {handle ? `@${handle}  ·  LUMVIBE` : 'LUMVIBE'}
            </Text>
          )}
        </>
      )}
    </View>
  );
}


// ─────────────────────────── MODAL ───────────────────────────
type Props = {
  visible: boolean;
  initialMode: 'text' | 'photos';
  onClose: () => void;
  onTextReady: (uri: string, template: string, content: string) => void;
  onPhotosReady: (uris: string[]) => void;
};

export default function QuickPostModal({ visible, initialMode, onClose, onTextReady, onPhotosReady }: Props) {
  const user = useAuthStore((s: any) => s.user);

  const [mode, setMode] = useState<'text' | 'photos'>(initialMode);
  const [tplId, setTplId] = useState('lilac');
  const [text, setText] = useState('');
  const [showName, setShowName] = useState(true);
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState<{ username?: string; display_name?: string } | null>(null);
  const cardRef = useRef<View>(null);

  // every time it opens: start fresh on the chosen option
  useEffect(() => {
    if (visible) { setMode(initialMode); setText(''); setPhotos([]); setBusy(false); }
  }, [visible, initialMode]);

  const tpl = useMemo(() => TEMPLATES.find((t) => t.id === tplId) || TEMPLATES[0], [tplId]);
  const cardW = SW - 32;
  const handle = profile?.username || '';
  const signature = showName ? (profile?.display_name || profile?.username || '') : '';

  useEffect(() => {
    if (!visible || !user?.id) return;
    supabase.from('users').select('username, display_name').eq('id', user.id).maybeSingle()
      .then(({ data }) => { if (data) setProfile(data as any); });
  }, [visible, user?.id]);

  const pickPhotos = async () => {
    try {
      const room = MAX_PHOTOS - photos.length;
      if (room <= 0) { Alert.alert('Maximum reached', `You can add up to ${MAX_PHOTOS} photos.`); return; }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: room,
        quality: 1,
      });
      if (result.canceled) return;
      setPhotos((prev) => [...prev, ...result.assets.map((a) => a.uri)].slice(0, MAX_PHOTOS));
    } catch (e: any) {
      Alert.alert('Could not open your photos', e?.message || 'Please try again.');
    }
  };

  const next = async () => {
    if (busy) return;
    if (mode === 'photos') {
      if (photos.length === 0) { Alert.alert('Add photos first', 'Tap "Add photos" to choose from your gallery.'); return; }
      onPhotosReady(photos);
      return;
    }
    const t = text.trim();
    if (t.length < 2) { Alert.alert('Write something first', 'Type at least a few words.'); return; }
    setBusy(true);
    try {
      const uri = await captureRef(cardRef, { format: 'jpg', quality: 0.95, result: 'tmpfile', width: 1080, height: 1350 });
      onTextReady(uri, tpl.id, plainText(t));
    } catch (e: any) {
      Alert.alert('Could not create your card', e?.message || 'Please try again.');
    } finally { setBusy(false); }
  };

  const thumbW = (SW - 32 - 16) / 3;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.header}>
          <TouchableOpacity onPress={onClose} disabled={busy} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
          <Text style={s.title}>New post</Text>
          <TouchableOpacity style={[s.postBtn, busy && { opacity: 0.5 }]} onPress={next} disabled={busy}>
            {busy ? <ActivityIndicator color="#000" size="small" /> : <Text style={s.postBtnTxt}>Next</Text>}
          </TouchableOpacity>
        </View>

        <View style={s.tabs}>
          {(['text', 'photos'] as const).map((m) => (
            <TouchableOpacity key={m} style={[s.tab, mode === m && s.tabActive]} onPress={() => !busy && setMode(m)}>
              <Ionicons name={m === 'text' ? 'text' : 'images'} size={16} color={mode === m ? '#000' : '#aaa'} />
              <Text style={[s.tabTxt, mode === m && { color: '#000' }]}>{m === 'text' ? 'Text' : 'Photos'}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          {mode === 'text' ? (
            <>
              <View style={{ borderRadius: 20, overflow: 'hidden', alignSelf: 'center' }}>
                <View ref={cardRef} collapsable={false}>
                  <TextCard tpl={tpl} text={text} signature={signature} handle={handle} width={cardW} />
                </View>
              </View>

              <Text style={s.label}>Template</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                {TEMPLATES.map((t) => (
                  <TouchableOpacity key={t.id} onPress={() => setTplId(t.id)} style={[s.tplBtn, tplId === t.id && s.tplBtnActive]}>
                    <View style={{ borderRadius: 10, overflow: 'hidden' }}><TextCard tpl={t} text="" width={64} mini /></View>
                    <Text style={[s.tplName, tplId === t.id && { color: GREEN }]}>{t.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={s.label}>Your words</Text>
              <TextInput
                style={s.input}
                value={text}
                onChangeText={(v) => setText(v.slice(0, MAX_TEXT))}
                placeholder="Write something..."
                placeholderTextColor="#666"
                multiline
                editable={!busy}
              />
              <View style={s.hintRow}>
                <Text style={s.hint}>Tip: put *stars* around a word to highlight it</Text>
                <Text style={s.hint}>{text.length}/{MAX_TEXT}</Text>
              </View>

              <View style={s.switchRow}>
                <Text style={s.switchTxt}>Show my name under the text</Text>
                <Switch value={showName} onValueChange={setShowName} trackColor={{ true: GREEN, false: '#333' }} thumbColor="#fff" />
              </View>
              <Text style={[s.hint, { marginTop: 14 }]}>Next: add music, location, a caption and post, all on the next screen.</Text>
            </>
          ) : (
            <>
              {photos.length === 0 ? (
                <TouchableOpacity style={s.emptyBox} onPress={pickPhotos} activeOpacity={0.8}>
                  <Ionicons name="images-outline" size={44} color={GREEN} />
                  <Text style={s.emptyTitle}>Add photos</Text>
                  <Text style={s.emptySub}>Choose up to {MAX_PHOTOS} photos at once</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <View style={s.grid}>
                    {photos.map((uri, i) => (
                      <View key={uri + i} style={{ width: thumbW, height: thumbW }}>
                        <Image source={{ uri }} style={s.thumb} />
                        <TouchableOpacity style={s.removeBtn} onPress={() => setPhotos((prev) => prev.filter((_, k) => k !== i))}>
                          <Ionicons name="close" size={14} color="#fff" />
                        </TouchableOpacity>
                        {i === 0 && <View style={s.coverTag}><Text style={s.coverTxt}>Cover</Text></View>}
                      </View>
                    ))}
                    {photos.length < MAX_PHOTOS && (
                      <TouchableOpacity style={[s.addTile, { width: thumbW, height: thumbW }]} onPress={pickPhotos}>
                        <Ionicons name="add" size={30} color={GREEN} />
                      </TouchableOpacity>
                    )}
                  </View>
                  <Text style={s.hint}>{photos.length} of {MAX_PHOTOS} photos. Friends can swipe through all of them.</Text>
                </>
              )}
              <Text style={[s.hint, { marginTop: 14 }]}>Next: add music, location, a caption and post, all on the next screen.</Text>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 54 : 40, paddingBottom: 10 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  postBtn: { backgroundColor: GREEN, borderRadius: 18, paddingHorizontal: 18, paddingVertical: 8, minWidth: 64, alignItems: 'center' },
  postBtnTxt: { color: '#000', fontWeight: '800', fontSize: 14 },
  tabs: { flexDirection: 'row', marginHorizontal: 16, backgroundColor: '#161616', borderRadius: 14, padding: 4, marginBottom: 6 },
  tab: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 11 },
  tabActive: { backgroundColor: GREEN },
  tabTxt: { color: '#aaa', fontWeight: '700', fontSize: 14 },
  label: { color: '#fff', fontWeight: '700', fontSize: 14, marginTop: 20, marginBottom: 8 },
  tplBtn: { alignItems: 'center', padding: 4, borderRadius: 12, borderWidth: 2, borderColor: 'transparent' },
  tplBtnActive: { borderColor: GREEN },
  tplName: { color: '#aaa', fontSize: 11, marginTop: 4, fontWeight: '600' },
  input: { backgroundColor: '#141414', color: '#fff', borderRadius: 14, padding: 14, fontSize: 16, minHeight: 90, textAlignVertical: 'top' },
  hintRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  hint: { color: '#777', fontSize: 12, marginTop: 6 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 },
  switchTxt: { color: '#ddd', fontSize: 14 },
  emptyBox: { borderWidth: 2, borderStyle: 'dashed', borderColor: '#2a2a2a', borderRadius: 18, alignItems: 'center', justifyContent: 'center', paddingVertical: 50, gap: 6 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginTop: 6 },
  emptySub: { color: '#888', fontSize: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumb: { width: '100%', height: '100%', borderRadius: 12, backgroundColor: '#111' },
  removeBtn: { position: 'absolute', top: 5, right: 5, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  coverTag: { position: 'absolute', bottom: 5, left: 5, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  coverTxt: { color: '#fff', fontSize: 10, fontWeight: '700' },
  addTile: { borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' },
});
