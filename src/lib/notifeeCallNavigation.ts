// src/lib/notifeeCallNavigation.ts   (REPLACES the old file)
//
// Reacts to taps on the ringing notification while the app is running or
// was just opened by the tap (cold start). The real logic lives in
// ringBackground.ts so the background handler in index.js uses the very
// same code. Fixes vs the old version:
//   • Decline pressed while the app was open used to open the chat instead
//     of declining (onForegroundEvent never handled it)
//   • on a cold start the tap was dropped when the navigator was not ready
//     yet — actions now wait in a queue until 'Main' exists
//   • the ringing notification was never cancelled after Answer

import { useEffect, useRef } from 'react';
import notifee, { EventType } from '@notifee/react-native';
import { handleRingNotificationEvent } from './ringBackground';
import { startRingActionRunner } from './incomingRing';

export function useNotifeeCallNavigation(_navRef?: unknown) {
  const handledColdStart = useRef(false);

  useEffect(() => {
    // drain anything queued by the background handler before we mounted
    const stopRunner = startRingActionRunner();

    if (!handledColdStart.current) {
      handledColdStart.current = true;
      notifee.getInitialNotification().then((initial) => {
        if (!initial) return;
        handleRingNotificationEvent({
          type: EventType.PRESS, // the pressAction id (accept / decline / open) decides what happens
          detail: { notification: initial.notification, pressAction: initial.pressAction },
        } as any).catch(() => {});
      }).catch(() => {});
    }

    const unsubscribe = notifee.onForegroundEvent((event) => {
      handleRingNotificationEvent(event).catch(() => {});
    });

    return () => { unsubscribe(); stopRunner(); };
  }, []);
}
