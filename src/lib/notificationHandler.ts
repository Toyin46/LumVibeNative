// FILE: lib/notificationHandler.ts
// ─────────────────────────────────────────────────────────────
// Kinsta — Push Notification Deep Link Handler
//
// HOW TO USE:
//   Import and call `useNotificationHandler()` inside your
//   root App.tsx / RootNavigator, ONCE, at the top level of a
//   component that's rendered inside <NavigationContainer>.
//
// ✅ CRITICAL FIX: `const navigation = useNavigation<any>();` was at
//    MODULE scope — outside any component, in a plain .ts utility file.
//    This is the same class of bug as the earlier signup.tsx crash, but
//    worse here: this file isn't a component at all, so the hook would
//    fail every time the module loads, before any navigator even exists.
//    Fixed by moving useNavigation() inside useNotificationHandler()
//    itself (a proper hook, correctly called from a component's render),
//    and passing `navigation` into handleDeepLink() as a parameter.
// ✅ Removed unused `import { router } from 'expo-router'`.
// ✅ Fixed navigate paths to real React Navigation screen names:
//      /post/${id}      → PostDetail, { postId }
//      /user/${id}      → UserProfile, { userId }
//      /(tabs)/profile  → Main, { screen: 'Profile' }
//      /(tabs)/marketplace → Main, { screen: 'Market' } (tab is named
//                            "Market" in MainTabParamList, not "Marketplace")
//      default case (/(tabs)/notification) → Notification (this is a
//                            ROOT stack screen, not a tab — there is no
//                            "notification" tab in MainTabParamList)
// ⚠️ NOT fixed yet — needs Batch 3 (chat files) confirmed first:
//      /chat/cowatch and /chat/${id} — left as TODO comments below,
//      since the chat navigator's actual screen names aren't converted
//      to React Navigation yet. Revisit once chat/_layout.tsx etc. are done.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useNavigation } from '@react-navigation/native';

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
// `navigation` is now passed in (from the hook below) instead of being
// read from a module-scope variable that never worked.
function handleDeepLink(data: Record<string, any>, navigation: any) {
  if (!data || !data.type) return;

  console.log('🔔 Push notification tapped:', data.type, data);

  switch (data.type) {
    case 'cowatch_invite':
      // TODO: chat screens aren't converted to React Navigation yet
      // (Batch 3). Revisit this once chat/_layout.tsx etc. are fixed —
      // needs the real registered screen name + param shape for CoWatch.
      if (data.conversationId && data.sessionId) {
        console.warn('[notificationHandler] cowatch_invite navigation not yet wired to React Navigation — chat screens pending conversion.');
      }
      break;

    case 'like':
    case 'comment':
    case 'gift':
    case 'coin':
    case 'mention':
      if (data.post_id) {
        navigation.navigate('PostDetail', { postId: data.post_id });
      }
      break;

    case 'follow':
      if (data.from_user_id) {
        navigation.navigate('UserProfile', { userId: data.from_user_id });
      }
      break;

    case 'message':
      // TODO: chat screens aren't converted to React Navigation yet
      // (Batch 3). Revisit once chat/[id].tsx etc. are fixed.
      if (data.id) {
        console.warn('[notificationHandler] message navigation not yet wired to React Navigation — chat screens pending conversion.');
      }
      break;

    case 'referral_commission':
    case 'achievement':
      navigation.navigate('Main', { screen: 'Profile' });
      break;

    case 'marketplace':
      navigation.navigate('Main', { screen: 'Market' });
      break;

    default:
      // "Notification" is a root-stack screen, not a tab — there is no
      // notification tab in MainTabParamList.
      navigation.navigate('Notification');
      break;
  }
}

// ── Main hook — call once in a component rendered inside NavigationContainer ─
export function useNotificationHandler() {
  const navigation = useNavigation<any>();
  const notifListenerRef  = useRef<Notifications.Subscription | null>(null);
  const responseListenerRef = useRef<Notifications.Subscription | null>(null);

  useEffect(() => {
    setupAndroidChannel();

    notifListenerRef.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log('🔔 Notification received (app open):', notification.request.content.title);
      }
    );

    responseListenerRef.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as Record<string, any>;
        handleDeepLink(data, navigation);
      }
    );

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        const data = response.notification.request.content.data as Record<string, any>;
        setTimeout(() => handleDeepLink(data, navigation), 800);
      }
    });

    return () => {
      notifListenerRef.current?.remove();
      responseListenerRef.current?.remove();
    };
  }, [navigation]);
} 
