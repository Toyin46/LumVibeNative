// src/chat/new-group.tsx
//
// ✅ Removed dead `import { router } from 'expo-router'`.
// ✅ CRITICAL FIX: `useNavigation()` was at MODULE scope. Moved inside
//    NewGroupScreen().
// ✅ Fixed navigate() call using expo-router's object-style syntax —
//    converted to `navigate('GroupChat', { id: group.id })`.

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, StatusBar, Image, Switch,
  ActivityIndicator, Alert, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
// FIX: plain react-native's SafeAreaView is iOS-only (a no-op View on
// Android) — same bug already fixed in group/[id].tsx and circle/[id].tsx,
// just missed here. This is why the header was clipping under the status bar.
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../config/supabase';
import { useAuthStore } from '../store/authStore';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ChatStackParamList } from '../navigation/ChatStackTypes';

type NavProp = NativeStackNavigationProp<ChatStackParamList>;

const C = {
  black: '#000', card: '#1a1a1a', border: '#2a2a2a',
  green: '#00e676', white: '#fff', muted: '#888', muted2: '#555',
};

interface Friend {
  id: string; username: string; display_name: string; photo_url?: string;
}

export default function NewGroupScreen() {
  const navigation = useNavigation<NavProp>();
  const { user } = useAuthStore();
  const [groupName,   setGroupName]   = useState('');
  const [description, setDescription] = useState('');
  // NEW: public groups can be discovered and requested to join; private
  // groups can only ever be added to directly by an admin — same public/
  // private concept already used for Circles.
  const [isPublic, setIsPublic] = useState(true);
  const [search,      setSearch]      = useState('');
  const [friends,     setFriends]     = useState<Friend[]>([]);
  const [selected,    setSelected]    = useState<Friend[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [creating,    setCreating]    = useState(false);

  // FEATURE: New Group used to only ever show your accepted friends, so
  // with zero friends there was no one to pick and the screen looked
  // "broken." Typing 2+ characters now searches ALL platform users by
  // username/display name (like Telegram's "search everyone" fallback),
  // not just people you're already connected to.
  const [searchResults, setSearchResults] = useState<Friend[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { loadFriends(); }, []);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    const q = search.trim();
    if (q.length < 2) { setSearchResults([]); setSearchLoading(false); return; }
    setSearchLoading(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const { data } = await supabase
          .from('users')
          .select('id, username, display_name, photo_url')
          .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
          .neq('id', user?.id || '')
          .limit(20);
        setSearchResults(data || []);
      } catch (e) { console.error('searchAllUsers error:', e); }
      finally { setSearchLoading(false); }
    }, 350);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [search, user?.id]);

  const loadFriends = async () => {
    if (!user?.id) { setLoading(false); return; }
    try {
      const { data: requests } = await supabase
        .from('friend_requests')
        .select('from_user_id, to_user_id')
        .eq('status', 'accepted')
        .or(`from_user_id.eq.${user.id},to_user_id.eq.${user.id}`);
      if (!requests || requests.length === 0) { setLoading(false); return; }
      const friendIds = requests.map((r: any) =>
        r.from_user_id === user.id ? r.to_user_id : r.from_user_id
      );
      const { data: users } = await supabase
        .from('users').select('id, username, display_name, photo_url').in('id', friendIds);
      setFriends(users || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const toggleSelect = (friend: Friend) => {
    setSelected(prev =>
      prev.find(f => f.id === friend.id)
        ? prev.filter(f => f.id !== friend.id)
        : [...prev, friend]
    );
  };

  const handleCreate = async () => {
    if (!groupName.trim()) { Alert.alert('Required', 'Please enter a group name.'); return; }
    if (selected.length < 1) { Alert.alert('Add Members', 'Please add at least 1 friend.'); return; }
    if (!user?.id) return;
    setCreating(true);
    try {
      const { data: group, error } = await supabase
        .from('groups')
        .insert({
          name: groupName.trim(),
          description: description.trim() || null,
          created_by: user.id,
          member_count: selected.length + 1,
          is_public: isPublic,
        })
        .select().single();
      if (error) throw error;
      const memberRows = [user.id, ...selected.map(f => f.id)].map(uid => ({
        group_id: group.id, user_id: uid,
        role: uid === user.id ? 'admin' : 'member',
      }));
      await supabase.from('group_members').insert(memberRows);
      // FIX: was navigate(), which PUSHES GroupChat on top of this form —
      // so pressing back landed you right back on an empty "New Group"
      // form, looking exactly like your group had vanished. replace()
      // swaps this screen out instead, so back goes to wherever you were
      // BEFORE you opened this form.
      navigation.replace('GroupChat', { id: group.id });
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to create group. Please try again.');
    } finally { setCreating(false); }
  };

  // While searching (2+ chars), show platform-wide results; otherwise
  // fall back to the friends list filtered locally by name.
  const isSearchingAllUsers = search.trim().length >= 2;
  const filtered = isSearchingAllUsers
    ? searchResults
    : friends.filter(f =>
        !search || f.display_name?.toLowerCase().includes(search.toLowerCase())
      );

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.black} />

      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={22} color={C.white} />
        </TouchableOpacity>
        <Text style={s.title}>New Group</Text>
        <TouchableOpacity
          style={[s.createBtn, (!groupName.trim() || selected.length === 0) && { opacity: 0.4 }]}
          onPress={handleCreate}
          disabled={creating || !groupName.trim() || selected.length === 0}
        >
          {creating
            ? <ActivityIndicator size="small" color="#000" />
            : <Text style={s.createBtnText}>Create</Text>}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          <View style={s.inputSection}>
            <View style={s.groupIcon}>
              <Ionicons name="people-outline" size={30} color={C.green} />
            </View>
            <View style={{ flex: 1, gap: 10 }}>
              <TextInput
                style={s.input} placeholder="Group name *"
                placeholderTextColor={C.muted2} value={groupName}
                onChangeText={setGroupName} maxLength={50}
              />
              <TextInput
                style={s.input} placeholder="Description (optional)"
                placeholderTextColor={C.muted2} value={description}
                onChangeText={setDescription} maxLength={200}
              />
            </View>
          </View>

          <View style={s.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.toggleLabel}>Public Group</Text>
              <Text style={s.toggleSub}>
                {isPublic ? 'Anyone can find it and request to join' : 'Only admins can add people'}
              </Text>
            </View>
            <Switch
              value={isPublic} onValueChange={setIsPublic}
              trackColor={{ false: C.card, true: C.green }}
              thumbColor={C.white}
            />
          </View>

          {selected.length > 0 && (
            <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
              <Text style={s.label}>Added ({selected.length})</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 12, marginTop: 8 }}>
                {selected.map(f => (
                  <TouchableOpacity key={f.id} style={s.chip} onPress={() => toggleSelect(f)}>
                    <View style={s.chipAv}>
                      <Text style={{ color: C.green, fontWeight: '700' }}>
                        {(f.display_name || 'U')[0].toUpperCase()}
                      </Text>
                    </View>
                    <Text style={s.chipName} numberOfLines={1}>{f.display_name.split(' ')[0]}</Text>
                    <View style={s.chipX}>
                      <Ionicons name="close" size={10} color="#000" />
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          <View style={s.searchBar}>
            <Ionicons name="search-outline" size={15} color={C.muted} />
            <TextInput
              style={s.searchInput} placeholder="Search friends or find anyone…"
              placeholderTextColor={C.muted2} value={search} onChangeText={setSearch}
            />
          </View>

          <Text style={[s.label, { paddingHorizontal: 20, marginBottom: 8 }]}>
            {isSearchingAllUsers ? 'Search Results' : 'Friends'}
          </Text>

          {(isSearchingAllUsers ? searchLoading : loading)
            ? <ActivityIndicator color={C.green} style={{ marginTop: 40 }} />
            : filtered.length === 0
            ? <View style={{ alignItems: 'center', paddingTop: 50 }}>
                <Ionicons name="people-outline" size={48} color={C.border} />
                <Text style={{ color: C.muted, marginTop: 12, fontSize: 14 }}>
                  {isSearchingAllUsers ? 'No users found' : 'No friends yet — try searching a username above'}
                </Text>
              </View>
            : filtered.map(friend => {
                const isSelected = !!selected.find(f => f.id === friend.id);
                return (
                  <TouchableOpacity key={friend.id} style={s.friendRow}
                    onPress={() => toggleSelect(friend)} activeOpacity={0.7}>
                    {friend.photo_url
                      ? <Image source={{ uri: friend.photo_url }} style={s.friendAv} />
                      : <View style={[s.friendAv, s.friendAvFallback]}>
                          <Text style={{ color: C.green, fontSize: 16, fontWeight: '700' }}>
                            {(friend.display_name || 'U')[0].toUpperCase()}
                          </Text>
                        </View>}
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={s.friendName}>{friend.display_name}</Text>
                      <Text style={s.friendHandle}>@{friend.username}</Text>
                    </View>
                    <View style={[s.checkbox, isSelected && s.checkboxOn]}>
                      {isSelected && <Ionicons name="checkmark" size={14} color="#000" />}
                    </View>
                  </TouchableOpacity>
                );
              })}
          <View style={{ height: 60 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: C.black },
  header:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn:     { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title:       { flex: 1, fontSize: 17, fontWeight: '800', color: C.white, marginLeft: 4 },
  createBtn:   { backgroundColor: C.green, paddingVertical: 8, paddingHorizontal: 18, borderRadius: 20 },
  createBtnText: { fontSize: 13, fontWeight: '800', color: '#000' },
  inputSection:{ flexDirection: 'row', gap: 14, padding: 20, alignItems: 'flex-start' },
  groupIcon:   { width: 66, height: 66, borderRadius: 33, backgroundColor: 'rgba(0,230,118,0.1)', borderWidth: 1.5, borderColor: C.green, alignItems: 'center', justifyContent: 'center' },
  input:       { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: C.white, fontSize: 14 },
  label:       { fontSize: 11, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8 },
  searchBar:   { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderRadius: 28, paddingHorizontal: 14, marginHorizontal: 20, marginBottom: 16, borderWidth: 1, borderColor: C.border },
  searchInput: { flex: 1, color: C.white, fontSize: 14, paddingVertical: 10 },
  chip:        { alignItems: 'center', gap: 4, position: 'relative' },
  chipAv:      { width: 48, height: 48, borderRadius: 24, backgroundColor: '#1a2e1a', alignItems: 'center', justifyContent: 'center' },
  chipName:    { fontSize: 10, color: C.white, maxWidth: 52, textAlign: 'center' },
  chipX:       { position: 'absolute', top: 0, right: 0, width: 16, height: 16, borderRadius: 8, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  friendRow:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.border },
  friendAv:    { width: 48, height: 48, borderRadius: 24 },
  friendAvFallback: { backgroundColor: '#1a2e1a', alignItems: 'center', justifyContent: 'center' },
  friendName:  { fontSize: 14, fontWeight: '700', color: C.white },
  friendHandle:{ fontSize: 12, color: C.muted, marginTop: 2 },
  checkbox:    { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  checkboxOn:  { backgroundColor: C.green, borderColor: C.green },
  toggleRow:   { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.border, marginHorizontal: 20, marginBottom: 16 },
  toggleLabel: { fontSize: 14, fontWeight: '700', color: C.white, marginBottom: 3 },
  toggleSub:   { fontSize: 12, color: C.muted },
}); 
