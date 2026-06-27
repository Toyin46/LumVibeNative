// app/chat/new-group.tsx
import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, SafeAreaView, StatusBar, Image,
  ActivityIndicator, Alert, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../config/supabase';
import { useAuthStore } from '../store/authStore';

const C = {
  black: '#000', card: '#1a1a1a', border: '#2a2a2a',
  green: '#00e676', white: '#fff', muted: '#888', muted2: '#555',
};

interface Friend {
  id: string; username: string; display_name: string; photo_url?: string;
}

export default function NewGroupScreen() {
  const { user } = useAuthStore();
  const [groupName,   setGroupName]   = useState('');
  const [description, setDescription] = useState('');
  const [search,      setSearch]      = useState('');
  const [friends,     setFriends]     = useState<Friend[]>([]);
  const [selected,    setSelected]    = useState<Friend[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [creating,    setCreating]    = useState(false);

  useEffect(() => { loadFriends(); }, []);

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
        })
        .select().single();
      if (error) throw error;
      const memberRows = [user.id, ...selected.map(f => f.id)].map(uid => ({
        group_id: group.id, user_id: uid,
        role: uid === user.id ? 'admin' : 'member',
      }));
      await supabase.from('group_members').insert(memberRows);
      router.replace({ pathname: '/chat/group/[id]', params: { id: group.id } } as any);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to create group. Please try again.');
    } finally { setCreating(false); }
  };

  const filtered = friends.filter(f =>
    !search || f.display_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.black} />

      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
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
              style={s.searchInput} placeholder="Search friends…"
              placeholderTextColor={C.muted2} value={search} onChangeText={setSearch}
            />
          </View>

          <Text style={[s.label, { paddingHorizontal: 20, marginBottom: 8 }]}>Friends</Text>

          {loading
            ? <ActivityIndicator color={C.green} style={{ marginTop: 40 }} />
            : filtered.length === 0
            ? <View style={{ alignItems: 'center', paddingTop: 50 }}>
                <Ionicons name="people-outline" size={48} color={C.border} />
                <Text style={{ color: C.muted, marginTop: 12, fontSize: 14 }}>
                  {search ? 'No friends match your search' : 'No friends yet'}
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
}); 
