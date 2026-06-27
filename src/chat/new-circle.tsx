// app/chat/new-circle.tsx
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, SafeAreaView, StatusBar,
  ActivityIndicator, Alert, ScrollView,
  KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../config/supabase'; 
import { useAuthStore } from '../store/authStore'; 

const C = {
  black: '#000', card: '#1a1a1a', border: '#2a2a2a',
  green: '#00e676', white: '#fff', muted: '#888', muted2: '#555',
};

export default function NewCircleScreen() {
  const { user } = useAuthStore();
  const [name,        setName]        = useState('');
  const [description, setDescription] = useState('');
  const [isPublic,    setIsPublic]    = useState(true);
  const [creating,    setCreating]    = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) { Alert.alert('Required', 'Please enter a Circle name.'); return; }
    if (!user?.id) return;
    setCreating(true);
    try {
      const { data: circle, error } = await supabase
        .from('circles')
        .insert({
          name: name.trim(),
          description: description.trim() || null,
          owner_id: user.id,
          subscriber_count: 1,
          is_public: isPublic,
        })
        .select().single();
      if (error) throw error;
      await supabase.from('circle_subscribers').insert({
        circle_id: circle.id, user_id: user.id,
      });
      router.replace({ pathname: '/chat/circle/[id]', params: { id: circle.id } } as any);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to create Circle. Please try again.');
    } finally { setCreating(false); }
  };

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.black} />

      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={22} color={C.white} />
        </TouchableOpacity>
        <Text style={s.title}>New Circle</Text>
        <TouchableOpacity
          style={[s.createBtn, !name.trim() && { opacity: 0.4 }]}
          onPress={handleCreate}
          disabled={creating || !name.trim()}
        >
          {creating
            ? <ActivityIndicator size="small" color="#000" />
            : <Text style={s.createBtnText}>Create</Text>}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }} showsVerticalScrollIndicator={false}>

          <View style={s.previewRow}>
            <View style={s.circleIcon}>
              <Ionicons name="radio-outline" size={32} color={C.green} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.previewName}>{name || 'Your Circle Name'}</Text>
              <Text style={s.previewSub}>0 subscribers · by you</Text>
            </View>
          </View>

          <View style={s.fieldGroup}>
            <Text style={s.label}>CIRCLE NAME *</Text>
            <TextInput
              style={s.input} placeholder="e.g. Daily Tips, My Updates…"
              placeholderTextColor={C.muted2} value={name}
              onChangeText={setName} maxLength={50}
            />
          </View>

          <View style={s.fieldGroup}>
            <Text style={s.label}>DESCRIPTION</Text>
            <TextInput
              style={[s.input, { minHeight: 90, textAlignVertical: 'top' }]}
              placeholder="What will you share in this Circle?"
              placeholderTextColor={C.muted2} value={description}
              onChangeText={setDescription} maxLength={300} multiline
            />
          </View>

          <View style={s.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.toggleLabel}>Public Circle</Text>
              <Text style={s.toggleSub}>
                {isPublic ? 'Anyone can find and follow' : 'Only people you invite'}
              </Text>
            </View>
            <Switch
              value={isPublic} onValueChange={setIsPublic}
              trackColor={{ false: C.card, true: C.green }}
              thumbColor={C.white}
            />
          </View>

          <View style={s.infoCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Ionicons name="radio-outline" size={18} color={C.green} />
              <Text style={{ fontSize: 14, fontWeight: '700', color: C.green }}>What is a Circle?</Text>
            </View>
            <Text style={{ fontSize: 13, color: C.muted, lineHeight: 20 }}>
              Circles are broadcast channels — only you post, your subscribers read. Perfect for sharing updates or exclusive content with your audience.
            </Text>
          </View>

          <View style={{ height: 40 }} />
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
  previewRow:  { flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: C.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border },
  circleIcon:  { width: 66, height: 66, borderRadius: 33, backgroundColor: 'rgba(0,230,118,0.1)', borderWidth: 1.5, borderColor: C.green, alignItems: 'center', justifyContent: 'center' },
  previewName: { fontSize: 16, fontWeight: '700', color: C.white, marginBottom: 4 },
  previewSub:  { fontSize: 12, color: C.muted },
  fieldGroup:  { gap: 6 },
  label:       { fontSize: 10.5, fontWeight: '700', color: C.muted, letterSpacing: 0.8, textTransform: 'uppercase' },
  input:       { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: C.white, fontSize: 14 },
  toggleRow:   { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.border },
  toggleLabel: { fontSize: 14, fontWeight: '700', color: C.white, marginBottom: 3 },
  toggleSub:   { fontSize: 12, color: C.muted },
  infoCard:    { backgroundColor: '#0a140a', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: 'rgba(0,230,118,0.2)' },
}); 
