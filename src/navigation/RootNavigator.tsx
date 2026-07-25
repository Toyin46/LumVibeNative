//RootNavigator.tsx
import React, { useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View } from 'react-native';
import { MainTabs } from './MainTabs';
import { useAuthStore } from '../store/authStore';
import type { RootStackParamList } from './types';

// ─────────────────────────────────────────────────────────────
// React.lazy + Suspense removed. In React Native, Metro bundles
// the entire app into one JS file regardless — lazy() gives no
// code-splitting benefit here (that's a web-only win), while
// wrapping Stack.Navigator in a Suspense boundary breaks React
// Navigation's internal context timing, causing
// "Cannot read property 'useContext' of null" inside useNavigation.
// Plain static imports below fix it with no downside on RN.
// ─────────────────────────────────────────────────────────────
import { AuthStack }             from '../screens/auth/AuthStack';
import NotificationScreen        from '../screens/notification';
import BuyCoinsScreen            from '../buy-coins';
import SearchScreen              from '../search';
import UserProfileScreen         from '../user/[id]';
import PostDetailScreen          from '../post-detail';
import SettingsScreen            from '../settings';
import PrivacyScreen             from '../privacy';
import TermsScreen               from '../terms';
import LeaderboardScreen         from '../leaderboard';
import TransactionScreen         from '../transaction-history';
import SubscriptionScreen        from '../subscription-wallet';
import ThemesScreen              from '../themes';
import ConnectAccountsScreen     from '../connect-accounts';
import LanguagePickerScreen      from '../language-picker';
import ApplySubscriptions        from '../apply-subscriptions';
import PremiumScreen             from '../premium-subscription';

const Stack = createNativeStackNavigator<RootStackParamList>();

function LoadingScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color="#00ff88" />
    </View>
  );
}

export function RootNavigator() {
  const { user, initialized, loadProfile, initAuth } = useAuthStore();

  // ─────────────────────────────────────────────────────────────
  // FIX: This effect was missing entirely. `initialized` starts as
  // `false` in the store, and the ONLY function that ever sets it
  // to `true` is `initAuth()`. Without calling it here, nothing in
  // the whole app ever triggers it — so `if (!initialized) return
  // <LoadingScreen />` below stays true forever, and the app is
  // stuck on the spinner with no error and no crash, since nothing
  // is actually broken — it's just correctly waiting on a promise
  // that was never started in the first place.
  //
  // Empty dependency array `[]` means this runs exactly once, right
  // when RootNavigator first mounts — which is the correct place to
  // kick off a one-time "check if the user has a session" call.
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    initAuth();
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Unchanged: this separately reloads the profile any time `user`
  // changes (e.g. after login/logout). This was already correct —
  // it just never got a chance to matter because initialized never
  // flipped to true, so the app never reached a screen where `user`
  // could meaningfully change in the first place.
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (user) loadProfile();
  }, [user]);

  if (!initialized) return <LoadingScreen />;

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {user ? (
        <>
          <Stack.Screen name="Main"                component={MainTabs} />
          <Stack.Screen name="UserProfile"         component={UserProfileScreen as any} />
          <Stack.Screen name="Notification"        component={NotificationScreen as any} />
          <Stack.Screen name="BuyCoins"            component={BuyCoinsScreen as any} />
          <Stack.Screen name="Search"              component={SearchScreen as any} />
          <Stack.Screen name="PostDetail"          component={PostDetailScreen as any} />
          <Stack.Screen name="Settings"            component={SettingsScreen as any} />
          <Stack.Screen name="Privacy"             component={PrivacyScreen as any} />
          <Stack.Screen name="Terms"               component={TermsScreen as any} />
          <Stack.Screen name="Leaderboard"         component={LeaderboardScreen as any} />
          <Stack.Screen name="TransactionHistory"  component={TransactionScreen as any} />
          <Stack.Screen name="SubscriptionWallet"  component={SubscriptionScreen as any} />
          <Stack.Screen name="Themes"              component={ThemesScreen as any} />
          <Stack.Screen name="ConnectAccounts"     component={ConnectAccountsScreen as any} />
          <Stack.Screen name="LanguagePicker"      component={LanguagePickerScreen as any} />
          <Stack.Screen name="Premium"             component={PremiumScreen as any} />
        </>
      ) : (
        <Stack.Screen name="Auth" component={AuthStack as any} />
      )}
    </Stack.Navigator>
  );
}
