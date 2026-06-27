// app/post/[id].tsx - FULL SINGLE POST VIEW
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  FlatList,
  Share,
  Dimensions,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuthStore } from './store/authStore';
import { supabase } from './config/supabase';
// FIX: expo-av is deprecated — replaced with expo-video's hook-based player.
import { useVideoPlayer, VideoView } from 'expo-video';

const { width } = Dimensions.get('window');

interface Post {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  user_photo_url?: string;
  media_url?: string;
  media_type?: string;
  caption: string;
  likes_count: number;
  comments_count: number;
  views_count: number;
  coins_received: number;
  liked_by: string[];
  saved_by: string[];
  location?: string;
  music_name?: string;
  music_artist?: string;
  created_at: string;
}

interface Comment {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  user_photo_url?: string;
  text: string;
  created_at: string;
}

export default function ViewPostScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { user, userProfile } = useAuthStore();
  const userId = user?.id;

  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingComments, setLoadingComments] = useState(false);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [isFollowing, setIsFollowing] = useState(false);
  const [checkingFollow, setCheckingFollow] = useState(true);

  // FIX: expo-video's hook-based player replaces expo-av's <Video> ref/props.
  // Hook is called once with a null source; .replace() is called once the
  // post actually loads and media_url becomes available, in the effect below.
  const videoPlayer = useVideoPlayer(null, (player) => {
    player.loop = true;
  });

  useEffect(() => {
    if (post?.media_type === 'video' && post?.media_url) {
      videoPlayer.replace(post.media_url);
    }
  }, [post?.media_url]);

  useEffect(() => {
    loadPost();
    loadComments();
  }, [id]);

  useEffect(() => {
    if (post && userId) {
      checkFollowStatus();
      trackView();
    }
  }, [post, userId]);

  const loadPost = async () => {
    try {
      const { data, error } = await supabase
        .from('posts')
        .select(`
          *,
          users!posts_user_id_fkey (
            username,
            display_name,
            avatar_url
          )
        `)
        .eq('id', id)
        .single();

      if (error) throw error;

      if (data) {
        setPost({
          id: data.id,
          user_id: data.user_id,
          username: data.users?.username || 'unknown',
          display_name: data.users?.display_name || 'Unknown User',
          user_photo_url: data.users?.avatar_url,
          media_url: data.media_url,
          media_type: data.media_type,
          caption: data.caption || '',
          likes_count: data.likes_count || 0,
          comments_count: data.comments_count || 0,
          views_count: data.views_count || 0,
          coins_received: data.coins_received || 0,
          liked_by: data.liked_by || [],
          saved_by: data.saved_by || [],
          location: data.location,
          music_name: data.music_name,
          music_artist: data.music_artist,
          created_at: data.created_at,
        });
      }
    } catch (error: any) {
      console.error('Load post error:', error);
      Alert.alert('Error', 'Failed to load post');
      router.back();
    } finally {
      setLoading(false);
    }
  };

  const loadComments = async () => {
    setLoadingComments(true);
    try {
      const { data } = await supabase
        .from('comments')
        .select(`
          *,
          users!comments_user_id_fkey (
            username,
            display_name,
            avatar_url
          )
        `)
        .eq('post_id', id)
        .order('created_at', { ascending: false });

      if (data) {
        setComments(
          data.map((c: any) => ({
            id: c.id,
            user_id: c.user_id,
            username: c.users?.username || 'unknown',
            display_name: c.users?.display_name || 'Unknown',
            user_photo_url: c.users?.avatar_url,
            text: c.text,
            created_at: c.created_at,
          }))
        );
      }
    } catch (error) {
      console.error('Load comments error:', error);
    } finally {
      setLoadingComments(false);
    }
  };

  const checkFollowStatus = async () => {
    if (!userId || !post || post.user_id === userId) {
      setCheckingFollow(false);
      return;
    }

    try {
      const { data } = await supabase
        .from('follows')
        .select('id')
        .eq('follower_id', userId)
        .eq('following_id', post.user_id)
        .maybeSingle();

      setIsFollowing(!!data);
    } catch (error) {
      console.error('Check follow error:', error);
    } finally {
      setCheckingFollow(false);
    }
  };

  const trackView = async () => {
    if (!userId || !post) return;

    try {
      await supabase.rpc('track_post_view', {
        p_post_id: post.id,
        p_viewer_id: userId,
        p_ip_address: null,
      });
    } catch (error) {
      console.error('Track view error:', error);
    }
  };

  const handleLike = async () => {
    if (!userId || !post) {
      Alert.alert('Login Required', 'Please login to like posts');
      return;
    }

    const isLiked = post.liked_by?.includes(userId);

    try {
      if (isLiked) {
        // Unlike
        const newLikedBy = post.liked_by.filter((id) => id !== userId);
        await supabase.from('likes').delete().eq('post_id', post.id).eq('user_id', userId);
        await supabase.from('posts').update({ liked_by: newLikedBy }).eq('id', post.id);
        setPost({ ...post, likes_count: Math.max(0, post.likes_count - 1), liked_by: newLikedBy });
      } else {
        // Like
        const newLikedBy = [...post.liked_by, userId];
        await supabase.from('likes').insert({ post_id: post.id, user_id: userId });
        await supabase.from('posts').update({ liked_by: newLikedBy }).eq('id', post.id);
        setPost({ ...post, likes_count: post.likes_count + 1, liked_by: newLikedBy });
      }
    } catch (error: any) {
      console.error('Like error:', error);
      Alert.alert('Error', 'Failed to like post');
    }
  };

  const handleFollow = async () => {
    if (!userId || !post || checkingFollow) return;

    try {
      if (isFollowing) {
        await supabase.from('follows').delete().eq('follower_id', userId).eq('following_id', post.user_id);
        const { data: userData } = await supabase.from('users').select('followers').eq('id', post.user_id).single();
        await supabase.from('users').update({ followers: Math.max(0, (userData?.followers || 0) - 1) }).eq('id', post.user_id);
      } else {
        await supabase.from('follows').insert({ follower_id: userId, following_id: post.user_id });
        const { data: userData } = await supabase.from('users').select('followers').eq('id', post.user_id).single();
        await supabase.from('users').update({ followers: (userData?.followers || 0) + 1 }).eq('id', post.user_id);
      }
      setIsFollowing(!isFollowing);
    } catch (error) {
      Alert.alert('Error', 'Failed to update follow status');
    }
  };

  const handleSave = async () => {
    if (!userId || !post) {
      Alert.alert('Login Required', 'Please login to save posts');
      return;
    }

    const isSaved = post.saved_by?.includes(userId);

    try {
      const newSavedBy = isSaved
        ? post.saved_by.filter((id) => id !== userId)
        : [...post.saved_by, userId];

      await supabase.from('posts').update({ saved_by: newSavedBy }).eq('id', post.id);
      setPost({ ...post, saved_by: newSavedBy });

      Alert.alert(
        isSaved ? 'Removed from Saved' : 'Saved!',
        isSaved ? 'Post removed from saved' : 'Post saved successfully'
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to save post');
    }
  };

  const handleShare = async () => {
    if (!post) return;

    try {
      await Share.share({
        message: `Check out @${post.username}'s post on Kinsta!\n\n${post.caption || ''}`,
      });
    } catch (error) {
      console.error('Share error:', error);
    }
  };

  const submitComment = async () => {
    if (!commentText.trim() || !userId || !post || submittingComment) return;

    setSubmittingComment(true);
    try {
      await supabase.from('comments').insert({
        post_id: post.id,
        user_id: userId,
        text: commentText.trim(),
      });

      setCommentText('');
      setPost({ ...post, comments_count: post.comments_count + 1 });
      await loadComments();
    } catch (error: any) {
      console.error('Comment error:', error);
      Alert.alert('Error', 'Failed to post comment');
    } finally {
      setSubmittingComment(false);
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return date.toLocaleDateString();
  };

  const renderComment = ({ item }: { item: Comment }) => (
    <View style={styles.commentItem}>
      {item.user_photo_url ? (
        <Image source={{ uri: item.user_photo_url }} style={styles.commentAvatar} />
      ) : (
        <View style={[styles.commentAvatar, styles.avatarPlaceholder]}>
          <Feather name="user" size={16} color="#00ff88" />
        </View>
      )}
      <View style={styles.commentContent}>
        <View style={styles.commentHeader}>
          <Text style={styles.commentDisplayName}>{item.display_name}</Text>
          <Text style={styles.commentUsername}>@{item.username}</Text>
        </View>
        <Text style={styles.commentText}>{item.text}</Text>
        <Text style={styles.commentTime}>{formatTime(item.created_at)}</Text>
      </View>
    </View>
  );

  if (loading || !post) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00ff88" />
        </View>
      </View>
    );
  }

  const isLiked = userId ? post.liked_by?.includes(userId) : false;
  const isSaved = userId ? post.saved_by?.includes(userId) : false;
  const isOwnPost = userId === post.user_id;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Post</Text>
        <TouchableOpacity onPress={handleShare}>
          <Feather name="share-2" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Post Header */}
        <View style={styles.postHeader}>
          <TouchableOpacity
            style={styles.userInfo}
            onPress={() => router.push(`/user/${post.user_id}` as any)}
          >
            {post.user_photo_url ? (
              <Image source={{ uri: post.user_photo_url }} style={styles.userAvatar} />
            ) : (
              <View style={[styles.userAvatar, styles.avatarPlaceholder]}>
                <Feather name="user" size={20} color="#00ff88" />
              </View>
            )}
            <View style={styles.userDetails}>
              <Text style={styles.displayName}>{post.display_name}</Text>
              <Text style={styles.username}>@{post.username}</Text>
            </View>
          </TouchableOpacity>

          {!isOwnPost && (
            <TouchableOpacity
              style={[styles.followButton, isFollowing && styles.followingButton]}
              onPress={handleFollow}
              disabled={checkingFollow}
            >
              <Text style={[styles.followButtonText, isFollowing && styles.followingButtonText]}>
                {checkingFollow ? '...' : isFollowing ? 'Following' : 'Follow'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Media */}
        {post.media_url && (
          <View style={styles.mediaContainer}>
            {post.media_type === 'video' ? (
              <VideoView
                player={videoPlayer}
                style={styles.media}
                contentFit="cover"
                nativeControls
              />
            ) : (
              <Image source={{ uri: post.media_url }} style={styles.media} resizeMode="cover" />
            )}
          </View>
        )}

        {/* Actions */}
        <View style={styles.actionsContainer}>
          <View style={styles.actionsLeft}>
            <TouchableOpacity style={styles.actionButton} onPress={handleLike}>
              <Feather
                name="heart"
                size={28}
                color={isLiked ? '#00ff88' : '#666'}
                fill={isLiked ? '#00ff88' : 'none'}
              />
              <Text style={styles.actionCount}>{post.likes_count}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionButton}>
              <Feather name="message-circle" size={26} color="#666" />
              <Text style={styles.actionCount}>{post.comments_count}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionButton}>
              <Feather name="eye" size={26} color="#666" />
              <Text style={styles.actionCount}>{post.views_count}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.actionsRight}>
            {post.coins_received > 0 && (
              <View style={styles.coinsEarned}>
                <MaterialCommunityIcons name="diamond" size={16} color="#ffd700" />
                <Text style={styles.coinsText}>{post.coins_received.toFixed(3)}</Text>
              </View>
            )}

            <TouchableOpacity style={styles.actionButton} onPress={handleSave}>
              <Feather
                name="bookmark"
                size={26}
                color={isSaved ? '#00ff88' : '#666'}
                fill={isSaved ? '#00ff88' : 'none'}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Caption & Info */}
        <View style={styles.infoSection}>
          {post.caption && (
            <View style={styles.captionContainer}>
              <Text style={styles.captionUsername}>@{post.username}</Text>
              <Text style={styles.captionText}>{post.caption}</Text>
            </View>
          )}

          {post.location && (
            <View style={styles.locationContainer}>
              <Feather name="map-pin" size={14} color="#00ff88" />
              <Text style={styles.locationText}>{post.location}</Text>
            </View>
          )}

          {post.music_name && (
            <View style={styles.musicContainer}>
              <Feather name="music" size={14} color="#00ff88" />
              <Text style={styles.musicText}>
                {post.music_name} {post.music_artist && `- ${post.music_artist}`}
              </Text>
            </View>
          )}

          <Text style={styles.timestamp}>{formatTime(post.created_at)}</Text>
        </View>

        {/* Comments Section */}
        <View style={styles.commentsSection}>
          <Text style={styles.commentsTitle}>Comments ({post.comments_count})</Text>

          {loadingComments ? (
            <ActivityIndicator size="large" color="#00ff88" style={{ marginTop: 20 }} />
          ) : comments.length === 0 ? (
            <View style={styles.noComments}>
              <Feather name="message-circle" size={48} color="#333" />
              <Text style={styles.noCommentsText}>No comments yet</Text>
              <Text style={styles.noCommentsSubtext}>Be the first to comment!</Text>
            </View>
          ) : (
            <FlatList
              data={comments}
              renderItem={renderComment}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
            />
          )}
        </View>
      </ScrollView>

      {/* Comment Input */}
      <View style={styles.commentInputContainer}>
        <TextInput
          style={styles.commentInput}
          placeholder="Add a comment..."
          placeholderTextColor="#666"
          value={commentText}
          onChangeText={setCommentText}
          multiline
          maxLength={500}
          editable={!submittingComment}
        />
        <TouchableOpacity
          style={styles.sendButton}
          onPress={submitComment}
          disabled={!commentText.trim() || submittingComment}
        >
          <View
            style={[
              styles.sendButtonGradient,
              (!commentText.trim() || submittingComment) && styles.sendButtonDisabled,
            ]}
          >
            {submittingComment ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <Feather name="send" size={20} color="#000" />
            )}
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  content: { flex: 1 },
  postHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  userInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#00ff88',
  },
  avatarPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  userDetails: { flex: 1 },
  displayName: { fontSize: 15, fontWeight: '600', color: '#fff' },
  username: { fontSize: 13, color: '#00ff88' },
  followButton: {
    backgroundColor: '#00ff88',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  followingButton: { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#00ff88' },
  followButtonText: { color: '#000', fontSize: 12, fontWeight: '600' },
  followingButtonText: { color: '#00ff88' },
  mediaContainer: { width, height: width, backgroundColor: '#000' },
  media: { width: '100%', height: '100%' },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  actionsLeft: { flexDirection: 'row', gap: 16 },
  actionsRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  actionButton: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionCount: { fontSize: 14, fontWeight: '600', color: '#fff' },
  coinsEarned: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
    borderWidth: 1,
    borderColor: '#ffd700',
  },
  coinsText: { fontSize: 14, fontWeight: 'bold', color: '#ffd700' },
  infoSection: { paddingHorizontal: 16, paddingTop: 12 },
  captionContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  captionUsername: {
    fontSize: 14,
    fontWeight: '600',
    color: '#00ff88',
    marginRight: 6,
  },
  captionText: { fontSize: 14, color: '#fff', flex: 1 },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  locationText: { fontSize: 13, color: '#00ff88' },
  musicContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 8,
  },
  musicText: { fontSize: 13, color: '#00ff88' },
  timestamp: { fontSize: 12, color: '#666', marginTop: 4 },
  commentsSection: { padding: 16, paddingBottom: 100 },
  commentsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
  },
  noComments: { alignItems: 'center', paddingVertical: 40 },
  noCommentsText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 12,
  },
  noCommentsSubtext: { fontSize: 14, color: '#666', marginTop: 4 },
  commentItem: { flexDirection: 'row', marginBottom: 20 },
  commentAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 12,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#00ff88',
  },
  commentContent: { flex: 1 },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 8,
  },
  commentDisplayName: { fontSize: 14, fontWeight: '700', color: '#fff' },
  commentUsername: { fontSize: 13, fontWeight: '400', color: '#00ff88' },
  commentText: { fontSize: 14, color: '#fff', lineHeight: 20, marginBottom: 4 },
  commentTime: { fontSize: 12, color: '#666' },
  commentInputContainer: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    gap: 12,
    backgroundColor: '#0a0a0a',
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  commentInput: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    maxHeight: 100,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#333',
  },
  sendButton: { borderRadius: 24, overflow: 'hidden' },
  sendButtonGradient: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#00ff88',
    borderRadius: 24,
  },
  sendButtonDisabled: { backgroundColor: '#1a1a1a', opacity: 0.5 },
}); 
