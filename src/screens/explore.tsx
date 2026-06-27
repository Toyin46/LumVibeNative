// app/(tabs)/explore.tsx
// ✅ All original features preserved
// ✅ Translations added via useTranslation()

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, FlatList, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl, Dimensions, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuthStore } from '../store/authStore'; 
import { supabase } from '../config/supabase'; 
import { useRouter } from 'expo-router';
import { useTranslation } from '../locales/LanguageContext'; 

const { width } = Dimensions.get('window');
const GRID_ITEM_SIZE = (width - 32) / 3;

type TabType = 'discover' | 'trending' | 'users';

interface Post {
  id: string; user_id: string; username: string; display_name: string;
  user_photo_url?: string; media_url?: string; media_type?: string;
  caption: string; likes_count: number; comments_count: number;
  coins_received: number; created_at: string;
}

interface UserProfile {
  id: string; username: string; display_name: string; avatar_url?: string;
  followers_count: number; following_count: number; bio?: string;
  posts_count: number; isFollowing?: boolean;
}

export default function ExploreScreen() {
  const { user, userProfile } = useAuthStore();
  const { t } = useTranslation();
  const userId = user?.id || (user as any)?.id;
  const router  = useRouter();

  const [searchQuery,       setSearchQuery]       = useState('');
  const [activeTab,         setActiveTab]         = useState<TabType>('discover');
  const [loading,           setLoading]           = useState(false);
  const [refreshing,        setRefreshing]        = useState(false);
  const [allPosts,          setAllPosts]          = useState<Post[]>([]);
  const [searchPostResults, setSearchPostResults] = useState<Post[]>([]);
  const [searchUserResults, setSearchUserResults] = useState<UserProfile[]>([]);
  const [trendingPosts,     setTrendingPosts]     = useState<Post[]>([]);
  const [suggestedUsers,    setSuggestedUsers]    = useState<UserProfile[]>([]);
  const [searching,         setSearching]         = useState(false);
  const [followingUsers,    setFollowingUsers]    = useState<Set<string>>(new Set());
  const [headerCoins,       setHeaderCoins]       = useState(userProfile?.coins || 0);

  useEffect(() => {
    loadInitialData();
    if (userId) loadFollowingStatus();
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const loadCoins = async () => {
      try {
        const { data } = await supabase.from('users').select('coins').eq('id', userId).single();
        if (data?.coins !== undefined) setHeaderCoins(data.coins);
      } catch {}
    };
    loadCoins();
  }, [userId]);

  useEffect(() => {
    if (searchQuery.length > 0) {
      const timer = setTimeout(performSearch, 500);
      return () => clearTimeout(timer);
    } else {
      setSearchPostResults([]);
      setSearchUserResults([]);
      setSearching(false);
    }
  }, [searchQuery]);

  const loadFollowingStatus = async () => {
    if (!userId) return;
    try {
      const { data, error } = await supabase.from('follows').select('following_id').eq('follower_id', userId);
      if (error) throw error;
      setFollowingUsers(new Set(data.map((f: any) => f.following_id)));
    } catch (error) { console.error('Error loading following status:', error); }
  };

  const loadInitialData = async () => {
    setLoading(true);
    try {
      await Promise.all([loadAllPosts(), loadTrendingPosts(), loadSuggestedUsers()]);
    } catch (error) {
      console.error('Error loading explore data:', error);
      Alert.alert(t.errors.generic, t.errors.loadFailed);
    } finally { setLoading(false); }
  };

  const loadAllPosts = async () => {
    try {
      const { data, error } = await supabase.from('posts').select(`
          id, user_id, caption, media_url, media_type,
          likes_count, comments_count, coins_received, created_at,
          users!posts_user_id_fkey (username, display_name, avatar_url)
        `).or('is_published.is.null,is_published.eq.true').not('media_url', 'is', null)
        .order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      setAllPosts(formatPosts(data || []));
    } catch (error) { console.error('Error loading posts:', error); }
  };

  const loadTrendingPosts = async () => {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const { data, error } = await supabase.from('posts').select(`
          id, user_id, caption, media_url, media_type,
          likes_count, comments_count, coins_received, views_count, created_at,
          users!posts_user_id_fkey (username, display_name, avatar_url)
        `).or('is_published.is.null,is_published.eq.true').not('media_url', 'is', null)
        .gte('created_at', sevenDaysAgo.toISOString());
      if (error) throw error;
      const scored = (data || []).map((post: any) => ({
        ...formatPost(post),
        engagement_score: (post.likes_count || 0) * 3 + (post.comments_count || 0) * 5 +
          (post.views_count || 0) * 0.1 + (post.coins_received || 0) * 10,
      })).sort((a: any, b: any) => b.engagement_score - a.engagement_score).slice(0, 50);
      setTrendingPosts(scored);
    } catch (error) { console.error('Error loading trending:', error); }
  };

  const loadSuggestedUsers = async () => {
    try {
      const { data: usersData, error } = await supabase.from('users')
        .select('id, username, display_name, avatar_url, followers_count, following_count, bio')
        .neq('id', userId || '').order('followers_count', { ascending: false }).limit(50);
      if (error) throw error;
      if (!usersData || usersData.length === 0) { setSuggestedUsers([]); return; }
      const userIds = usersData.map((u: any) => u.id);
      const { data: postCounts } = await supabase.from('posts').select('user_id')
        .in('user_id', userIds).or('is_published.is.null,is_published.eq.true');
      const postCountMap = new Map<string, number>();
      (postCounts || []).forEach((p: any) => {
        postCountMap.set(p.user_id, (postCountMap.get(p.user_id) || 0) + 1);
      });
      const formatted: UserProfile[] = usersData.map((u: any) => ({
        id: u.id, username: u.username || 'unknown', display_name: u.display_name || 'Unknown',
        avatar_url: u.avatar_url, followers_count: u.followers_count || 0,
        following_count: u.following_count || 0, bio: u.bio,
        posts_count: postCountMap.get(u.id) || 0, isFollowing: followingUsers.has(u.id),
      }));
      const active = formatted.filter(u => u.posts_count > 0).sort((a, b) => {
        if (!a.isFollowing && b.isFollowing) return -1;
        if (a.isFollowing && !b.isFollowing) return 1;
        return b.followers_count - a.followers_count;
      });
      setSuggestedUsers(active);
    } catch (error) { console.error('Error loading users:', error); }
  };

  const performSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const term = searchQuery.toLowerCase().trim();
      const { data: usersData, error: usersError } = await supabase.from('users')
        .select('id, username, display_name, avatar_url, followers_count, bio')
        .or(`username.ilike.%${term}%,display_name.ilike.%${term}%`)
        .neq('id', userId || '').limit(20);
      if (usersError) throw usersError;
      const hydratedUsers: UserProfile[] = (usersData || []).map((u: any) => ({
        id: u.id, username: u.username || 'unknown', display_name: u.display_name || 'Unknown',
        avatar_url: u.avatar_url, followers_count: u.followers_count || 0,
        following_count: 0, bio: u.bio, posts_count: 0, isFollowing: followingUsers.has(u.id),
      }));
      setSearchUserResults(hydratedUsers);
      const { data: postsData, error: postsError } = await supabase.from('posts').select(`
          id, user_id, caption, media_url, media_type,
          likes_count, comments_count, coins_received, created_at,
          users!posts_user_id_fkey (username, display_name, avatar_url)
        `).or('is_published.is.null,is_published.eq.true').not('media_url', 'is', null)
        .ilike('caption', `%${term}%`).order('created_at', { ascending: false }).limit(60);
      if (postsError) throw postsError;
      setSearchPostResults(formatPosts(postsData || []));
    } catch (error) {
      console.error('Search error:', error);
      Alert.alert(t.errors.generic, t.errors.loadFailed);
    } finally { setSearching(false); }
  };

  const formatPost = (post: any): Post => ({
    id: post.id, user_id: post.user_id,
    username: post.users?.username || 'unknown',
    display_name: post.users?.display_name || 'Unknown User',
    user_photo_url: post.users?.avatar_url, media_url: post.media_url,
    media_type: post.media_type || 'image', caption: post.caption || '',
    likes_count: post.likes_count || 0, comments_count: post.comments_count || 0,
    coins_received: post.coins_received || 0, created_at: post.created_at,
  });
  const formatPosts = (data: any[]): Post[] => data.map(formatPost);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadInitialData();
    if (userId) await loadFollowingStatus();
    setRefreshing(false);
  };

  const handlePostPress = (post: Post) => { router.push(`/post/${post.id}` as any); };

  const handleUserPress = (targetUserId: string) => {
    if (targetUserId === userId) router.push('/(tabs)/profile' as any);
    else router.push(`/user/${targetUserId}` as any);
  };

  const handleFollowUser = async (targetUser: UserProfile) => {
    if (!userId) { Alert.alert(t.videos.loginRequired, t.videos.loginToFollow); return; }
    if (targetUser.id === userId) { Alert.alert(t.errors.generic, 'You cannot follow yourself'); return; }
    try {
      const isCurrentlyFollowing = followingUsers.has(targetUser.id);
      if (isCurrentlyFollowing) {
        const { error } = await supabase.from('follows').delete()
          .eq('follower_id', userId).eq('following_id', targetUser.id);
        if (error) throw error;
        const { data: ud } = await supabase.from('users').select('followers_count').eq('id', targetUser.id).single();
        await supabase.from('users').update({ followers_count: Math.max(0, (ud?.followers_count || 0) - 1) }).eq('id', targetUser.id);
        const { data: me } = await supabase.from('users').select('following_count').eq('id', userId).single();
        await supabase.from('users').update({ following_count: Math.max(0, (me?.following_count || 0) - 1) }).eq('id', userId);
        const newSet = new Set(followingUsers); newSet.delete(targetUser.id); setFollowingUsers(newSet);
        const updater = (u: UserProfile) => u.id === targetUser.id
          ? { ...u, followers_count: Math.max(0, u.followers_count - 1), isFollowing: false } : u;
        setSuggestedUsers(prev => prev.map(updater));
        setSearchUserResults(prev => prev.map(updater));
      } else {
        const { error } = await supabase.from('follows').insert({ follower_id: userId, following_id: targetUser.id });
        if (error) { if (error.code === '23505') return; throw error; }
        const { data: ud } = await supabase.from('users').select('followers_count').eq('id', targetUser.id).single();
        await supabase.from('users').update({ followers_count: (ud?.followers_count || 0) + 1 }).eq('id', targetUser.id);
        const { data: me } = await supabase.from('users').select('following_count').eq('id', userId).single();
        await supabase.from('users').update({ following_count: (me?.following_count || 0) + 1 }).eq('id', userId);
        try {
          await supabase.from('notifications').insert({
            user_id: targetUser.id, type: 'follow', title: 'New Follower',
            message: `@${userProfile?.username || 'Someone'} started following you`,
            from_user_id: userId, is_read: false,
          });
        } catch {}
        const newSet = new Set(followingUsers); newSet.add(targetUser.id); setFollowingUsers(newSet);
        const updater = (u: UserProfile) => u.id === targetUser.id
          ? { ...u, followers_count: u.followers_count + 1, isFollowing: true } : u;
        setSuggestedUsers(prev => prev.map(updater));
        setSearchUserResults(prev => prev.map(updater));
      }
    } catch (error: any) {
      console.error('Follow error:', error);
      Alert.alert(t.errors.generic, error.message || t.errors.generic);
    }
  };

  const renderGridPost = ({ item }: { item: Post }) => (
    <TouchableOpacity style={styles.gridItem} onPress={() => handlePostPress(item)} activeOpacity={0.8}>
      <Image source={{ uri: item.media_url }} style={styles.gridImage} resizeMode="cover" />
      {item.media_type === 'video' && (
        <View style={styles.videoIndicator}><Ionicons name="play" size={20} color="#00ff88" /></View>
      )}
      <View style={styles.gridOverlay}>
        <View style={styles.gridStats}>
          <Ionicons name="heart" size={14} color="#00ff88" />
          <Text style={styles.gridStatText}>{item.likes_count}</Text>
        </View>
        {item.coins_received > 0 && (
          <View style={styles.gridStats}>
            <MaterialCommunityIcons name="diamond" size={14} color="#ffd700" />
            <Text style={styles.gridCoinText}>{item.coins_received}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  const renderUserCard = ({ item }: { item: UserProfile }) => {
    const isFollowing = followingUsers.has(item.id);
    return (
      <TouchableOpacity style={styles.userCard} onPress={() => handleUserPress(item.id)} activeOpacity={0.8}>
        {item.avatar_url
          ? <Image source={{ uri: item.avatar_url }} style={styles.userAvatar} />
          : <View style={[styles.userAvatar, styles.avatarPlaceholder]}><Ionicons name="person" size={24} color="#00ff88" /></View>}
        <View style={styles.userInfo}>
          <Text style={styles.userDisplayName} numberOfLines={1}>{item.display_name}</Text>
          <Text style={styles.userUsername} numberOfLines={1}>@{item.username}</Text>
          {item.bio ? <Text style={styles.userBio} numberOfLines={1}>{item.bio}</Text> : null}
          <View style={styles.userStatsRow}>
            {item.posts_count > 0 && <Text style={styles.userStats}>{item.posts_count} {t.common.posts.toLowerCase()}</Text>}
            {item.posts_count > 0 && <Text style={styles.userStatsDot}>•</Text>}
            <Text style={styles.userStats}>{item.followers_count} {t.common.followers.toLowerCase()}</Text>
          </View>
        </View>
        <TouchableOpacity
          style={[styles.followButton, isFollowing && styles.followingButton]}
          onPress={() => handleFollowUser(item)}
        >
          <Text style={[styles.followButtonText, isFollowing && styles.followingButtonText]}>
            {isFollowing ? t.common.following : t.common.follow}
          </Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const renderEmptyState = (tab: TabType) => {
    const config = {
      discover: { icon: 'compass-outline',     title: t.feed.noContent,       sub: t.feed.noContentSub },
      trending: { icon: 'trending-up-outline',  title: t.explore.noResults,    sub: t.feed.noContentSub },
      users:    { icon: 'people-outline',        title: t.explore.noResults,    sub: t.explore.noResults },
    };
    const { icon, title, sub } = config[tab];
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name={icon as any} size={80} color="#333" />
        <Text style={styles.emptyTitle}>{title}</Text>
        <Text style={styles.emptySubtitle}>{sub}</Text>
      </View>
    );
  };

  const renderSearchResults = () => {
    const hasUsers = searchUserResults.length > 0;
    const hasPosts = searchPostResults.length > 0;
    if (!hasUsers && !hasPosts) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="search-outline" size={80} color="#333" />
          <Text style={styles.emptyTitle}>{t.explore.noResults} "{searchQuery}"</Text>
          <Text style={styles.emptySubtitle}>{t.explore.noResults}</Text>
        </View>
      );
    }
    const postRows: Post[][] = [];
    for (let i = 0; i < searchPostResults.length; i += 3) {
      postRows.push(searchPostResults.slice(i, i + 3));
    }
    return (
      <FlatList
        data={postRows}
        keyExtractor={(_, index) => `row-${index}`}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 20 }}
        ListHeaderComponent={
          <>
            {hasUsers && (
              <>
                <View style={styles.sectionHeader}>
                  <Ionicons name="people" size={16} color="#00ff88" />
                  <Text style={styles.sectionHeaderText}>
                    {t.common.followers} ({searchUserResults.length})
                  </Text>
                </View>
                {searchUserResults.map(u => (
                  <View key={u.id}>{renderUserCard({ item: u })}</View>
                ))}
              </>
            )}
            {hasPosts && (
              <View style={styles.sectionHeader}>
                <Ionicons name="images-outline" size={16} color="#00ff88" />
                <Text style={styles.sectionHeaderText}>
                  {t.common.posts} ({searchPostResults.length})
                </Text>
              </View>
            )}
          </>
        }
        renderItem={({ item: row }) => (
          <View style={styles.gridRow}>
            {row.map(post => (
              <TouchableOpacity key={post.id} style={styles.gridItem} onPress={() => handlePostPress(post)} activeOpacity={0.8}>
                <Image source={{ uri: post.media_url }} style={styles.gridImage} resizeMode="cover" />
                {post.media_type === 'video' && (
                  <View style={styles.videoIndicator}><Ionicons name="play" size={20} color="#00ff88" /></View>
                )}
                <View style={styles.gridOverlay}>
                  <View style={styles.gridStats}>
                    <Ionicons name="heart" size={14} color="#00ff88" />
                    <Text style={styles.gridStatText}>{post.likes_count}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
            {row.length < 3 && Array.from({ length: 3 - row.length }).map((_, i) => (
              <View key={`empty-${i}`} style={styles.gridItemEmpty} />
            ))}
          </View>
        )}
      />
    );
  };

  const currentPosts = activeTab === 'discover' ? allPosts : trendingPosts;
  const isSearching  = searchQuery.length > 0;

  if (loading) {
    return (
      <View style={styles.container}>
        <LinearGradient colors={['#000000', '#0a0a0a']} style={styles.header}>
          <Text style={styles.headerTitle}>{t.explore.title}</Text>
          <View style={styles.coinsHeader}>
            <MaterialCommunityIcons name="diamond" size={18} color="#ffd700" />
            <Text style={styles.coinsHeaderText}>{headerCoins}</Text>
          </View>
        </LinearGradient>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#00ff88" />
          <Text style={styles.loadingText}>{t.common.loading}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#000000', '#0a0a0a']} style={styles.header}>
        <Text style={styles.headerTitle}>{t.explore.title}</Text>
        <View style={styles.coinsHeader}>
          <MaterialCommunityIcons name="diamond" size={18} color="#ffd700" />
          <Text style={styles.coinsHeaderText}>{headerCoins}</Text>
        </View>
      </LinearGradient>

      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color="#00ff88" />
          <TextInput
            style={styles.searchInput}
            placeholder={t.explore.searchPlaceholder}
            placeholderTextColor="#666"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color="#00ff88" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {!isSearching && (
        <View style={styles.tabsContainer}>
          {(['discover', 'trending', 'users'] as TabType[]).map(tab => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && styles.tabActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Ionicons
                name={tab === 'discover' ? 'compass' : tab === 'trending' ? 'trending-up' : 'people'}
                size={20}
                color={activeTab === tab ? '#00ff88' : '#666'}
              />
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                {tab === 'discover' ? t.explore.title
                  : tab === 'trending' ? t.explore.trending
                  : t.common.followers}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {searching ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#00ff88" />
          <Text style={styles.loadingText}>{t.common.loading}</Text>
        </View>
      ) : isSearching ? (
        renderSearchResults()
      ) : activeTab === 'users' ? (
        suggestedUsers.length === 0
          ? renderEmptyState('users')
          : <FlatList
              key="user-list"
              data={suggestedUsers}
              renderItem={renderUserCard}
              keyExtractor={item => item.id}
              contentContainerStyle={styles.userListContainer}
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00ff88" />}
            />
      ) : (
        currentPosts.length === 0
          ? renderEmptyState(activeTab)
          : <FlatList
              key="grid-view"
              data={currentPosts}
              renderItem={renderGridPost}
              keyExtractor={item => item.id}
              numColumns={3}
              columnWrapperStyle={styles.gridRow}
              contentContainerStyle={styles.gridContainer}
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00ff88" />}
            />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#000' },
  header:             { paddingTop: 50, paddingBottom: 16, paddingHorizontal: 24, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  headerTitle:        { fontSize: 28, fontWeight: 'bold', color: '#00ff88' },
  coinsHeader:        { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, gap: 6, borderWidth: 1, borderColor: '#00ff88' },
  coinsHeaderText:    { color: '#00ff88', fontWeight: 'bold', fontSize: 14 },
  searchContainer:    { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#000' },
  searchBar:          { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, gap: 12, borderWidth: 1, borderColor: '#333' },
  searchInput:        { flex: 1, fontSize: 15, color: '#fff' },
  tabsContainer:      { flexDirection: 'row', backgroundColor: '#000', paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
  tab:                { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 12, gap: 6, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333' },
  tabActive:          { backgroundColor: 'rgba(0,255,136,0.1)', borderColor: '#00ff88' },
  tabText:            { fontSize: 14, fontWeight: '600', color: '#666' },
  tabTextActive:      { color: '#00ff88' },
  centerContainer:    { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  loadingText:        { marginTop: 12, fontSize: 16, color: '#666' },
  emptyContainer:     { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40, backgroundColor: '#000' },
  emptyTitle:         { fontSize: 20, fontWeight: 'bold', color: '#fff', marginTop: 16 },
  emptySubtitle:      { fontSize: 14, color: '#666', marginTop: 8, textAlign: 'center' },
  sectionHeader:      { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#000', borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  sectionHeaderText:  { color: '#00ff88', fontSize: 14, fontWeight: '700' },
  gridContainer:      { padding: 12, backgroundColor: '#000' },
  gridRow:            { gap: 4, marginBottom: 4 },
  gridItem:           { width: GRID_ITEM_SIZE, height: GRID_ITEM_SIZE, borderRadius: 8, overflow: 'hidden', backgroundColor: '#1a1a1a', position: 'relative', borderWidth: 0.5, borderColor: '#333' },
  gridItemEmpty:      { width: GRID_ITEM_SIZE, height: GRID_ITEM_SIZE },
  gridImage:          { width: '100%', height: '100%' },
  videoIndicator:     { position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 12, padding: 4 },
  gridOverlay:        { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 6, backgroundColor: 'rgba(0,0,0,0.7)', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  gridStats:          { flexDirection: 'row', alignItems: 'center', gap: 4 },
  gridStatText:       { color: '#00ff88', fontSize: 11, fontWeight: '600' },
  gridCoinText:       { color: '#ffd700', fontSize: 11, fontWeight: '600' },
  userListContainer:  { padding: 16, backgroundColor: '#000' },
  userCard:           { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0a0a0a', padding: 16, borderRadius: 16, marginBottom: 12, gap: 12, borderWidth: 1, borderColor: '#1a1a1a' },
  userAvatar:         { width: 56, height: 56, borderRadius: 28, backgroundColor: '#1a1a1a', borderWidth: 2, borderColor: '#00ff88' },
  avatarPlaceholder:  { justifyContent: 'center', alignItems: 'center' },
  userInfo:           { flex: 1 },
  userDisplayName:    { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 2 },
  userUsername:       { fontSize: 14, color: '#00ff88', marginBottom: 4 },
  userBio:            { fontSize: 13, color: '#999', marginBottom: 6 },
  userStatsRow:       { flexDirection: 'row', alignItems: 'center', gap: 6 },
  userStats:          { fontSize: 12, color: '#666' },
  userStatsDot:       { fontSize: 12, color: '#666' },
  followButton:       { backgroundColor: '#00ff88', paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, minWidth: 90, alignItems: 'center' },
  followingButton:    { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#00ff88' },
  followButtonText:   { color: '#000', fontSize: 14, fontWeight: '600' },
  followingButtonText:{ color: '#00ff88' },
}); 
