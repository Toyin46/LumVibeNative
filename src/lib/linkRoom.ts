// src/lib/linkRoom.ts   (NEW FILE)
//
// "Watch with someone who isn't on LumVibe" — the app side.
//
// A link room is a normal Co-Watch session that belongs to a hidden,
// one-person conversation (marked with the group_name below). Your Co-Watch
// screen, feed sync and LiveKit room already work per conversation, so this
// reuses all of it; the guest joins the same session from a web page
// (https://lumvibe.site/watch.html?c=<sessionId>) instead of the app.
// The hidden conversation is filtered out of the Messages list (messages.tsx).

import { Share } from 'react-native';
import { supabase } from '../config/supabase';

export const LINK_ROOM_MARKER = '__link_room__';
export const WATCH_PAGE_URL = 'https://lumvibe.site/watch.html';

export function buildWatchLink(sessionId: string) {
  return `${WATCH_PAGE_URL}?c=${encodeURIComponent(sessionId)}`;
}

/** Opens the phone's share sheet (WhatsApp, SMS, …) with the invite link. */
export async function shareWatchLink(sessionId: string, hostName?: string) {
  const link = buildWatchLink(sessionId);
  const who = hostName ? `${hostName} is` : "I'm";
  await Share.share({
    message: `🎬 ${who} watching videos on LumVibe and wants you to join! Tap to watch together (no account needed):\n${link}`,
  });
}

/** Creates the hidden one-person conversation and returns its id. */
export async function createLinkRoom(userId: string): Promise<string | null> {
  try {
    const { data: convo, error } = await supabase
      .from('conversations')
      .insert({
        is_group: false,
        group_name: LINK_ROOM_MARKER,
        created_by: userId,
        disappearing_enabled: false,
        disappearing_duration: 86400,
      })
      .select('id')
      .single();
    if (error || !convo) throw error || new Error('no conversation created');

    const { error: partError } = await supabase
      .from('conversation_participants')
      .insert({ conversation_id: convo.id, user_id: userId, unread_count: 0 });
    if (partError) throw partError;
    return convo.id as string;
  } catch (e) {
    console.warn('[linkRoom] createLinkRoom failed:', e);
    return null;
  }
}
