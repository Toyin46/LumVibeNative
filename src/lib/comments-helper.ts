// lib/comments-helper.ts - FIXED VERSION (NO NOTIFICATIONS)
// @ts-ignore - This is a helper file, not a route
export const _isHelper = true;

import { supabase } from "../config/supabase"; 

/**
* ✅ FIXED: Submit comment WITHOUT notifications (to avoid errors)
*/
export async function submitComment(params: {
  postId: string;
  userId: string;
  username: string;
  content: string;
  parentCommentId?: string;
}) {
  try {
    console.log('📝 Submitting comment...');

    // Validate content
    if (!params.content.trim()) {
      throw new Error('Comment cannot be empty');
    }

    // ✅ Create the comment
    const { data: comment, error: commentError } = await supabase
      .from('comments')
      .insert({
        post_id: params.postId,
        user_id: params.userId,
        text: params.content.trim(),
        parent_comment_id: params.parentCommentId || null
      })
      .select()
      .single();

    if (commentError) {
      console.error('❌ Error creating comment:', commentError);
      throw commentError;
    }

    console.log('✅ Comment created with ID:', comment.id);

    // ✅ Update post comments count
    const { error: updateError } = await supabase.rpc(
      'increment_comments_count',
      { post_id: params.postId }
    );

    if (updateError) {
      console.error('⚠️ Warning: Could not update comments count:', updateError);
      // Don't throw - comment was created successfully
    }

    // ✅ NO NOTIFICATIONS - removed to prevent errors

    console.log('✅ Comment submitted successfully');
    return { success: true, comment };
  } catch (error: any) {
    console.error('❌ Submit comment error:', error);
    return {
      success: false,
      error: error.message || 'Failed to submit comment'
    };
  }
}

/**
* ✅ Get comments for a post
*/
export async function getComments(postId: string, limit: number = 50) {
  try {
    const { data, error } = await supabase
      .from('comments')
      .select(`
        *,
        user:users (
          id,
          username,
          display_name,
          photo_url,
          is_verified
        )
      `)
      .eq('post_id', postId)
      .is('parent_comment_id', null)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching comments:', error);
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('getComments error:', error);
    return [];
  }
}

/**
* ✅ Get replies for a comment
*/
export async function getReplies(commentId: string) {
  try {
    const { data, error } = await supabase
      .from('comments')
      .select(`
        *,
        user:users (
          id,
          username,
          display_name,
          photo_url,
          is_verified
        )
      `)
      .eq('parent_comment_id', commentId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching replies:', error);
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('getReplies error:', error);
    return [];
  }
}

/**
* ✅ Delete a comment
*/
export async function deleteComment(commentId: string, userId: string) {
  try {
    // Verify ownership
    const { data: comment } = await supabase
      .from('comments')
      .select('user_id, post_id')
      .eq('id', commentId)
      .single();

    if (!comment || comment.user_id !== userId) {
      throw new Error('Unauthorized');
    }

    // Delete the comment
    const { error } = await supabase
      .from('comments')
      .delete()
      .eq('id', commentId);

    if (error) throw error;

    // Decrement comments count
    await supabase.rpc('decrement_comments_count', {
      post_id: comment.post_id
    });

    return { success: true };
  } catch (error: any) {
    console.error('Delete comment error:', error);
    return { success: false, error: error.message };
  }
}

/**
* ✅ Toggle comment like
*/
export async function toggleCommentLike(commentId: string, userId: string) {
  try {
    // Check if already liked
    const { data: existingLike } = await supabase
      .from('comment_likes')
      .select('id')
      .eq('comment_id', commentId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existingLike) {
      // Unlike
      await supabase
        .from('comment_likes')
        .delete()
        .eq('id', existingLike.id);

      await supabase.rpc('decrement_comment_likes_count', {
        comment_id: commentId
      });

      return { liked: false };
    } else {
      // Like
      await supabase
        .from('comment_likes')
        .insert({
          comment_id: commentId,
          user_id: userId,
        });

      await supabase.rpc('increment_comment_likes_count', {
        comment_id: commentId
      });

      return { liked: true };
    }
  } catch (error) {
    console.error('Toggle comment like error:', error);
    throw error;
  }
} 
