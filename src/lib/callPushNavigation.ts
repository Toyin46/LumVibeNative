// src/lib/callPushNavigation.ts
//
// Handles an incoming-call push notification's tap — both the cold-start
// case (app was fully killed, tapping the notification just launched it)
// and the warm case (app already running, user taps the notification
// tray entry). Confirmed against ChatStack.tsx + RootNavigator.tsx: the
// chat DM screen is registered as 'ChatDM' inside the 'Messages' tab,
// which is itself nested inside the root Stack's 'Main' screen — so
// reaching it from this root-level nav ref needs the full 3-level path
// (navigate('Main', { screen: 'Messages', params: { screen: 'ChatDM',
// params: {...} } })), matching the pattern used in
// notificationPushNavigation.ts.
//
// WHY THIS CAN'T LIVE IN chat/[id].tsx: that's a screen component — its
// code only runs while that screen is mounted. Nothing is mounted yet
// when the app is fully killed, so only code at the actual app entry
// point (App.tsx, before any screen exists) can catch "the user tapped a
// notification that just cold-started the app" and steer that very first
// navigation. This hook is that code.
//
// WHAT THIS GIVES YOU:
// - Android: a real "Incoming call" push shows up even if the app was
//   fully force-quit. Tapping it cold-starts the app straight into
//   ChatDM with autoAnswerCall=true, which chat/[id].tsx already uses to
//   auto-join the LiveKit room.
// - iOS: this works whenever the app is foregrounded or backgrounded
//   (not force-quit). The same "ring while fully killed" behavior on iOS,
//   the way a real phone call does, needs PushKit VoIP pushes + CallKit —
//   a separate, native-level integration (Apple requires CallKit whenever
//   you use VoIP pushes, plus a VoIP push certificate). Flagging this
//   clearly rather than claiming this hook does something it doesn't on
//   iOS.

import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import type { NavigationContainerRef } from '@react-navigation/native';

// Show the notification banner/sound even while the app is in the
// foreground (Expo suppresses foreground notifications by default).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // FIX: shouldShowAlert was replaced by shouldShowBanner/shouldShowList
    // in current expo-notifications versions — TS now requires both
    // (NotificationBehavior no longer has shouldShowAlert at all).
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function navigateToCall(navRef: NavigationContainerRef<any>, data: any) {
  if (data?.type !== 'incoming_call') return;
  // FIX: 'Messages' is a tab nested inside the root Stack's 'Main' screen
  // (see RootNavigator.tsx -> MainTabs.tsx), not a root-level screen name
  // itself — confirmed by cross-checking notificationPushNavigation.ts,
  // which uses this same 3-level form for its own chat navigation. Calling
  // navigate('Messages', ...) directly on the root ref, without 'Main' as
  // the outer level, was inconsistent with that confirmed-working pattern.
  navRef.navigate('Main', {
    screen: 'Messages',
    params: {
      screen: 'ChatDM',
      params: {
        id: data.conversationId,
        // ✅ FIX: chat/[id].tsx reads otherUserId/otherName purely from
        // route params — it never looks them up itself. Without these,
        // a call answered from a cold-started/backgrounded push left the
        // whole screen not knowing who the other person even was for the
        // rest of that session (presence dot, and critically, hanging up
        // and calling back would have no calleeId to push to). The
        // send-call-push payload already includes callerId/callerName —
        // this just forwards them.
        otherUserId: data.callerId,
        otherName:   data.callerName,
        autoAnswerCall: true,
        autoAnswerCallType: data.callType,
      },
    },
  });
}

// ✅ NEW: opens the conversation WITHOUT auto-joining the call — used for
// the Decline action, so declining still lands the user somewhere
// sensible (the chat itself) instead of silently doing nothing visible
// when the app cold-starts from a Decline tap.
// ✅ FIX (fix #2 — missed calls): also handles 'missed_call' pushes now,
// so tapping the notification body (or its "Message" action) just opens
// the chat, matching image 3's "Message" button.
function navigateToChatOnly(navRef: NavigationContainerRef<any>, data: any) {
  if (data?.type !== 'incoming_call' && data?.type !== 'missed_call') return;
  navRef.navigate('Main', {
    screen: 'Messages',
    params: {
      screen: 'ChatDM',
      params: {
        id: data.conversationId,
        otherUserId: data.callerId,
        otherName:   data.callerName,
      },
    },
  });
}

// ✅ NEW (fix #2 — missed call "Call back" action): mirrors navigateToCall
// above but sets autoStartCall instead of autoAnswerCall. Requires a
// matching effect in chat/[id].tsx that reads autoStartCall/
// autoStartCallType from route params and calls startCall() once on
// mount — the outbound-call equivalent of the existing autoAnswerCall
// effect there.
function navigateToStartCall(navRef: NavigationContainerRef<any>, data: any) {
  if (data?.type !== 'missed_call') return;
  navRef.navigate('Main', {
    screen: 'Messages',
    params: {
      screen: 'ChatDM',
      params: {
        id: data.conversationId,
        // ✅ FIX: startCall() only sends a push at all when otherUserId is
        // set (`if (otherUserId) { sendCallPush(...) }`) — without this,
        // tapping "Call back" against someone whose app is closed would
        // ring silently on their end via realtime-only (i.e. not at all).
        otherUserId: data.callerId,
        otherName:   data.callerName,
        autoStartCall: true,
        autoStartCallType: data.callType,
      },
    },
  });
}

/**
 * Call once from your root component, passing the same ref you give to
 * <NavigationContainer ref={navigationRef}>.
 */
// FIX: useRef<NavigationContainerRef<any>>(null) produces
// RefObject<NavigationContainerRef<any> | null> (the ref can legitimately
// be null before NavigationContainer mounts) — but this was typed to
// require a non-null RefObject, which is what TypeScript was rejecting in
// App.tsx. Allowing | null here matches what useRef(null) actually returns.
export function useCallPushNavigation(navRef: React.RefObject<NavigationContainerRef<any> | null>) {
  const handledColdStart = useRef(false);

  useEffect(() => {
    // Cold start: app was fully killed, user tapped the notification, and
    // this is the very first render — grab the response that caused it.
    if (!handledColdStart.current) {
      handledColdStart.current = true;
      Notifications.getLastNotificationResponseAsync().then((response) => {
        const data = response?.notification.request.content.data as any;
        if (!data || !navRef.current?.isReady()) return;
        handleCallResponse(navRef.current, data, response!.actionIdentifier);
      });
    }

    // Warm case: app already running, user taps the notification tray.
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as any;
      if (!data || !navRef.current?.isReady()) return;
      handleCallResponse(navRef.current, data, response.actionIdentifier);
    });
    return () => sub.remove();
  }, [navRef]);
}

// ✅ FIX (fix #2): this never checked WHICH action was tapped for a plain
// incoming call — Decline and Answer (and just tapping the notification
// body) all did the exact same thing: navigate in and auto-join the call.
// Declining now genuinely declines instead of joining anyway. Also
// branches on the two new missed_call actions (image 3's "Call back" /
// "Message" buttons) — see navigateToStartCall/navigateToChatOnly above.
function handleCallResponse(navRef: NavigationContainerRef<any>, data: any, actionIdentifier: string) {
  if (data?.type === 'missed_call') {
    if (actionIdentifier === 'call_back') {
      navigateToStartCall(navRef, data);
    } else {
      // 'message' action, or just tapping the notification body.
      navigateToChatOnly(navRef, data);
    }
    return;
  }
  if (actionIdentifier === 'decline') {
    navigateToChatOnly(navRef, data);
  } else {
    navigateToCall(navRef, data);
  }
}
