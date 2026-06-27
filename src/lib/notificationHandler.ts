// FILE: lib/notificationHandler.ts
// ─────────────────────────────────────────────────────────────
// Kinsta — Push Notification Deep Link Handler
//
// HOW TO USE:
//   Import and call `useNotificationHandler()` inside your
//   root _layout.tsx, ONCE, at the top level.
//
//   Example (_layout.tsx):
//     import { useNotificationHandler } from '@/lib/notificationHandler';
//     export default function RootLayout() {
//       useNotificationHandler();
//       return <Stack />;
//     }
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

// ── Configure how notifications appear when app is OPEN ──────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert:  true,
    shouldShowBanner: true,
    shouldShowList:   true,
    shouldPlaySound:  true,
    shouldSetBadge:   true,
  }),
});

// ── Android notification channel ─────────────────────────────
export async function setupAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name:              'Kinsta Notifications',
    importance:        Notifications.AndroidImportance.MAX,
    vibrationPattern:  [0, 250, 250, 250],
    lightColor:        '#00e676',
    sound:             'default',
  });
}

// ── Deep-link router ─────────────────────────────────────────
function handleDeepLink(data: Record<string, any>) {
  if (!data || !data.type) return;

  console.log('🔔 Push notification tapped:', data.type, data);

  switch (data.type) {
    case 'cowatch_invite':
      // Navigate directly into the CoWatch screen as a joiner
      if (data.conversationId && data.sessionId) {
        router.push({
          pathname: '/chat/cowatch',
          params: {
            conversationId: data.conversationId,
            sessionId:      data.sessionId,
            otherName:      data.otherName || 'Partner',
            otherPhoto:     data.otherPhoto || '',
          },
        } as any);
      }
      break;

    case 'like':
    case 'comment':
    case 'gift':
    case 'coin':
    case 'mention':
      if (data.post_id) {
        router.push(`/post/${data.post_id}` as any);
      }
      break;

    case 'follow':
      if (data.from_user_id) {
        router.push(`/user/${data.from_user_id}` as any);
      }
      break;

    case 'message':
      if (data.id) {
        router.push(`/chat/${data.id}` as any);
      }
      break;

    case 'referral_commission':
    case 'achievement':
      router.push('/(tabs)/profile' as any);
      break;

    case 'marketplace':
      router.push('/(tabs)/marketplace' as any);
      break;

    default:
      router.push('/(tabs)/notification' as any);
      break;
  }
}

// ── Main hook — call once in root _layout.tsx ─────────────────
export function useNotificationHandler() {
  const notifListenerRef  = useRef<Notifications.Subscription | null>(null);
  const responseListenerRef = useRef<Notifications.Subscription | null>(null);

  useEffect(() => {
    // Setup Android channel
    setupAndroidChannel();

    // Handle taps on notifications received while app is OPEN
    notifListenerRef.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        // You can update badge count or show an in-app banner here
        console.log('🔔 Notification received (app open):', notification.request.content.title);
      }
    );

    // Handle taps on notifications (app open OR backgrounded)
    responseListenerRef.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as Record<string, any>;
        handleDeepLink(data);
      }
    );

    // Handle cold-start: app was CLOSED when user tapped notification
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        const data = response.notification.request.content.data as Record<string, any>;
        // Small delay to let the navigator mount before pushing
        setTimeout(() => handleDeepLink(data), 800);
      }
    });

    return () => {
      notifListenerRef.current?.remove();
      responseListenerRef.current?.remove();
    };
  }, []);
} 
