// lib/incomingCallNotifee.ts
//
// The ONE place that actually builds and shows the native, full-screen,
// looping-ring notification — for BOTH incoming calls and cowatch invites
// (extended to cowatch on request: "make cowatch work exactly like video
// and voice call"). Called from two places:
//   • index.js's setBackgroundMessageHandler — when the app is
//     backgrounded or fully killed.
//   • App.tsx's onMessage — when the app is already open (foreground), so
//     the experience is consistent everywhere instead of only working
//     when the app happens to be closed.
//
// IMPORTANT — division of responsibility, so nothing already working
// gets duplicated or fought over:
//   • This notification's ONLY job is to make Android actually RING
//     (loop a sound), show Answer/Decline (or Join/Dismiss for cowatch)
//     on a full-screen banner, and wake the device — the thing
//     expo-notifications categorically cannot do in the background
//     (documented Android limitation, see our earlier conversation).
//   • What happens when a button/the notification body is tapped is
//     handled by lib/notifeeCallNavigation.ts, which translates a notifee
//     event into the EXACT SAME route params (autoAnswerCall /
//     promptIncomingCall / promptIncomingCowatch) that chat/[id].tsx
//     already knows how to handle — no new UI, no new call/cowatch logic,
//     reusing everything already built and proven.
//   • The realtime call_signal / cowatch_invite banners inside
//     chat/[id].tsx are completely untouched and still fire instantly for
//     anyone already on that exact chat screen — this is purely an
//     ADDITIONAL layer for "not on that screen / app backgrounded / app
//     killed / foregrounded but on a different screen".
import notifee, {
    AndroidImportance,
    AndroidVisibility,
    AndroidCategory,
  } from '@notifee/react-native';
  
  export const INCOMING_CALL_CHANNEL_ID = 'incoming_call_v1';
  
  // ✅ Separate, NEW channel id — deliberately not reusing 'calls_v2'.
  // Remember: Android permanently locks a channel's sound/importance the
  // first time it's ever created on a device (this is exactly the bug we
  // fixed earlier by renaming 'calls' to 'calls_v2'). Since THIS channel
  // needs a different, more aggressive config (loopSound, CALL category)
  // than the plain 'calls_v2' notification channel, it needs its own,
  // never-before-used id so nothing it does can collide with or corrupt
  // the existing, already-working 'calls_v2' channel. Cowatch invites reuse
  // this SAME channel — there's nothing call-specific about the channel
  // itself, it's just "high-urgency, looping, full-screen" as a category.
  async function ensureIncomingCallChannel(): Promise<string> {
    return notifee.createChannel({
      id: INCOMING_CALL_CHANNEL_ID,
      name: 'Incoming Calls & Invites',
      importance: AndroidImportance.HIGH,
      sound: 'default',
      vibration: true,
      vibrationPattern: [0, 1000, 500, 1000, 500, 1000],
      visibility: AndroidVisibility.PUBLIC,
      bypassDnd: true,
    });
  }
  
  export interface IncomingCallNotifeeData {
    type: 'incoming_call';
    conversationId: string;
    callerId: string;
    callerName: string;
    callerPhoto?: string;
    callType: 'voice' | 'video';
    roomName: string;
  }
  
  // ✅ NEW: cowatch's equivalent shape — mirrors IncomingCallNotifeeData's
  // fields under cowatch's own naming (inviter instead of caller, sessionId
  // instead of roomName) so it slots into the exact same display/navigation
  // machinery without pretending a cowatch invite IS a call.
  export interface IncomingCowatchNotifeeData {
    type: 'cowatch_invite';
    conversationId: string;
    inviterId: string;
    inviterName: string;
    inviterPhoto?: string;
    sessionId: string;
  }
  
  type NotifeeRingData = IncomingCallNotifeeData | IncomingCowatchNotifeeData;
  
  /**
   * Displays the actual full-screen, ringing notification — for a call OR a
   * cowatch invite. Safe to call from a headless/background context
   * (index.js) or a live one (App.tsx) — doesn't depend on any React state,
   * navigation, or component tree.
   */
  export async function displayIncomingCallNotifee(data: NotifeeRingData) {
    const channelId = await ensureIncomingCallChannel();
    const isCowatch = data.type === 'cowatch_invite';
  
    const title = isCowatch
      ? 'Watch Together'
      : `Incoming ${(data as IncomingCallNotifeeData).callType === 'video' ? 'video' : 'voice'} call`;
    const body = isCowatch
      ? `${(data as IncomingCowatchNotifeeData).inviterName || 'Someone'} wants to watch together…`
      : `${(data as IncomingCallNotifeeData).callerName || 'Someone'} is calling…`;
    // ✅ NEW: caller/inviter avatar — shows as the notification's large
    // icon (a round photo, the same visual language WhatsApp uses) on
    // Android. Purely cosmetic if absent — falls back to the app icon.
    const photo = isCowatch
      ? (data as IncomingCowatchNotifeeData).inviterPhoto
      : (data as IncomingCallNotifeeData).callerPhoto;
    // Using the roomName/sessionId as the notification id means a second,
    // later push for the SAME call/invite (e.g. a duplicate delivery)
    // replaces the existing one instead of stacking a second banner.
    const notificationId = isCowatch
      ? `cowatch_${(data as IncomingCowatchNotifeeData).sessionId}`
      : `call_${(data as IncomingCallNotifeeData).roomName}`;
  
    await notifee.displayNotification({
      id: notificationId,
      title,
      body,
      data: data as any,
      android: {
        channelId,
        category: isCowatch ? AndroidCategory.SOCIAL : AndroidCategory.CALL,
        importance: AndroidImportance.HIGH,
        visibility: AndroidVisibility.PUBLIC,
        ...(photo ? { largeIcon: photo } : {}),
        // This is what makes it actually RING instead of chiming once —
        // loops the channel's sound continuously until answered, declined,
        // or it times out below. This is the single biggest reason this
        // whole native layer exists.
        loopSound: true,
        ongoing: true,
        autoCancel: false,
        // The actual "pop up over the lock screen, wake the device" part —
        // requires USE_FULL_SCREEN_INTENT (added in app.config.js) and
        // launches the app's normal entry point, same as any other tap.
        fullScreenAction: {
          id: 'default',
          launchActivity: 'default',
        },
        pressAction: {
          id: 'default',
          launchActivity: 'default',
        },
        actions: isCowatch
          ? [
              {
                title: 'Dismiss',
                pressAction: { id: 'dismiss' }, // no launchActivity — never opens the app, matches the in-app Dismiss behavior exactly
              },
              {
                title: 'Join',
                pressAction: { id: 'join', launchActivity: 'default' },
              },
            ]
          : [
              {
                title: 'Decline',
                pressAction: { id: 'decline' }, // no launchActivity — handled entirely in the background, app never opens
              },
              {
                title: 'Answer',
                pressAction: { id: 'answer', launchActivity: 'default' },
              },
            ],
        // Auto-clear after 30s — matches the existing ring timeout already
        // used elsewhere (chat/[id].tsx's incoming-call banner, cowatch
        // invite banner) for a consistent "give up after 30s" feel.
        timeoutAfter: 30000,
      },
    });
  }
  
  /** Cancels the ringing notification — called once a call/invite is
   * answered, declined, or ends some other way, so it doesn't keep ringing
   * after the fact. Safe to call even if there's nothing currently
   * displayed. Pass the roomName for a call, or the sessionId for a
   * cowatch invite. */
  export async function cancelIncomingCallNotifee(roomNameOrSessionId: string, isCowatch = false) {
    try {
      await notifee.cancelNotification(isCowatch ? `cowatch_${roomNameOrSessionId}` : `call_${roomNameOrSessionId}`);
    } catch (_) {}
  }
  