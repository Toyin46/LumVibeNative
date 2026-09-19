import React, { useEffect, useRef } from 'react';
import { NavigationContainer, DarkTheme, NavigationContainerRef } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Platform } from 'react-native';
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
// ✅ NEW: without this Provider, every screen's useTranslation()/useLanguage()
// call falls back to LanguageContext's default value — whose setLanguage is a
// no-op stub — so picking a language silently did nothing.
import { LanguageProvider } from './src/locales/LanguageContext';
// ✅ NEW: makes tapping an incoming-call push (cold-start or warm) land
// straight in the right chat with the call auto-joined — see the file
// for why this has to live here, at the app root, and not in chat/[id].tsx.
import { useCallPushNavigation } from './src/lib/callPushNavigation';
// ✅ NEW (native incoming-call UI): the notifee equivalent of the hook
// above — reacts to Answer/tap on the full-screen ringing notification
// (see src/lib/incomingCallNotifee.ts + src/lib/notifeeCallNavigation.ts).
// Both hooks coexist safely: this one only ever acts on data.type ===
// 'incoming_call' events coming specifically from notifee's own event
// system, so it can't intercept or double-handle anything
// useCallPushNavigation already deals with via expo-notifications.
import { useNotifeeCallNavigation } from './src/lib/notifeeCallNavigation';
// ✅ FIX: same modular-API correction as index.js — the default export
// this used to import was removed in the installed version of
// @react-native-firebase/messaging.
import { getMessaging, onMessage } from '@react-native-firebase/messaging';
import { displayIncomingCallNotifee } from './src/lib/incomingCallNotifee';
// ✅ NEW: same idea, for the general notification types (follow/like/
// comment/coin/mention) — tapping one of these, from inside the app,
// backgrounded, or fully closed, now actually navigates to the relevant
// screen instead of doing nothing. Deliberately separate from
// useCallPushNavigation above — see notificationPushNavigation.ts for why
// they can't be merged into one hook.
import { useNotificationPushNavigation } from './src/lib/notificationPushNavigation';
// ✅ NEW: completes email verification (and any other Supabase auth email
// link) when it opens the app — see authDeepLink.ts for the full picture
// of what was missing and why the verification link used to freeze/crash.
import { useAuthDeepLink } from './src/lib/authDeepLink';
// ✅ NEW: fixes "the ring only shows if I'm already on the chat screen" —
// see globalIncomingSignal.tsx for the full explanation. Needs the
// current user's id to subscribe to their personal signal channel.
import { useAuthStore } from './src/store/authStore';
import { useGlobalIncomingSignal, GlobalIncomingBanner } from './src/lib/globalIncomingSignal';

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
  useNotificationPushNavigation(navigationRef);
  // ✅ NEW: handles Answer/tap on the notifee full-screen call banner.
  useNotifeeCallNavigation(navigationRef);
  useAuthDeepLink();

  // ✅ NEW: the actual global, any-screen ring — see globalIncomingSignal.tsx.
  const { user } = useAuthStore();
  const { incoming, dismiss } = useGlobalIncomingSignal(user?.id);

  // ✅ NEW (native incoming-call UI — the foreground half): index.js's
  // background handler only fires while the app is backgrounded/killed —
  // RNFirebase routes a data message to THIS listener instead whenever
  // the app is already open. Without this, a call arriving while someone
  // is actively using the app (but not on that exact chat screen, where
  // the realtime call_signal banner already handles it) would only ever
  // show the plain OS notification banner, not the full notifee ring.
  // send-call-push sends BOTH title/body (a reliable fallback — see the
  // comment there on the known expo-notifications/RNFirebase Android
  // conflict) AND the same data payload, so this listener can upgrade to
  // the full ring whenever it does get a chance to run.
  useEffect(() => {
    const messagingInstance = getMessaging();
    const unsubscribe = onMessage(messagingInstance, async (remoteMessage) => {
      const data = remoteMessage.data as any;
      // ✅ FIX: same iOS guard as index.js's background handler — iOS's
      // incoming-call push is a normal visible notification and displays
      // itself; only Android's data-only variant needs this to draw
      // anything at all.
      // ✅ NEW (cowatch parity): 'cowatch_invite' rings the same way now.
      if ((data?.type === 'incoming_call' || data?.type === 'cowatch_invite') && Platform.OS === 'android') {
        await displayIncomingCallNotifee(data);
      }
    });
    return unsubscribe;
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <LanguageProvider>
          <NavigationContainer ref={navigationRef} theme={navigationTheme}>
            <StatusBar style="light" />
            <RootNavigator />
          </NavigationContainer>
          {/* ✅ NEW: renders above the navigator so it can appear over
              ANY screen — Home, profile, marketplace, video feed, etc. —
              not just the chat screen. Modal handles the actual
              above-everything overlay natively. */}
          <GlobalIncomingBanner incoming={incoming} dismiss={dismiss} navRef={navigationRef} />
        </LanguageProvider>
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

