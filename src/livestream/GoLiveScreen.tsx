// ═══════════════════════════════════════════════════════════════════
// GoLiveScreen.tsx — LumVibe Pre-Stream Setup Screen
// Fixed for react-native-vision-camera v5
// ═══════════════════════════════════════════════════════════════════

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Feather } from '@expo/vector-icons';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { supabase } from '../config/supabase';
import { useAuthStore } from '../store/authStore';

// ─── TYPES ─────────────────────────────────────────────────────────

type RootStackParamList = {
  LiveHost: {
    sessionId: string;
    roomName: string;
    title: string;
    category: string;
    lkToken: string;
  };
};

const CATEGORIES = [
  'Music', 'Gaming', 'Cooking', 'Beauty', 'Education',
  'Fitness', 'Art', 'Chatting', 'Comedy', 'Travel', 'Tech', 'Inspiration',
];

const C = {
  g: '#00ff88', dk: '#000000', wh: '#ffffff', rd: '#ff4444',
  go: '#ffd700', cd: 'rgba(0,0,0,0.6)', bg: '#0a0a0a', card: '#141414',
};

// ─── COMPONENT ─────────────────────────────────────────────────────

export default function GoLiveScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { user, userProfile } = useAuthStore();

  // ─── VISION CAMERA V5 API ────────────────────────────────────────
  // WHY: v5 replaced useCameraDevices() with useCameraDevice(position)
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');

  // ─── STATE ───────────────────────────────────────────────────────
  const [title, setTitle] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Music');
  const [isPrivate, setIsPrivate] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [prophecyQuestion, setProphecyQuestion] = useState('');
  const [prophecyOptionA, setProphecyOptionA] = useState('True');
  const [prophecyOptionB, setProphecyOptionB] = useState('False');
  const [addProphecy, setAddProphecy] = useState(false);

  // ─── EFFECTS ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, []);

  // ─── HANDLERS ────────────────────────────────────────────────────

  const handleGoLive = async () => {
    if (!title.trim()) {
      Alert.alert('Missing Title', 'Please enter a stream title before going live.');
      return;
    }
    if (!user?.id) {
      Alert.alert('Not Logged In', 'Please log in to go live.');
      return;
    }

    setIsLoading(true);

    try {
      const roomName = `lumvibe_${user.id}_${Date.now()}`;

      // 1. Create livestream record
      const { data: streamData, error: streamError } = await supabase
        .from('livestreams')
        .insert({
          host_id: user.id,
          title: title.trim(),
          category: selectedCategory,
          status: 'live',
          viewer_count: 0,
          livekit_room_name: roomName,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (streamError) throw streamError;

      // 2. Save prophecy if added
      if (addProphecy && prophecyQuestion.trim()) {
        await supabase.from('live_predictions').insert({
          stream_id: streamData.id,
          question: prophecyQuestion.trim(),
          options: [prophecyOptionA, prophecyOptionB],
          bets: [],
          is_resolved: false,
        });
      }

      // 3. Get LiveKit token
      const { data: tokenData, error: tokenError } = await supabase.functions.invoke(
        'create-livekit-token',
        {
          body: {
            roomName,
            participantIdentity: userProfile?.username || user.id,
            isHost: true,
          },
        }
      );

      if (tokenError || !tokenData?.token) {
        throw new Error('Failed to generate livestream token.');
      }

      // 4. Navigate to host screen
      navigation.navigate('LiveHost', {
        sessionId: streamData.id,
        roomName,
        title: title.trim(),
        category: selectedCategory,
        lkToken: tokenData.token,
      });
    } catch (error: any) {
      console.error('[GoLive Error]', error);
      Alert.alert('Error', error.message || 'Could not start stream. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // ─── RENDER ──────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {/* Camera Preview — v5 API */}
      {hasPermission && device ? (
        <Camera
          style={StyleSheet.absoluteFillObject}
          device={device}
          isActive={true}
        />
      ) : (
        <View style={styles.cameraPlaceholder} />
      )}

      <View style={styles.overlay} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Feather name="x" size={22} color={C.wh} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Go Live</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Stream Title */}
        <View style={styles.section}>
          <Text style={styles.label}>Stream Title</Text>
          <TextInput
            style={styles.input}
            placeholder="What's your stream about?"
            placeholderTextColor="#666"
            value={title}
            onChangeText={setTitle}
            maxLength={80}
          />
        </View>

        {/* Category Picker */}
        <View style={styles.section}>
          <Text style={styles.label}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.categoryRow}>
              {CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[
                    styles.categoryChip,
                    selectedCategory === cat && styles.categoryChipActive,
                  ]}
                  onPress={() => setSelectedCategory(cat)}
                >
                  <Text
                    style={[
                      styles.categoryText,
                      selectedCategory === cat && styles.categoryTextActive,
                    ]}
                  >
                    {cat}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* Privacy Toggle */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.toggleRow}
            onPress={() => setIsPrivate(!isPrivate)}
          >
            <View>
              <Text style={styles.label}>Private Stream</Text>
              <Text style={styles.sublabel}>Only people with the link can join</Text>
            </View>
            <View style={[styles.toggle, isPrivate && styles.toggleActive]}>
              <View style={[styles.toggleKnob, isPrivate && styles.toggleKnobActive]} />
            </View>
          </TouchableOpacity>
        </View>

        {/* Prophecy Setup */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.toggleRow}
            onPress={() => setAddProphecy(!addProphecy)}
          >
            <View>
              <Text style={styles.label}>🔮 Add Prophecy</Text>
              <Text style={styles.sublabel}>Viewers bet coins on your pre-stream prediction</Text>
            </View>
            <View style={[styles.toggle, addProphecy && styles.toggleActive]}>
              <View style={[styles.toggleKnob, addProphecy && styles.toggleKnobActive]} />
            </View>
          </TouchableOpacity>

          {addProphecy && (
            <View style={styles.prophecyBox}>
              <TextInput
                style={styles.input}
                placeholder="Prophecy question e.g. Will I hit 1000 viewers?"
                placeholderTextColor="#666"
                value={prophecyQuestion}
                onChangeText={setProphecyQuestion}
                maxLength={120}
              />
              <View style={styles.optionsRow}>
                <TextInput
                  style={[styles.input, styles.optionInput]}
                  placeholder="Option A"
                  placeholderTextColor="#666"
                  value={prophecyOptionA}
                  onChangeText={setProphecyOptionA}
                  maxLength={30}
                />
                <TextInput
                  style={[styles.input, styles.optionInput]}
                  placeholder="Option B"
                  placeholderTextColor="#666"
                  value={prophecyOptionB}
                  onChangeText={setProphecyOptionB}
                  maxLength={30}
                />
              </View>
            </View>
          )}
        </View>

        {/* Go Live Button */}
        <TouchableOpacity
          style={[styles.goLiveBtn, isLoading && { opacity: 0.7 }]}
          onPress={handleGoLive}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color={C.dk} />
          ) : (
            <>
              <Feather name="radio" size={20} color={C.dk} />
              <Text style={styles.goLiveBtnText}>START BROADCAST</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ─── STYLES ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.dk },
  cameraPlaceholder: { ...StyleSheet.absoluteFillObject, backgroundColor: '#111' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.65)' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 60 : 30 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 30,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.cd, justifyContent: 'center', alignItems: 'center',
  },
  headerTitle: { color: C.wh, fontSize: 18, fontWeight: '800' },
  section: { marginBottom: 24 },
  label: { color: C.wh, fontSize: 14, fontWeight: '700', marginBottom: 10 },
  sublabel: { color: '#888', fontSize: 11, marginTop: 2 },
  input: {
    backgroundColor: C.card, color: C.wh, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 14,
    borderWidth: 1, borderColor: '#222',
  },
  categoryRow: { flexDirection: 'row', gap: 8 },
  categoryChip: {
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20, backgroundColor: C.card,
    borderWidth: 1, borderColor: '#333',
  },
  categoryChipActive: { backgroundColor: C.g, borderColor: C.g },
  categoryText: { color: '#aaa', fontSize: 13, fontWeight: '600' },
  categoryTextActive: { color: C.dk, fontWeight: '800' },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggle: {
    width: 48, height: 28, borderRadius: 14,
    backgroundColor: '#333', justifyContent: 'center', paddingHorizontal: 3,
  },
  toggleActive: { backgroundColor: C.g },
  toggleKnob: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: C.wh, alignSelf: 'flex-start',
  },
  toggleKnobActive: { alignSelf: 'flex-end' },
  prophecyBox: { marginTop: 14, gap: 10 },
  optionsRow: { flexDirection: 'row', gap: 10 },
  optionInput: { flex: 1 },
  goLiveBtn: {
    backgroundColor: C.g, borderRadius: 16,
    paddingVertical: 18, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center',
    gap: 10, marginTop: 10,
  },
  goLiveBtnText: { color: C.dk, fontSize: 16, fontWeight: '900', letterSpacing: 1 },
}); 
