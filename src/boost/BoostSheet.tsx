// src/boost/BoostSheet.tsx
// "Boost post": watch 3 short rewarded ads -> your video is shown to more people for 24 hours.
// The reward is reach, never cash or coins. All rules (3 ads, 2 boosts a day, no boosting Top 10 finalists during voting,
// 500 extra viewers max) are enforced in the database; this screen only shows progress and plays the ad.
import React, { useCallback, useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { supabase } from '../config/supabase';
import { showRewardedAd } from '../components/AdSlot';

const GREEN = '#00FF88';

/** Boosted posts to mix into this person's feed: [{ boost_id, post_id }] (never their own, never ones they already saw). */
export async function fetchBoosts(limit = 2): Promise<{ boost_id: string; post_id: string }[]> {
  try { const { data } = await supabase.rpc('get_boosted_posts', { p_limit: limit }); return Array.isArray(data) ? (data as any) : []; } catch { return []; }
}
/** Count one view of a boosted post (once per person). */
export async function markBoostSeen(boostId: string): Promise<void> {
  try { await supabase.rpc('boost_mark_seen', { p_boost_id: boostId }); } catch { /* never block the feed */ }
}

const REASONS: Record<string, string> = {
  daily_limit: "You've used today's 2 boosts. Come back tomorrow!",
  too_fast: 'Please wait a few seconds, then watch the next ad.',
  finalist_voting: "This post is in this week's Top 10 voting, so it can't be boosted until voting ends.",
  not_yours: 'You can only boost your own posts.',
  login: 'Please log in to boost a post.',
};

export default function BoostSheet({ visible, postId, onClose }: { visible: boolean; postId: string; onClose: () => void }) {
  const [st, setSt] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await supabase.rpc('boost_state', { p_post_id: postId }); setSt(data); } catch { setSt(null); }
    setLoading(false);
  }, [postId]);

  useEffect(() => { if (visible) { setMsg(''); load(); } }, [visible, load]);

  const watch = async () => {
    if (busy) return;
    setBusy(true); setMsg('');
    try {
      const result = await showRewardedAd();
      if (result === 'unavailable') { setMsg('No ad is available right now. Please try again in a minute.'); }
      else if (result !== 'earned') { setMsg('Watch the whole ad so it counts toward your boost.'); }
      else {
        const { data } = await supabase.rpc('boost_register_ad', { p_post_id: postId });
        if (data && data.ok === false && data.reason !== 'already_active') setMsg(REASONS[data.reason] || 'Something went wrong. Please try again.');
        else if (data && data.boosted) setMsg('🚀 Your post is boosted for the next 24 hours!');
      }
    } catch { setMsg('Something went wrong. Please try again.'); }
    setBusy(false);
    load();
  };

  const watched = st?.ads_watched || 0, needed = st?.needed || 3;
  const active = st?.active_until ? new Date(st.active_until) : null;
  const hoursLeft = active ? Math.max(1, Math.ceil((active.getTime() - Date.now()) / 3600000)) : 0;
  const blocked = !!st?.blocked_finalist || st?.ok === false;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.sheet}>
          <Text style={s.title}>🚀 Boost this post</Text>
          <Text style={s.sub}>Watch {needed} short ads to show this video to more people for 24 hours.</Text>
          {loading && !st ? <ActivityIndicator color={GREEN} style={{ marginVertical: 24 }} /> : active ? (
            <View style={s.box}>
              <Text style={s.boxTitle}>✅ Boost is active</Text>
              <Text style={s.boxSub}>{hoursLeft} hour{hoursLeft === 1 ? '' : 's'} left · {st?.viewers || 0} of {st?.max_viewers || 500} extra people reached</Text>
            </View>
          ) : (
            <>
              <View style={s.dots}>{Array.from({ length: needed }).map((_, i) => (<View key={i} style={[s.dot, i < watched && s.dotOn]}><Text style={[s.dotText, i < watched && { color: '#000' }]}>{i < watched ? '✓' : i + 1}</Text></View>))}</View>
              {blocked && st?.blocked_finalist ? <Text style={s.note}>{REASONS.finalist_voting}</Text> : (
                <TouchableOpacity style={[s.btn, (busy || (st?.boosts_left_today ?? 1) <= 0) && { opacity: 0.55 }]} disabled={busy || (st?.boosts_left_today ?? 1) <= 0} onPress={watch} activeOpacity={0.85}>
                  {busy ? <ActivityIndicator color="#000" /> : <Text style={s.btnText}>▶ Watch ad {Math.min(watched + 1, needed)} of {needed}</Text>}
                </TouchableOpacity>
              )}
              {(st?.boosts_left_today ?? 2) <= 0 ? <Text style={s.note}>{REASONS.daily_limit}</Text> : <Text style={s.small}>{st?.boosts_left_today ?? 2} boost{(st?.boosts_left_today ?? 2) === 1 ? '' : 's'} left today</Text>}
            </>
          )}
          {msg ? <Text style={s.msg}>{msg}</Text> : null}
          <TouchableOpacity onPress={onClose} style={s.close}><Text style={s.closeText}>Close</Text></TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#111', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 30, borderWidth: 1, borderColor: '#1d1d1d' },
  title: { color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  sub: { color: '#bbb', fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginVertical: 20 },
  dot: { width: 46, height: 46, borderRadius: 23, borderWidth: 2, borderColor: '#333', alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: GREEN, borderColor: GREEN },
  dotText: { color: '#888', fontWeight: '800', fontSize: 16 },
  btn: { backgroundColor: GREEN, paddingVertical: 15, borderRadius: 16, alignItems: 'center' },
  btnText: { color: '#000', fontWeight: '800', fontSize: 16 },
  small: { color: '#777', fontSize: 12, textAlign: 'center', marginTop: 10 },
  note: { color: '#ffb84d', fontSize: 13, textAlign: 'center', marginTop: 10, lineHeight: 19 },
  msg: { color: GREEN, fontSize: 14, textAlign: 'center', marginTop: 14, fontWeight: '700' },
  box: { backgroundColor: '#052B16', borderColor: GREEN, borderWidth: 1, borderRadius: 16, padding: 16, marginVertical: 18 },
  boxTitle: { color: '#fff', fontWeight: '800', fontSize: 16, textAlign: 'center' },
  boxSub: { color: '#BFE3CF', textAlign: 'center', marginTop: 6 },
  close: { alignItems: 'center', paddingVertical: 14 },
  closeText: { color: '#888', fontWeight: '700' },
});
