// utils/useChat.ts
// ─────────────────────────────────────────────────────────────
// LumVibe — useChat Hook
// IMPORTANT: This file lives in utils/ NOT hooks/
// Expo Router treats hooks/ as routes — keep it in utils/
// ─────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import chatService, { Message, Conversation, Story } from './chatService';
import { uploadVoiceNote, uploadChatImage } from './chatCloudinary';

// ── useConversations ──────────────────────────────────────────
export function useConversations(currentUserId: string | null) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const loadConversations = useCallback(async () => {
    if (!currentUserId) {
      setLoading(false);
      return;
    }
    try {
      const data = await chatService.getConversations(currentUserId);
      setConversations(data);
    } catch (error) {
      console.error('loadConversations error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    loadConversations();

    if (currentUserId) {
      channelRef.current = chatService.subscribeToConversations(
        currentUserId,
        conversations.map(c => c.id), // ← fix: pass conversationIds array
        loadConversations // ← fix: onUpdate is now 3rd arg
      );
    }

    return () => {
      if (channelRef.current) {
        chatService.unsubscribe(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [currentUserId, loadConversations]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    loadConversations();
  }, [loadConversations]);

  return {
    conversations,
    loading,
    refreshing,
    refresh,
    reload: loadConversations,
  };
}

// ── useMessages ───────────────────────────────────────────────
export function useMessages(
  conversationId: string | null,
  currentUserId: string | null,
  disappearingEnabled: boolean = false,
  disappearingDuration: number = 86400
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const reactionsChannelRef = useRef<RealtimeChannel | null>(null);

  const loadMessages = useCallback(async () => {
    if (!conversationId) return;
    try {
      const data = await chatService.getMessages(conversationId);
      setMessages(data);
      setHasMore(data.length === 50);
    } catch (error) {
      console.error('loadMessages error:', error);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  const loadMore = useCallback(async () => {
    if (!conversationId || !hasMore || loadingMore || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const oldest = messages[0];
      const older = await chatService.getMessages(conversationId, 50, oldest.created_at);
      setMessages(prev => [...older, ...prev]);
      setHasMore(older.length === 50);
    } catch (error) {
      console.error('loadMore error:', error);
    } finally {
      setLoadingMore(false);
    }
  }, [conversationId, hasMore, loadingMore, messages]);

  useEffect(() => {
    loadMessages();

    if (conversationId && currentUserId) {
      chatService.markAsRead(conversationId, currentUserId);
    }

    if (conversationId) {
      // Subscribe to new messages
      channelRef.current = chatService.subscribeToMessages(
        conversationId,
        (newMessage) => {
          setMessages(prev => {
            if (prev.find(m => m.id === newMessage.id)) return prev;
            return [...prev, newMessage];
          });
          if (newMessage.sender_id !== currentUserId && conversationId && currentUserId) {
            chatService.markAsRead(conversationId, currentUserId);
          }
        }
      );

      // Subscribe to reactions
      reactionsChannelRef.current = chatService.subscribeToReactions(
        conversationId,
        messages.map(m => m.id), // ← fix: pass messageIds array
        () => loadMessages() // ← fix: onReaction is now 3rd arg
      );
    }

    chatService.deleteExpiredMessages();

    return () => {
      if (channelRef.current) {
        chatService.unsubscribe(channelRef.current);
        channelRef.current = null;
      }
      if (reactionsChannelRef.current) {
        chatService.unsubscribe(reactionsChannelRef.current);
        reactionsChannelRef.current = null;
      }
    };
  }, [conversationId, currentUserId, loadMessages]);

  // ── Send text ──
  const sendText = useCallback(async (
    text: string,
    replyToId?: string
  ): Promise<boolean> => {
    if (!conversationId || !currentUserId || !text.trim()) return false;
    setSending(true);
    try {
      const msg = await chatService.sendMessage(
        conversationId,
        currentUserId,
        text.trim(),
        replyToId,
        disappearingEnabled,
        disappearingDuration
      );
      return !!msg;
    } finally {
      setSending(false);
    }
  }, [conversationId, currentUserId, disappearingEnabled, disappearingDuration]);

  // ── Send voice note ──
  const sendVoiceNote = useCallback(async (
    fileUri: string,
    duration: number
  ): Promise<boolean> => {
    if (!conversationId || !currentUserId) return false;
    setSending(true);
    try {
      const uploaded = await uploadVoiceNote(fileUri);
      if (!uploaded) return false;
      const msg = await chatService.sendMediaMessage(
        conversationId, currentUserId, uploaded.url, 'voice', duration
      );
      return !!msg;
    } finally {
      setSending(false);
    }
  }, [conversationId, currentUserId]);

  // ── Send image ──
  const sendImage = useCallback(async (
    fileUri: string
  ): Promise<boolean> => {
    if (!conversationId || !currentUserId) return false;
    setSending(true);
    try {
      const uploaded = await uploadChatImage(fileUri);
      if (!uploaded) return false;
      const msg = await chatService.sendMediaMessage(
        conversationId, currentUserId, uploaded.url, 'image'
      );
      return !!msg;
    } finally {
      setSending(false);
    }
  }, [conversationId, currentUserId]);

  // ── Share video ──
  const shareVideo = useCallback(async (
    videoId: string,
    title: string,
    thumbnail: string,
    views: string
  ): Promise<boolean> => {
    if (!conversationId || !currentUserId) return false;
    setSending(true);
    try {
      const msg = await chatService.sendVideoShare(
        conversationId, currentUserId, videoId, title, thumbnail, views
      );
      return !!msg;
    } finally {
      setSending(false);
    }
  }, [conversationId, currentUserId]);

  // ── React to message ──
  const reactToMessage = useCallback(async (
    messageId: string,
    emoji: string
  ): Promise<void> => {
    if (!currentUserId) return;
    await chatService.addReaction(messageId, currentUserId, emoji);
  }, [currentUserId]);

  // ── Delete message ──
  const deleteMessage = useCallback(async (
    messageId: string
  ): Promise<void> => {
    if (!currentUserId) return;
    const success = await chatService.deleteMessage(messageId, currentUserId);
    if (success) {
      setMessages(prev => prev.filter(m => m.id !== messageId));
    }
  }, [currentUserId]);

  return {
    messages,
    loading,
    sending,
    loadingMore,
    hasMore,
    loadMore,
    sendText,
    sendVoiceNote,
    sendImage,
    shareVideo,
    reactToMessage,
    deleteMessage,
  };
}

// ── useStories ────────────────────────────────────────────────
export function useStories(currentUserId: string | null) {
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUserId) {
      setLoading(false);
      return;
    }

    const loadStories = async () => {
      try {
        const data = await chatService.getStories(currentUserId);
        setStories(data);
      } catch (error) {
        console.error('loadStories error:', error);
      } finally {
        setLoading(false);
      }
    };

    loadStories();
  }, [currentUserId]);

  const viewStory = useCallback(async (storyId: string) => {
    if (!currentUserId) return;
    await chatService.viewStory(storyId, currentUserId);
    setStories(prev =>
      prev.map(s => s.id === storyId ? { ...s, has_viewed: true } : s)
    );
  }, [currentUserId]);

  return { stories, loading, viewStory };
}