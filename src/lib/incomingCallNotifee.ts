// src/lib/incomingCallNotifee.ts   (REPLACES the old file)
//
// Builds the system notification that rings when the app is CLOSED or in the
// BACKGROUND — the "image 1" look:
//   • caller's round profile photo on the left, LumVibe logo badge on it
//   • caller name as the title, "Incoming voice call" under it
//   • [Decline] [Answer]      (video call: [Decline] [Video])
//   • Watch Together invite:  [Decline] [Join]
//   • loops a real ringtone (res/raw/ringtone.mp3) until answered / declined /
//     cancelled / 30 s pass
//
// What each tap does is handled in ringBackground.ts:
//   Decline        -> declines without opening the app
//   Answer / Join  -> opens the app and connects (call joins the room,
//                     cowatch opens the shared feed)
//   tap on body    -> opens the app on the full-screen "image 3" screen
//                     (Decline / Swipe up to accept / Message)

import notifee, {
  Notification,
  AndroidImportance,
  AndroidVisibility,
  AndroidCategory,
  AndroidStyle,
} from '@notifee/react-native';
import * as Notifications from 'expo-notifications';
import { RingPayload, ringNotificationId } from './ringPayload';

// TWO channels, one per sound (a channel's sound can't change per message):
//   calls          -> ringtone.mp3.wav        (voice + video)
//   watch invites  -> cowatch ringtone.mp3
// New ids on purpose: Android locks a channel's sound/importance forever the
// first time it is created on a device, so the old 'incoming_call_v1/v2'
// (default chime) can never be fixed in place.
//
// The sound files are copied into android/app/src/main/res/raw by
// plugins/withRingSounds.js under safe names (Android resource names can't
// contain spaces, capitals or extra dots, and "ringtone.mp3.wav" has one):
//   src/assets/sounds/ringtone.mp3.wav      -> res/raw/call_ringtone.wav
//   src/assets/sounds/cowatch ringtone.mp3  -> res/raw/cowatch_ringtone.mp3
interface RingChannel { id: string; name: string; resName: string; file: string }
export const CALL_CHANNEL: RingChannel = {
  id: 'incoming_call_v3', name: 'Incoming calls', resName: 'call_ringtone', file: 'call_ringtone.wav',
};
export const COWATCH_CHANNEL: RingChannel = {
  id: 'incoming_cowatch_v1', name: 'Watch Together invites', resName: 'cowatch_ringtone', file: 'cowatch_ringtone.mp3',
};
export const INCOMING_CALL_CHANNEL_ID = CALL_CHANNEL.id;

// White-on-transparent logo in res/drawable — the "LumVibe logo at the
// bottom of the photo". The expo-notifications plugin `icon` option creates
// it as `notification_icon` (from src/assets/images/notification-icon.png).
const SMALL_ICON = 'notification_icon';
const BRAND_COLOR = '#00e676';

// Name registered in index.js with AppRegistry. When the phone is LOCKED (or
// the screen is off) Android launches this full-screen screen over the lock
// screen instead of the app (see IncomingCallLockScreen.tsx).
export const LOCKSCREEN_COMPONENT = 'lumvibe-incoming-call';

const RING_TIMEOUT_MS = 90000; // rings 1 min 30 s, then goes away by itself
const VIBRATION = [0, 1000, 700, 1000, 700, 1000];

const channelPromises: Record<string, Promise<string>> = {};

/**
 * Creates one ringing channel (once). Expo's channel API is used because it is
 * the only one that can set the audio USAGE to NOTIFICATION_RINGTONE, so the
 * sound follows the phone's *ringtone* volume like a real call. notifee's own
 * createChannel is the fallback. Called for both channels at app start
 * (App.tsx), so on a real ring the channel already exists.
 */
function ensureChannel(ch: RingChannel): Promise<string> {
  const existing: Promise<string> | undefined = channelPromises[ch.id];
  if (existing) return existing;
  const promise = (async () => {
    try {
      if (await notifee.getChannel(ch.id)) return ch.id;
    } catch (_) {}

    try {
      await Notifications.setNotificationChannelAsync(ch.id, {
        name: ch.name,
        importance: Notifications.AndroidImportance.MAX,
        sound: ch.file,
        vibrationPattern: VIBRATION,
        enableVibrate: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: true,
        showBadge: false,
        audioAttributes: {
          usage: Notifications.AndroidAudioUsage.NOTIFICATION_RINGTONE,
          contentType: Notifications.AndroidAudioContentType.SONIFICATION,
        },
      });
    } catch (e) {
      console.warn('[ring] expo channel create failed, falling back to notifee:', e);
    }

    try {
      if (!(await notifee.getChannel(ch.id))) {
        await notifee.createChannel({
          id: ch.id,
          name: ch.name,
          importance: AndroidImportance.HIGH,
          sound: ch.resName,
          vibration: true,
          vibrationPattern: VIBRATION,
          visibility: AndroidVisibility.PUBLIC,
          bypassDnd: true,
        });
      }
    } catch (e) {
      console.warn('[ring] notifee channel create failed:', e);
    }
    return ch.id;
  })();
  channelPromises[ch.id] = promise;
  // If something threw, allow a later retry instead of caching the failure.
  promise.catch(() => { delete channelPromises[ch.id]; });
  return promise;
}

/** Creates both channels. Called at app start. */
export async function ensureIncomingCallChannel(): Promise<string> {
  await ensureChannel(COWATCH_CHANNEL);
  return ensureChannel(CALL_CHANNEL);
}

export function ringBodyText(p: RingPayload): string {
  if (p.type === 'cowatch_invite') return '🎬 Wants to watch together';
  return p.callType === 'video' ? '📹 Incoming video call' : 'Incoming voice call';
}

export function ringAcceptLabel(p: RingPayload): string {
  if (p.type === 'cowatch_invite') return 'Join';
  return p.callType === 'video' ? 'Video' : 'Answer';
}

/**
 * Shows the ringing notification. Works from a headless context (app killed)
 * — it depends on no React state and no navigation.
 */
export async function displayIncomingCallNotifee(p: RingPayload): Promise<void> {
  const isCowatch = p.type === 'cowatch_invite';
  const channelId = await ensureChannel(isCowatch ? COWATCH_CHANNEL : CALL_CHANNEL);
  const body = ringBodyText(p);
  const name = p.fromName || 'Someone';

  const build = (withSmallIcon: boolean, withStyle: boolean, withLockScreen: boolean): Notification => ({
    id: ringNotificationId(p),
    title: name,
    body,
    data: {
      type: p.type, id: p.id, conversationId: p.conversationId,
      fromId: p.fromId, fromName: name, fromPhoto: p.fromPhoto || '',
      ...(p.callType ? { callType: p.callType } : {}),
      ...(p.roomName ? { roomName: p.roomName } : {}),
      ...(p.sessionId ? { sessionId: p.sessionId } : {}),
    } as Record<string, string>,
    android: {
      channelId,
      ...(withSmallIcon ? { smallIcon: SMALL_ICON } : {}),
      color: BRAND_COLOR,
      category: isCowatch ? AndroidCategory.SOCIAL : AndroidCategory.CALL,
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PUBLIC,
      // Round caller photo. (Conversation-style notifications also get the
      // app-logo badge on the avatar on Android 11+.)
      ...(p.fromPhoto ? { largeIcon: p.fromPhoto, circularLargeIcon: true } : {}),
      // Same layout WhatsApp shows: name on top, "Incoming voice call" under.
      ...(withStyle
        ? {
            style: {
              type: AndroidStyle.MESSAGING,
              person: { name, ...(p.fromPhoto ? { icon: p.fromPhoto } : {}) },
              messages: [{ text: body, timestamp: Date.now() }],
            },
          }
        : {}),
      // Keep ringing (sound loops) until it is answered/declined/cancelled.
      loopSound: true,
      ongoing: true,
      autoCancel: false,
      onlyAlertOnce: false,
      showTimestamp: true,
      timestamp: Date.now(),
      timeoutAfter: RING_TIMEOUT_MS,
      // Phone locked / screen off: Android shows the full-screen call screen
      // (Decline / Swipe up to accept / Message) OVER the lock screen and
      // turns the display on. Phone in use: it stays a heads-up banner.
      fullScreenAction: withLockScreen
        ? { id: 'fullscreen', mainComponent: LOCKSCREEN_COMPONENT }
        : { id: 'fullscreen', launchActivity: 'default' },
      // Tap on the banner itself -> app opens on the image-3 screen.
      pressAction: { id: 'open', launchActivity: 'default' },
      actions: [
        {
          title: 'Decline',
          // No launchActivity: declining never opens the app.
          pressAction: { id: 'decline' },
        },
        {
          title: `<p style="color:${BRAND_COLOR};"><b>${ringAcceptLabel(p)}</b></p>`,
          pressAction: { id: 'accept', launchActivity: 'default' },
        },
      ],
    },
  });

  // Three attempts, most complete first, so a problem with one nice-to-have
  // (lock-screen component, logo icon, conversation style) can never stop the
  // phone from ringing at all.
  const attempts: Array<[boolean, boolean, boolean]> = [
    [true, true, true],    // logo icon + conversation style + lock-screen screen
    [true, true, false],   // same, lock screen opens the app instead
    [false, false, false], // bare minimum
  ];
  for (const [icon, style, lock] of attempts) {
    try {
      await notifee.displayNotification(build(icon, style, lock));
      return;
    } catch (e) {
      console.warn('[ring] displayNotification attempt failed, trying simpler one:', e);
    }
  }
}

/** Stops the ring for a call / invite. Safe if nothing is showing. */
export async function cancelRingNotification(t: { type: string; roomName?: string; sessionId?: string }) {
  try {
    await notifee.cancelNotification(ringNotificationId(t));
  } catch (_) {}
}

/** Back-compat with the old signature. */
export async function cancelIncomingCallNotifee(roomNameOrSessionId: string, isCowatch = false) {
  await cancelRingNotification(
    isCowatch
      ? { type: 'cowatch_invite', sessionId: roomNameOrSessionId }
      : { type: 'incoming_call', roomName: roomNameOrSessionId },
  );
}
