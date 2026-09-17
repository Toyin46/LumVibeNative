// lib/notifeeCallNavigation.ts
//
// Same job as callPushNavigation.ts, same navigation targets (imported
// directly from there — no duplicated logic), but reacting to notifee's
// event system instead of expo-notifications' — because the full-screen,
// looping-ring call notification is built with notifee (see
// lib/incomingCallNotifee.ts), and notifee has its own separate API for
// "what did the user do with this notification".
//
// Cold start (app was fully killed): notifee.getInitialNotification()
// Warm (app already running):        notifee.onForegroundEvent()
//
// 'decline' is deliberately NOT handled here at all — it has no
// launchActivity (see incomingCallNotifee.ts), so pressing it never
// brings the app to the foreground or cold-starts it in the first place;
// it's handled entirely inside index.js's notifee.onBackgroundEvent,
// which can broadcast the decline and log the call WITHOUT ever opening
// the app — a genuine improvement over the expo-notifications path,
// where "Decline" from a killed app previously did nothing at all.
import { useEffect, useRef } from 'react';
import { NavigationContainerRef } from '@react-navigation/native';
import notifee, { EventType } from '@notifee/react-native';
import {
  navigateToCall,
  navigateToIncomingPrompt,
} from './callPushNavigation';

function handleNotifeeCallEvent(
  navRef: NavigationContainerRef<any>,
  data: any,
  pressActionId: string | undefined,
) {
  if (data?.type !== 'incoming_call') return;
  if (pressActionId === 'answer') {
    // notifee's Answer button reliably renders and works even with the
    // app fully killed (unlike expo-notifications' categories) — so
    // unlike the plain-push path, honoring a real auto-answer here is
    // safe and matches what a person actually pressed.
    navigateToCall(navRef, data);
  } else {
    // Plain tap on the body, or the full-screen banner itself was tapped
    // — show the real chooser, same as everywhere else in the app.
    navigateToIncomingPrompt(navRef, data);
  }
}

export function useNotifeeCallNavigation(
  navRef: React.RefObject<NavigationContainerRef<any> | null>,
) {
  const handledColdStart = useRef(false);

  useEffect(() => {
    if (!handledColdStart.current) {
      handledColdStart.current = true;
      notifee.getInitialNotification().then((initial) => {
        if (!initial || !navRef.current?.isReady()) return;
        handleNotifeeCallEvent(
          navRef.current,
          initial.notification.data,
          initial.pressAction?.id,
        );
      }).catch(() => {});
    }

    const unsubscribe = notifee.onForegroundEvent(({ type, detail }) => {
      if (type !== EventType.PRESS && type !== EventType.ACTION_PRESS) return;
      if (!navRef.current?.isReady()) return;
      handleNotifeeCallEvent(
        navRef.current,
        detail.notification?.data,
        detail.pressAction?.id,
      );
    });

    return () => unsubscribe();
  }, [navRef]);
}
