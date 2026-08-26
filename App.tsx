import React, { useEffect, useRef } from 'react';
import { NavigationContainer, DarkTheme, NavigationContainerRef } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
// ✅ NEW: root cause of "Audio device module is not initialized" — LiveKit's
// WebRTC globals were never registered. This has to run once, before any
// screen touches LiveKit, so it lives here at the very top of the app
// entry rather than inside chat/[id].tsx. This alone isn't the full fix —
// see the note further down about the Expo config plugin, which is the
// other required half (and needs a new EAS build, not just a JS reload).
import { registerGlobals } from '@livekit/react-native';
registerGlobals();

import { RootNavigator } from './src/navigation';
import { colors } from './src/constants';
// ✅ NEW: makes tapping an incoming-call push (cold-start or warm) land
// straight in the right chat with the call auto-joined — see the file
// for why this has to live here, at the app root, and not in chat/[id].tsx.
import { useCallPushNavigation } from './src/lib/callPushNavigation';

const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
  },
};

export default function App() {
  // #region agent log
  useEffect(() => {
    fetch('http://127.0.0.1:7733/ingest/2ce51378-5f1a-4782-9a65-c75641847f4f',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'46b743'},body:JSON.stringify({sessionId:'46b743',location:'App.tsx:boot',message:'App mounted — React Navigation entry (no expo-router)',data:{entryPoint:'index.js',devClient:true},timestamp:Date.now(),hypothesisId:'E',runId:'post-fix'})}).catch(()=>{});
  }, []);
  // #endregion

  // ✅ NEW: wires up incoming-call push notification taps to navigate into
  // ChatDM with autoAnswerCall — see src/lib/callPushNavigation.ts
  const navigationRef = useRef<NavigationContainerRef<any>>(null);
  useCallPushNavigation(navigationRef);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <NavigationContainer ref={navigationRef} theme={navigationTheme}>
          <StatusBar style="light" />
          <RootNavigator />
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
});

