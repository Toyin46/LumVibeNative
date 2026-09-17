// lib/incomingCallNotifee.ts
//
// The ONE place that actually builds and shows the native, full-screen,
// looping-ring incoming-call notification. Called from two places:
//   • index.js's messaging().setBackgroundMessageHandler — when the app
//     is backgrounded or fully killed.
//   • App.tsx's messaging().onMessage — when the app is already open
//     (foreground), so the experience is consistent everywhere instead
//     of only working when the app happens to be closed.
//
// IMPORTANT — division of responsibility, so nothing already working
// gets duplicated or fought over:
//   • This notification's ONLY job is to make Android actually RING
//     (loop a sound), show Answer/Decline on a full-screen banner, and
//     wake the device — the thing expo-notifications categorically
//     cannot do in the background (documented Android limitation, see
//     our earlier conversation).
//   • What happens when Answer/Decline/the notification body is tapped
//     is handled by lib/notifeeCallNavigation.ts, which translates a
//     notifee event into the EXACT SAME route params
//     (autoAnswerCall / promptIncomingCall) that chat/[id].tsx already
//     knows how to handle — no new UI, no new call logic, reusing
//     everything already built and proven.
//   • The realtime call_signal banner inside chat/[id].tsx is completely
//     untouched and still fires instantly for anyone already on that
//     exact chat screen — this is purely an ADDITIONAL layer for
//     "not on that screen / app backgrounded / app killed".
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
  // the existing, already-working 'calls_v2' channel.
  async function ensureIncomingCallChannel(): Promise<string> {
    return notifee.createChannel({
      id: INCOMING_CALL_CHANNEL_ID,
      name: 'Incoming Calls',
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
    callType: 'voice' | 'video';
    roomName: string;
  }
  
  /**
   * Displays the actual full-screen, ringing call notification. Safe to call
   * from a headless/background context (index.js) or a live one (App.tsx) —
   * doesn't depend on any React state, navigation, or component tree.
   */
  export async function displayIncomingCallNotifee(data: IncomingCallNotifeeData) {
    const channelId = await ensureIncomingCallChannel();
  
    // Using the roomName as the notification id means a second, later push
    // for the SAME call (e.g. a duplicate delivery) replaces the existing
    // one instead of stacking a second ringing banner on top of it.
    await notifee.displayNotification({
      id: `call_${data.roomName}`,
      title: `Incoming ${data.callType === 'video' ? 'video' : 'voice'} call`,
      body: `${data.callerName || 'Someone'} is calling…`,
      data: data as any,
      android: {
        channelId,
        category: AndroidCategory.CALL,
        importance: AndroidImportance.HIGH,
        visibility: AndroidVisibility.PUBLIC,
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
        actions: [
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
  
  /** Cancels the ringing notification — called once a call is answered,
   * declined, or ends some other way, so it doesn't keep ringing after the
   * fact. Safe to call even if there's nothing currently displayed. */
  export async function cancelIncomingCallNotifee(roomName: string) {
    try {
      await notifee.cancelNotification(`call_${roomName}`);
    } catch (_) {}
  }
  