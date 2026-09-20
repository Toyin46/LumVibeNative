import './polyfills';
import { registerGlobals } from '@livekit/react-native';
registerGlobals()

// ─────────────────────────────────────────────────────────────────────────
// Ringing while the app is CLOSED / in the BACKGROUND.
//
// Everything here must be registered at the top level of the entry point —
// before registerRootComponent — because it has to run in a headless JS
// context when the app process is completely killed.
//
// A call / watch-party push (data-only, high priority) can be delivered to
// this app by TWO different Android services depending on the build
// (@react-native-firebase/messaging or expo-notifications), and the payload
// looks different in each (Expo wraps your data as a JSON string). Both are
// registered below, both go through the same parser (ringPayload.ts) and the
// notification id is derived from the room/session — so if both ever fire it
// is still ONE notification, never two.
// ─────────────────────────────────────────────────────────────────────────
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import notifee from '@notifee/react-native';
import { handleRingPush, handleRingNotificationEvent } from './src/lib/ringBackground';

// 1) @react-native-firebase/messaging
setBackgroundMessageHandler(getMessaging(), async (remoteMessage) => {
  await handleRingPush(remoteMessage);
});

// 2) expo-notifications background task (needs `npx expo install expo-task-manager`)
try {
  const TaskManager = require('expo-task-manager');
  const ExpoNotifications = require('expo-notifications');
  const RING_TASK = 'LUMVIBE_RING_PUSH_TASK';
  TaskManager.defineTask(RING_TASK, async ({ data, error }) => {
    if (error) return;
    await handleRingPush(data);
  });
  ExpoNotifications.registerTaskAsync(RING_TASK).catch(() => {});
} catch (e) {
  console.warn('[ring] expo background task not available:', e && e.message);
}

// Decline / Answer / Join / tap on the ringing notification while the app is
// not in the foreground. "Decline" completes here without opening the app;
// everything else opens the app (and is queued until the navigator exists).
notifee.onBackgroundEvent(async (event) => {
  await handleRingNotificationEvent(event);
});

// ✅ NEW (lock screen): the screen Android shows OVER the lock screen when a
// call / watch invite rings while the phone is locked. The name must match
// LOCKSCREEN_COMPONENT in src/lib/incomingCallNotifee.ts.
import { AppRegistry } from 'react-native';
import IncomingCallLockScreen from './src/lib/IncomingCallLockScreen';
AppRegistry.registerComponent('lumvibe-incoming-call', () => IncomingCallLockScreen);

import React from 'react';
import { registerRootComponent } from "expo";

// ✅ CHANGED: the app screen is loaded only when a screen is actually drawn.
// When a call push wakes a CLOSED phone (especially a locked one) only the
// ringing code above needs to run, and loading the whole app first (every
// screen, LiveKit, …) delayed the ring by seconds on slower phones — long
// enough for the phone to fall back asleep before it rang. Normal app start-up
// is unchanged (App loads at the first render, exactly as before).
function Root(props) {
  const App = require('./App').default;
  return React.createElement(App, props);
}

registerRootComponent(Root);
