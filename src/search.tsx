// app/search.tsx - PRODUCTION SEARCH SCREEN
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from './config/supabase'; 
import { router } from 'expo-router';
import { useAuthStore } from './store/authStore'; 

export default function SearchScreen() {
  const { user } = useAuthStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'users' | 'posts'>('users');

  useEffect(() => {
    if (searchQuery.trim()) {
      handleSearch();
    } else {
      setUsers([]);
      setPosts([]);
    }
  }, [searchQuery]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setSearching(true);
    try {
      // Search users
      const { data: usersData } = await supabase
        .from('users')
        .select('id, username, display_name, avatar_url, is_premium, is_verified')
        .or(`username.ilike.%${searchQuery}%,display_name.ilike.%${searchQuery}%`)
        .limit(20);

      setUsers(usersData || []);

      // Search posts by caption
      const { data: postsData } = await supabase
        .from('posts')
        .select(`
          *,
          user:users(id, username, display_name, avatar_url, is_premium)
        `)
        .ilike('caption', `%${searchQuery}%`)
        .order('created_at', { ascending: false })
        .limit(20);

      setPosts(postsData || []);
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setSearching(false);
    }
  };

  const navigateToProfile = (userId: string) => {
    if (userId === user?.id) {
      router.push('/(tabs)/profile');
    } else {
      router.push(`/user/${userId}`);
    }
  };

  const navigateToPost = (postId: string) => {
    router.push(`./post/${postId}`);
  };

  const renderUser = ({ item }: any) => (
    <TouchableOpacity style={s.userItem} onPress={() => navigateToProfile(item.id)}>
      {item.avatar_url ? (
        <Image source={{ uri: item.avatar_url }} style={s.avatar} />
      ) : (
        <View style={[s.avatar, s.avatarPlaceholder]}>
          <Feather name="user" size={24} color="#00ff88" />
        </View>
      )}
      <View style={s.userInfo}>
        <View style={s.nameRow}>
          <Text style={s.displayName}>{item.display_name}</Text>
          {item.is_verified && <Feather name="check-circle" size={16} color="#00ff88" />}
          {item.is_premium && <Text style={s.premiumBadge}>👑</Text>}
        </View>
        <Text style={s.username}>@{item.username}</Text>
      </View>
      <Feather name="chevron-right" size={20} color="#666" />
    </TouchableOpacity>
  );

  const renderPost = ({ item }: any) => (
    <TouchableOpacity style={s.postItem} onPress={() => navigateToPost(item.id)}>
      <Image source={{ uri: item.media_url }} style={s.postThumbnail} />
      <View style={s.postInfo}>
        <Text style={s.postCaption} numberOfLines={2}>
          {item.caption || 'No caption'}
        </Text>
        <View style={s.postStats}>
          <View style={s.statItem}>
            <Feather name="heart" size={14} color="#ff4d8f" />
            <Text style={s.statText}>{item.likes_count || 0}</Text>
          </View>
          <View style={s.statItem}>
            <Feather name="message-circle" size={14} color="#00ff88" />
            <Text style={s.statText}>{item.comments_count || 0}</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Search</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Search Input */}
      <View style={s.searchContainer}>
        <Feather name="search" size={20} color="#666" />
        <TextInput
          style={s.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search users or posts..."
          placeholderTextColor="#666"
          autoFocus
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Feather name="x" size={20} color="#666" />
          </TouchableOpacity>
        )}
      </View>

      {/* Tabs */}
      <View style={s.tabs}>
        <TouchableOpacity
          style={[s.tab, activeTab === 'users' && s.tabActive]}
          onPress={() => setActiveTab('users')}
        >
          <Text style={[s.tabText, activeTab === 'users' && s.tabTextActive]}>
            Users ({users.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tab, activeTab === 'posts' && s.tabActive]}
          onPress={() => setActiveTab('posts')}
        >
          <Text style={[s.tabText, activeTab === 'posts' && s.tabTextActive]}>
            Posts ({posts.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Results */}
      {searching ? (
        <View style={s.loadingContainer}>
          <ActivityIndicator size="large" color="#00ff88" />
          <Text style={s.loadingText}>Searching...</Text>
        </View>
      ) : searchQuery.trim() === '' ? (
        <View style={s.emptyState}>
          <Feather name="search" size={64} color="#333" />
          <Text style={s.emptyText}>Search for users or posts</Text>
        </View>
      ) : activeTab === 'users' && users.length === 0 ? (
        <View style={s.emptyState}>
          <Feather name="users" size={64} color="#333" />
          <Text style={s.emptyText}>No users found</Text>
        </View>
      ) : activeTab === 'posts' && posts.length === 0 ? (
        <View style={s.emptyState}>
          <Feather name="image" size={64} color="#333" />
          <Text style={s.emptyText}>No posts found</Text>
        </View>
      ) : (
        <FlatList
          data={activeTab === 'users' ? users : posts}
          renderItem={activeTab === 'users' ? renderUser : renderPost}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.listContent}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 15,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    marginHorizontal: 20,
    marginBottom: 15,
    paddingHorizontal: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#222',
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    paddingVertical: 12,
    marginLeft: 10,
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#222',
    marginHorizontal: 20,
  },
  tab: {
    flex: 1,
    paddingVertical: 15,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#00ff88',
  },
  tabText: {
    color: '#666',
    fontSize: 15,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#00ff88',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 15,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#111',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
  },
  avatarPlaceholder: {
    backgroundColor: '#111',
    justifyContent: 'center',
    alignItems: 'center',
  },
  userInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  displayName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  username: {
    color: '#999',
    fontSize: 14,
    marginTop: 2,
  },
  premiumBadge: {
    fontSize: 14,
  },
  postItem: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#111',
  },
  postThumbnail: {
    width: 80,
    height: 80,
    borderRadius: 8,
    marginRight: 12,
  },
  postInfo: {
    flex: 1,
    justifyContent: 'space-between',
  },
  postCaption: {
    color: '#fff',
    fontSize: 14,
    marginBottom: 8,
  },
  postStats: {
    flexDirection: 'row',
    gap: 15,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statText: {
    color: '#999',
    fontSize: 12,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    color: '#999',
    fontSize: 14,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  emptyText: {
    color: '#666',
    fontSize: 16,
    marginTop: 10,
  },
}); 
	
