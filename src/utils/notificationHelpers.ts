// utils/notificationHelpers.ts
import { supabase } from '../config/supabase'; 
import { sendPushNotification } from './pushNotifications';

/**
* Send notification when someone likes a post
*/
export async function notifyPostLike(
  postId: string,
  postOwnerId: string,
  likerUserId: string,
  likerUsername: string,
  likerDisplayName: string,
  coinAmount?: number
) {
  try {
    // Don't notify if user likes their own post
    if (postOwnerId === likerUserId) return;

    const title = coinAmount
      ? `${likerDisplayName} sent ${coinAmount} coins! 💰`
      : `${likerDisplayName} liked your post ❤️`;

    const body = coinAmount
      ? `They loved your post so much they sent coins!`
      : `Check out what they thought of your post`;

    await sendPushNotification(postOwnerId, title, body, {
      type: coinAmount ? 'coin' : 'like',
      fromUserId: likerUserId,
      fromUsername: likerUsername,
      postId: postId,
      coinAmount: coinAmount,
    });

    console.log('Like notification sent');
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
  commentText: string
) {
  try {
    // Don't notify if user comments on their own post
    if (postOwnerId === commenterUserId) return;

    const title = `${commenterDisplayName} commented 💬`;
    const body = commentText.length > 50
      ? `${commentText.substring(0, 50)}...`
      : commentText;

    await sendPushNotification(postOwnerId, title, body, {
      type: 'comment',
      fromUserId: commenterUserId,
      fromUsername: commenterUsername,
      postId: postId,
      commentText: commentText,
    });

    console.log('Comment notification sent');
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
  followerDisplayName: string
) {
  try {
    const title = `${followerDisplayName} followed you! 👤`;
    const body = `@${followerUsername} started following you`;

    await sendPushNotification(followedUserId, title, body, {
      type: 'follow',
      fromUserId: followerUserId,
      fromUsername: followerUsername,
    });

    console.log('Follow notification sent');
  } catch (error) {
    console.error('Error sending follow notification:', error);
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
    // Don't notify if user mentions themselves
    if (mentionedUserId === mentionerUserId) return;

    const title = `${mentionerDisplayName} mentioned you @`;
    const body = commentText.length > 50
      ? `${commentText.substring(0, 50)}...`
      : commentText;

    await sendPushNotification(mentionedUserId, title, body, {
      type: 'mention',
      fromUserId: mentionerUserId,
      fromUsername: mentionerUsername,
      postId: postId,
      commentText: commentText,
    });

    console.log('Mention notification sent');
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
    // Add like to database
    const { error: likeError } = await supabase
      .from('likes')
      .insert({
        post_id: postId,
        user_id: currentUserId,
        coins: coinAmount || 0,
      });

    if (likeError) throw likeError;

    // Send notification (database trigger will create notification record)
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
    // Add comment to database
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

    // Send notification (database trigger will create notification record)
    await notifyPostComment(
      postId,
      postOwnerId,
      currentUserId,
      currentUsername,
      currentDisplayName,
      commentText
    );

    // Check for mentions in comment
    const mentionRegex = /@(\w+)/g;
    const mentions = commentText.match(mentionRegex);

    if (mentions) {
      for (const mention of mentions) {
        const mentionedUsername = mention.substring(1); // Remove @
       
        // Get mentioned user ID
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
    // Add follow to database
    const { error: followError } = await supabase
      .from('follows')
      .insert({
        follower_id: currentUserId,
        following_id: userToFollowId,
      });

    if (followError) throw followError;

    // Send notification (database trigger will create notification record)
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
	
