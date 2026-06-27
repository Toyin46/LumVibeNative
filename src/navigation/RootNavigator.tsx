import React, { useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View } from 'react-native';
import { MainTabs } from './MainTabs';
import { useAuthStore } from '../store/authStore';
import type { RootStackParamList } from './types';

// Lazy imports — only load when needed
const AuthStack          = React.lazy(() => import('../screens/auth/AuthStack').then(m => ({ default: m.AuthStack ?? m.default })));
const NotificationScreen = React.lazy(() => import('../screens/notification'));
const BuyCoinsScreen     = React.lazy(() => import('../buy-coins'));
const SearchScreen       = React.lazy(() => import('../search'));
const UserProfileScreen  = React.lazy(() => import('../user/[id]'));

const Stack = createNativeStackNavigator<RootStackParamList>();

function LoadingScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color="#00ff88" />
    </View>
  );
}

export function RootNavigator() {
  const { user, initialized, loadProfile } = useAuthStore();

  useEffect(() => {
    if (user) loadProfile();
  }, [user]);

  if (!initialized) return <LoadingScreen />;

  return (
    <React.Suspense fallback={<LoadingScreen />}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {user ? (
          <>
            <Stack.Screen name="Main"         component={MainTabs} />
            <Stack.Screen name="UserProfile"  component={UserProfileScreen as any} />
            <Stack.Screen name="Notification" component={NotificationScreen as any} />
            <Stack.Screen name="BuyCoins"     component={BuyCoinsScreen as any} />
            <Stack.Screen name="Search"       component={SearchScreen as any} />
          </>
        ) : (
          <Stack.Screen name="Auth" component={AuthStack as any} />
        )}
      </Stack.Navigator>
    </React.Suspense>
  );
}