// src/status/StatusStrip.tsx
//
// The "Status" row at the top of the Messages screen: My status first, then
// friends / people you follow who have a status you may see.
import React, { useCallback, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../store/authStore';
import { fetchStatusFeed, StatusPerson } from './statusApi';

const GREEN = '#00ff88';

function Bubble({ uri, letter, ring, size = 54 }: { uri?: string | null; letter: string; ring: string; size?: number }) {
  const outer = size + 10;
  return (
    <View style={{ width: outer, height: outer, borderRadius: outer / 2, borderWidth: ring === 'transparent' ? 0 : 2.5, borderColor: ring, alignItems: 'center', justifyContent: 'center' }}>
      {uri
        ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#111' }} />
        : <View style={[styles.ph, { width: size, height: size, borderRadius: size / 2 }]}>
            <Text style={{ color: GREEN, fontWeight: '800', fontSize: size * 0.4 }}>{letter}</Text>
          </View>}
    </View>
  );
}

export default function StatusStrip() {
  const navigation = useNavigation<any>();
  const { user, userProfile } = useAuthStore();
  const [people, setPeople] = useState<StatusPerson[]>([]);

  useFocusEffect(useCallback(() => {
    let dead = false;
    fetchStatusFeed().then(list => { if (!dead) setPeople(list); });
    return () => { dead = true; };
  }, []));

  const me     = people.find(p => p.is_me);
  const others = people.filter(p => !p.is_me);
  const myPic  = (userProfile as any)?.avatar_url || (userProfile as any)?.photo_url || null;
  const myLetter = String((userProfile as any)?.username || (userProfile as any)?.display_name || 'U').charAt(0).toUpperCase();

  const open = (p: StatusPerson) =>
    navigation.navigate('StatusViewer', { userId: p.user_id, name: p.display_name || p.username, avatar: p.avatar_url || '' });

  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {/* My status */}
        <TouchableOpacity style={styles.item} activeOpacity={0.85}
          onPress={() => me && user ? navigation.navigate('StatusViewer', { userId: user.id, name: 'My status', avatar: myPic || '' }) : navigation.navigate('AddStatus')}
          onLongPress={() => navigation.navigate('MyStatus')}>
          <View>
            <Bubble uri={myPic} letter={myLetter} ring={me ? GREEN : 'transparent'} />
            <TouchableOpacity style={styles.plus} onPress={() => navigation.navigate('AddStatus')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="add" size={16} color="#000" />
            </TouchableOpacity>
          </View>
          <Text style={styles.name} numberOfLines={1}>My status</Text>
        </TouchableOpacity>

        {others.map(p => (
          <TouchableOpacity key={p.user_id} style={styles.item} activeOpacity={0.85} onPress={() => open(p)}>
            <Bubble uri={p.avatar_url} letter={String(p.username || p.display_name || 'U').charAt(0).toUpperCase()} ring={p.has_unseen ? GREEN : '#5a5a5a'} />
            <Text style={styles.name} numberOfLines={1}>{p.display_name || p.username}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: 8 },
  row: { paddingHorizontal: 16, gap: 14 },
  item: { width: 72, alignItems: 'center' },
  name: { color: '#cfcfcf', fontSize: 11.5, marginTop: 4, maxWidth: 72 },
  ph: { backgroundColor: '#0b1f14', borderWidth: 1.5, borderColor: GREEN, alignItems: 'center', justifyContent: 'center' },
  plus: { position: 'absolute', right: 0, bottom: 0, width: 22, height: 22, borderRadius: 11, backgroundColor: GREEN, borderWidth: 2, borderColor: '#000', alignItems: 'center', justifyContent: 'center' },
});
