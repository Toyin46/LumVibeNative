// lib/follow-helper.ts - FIXED VERSION WITH DUPLICATE PREVENTION
// @ts-ignore - This is a helper file, not a route
export const _isHelper = true;

import { supabase } from '../config/supabase'; 
import { notifyFollow } from './notifications';

/**
* ✅ Toggle follow/unfollow with duplicate prevention
*/
export async function toggleFollow(params: {
  followerId: string;
  followerUsername: string;
  followingId: string;
}) {
  try {
    console.log('👥 Toggling follow...');

    // ✅ Prevent self-follow
    if (params.followerId === params.followingId) {
      console.log('⚠️ Cannot follow yourself');
      return { following: false, success: false, error: 'Cannot follow yourself' };
    }

    // ✅ Check if already following
    const { data: existingFollow, error: checkError } = await supabase
      .from('follows')
      .select('id')
      .eq('follower_id', params.followerId)
      .eq('following_id', params.followingId)
      .maybeSingle();

    if (checkError) {
      console.error('❌ Error checking follow status:', checkError);
      throw checkError;
    }

    if (existingFollow) {
      // ✅ UNFOLLOW
      console.log('👋 Unfollowing user...');
     
      const { error: deleteError } = await supabase
        .from('follows')
        .delete()
        .eq('id', existingFollow.id);

      if (deleteError) {
        console.error('❌ Error unfollowing:', deleteError);
        throw deleteError;
      }

      console.log('✅ Unfollowed successfully');
      return { following: false, success: true };
    } else {
      // ✅ FOLLOW (with duplicate prevention)
      console.log('🤝 Following user...');
     
      const { error: insertError } = await supabase
        .from('follows')
        .insert({
          follower_id: params.followerId,
          following_id: params.followingId,
        });

      // ✅ Handle duplicate error gracefully
      if (insertError) {
        if (insertError.code === '23505') {
          // Already following - duplicate prevented by database
          console.log('⚠️ Already following - duplicate prevented');
          return { following: true, success: true, message: 'Already following' };
        }
        console.error('❌ Error following:', insertError);
        throw insertError;
      }

      // ✅ Send notification
      await notifyFollow(
        params.followingId,
        params.followerId,
        params.followerUsername
      );

      console.log('✅ Followed successfully');
      return { following: true, success: true };
    }
  } catch (error: any) {
    console.error('❌ Toggle follow error:', error);
    return {
      following: false,
      success: false,
      error: error.message || 'Failed to toggle follow'
    };
  }
}

/**
* ✅ Check if user is following another user
*/
export async function checkIfFollowing(
  followerId: string,
  followingId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('follows')
      .select('id')
      .eq('follower_id', followerId)
      .eq('following_id', followingId)
      .maybeSingle();

    if (error) {
      console.error('Error checking follow status:', error);
      return false;
    }

    return !!data;
  } catch (error) {
    console.error('checkIfFollowing error:', error);
    return false;
  }
}

/**
* ✅ Get follower count for a user
*/
export async function getFollowerCount(userId: string): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('followers_count')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Get follower count error:', error);
      return 0;
    }

    return data?.followers_count || 0;
  } catch (error) {
    console.error('getFollowerCount error:', error);
    return 0;
  }
}

/**
* ✅ Get following count for a user
*/
export async function getFollowingCount(userId: string): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('following_count')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Get following count error:', error);
      return 0;
    }

    return data?.following_count || 0;
  } catch (error) {
    console.error('getFollowingCount error:', error);
    return 0;
  }
}

/**
* ✅ Get list of followers for a user
*/
export async function getFollowers(userId: string, limit: number = 50) {
  try {
    const { data, error } = await supabase
      .from('follows')
      .select(`
        follower_id,
        created_at,
        follower:users!follows_follower_id_fkey (
          id,
          username,
          display_name,
          photo_url,
          is_verified,
          followers_count
        )
      `)
      .eq('following_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Get followers error:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('getFollowers error:', error);
    return [];
  }
}

/**
* ✅ Get list of users that a user is following
*/
export async function getFollowing(userId: string, limit: number = 50) {
  try {
    const { data, error } = await supabase
      .from('follows')
      .select(`
        following_id,
        created_at,
        following:users!follows_following_id_fkey (
          id,
          username,
          display_name,
          photo_url,
          is_verified,
          followers_count
        )
      `)
      .eq('follower_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Get following error:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('getFollowing error:', error);
    return [];
  }
}

/**
* ✅ Get mutual followers (users who follow each other)
*/
export async function getMutualFollowers(userId: string) {
  try {
    // Get users that userId follows
    const { data: following } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', userId);

    if (!following || following.length === 0) return [];

    const followingIds = following.map(f => f.following_id);

    // Get users who also follow userId back
    const { data: mutuals } = await supabase
      .from('follows')
      .select(`
        follower_id,
        follower:users!follows_follower_id_fkey (
          id,
          username,
          display_name,
          photo_url,
          is_verified
        )
      `)
      .eq('following_id', userId)
      .in('follower_id', followingIds);

    return mutuals || [];
  } catch (error) {
    console.error('getMutualFollowers error:', error);
    return [];
  }
}