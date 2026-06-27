// ═══════════════════════════════════════════════════════════════════
// LiveViewerFeatures.tsx — Interactive Viewer Overlays & Animations
// LumVibe — Complete Merged File
// ═══════════════════════════════════════════════════════════════════

import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Alert,
  Dimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withSequence,
  runOnJS,
} from 'react-native-reanimated';
import { supabase } from '../config/supabase';
import { useAuthStore } from '../store/authStore';

// ─── CONSTANTS ───────────────────────────────────────────────────

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const C = {
  g: '#00ff88', dk: '#000000', wh: '#ffffff', rd: '#ff4444', go: '#ffd700',
  pk: '#ff69b4', bl: '#448aff', cd: '#111',
};

const GIFTS = [
  { id: 'rose', emoji: '🌹', name: 'Rose', coins: 10, color: C.pk },
  { id: 'fire', emoji: '🔥', name: 'Fire', coins: 50, color: '#ff8c00' },
  { id: 'crown', emoji: '👑', name: 'Crown', coins: 100, color: C.go },
  { id: 'rocket', emoji: '🚀', name: 'Rocket', coins: 200, color: '#aa00ff' },
  { id: 'diamond', emoji: '💎', name: 'Diamond', coins: 500, color: C.bl },
  { id: 'gift_bomb', emoji: '💣', name: 'Gift Bomb', coins: 1000, color: C.rd },
];

// ─── TYPES ───────────────────────────────────────────────────────

interface LiveViewerFeaturesProps {
  sessionId: string;
  hostId: string;
  showGiftPanel: boolean;
  setShowGiftPanel: (val: boolean) => void;
  sendComment: (text: string) => void;
}

interface TopGifter {
  sender_id: string;
  username: string;
  total_coins: number;
}

// ─── COMPONENT ───────────────────────────────────────────────────

export default function LiveViewerFeatures({
  sessionId,
  hostId,
  showGiftPanel,
  setShowGiftPanel,
  sendComment,
}: LiveViewerFeaturesProps) {
  const { user } = useAuthStore();

  // ─── STATE ───────────────────────────────────────────────────────
  const [activePoll, setActivePoll] = useState<any>(null);
  const [activePrediction, setActivePrediction] = useState<any>(null);
  const [activeDare, setActiveDare] = useState<string | null>(null);
  const [topGifters, setTopGifters] = useState<TopGifter[]>([]);
  const [floatingGifts, setFloatingGifts] = useState<{ id: string; emoji: string }[]>([]);
  const [showGiftBomb, setShowGiftBomb] = useState(false);

  // ─── EFFECTS: ALL SUBSCRIPTIONS ──────────────────────────────────

  useEffect(() => {
    // 1. Poll subscription
    const pollSub = supabase.channel(`viewer_polls:${sessionId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'live_polls',
        filter: `stream_id=eq.${sessionId}`,
      }, (payload) => {
        if ((payload.new as any).is_active) setActivePoll(payload.new);
        else setActivePoll(null);
      }).subscribe();

    // 2. Prediction subscription
    const predSub = supabase.channel(`viewer_preds:${sessionId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'live_predictions',
        filter: `stream_id=eq.${sessionId}`,
      }, (payload) => {
        if (!(payload.new as any).is_resolved) setActivePrediction(payload.new);
        else setActivePrediction(null);
      }).subscribe();

    // 3. Dare detection from comments
    const dareSub = supabase.channel(`viewer_dares:${sessionId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'live_comments',
        filter: `stream_id=eq.${sessionId}`,
      }, (payload) => {
        const text = (payload.new as any).text;
        if (text.startsWith('!dare ')) {
          setActiveDare(text.replace('!dare ', ''));
          // WHY: Auto-hide dare card after 30 seconds matching host voting window
          setTimeout(() => setActiveDare(null), 30000);
        }
      }).subscribe();

    // 4. Gift subscription — drives animations and royalty recalculation
    const giftSub = supabase.channel(`viewer_gifts:${sessionId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'live_gifts',
        filter: `stream_id=eq.${sessionId}`,
      }, (payload) => {
        const gift = payload.new as any;
        if (gift.gift_type === 'Gift Bomb') triggerGiftBomb();
        else triggerFloatingGift(gift.gift_emoji || '🎁');
        recalculateTopGifters();
      }).subscribe();

    // Initial data fetch
    fetchActiveItems();
    recalculateTopGifters();

    return () => {
      supabase.removeChannel(pollSub);
      supabase.removeChannel(predSub);
      supabase.removeChannel(dareSub);
      supabase.removeChannel(giftSub);
    };
  }, [sessionId]);

  // ─── DATA FETCHERS ───────────────────────────────────────────────

  const fetchActiveItems = async () => {
    try {
      const { data: poll } = await supabase
        .from('live_polls')
        .select('*')
        .eq('stream_id', sessionId)
        .eq('is_active', true)
        .maybeSingle();
      if (poll) setActivePoll(poll);

      const { data: pred, error: predError } = await supabase
        .from('live_predictions')
        .select('*')
        .eq('stream_id', sessionId)
        .eq('is_resolved', false)
        .maybeSingle();
      if (!predError && pred) setActivePrediction(pred);
    } catch (err) {
      console.error('[fetchActiveItems Error]', err);
    }
  };

  // WHY: Client-side aggregation groups gift totals by sender to determine top 2 royalty
  const recalculateTopGifters = async () => {
    try {
      const { data, error } = await supabase
        .from('live_gifts')
        .select('sender_id, coins')
        .eq('stream_id', sessionId);

      if (error) throw error;
      if (!data || data.length === 0) { setTopGifters([]); return; }

      const totals: Record<string, number> = {};
      data.forEach((gift) => {
        totals[gift.sender_id] = (totals[gift.sender_id] || 0) + gift.coins;
      });

      const sorted = Object.entries(totals)
        .map(([sender_id, total_coins]) => ({
          sender_id,
          username: `Gifter_${sender_id.slice(0, 4)}`,
          total_coins,
        }))
        .sort((a, b) => b.total_coins - a.total_coins)
        .slice(0, 2);

      setTopGifters(sorted);
    } catch (err) {
      console.error('[Recalculate Top Gifters Error]', err);
    }
  };

  // ─── ANIMATION TRIGGERS ──────────────────────────────────────────

  const triggerFloatingGift = (emoji: string) => {
    const id = Math.random().toString(36).substring(7);
    setFloatingGifts((prev) => [...prev, { id, emoji }]);
  };

  const removeFloatingGift = (id: string) => {
    setFloatingGifts((prev) => prev.filter((g) => g.id !== id));
  };

  // WHY: Gift Bomb triggers a 2-second fullscreen takeover then auto-dismisses
  const triggerGiftBomb = () => {
    setShowGiftBomb(true);
    setTimeout(() => setShowGiftBomb(false), 2000);
  };

  // ─── HANDLERS: GIFTS ─────────────────────────────────────────────

  const handleSendGift = async (gift: typeof GIFTS[0]) => {
    if (!user?.id) return;
    try {
      // WHY: Negative amount deducts from viewer's wallet atomically
      const { error: rpcError } = await supabase.rpc('credit_host_coins', {
        host_id: user.id,
        amount: -gift.coins,
        description: `Sent ${gift.name} to live stream host`,
      });

      if (rpcError) {
        Alert.alert('Insufficient Coins', 'Top up your coin wallet to send this gift.');
        return;
      }

      const { error: insertError } = await supabase.from('live_gifts').insert({
        stream_id: sessionId,
        sender_id: user.id,
        receiver_id: hostId,
        gift_type: gift.name,
        gift_emoji: gift.emoji,
        coins: gift.coins,
      });

      if (insertError) throw insertError;

      setShowGiftPanel(false);
      if (gift.id === 'gift_bomb') triggerGiftBomb();
      else triggerFloatingGift(gift.emoji);
    } catch (err) {
      console.error('[Send Gift Error]', err);
      Alert.alert('Gift Error', 'Something went wrong sending your gift.');
    }
  };

  // ─── HANDLERS: POLL ──────────────────────────────────────────────

  const handleVotePoll = async (option: string) => {
    if (!activePoll || !user?.id) return;
    try {
      const currentVotes = { ...(activePoll.votes || {}) };
      currentVotes[option] = (currentVotes[option] || 0) + 1;

      const { error } = await supabase
        .from('live_polls')
        .update({ votes: currentVotes })
        .eq('id', activePoll.id);

      if (error) throw error;
      setActivePoll({ ...activePoll, votes: currentVotes });
    } catch (err) {
      console.error('[Poll Vote Error]', err);
    }
  };

  // ─── HANDLERS: PREDICTION ────────────────────────────────────────

  const handleBetPrediction = async (option: string) => {
    if (!activePrediction || !user?.id) return;
    const betStake = 10;
    try {
      const { error: walletError } = await supabase.rpc('credit_host_coins', {
        host_id: user.id,
        amount: -betStake,
        description: `Placed live stake on option [${option}]`,
      });

      if (walletError) {
        Alert.alert('Stake Denied', 'You need at least 10 coins to participate.');
        return;
      }

      const currentBets = Array.isArray(activePrediction.bets)
        ? [...activePrediction.bets]
        : [];
      currentBets.push({ userId: user.id, option, amount: betStake });

      const { error } = await supabase
        .from('live_predictions')
        .update({ bets: currentBets })
        .eq('id', activePrediction.id);

      if (error) throw error;
      setActivePrediction({ ...activePrediction, bets: currentBets });
      Alert.alert('Position Locked', `You staked ${betStake} coins on: ${option}`);
    } catch (err) {
      console.error('[Prediction Bet Error]', err);
    }
  };

  // ─── RENDER ──────────────────────────────────────────────────────

  return (
    <View style={styles.absoluteOverlay} pointerEvents="box-none">

      {/* Live Royalty Badges */}
      <View style={styles.royaltyContainer}>
        {topGifters.map((gifter, index) => (
          <RoyaltyBadge key={gifter.sender_id} username={gifter.username} rank={index} />
        ))}
      </View>

      {/* Floating Gift Emojis */}
      {floatingGifts.map((gift) => (
        <FloatingGift
          key={gift.id}
          emoji={gift.emoji}
          onComplete={() => removeFloatingGift(gift.id)}
        />
      ))}

      {/* Gift Bomb Fullscreen Effect */}
      {showGiftBomb && <GiftBombEffect />}

      {/* Interaction Cards Panel */}
      <View style={styles.interactionPanel} pointerEvents="box-none">

        {/* Dare Drop Voting */}
        {activeDare && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>🎭 ACTIVE DARE DROP</Text>
            <Text style={styles.cardText}>"{activeDare}"</Text>
            <View style={styles.cardActionsRow}>
              <TouchableOpacity style={styles.voteBtn} onPress={() => sendComment('👍')}>
                <Text style={styles.voteBtnText}>👍 VOTE YES</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.voteBtn, { borderColor: C.rd }]}
                onPress={() => sendComment('👎')}
              >
                <Text style={[styles.voteBtnText, { color: C.rd }]}>👎 VOTE NO</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Prediction Game */}
        {activePrediction && (
          <View style={[styles.card, { borderColor: C.bl }]}>
            <Text style={[styles.cardTitle, { color: C.bl }]}>🔮 PREDICTION STAKE GAME</Text>
            <Text style={styles.cardText}>{activePrediction.question}</Text>
            <View style={styles.cardActionsRow}>
              {activePrediction.options &&
                (Array.isArray(activePrediction.options)
                  ? activePrediction.options
                  : Object.values(activePrediction.options)
                ).map((choice: string) => (
                  <TouchableOpacity
                    key={choice}
                    style={[styles.voteBtn, { borderColor: C.bl, marginBottom: 4 }]}
                    onPress={() => handleBetPrediction(choice)}
                  >
                    <Text style={{ color: C.wh, fontSize: 10, fontWeight: '700' }}>
                      STAKE 10🪙: {choice}
                    </Text>
                  </TouchableOpacity>
                ))}
            </View>
          </View>
        )}

        {/* Audience Poll */}
        {activePoll && (
          <View style={[styles.card, { borderColor: C.g }]}>
            <Text style={[styles.cardTitle, { color: C.g }]}>📊 LIVE AUDIENCE POLL</Text>
            <Text style={styles.cardText}>{activePoll.question}</Text>
            {activePoll.options &&
              activePoll.options.map((opt: string) => {
                const count = activePoll.votes?.[opt] || 0;
                return (
                  <TouchableOpacity
                    key={opt}
                    style={styles.pollOption}
                    onPress={() => handleVotePoll(opt)}
                  >
                    <Text style={styles.pollOptionText}>{opt} — ({count} votes)</Text>
                  </TouchableOpacity>
                );
              })}
          </View>
        )}
      </View>

      {/* Gift Panel Modal */}
      <Modal visible={showGiftPanel} transparent animationType="slide">
        <View style={styles.modalBg}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setShowGiftPanel(false)} />
          <View style={styles.giftSheet}>
            <View style={styles.sheetHeaderLine} />
            <Text style={styles.giftSheetTitle}>PREMIUM EFFECT STORE</Text>
            <View style={styles.giftGrid}>
              {GIFTS.map((gift) => (
                <TouchableOpacity
                  key={gift.id}
                  style={[styles.giftCard, { borderColor: gift.color }]}
                  onPress={() => handleSendGift(gift)}
                >
                  <Text style={{ fontSize: 32 }}>{gift.emoji}</Text>
                  <Text style={styles.giftName}>{gift.name.toUpperCase()}</Text>
                  <Text style={[styles.giftPrice, { color: gift.color }]}>{gift.coins} 🪙</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>

    </View>
  );
}

// ─── SUB-COMPONENTS ──────────────────────────────────────────────

function RoyaltyBadge({ username, rank }: { username: string; rank: number }) {
  const translateY = useSharedValue(0);

  useEffect(() => {
    translateY.value = withSequence(
      withTiming(-8, { duration: 400 }),
      withSpring(0, { damping: 4, stiffness: 90 })
    );
  }, [username]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[styles.royaltyBadge, animStyle]}>
      <Text style={{ fontSize: 14 }}>{rank === 0 ? '👑' : '👸'}</Text>
      <Text style={styles.royaltyName}>{username}</Text>
    </Animated.View>
  );
}

function FloatingGift({ emoji, onComplete }: { emoji: string; onComplete: () => void }) {
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(1);
  const driftX = useRef(Math.random() * 60 - 30).current;

  useEffect(() => {
    translateY.value = withTiming(-SCREEN_HEIGHT * 0.55, { duration: 2200 });
    opacity.value = withTiming(0, { duration: 2200 }, (completed) => {
      if (completed) runOnJS(onComplete)();
    });
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { translateX: driftX }],
    opacity: opacity.value,
  }));

  return (
    <Animated.Text style={[styles.floatingGift, animStyle]}>{emoji}</Animated.Text>
  );
}

function GiftBombEffect() {
  const scale = useSharedValue(0.2);
  const opacity = useSharedValue(1);

  useEffect(() => {
    scale.value = withSpring(3.5, { damping: 8, stiffness: 80 });
    opacity.value = withTiming(0, { duration: 1800 });
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFillObject, styles.giftBombOverlay, animStyle]}>
      <Text style={{ fontSize: 90 }}>💣💥</Text>
    </Animated.View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────

const styles = StyleSheet.create({
  absoluteOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 5 },

  royaltyContainer: {
    position: 'absolute', top: 100, right: 16,
    gap: 6, alignItems: 'flex-end',
  },
  royaltyBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 10,
    paddingVertical: 5, borderRadius: 20, borderWidth: 1,
    borderColor: C.go, gap: 4,
  },
  royaltyName: { color: C.go, fontWeight: '900', fontSize: 11, letterSpacing: 0.3 },

  interactionPanel: {
    position: 'absolute', bottom: 140, right: 16,
    width: SCREEN_WIDTH * 0.58, alignItems: 'flex-end', gap: 12,
  },
  card: {
    width: '100%', backgroundColor: 'rgba(15,15,15,0.95)',
    padding: 12, borderRadius: 16, borderWidth: 1, borderColor: '#ff8800',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 4, elevation: 6,
  },
  cardTitle: { color: '#ff8800', fontWeight: '900', fontSize: 10, marginBottom: 4, letterSpacing: 0.5 },
  cardText: { color: C.wh, fontSize: 12, fontWeight: '700', marginBottom: 10 },
  cardActionsRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  voteBtn: {
    flex: 1, minWidth: '45%', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1,
    borderColor: C.g, paddingVertical: 8, borderRadius: 8,
  },
  voteBtnText: { color: C.g, fontSize: 11, fontWeight: '800' },

  pollOption: {
    backgroundColor: 'rgba(255,255,255,0.06)', paddingVertical: 8,
    paddingHorizontal: 12, borderRadius: 8, marginBottom: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  pollOptionText: { color: C.wh, fontSize: 11, fontWeight: '600' },

  modalBg: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  giftSheet: {
    backgroundColor: C.cd, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 40, borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  sheetHeaderLine: {
    width: 40, height: 4, backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2, alignSelf: 'center', marginBottom: 16,
  },
  giftSheetTitle: {
    color: C.wh, fontSize: 14, fontWeight: '900',
    letterSpacing: 1, textAlign: 'center', marginBottom: 20,
  },
  giftGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 },
  giftCard: {
    width: '31%', backgroundColor: 'rgba(0,0,0,0.4)',
    padding: 14, borderRadius: 16, alignItems: 'center', borderWidth: 1,
  },
  giftName: { color: C.wh, fontSize: 10, fontWeight: '800', marginTop: 8, letterSpacing: 0.3 },
  giftPrice: { fontSize: 11, fontWeight: '900', marginTop: 3 },

  floatingGift: {
    position: 'absolute', right: 40, bottom: 180,
    fontSize: 38, zIndex: 90,
  },
  giftBombOverlay: {
    backgroundColor: 'rgba(255,0,0,0.15)',
    justifyContent: 'center', alignItems: 'center', zIndex: 120,
  },
}); 
