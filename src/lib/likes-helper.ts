// lib/likes-helper.ts - PRODUCTION READY VERSION WITH DUPLICATE FIX
// @ts-ignore - This is a helper file, not a route
export const _isHelper = true;

import { supabase } from '../config/supabase'; 
import { notifyPostLike } from './notifications';

/**
* ✅ FIXED: Toggle like with proper duplicate error handling
* No more "duplicate key" errors!
*/
export async function toggleLike(params: {
  postId: string;
  userId: string;
  username: string;
}) {
  try {
    console.log('❤️ Toggling like...');

    // ✅ STEP 1: Check if already liked
    const { data: existingLike, error: checkError } = await supabase
      .from('likes')
      .select('id')
      .eq('post_id', params.postId)
      .eq('user_id', params.userId)
      .maybeSingle();  // ✅ Use maybeSingle() to avoid errors if no row found

    if (checkError) {
      console.error('❌ Error checking like:', checkError);
      throw checkError;
    }

    if (existingLike) {
      // ✅ UNLIKE: Remove the like
      console.log('👎 Unliking post...');
     
      const { error: deleteError } = await supabase
        .from('likes')
        .delete()
        .eq('id', existingLike.id);

      if (deleteError) {
        console.error('❌ Error deleting like:', deleteError);
        throw deleteError;
      }

      // Decrement likes count
      await supabase.rpc('decrement_likes_count', { post_id: params.postId });

      console.log('✅ Like removed successfully');
      return { liked: false, success: true };
    } else {
      // ✅ LIKE: Add new like with duplicate protection
      console.log('👍 Liking post...');
     
      const { data: newLike, error: insertError } = await supabase
        .from('likes')
        .insert({
          post_id: params.postId,
          user_id: params.userId,
        })
        .select()
        .single();

      // ✅ HANDLE DUPLICATE ERROR GRACEFULLY
      if (insertError) {
        if (insertError.code === '23505') {
          // Duplicate key error - user already liked this
          console.log('⚠️ Already liked - duplicate prevented');
          return { liked: true, success: true, message: 'Already liked' };
        }
        console.error('❌ Error inserting like:', insertError);
        throw insertError;
      }

      // Increment likes count
      await supabase.rpc('increment_likes_count', { post_id: params.postId });

      // ✅ Send notification to post owner
      const { data: post } = await supabase
        .from('posts')
        .select('user_id, media_url')
        .eq('id', params.postId)
        .single();

      if (post && post.user_id !== params.userId) {
        await notifyPostLike(
          post.user_id,
          params.userId,
          params.username,
          params.postId,
        );
      }

      console.log('✅ Like added successfully');
      return { liked: true, success: true };
    }
  } catch (error: any) {
    console.error('❌ Like operation failed:', error);
   
    // ✅ Return user-friendly error
    return {
      liked: false,
      success: false,
      error: error.message || 'Failed to update like'
    };
  }
}

/**
* ✅ Check if user has liked a post
*/
export async function checkIfLiked(postId: string, userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('likes')
      .select('id')
      .eq('post_id', postId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error checking like status:', error);
      return false;
    }

    return !!data;
  } catch (error) {
    console.error('checkIfLiked error:', error);
    return false;
  }
}

/**
* ✅ Get total likes count for a post
*/
export async function getLikesCount(postId: string): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('likes')
      .select('*', { count: 'exact', head: true })
      .eq('post_id', postId);

    if (error) {
      console.error('Error getting likes count:', error);
      return 0;
    }

    return count || 0;
  } catch (error) {
    console.error('getLikesCount error:', error);
    return 0;
  }
} 
