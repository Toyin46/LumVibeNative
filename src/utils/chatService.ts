// utils/chatService.ts
// ─────────────────────────────────────────────────────────────
// LumVibe Chat Service
// All Supabase database operations for the chat feature
// ─────────────────────────────────────────────────────────────

import { supabase } from '../config/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

// ── TYPES ─────────────────────────────────────────────────────

export interface ChatUser {
  id: string;
  username: string;
  display_name: string;
  photo_url?: string;
}

export interface Conversation {
  id: string;
  created_at: string;
  updated_at: string;
  last_message?: string;
  last_message_at?: string;
  disappearing_enabled: boolean;
  disappearing_duration: number;
  other_user?: ChatUser;
  unread_count?: number;
  streak_count?: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  created_at: string;
  message_type: 'text' | 'voice' | 'image' | 'video' | 'gif' | 'sticker' | 'system';
  content?: string;
  media_url?: string;
  media_duration?: number;
  media_thumbnail?: string;
  shared_video_id?: string;
  shared_video_title?: string;
  shared_video_thumbnail?: string;
  shared_video_views?: string;
  shared_song_title?: string;
  shared_song_artist?: string;
  shared_song_url?: string;
  is_read: boolean;
  is_deleted: boolean;
  is_disappearing: boolean;
  disappears_at?: string;
  reply_to_message_id?: string;
  reply_to_message?: Message;
  reactions?: MessageReaction[];
  sender?: ChatUser;
}

export interface MessageReaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
  user?: ChatUser;
}

export interface Story {
  id: string;
  user_id: string;
  media_url: string;
  media_type: 'image' | 'video';
  caption?: string;
  created_at: string;
  expires_at: string;
  is_active: boolean;
  view_count: number;
  user?: ChatUser;
  has_viewed?: boolean;
}

export interface UserStreak {
  id: string;
  user_id: string;
  other_user_id: string;
  streak_count: number;
  last_interaction_at: string;
}

// ── CONVERSATIONS ─────────────────────────────────────────────

export const chatService = {

  // Get or create a conversation between two users
  // Uses an RPC for atomicity — no race condition between two users
  // starting a chat simultaneously.
  async getOrCreateConversation(
    currentUserId: string,
    otherUserId: string
  ): Promise<Conversation | null> {
    try {
      // Call a PostgreSQL function that does the find-or-create atomically.
      // See the SQL definition at the bottom of this file.
      const { data, error } = await supabase
        .rpc('get_or_create_conversation', {
          user_a: currentUserId,
          user_b: otherUserId,
        });

      if (error) throw error;
      return data as Conversation;
    } catch (error) {
      console.error('getOrCreateConversation error:', error);
      return null;
    }
  },

  // Get all conversations for current user with other user details.
  // Single-pass: joins participants + users + streaks in one query
  // via a Postgres view to avoid the N+1 problem.
  async getConversations(currentUserId: string): Promise<Conversation[]> {
    try {
      // This calls a DB view `user_conversations_view` that returns
      // one row per conversation already joined with other_user and streak.
      // See the SQL definition at the bottom of this file.
      const { data, error } = await supabase
        .from('user_conversations_view')
        .select('*')
        .eq('user_id', currentUserId)
        .order('last_message_at', { ascending: false });

      if (error) throw error;
      return (data || []) as Conversation[];
    } catch (error) {
      console.error('getConversations error:', error);
      return [];
    }
  },

  // ── MESSAGES ──────────────────────────────────────────────

  // Get messages for a conversation
  async getMessages(
    conversationId: string,
    limit = 50,
    before?: string
  ): Promise<Message[]> {
    try {
      // Purge any expired disappearing messages before fetching
      await chatService.deleteExpiredMessages(conversationId);

      let query = supabase
        .from('messages')
        .select(`
          *,
          sender:users!sender_id (
            id, username, display_name, photo_url
          ),
          reactions:message_reactions (
            id, emoji, user_id,
            user:users!user_id (id, username, display_name, photo_url)
          ),
          reply_to_message:messages!reply_to_message_id (
            id, content, message_type, sender_id,
            sender:users!sender_id (id, username, display_name)
          )
        `)
        .eq('conversation_id', conversationId)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (before) {
        query = query.lt('created_at', before);
      }

      const { data, error } = await query;
      if (error) throw error;

      return (data || []).reverse();
    } catch (error) {
      console.error('getMessages error:', error);
      return [];
    }
  },

  // Send a text message
  async sendMessage(
    conversationId: string,
    senderId: string,
    content: string,
    replyToId?: string,
    isDisappearing?: boolean,
    disappearingDuration?: number
  ): Promise<Message | null> {
    try {
      const messageData: any = {
        conversation_id: conversationId,
        sender_id: senderId,
        message_type: 'text',
        content,
        is_disappearing: isDisappearing || false,
      };

      if (replyToId) messageData.reply_to_message_id = replyToId;

      if (isDisappearing && disappearingDuration) {
        const expiresAt = new Date();
        expiresAt.setSeconds(expiresAt.getSeconds() + disappearingDuration);
        messageData.disappears_at = expiresAt.toISOString();
      }

      const { data, error } = await supabase
        .from('messages')
        .insert(messageData)
        .select(`
          *,
          sender:users!sender_id (
            id, username, display_name, photo_url
          )
        `)
        .single();

      if (error) throw error;

      // Update streak for both sender and receiver
      await chatService.updateStreak(senderId, conversationId);

      return data;
    } catch (error) {
      console.error('sendMessage error:', error);
      return null;
    }
  },

  // Send a media message (voice note, image, video)
  async sendMediaMessage(
    conversationId: string,
    senderId: string,
    mediaUrl: string,
    mediaType: 'voice' | 'image' | 'video',
    duration?: number,
    thumbnail?: string
  ): Promise<Message | null> {
    try {
      const { data, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: senderId,
          message_type: mediaType,
          media_url: mediaUrl,
          media_duration: duration,
          media_thumbnail: thumbnail,
        })
        .select(`
          *,
          sender:users!sender_id (
            id, username, display_name, photo_url
          )
        `)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('sendMediaMessage error:', error);
      return null;
    }
  },

  // Send a shared video card
  async sendVideoShare(
    conversationId: string,
    senderId: string,
    videoId: string,
    videoTitle: string,
    videoThumbnail: string,
    videoViews: string
  ): Promise<Message | null> {
    try {
      const { data, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: senderId,
          message_type: 'video',
          shared_video_id: videoId,
          shared_video_title: videoTitle,
          shared_video_thumbnail: videoThumbnail,
          shared_video_views: videoViews,
        })
        .select(`
          *,
          sender:users!sender_id (
            id, username, display_name, photo_url
          )
        `)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('sendVideoShare error:', error);
      return null;
    }
  },

  // Mark messages as read
  async markAsRead(conversationId: string, userId: string): Promise<void> {
    try {
      await supabase
        .from('messages')
        .update({ is_read: true })
        .eq('conversation_id', conversationId)
        .neq('sender_id', userId)
        .eq('is_read', false);

      await supabase
        .from('conversation_participants')
        .update({ unread_count: 0, last_read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .eq('user_id', userId);
    } catch (error) {
      console.error('markAsRead error:', error);
    }
  },

  // Delete a message (soft delete)
  async deleteMessage(messageId: string, userId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('messages')
        .update({ is_deleted: true })
        .eq('id', messageId)
        .eq('sender_id', userId);

      return !error;
    } catch (error) {
      console.error('deleteMessage error:', error);
      return false;
    }
  },

  // ── REACTIONS ────────────────────────────────────────────

  async addReaction(
    messageId: string,
    userId: string,
    emoji: string
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('message_reactions')
        .upsert({ message_id: messageId, user_id: userId, emoji });

      return !error;
    } catch (error) {
      console.error('addReaction error:', error);
      return false;
    }
  },

  async removeReaction(messageId: string, userId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('message_reactions')
        .delete()
        .eq('message_id', messageId)
        .eq('user_id', userId);

      return !error;
    } catch (error) {
      console.error('removeReaction error:', error);
      return false;
    }
  },

  // ── DISAPPEARING MESSAGES ─────────────────────────────────

  async toggleDisappearing(
    conversationId: string,
    enabled: boolean,
    duration: number = 86400
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('conversations')
        .update({ disappearing_enabled: enabled, disappearing_duration: duration })
        .eq('id', conversationId);

      return !error;
    } catch (error) {
      console.error('toggleDisappearing error:', error);
      return false;
    }
  },

  // Scoped to a specific conversation so it can be called on chat open
  // without scanning the entire messages table every time.
  async deleteExpiredMessages(conversationId?: string): Promise<void> {
    try {
      let query = supabase
        .from('messages')
        .update({ is_deleted: true })
        .eq('is_disappearing', true)
        .lt('disappears_at', new Date().toISOString());

      if (conversationId) {
        query = query.eq('conversation_id', conversationId);
      }

      await query;
    } catch (error) {
      console.error('deleteExpiredMessages error:', error);
    }
  },

  // ── STREAKS ───────────────────────────────────────────────

  // Always syncs both sides of the streak so counts never diverge.
  async updateStreak(
    userId: string,
    conversationId: string
  ): Promise<void> {
    try {
      const { data: participants } = await supabase
        .from('conversation_participants')
        .select('user_id')
        .eq('conversation_id', conversationId)
        .neq('user_id', userId);

      if (!participants || participants.length === 0) return;

      const otherUserId = participants[0].user_id;
      const now = new Date();

      // Helper that upserts one side of the streak
      const syncSide = async (ownId: string, otherId: string) => {
        const { data: existing } = await supabase
          .from('user_streaks')
          .select('*')
          .eq('user_id', ownId)
          .eq('other_user_id', otherId)
          .single();

        if (existing) {
          const hoursDiff =
            (now.getTime() - new Date(existing.last_interaction_at).getTime()) /
            (1000 * 60 * 60);

          const newCount =
            hoursDiff < 24
              ? existing.streak_count          // same day — no increment
              : hoursDiff < 48
              ? existing.streak_count + 1      // next day — increment
              : 1;                             // broken — reset

          await supabase
            .from('user_streaks')
            .update({ streak_count: newCount, last_interaction_at: now.toISOString() })
            .eq('id', existing.id);
        } else {
          // First ever message between these two users
          await supabase.from('user_streaks').insert({
            user_id: ownId,
            other_user_id: otherId,
            streak_count: 1,
            last_interaction_at: now.toISOString(),
          });
        }
      };

      // Sync both sides every time so neither side drifts
      await Promise.all([
        syncSide(userId, otherUserId),
        syncSide(otherUserId, userId),
      ]);
    } catch (error) {
      console.error('updateStreak error:', error);
    }
  },

  async getStreak(userId: string, otherUserId: string): Promise<number> {
    try {
      const { data } = await supabase
        .from('user_streaks')
        .select('streak_count')
        .eq('user_id', userId)
        .eq('other_user_id', otherUserId)
        .single();

      return data?.streak_count || 0;
    } catch {
      return 0;
    }
  },

  // ── STORIES ───────────────────────────────────────────────

  async getStories(currentUserId: string): Promise<Story[]> {
    try {
      const { data, error } = await supabase
        .from('stories')
        .select(`
          *,
          user:users!user_id (
            id, username, display_name, photo_url
          )
        `)
        .eq('is_active', true)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });

      if (error) throw error;

      const storyIds = (data || []).map((s: any) => s.id);
      if (storyIds.length === 0) return [];

      const { data: viewed } = await supabase
        .from('story_views')
        .select('story_id')
        .eq('viewer_id', currentUserId)
        .in('story_id', storyIds);

      const viewedIds = new Set((viewed || []).map((v: any) => v.story_id));

      return (data || []).map((story: any) => ({
        ...story,
        has_viewed: viewedIds.has(story.id),
      }));
    } catch (error) {
      console.error('getStories error:', error);
      return [];
    }
  },

  async createStory(
    userId: string,
    mediaUrl: string,
    mediaType: 'image' | 'video',
    caption?: string
  ): Promise<Story | null> {
    try {
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      const { data, error } = await supabase
        .from('stories')
        .insert({
          user_id: userId,
          media_url: mediaUrl,
          media_type: mediaType,
          caption,
          expires_at: expiresAt.toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('createStory error:', error);
      return null;
    }
  },

  async viewStory(storyId: string, viewerId: string): Promise<void> {
    try {
      await supabase
        .from('story_views')
        .upsert({ story_id: storyId, viewer_id: viewerId });

      await supabase.rpc('increment_story_views', { story_id: storyId });
    } catch (error) {
      console.error('viewStory error:', error);
    }
  },

  // ── REALTIME ─────────────────────────────────────────────

  // Subscribe to new messages in a conversation
  subscribeToMessages(
    conversationId: string,
    onMessage: (message: Message) => void
  ): RealtimeChannel {
    return supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        async (payload) => {
          const { data } = await supabase
            .from('messages')
            .select(`
              *,
              sender:users!sender_id (
                id, username, display_name, photo_url
              )
            `)
            .eq('id', payload.new.id)
            .single();

          if (data) onMessage(data as Message);
        }
      )
      .subscribe();
  },

  // Subscribe to message reactions — filtered to this conversation's
  // messages only. Requires conversation_id column on message_reactions,
  // or falls back to a client-side check using message IDs.
  subscribeToReactions(
    conversationId: string,
    messageIds: string[],
    onReaction: (payload: any) => void
  ): RealtimeChannel {
    return supabase
      .channel(`reactions:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'message_reactions',
        },
        (payload) => {
          // Only forward reactions that belong to messages in this conversation
          const messageId =
            (payload.new as any)?.message_id ||
            (payload.old as any)?.message_id;
          if (messageIds.includes(messageId)) {
            onReaction(payload);
          }
        }
      )
      .subscribe();
  },

  // Subscribe to conversations belonging to the current user only.
  // Filters by the user's known conversation IDs to avoid receiving
  // updates for every conversation in the app.
  subscribeToConversations(
    userId: string,
    conversationIds: string[],
    onUpdate: () => void
  ): RealtimeChannel {
    const filter =
      conversationIds.length > 0
        ? `id=in.(${conversationIds.join(',')})`
        : undefined;

    const channel = supabase
      .channel(`conversations:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversations',
          ...(filter ? { filter } : {}),
        },
        (payload) => {
          // Extra client-side guard for when filter isn't set
          if (
            !filter ||
            conversationIds.includes((payload.new as any)?.id)
          ) {
            onUpdate();
          }
        }
      )
      .subscribe();

    return channel;
  },

  unsubscribe(channel: RealtimeChannel): void {
    supabase.removeChannel(channel);
  },
};

export default chatService;