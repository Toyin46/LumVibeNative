// FILE: lib/notifications.ts
// ─────────────────────────────────────────────────────────────
// Kinsta — Notification Library
// Handles both:
//   1. In-app notifications (stored in Supabase notifications table)
//   2. Push notifications (sent via Expo Push API to device)
//
// HOW PUSH WORKS:
//   • Each user's Expo push token is saved in profiles.push_token
//   • When an event fires (like, comment, cowatch invite, etc.)
//     we insert a row in `notifications` AND call Expo's push API
//   • The push arrives on the device even when the app is closed
//   • Tapping the notification deep-links into the right screen
// ─────────────────────────────────────────────────────────────

import { supabase } from "../config/supabase"; 

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// ─────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────

/** Fetch the push token for a given user from their profile */
async function getPushToken(userId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('push_token')
      .eq('id', userId)
      .single();
    return data?.push_token || null;
  } catch {
    return null;
  }
}

/**
* Send an Expo push notification to a device.
* Also inserts a row in the notifications table for in-app display.
*
* @param recipientUserId  - Who receives the push
* @param fromUserId       - Who triggered the event
* @param title            - Push notification title
* @param body             - Push notification body text
* @param type             - Notification type (stored in DB)
* @param data             - Deep-link data payload (screen + params)
* @param postId           - Optional post reference
*/
async function sendPushAndStore({
  recipientUserId,
  fromUserId,
  title,
  body,
  type,
  data,
  postId,
  commentId,
}: {
  recipientUserId: string;
  fromUserId: string;
  title: string;
  body: string;
  type: string;
  data: Record<string, string>;
  postId?: string;
  commentId?: string;
}): Promise<void> {
  // ── 1. Insert in-app notification row ───────────────────
  try {
    await supabase.from('notifications').insert({
      user_id:      recipientUserId,
      from_user_id: fromUserId,
      type,
      post_id:    postId    || null,
      comment_id: commentId || null,
      is_read:    false,
    });
  } catch (e) {
    console.warn('notifications insert error:', e);
    // Don't abort — still try push
  }

  // ── 2. Fetch recipient's push token ─────────────────────
  const token = await getPushToken(recipientUserId);
  if (!token || !token.startsWith('ExponentPushToken')) return;

  // ── 3. Send Expo push notification ─────────────────────
  try {
    const message = {
      to:    token,
      title,
      body,
      sound: 'default',
      // data is the deep-link payload — read in notification handler
      data: {
        ...data,
        type,
        post_id:    postId    || '',
        comment_id: commentId || '',
        from_user_id: fromUserId,
      },
      // Android channel
      channelId: 'default',
      // Priority
      priority: 'high',
    };

    const res = await fetch(EXPO_PUSH_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(message),
    });

    if (!res.ok) {
      console.warn('Expo push API error:', await res.text());
    }
  } catch (e) {
    console.warn('sendPush error:', e);
  }
}

// ─────────────────────────────────────────────────────────────
// PUBLIC NOTIFICATION FUNCTIONS
// ─────────────────────────────────────────────────────────────

/** Like — deep-links to the post */
export async function notifyPostLike(
  postOwnerId: string,
  likerId: string,
  likerUsername: string,
  postId: string,
) {
  if (postOwnerId === likerId) return;
  await sendPushAndStore({
    recipientUserId: postOwnerId,
    fromUserId:      likerId,
    title:           `${likerUsername} liked your post`,
    body:            'Tap to see your post',
    type:            'like',
    postId,
    data: { screen: '/post/[id]', id: postId },
  });
}

/** Comment — deep-links to the post */
export async function notifyPostComment(
  postOwnerId: string,
  commenterId: string,
  commenterUsername: string,
  postId: string,
  commentText: string,
  postMediaUrl?: string,
  commentId?: string,
) {
  if (postOwnerId === commenterId) return;
  const preview = commentText.length > 50 ? commentText.slice(0, 47) + '…' : commentText;
  await sendPushAndStore({
    recipientUserId: postOwnerId,
    fromUserId:      commenterId,
    title:           `${commenterUsername} commented on your post`,
    body:            preview || 'Tap to see the comment',
    type:            'comment',
    postId,
    commentId,
    data: { screen: '/post/[id]', id: postId },
  });
}

/** Follow — deep-links to the follower's profile */
export async function notifyFollow(
  followedUserId: string,
  followerId: string,
  followerUsername: string,
) {
  await sendPushAndStore({
    recipientUserId: followedUserId,
    fromUserId:      followerId,
    title:           `${followerUsername} followed you`,
    body:            'Tap to see their profile',
    type:            'follow',
    data: { screen: '/user/[id]', id: followerId },
  });
}

/** Gift — deep-links to the post that received the gift */
export async function notifyGift(
  recipientUserId: string,
  senderId: string,
  senderUsername: string,
  giftName: string,
  giftAmount: number,
  postId?: string,
) {
  await sendPushAndStore({
    recipientUserId,
    fromUserId: senderId,
    title:      `${senderUsername} sent you a ${giftName} gift!`,
    body:       `You received ${giftAmount} coins 🎁`,
    type:       'gift',
    postId,
    data: postId
      ? { screen: '/post/[id]', id: postId }
      : { screen: '/(tabs)/profile' },
  });
}

/**
* CoWatch Invite — the most important one.
* Sent when User A taps "Start CoWatch" in a conversation.
* Deep-links User B directly into the CoWatch screen as a joiner.
*
* @param inviteeUserId     - User B (receives the invite)
* @param inviterUserId     - User A (started the session)
* @param inviterUsername   - User A's display name
* @param conversationId    - The conversation the session is attached to
* @param sessionId         - The active cowatch session ID
*/
export async function notifyCowatchInvite(
  inviteeUserId: string,
  inviterUserId: string,
  inviterUsername: string,
  conversationId: string,
  sessionId: string,
) {
  if (inviteeUserId === inviterUserId) return;

  // Insert a special cowatch_invite notification in-app
  try {
    await supabase.from('notifications').insert({
      user_id:      inviteeUserId,
      from_user_id: inviterUserId,
      type:         'cowatch_invite',
      is_read:      false,
      // Store the deep-link data in the message field as JSON string
      message: JSON.stringify({ conversationId, sessionId }),
    });
  } catch (e) {
    console.warn('cowatch invite notification insert error:', e);
  }

  // Fetch invitee's push token
  const token = await getPushToken(inviteeUserId);
  if (!token || !token.startsWith('ExponentPushToken')) return;

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        to:       token,
        title:    `🎬 ${inviterUsername} wants to watch together!`,
        body:     'Tap to join the watch party',
        sound:    'default',
        priority: 'high',
        channelId: 'default',
        // Deep-link payload — read in your notification response handler
        data: {
          type:           'cowatch_invite',
          screen:         '/chat/cowatch',
          conversationId,
          sessionId,
          otherName:      inviterUsername,
          from_user_id:   inviterUserId,
        },
      }),
    });
    if (!res.ok) console.warn('Expo push (cowatch) error:', await res.text());
  } catch (e) {
    console.warn('sendPush cowatch error:', e);
  }
}

/** Message — deep-links to the conversation */
export async function notifyNewMessage(
  recipientUserId: string,
  senderId: string,
  senderUsername: string,
  conversationId: string,
  messagePreview: string,
) {
  if (recipientUserId === senderId) return;
  const preview = messagePreview.length > 60
    ? messagePreview.slice(0, 57) + '…'
    : messagePreview;
  await sendPushAndStore({
    recipientUserId,
    fromUserId: senderId,
    title:      senderUsername,
    body:       preview,
    type:       'message',
    data: { screen: '/chat/[id]', id: conversationId },
  });
} 
