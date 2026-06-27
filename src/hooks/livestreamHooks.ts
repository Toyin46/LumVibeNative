// ═══════════════════════════════════════════════════════════════════
// livestreamHooks.ts — Shared Hooks Architecture
// LumVibe Livestream Feature — Complete File
// ═══════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback } from 'react';
import { Room, RoomEvent } from '@livekit/react-native';
import { supabase } from '../config/supabase';

// ─── TYPE DEFINITIONS ─────────────────────────────────────────────

export interface LiveComment {
  id: string;
  stream_id: string;
  user_id: string;
  username: string;
  text: string;
  is_pinned: boolean;
  created_at: string;
}

export interface LiveGift {
  id: string;
  stream_id: string;
  sender_id: string;
  receiver_id: string;
  gift_type: string;
  gift_emoji: string;
  coins: number;
  created_at: string;
}

export interface LivePoll {
  id: string;
  stream_id: string;
  question: string;
  options: string[];
  votes: Record<string, number>;
  is_active: boolean;
  created_at: string;
}

export interface LivePrediction {
  id: string;
  stream_id: string;
  question: string;
  options: Record<string, string>;
  bets: Array<{ userId: string; option: string; amount: number }>;
  is_resolved: boolean;
  winner_option: string | null;
  created_at: string;
}

// ─── HOOK 1: useLiveKitRoom ───────────────────────────────────────

interface UseLiveKitRoomResult {
  room: boolean;
  isConnected: boolean;
  isReconnecting: boolean;
  reconnectAttempt: number;
}

export function useLiveKitRoom(
  url: string,
  token: string | null,
  isHost: boolean
): UseLiveKitRoomResult {
  const [room] = useState(() => new Room({ adaptiveStream: true, dynacast: true }));
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isReconnecting, setIsReconnecting] = useState<boolean>(false);
  const [reconnectAttempt, setReconnectAttempt] = useState<number>(0);

  const reconnectCountRef = useRef<number>(0);
  const maxAttempts = 3;
  const isConnectingRef = useRef<boolean>(false);

  const executeConnect = useCallback(async () => {
    if (!token || isConnectingRef.current) return;
    try {
      isConnectingRef.current = true;
      await room.connect(url, token);
      setIsConnected(true);
      setIsReconnecting(false);
      reconnectCountRef.current = 0;
      setReconnectAttempt(0);
    } catch (error) {
      console.error('[useLiveKitRoom Connect Error]:', error);
      setIsConnected(false);
      handleManualReconnect();
    } finally {
      isConnectingRef.current = false;
    }
  }, [url, token, room]);

  const handleManualReconnect = useCallback(() => {
    if (reconnectCountRef.current >= maxAttempts) {
      console.error('[useLiveKitRoom]: Max reconnect attempts reached.');
      setIsReconnecting(false);
      return;
    }
    setIsReconnecting(true);
    reconnectCountRef.current += 1;
    setReconnectAttempt(reconnectCountRef.current);

    // WHY: 4 second delay between attempts gives network time to recover
    setTimeout(() => {
      executeConnect();
    }, 4000);
  }, [executeConnect]);

  useEffect(() => {
    if (!token) return;

    executeConnect();

    const onDisconnected = () => {
      setIsConnected(false);
      handleManualReconnect();
    };

    room.on(RoomEvent.Disconnected, onDisconnected);

    return () => {
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.disconnect();
    };
  }, [token, executeConnect, handleManualReconnect, room]);

  return { room, isConnected, isReconnecting, reconnectAttempt };
}

// ─── HOOK 2: useSupabaseLiveStream ───────────────────────────────

interface UseSupabaseLiveStreamResult {
  comments: LiveComment[];
  gifts: LiveGift[];
  viewerCount: number;
  activePoll: LivePoll | null;
  activePrediction: LivePrediction | null;
}

export function useSupabaseLiveStream(sessionId: string): UseSupabaseLiveStreamResult {
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [gifts, setGifts] = useState<LiveGift[]>([]);
  const [viewerCount, setViewerCount] = useState<number>(0);
  const [activePoll, setActivePoll] = useState<LivePoll | null>(null);
  const [activePrediction, setActivePrediction] = useState<LivePrediction | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    // WHY: Fetch initial state snapshot before realtime kicks in
    const fetchInitialContext = async () => {
      try {
        const { data: streamData } = await supabase
          .from('livestreams')
          .select('viewer_count')
          .eq('id', sessionId)
          .maybeSingle();
        if (streamData) setViewerCount(streamData.viewer_count || 0);

        const { data: pollData } = await supabase
          .from('live_polls')
          .select('*')
          .eq('stream_id', sessionId)
          .eq('is_active', true)
          .maybeSingle();
        if (pollData) setActivePoll(pollData as LivePoll);

        const { data: predData } = await supabase
          .from('live_predictions')
          .select('*')
          .eq('stream_id', sessionId)
          .eq('is_resolved', false)
          .maybeSingle();
        if (predData) setActivePrediction(predData as LivePrediction);
      } catch (err) {
        console.error('[useSupabaseLiveStream Initial Fetch Error]:', err);
      }
    };

    fetchInitialContext();

    // WHY: Single multiplexed channel avoids hitting Supabase channel limits
    const liveChannel = supabase.channel(`stream_nexus:${sessionId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'live_comments',
        filter: `stream_id=eq.${sessionId}`,
      }, (payload) => {
        setComments((prev) => [payload.new as LiveComment, ...prev].slice(0, 100));
      })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'live_gifts',
        filter: `stream_id=eq.${sessionId}`,
      }, (payload) => {
        setGifts((prev) => [payload.new as LiveGift, ...prev].slice(0, 50));
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'livestreams',
        filter: `id=eq.${sessionId}`,
      }, (payload) => {
        setViewerCount(payload.new.viewer_count || 0);
      })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'live_polls',
        filter: `stream_id=eq.${sessionId}`,
      }, (payload) => {
        const updated = payload.new as LivePoll;
        if (updated?.is_active) setActivePoll(updated);
        else setActivePoll(null);
      })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'live_predictions',
        filter: `stream_id=eq.${sessionId}`,
      }, (payload) => {
        const updated = payload.new as LivePrediction;
        if (updated && !updated.is_resolved) setActivePrediction(updated);
        else setActivePrediction(null);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(liveChannel);
    };
  }, [sessionId]);

  return { comments, gifts, viewerCount, activePoll, activePrediction };
}

// ─── HOOK 3: useCoinWallet ────────────────────────────────────────

interface UseCoinWalletResult {
  balance: number;
  refreshBalance: () => Promise<void>;
}

export function useCoinWallet(userId: string | undefined): UseCoinWalletResult {
  const [balance, setBalance] = useState<number>(0);

  const refreshBalance = useCallback(async () => {
    if (!userId) return;
    try {
      // WHY: Correct table is `profiles` and column is `coins_balance` per LumVibe schema
      const { data, error } = await supabase
        .from('profiles')
        .select('coins_balance')
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;
      if (data) setBalance(data.coins_balance ?? 0);
    } catch (err) {
      console.error('[useCoinWallet Fetch Error]:', err);
    }
  }, [userId]);

  useEffect(() => {
    if (userId) refreshBalance();
  }, [userId, refreshBalance]);

  return { balance, refreshBalance };
}

// ─── HOOK 4: useGiftStreak ────────────────────────────────────────

interface UseGiftStreakResult {
  multiplier: number;
  recordGift: () => void;
}

export function useGiftStreak(): UseGiftStreakResult {
  const [multiplier, setMultiplier] = useState<number>(1);
  const lastGiftTimeRef = useRef<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const recordGift = useCallback(() => {
    const now = Date.now();

    if (timerRef.current) clearTimeout(timerRef.current);

    if (lastGiftTimeRef.current !== null) {
      const delta = now - lastGiftTimeRef.current;
      // WHY: x2 multiplier activates only if gifts arrive within 30 second window
      if (delta <= 30000) setMultiplier(2);
      else setMultiplier(1);
    } else {
      setMultiplier(1);
    }

    lastGiftTimeRef.current = now;

    // WHY: Auto-reset multiplier after 30s inactivity
    timerRef.current = setTimeout(() => {
      setMultiplier(1);
      lastGiftTimeRef.current = null;
    }, 30000);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { multiplier, recordGift };
}

// ─── HOOK 5: useLegacyScore ───────────────────────────────────────

interface UseLegacyScoreResult {
  legacyScore: number;
  calculate: (peakViewers: number, totalCoins: number, durationMins: number) => number;
}

export function useLegacyScore(): UseLegacyScoreResult {
  const [legacyScore, setLegacyScore] = useState<number>(0);

  const calculate = useCallback(
    (peakViewers: number, totalCoins: number, durationMins: number): number => {
      try {
        // WHY: Standard LumVibe Legacy Score formula
        const score = (peakViewers * 2) + (totalCoins * 5) + (durationMins * 10);
        setLegacyScore(score);
        return score;
      } catch (err) {
        console.error('[useLegacyScore Calculation Error]:', err);
        return 0;
      }
    },
    []
  );

  return { legacyScore, calculate };
} 
