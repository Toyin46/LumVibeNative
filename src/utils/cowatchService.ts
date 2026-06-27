// utils/cowatchService.ts
// ─────────────────────────────────────────────────────────────
// LumVibe — Co-Watch Service
// Real-time video sync between two users using Supabase
// ─────────────────────────────────────────────────────────────

import { supabase } from '../config/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

export interface CowatchSession {
  id: string;
  conversation_id: string;
  video_id: string;
  video_title: string;
  video_url?: string;
  started_by: string;
  created_at: string;
  is_active: boolean;
  current_position: number;
  is_playing: boolean;
}

export interface CowatchMessage {
  id: string;
  session_id: string;
  user_id: string;
  content: string;
  created_at: string;
  user?: {
    id: string;
    display_name: string;
    photo_url?: string;
  };
}

export interface SyncEvent {
  type: 'play' | 'pause' | 'seek' | 'ended';
  position: number;
  timestamp: number;
  user_id: string;
}

export const cowatchService = {

  // Start a new co-watch session
  async startSession(
    conversationId: string,
    startedBy: string,
    videoId: string,
    videoTitle: string,
    videoUrl?: string
  ): Promise<CowatchSession | null> {
    try {
      // End any existing active session first
      await supabase
        .from('cowatch_sessions')
        .update({ is_active: false, ended_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .eq('is_active', true);

      // Create new session
      const { data, error } = await supabase
        .from('cowatch_sessions')
        .insert({
          conversation_id: conversationId,
          started_by: startedBy,
          video_id: videoId,
          video_title: videoTitle,
          video_url: videoUrl || '',
          current_position: 0,
          is_playing: false,
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('startSession error:', error);
      return null;
    }
  },

  // Get active session for a conversation
  async getActiveSession(
    conversationId: string
  ): Promise<CowatchSession | null> {
    try {
      const { data, error } = await supabase
        .from('cowatch_sessions')
        .select('*')
        .eq('conversation_id', conversationId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) return null;
      return data;
    } catch {
      return null;
    }
  },

  // Sync a play/pause/seek event to other user
  async syncEvent(
    sessionId: string,
    event: SyncEvent
  ): Promise<void> {
    try {
      await supabase
        .from('cowatch_sessions')
        .update({
          current_position: event.position,
          is_playing: event.type === 'play',
        })
        .eq('id', sessionId);
    } catch (error) {
      console.error('syncEvent error:', error);
    }
  },

  // End the co-watch session
  async endSession(sessionId: string): Promise<void> {
    try {
      await supabase
        .from('cowatch_sessions')
        .update({
          is_active: false,
          ended_at: new Date().toISOString(),
        })
        .eq('id', sessionId);
    } catch (error) {
      console.error('endSession error:', error);
    }
  },

  // Subscribe to sync events from the other user
  subscribeToSession(
    sessionId: string,
    onSync: (session: CowatchSession) => void
  ): RealtimeChannel {
    return supabase
      .channel(`cowatch:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'cowatch_sessions',
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          onSync(payload.new as CowatchSession);
        }
      )
      .subscribe();
  },

  unsubscribe(channel: RealtimeChannel): void {
    supabase.removeChannel(channel);
  },
};

export default cowatchService; 
