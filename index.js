import './polyfills';
import { registerGlobals } from '@livekit/react-native';
registerGlobals()

// ✅ NEW (native incoming-call UI): this MUST be registered here, at the
// very top of the entry point, before registerRootComponent — this is
// what lets it run in a headless JS context even when the app process is
// completely killed, which is the whole point. Registering it any later
// (e.g. inside App.tsx, which only runs once a component tree exists)
// would miss exactly the "app fully closed" case this was built for.
//
// ✅ FIX: the version of @react-native-firebase/messaging that got
// installed is on the current "modular" API — the old
// `import messaging from '@react-native-firebase/messaging'` default
// export was REMOVED (confirmed: this is a real, intentional breaking
// change in recent react-native-firebase versions, not a bug). The
// correct current pattern is named imports + getMessaging().
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import notifee, { EventType } from '@notifee/react-native';
import { Platform } from 'react-native';
import { displayIncomingCallNotifee, cancelIncomingCallNotifee } from './src/lib/incomingCallNotifee';
import { supabase } from './src/config/supabase';

const messagingInstance = getMessaging();

setBackgroundMessageHandler(messagingInstance, async (remoteMessage) => {
  // ✅ FIX: this file is index.js, not index.ts — TypeScript syntax like
  // `as any` or `: string` type annotations is invalid here and was
  // rightly flagged by the editor. Plain JS only below.
  const data = remoteMessage.data;
  // ✅ iOS now receives incoming-call pushes as a normal, visible
  // notification (title/body — see send-call-push's isIOS branch), which
  // iOS displays natively on its own. Without this guard, this handler
  // would ALSO fire on iOS and draw a second, duplicate notifee
  // notification on top of it. Android still has no title/body on this
  // message type at all, so it depends entirely on this handler to show
  // anything.
  if (data && data.type === 'incoming_call' && Platform.OS === 'android') {
    await displayIncomingCallNotifee(data);
  }
});

// Handles the "Decline" button specifically — see incomingCallNotifee.ts's
// comment on why this action has no launchActivity: this lets Decline
// genuinely decline (broadcast + log the call) WITHOUT ever opening the
// app at all, which the old expo-notifications-only setup could never do
// from a killed state.
notifee.onBackgroundEvent(async ({ type, detail }) => {
  if (type !== EventType.ACTION_PRESS) return;
  const data = detail.notification && detail.notification.data;
  if (!data || data.type !== 'incoming_call') return;

  await cancelIncomingCallNotifee(data.roomName);

  if (detail.pressAction && detail.pressAction.id === 'decline') {
    try {
      // Same broadcast shape chat/[id].tsx's declineCall already listens
      // for on the call_signal channel — the caller's screen (if open)
      // reacts to this exactly the same as an in-app decline.
      const channel = supabase.channel(`call_signal:${data.conversationId}`, {
        config: { broadcast: { self: false } },
      });
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          channel.send({
            type: 'broadcast',
            event: 'call_declined',
            payload: { roomName: data.roomName },
          }).finally(() => { supabase.removeChannel(channel); });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          supabase.removeChannel(channel);
        }
      });
      // Log it the same way a normal in-app decline does, so the call
      // history shows "Declined" instead of just vanishing with nothing
      // recorded — mirrors insertCallLogMessage's shape in chat/[id].tsx.
      await supabase.from('messages').insert({
        conversation_id: data.conversationId,
        sender_id: data.callerId,
        message_type: 'call_log',
        content: JSON.stringify({ callType: data.callType, outcome: 'declined' }),
      });
    } catch (e) {
      console.warn('background decline handling error:', e);
    }
  }
});

import { registerRootComponent } from "expo";
import App from './App'

registerRootComponent(App);
