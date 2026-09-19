// FILE: lib/notifications.ts
// ─────────────────────────────────────────────────────────────
// Kinsta — Notification Library
// Handles both:
//   1. In-app notifications (stored in Supabase notifications table)
//   2. Push notifications (sent via Expo Push API to device)
//
// HOW PUSH WORKS:
//   • Each user's Expo push token is saved in users.push_token
//     (✅ FIX: was profiles.push_token — that table has zero real user
//     rows, confirmed via a direct schema query. Every actual user lives
//     in `users`, which needed the column added: see
//     `alter table public.users add column if not exists push_token text;`)
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

/** Fetch the push token for a given user */
async function getPushToken(userId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('users')
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
  imageUrl,
}: {
  recipientUserId: string;
  fromUserId: string;
  title: string;
  body: string;
  type: string;
  data: Record<string, string>;
  postId?: string;
  commentId?: string;
  // ✅ NEW: the sending user's avatar — shows next to the notification on
  // Android (a proper big-picture image, not just text), the way likes/
  // comments/follows should visually identify who did it. Optional and
  // additive — every existing call site that doesn't pass this keeps
  // working exactly as before, just without an image.
  imageUrl?: string;
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
    const message: Record<string, any> = {
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
    // ✅ NEW: confirmed via Expo's own GitHub discussion (#27980) —
    // richContent.image DOES work for a real image on Android, but ONLY
    // when the request body is an array of messages, even for a single
    // one. Sending it as a bare object (what this always did before)
    // silently drops richContent — Expo's server only looks for it in
    // the array form. That's exactly why the request below changed from
    // JSON.stringify(message) to JSON.stringify([message]).
    if (imageUrl) {
      message.richContent = { image: imageUrl };
    }

    const res = await fetch(EXPO_PUSH_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify([message]),
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

/** Like — deep-links to the post.
 * ✅ EXTENDED: coinAmount is optional, added so notificationHelpers.ts's
 * "liked with coins attached" variant (its own type: 'coin') can delegate
 * here instead of needing a second near-duplicate function. */
export async function notifyPostLike(
  postOwnerId: string,
  likerId: string,
  likerUsername: string,
  postId: string,
  coinAmount?: number,
  likerAvatarUrl?: string,
) {
  if (postOwnerId === likerId) return;
  await sendPushAndStore({
    recipientUserId: postOwnerId,
    fromUserId:      likerId,
    title:           coinAmount ? `${likerUsername} sent ${coinAmount} coins! 💰` : `${likerUsername} liked your post`,
    body:            coinAmount ? 'They loved your post so much they sent coins!' : 'Tap to see your post',
    type:            coinAmount ? 'coin' : 'like',
    postId,
    imageUrl: likerAvatarUrl,
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
  commenterAvatarUrl?: string,
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
    imageUrl: commenterAvatarUrl,
    data: { screen: '/post/[id]', id: postId },
  });
}

/** Follow — deep-links to the follower's profile */
export async function notifyFollow(
  followedUserId: string,
  followerId: string,
  followerUsername: string,
  followerAvatarUrl?: string,
) {
  await sendPushAndStore({
    recipientUserId: followedUserId,
    fromUserId:      followerId,
    title:           `${followerUsername} followed you`,
    body:            'Tap to see their profile',
    type:            'follow',
    imageUrl: followerAvatarUrl,
    data: { screen: '/user/[id]', id: followerId },
  });
}

/** New post — deep-links straight to the post, same as like/comment.
 * ✅ NEW: fixes "new post from someone you follow" not existing at all —
 * confirmed missing by reading this file in full. Called once per
 * follower from create.tsx right after a successful, immediately-published
 * post (never for scheduled posts — those aren't live yet, and there's no
 * scheduled job in this codebase to fire this later when they do go live). */
export async function notifyNewPost(
  followerId: string,
  posterId: string,
  posterUsername: string,
  postId: string,
  posterAvatarUrl?: string,
  postThumbnailUrl?: string,
) {
  if (followerId === posterId) return;
  await sendPushAndStore({
    recipientUserId: followerId,
    fromUserId:      posterId,
    title:           `${posterUsername} just posted`,
    body:            'Tap to check it out',
    type:            'new_post',
    postId,
    // Prefer the actual post's thumbnail (more relevant than a face for
    // "check out this post") — falls back to the poster's avatar if no
    // thumbnail was passed.
    imageUrl: postThumbnailUrl || posterAvatarUrl,
    data: { screen: '/post/[id]', id: postId },
  });
}

/** Badge earned — deep-links to the Profile screen's badges section.
 * ✅ NEW: profile.tsx's checkAndAwardBadges only ever inserted a row into
 * the in-app `notifications` table directly — it never went through this
 * file's push pipeline at all, confirmed by reading that function. That
 * in-app insert is left completely alone (still happens exactly as
 * before); this just ADDS the missing real push notification alongside it. */
export async function notifyBadgeEarned(
  userId: string,
  badgeName: string,
  badgeIcon: string,
  reward: string,
) {
  await sendPushAndStore({
    recipientUserId: userId,
    fromUserId:      userId, // no "other user" involved — self/system achievement
    title:           `Badge Earned! ${badgeIcon}`,
    body:            `You earned "${badgeName}"! Reward: ${reward}`,
    type:            'achievement',
    data: { screen: '/profile', openBadgesModal: 'true' },
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
  inviterPhoto?: string,
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
    const message: Record<string, any> = {
      to:       token,
      title:    `🎬 ${inviterUsername} wants to watch together!`,
      body:     'Tap to join the watch party',
      sound:    'default',
      priority: 'high',
      // ✅ FIX (WhatsApp-style banner for cowatch, requested alongside
      // calls): 'default' is a low-importance Android channel — on
      // Android 8+ that's a quiet notification-tray entry, not a
      // heads-up banner, regardless of priority/sound set here. 'calls'
      // is the high-importance channel chat/[id].tsx already creates
      // for incoming calls; reusing it is what actually makes this pop
      // up over other apps / the lock screen the same way a call does.
      channelId: 'calls_v2', // ✅ FIX: renamed from 'calls' — see the comment on registerCallPushToken in chat/[id].tsx (Android permanently locks a channel's sound/importance the first time that ID is ever created on a device; the old 'calls' channel got stuck silent forever)
      // ✅ NEW: lets the notification carry real Join/Dismiss action
      // buttons on the banner itself, matching the 'cowatch_invite'
      // category chat/[id].tsx registers client-side (Android + iOS).
      categoryIdentifier: 'cowatch_invite',
      // Deep-link payload — read in your notification response handler.
      // ✅ FIX (cowatch parity): added inviterId/inviterName/inviterPhoto
      // to match the shape src/lib/incomingCallNotifee.ts's
      // IncomingCowatchNotifeeData expects (needed for the notifee
      // ringing screen extension) — otherName/from_user_id kept exactly
      // as they were for the existing notificationPushNavigation.ts path,
      // so nothing already reading those breaks.
      data: {
        type:           'cowatch_invite',
        screen:         '/chat/cowatch',
        conversationId,
        sessionId,
        otherName:      inviterUsername,
        from_user_id:   inviterUserId,
        inviterId:      inviterUserId,
        inviterName:    inviterUsername,
        inviterPhoto:   inviterPhoto || '',
      },
    };
    // ✅ NEW: avatar support (see sendPushAndStore's richContent comment
    // for why this specifically needs the array-wrapped body form).
    if (inviterPhoto) {
      message.richContent = { image: inviterPhoto };
    }

    const res = await fetch(EXPO_PUSH_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify([message]),
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
  // ✅ EXTENDED: optional, defaulted — any existing caller that doesn't
  // pass this still compiles and behaves exactly as before.
  senderPhoto?: string,
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
    data: { screen: '/chat/[id]', id: conversationId, senderPhoto: senderPhoto || '' },
  });
}

/** Mention — deep-links to the post the mention happened in.
 * ✅ NEW: notificationHelpers.ts had this concept already but was
 * sending it through the broken pushNotifications.ts pipeline. */
export async function notifyMention(
  mentionedUserId: string,
  mentionerId: string,
  mentionerUsername: string,
  postId: string,
  commentText: string,
) {
  if (mentionedUserId === mentionerId) return;
  const preview = commentText.length > 50 ? commentText.slice(0, 47) + '…' : commentText;
  await sendPushAndStore({
    recipientUserId: mentionedUserId,
    fromUserId:      mentionerId,
    title:           `${mentionerUsername} mentioned you`,
    body:            preview,
    type:            'mention',
    postId,
    data: { screen: '/post/[id]', id: postId },
  });
}

/** Marketplace order — deep-links to the seller's Orders list.
 * ✅ NEW: same reason as notifyMention — existed conceptually, was going
 * through the broken pipeline. Main → Market → Orders confirmed against
 * MarketplaceStack.tsx/MainTabs.tsx (no orderId is available to this
 * function today, so this links to the list rather than one specific
 * order — pass an orderId through here later if you want the exact one). */
export async function notifyMarketplaceOrder(
  sellerId: string,
  buyerId: string,
  buyerUsername: string,
  listingTitle: string,
) {
  if (sellerId === buyerId) return;
  await sendPushAndStore({
    recipientUserId: sellerId,
    fromUserId:      buyerId,
    title:           'New Order! 🛍️',
    body:            `${buyerUsername} ordered "${listingTitle}"`,
    type:            'marketplace',
    data: { screen: 'Orders' },
  });
} 
