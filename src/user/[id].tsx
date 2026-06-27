// app/user/[id].tsx - COMPLETE USER PROFILE SCREEN
// ✅ Post thumbnails now navigate to post/[id] detail screen
// ✅ Real-time like and comment counts fetched from likes/comments tables
// ✅ Follow/unfollow with notification
// ✅ Stats from actual follows table

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  ScrollView,
  Dimensions,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../config/supabase'; 
import { useAuthStore } from '../store/authStore'; 

const { width } = Dimensions.get('window');
const POST_SIZE = (width - 6) / 3;

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { user: currentUser } = useAuthStore();

  const [profile,       setProfile]       = useState<any>(null);
  const [stats,         setStats]         = useState({ posts: 0, followers: 0, following: 0 });
  const [posts,         setPosts]         = useState<any[]>([]);
  const [isFollowing,   setIsFollowing]   = useState(false);
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  useEffect(() => { loadAllData(); }, [id]);

  const loadAllData = async () => {
    await Promise.all([
      loadProfile(),
      loadStats(),
      loadPosts(),
      checkFollowStatus(),
    ]);
  };

  const loadProfile = async () => {
    try {
      const { data, error } = await supabase
        .from('users').select('*').eq('id', id).single();
      if (error) throw error;
      setProfile(data);
    } catch (error) {
      console.error('❌ Error loading profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const { count: postsCount }     = await supabase.from('posts').select('*', { count: 'exact', head: true }).eq('user_id', id);
      const { count: followersCount } = await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', id);
      const { count: followingCount } = await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', id);
      setStats({ posts: postsCount || 0, followers: followersCount || 0, following: followingCount || 0 });
    } catch (error) {
      console.error('❌ Error loading stats:', error);
    }
  };

  const loadPosts = async () => {
    try {
      const { data, error } = await supabase
        .from('posts')
        .select('id, media_url, media_type, caption, likes_count, comments_count, created_at')
        .eq('user_id', id)
        .order('created_at', { ascending: false });
      if (error) throw error;

      if (!data || data.length === 0) { setPosts([]); return; }

      // ✅ Fetch real-time like + comment counts from actual tables
      const enriched = await Promise.all(data.map(async (post: any) => {
        try {
          const [{ count: lc }, { count: cc }] = await Promise.all([
            supabase.from('likes').select('*', { count: 'exact', head: true }).eq('post_id', post.id),
            supabase.from('comments').select('*', { count: 'exact', head: true }).eq('post_id', post.id),
          ]);
          return {
            ...post,
            likes_count:    lc    ?? post.likes_count    ?? 0,
            comments_count: cc    ?? post.comments_count ?? 0,
          };
        } catch { return post; }
      }));
      setPosts(enriched);
    } catch (error) {
      console.error('❌ Error loading posts:', error);
    }
  };

  const checkFollowStatus = async () => {
    if (!currentUser?.id || currentUser.id === id) return;
    try {
      const { data } = await supabase
        .from('follows').select('*')
        .eq('follower_id', currentUser.id).eq('following_id', id).single();
      setIsFollowing(!!data);
    } catch { setIsFollowing(false); }
  };

  const handleFollow = async () => {
    if (!currentUser?.id) return;
    setFollowLoading(true);
    try {
      if (isFollowing) {
        await supabase.from('follows').delete()
          .eq('follower_id', currentUser.id).eq('following_id', id);
        setIsFollowing(false);
      } else {
        await supabase.from('follows').insert({
          follower_id:  currentUser.id,
          following_id: id,
        });
        // Notify the user
        await supabase.from('notifications').insert({
          user_id:      id,
          type:         'follow',
          from_user_id: currentUser.id,
          is_read:      false,
        });
        setIsFollowing(true);
      }
      await loadStats();
    } catch (error) {
      console.error('❌ Follow error:', error);
    } finally {
      setFollowLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAllData();
    setRefreshing(false);
  };

  const getAvatarUrl = (p: any): string | null => p?.avatar_url || p?.photo_url || null;

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Profile</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#00ff88" />
        </View>
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Profile</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.centerContainer}>
          <Ionicons name="person-remove" size={64} color="#666" />
          <Text style={styles.errorText}>User not found</Text>
        </View>
      </View>
    );
  }

  const isOwnProfile = currentUser?.id === id;
  const avatarUrl    = getAvatarUrl(profile);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>@{profile.username}</Text>
        <TouchableOpacity>
          <Ionicons name="ellipsis-vertical" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00ff88" />}
      >
        {/* Profile Header */}
        <View style={styles.profileSection}>
          <View style={styles.topRow}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Ionicons name="person" size={40} color="#00ff88" />
              </View>
            )}
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statNumber}>{stats.posts}</Text>
                <Text style={styles.statLabel}>Posts</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statNumber}>{stats.followers}</Text>
                <Text style={styles.statLabel}>Followers</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statNumber}>{stats.following}</Text>
                <Text style={styles.statLabel}>Following</Text>
              </View>
            </View>
          </View>

          <View style={styles.info}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.name}>{profile.display_name}</Text>
              {profile.is_premium && <Text style={{ fontSize: 16 }}>⭐</Text>}
            </View>
            {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
          </View>

          {!isOwnProfile && (
            <TouchableOpacity
              style={[styles.followButton, isFollowing && styles.followingButton]}
              onPress={handleFollow}
              disabled={followLoading}
            >
              {followLoading ? (
                <ActivityIndicator size="small" color={isFollowing ? '#fff' : '#000'} />
              ) : (
                <Text style={[styles.followButtonText, isFollowing && styles.followingButtonText]}>
                  {isFollowing ? 'Following' : 'Follow'}
                </Text>
              )}
            </TouchableOpacity>
          )}

          {/* If own profile — go to full profile */}
          {isOwnProfile && (
            <TouchableOpacity
              style={styles.editProfileBtn}
              onPress={() => router.push('/(tabs)/profile' as any)}
            >
              <Text style={styles.editProfileBtnText}>View My Profile</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Posts Grid */}
        <View style={styles.postsSection}>
          <Text style={styles.sectionTitle}>Posts</Text>
          {posts.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="images-outline" size={48} color="#666" />
              <Text style={styles.emptyText}>No posts yet</Text>
            </View>
          ) : (
            <View style={styles.postsGrid}>
              {posts.map((post) => {
                const isTextPost  = !post.media_url && post.caption;
                const isVoicePost = post.media_type === 'voice';

                return (
                  // ✅ KEY FIX: onPress now navigates to full post detail
                  <TouchableOpacity
                    key={post.id}
                    style={styles.postThumbnail}
                    onPress={() => router.push(`/post/${post.id}` as any)}
                    activeOpacity={0.8}
                  >
                    {isTextPost ? (
                      <View style={[styles.postThumbnailImage, styles.textPostThumb]}>
                        <Ionicons name="text" size={20} color="#fff" />
                        <Text style={styles.textPostThumbText} numberOfLines={3}>{post.caption}</Text>
                      </View>
                    ) : isVoicePost ? (
                      <View style={[styles.postThumbnailImage, styles.voicePostThumb]}>
                        <Ionicons name="mic" size={28} color="#00ff88" />
                        <Text style={styles.voicePostThumbText}>Voice</Text>
                      </View>
                    ) : (
                      <Image source={{ uri: post.media_url }} style={styles.postThumbnailImage} />
                    )}

                    {post.media_type === 'video' && (
                      <View style={styles.videoIndicator}>
                        <Ionicons name="play" size={22} color="#fff" />
                      </View>
                    )}

                    {/* ✅ Real-time counts shown on thumbnail */}
                    <View style={styles.postStats}>
                      <View style={styles.postStat}>
                        <Ionicons name="heart" size={11} color="#fff" />
                        <Text style={styles.postStatText}>{post.likes_count || 0}</Text>
                      </View>
                      <View style={styles.postStat}>
                        <Ionicons name="chatbubble" size={11} color="#fff" />
                        <Text style={styles.postStatText}>{post.comments_count || 0}</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container:           { flex: 1, backgroundColor: '#000' },
  header:              { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 15, borderBottomWidth: 1, borderBottomColor: '#222' },
  headerTitle:         { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  centerContainer:     { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText:           { color: '#666', fontSize: 16, marginTop: 15 },
  profileSection:      { padding: 20, borderBottomWidth: 1, borderBottomColor: '#222' },
  topRow:              { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  avatar:              { width: 80, height: 80, borderRadius: 40, marginRight: 20, borderWidth: 2, borderColor: '#00ff88' },
  avatarPlaceholder:   { backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  statsRow:            { flex: 1, flexDirection: 'row', justifyContent: 'space-around' },
  stat:                { alignItems: 'center' },
  statNumber:          { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  statLabel:           { color: '#999', fontSize: 12, marginTop: 2 },
  info:                { marginBottom: 15 },
  name:                { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 5 },
  bio:                 { color: '#ccc', fontSize: 14, lineHeight: 20 },
  followButton:        { backgroundColor: '#00ff88', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  followingButton:     { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333' },
  followButtonText:    { color: '#000', fontSize: 14, fontWeight: 'bold' },
  followingButtonText: { color: '#fff' },
  editProfileBtn:      { backgroundColor: '#1a1a1a', paddingVertical: 10, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  editProfileBtnText:  { color: '#fff', fontSize: 14, fontWeight: '600' },
  postsSection:        { padding: 15 },
  sectionTitle:        { color: '#fff', fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  emptyState:          { alignItems: 'center', paddingVertical: 60 },
  emptyText:           { color: '#666', fontSize: 14, marginTop: 10 },
  postsGrid:           { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  postThumbnail:       { width: POST_SIZE, height: POST_SIZE, position: 'relative' },
  postThumbnailImage:  { width: '100%', height: '100%' },
  textPostThumb:       { backgroundColor: '#1a1a6e', justifyContent: 'center', alignItems: 'center', padding: 8 },
  textPostThumbText:   { color: '#fff', fontSize: 10, textAlign: 'center', marginTop: 4 },
  voicePostThumb:      { backgroundColor: '#1a5f42', justifyContent: 'center', alignItems: 'center', gap: 4 },
  voicePostThumbText:  { color: '#00ff88', fontSize: 11, fontWeight: '600' },
  videoIndicator:      { position: 'absolute', top: 5, right: 5, zIndex: 1 },
  postStats:           { position: 'absolute', bottom: 4, left: 4, flexDirection: 'row', gap: 8 },
  postStat:            { flexDirection: 'row', alignItems: 'center', gap: 3 },
  postStatText:        { color: '#fff', fontSize: 10, fontWeight: 'bold', textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
}); 
