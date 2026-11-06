// src/quick-post.tsx   (new file: put it next to story.tsx / search.tsx)
//
// Two quick ways to post, both saved as normal posts (so likes, comments, shares, gifts, profile grid, explore
// and the weekly contest all work with no changes):
//   TEXT    - type something, pick one of 5 clean templates, post. The finished card is saved as a picture.
//             Tip: put *stars* around a word to highlight it, like  Clean designs impress, but *bold* ones stay
//   PHOTOS  - pick up to 10 photos at once. Shown as a Facebook-style collage in the feed.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Image, Alert, ActivityIndicator,
  StyleSheet, Dimensions, Platform, KeyboardAvoidingView, Switch,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { captureRef } from 'react-native-view-shot';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from './config/supabase';
import { useAuthStore } from './store/authStore';

const { width: SW } = Dimensions.get('window');
const CLOUDINARY_CLOUD_NAME = 'dvllxm0wg';
const CLOUDINARY_UPLOAD_PRESET = 'Kinsta_unsigned';
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

// ─────────────────────────── UPLOAD ───────────────────────────
async function uploadImage(uri: string): Promise<{ url: string; publicId: string | null }> {
  const form = new FormData();
  form.append('file', { uri, type: 'image/jpeg', name: `img_${Date.now()}_${Math.floor(Math.random() * 1e6)}.jpg` } as any);
  form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  form.append('resource_type', 'image');
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[quick-post] Cloudinary rejected the upload:', res.status, body);
    throw new Error('Upload failed. Please check your connection and try again.');
  }
  const json = await res.json();
  return { url: json.secure_url as string, publicId: (json.public_id as string) || null };
}

// ─────────────────────────── SCREEN ───────────────────────────
export default function QuickPostScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const user = useAuthStore((s: any) => s.user);

  const [mode, setMode] = useState<'text' | 'photos'>(route.params?.mode === 'photos' ? 'photos' : 'text');
  const [tplId, setTplId] = useState('lilac');
  const [text, setText] = useState('');
  const [showName, setShowName] = useState(true);
  const [caption, setCaption] = useState('');
  const [photos, setPhotos] = useState<{ uri: string; width?: number; height?: number }[]>([]);
  const [posting, setPosting] = useState(false);
  const [progress, setProgress] = useState('');
  const [profile, setProfile] = useState<{ username?: string; display_name?: string } | null>(null);
  const cardRef = useRef<View>(null);

  const tpl = useMemo(() => TEMPLATES.find((t) => t.id === tplId) || TEMPLATES[0], [tplId]);
  const cardW = SW - 32;
  const handle = profile?.username || '';
  const signature = showName ? (profile?.display_name || profile?.username || '') : '';

  useEffect(() => {
    if (!user?.id) return;
    supabase.from('users').select('username, display_name').eq('id', user.id).maybeSingle()
      .then(({ data }) => { if (data) setProfile(data as any); });
  }, [user?.id]);

  // ── pick photos ──
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
      const picked = result.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height }));
      setPhotos((prev) => [...prev, ...picked].slice(0, MAX_PHOTOS));
    } catch (e: any) {
      Alert.alert('Could not open your photos', e?.message || 'Please try again.');
    }
  };

  // ── save the post row ──
  const insertPost = async (fields: Record<string, any>) => {
    const { data, error } = await supabase.from('posts').insert({
      user_id: user.id,
      likes_count: 0, comments_count: 0, views_count: 0, coins_received: 0,
      created_at: new Date().toISOString(),
      is_published: true, is_public: true,
      has_watermark: false, applied_filter: 'original', video_effect: 'fx_none',
      ...fields,
    }).select('id').single();
    if (error) throw error;
    return data;
  };

  const finish = () => {
    Alert.alert('🎉 Posted!', 'Your post is live.', [{ text: 'Done', onPress: () => navigation.goBack() }]);
  };

  const postText = async () => {
    const t = text.trim();
    if (t.length < 2) { Alert.alert('Write something first', 'Type at least a few words.'); return; }
    if (!user?.id) { Alert.alert('Please log in again'); return; }
    setPosting(true);
    try {
      setProgress('Creating your card...');
      const uri = await captureRef(cardRef, { format: 'jpg', quality: 0.95, result: 'tmpfile', width: 1080, height: 1350 });
      setProgress('Uploading...');
      const up = await uploadImage(uri);
      setProgress('Posting...');
      await insertPost({
        caption: caption.trim(),
        content: plainText(t),
        text_template: tpl.id,
        media_url: up.url,
        media_type: 'image',
        cloudinary_public_id: up.publicId,
      });
      finish();
    } catch (e: any) {
      Alert.alert('Could not post', e?.message || 'Something went wrong. Please try again.');
    } finally { setPosting(false); setProgress(''); }
  };

  const postPhotos = async () => {
    if (photos.length === 0) { Alert.alert('Add photos first', 'Tap "Add photos" to choose from your gallery.'); return; }
    if (!user?.id) { Alert.alert('Please log in again'); return; }
    setPosting(true);
    try {
      const urls: string[] = [];
      let firstId: string | null = null;
      for (let i = 0; i < photos.length; i++) {
        setProgress(`Uploading photo ${i + 1} of ${photos.length}...`);
        const p = photos[i];
        // Shrink very large photos (keeps the whole picture, only reduces the size)
        let uri = p.uri;
        try {
          if ((p.width || 0) > 1600 || (p.height || 0) > 1600) {
            const landscape = (p.width || 0) >= (p.height || 0);
            const out = await ImageManipulator.manipulateAsync(
              p.uri, [{ resize: landscape ? { width: 1600 } : { height: 1600 } }],
              { compress: 0.88, format: ImageManipulator.SaveFormat.JPEG },
            );
            uri = out.uri;
          }
        } catch { /* use the original if resizing fails */ }
        const up = await uploadImage(uri);
        urls.push(up.url);
        if (i === 0) firstId = up.publicId;
      }
      setProgress('Posting...');
      await insertPost({
        caption: caption.trim(),
        media_url: urls[0],
        media_urls: urls.length > 1 ? urls : null,
        media_type: 'image',
        cloudinary_public_id: firstId,
      });
      finish();
    } catch (e: any) {
      Alert.alert('Could not post', e?.message || 'Something went wrong. Please try again.');
    } finally { setPosting(false); setProgress(''); }
  };

  // ── UI ──
  const thumbW = (SW - 32 - 16) / 3;

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} disabled={posting} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="close" size={26} color="#fff" />
        </TouchableOpacity>
        <Text style={s.title}>New post</Text>
        <TouchableOpacity style={[s.postBtn, posting && { opacity: 0.5 }]} onPress={mode === 'text' ? postText : postPhotos} disabled={posting}>
          {posting ? <ActivityIndicator color="#000" size="small" /> : <Text style={s.postBtnTxt}>Post</Text>}
        </TouchableOpacity>
      </View>

      <View style={s.tabs}>
        {(['text', 'photos'] as const).map((m) => (
          <TouchableOpacity key={m} style={[s.tab, mode === m && s.tabActive]} onPress={() => !posting && setMode(m)}>
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
              editable={!posting}
            />
            <View style={s.hintRow}>
              <Text style={s.hint}>Tip: put *stars* around a word to highlight it</Text>
              <Text style={s.hint}>{text.length}/{MAX_TEXT}</Text>
            </View>

            <View style={s.switchRow}>
              <Text style={s.switchTxt}>Show my name under the text</Text>
              <Switch value={showName} onValueChange={setShowName} trackColor={{ true: GREEN, false: '#333' }} thumbColor="#fff" />
            </View>

            <Text style={s.label}>Caption (optional)</Text>
            <TextInput style={[s.input, { minHeight: 48 }]} value={caption} onChangeText={setCaption} placeholder="Add hashtags or a short note" placeholderTextColor="#666" editable={!posting} />
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
                  {photos.map((p, i) => (
                    <View key={p.uri + i} style={{ width: thumbW, height: thumbW }}>
                      <Image source={{ uri: p.uri }} style={s.thumb} />
                      <TouchableOpacity style={s.removeBtn} disabled={posting} onPress={() => setPhotos((prev) => prev.filter((_, k) => k !== i))}>
                        <Ionicons name="close" size={14} color="#fff" />
                      </TouchableOpacity>
                      {i === 0 && <View style={s.coverTag}><Text style={s.coverTxt}>Cover</Text></View>}
                    </View>
                  ))}
                  {photos.length < MAX_PHOTOS && (
                    <TouchableOpacity style={[s.addTile, { width: thumbW, height: thumbW }]} onPress={pickPhotos} disabled={posting}>
                      <Ionicons name="add" size={30} color={GREEN} />
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={s.hint}>{photos.length} of {MAX_PHOTOS} photos. Friends can swipe through all of them.</Text>
              </>
            )}

            <Text style={s.label}>Caption (optional)</Text>
            <TextInput style={[s.input, { minHeight: 48 }]} value={caption} onChangeText={setCaption} placeholder="Say something about these photos" placeholderTextColor="#666" multiline editable={!posting} />
          </>
        )}
      </ScrollView>

      {posting && (
        <View style={s.overlay}>
          <ActivityIndicator color={GREEN} size="large" />
          <Text style={s.overlayTxt}>{progress || 'Posting...'}</Text>
        </View>
      )}
    </KeyboardAvoidingView>
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
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', gap: 14 },
  overlayTxt: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
