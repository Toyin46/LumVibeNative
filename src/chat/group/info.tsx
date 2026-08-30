// src/chat/group/info.tsx
//
// Real Group Info & member management — replaces the "Coming soon" alert
// that used to fire from the ⓘ button in group/[id].tsx.

import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Image,
  StyleSheet, StatusBar, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ChatStackParamList } from '../../navigation/ChatStackTypes';
import { supabase } from '../../config/supabase';
import { useAuthStore } from '../../store/authStore';
import ContextStoryBar from '../components/ContextStoryBar';

type NavProp = NativeStackNavigationProp<ChatStackParamList>;

const C = {
  black: '#000', card: '#1a1a1a', border: '#2a2a2a',
  green: '#00e676', greenBg: 'rgba(0,230,118,0.12)',
  white: '#fff', muted: '#888', red: '#e53935',
};

interface Member {
  user_id: string; role: string;
  username: string; display_name: string; photo_url: string | null;
}

export default function GroupInfoScreen() {
  const navigation = useNavigation<NavProp>();
  const route = useRoute() as any;
  const { id } = route.params as { id: string };
  const { user } = useAuthStore();

  const [groupName, setGroupName] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [leaving, setLeaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: group } = await supabase.from('groups').select('name').eq('id', id).single();
      setGroupName(group?.name || 'Group');

      const { data: memberRows } = await supabase
        .from('group_members').select('user_id, role').eq('group_id', id);
      if (!memberRows || memberRows.length === 0) { setMembers([]); return; }

      const userIds = memberRows.map(m => m.user_id);
      const { data: profiles } = await supabase
        .from('users').select('id, username, display_name, photo_url').in('id', userIds);
      const profileById: Record<string, any> = {};
      (profiles || []).forEach(p => { profileById[p.id] = p; });

      setMembers(memberRows.map(m => ({
        user_id: m.user_id,
        role: m.role,
        username: profileById[m.user_id]?.username || '',
        display_name: profileById[m.user_id]?.display_name || profileById[m.user_id]?.username || 'User',
        photo_url: profileById[m.user_id]?.photo_url || null,
      })));
    } catch (e) {
      console.error('GroupInfo load error:', e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Reload on focus — same reasoning as chat/index.tsx and messages.tsx:
  // membership can change (leave/add) while this screen sits in the stack.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openMember = (member: Member) => {
    // FIX: found the real route — RootStackParamList already has
    // UserProfile: { userId?: string } | undefined. It's on the root
    // navigator, not this nested ChatStack, but navigation.navigate()
    // automatically climbs up to find it, same as the 'Explore' tab
    // navigation already used elsewhere in this app.
    if (member.user_id === user?.id) {
      navigation.navigate('Profile' as never);
    } else {
      (navigation as any).navigate('UserProfile', { userId: member.user_id });
    }
  };

  const handleLeaveGroup = () => {
    Alert.alert(
      'Leave Group',
      `Leave "${groupName}"? You won't receive messages from this group anymore.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave', style: 'destructive', onPress: async () => {
            if (!user?.id) return;
            setLeaving(true);
            const { error } = await supabase
              .from('group_members').delete().eq('group_id', id).eq('user_id', user.id);
            setLeaving(false);
            if (error) { Alert.alert('Error', error.message); return; }
            navigation.navigate('MessagesHome' as never);
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.black} />
        <ActivityIndicator color={C.green} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.black} />

      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color={C.white} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Group Info</Text>
        <TouchableOpacity
          onPress={() => (navigation as any).navigate('Story', {
            contextType: 'group', contextId: id, contextLabel: groupName || 'this group',
          })}
        >
          <Ionicons name="add-circle-outline" size={24} color={C.green} />
        </TouchableOpacity>
      </View>

      <View style={s.groupHeader}>
        <View style={s.groupIcon}>
          <Ionicons name="people" size={32} color={C.green} />
        </View>
        <Text style={s.groupName}>{groupName}</Text>
        <Text style={s.memberCount}>{members.length} member{members.length !== 1 ? 's' : ''}</Text>
      </View>

      <ContextStoryBar contextType="group" contextId={id} currentUserId={user?.id} />

      <Text style={s.sectionLabel}>MEMBERS</Text>
      <FlatList
        data={members}
        keyExtractor={(m) => m.user_id}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.memberRow} onPress={() => openMember(item)} activeOpacity={0.7}>
            {item.photo_url
              ? <Image source={{ uri: item.photo_url }} style={s.avatar} />
              : (
                <View style={[s.avatar, s.avatarPlaceholder]}>
                  <Text style={s.avatarLetter}>{item.display_name[0]?.toUpperCase()}</Text>
                </View>
              )}
            <View style={{ flex: 1 }}>
              <Text style={s.memberName}>
                {item.display_name}{item.user_id === user?.id ? ' (You)' : ''}
              </Text>
              {!!item.username && <Text style={s.memberUsername}>@{item.username}</Text>}
            </View>
            {item.role === 'admin' && (
              <View style={s.adminBadge}><Text style={s.adminBadgeText}>Admin</Text></View>
            )}
          </TouchableOpacity>
        )}
      />

      <TouchableOpacity style={s.leaveBtn} onPress={handleLeaveGroup} disabled={leaving}>
        {leaving
          ? <ActivityIndicator color={C.red} size="small" />
          : (
            <>
              <Ionicons name="exit-outline" size={18} color={C.red} />
              <Text style={s.leaveText}>Leave Group</Text>
            </>
          )}
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.black },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerTitle: { color: C.white, fontSize: 16, fontWeight: '700' },
  groupHeader: { alignItems: 'center', paddingVertical: 24, borderBottomWidth: 1, borderBottomColor: C.border },
  groupIcon: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: C.greenBg,
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  groupName: { color: C.white, fontSize: 18, fontWeight: '700' },
  memberCount: { color: C.muted, fontSize: 13, marginTop: 2 },
  sectionLabel: { color: C.muted, fontSize: 12, fontWeight: '600', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarPlaceholder: { backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { color: C.green, fontSize: 16, fontWeight: '700' },
  memberName: { color: C.white, fontSize: 14, fontWeight: '600' },
  memberUsername: { color: C.muted, fontSize: 12, marginTop: 1 },
  adminBadge: { backgroundColor: C.greenBg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  adminBadgeText: { color: C.green, fontSize: 10, fontWeight: '700' },
  leaveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 16, borderTopWidth: 1, borderTopColor: C.border,
  },
  leaveText: { color: C.red, fontSize: 14, fontWeight: '600' },
});
