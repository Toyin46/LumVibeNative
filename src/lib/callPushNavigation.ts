// src/lib/callPushNavigation.ts
//
// Handles an incoming-call push notification's tap — both the cold-start
// case (app was fully killed, tapping the notification just launched it)
// and the warm case (app already running, user taps the notification
// tray entry). Confirmed against ChatStack.tsx: the chat DM screen is
// registered there as 'ChatDM' inside the 'Messages' tab stack, so this
// navigates with the same nested-navigator form used elsewhere
// (navigation.navigate('Messages', { screen: 'ChatDM', params: {...} })).
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
  navRef.navigate('Messages', {
    screen: 'ChatDM',
    params: {
      id: data.conversationId,
      autoAnswerCall: true,
      autoAnswerCallType: data.callType,
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
        if (data && navRef.current?.isReady()) {
          navigateToCall(navRef.current, data);
        }
      });
    }

    // Warm case: app already running, user taps the notification tray.
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as any;
      if (data && navRef.current?.isReady()) {
        navigateToCall(navRef.current, data);
      }
    });
    return () => sub.remove();
  }, [navRef]);
}
