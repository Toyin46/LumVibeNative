// src/lib/IncomingCallLockScreen.tsx   (NEW FILE)
//
// What appears OVER THE LOCK SCREEN when a call / watch invite rings while the
// phone is locked or the screen is off. Android launches it through the
// notification's full-screen action (see incomingCallNotifee.ts) in its own
// window — so your app itself never sits over the lock screen, and nobody
// can see your chats without unlocking.
//
//   Decline  -> declines (caller stops ringing), screen closes
//   Accept   -> closes this screen and opens the app; Android asks to unlock,
//               then the call connects / the watch party opens
//   Message  -> same, but opens the chat instead of connecting
//
// The notification keeps ringing underneath (looping ringtone) the whole time;
// this screen only has to draw the buttons.
//
// Registered in index.js:
//   AppRegistry.registerComponent('lumvibe-incoming-call', () => IncomingCallLockScreen);

import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, StatusBar, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import notifee from '@notifee/react-native';
import { parseRingData, ringNotificationId, RingPayload } from './ringPayload';
import { IncomingCallView } from './IncomingCallView';
import { declineIncoming, enqueueRingAction } from './incomingRing';
import { cancelRingNotification } from './incomingCallNotifee';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Finds the ringing notification's data (this screen is launched by it). */
async function findRingingPayload(props: any): Promise<RingPayload | null> {
  const fromProps = parseRingData(props);
  if (fromProps) return fromProps;
  for (let i = 0; i < 8; i++) {
    try {
      const shown = await notifee.getDisplayedNotifications();
      for (const n of shown) {
        const p = parseRingData((n as any).notification?.data ?? (n as any).data);
        if (p) return p;
      }
    } catch (_) {}
    await sleep(300);
  }
  return null;
}

/** Closes THIS window only. Must run before the app is launched — see accept(). */
function closeThisScreen() {
  try { BackHandler.exitApp(); } catch (_) {}
}

function LockScreenCall(props: any) {
  const [payload, setPayload] = useState<RingPayload | null>(null);
  const doneRef = useRef(false);

  // 1) load who is calling
  useEffect(() => {
    let alive = true;
    (async () => {
      const p = await findRingingPayload(props);
      if (!alive) return;
      if (p) setPayload(p);
      else closeThisScreen();
    })();
    return () => { alive = false; };
  }, []);

  // 2) close by itself when the ring is over (caller hung up / 30 s timeout)
  useEffect(() => {
    if (!payload) return;
    const id = ringNotificationId(payload);
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      if (doneRef.current) return;
      let stillRinging = true;
      try {
        const shown = await notifee.getDisplayedNotifications();
        stillRinging = shown.some((n: any) => n.id === id || n.notification?.id === id);
      } catch (_) {}
      if (!stillRinging || Date.now() - startedAt > 100000) {
        doneRef.current = true;
        closeThisScreen();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [payload]);

  if (!payload) {
    return <View style={{ flex: 1, backgroundColor: '#0b141a' }} />;
  }

  const finish = () => { doneRef.current = true; };

  const decline = async () => {
    finish();
    await declineIncoming(payload);      // also stops the notification's ringing
    closeThisScreen();
  };

  // Accept / Message: hand over to the app. The order matters — this window is
  // closed FIRST (so it is still the "current" screen), then the app is opened;
  // done the other way round, closing would act on the app instead.
  const openApp = (action: 'answer' | 'join' | 'chat') => {
    finish();
    enqueueRingAction({ action, payload });
    cancelRingNotification(payload).catch(() => {});
    closeThisScreen();
    Linking.openURL('lumvibenative://').catch(() => {});
  };

  const accept = () => openApp(payload.type === 'cowatch_invite' ? 'join' : 'answer');
  const message = async () => {
    // decline the call, then open the chat
    if (payload.type === 'incoming_call') declineIncoming(payload).catch(() => {});
    openApp('chat');
  };

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0b141a" translucent />
      <IncomingCallView p={payload} onAccept={accept} onDecline={decline} onMessage={message} />
    </SafeAreaProvider>
  );
}

export default LockScreenCall;
