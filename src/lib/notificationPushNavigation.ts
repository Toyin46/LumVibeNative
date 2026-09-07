// src/lib/notificationPushNavigation.ts
//
// Wires up tapping a push notification — whether the app is backgrounded,
// or fully closed and the tap itself launches it — to navigate to the
// right screen. Same pattern/location as the existing
// src/lib/callPushNavigation.ts (which already does this for incoming-call
// pushes specifically), but for the general notification types
// (follow/like/comment/coin/mention) sent by sendPushNotification() in
// utils/pushNotifications.ts.
//
// IMPORTANT: this hook only handles the exact types it explicitly
// recognizes below. Anything else (including 'call', or any future type)
// is deliberately left completely untouched — expo-notifications allows
// multiple listeners to fire for the same tap, and callPushNavigation.ts
// is already registered separately for call pushes. If this hook grabbed
// every unrecognized type as a catch-all, it would race with that existing
// hook every time a call notification was tapped. So: known types get
// routed here, everything else is silently ignored and left for whichever
// other listener actually owns it.
//
// Handles two separate cases, both required for this to actually work:
//   1. App already running (foreground/background) — the live listener.
//   2. App was fully closed and the tap is what launched it (cold start) —
//      getLastNotificationResponseAsync(), checked once on mount, since the
//      live listener alone is registered too late to catch this case.

import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import type { NavigationContainerRef } from '@react-navigation/native';

// Matches PushNotificationData in utils/pushNotifications.ts — the only
// types actually ever sent via push right now.
type KnownPushType = 'like' | 'comment' | 'follow' | 'mention' | 'coin' | 'message' | 'cowatch_invite';

function navigateForPushData(
  navigationRef: React.RefObject<NavigationContainerRef<any> | null>,
  data: Record<string, any>
) {
  if (!navigationRef.current) return;
  const type = data.type as KnownPushType | undefined;
  // ✅ FIX: casting each navigate() argument separately to `never` (the
  // previous approach) breaks TypeScript's ability to match ANY of
  // NavigationContainerRef's overloaded navigate() signatures — a two-arg
  // call where both args are individually `never` doesn't satisfy the
  // tuple-based overloads, hence "[never, never] is not assignable to
  // never". Casting `nav` itself to `any` once, up front, sidesteps the
  // overload resolution entirely instead of fighting it argument-by-argument.
  const nav = navigationRef.current as any;

  switch (type) {
    case 'follow':
      // FIX (corrected): notificationHelpers.ts (the file actually used by
      // chat/[id].tsx, and almost certainly by the like/comment/follow
      // buttons elsewhere too, given it has ready-made handlers for all of
      // them) sends fromUserId in camelCase via sendPushNotification() —
      // a different, separate system from lib/notifications.ts's
      // sendPushAndStore, which uses snake_case. My previous pass assumed
      // the snake_case convention applied everywhere; it doesn't. Reverted
      // to camelCase here, now backed by the actual sending code.
      if (data.fromUserId) {
        nav.navigate('UserProfile', { userId: data.fromUserId });
      }
      break;

    // ✅ NEW: tapping a message push (from outside the app or backgrounded)
    // now lands directly in that conversation, matching the in-app tap
    // handler in notification.tsx. fromPhoto now comes through too (see
    // notificationHelpers.ts's notifyNewMessage, which was just updated
    // to send it) — falls back to '' only if the sender genuinely had no
    // photo set.
    case 'message':
      if (data.conversationId && data.fromUserId) {
        nav.navigate('Main', {
          screen: 'Messages',
          params: {
            screen: 'ChatDM',
            params: {
              id:          data.conversationId,
              otherUserId: data.fromUserId,
              otherName:   data.fromUsername || 'User',
              otherPhoto:  data.fromPhoto || '',
            },
          },
        });
      }
      break;

    // ✅ NEW: previously missing entirely — tapping a "wants to watch
    // together" push did nothing. notifyCowatchInvite (lib/notifications.ts)
    // builds this payload by hand rather than through sendPushAndStore, so
    // unlike the cases above, conversationId/sessionId/otherName here ARE
    // already camelCase as sent — no field-name mismatch on this one.
    // Screen name and param shape confirmed against ChatStackTypes.ts:
    // registered as 'Cowatch' (capital C only) inside the 'Messages' tab.
    case 'cowatch_invite':
      if (data.conversationId && data.sessionId) {
        nav.navigate('Main', {
          screen: 'Messages',
          params: {
            screen: 'Cowatch',
            params: {
              conversationId: data.conversationId,
              sessionId:      data.sessionId,
              otherName:      data.otherName || 'Someone',
            },
          },
        });
      }
      break;

    case 'like':
    case 'comment':
    case 'coin':
    case 'mention':
      // FIX (corrected): same camelCase correction as 'follow'/'message'
      // above — notificationHelpers.ts sends postId, not post_id.
      if (data.postId) {
        nav.navigate('PostDetail', { postId: data.postId });
      }
      break;

    // Anything else (including 'call', or no type at all) is deliberately
    // left alone — see the file-level note above for why.
    default:
      break;
  }
}

export function useNotificationPushNavigation(
  // ✅ FIX: useRef<T>(null) actually produces RefObject<T | null> — the
  // parameter type here didn't allow null, which is why App.tsx's
  // navigationRef (created exactly that way) failed to type-check against
  // it. Matches the real shape useRef produces instead of an idealized one.
  navigationRef: React.RefObject<NavigationContainerRef<any> | null>
) {
  useEffect(() => {
    // Case 1: app already running, tap arrives via the live listener.
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as any;
      navigateForPushData(navigationRef, data || {});
    });

    // Case 2: app was fully closed — the tap is what launched it. The live
    // listener above is registered too late to have caught that original
    // tap, so this checks for it once, right after mount.
    Notifications.getLastNotificationResponseAsync().then(response => {
      if (!response) return;
      const data = response.notification.request.content.data as any;
      navigateForPushData(navigationRef, data || {});
    });

    return () => subscription.remove();
  }, [navigationRef]);
}
