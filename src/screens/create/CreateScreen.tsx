// ═══════════════════════════════════════════════════════════
// CreateScreen.tsx — Main Create Entry Point
// src/screens/create/CreateScreen.tsx
// ═══════════════════════════════════════════════════════════

import React, { useState, useCallback } from 'react';
import { View, StyleSheet, Modal, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../../store/authStore';

import CameraScreen      from './CameraScreen';
import ComposeScreen     from './ComposeScreen';
import DraftsScreen      from './DraftsScreen';
import AudioStudioPanel  from '../../components/studio/AudioStudioPanel';
import MovieStudioScreen from '../../components/movie/MovieStudioScreen';

import type { Draft, MediaType } from '../../utils/types';

type CreateView = 'camera' | 'compose' | 'studio' | 'movie' | 'drafts';

const DRAFTS_KEY = 'lumvibe_drafts_v1';
const MAX_DRAFTS = 20;

export default function CreateScreen() {
  const navigation = useNavigation();
  const { user }   = useAuthStore();

  const userId   = user?.id   ?? '';
  const username = (user as any)?.username ?? user?.email?.split('@')[0] ?? 'user';

  const [view,           setView]           = useState<CreateView>('camera');
  const [capturedUri,    setCapturedUri]    = useState<string | null>(null);
  const [capturedType,   setCapturedType]   = useState<MediaType>(null);
  const [studioAudioUri, setStudioAudioUri] = useState<string | null>(null);
  const [activeDraft,    setActiveDraft]    = useState<Draft | null>(null);
  const [selectedVibe,   setSelectedVibe]   = useState<string | null>(null);

  const handleMediaCaptured = useCallback((uri: string, type: 'video' | 'image') => {
    setCapturedUri(uri);
    setCapturedType(type);
    setView('compose');
  }, []);

  const handleStudioComplete = useCallback((audioUri: string) => {
    setStudioAudioUri(audioUri);
    setView('compose');
  }, []);

  const handleMovieDone = useCallback((finalUri: string) => {
    setCapturedUri(finalUri);
    setCapturedType('video');
    setView('compose');
  }, []);

  const handleRestoreDraft = useCallback((draft: Draft) => {
    setCapturedUri(draft.mediaUri);
    setCapturedType(draft.mediaType);
    setSelectedVibe(draft.selectedVibe);
    setActiveDraft(draft);
    setView('compose');
  }, []);

  const handleSaveDraft = useCallback(async (draft: Draft) => {
    try {
      const raw      = await AsyncStorage.getItem(DRAFTS_KEY);
      const existing: Draft[] = raw ? JSON.parse(raw) : [];
      const updated  = [draft, ...existing].slice(0, MAX_DRAFTS);
      await AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(updated));
      Alert.alert('✅ Saved', 'Draft saved. Resume anytime from Drafts.');
      setView('camera');
    } catch {
      Alert.alert('Error', 'Could not save draft. Please try again.');
    }
  }, []);

  const handlePostDone = useCallback(() => {
    setCapturedUri(null);
    setCapturedType(null);
    setStudioAudioUri(null);
    setActiveDraft(null);
    setSelectedVibe(null);
    setView('camera');
    navigation.goBack();
  }, [navigation]);

  const handleDiscard = useCallback(() => {
    Alert.alert(
      'Discard?',
      'Discard this post? You can save it as a draft instead.',
      [
        { text: 'Keep Editing', style: 'cancel' },
        {
          text: 'Save as Draft',
          onPress: () => {
            if (capturedUri) {
              handleSaveDraft({
                id:               `draft_${Date.now()}`,
                createdAt:        new Date().toISOString(),
                mediaUri:         capturedUri,
                originalMediaUri: capturedUri,
                mediaType:        capturedType,
                caption:          '',
                statusContent:    '',
                statusType:       'text',
                statusBackground: '#1A1A3A',
                statusVoiceUri:   null,
                statusVoiceDuration: 0,
                filter:           'original',
                speedId:          'normal',
                blurEnabled:      false,
                selectedVibe,
                selectedFx:       'fx_none',
                selectedMusic:    null,
                selectedMusicName:null,
                musicArtist:      null,
                musicVolume:      0.5,
                originalVolume:   1.0,
                location:         null,
                locationCoords:   null,
                addWatermark:     true,
                autoOptimize:     true,
                isScheduled:      false,
                scheduledFor:     null,
              });
            }
          },
        },
        {
          text: 'Discard', style: 'destructive',
          onPress: () => {
            setCapturedUri(null);
            setCapturedType(null);
            setStudioAudioUri(null);
            setView('camera');
          },
        },
      ]
    );
  }, [capturedUri, capturedType, selectedVibe, handleSaveDraft]);

  return (
    <View style={styles.container}>

      {/* Camera */}
      {view === 'camera' && (
        <CameraScreen
          onMediaCaptured={handleMediaCaptured}
          onOpenDrafts={() => setView('drafts')}
          onOpenStudio={() => setView('studio')}
          onOpenMovie={() => setView('movie')}
          onOpenVibeShift={() => setView}
        />
      )}

      {/* Compose */}
      {view === 'compose' && capturedUri && capturedType && (
        <ComposeScreen
          mediaUri={capturedUri}
          mediaType={capturedType}
          studioAudioUri={studioAudioUri}
          userId={userId}
          username={username}
          selectedVibe={selectedVibe}
          onPostDone={handlePostDone}
          onDiscard={handleDiscard}
          onSaveDraft={handleSaveDraft}
        />
      )}

      {/* Audio Studio — WHY: username passed so coach can personalise */}
      <Modal
        visible={view === 'studio'}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setView('camera')}
      >
        <AudioStudioPanel
          vibe={selectedVibe ?? 'Afrobeats'}
          onComplete={handleStudioComplete}
          onClose={() => setView('camera')}
          username={username}
        />
      </Modal>

      {/* Movie Studio */}
      <Modal
        visible={view === 'movie'}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setView('camera')}
      >
        <MovieStudioScreen
          userId={userId}
          username={username}
          onDone={handleMovieDone}
          onClose={() => setView('camera')}
        />
      </Modal>

      {/* Drafts */}
      <Modal
        visible={view === 'drafts'}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setView('camera')}
      >
        <DraftsScreen
          onRestore={handleRestoreDraft}
          onClose={() => setView('camera')}
        />
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
}); 
