// src/status/StatusViewerScreen.tsx
//
// Full-screen Status viewer (WhatsApp style).
//   • progress bars on top, tap right = next, tap left = back, HOLD = pause
//   • other people's status: reply box, quick reactions, GIFT button
//   • MY status: "N views" (tap for the list of who viewed), gifts received,
//     Friends / Public switch, delete
// Route: StatusViewer  { userId, startStoryId?, name?, avatar? }

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Dimensions, FlatList, Image, Keyboard, Modal, Platform, Pressable,
  ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { supabase } from '../config/supabase';
import { useAuthStore } from '../store/authStore';
import {
  StatusItem, StatusViewerRow, GIFT_PACKAGES, coinsToNGN, deleteStatus, fetchStatusViewers, fetchUserStatuses,
  markStatusViewed, reactToStatus, replyToStatus, sendStatusGift, setStatusVisibility, statusTimeLabel,
} from './statusApi';

const GREEN = '#00ff88';
const IMAGE_MS = 5000;           // how long a photo / text status stays
const { width: W, height: H } = Dimensions.get('window');
const QUICK = ['😍', '😂', '😮', '🙏'];

// lifts the footer above the keyboard on Android (edge-to-edge screens do not resize)
function useKeyboardLift() {
  const ref = useRef<View>(null);
  const [lift, setLift] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const s = Keyboard.addListener('keyboardDidShow', (e: any) => {
      ref.current?.measureInWindow((_x, y, _w, h) => setLift(Math.max(0, Math.round(y + h - e.endCoordinates.screenY))));
    });
    const h = Keyboard.addListener('keyboardDidHide', () => setLift(0));
    return () => { s.remove(); h.remove(); };
  }, []);
  return { ref, lift };
}

function Avatar({ uri, name, size = 38 }: { uri?: string | null; name?: string; size?: number }) {
  return uri
    ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#222' }} />
    : <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#0b1f14', borderWidth: 1.5, borderColor: GREEN, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: GREEN, fontWeight: '800', fontSize: size * 0.42 }}>{String(name || 'U').charAt(0).toUpperCase()}</Text>
      </View>;
}

export default function StatusViewerScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { user, userProfile, loadProfile } = useAuthStore();
  const { userId, startStoryId, name: nameParam, avatar: avatarParam } = (route.params || {}) as any;
  const isOwner = !!user?.id && userId === user.id;

  const [items, setItems]     = useState<StatusItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [index, setIndex]     = useState(0);
  const [prog, setProg]       = useState(0);
  const [hold, setHold]       = useState(false);
  const [sheet, setSheet]     = useState(false);       // any sheet / keyboard open → pause
  const [person, setPerson]   = useState({ name: nameParam || '', avatar: avatarParam || '' });
  const [toast, setToast]     = useState('');
  const [reply, setReply]     = useState('');
  const [sending, setSending] = useState(false);

  const [viewersOpen, setViewersOpen] = useState(false);
  const [viewers, setViewers]         = useState<StatusViewerRow[]>([]);
  const [giftOpen, setGiftOpen]       = useState(false);
  const [custom, setCustom]           = useState(false);
  const [customAmt, setCustomAmt]     = useState('');
  const [giftBusy, setGiftBusy]       = useState(false);
  const { ref: footRef, lift } = useKeyboardLift();

  const paused = hold || sheet;
  const cur = items[index];
  const myCoins = Number((userProfile as any)?.coins) || 0;

  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(''), 1800); };

  // ── load the statuses ──
  useEffect(() => {
    let dead = false;
    (async () => {
      const list = await fetchUserStatuses(userId);
      if (dead) return;
      setItems(list);
      const start = startStoryId ? list.findIndex(s => s.id === startStoryId)
                  : isOwner ? 0 : list.findIndex(s => !s.viewed);
      setIndex(Math.max(0, start));
      setLoading(false);
      if (!list.length) setTimeout(() => navigation.goBack(), 600);
    })();
    return () => { dead = true; };
  }, [userId]);

  useEffect(() => {          // name + picture when we were opened without them
    if (person.name && person.avatar) return;
    supabase.from('users').select('username, display_name, avatar_url, photo_url').eq('id', userId).maybeSingle()
      .then(({ data }: any) => {
        if (!data) return;
        setPerson(p => ({ name: p.name || data.display_name || data.username || '', avatar: p.avatar || data.avatar_url || data.photo_url || '' }));
      });
  }, [userId]);

  // ── video ──
  const isVideo = cur?.media_type === 'video';
  const player = useVideoPlayer(isVideo ? cur!.media_url : null, p => { p.loop = false; p.play(); });
  useEffect(() => {
    try { if (isVideo) { if (paused) player.pause(); else player.play(); } } catch {}
  }, [paused, isVideo, player]);

  // ── progress bar clock ──
  useEffect(() => { setProg(0); }, [index]);
  useEffect(() => {
    if (!cur || paused) return;
    const t = setInterval(() => {
      if (isVideo) {
        try {
          const d = player.duration; const c = player.currentTime;
          if (d > 0) setProg(Math.min(1, c / d));
        } catch {}
      } else {
        setProg(p => Math.min(1, p + 50 / IMAGE_MS));
      }
    }, 50);
    return () => clearInterval(t);
  }, [cur?.id, paused, isVideo, player]);

  const goNext = useCallback(() => {
    if (index < items.length - 1) setIndex(i => i + 1);
    else navigation.goBack();
  }, [index, items.length, navigation]);
  const goPrev = useCallback(() => { if (index > 0) setIndex(i => i - 1); else setProg(0); }, [index]);
  useEffect(() => { if (prog >= 1) goNext(); }, [prog]);

  // ── count the view (once per person, never the owner) ──
  useEffect(() => {
    if (!cur || isOwner) return;
    markStatusViewed(cur.id);
  }, [cur?.id, isOwner]);

  // ── actions ──
  const doReact = async (emoji: string) => {
    if (!cur) return;
    setItems(l => l.map(s => s.id === cur.id ? { ...s, my_reaction: emoji } : s));
    const r = await reactToStatus(cur.id, emoji);
    flash(r.success ? `Reacted ${emoji}` : (r.error || 'Could not react'));
  };

  const doReply = async () => {
    if (!cur || !reply.trim() || sending) return;
    setSending(true);
    const r = await replyToStatus(cur.id, reply.trim());
    setSending(false);
    if (r.success) { setReply(''); Keyboard.dismiss(); setSheet(false); flash('Reply sent'); }
    else Alert.alert('Reply not sent', r.error || 'Please try again.');
  };

  const sendGift = async (amount: number, label: string, icon: string) => {
    if (!cur || giftBusy) return;
    if (amount > myCoins) {
      Alert.alert('Insufficient coins', `You need ${amount} coins but only have ${myCoins.toFixed(0)}.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Top up wallet', onPress: () => { setGiftOpen(false); setSheet(false); setTimeout(() => navigation.navigate('BuyCoins'), 300); } },
      ]);
      return;
    }
    setGiftBusy(true);
    const r = await sendStatusGift(cur.id, amount, label, icon);
    setGiftBusy(false);
    if (!r.success) { Alert.alert('Could not send gift', r.error || 'Please try again.'); return; }
    setGiftOpen(false); setCustom(false); setCustomAmt(''); setSheet(false);
    flash(`${icon} Gift sent`);
    try { await loadProfile?.(); } catch {}
  };

  const customGift = () => {
    const a = parseFloat(customAmt);
    if (isNaN(a) || a < 10) return Alert.alert('Invalid Amount', 'Minimum 10 coins');
    if (!Number.isInteger(a)) return Alert.alert('Invalid Amount', 'Please enter a whole number of coins');
    if (a > 5000) return Alert.alert('Invalid Amount', 'Maximum 5,000 coins');
    sendGift(a, 'custom gift', '🎁');
  };

  const openViewers = async () => {
    if (!cur) return;
    setSheet(true); setViewersOpen(true);
    setViewers(await fetchStatusViewers(cur.id));
  };

  const closeSheets = () => { setViewersOpen(false); setGiftOpen(false); setCustom(false); setSheet(false); };

  const askDelete = () => {
    if (!cur) return;
    setSheet(true);
    Alert.alert('Delete this status?', 'It will disappear for everyone.', [
      { text: 'Cancel', style: 'cancel', onPress: () => setSheet(false) },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        const ok = await deleteStatus(cur.id);
        setSheet(false);
        if (!ok) { Alert.alert('Could not delete', 'Please try again.'); return; }
        const rest = items.filter(s => s.id !== cur.id);
        if (!rest.length) navigation.goBack();
        else { setItems(rest); setIndex(i => Math.min(i, rest.length - 1)); }
      } },
    ], { onDismiss: () => setSheet(false) });
  };

  const toggleVisibility = () => {
    if (!cur) return;
    const next = cur.visibility === 'public' ? 'friends' : 'public';
    setSheet(true);
    Alert.alert(
      next === 'friends' ? 'Make this status private?' : 'Make this status public?',
      next === 'friends' ? 'Only your friends will be able to see it.' : 'Your friends, your followers and people who open your profile will be able to see it.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => setSheet(false) },
        { text: next === 'friends' ? 'Friends only' : 'Make public', onPress: async () => {
          const ok = await setStatusVisibility(cur.id, next);
          setSheet(false);
          if (ok) setItems(l => l.map(s => s.id === cur.id ? { ...s, visibility: next } : s));
          else Alert.alert('Could not change', 'Please try again.');
        } },
      ],
      { onDismiss: () => setSheet(false) });
  };

  const menu = () => {
    setSheet(true);
    Alert.alert('Status', undefined, [
      { text: 'My status list', onPress: () => { setSheet(false); navigation.replace('MyStatus'); } },
      { text: 'Delete this status', style: 'destructive', onPress: () => { setSheet(false); askDelete(); } },
      { text: 'Cancel', style: 'cancel', onPress: () => setSheet(false) },
    ], { onDismiss: () => setSheet(false) });
  };

  // ── screens ──
  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={GREEN} size="large" /></View>;
  }
  if (!cur) {
    return (
      <View style={styles.center}>
        <Text style={{ color: '#aaa', fontSize: 15 }}>No status to show</Text>
      </View>
    );
  }

  const displayName = isOwner ? 'My status' : (person.name || 'Status');

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* the status itself */}
      <View style={StyleSheet.absoluteFill}>
        {cur.media_type === 'text' ? (
          <View style={[styles.textBg, { backgroundColor: cur.bg_color || '#128c7e' }]}>
            <Text style={styles.textBig}>{cur.text_content}</Text>
          </View>
        ) : cur.media_type === 'video' ? (
          <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} surfaceType="textureView" />
        ) : (
          <Image source={{ uri: cur.media_url }} style={StyleSheet.absoluteFill} resizeMode="contain" />
        )}
      </View>

      {/* tap zones: left = back, right = next, hold = pause */}
      <View style={[StyleSheet.absoluteFill, { flexDirection: 'row' }]}>
        <Pressable style={{ flex: 3 }} onPress={goPrev} onLongPress={() => setHold(true)} onPressOut={() => setHold(false)} delayLongPress={180} />
        <Pressable style={{ flex: 7 }} onPress={goNext} onLongPress={() => setHold(true)} onPressOut={() => setHold(false)} delayLongPress={180} />
      </View>

      {/* top: progress + who */}
      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.bars}>
          {items.map((s, i) => (
            <View key={s.id} style={styles.barBg}>
              <View style={[styles.barFill, { width: `${(i < index ? 1 : i === index ? prog : 0) * 100}%` }]} />
            </View>
          ))}
        </View>
        <View style={styles.head}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="arrow-back" size={26} color="#fff" />
          </TouchableOpacity>
          <Avatar uri={person.avatar} name={person.name} />
          <View style={{ flex: 1 }}>
            <Text style={styles.hName} numberOfLines={1}>{displayName}</Text>
            <Text style={styles.hTime}>
              {statusTimeLabel(cur.created_at)}
              {isOwner ? (cur.visibility === 'public' ? '  ·  🌍 Public' : '  ·  🔒 Friends') : ''}
            </Text>
          </View>
          {isOwner && (
            <TouchableOpacity onPress={menu} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="ellipsis-vertical" size={22} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {!!toast && <View style={styles.toast} pointerEvents="none"><Text style={styles.toastText}>{toast}</Text></View>}

      {/* bottom */}
      <View ref={footRef} collapsable={false} style={[styles.bottom, { paddingBottom: insets.bottom + 10, marginBottom: lift }]} pointerEvents="box-none">
        {!!cur.caption && cur.media_type !== 'text' && (
          <View style={styles.capBox} pointerEvents="none"><Text style={styles.cap}>{cur.caption}</Text></View>
        )}

        {isOwner ? (
          <View style={styles.ownerRow}>
            <TouchableOpacity style={styles.pill} onPress={openViewers} activeOpacity={0.85}>
              <Ionicons name="eye-outline" size={22} color="#fff" />
              <Text style={styles.pillText}>{cur.view_count} {cur.view_count === 1 ? 'view' : 'views'}</Text>
            </TouchableOpacity>
            {cur.gift_total > 0 && (
              <TouchableOpacity style={styles.pill} onPress={openViewers} activeOpacity={0.85}>
                <Text style={{ fontSize: 17 }}>🎁</Text>
                <Text style={styles.pillText}>{cur.gift_total} coins</Text>
              </TouchableOpacity>
            )}
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={styles.pill} onPress={toggleVisibility} activeOpacity={0.85}>
              <Ionicons name={cur.visibility === 'public' ? 'earth' : 'lock-closed'} size={18} color={GREEN} />
              <Text style={styles.pillText}>{cur.visibility === 'public' ? 'Public' : 'Friends'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.replyRow}>
            <View style={styles.replyBox}>
              <TextInput
                style={styles.replyInput} value={reply} onChangeText={setReply}
                placeholder="Reply…" placeholderTextColor="#9a9a9a" returnKeyType="send"
                onFocus={() => setSheet(true)} onBlur={() => { if (!viewersOpen && !giftOpen) setSheet(false); }}
                onSubmitEditing={doReply}
              />
              {reply.trim() ? (
                <TouchableOpacity onPress={doReply} disabled={sending} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  {sending ? <ActivityIndicator size="small" color={GREEN} /> : <Ionicons name="send" size={20} color={GREEN} />}
                </TouchableOpacity>
              ) : (
                QUICK.slice(0, 3).map(e => (
                  <TouchableOpacity key={e} onPress={() => doReact(e)} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
                    <Text style={[styles.emoji, cur.my_reaction === e && { opacity: 1 }]}>{e}</Text>
                  </TouchableOpacity>
                ))
              )}
            </View>
            <TouchableOpacity style={styles.round} onPress={() => { setSheet(true); setGiftOpen(true); }} activeOpacity={0.85}>
              <Ionicons name="gift" size={22} color="#ffd700" />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* who viewed (owner) */}
      <Modal visible={viewersOpen} transparent animationType="slide" onRequestClose={closeSheets}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={closeSheets} />
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Viewed by {viewers.length}</Text>
            <TouchableOpacity onPress={closeSheets}><Ionicons name="close" size={24} color="#fff" /></TouchableOpacity>
          </View>
          <FlatList
            data={viewers} keyExtractor={v => v.viewer_id}
            ListEmptyComponent={<Text style={styles.empty}>No views yet</Text>}
            renderItem={({ item }) => (
              <View style={styles.vRow}>
                <Avatar uri={item.avatar_url} name={item.username} size={44} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.vName} numberOfLines={1}>{item.display_name || item.username}</Text>
                  <Text style={styles.vTime}>{statusTimeLabel(item.viewed_at)}</Text>
                </View>
                {item.gift_amount > 0 && <Text style={styles.vGift}>🎁 {item.gift_amount}</Text>}
                {!!item.emoji && <Text style={{ fontSize: 22 }}>{item.emoji}</Text>}
              </View>
            )}
          />
        </View>
      </Modal>

      {/* gift sheet (same gifts and prices as chat and the feed) */}
      <Modal visible={giftOpen} transparent animationType="slide" onRequestClose={closeSheets}>
        <View style={styles.backdrop}>
          <View style={styles.giftModal}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle} numberOfLines={1}>Send gift to {person.name || 'them'}</Text>
              <TouchableOpacity onPress={closeSheets}><Ionicons name="close" size={24} color="#fff" /></TouchableOpacity>
            </View>
            <View style={styles.balance}>
              <Ionicons name="diamond" size={18} color="#ffd700" />
              <Text style={styles.balanceText}>{myCoins.toFixed(0)} coins ({coinsToNGN(myCoins)})</Text>
            </View>
            {!custom ? (
              <>
                <ScrollView style={{ padding: 16 }}>
                  {GIFT_PACKAGES.map(g => (
                    <TouchableOpacity key={g.id} disabled={giftBusy} activeOpacity={0.7}
                      style={[styles.gift, { borderColor: g.color }, giftBusy && { opacity: 0.5 }]}
                      onPress={() => sendGift(g.coins, g.name, g.icon)}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                        <Text style={{ fontSize: 38 }}>{g.icon}</Text>
                        <View style={{ gap: 4 }}>
                          <Text style={styles.giftName}>{g.name}</Text>
                          <Text style={styles.giftAmt}>{g.coins} coins</Text>
                        </View>
                      </View>
                      <Ionicons name="chevron-forward" size={24} color={g.color} />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <TouchableOpacity style={styles.customBtn} onPress={() => setCustom(true)}>
                  <Ionicons name="create-outline" size={20} color={GREEN} />
                  <Text style={styles.customBtnText}>Custom amount</Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={{ padding: 20 }}>
                <Text style={styles.customLabel}>Enter amount (coins)</Text>
                <TextInput style={styles.customInput} value={customAmt} onChangeText={setCustomAmt}
                  placeholder="10" placeholderTextColor="#555" keyboardType="number-pad" autoFocus />
                {!!customAmt && !isNaN(parseFloat(customAmt)) && <Text style={styles.customPreview}>{coinsToNGN(parseFloat(customAmt))}</Text>}
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 24 }}>
                  <TouchableOpacity style={[styles.customAct, { backgroundColor: '#222' }]} onPress={() => { setCustom(false); setCustomAmt(''); }}>
                    <Text style={{ color: '#fff', fontWeight: '700' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity disabled={giftBusy} style={[styles.customAct, { backgroundColor: GREEN }, giftBusy && { opacity: 0.5 }]} onPress={customGift}>
                    {giftBusy ? <ActivityIndicator color="#000" /> : <Text style={{ color: '#000', fontWeight: '800' }}>Send gift</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  textBg: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  textBig: { color: '#fff', fontSize: 32, fontWeight: '700', textAlign: 'center', lineHeight: 42 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.22)', paddingBottom: 10 },
  bars: { flexDirection: 'row', gap: 4, paddingHorizontal: 8 },
  barBg: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.32)', overflow: 'hidden' },
  barFill: { height: 3, backgroundColor: '#fff' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 12 },
  hName: { color: '#fff', fontSize: 16, fontWeight: '700' },
  hTime: { color: 'rgba(255,255,255,0.8)', fontSize: 12.5, marginTop: 1 },
  toast: { position: 'absolute', alignSelf: 'center', top: H * 0.42, backgroundColor: 'rgba(0,0,0,0.75)', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20 },
  toastText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingTop: 30, backgroundColor: 'rgba(0,0,0,0.0)' },
  capBox: { backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9, marginBottom: 10, alignSelf: 'center', maxWidth: W - 40 },
  cap: { color: '#fff', fontSize: 16, textAlign: 'center' },
  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(28,30,32,0.92)', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 26 },
  pillText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  replyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  replyBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: 'rgba(28,30,32,0.92)', borderRadius: 28, paddingLeft: 18, paddingRight: 16, height: 52 },
  replyInput: { flex: 1, color: '#fff', fontSize: 16, paddingVertical: 0 },
  emoji: { fontSize: 25, opacity: 0.9 },
  round: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(28,30,32,0.92)', alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '65%', backgroundColor: '#0f1214', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingBottom: 26 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, borderBottomWidth: 1, borderBottomColor: '#1d2327' },
  sheetTitle: { color: '#fff', fontSize: 18, fontWeight: '700', flex: 1 },
  empty: { color: '#777', textAlign: 'center', padding: 30 },
  vRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 10 },
  vName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  vTime: { color: '#8a8f93', fontSize: 12.5, marginTop: 1 },
  vGift: { color: '#ffd700', fontSize: 13, fontWeight: '800' },
  giftModal: { backgroundColor: '#0a0a0a', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 30, maxHeight: '85%' },
  balance: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 12 },
  balanceText: { color: '#ffd700', fontSize: 14, fontWeight: '700' },
  gift: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: '#1a1a1a', borderWidth: 1.5, borderRadius: 16, marginBottom: 12 },
  giftName: { color: '#fff', fontSize: 18, fontWeight: '600' },
  giftAmt: { color: GREEN, fontSize: 14, fontWeight: '500' },
  customBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, marginHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: GREEN },
  customBtnText: { color: GREEN, fontSize: 16, fontWeight: '600' },
  customLabel: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 12 },
  customInput: { backgroundColor: '#1a1a1a', color: '#fff', fontSize: 24, fontWeight: '600', padding: 16, borderRadius: 12, borderWidth: 2, borderColor: GREEN },
  customPreview: { color: '#ffd700', fontSize: 16, fontWeight: '700', textAlign: 'center', marginTop: 8 },
  customAct: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 16, borderRadius: 12 },
});
