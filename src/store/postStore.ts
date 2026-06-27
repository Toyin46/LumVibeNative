import { create } from 'zustand';
import { supabase, Post as SupabasePost, Comment as SupabaseComment } from '../config/supabase';
import { Alert } from 'react-native';

export interface Post extends SupabasePost {
  likedBy: string[];
}

export interface Comment extends SupabaseComment {}

interface PostStore {
  posts: Post[];
  loading: boolean;
  loadFeed: () => Promise<void>;
  createPost: (post: Partial<Post>) => Promise<void>;
  likePost: (postId: string, userId: string, sendCoins: boolean) => Promise<void>;
  unlikePost: (postId: string, userId: string) => Promise<void>;
  addComment: (postId: string, userId: string, text: string, userProfile: any) => Promise<void>;
  getComments: (postId: string) => Promise<Comment[]>;
  deletePost: (postId: string) => Promise<void>;
}

export const usePostStore = create<PostStore>((set, get) => ({
  posts: [],
  loading: false,

  loadFeed: async () => {
    try {
      set({ loading: true });

      const { data: postsData, error } = await supabase
        .from('posts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      const { data: { user } } = await supabase.auth.getUser();

      const postIds = postsData?.map(p => p.id) || [];
      const { data: userLikes } = await supabase
        .from('likes')
        .select('post_id')
        .in('post_id', postIds)
        .eq('user_id', user?.id || '');

      const likedPostIds = userLikes?.map(l => l.post_id) || [];

      const posts: Post[] = postsData?.map(post => ({
        ...post,
        likedBy: likedPostIds.includes(post.id) ? [user?.id || ''] : [],
      })) || [];

      set({ posts, loading: false });
    } catch (error) {
      console.error('Load feed error:', error);
      set({ loading: false });
    }
  },

  createPost: async (post) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('posts')
        .insert({
          user_id: user.id,
          username: post.username!,
          display_name: post.display_name!,
          user_photo_url: post.user_photo_url,
          caption: post.caption,
          image_url: post.image_url,
          video_url: post.video_url,
          media_type: post.media_type,
        });

      if (error) throw error;

      await get().loadFeed();
    } catch (error) {
      console.error('Create post error:', error);
      throw error;
    }
  },

  likePost: async (postId, userId, sendCoins) => {
    try {
      const coinsToSend = sendCoins ? 1 : 0;

      // Check if already liked
      const { data: existingLike } = await supabase
        .from('likes')
        .select('id')
        .eq('post_id', postId)
        .eq('user_id', userId)
        .single();

      if (existingLike) {
        Alert.alert('Already liked', 'You already liked this post');
        return;
      }

      // Add like
      const { error: likeError } = await supabase
        .from('likes')
        .insert({
          post_id: postId,
          user_id: userId,
          coins_sent: coinsToSend,
        });

      if (likeError) throw likeError;

      if (sendCoins) {
        // Get post owner
        const { data: post } = await supabase
          .from('posts')
          .select('user_id')
          .eq('id', postId)
          .single();

        if (post) {
          // Deduct coin from liker
          await supabase.rpc('decrement_coins', {
            user_id: userId,
            amount: 1,
          });

          // Add coin to post owner
          await supabase.rpc('increment_coins', {
            user_id: post.user_id,
            amount: 1,
          });

          // Update post coins_received
          await supabase.rpc('increment_post_coins', {
            post_id: postId,
          });
        }
      }

      await get().loadFeed();
    } catch (error: any) {
      console.error('Like post error:', error);
      throw error;
    }
  },

  unlikePost: async (postId, userId) => {
    try {
      const { error } = await supabase
        .from('likes')
        .delete()
        .eq('post_id', postId)
        .eq('user_id', userId);

      if (error) throw error;

      await get().loadFeed();
    } catch (error) {
      console.error('Unlike post error:', error);
      throw error;
    }
  },

  addComment: async (postId, userId, text, userProfile) => {
    try {
      const { error } = await supabase
        .from('comments')
        .insert({
          post_id: postId,
          user_id: userId,
          username: userProfile.username,
          display_name: userProfile.displayName || userProfile.display_name,
          user_photo_url: userProfile.photoURL || userProfile.photo_url,
          text,
        });

      if (error) throw error;
    } catch (error) {
      console.error('Add comment error:', error);
      throw error;
    }
  },

  getComments: async (postId) => {
    try {
      const { data, error } = await supabase
        .from('comments')
        .select('*')
        .eq('post_id', postId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error('Get comments error:', error);
      return [];
    }
  },

  deletePost: async (postId) => {
    try {
      const { error } = await supabase
        .from('posts')
        .delete()
        .eq('id', postId);

      if (error) throw error;

      await get().loadFeed();
    } catch (error) {
      console.error('Delete post error:', error);
      throw error;
    }
  },
}));
	
