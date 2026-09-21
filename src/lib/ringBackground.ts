// src/lib/ringBackground.ts   (NEW FILE)
//
// The entry points that run when a call / watch-invite push arrives or a
// ringing notification is tapped — in ANY app state:
//
//   handleRingPush(raw)          app closed / background  -> ringing notification
//   handleForegroundPush(raw)    app open                 -> in-app banner + ringtone
//   handleRingNotificationEvent  Decline / Answer / Join / tap on the banner
//
// index.js and App.tsx call these; keep this file free of React so it can be
// imported from the headless (app-killed) JS context.

import { Platform } from 'react-native';
import { Event, EventType } from '@notifee/react-native';
import { parseRingData, parseCancelData, parseChatData } from './ringPayload';
import { displayChatNotification, handleChatEvent } from './chatNotifications';
import { displayIncomingCallNotifee, cancelRingNotification } from './incomingCallNotifee';
import {
  showIncoming,
  cancelIncomingByTarget,
  declineIncoming,
  enqueueRingAction,
} from './incomingRing';

/** App closed or in the background: draw the ringing notification. */
export async function handleRingPush(raw: any): Promise<void> {
  if (Platform.OS !== 'android') return; // iOS gets a normal visible push (see send-call-push)

  // A chat message: draw the WhatsApp-style message notification.
  const chat = parseChatData(raw);
  if (chat) {
    await displayChatNotification(chat);
    return;
  }

  const cancel = parseCancelData(raw);
  if (cancel) {
    cancelIncomingByTarget(cancel);
    return;
  }
  const ring = parseRingData(raw);
  if (!ring) return;
  await displayIncomingCallNotifee(ring);
}

/** App open: use the in-app banner (image 6) instead of a system notification. */
export function handleForegroundPush(raw: any): void {
  const cancel = parseCancelData(raw);
  if (cancel) {
    cancelIncomingByTarget(cancel);
    return;
  }
  const ring = parseRingData(raw);
  if (ring) showIncoming(ring);
}

/**
 * notifee events for the ringing notification. Used by BOTH
 * notifee.onBackgroundEvent (index.js) and notifee.onForegroundEvent /
 * getInitialNotification (notifeeCallNavigation.ts).
 */
export async function handleRingNotificationEvent(event: Event): Promise<void> {
  const { type, detail } = event;
  if (type !== EventType.PRESS && type !== EventType.ACTION_PRESS) return;

  // Tap / Reply / Mark as read / Mute on a chat-message notification
  const chat = parseChatData(detail.notification?.data);
  if (chat) {
    await handleChatEvent(event, chat);
    return;
  }

  const payload = parseRingData(detail.notification?.data);
  if (!payload) return;
  // A launch through the notification's FULL-SCREEN action (phone locked) has
  // no real "tap" behind it. The old code treated it as a tap: it cancelled the
  // notification (= the ringing stopped a few seconds after the app booted) and
  // started a second, silent in-app ring. That is why a locked phone did not
  // ring properly. A missing action id is treated the same way.
  const actionId = detail.pressAction?.id ?? 'fullscreen';

  if (actionId === 'fullscreen') {
    enqueueRingAction({ action: 'peek', payload });   // show the screen, keep ringing
    return;
  }

  if (actionId === 'decline') {
    // No app launch — declines silently from the notification.
    await declineIncoming(payload);
    return;
  }

  // Everything else opens the app. Stop the notification's own ringing now;
  // if the full-screen screen opens, the app rings by itself from there.
  await cancelRingNotification(payload);

  if (actionId === 'accept') {
    enqueueRingAction({
      action: payload.type === 'cowatch_invite' ? 'join' : 'answer',
      payload,
    });
  } else {
    // tap on the banner / full-screen intent -> image-3 screen
    enqueueRingAction({ action: 'open', payload });
  }
}
