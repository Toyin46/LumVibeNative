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
import * as Notifications from 'expo-notifications';
// ✅ NEW (ringing rework): one shared in-app ring state + the push/notification
// entry points — see src/lib/incomingRing.ts and src/lib/ringBackground.ts.
import { ensureIncomingCallChannel } from './src/lib/incomingCallNotifee';
import { setRingNavRef, initIncomingRing } from './src/lib/incomingRing';
import { handleForegroundPush } from './src/lib/ringBackground';
// ✅ NEW: asks once (only on phones that need it — Infinix/Tecno/Xiaomi/Oppo/…) to
// allow background running, so calls ring when the app is closed.
import { promptReliableRingingOnce } from './src/lib/ringReliability';
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
  useGlobalIncomingSignal(user?.id);

  // ✅ NEW (ringing rework): everything that rings shares ONE state
  // (src/lib/incomingRing.ts). App-level wiring, done once:
  //   • give it the navigation ref (Answer / Join navigate through it)
  //   • hand a still-ringing call over to the system notification if the
  //     person leaves the app while it rings
  //   • create the ringing notification channel up front (Android locks a
  //     channel's sound forever at first creation, so it must exist and be
  //     right before the first call ever arrives)
  useEffect(() => {
    setRingNavRef(navigationRef);
    initIncomingRing();
    if (Platform.OS === 'android') ensureIncomingCallChannel().catch(() => {});
  }, []);

  // ✅ NEW: after login, once, explain + open the phone's background-running
  // settings. Delayed so it never fights the notification-permission dialog.
  useEffect(() => {
    if (!user?.id || Platform.OS !== 'android') return;
    const t = setTimeout(() => { promptReliableRingingOnce().catch(() => {}); }, 8000);
    return () => clearTimeout(t);
  }, [user?.id]);

  // ✅ NEW: push arriving while the app is OPEN -> in-app banner + ringtone
  // (image 6) instead of a system notification. Two listeners because which
  // library receives the message depends on which Android messaging service
  // wins in your build (RNFirebase vs expo-notifications) — both feed the
  // same de-duplicating state, so it never rings twice.
  useEffect(() => {
    const unsubFirebase = onMessage(getMessaging(), async (remoteMessage) => {
      handleForegroundPush(remoteMessage);
    });
    const expoSub = Notifications.addNotificationReceivedListener((notification) => {
      handleForegroundPush(notification);
    });
    return () => { unsubFirebase(); expoSub.remove(); };
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
          <GlobalIncomingBanner />
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

