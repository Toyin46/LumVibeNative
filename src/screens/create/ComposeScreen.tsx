// ═══════════════════════════════════════════════════════════
// ComposeScreen.tsx
// CORRECT PATHS: src/screens/create/ComposeScreen.tsx
// supabase at:   ../../config/supabase  (matches your original)
// shared at:     ../../components/shared/VolumeSlider
// ═══════════════════════════════════════════════════════════

import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Image, ActivityIndicator, Alert, Switch,
  Dimensions,
} from 'react-native';
import DateTimePicker         from '@react-native-community/datetimepicker';
import { supabase }           from '../../config/supabase';
import { useAuthStore }       from '../../store/authStore';
import VolumeSlider           from '../../components/shared/VolumeSlider';
import { uploadVideoToCloudinary } from '../../utils/cloudinaryHelpers';
import {
  bakeVideoFilter, bakeWatermarkAndEndCard, mergeVideoAudio,
}                             from '../../utils/ffmpegHelpers';
import {
  FILTERS, FX_EFFECTS, VIBE_TYPES, SPEED_OPTIONS,
}                             from '../../utils/constants';
import type {
  MediaType, FilterDef, FxEffect, Draft, PostInsertData,
}                             from '../../utils/types';

const { width: SW } = Dimensions.get('window');

type ComposeTab = 'caption' | 'filters' | 'music' | 'settings';

interface Props {
  mediaUri:        string;
  mediaType:       MediaType;
  studioAudioUri?: string | null;
  userId:          string;
  username:        string;
  selectedVibe?:   string | null;
  onPostDone:      () => void;
  onDiscard:       () => void;
  onSaveDraft:     (draft: Draft) => void;
}

export default function ComposeScreen({
  mediaUri, mediaType, studioAudioUri,
  userId, username, selectedVibe: initVibe,
  onPostDone, onDiscard, onSaveDraft,
}: Props) {
  const [activeTab,       setActiveTab]       = useState<ComposeTab>('caption');
  const [caption,         setCaption]         = useState('');
  const [selectedFilter,  setSelectedFilter]  = useState<FilterDef>(FILTERS[0]);
  const [selectedFx,      setSelectedFx]      = useState<FxEffect>(FX_EFFECTS[0]);
  const [selectedVibe,    setSelectedVibe]    = useState<string | null>(initVibe ?? null);
  const [selectedSpeedId, setSelectedSpeedId] = useState('normal');
  const [musicVolume,     setMusicVolume]     = useState(0.5);
  const [originalVolume,  setOriginalVolume]  = useState(1.0);
  const [addWatermark,    setAddWatermark]    = useState(true);
  const [autoOptimize,    setAutoOptimize]    = useState(true);
  const [isScheduled,     setIsScheduled]     = useState(false);
  const [scheduledFor,    setScheduledFor]    = useState<Date | null>(null);
  const [showDatePicker,  setShowDatePicker]  = useState(false);
  const [isPosting,       setIsPosting]       = useState(false);
  const [uploadProgress,  setUploadProgress]  = useState(0);
  const [statusMessage,   setStatusMessage]   = useState('');

  const TABS: { id: ComposeTab; label: string; emoji: string }[] = [
    { id: 'caption',  label: 'Caption',  emoji: '✍️' },
    { id: 'filters',  label: 'Filters',  emoji: '🎨' },
    { id: 'music',    label: 'Music',    emoji: '🎵' },
    { id: 'settings', label: 'Settings', emoji: '⚙️' },
  ];

  async function handlePost() {
    if (!mediaUri || !userId) {
      Alert.alert('Error', 'Missing media or user.');
      return;
    }
    setIsPosting(true);
    try {
      let finalUri = mediaUri;

      if (studioAudioUri && mediaType === 'video') {
        setStatusMessage('Merging audio…');
        finalUri = await mergeVideoAudio(finalUri, studioAudioUri, null, musicVolume, originalVolume);
      }

      if (mediaType === 'video') {
        const speedObj = SPEED_OPTIONS.find(s => s.id === selectedSpeedId);
        setStatusMessage('Applying effects…');
        finalUri = await bakeVideoFilter(finalUri, selectedFilter.id, selectedFx.id, speedObj?.rate ?? 1.0);
      }

      if (addWatermark && mediaType === 'video') {
        setStatusMessage('Adding watermark…');
        finalUri = await bakeWatermarkAndEndCard(finalUri, username, true);
      }

      setStatusMessage('Uploading…');
      const upload = await uploadVideoToCloudinary(
        finalUri,
        (pct) => setUploadProgress(pct),
        username,
        false, // watermark already baked
      );

      setStatusMessage('Publishing…');
      const speedObj = SPEED_OPTIONS.find(s => s.id === selectedSpeedId);

      const postData: PostInsertData = {
        user_id:          userId,
        caption,
        likes_count:      0,
        comments_count:   0,
        views_count:      0,
        coins_received:   0,
        created_at:       new Date().toISOString(),
        is_published:     !isScheduled,
        scheduled_for:    isScheduled && scheduledFor ? scheduledFor.toISOString() : null,
        has_watermark:    addWatermark,
        auto_optimized:   autoOptimize,
        applied_filter:   selectedFilter.dbKey,
        video_effect:     selectedFx.id,
        video_filter_tint:selectedFilter.dbTint,
        playback_rate:    speedObj?.rate ?? 1.0,
        vibe_type:        selectedVibe,
        voice_auto_tune:  false,
        blur_enabled:     false,
        media_url:        upload.url,
        media_type:       mediaType ?? 'video',
        cloudinary_public_id: upload.publicId,
        music_volume:     musicVolume,
        original_volume:  originalVolume,
        watermarked_url:  upload.watermarkedUrl,
      };

      const { error: dbError } = await supabase.from('posts').insert(postData);
      if (dbError) throw new Error(dbError.message);

      setStatusMessage('');
      Alert.alert(
        isScheduled ? '🗓 Scheduled!' : '🎉 Posted!',
        isScheduled
          ? `Scheduled for ${scheduledFor?.toLocaleString('en-NG')}.`
          : 'Your post is live. Go get those coins! 💰',
        [{ text: 'Done', onPress: onPostDone }],
      );
    } catch (err: unknown) {
      setStatusMessage('');
      const message = err instanceof Error ? err.message : 'Unknown error';
      Alert.alert('Post Failed', message);
    } finally {
      setIsPosting(false);
      setUploadProgress(0);
    }
  }

  function handleSaveDraft() {
    const draft: Draft = {
      id: `draft_${Date.now()}`,
      createdAt: new Date().toISOString(),
      mediaUri, originalMediaUri: mediaUri, mediaType, caption,
      statusContent: '', statusType: 'text',
      statusBackground: '#1A1A3A', statusVoiceUri: null, statusVoiceDuration: 0,
      filter: selectedFilter.id, speedId: selectedSpeedId, blurEnabled: false,
      selectedVibe, selectedFx: selectedFx.id,
      selectedMusic: null, selectedMusicName: null, musicArtist: null,
      musicVolume, originalVolume,
      location: null, locationCoords: null,
      addWatermark, autoOptimize, isScheduled,
      scheduledFor: scheduledFor?.toISOString() ?? null,
    };
    onSaveDraft(draft);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onDiscard}>
          <Text style={styles.discardBtn}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Post</Text>
        <TouchableOpacity style={styles.draftBtn} onPress={handleSaveDraft}>
          <Text style={styles.draftBtnText}>Save Draft</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tabBar}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.id}
            style={[styles.tab, activeTab === tab.id && styles.tabActive]}
            onPress={() => setActiveTab(tab.id)}
          >
            <Text style={styles.tabEmoji}>{tab.emoji}</Text>
            <Text style={[styles.tabLabel, activeTab === tab.id && styles.tabLabelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        {activeTab === 'caption' && (
          <View style={styles.tabContent}>
            <TextInput
              style={styles.captionInput}
              value={caption}
              onChangeText={setCaption}
              placeholder="Write your caption… 🔥"
              placeholderTextColor="#555"
              multiline
              maxLength={500}
            />
            <Text style={styles.charCount}>{caption.length}/500</Text>

            <Text style={styles.sectionLabel}>Vibe</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {VIBE_TYPES.map(v => (
                <TouchableOpacity
                  key={v.id}
                  style={[
                    styles.vibeChip,
                    selectedVibe === v.id && { backgroundColor: v.color + '33', borderColor: v.color },
                  ]}
                  onPress={() => setSelectedVibe(v.id === selectedVibe ? null : v.id)}
                >
                  <Text style={styles.vibeChipEmoji}>{v.emoji}</Text>
                  <Text style={[styles.vibeChipText, selectedVibe === v.id && { color: v.color }]}>
                    {v.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {activeTab === 'filters' && (
          <View style={styles.tabContent}>
            <Text style={styles.sectionLabel}>Colour Filter</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {FILTERS.map(f => (
                <TouchableOpacity
                  key={f.id}
                  style={[styles.filterCard, selectedFilter.id === f.id && styles.filterCardActive]}
                  onPress={() => setSelectedFilter(f)}
                >
                  <Text style={styles.filterEmoji}>{f.emoji}</Text>
                  <Text style={[styles.filterName, selectedFilter.id === f.id && { color: '#FFF' }]}>
                    {f.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.sectionLabel}>FX</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {FX_EFFECTS.map(fx => (
                <TouchableOpacity
                  key={fx.id}
                  style={[styles.filterCard, selectedFx.id === fx.id && styles.filterCardActive]}
                  onPress={() => setSelectedFx(fx)}
                >
                  <Text style={styles.filterEmoji}>{fx.emoji}</Text>
                  <Text style={[styles.filterName, selectedFx.id === fx.id && { color: '#FFF' }]}>
                    {fx.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.sectionLabel}>Speed</Text>
            <View style={styles.speedRow}>
              {SPEED_OPTIONS.map(s => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.speedChip, selectedSpeedId === s.id && styles.speedChipActive]}
                  onPress={() => setSelectedSpeedId(s.id)}
                >
                  <Text style={styles.speedEmoji}>{s.emoji}</Text>
                  <Text style={[styles.speedText, selectedSpeedId === s.id && { color: '#FFF' }]}>
                    {s.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {activeTab === 'music' && (
          <View style={styles.tabContent}>
            <VolumeSlider
              label="Music Volume"
              value={musicVolume}
              onChange={setMusicVolume}
              emoji="🎵"
              color="#00ff88"
            />
            <VolumeSlider
              label="Original Volume"
              value={originalVolume}
              onChange={setOriginalVolume}
              emoji="🎤"
              color="#6B4FFF"
            />
          </View>
        )}

        {activeTab === 'settings' && (
          <View style={styles.tabContent}>
            {[
              { key: 'watermark', label: '🔖 Add Watermark', desc: `Burns @${username} | LumVibe`, val: addWatermark, set: setAddWatermark },
              { key: 'optimize',  label: '✨ Auto Optimise',  desc: 'Best quality + format',        val: autoOptimize, set: setAutoOptimize },
              { key: 'schedule',  label: '🗓 Schedule Post',  desc: 'Publish at a chosen time',     val: isScheduled,  set: (v: boolean) => { setIsScheduled(v); if (v) setShowDatePicker(true); } },
            ].map(item => (
              <View key={item.key} style={styles.settingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.settingLabel}>{item.label}</Text>
                  <Text style={styles.settingDesc}>{item.desc}</Text>
                </View>
                <Switch
                  value={item.val}
                  onValueChange={item.set}
                  trackColor={{ false: '#2A2A4A', true: '#00ff88' }}
                  thumbColor={item.val ? '#FFF' : '#666'}
                />
              </View>
            ))}

            {isScheduled && scheduledFor && (
              <TouchableOpacity style={styles.scheduledDisplay} onPress={() => setShowDatePicker(true)}>
                <Text style={styles.scheduledText}>📅 {scheduledFor.toLocaleString('en-NG')}</Text>
              </TouchableOpacity>
            )}
            {showDatePicker && (
              <DateTimePicker
                value={scheduledFor ?? new Date()}
                mode="datetime"
                minimumDate={new Date()}
                onChange={(_, date) => { setShowDatePicker(false); if (date) setScheduledFor(date); }}
              />
            )}
          </View>
        )}
      </ScrollView>

      {isPosting && uploadProgress > 0 && (
        <View style={styles.progressContainer}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${uploadProgress}%` as any }]} />
          </View>
          <Text style={styles.progressText}>{statusMessage || `${uploadProgress}%`}</Text>
        </View>
      )}

      <View style={styles.postBar}>
        <TouchableOpacity
          style={[styles.postBtn, isPosting && styles.postBtnDisabled]}
          onPress={handlePost}
          disabled={isPosting}
        >
          {isPosting ? (
            <View style={styles.postBtnInner}>
              <ActivityIndicator color="#FFF" size="small" />
              <Text style={styles.postBtnText}>{statusMessage || 'Posting…'}</Text>
            </View>
          ) : (
            <Text style={styles.postBtnText}>{isScheduled ? '🗓 Schedule' : '🚀 Post Now'}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A1A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1A1A3A' },
  headerTitle: { color: '#FFF', fontWeight: '800', fontSize: 17 },
  discardBtn:  { color: '#888', fontSize: 20, padding: 4 },
  draftBtn:    { backgroundColor: '#1E1E3A', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  draftBtnText:{ color: '#AAA', fontWeight: '600', fontSize: 12 },
  tabBar: { flexDirection: 'row', backgroundColor: '#0D0D20', borderBottomWidth: 1, borderBottomColor: '#1A1A3A' },
  tab:    { flex: 1, alignItems: 'center', paddingVertical: 10, gap: 2 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#00ff88' },
  tabEmoji:  { fontSize: 15 },
  tabLabel:  { color: '#666', fontSize: 10, fontWeight: '600' },
  tabLabelActive: { color: '#FFF' },
  scroll:     { flex: 1 },
  tabContent: { padding: 16, gap: 14 },
  captionInput: { backgroundColor: '#111124', borderRadius: 14, padding: 14, color: '#FFF', fontSize: 15, minHeight: 120, textAlignVertical: 'top', borderWidth: 1, borderColor: '#2A2A4A' },
  charCount:    { color: '#555', fontSize: 11, textAlign: 'right', marginTop: -8 },
  sectionLabel: { color: '#AAA', fontSize: 12, fontWeight: '700', marginBottom: 4 },
  vibeChip:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E1E3A', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, marginRight: 8, borderWidth: 1, borderColor: '#3A3A5A', gap: 6 },
  vibeChipEmoji:  { fontSize: 16 },
  vibeChipText:   { color: '#AAA', fontSize: 13, fontWeight: '600' },
  filterCard:       { backgroundColor: '#111124', borderRadius: 12, padding: 12, alignItems: 'center', marginRight: 10, width: 78, borderWidth: 1.5, borderColor: '#2A2A4A' },
  filterCardActive: { borderColor: '#00ff88', backgroundColor: '#1A1A3A' },
  filterEmoji:      { fontSize: 24, marginBottom: 4 },
  filterName:       { color: '#888', fontSize: 10, fontWeight: '700', textAlign: 'center' },
  speedRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  speedChip: { backgroundColor: '#111124', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: '#2A2A4A', minWidth: 52 },
  speedChipActive: { borderColor: '#00ff88', backgroundColor: '#0A1A0A' },
  speedEmoji:      { fontSize: 14, marginBottom: 2 },
  speedText:       { color: '#888', fontWeight: '700', fontSize: 11 },
  settingRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#111124', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#2A2A4A' },
  settingLabel:  { color: '#FFF', fontWeight: '600', fontSize: 14, marginBottom: 2 },
  settingDesc:   { color: '#666', fontSize: 11 },
  scheduledDisplay: { backgroundColor: '#0A1A0A', borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#00ff88' },
  scheduledText:    { color: '#00ff88', fontWeight: '600' },
  progressContainer: { paddingHorizontal: 16, paddingTop: 8 },
  progressTrack: { height: 4, backgroundColor: '#1A1A3A', borderRadius: 2, overflow: 'hidden' },
  progressFill:  { height: '100%', backgroundColor: '#00ff88', borderRadius: 2 },
  progressText:  { color: '#888', fontSize: 11, textAlign: 'center', marginTop: 4 },
  postBar: { padding: 16, borderTopWidth: 1, borderTopColor: '#1A1A3A' },
  postBtn:         { backgroundColor: '#00ff88', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  postBtnDisabled: { opacity: 0.6 },
  postBtnInner:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  postBtnText:     { color: '#000', fontWeight: '900', fontSize: 16 },
}); 
