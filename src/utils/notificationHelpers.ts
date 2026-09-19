// utils/notificationHelpers.ts
//
// ✅ REWRITTEN: this file used to call sendPushNotification() from
// ./pushNotifications, which reads/writes push tokens from a `push_tokens`
// table — a THIRD, completely separate token store from the one everything
// else in this app (calls, messages, cowatch, badges, new posts) has been
// fixed to use (`users.push_token`). That table was never confirmed to even
// have rows in it, the push payload it built was missing `channelId` and
// `priority` entirely, and it was a dead-end no one had audited.
//
// Every exported function below keeps the EXACT SAME name and parameter
// signature it always had — videos.tsx, HomeScreen.tsx, and anything else
// calling notifyPostLike/notifyPostComment/notifyNewFollower/etc. needs
// ZERO changes. Internally, each one now just calls the already-proven,
// already-fixed functions in lib/notifications.ts instead.
import { supabase } from '../config/supabase';
import {
  notifyPostLike   as _notifyPostLike,
  notifyPostComment as _notifyPostComment,
  notifyFollow      as _notifyFollow,
  notifyMention     as _notifyMention,
  notifyMarketplaceOrder as _notifyMarketplaceOrder,
  notifyNewMessage  as _notifyNewMessage,
} from '../lib/notifications';

/**
* Send notification when someone likes a post
*/
export async function notifyPostLike(
  postId: string,
  postOwnerId: string,
  likerUserId: string,
  likerUsername: string,
  likerDisplayName: string,
  coinAmount?: number,
  likerAvatarUrl?: string,
) {
  try {
    if (postOwnerId === likerUserId) return;
    // lib/notifications.ts's title uses this single "name" argument —
    // passing the display name preserves the nicer-looking name this
    // file always showed, instead of the @username lib/notifications.ts
    // would otherwise default to.
    // ✅ NEW: avatar now flows through to a real Android large-icon photo
    // on the notification — same round-photo pattern WhatsApp uses.
    await _notifyPostLike(postOwnerId, likerUserId, likerDisplayName || likerUsername, postId, coinAmount, likerAvatarUrl);
  } catch (error) {
    console.error('Error sending like notification:', error);
  }
}

/**
* Send notification when someone comments on a post
*/
export async function notifyPostComment(
  postId: string,
  postOwnerId: string,
  commenterUserId: string,
  commenterUsername: string,
  commenterDisplayName: string,
  commentText: string,
  commenterAvatarUrl?: string,
) {
  try {
    if (postOwnerId === commenterUserId) return;
    await _notifyPostComment(postOwnerId, commenterUserId, commenterDisplayName || commenterUsername, postId, commentText, undefined, undefined, commenterAvatarUrl);
  } catch (error) {
    console.error('Error sending comment notification:', error);
  }
}

/**
* Send notification when someone follows you
*/
export async function notifyNewFollower(
  followedUserId: string,
  followerUserId: string,
  followerUsername: string,
  followerDisplayName: string,
  followerAvatarUrl?: string,
) {
  try {
    await _notifyFollow(followedUserId, followerUserId, followerDisplayName || followerUsername, followerAvatarUrl);
  } catch (error) {
    console.error('Error sending follow notification:', error);
  }
}

/**
* Send notification when someone places an order on your marketplace listing
*/
export async function notifyMarketplaceOrder(
  sellerId: string,
  buyerId: string,
  buyerUsername: string,
  buyerDisplayName: string,
  listingTitle: string
) {
  try {
    if (sellerId === buyerId) return;
    await _notifyMarketplaceOrder(sellerId, buyerId, buyerDisplayName || buyerUsername, listingTitle);
  } catch (error) {
    console.error('Error sending marketplace order notification:', error);
  }
}

/**
* Send notification when someone sends you a direct message
*/
export async function notifyNewMessage(
  recipientUserId: string,
  senderUserId: string,
  senderUsername: string,
  senderDisplayName: string,
  messageText: string,
  conversationId: string,
  senderPhoto: string = ''
) {
  try {
    if (recipientUserId === senderUserId) return;
    // Note: lib/notifications.ts's notifyNewMessage doesn't take a photo
    // param — it wasn't needed by the chat screens that already use it
    // directly. senderPhoto is accepted here for compatibility with any
    // existing caller passing it, but isn't forwarded (harmless no-op)
    // unless/until lib/notifications.ts's version is extended to use it.
    await _notifyNewMessage(recipientUserId, senderUserId, senderDisplayName || senderUsername, conversationId, messageText);
  } catch (error) {
    console.error('Error sending message notification:', error);
  }
}

/**
* Send notification when someone mentions you in a comment
*/
export async function notifyMention(
  mentionedUserId: string,
  mentionerUserId: string,
  mentionerUsername: string,
  mentionerDisplayName: string,
  postId: string,
  commentText: string
) {
  try {
    if (mentionedUserId === mentionerUserId) return;
    await _notifyMention(mentionedUserId, mentionerUserId, mentionerDisplayName || mentionerUsername, postId, commentText);
  } catch (error) {
    console.error('Error sending mention notification:', error);
  }
}

/**
* Example: Use these in your like button handler
*/
export async function handleLikePress(
  postId: string,
  postOwnerId: string,
  currentUserId: string,
  currentUsername: string,
  currentDisplayName: string,
  coinAmount?: number
) {
  try {
    const { error: likeError } = await supabase
      .from('likes')
      .insert({
        post_id: postId,
        user_id: currentUserId,
        coins: coinAmount || 0,
      });

    if (likeError) throw likeError;

    await notifyPostLike(
      postId,
      postOwnerId,
      currentUserId,
      currentUsername,
      currentDisplayName,
      coinAmount
    );

    return { success: true };
  } catch (error: any) {
    console.error('Error liking post:', error);
    return { success: false, error: error.message };
  }
}

/**
* Example: Use these in your comment submission
*/
export async function handleCommentSubmit(
  postId: string,
  postOwnerId: string,
  currentUserId: string,
  currentUsername: string,
  currentDisplayName: string,
  commentText: string
) {
  try {
    const { data: comment, error: commentError } = await supabase
      .from('comments')
      .insert({
        post_id: postId,
        user_id: currentUserId,
        content: commentText,
      })
      .select()
      .single();

    if (commentError) throw commentError;

    await notifyPostComment(
      postId,
      postOwnerId,
      currentUserId,
      currentUsername,
      currentDisplayName,
      commentText
    );

    const mentionRegex = /@(\w+)/g;
    const mentions = commentText.match(mentionRegex);

    if (mentions) {
      for (const mention of mentions) {
        const mentionedUsername = mention.substring(1);

        const { data: mentionedUser } = await supabase
          .from('users')
          .select('id')
          .eq('username', mentionedUsername.toLowerCase())
          .single();

        if (mentionedUser) {
          await notifyMention(
            mentionedUser.id,
            currentUserId,
            currentUsername,
            currentDisplayName,
            postId,
            commentText
          );
        }
      }
    }

    return { success: true, comment };
  } catch (error: any) {
    console.error('Error submitting comment:', error);
    return { success: false, error: error.message };
  }
}

/**
* Example: Use this in your follow button handler
*/
export async function handleFollowPress(
  userToFollowId: string,
  currentUserId: string,
  currentUsername: string,
  currentDisplayName: string
) {
  try {
    const { error: followError } = await supabase
      .from('follows')
      .insert({
        follower_id: currentUserId,
        following_id: userToFollowId,
      });

    if (followError) throw followError;

    await notifyNewFollower(
      userToFollowId,
      currentUserId,
      currentUsername,
      currentDisplayName
    );

    return { success: true };
  } catch (error: any) {
    console.error('Error following user:', error);
    return { success: false, error: error.message };
  }
}
