// src/story.tsx
//
// Real, standalone file for "create a story" — this didn't exist before.
// Deliberately a thin launcher rather than a duplicate camera UI: it hands
// off straight into the already-proven create.tsx camera/upload pipeline
// with story mode pre-selected, so nothing about that large, working file
// needed to be rebuilt or risked to give Story a genuine entry point.
//
// Wire whatever UI element should represent "add a story" (a ring on Home,
// Messages, or Profile) to: navigation.navigate('Story')
//
// NOTE ON THE EXISTING POST/STORY/LIVE TAB INSIDE create.tsx: that one is
// working exactly as designed — it's a mode selector for the camera screen
// you're already on (same pattern as Instagram's own Post/Story tabs), not
// a navigation trigger. Tapping it correctly highlights green and nothing
// else, because you're meant to then take your photo/video and hit
// Post/Share from right there. This file is for a DIFFERENT entry point —
// one that lives outside create.tsx and should visibly navigate somewhere
// the moment it's tapped, landing you in Create already in story mode
// without needing to tap that internal tab at all.

import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from './navigation/types';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

export default function StoryScreen() {
  const navigation = useNavigation<NavProp>();
  const route = useRoute<any>();

  useEffect(() => {
    // replace(), not navigate() — same reasoning as the group/circle/DM
    // creation fix earlier this session: this screen should never sit in
    // the back-stack. Landing here should feel instant, and pressing back
    // from Create should return to wherever you were before tapping
    // "Add Story", not to this spinner.
    //
    // Context (contextType/contextId/contextLabel) comes from whichever
    // "+" button launched this — chat/[id].tsx, group/info.tsx, or
    // circle/[id].tsx — and passes straight through to Create so it can
    // offer the private/public choice and tag the story correctly.
    navigation.replace('Main', {
      screen: 'Create',
      params: {
        initialMode: 'story',
        contextType: route.params?.contextType,
        contextId: route.params?.contextId,
        contextLabel: route.params?.contextLabel,
      },
    });
  }, []);

  return (
    <View style={s.container}>
      <ActivityIndicator size="large" color="#00ff88" />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
});
