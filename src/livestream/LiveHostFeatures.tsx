// ═══════════════════════════════════════════════════════════════════
// LiveHostFeatures.tsx — Interaction Engine & Overlay Engine
// LumVibe — Complete Merged File (Part B Full)
// ═══════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  Alert,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolateColor,
  runOnJS,
} from 'react-native-reanimated';
import { Room } from '@livekit/react-native';
import { supabase } from '../config/supabase';
import { useAuthStore } from '../store/authStore';
import { Feather } from '@expo/vector-icons';

// ─── TYPES & INTERFACES ───────────────────────────────────────────

interface LiveHostFeaturesProps {
  sessionId: string;
  room: string;
  vibeScore: number;
}

interface PollState {
  id: string;
  question: string;
  options: string[];
  votes: Record<string, number>;
  isActive: boolean;
}

interface DareItem {
  id: string;
  text: string;
  pro_votes: number;
  con_votes: number;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const C = {
  g: '#00ff88', dk: '#000000', wh: '#ffffff', rd: '#ff4444',
  go: '#ffd700', bl: '#0077ff', cd: 'rgba(15,15,15,0.85)',
};

// ─── COMPONENT ───────────────────────────────────────────────────

export default function LiveHostFeatures({ sessionId, vibeScore }: LiveHostFeaturesProps) {
  const { user } = useAuthStore();

  // ─── FEATURE 1: ENERGY METER ─────────────────────────────────────

  const energyProgress = useSharedValue(0);
  const maxEnergyThreshold = 1000;

  const creditEnergyReward = async () => {
    if (!user?.id) return;
    try {
      await supabase.rpc('credit_host_coins', {
        host_id: user.id,
        amount: 50,
        description: 'Energy Meter Milestone 100% Payout Bonus',
      });
      Alert.alert('💥 Energy Overload!', 'Milestone met! 50 bonus coins credited directly.');
    } catch (err) {
      console.error('[Energy Reward Error]', err);
    }
  };

  const handleProgressTransition = (score: number) => {
    'worklet';
    const computedPercentage = Math.min(score / maxEnergyThreshold, 1);
    energyProgress.value = withTiming(computedPercentage, { duration: 400 }, (isFinished) => {
      if (isFinished && energyProgress.value >= 1) {
        energyProgress.value = 0;
        runOnJS(creditEnergyReward)();
      }
    });
  };

  useEffect(() => {
    handleProgressTransition(vibeScore);
  }, [vibeScore]);

  const animatedEnergyStyle = useAnimatedStyle(() => ({
    width: `${energyProgress.value * 100}%`,
  }));

  // ─── FEATURE 2: LIVE BATTLE ARENA ────────────────────────────────

  const [battleStatus, setBattleStatus] = useState<'idle' | 'searching' | 'active'>('idle');
  const [battleTimer, setBattleTimer] = useState(60);
  const battleIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const startBattleArena = () => {
    setBattleStatus('searching');
    setTimeout(() => {
      setBattleStatus('active');
      setBattleTimer(60);
      battleIntervalRef.current = setInterval(() => {
        setBattleTimer((prev) => {
          if (prev <= 1) {
            if (battleIntervalRef.current) clearInterval(battleIntervalRef.current);
            setBattleStatus('idle');
            Alert.alert('Battle Over!', 'Calculating reward matrix (60% Winner / 10% Loser split).');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }, 3000);
  };

  useEffect(() => {
    return () => {
      if (battleIntervalRef.current) clearInterval(battleIntervalRef.current);
    };
  }, []);

  // ─── FEATURE 3: AUDIENCE POLL ─────────────────────────────────────

  const [activePoll, setActivePoll] = useState<PollState | null>(null);

  const createHostPoll = async () => {
    try {
      const optionsArray = ['Fire Jam', 'Keep Going', 'Change Beat'];
      const initialVotes: Record<string, number> = { 'Fire Jam': 0, 'Keep Going': 0, 'Change Beat': 0 };

      const { data, error } = await supabase
        .from('live_polls')
        .insert({
          stream_id: sessionId,
          question: 'Rate the current performance structure?',
          options: optionsArray,
          votes: initialVotes,
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;
      setActivePoll({
        id: data.id,
        question: data.question,
        options: optionsArray,
        votes: initialVotes,
        isActive: true,
      });
    } catch (err) {
      console.error('[Create Poll Failure]', err);
    }
  };

  useEffect(() => {
    const pollChannel = supabase.channel(`polls:${sessionId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'live_polls',
        filter: `stream_id=eq.${sessionId}`,
      }, (payload) => {
        const updated = payload.new as any;
        if (!updated.is_active) {
          setActivePoll(null);
        } else {
          setActivePoll({
            id: updated.id,
            question: updated.question,
            options: Array.isArray(updated.options) ? updated.options : [],
            votes: updated.votes || {},
            isActive: updated.is_active,
          });
        }
      }).subscribe();

    return () => { supabase.removeChannel(pollChannel); };
  }, [sessionId]);

  const closeHostPoll = async () => {
    if (!activePoll) return;
    try {
      await supabase.from('live_polls').update({ is_active: false }).eq('id', activePoll.id);
      setActivePoll(null);
    } catch (err) {
      console.error('[Close Poll Error]', err);
    }
  };

  // ─── FEATURE 4: DARE DROP ─────────────────────────────────────────

  const [currentDare, setCurrentDare] = useState<DareItem | null>(null);
  const [dareTimer, setDareTimer] = useState(30);
  const dareIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const dareSenderIdRef = useRef<string | null>(null);

  const executeDareRefund = async (targetUserId: string) => {
    try {
      const { error } = await supabase.rpc('credit_host_coins', {
        host_id: targetUserId,
        amount: 50,
        description: 'Automated Dare Drop Community Rejection Refund Payout',
      });
      if (error) throw error;
      Alert.alert('Dare Rejected', 'Community voted down the challenge. 50 coins safely refunded to the sender.');
    } catch (err) {
      console.error('[Dare Refund RPC Error]', err);
    }
  };

  useEffect(() => {
    const dareChannel = supabase.channel(`dares:${sessionId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'live_comments',
        filter: `stream_id=eq.${sessionId}`,
      }, (payload) => {
        const commentText = (payload.new as any).text;
        if (commentText.startsWith('!dare ')) {
          const senderId = (payload.new as any).user_id;
          dareSenderIdRef.current = senderId;
          setCurrentDare({
            id: (payload.new as any).id,
            text: commentText.replace('!dare ', ''),
            pro_votes: 0,
            con_votes: 0,
          });
        }
      }).subscribe();

    // WHY: Separate channel for thumbs up/down votes on the active dare
    const dareVoteSub = supabase.channel(`dare_votes:${sessionId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'live_comments',
        filter: `stream_id=eq.${sessionId}`,
      }, (payload) => {
        const text = (payload.new as any).text;
        if (!currentDare) return;
        if (text === '👍') {
          setCurrentDare(prev => prev ? { ...prev, pro_votes: prev.pro_votes + 1 } : null);
        } else if (text === '👎') {
          setCurrentDare(prev => prev ? { ...prev, con_votes: prev.con_votes + 1 } : null);
        }
      }).subscribe();

    return () => {
      supabase.removeChannel(dareChannel);
      supabase.removeChannel(dareVoteSub);
    };
  }, [sessionId, currentDare]);

  // WHY: 30-second automated community voting window for each dare
  useEffect(() => {
    if (currentDare) {
      setDareTimer(30);
      dareIntervalRef.current = setInterval(() => {
        setDareTimer((prev) => {
          if (prev <= 1) {
            if (dareIntervalRef.current) clearInterval(dareIntervalRef.current);
            const totalVotes = currentDare.pro_votes + currentDare.con_votes;
            const isApproved = totalVotes > 0 && currentDare.pro_votes > currentDare.con_votes;
            if (!isApproved && dareSenderIdRef.current) {
              runOnJS(executeDareRefund)(dareSenderIdRef.current);
            } else if (isApproved) {
              Alert.alert('Dare Approved!', 'The community voted YES. Challenge added to your queue!');
            }
            setCurrentDare(null);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (dareIntervalRef.current) clearInterval(dareIntervalRef.current);
    };
  }, [currentDare]);

  // ─── FEATURE 5: VIBE TEMPERATURE ─────────────────────────────────

  const temperatureValue = useSharedValue(0);

  // WHY: Updates normalized temperature range on animation thread every time vibeScore changes
  useEffect(() => {
    const factor = Math.min(vibeScore / 1000, 1);
    temperatureValue.value = withTiming(factor, { duration: 500 });
  }, [vibeScore]);

  // WHY: Interpolation runs strictly on UI thread — no JS thread frame drops
  const animatedTemperatureBadgeStyle = useAnimatedStyle(() => {
    const bgColor = interpolateColor(
      temperatureValue.value,
      [0, 0.5, 1],
      ['#0044ff', '#ffaa00', '#ff0000'] // Blue (cold) → Orange → Red (hot)
    );
    return { backgroundColor: bgColor };
  });

  // ─── RENDER ──────────────────────────────────────────────────────

  const totalPollVotes = activePoll
    ? Object.values(activePoll.votes).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <View style={styles.absoluteContainer} pointerEvents="box-none">

      {/* Vibe Temperature Fire Badge */}
      <Animated.View style={[styles.vibeBadge, animatedTemperatureBadgeStyle]}>
        <Text style={styles.vibeText}>🔥 {Math.round(vibeScore / 10)}°C</Text>
      </Animated.View>

      {/* Energy Meter Progress Bar */}
      <View style={styles.energyTrack}>
        <Animated.View style={[styles.energyFill, animatedEnergyStyle]} />
      </View>

      {/* Battle Arena — Searching State */}
      {battleStatus === 'searching' && (
        <View style={styles.searchingOverlay}>
          <ActivityIndicator size="large" color={C.g} />
          <Text style={styles.searchingText}>MATCHING WITH COMPETING LIVE CREATOR...</Text>
        </View>
      )}

      {/* Battle Arena — Active Split Screen */}
      {battleStatus === 'active' && (
        <View style={styles.battleFrame}>
          <View style={styles.battleTimerBadge}>
            <Text style={styles.battleTimerText}>BATTLE ROUND: {battleTimer}s</Text>
          </View>
          <View style={styles.splitGrid}>
            <View style={[styles.viewportSide, { borderColor: C.g }]}>
              <Text style={styles.viewportText}>YOU</Text>
            </View>
            <View style={[styles.viewportSide, { borderColor: C.rd }]}>
              <Text style={styles.viewportText}>OPPONENT</Text>
            </View>
          </View>
        </View>
      )}

      {/* Control Panel — Right Side Buttons */}
      <View style={styles.controlPanel} pointerEvents="box-none">

        {/* Battle Button */}
        {battleStatus === 'idle' && (
          <TouchableOpacity style={styles.actionBtn} onPress={startBattleArena}>
            <Feather name="zap" size={16} color={C.dk} />
            <Text style={styles.btnText}>LAUNCH BATTLE</Text>
          </TouchableOpacity>
        )}

        {/* Poll — Create or Show Active */}
        {!activePoll ? (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: C.bl }]}
            onPress={createHostPoll}
          >
            <Feather name="bar-chart-2" size={16} color={C.wh} />
            <Text style={[styles.btnText, { color: C.wh }]}>TRIGGER POLL</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.pollContainer}>
            <Text style={styles.pollQuestion}>{activePoll.question}</Text>
            {activePoll.options.map((option) => {
              const optionVotes = activePoll.votes[option] || 0;
              const ratio = totalPollVotes > 0 ? optionVotes / totalPollVotes : 0;
              return (
                <View key={option} style={styles.pollRow}>
                  <View style={[styles.pollBar, { width: `${ratio * 100}%` }]} />
                  <Text style={styles.pollLabel}>{option} ({optionVotes})</Text>
                </View>
              );
            })}
            <TouchableOpacity style={styles.closePollBtn} onPress={closeHostPoll}>
              <Text style={styles.closePollText}>CLOSE VOTING</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Dare Drop Card */}
        {currentDare && (
          <View style={styles.dareCard}>
            <View style={styles.dareHeaderRow}>
              <Feather name="activity" size={14} color={C.go} />
              <Text style={styles.dareTitle}>COMMUNITY DARE DROP ({dareTimer}s)</Text>
            </View>
            <Text style={styles.dareContent}>"{currentDare.text}"</Text>
            <View style={styles.dareVoteTallyRow}>
              <Text style={styles.tallyText}>👍 {currentDare.pro_votes}</Text>
              <Text style={styles.tallyText}>👎 {currentDare.con_votes}</Text>
            </View>
            <View style={styles.actionGroup}>
              <TouchableOpacity
                style={styles.dareAccept}
                onPress={() => {
                  if (dareIntervalRef.current) clearInterval(dareIntervalRef.current);
                  Alert.alert('Dare Accepted!', 'Complete the live challenge to earn coins!');
                  setCurrentDare(null);
                }}
              >
                <Text style={styles.dareBtnText}>ACCEPT</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.dareReject}
                onPress={async () => {
                  if (dareIntervalRef.current) clearInterval(dareIntervalRef.current);
                  if (dareSenderIdRef.current) {
                    await executeDareRefund(dareSenderIdRef.current);
                  }
                  setCurrentDare(null);
                }}
              >
                <Text style={styles.dareBtnText}>REJECT</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

      </View>
    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────

const styles = StyleSheet.create({
  absoluteContainer: { ...StyleSheet.absoluteFillObject, zIndex: 6 },

  vibeBadge: {
    position: 'absolute', top: 110, right: 16,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, zIndex: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4, shadowRadius: 3, elevation: 5,
  },
  vibeText: { color: C.wh, fontWeight: '900', fontSize: 12 },

  energyTrack: {
    position: 'absolute', top: 96, left: 16, right: 16,
    height: 6, backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 3, overflow: 'hidden', zIndex: 12,
  },
  energyFill: { height: '100%', backgroundColor: C.g },

  searchingOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center', alignItems: 'center', zIndex: 30,
  },
  searchingText: { color: C.g, fontWeight: '800', marginTop: 16, fontSize: 12, letterSpacing: 1 },

  battleFrame: {
    position: 'absolute', top: 150, left: 0, right: 0,
    height: SCREEN_HEIGHT * 0.4, zIndex: 25,
  },
  battleTimerBadge: {
    position: 'absolute', top: -30, alignSelf: 'center',
    backgroundColor: C.rd, paddingHorizontal: 12, paddingVertical: 4,
    borderRadius: 10, zIndex: 26,
  },
  battleTimerText: { color: C.wh, fontWeight: '900', fontSize: 11 },
  splitGrid: { flex: 1, flexDirection: 'row' },
  viewportSide: {
    flex: 1, borderWidth: 2, justifyContent: 'center',
    alignItems: 'center', backgroundColor: 'rgba(20,20,20,0.2)',
  },
  viewportText: { color: C.wh, fontSize: 16, fontWeight: '900', opacity: 0.5 },

  controlPanel: {
    position: 'absolute', bottom: 340, right: 16,
    width: SCREEN_WIDTH * 0.55, alignItems: 'flex-end', gap: 10,
  },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.g,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, gap: 6, elevation: 4,
  },
  btnText: { color: C.dk, fontWeight: '900', fontSize: 12, letterSpacing: 0.5 },

  pollContainer: {
    width: '100%', backgroundColor: C.cd, padding: 12,
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  pollQuestion: { color: C.wh, fontWeight: '800', fontSize: 12, marginBottom: 8 },
  pollRow: {
    height: 26, justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 6,
    marginBottom: 6, overflow: 'hidden',
  },
  pollBar: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,255,136,0.25)' },
  pollLabel: { color: C.wh, fontSize: 11, paddingLeft: 8, fontWeight: '600' },
  closePollBtn: { marginTop: 4, alignSelf: 'center' },
  closePollText: { color: C.rd, fontWeight: '800', fontSize: 11 },

  dareCard: {
    width: '100%', backgroundColor: 'rgba(40,20,0,0.9)', padding: 12,
    borderRadius: 14, borderWidth: 1, borderColor: '#ff8800',
  },
  dareHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  dareTitle: { color: '#ff8800', fontWeight: '900', fontSize: 11 },
  dareContent: { color: C.wh, fontSize: 13, fontWeight: '600', marginBottom: 6 },
  dareVoteTallyRow: { flexDirection: 'row', gap: 12, marginBottom: 10, paddingLeft: 2 },
  tallyText: { color: C.wh, fontSize: 12, fontWeight: '700' },
  actionGroup: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  dareAccept: { backgroundColor: C.g, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  dareReject: {
    backgroundColor: 'rgba(255,68,68,0.2)', paddingHorizontal: 12,
    paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: C.rd,
  },
  dareBtnText: { color: C.wh, fontSize: 11, fontWeight: '800' },
}); 
