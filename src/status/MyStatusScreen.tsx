// src/status/MyStatusScreen.tsx
//
// "My status" list (like WhatsApp): every status I have posted in the last 24 h,
// how many people viewed it, who can see it, and buttons to add a new one.
// Route: MyStatus
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, RefreshControl,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../config/supabase';
import { useAuthStore } from '../store/authStore';
import { StatusItem, deleteStatus, fetchUserStatuses, setStatusVisibility, statusThumb, statusTimeLabel } from './statusApi';

const GREEN = '#00ff88';
const BG_COLORS = ['#128c7e', '#075e54', '#6a1b9a', '#c2185b', '#e65100', '#1565c0', '#37474f', '#000000'];

export default function MyStatusScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();
  const [items, setItems]       = useState<StatusItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRef]    = useState(false);

  const [textOpen, setTextOpen]   = useState(false);
  const [text, setText]           = useState('');
  const [color, setColor]         = useState(BG_COLORS[0]);
  const [vis, setVis]             = useState<'friends' | 'public'>('public');
  const [posting, setPosting]     = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setItems(await fetchUserStatuses(user.id).then(l => [...l].reverse()));   // newest first
    setLoading(false); setRef(false);
  }, [user?.id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const rowMenu = (s: StatusItem) => {
    Alert.alert('Status', undefined, [
      { text: s.visibility === 'public' ? 'Make Friends only' : 'Make Public', onPress: async () => {
          const ok = await setStatusVisibility(s.id, s.visibility === 'public' ? 'friends' : 'public');
          if (ok) load(); else Alert.alert('Could not change', 'Please try again.');
      } },
      { text: 'Delete', style: 'destructive', onPress: () => Alert.alert('Delete this status?', 'It will disappear for everyone.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: async () => { if (await deleteStatus(s.id)) load(); } },
      ]) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const postText = async () => {
    const t = text.trim();
    if (!t || !user?.id || posting) return;
    setPosting(true);
    const { error } = await supabase.from('stories').insert({
      user_id: user.id, media_url: '', media_type: 'text', text_content: t, bg_color: color, visibility: vis,
    });
    setPosting(false);
    if (error) { Alert.alert('Could not post', error.message); return; }
    Keyboard.dismiss(); setTextOpen(false); setText(''); load();
  };

  const renderItem = ({ item }: { item: StatusItem }) => {
    const thumb = statusThumb(item);
    return (
      <TouchableOpacity style={styles.row} activeOpacity={0.8}
        onPress={() => navigation.navigate('StatusViewer', { userId: user!.id, startStoryId: item.id, name: 'My status' })}>
        <View style={styles.ring}>
          {thumb
            ? <Image source={{ uri: thumb }} style={styles.thumb} />
            : <View style={[styles.thumb, { backgroundColor: item.bg_color || '#128c7e', alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }} numberOfLines={1}>Aa</Text>
              </View>}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.views}>{item.view_count} {item.view_count === 1 ? 'view' : 'views'}{item.gift_total > 0 ? `  ·  🎁 ${item.gift_total}` : ''}</Text>
          <Text style={styles.time}>{statusTimeLabel(item.created_at)}  ·  {item.visibility === 'public' ? '🌍 Public' : '🔒 Friends'}</Text>
        </View>
        <TouchableOpacity onPress={() => rowMenu(item)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="ellipsis-vertical" size={22} color="#9aa0a6" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={26} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>My status</Text>
      </View>

      {loading ? <ActivityIndicator color={GREEN} style={{ marginTop: 40 }} /> : (
        <FlatList
          data={items} keyExtractor={s => s.id} renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRef(true); load(); }} tintColor={GREEN} />}
          ListEmptyComponent={
            <View style={{ padding: 30, alignItems: 'center' }}>
              <Text style={styles.emptyTitle}>No status yet</Text>
              <Text style={styles.emptySub}>Tap the camera to share a photo or video, or the pencil to write one.</Text>
            </View>}
          ListFooterComponent={
            <Text style={styles.foot}>🔒 Friends-only statuses are private. Public ones can be seen by friends, followers and people who open your profile. All status updates disappear after 24 hours.</Text>}
        />
      )}

      <View style={styles.fabs}>
        <TouchableOpacity style={styles.fabSmall} onPress={() => setTextOpen(true)}>
          <Ionicons name="pencil" size={22} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate('Story')}>
          <Ionicons name="camera" size={26} color="#000" />
        </TouchableOpacity>
      </View>

      {/* write a text status */}
      <Modal visible={textOpen} animationType="slide" onRequestClose={() => setTextOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <SafeAreaView style={{ flex: 1 }}>
            <View style={styles.tHead}>
              <TouchableOpacity onPress={() => setTextOpen(false)}><Ionicons name="close" size={28} color="#fff" /></TouchableOpacity>
              <TouchableOpacity style={styles.vis} onPress={() => setVis(v => v === 'public' ? 'friends' : 'public')}>
                <Ionicons name={vis === 'public' ? 'earth' : 'lock-closed'} size={16} color="#fff" />
                <Text style={styles.visText}>{vis === 'public' ? 'Public' : 'Friends only'}</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 26 }}>
              <TextInput style={styles.tInput} value={text} onChangeText={setText} multiline autoFocus maxLength={400}
                placeholder="Type a status" placeholderTextColor="rgba(255,255,255,0.55)" textAlign="center" />
            </View>
            <View style={styles.tBar}>
              <View style={{ flexDirection: 'row', gap: 8, flex: 1, flexWrap: 'wrap' }}>
                {BG_COLORS.map(c => (
                  <TouchableOpacity key={c} onPress={() => setColor(c)} style={[styles.swatch, { backgroundColor: c }, c === color && { borderColor: '#fff' }]} />
                ))}
              </View>
              <TouchableOpacity style={[styles.send, !text.trim() && { opacity: 0.5 }]} disabled={!text.trim() || posting} onPress={postText}>
                {posting ? <ActivityIndicator color="#000" /> : <Ionicons name="send" size={22} color="#000" />}
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0f12' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1b2126' },
  title: { color: '#fff', fontSize: 22, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#141a1e' },
  ring: { width: 64, height: 64, borderRadius: 32, borderWidth: 2.5, borderColor: GREEN, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#1a1a1a' },
  views: { color: '#fff', fontSize: 17, fontWeight: '600' },
  time: { color: '#8a8f93', fontSize: 14, marginTop: 2 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  emptySub: { color: '#8a8f93', fontSize: 14, textAlign: 'center', marginTop: 6, lineHeight: 20 },
  foot: { color: '#7d848a', fontSize: 12.5, textAlign: 'center', padding: 22, lineHeight: 18 },
  fabs: { position: 'absolute', right: 18, bottom: 26, alignItems: 'center', gap: 14 },
  fabSmall: { width: 50, height: 50, borderRadius: 16, backgroundColor: '#1f272c', alignItems: 'center', justifyContent: 'center' },
  fab: { width: 62, height: 62, borderRadius: 20, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' },
  tHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  vis: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.3)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18 },
  visText: { color: '#fff', fontWeight: '700', fontSize: 13.5 },
  tInput: { color: '#fff', fontSize: 30, fontWeight: '700', textAlign: 'center', maxHeight: 360 },
  tBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: 'transparent' },
  send: { width: 54, height: 54, borderRadius: 27, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' },
});
