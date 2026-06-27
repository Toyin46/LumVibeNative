// src/navigation/MainTabBar.tsx
// ✅ Bare workflow React Navigation version of app/(tabs)/_layout.tsx
// ✅ Exact same visual design — colors, icons, create button, unread dot
// ✅ Tab bar elevation/zIndex so feed content never blocks touches on Android
// ✅ Auth guard on Create, Messages, Market, Profile tabs
// ✅ Unread message dot with realtime Supabase subscription
// ✅ Same height/padding as Expo managed version

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Alert,
} from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../store/authStore';
import { supabase } from '../config/supabase';

// ── UNREAD DOT ─────────────────────────────────────────────────────────────
function UnreadDot({ userId }: { userId?: string }) {
  const [hasUnread, setHasUnread] = useState(false);

  useEffect(() => {
    if (!userId) return;

    const checkUnread = async () => {
      try {
        const { data } = await supabase
          .from('conversation_participants')
          .select('unread_count')
          .eq('user_id', userId)
          .gt('unread_count', 0)
          .limit(1);
        setHasUnread((data || []).length > 0);
      } catch {
        // Silently fail
      }
    };

    checkUnread();

    const channel = supabase
      .channel(`unread:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversation_participants',
          filter: `user_id=eq.${userId}`,
        },
        () => checkUnread()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  if (!hasUnread) return null;

  return <View style={styles.unreadDot} />;
}

// ── TAB CONFIG ─────────────────────────────────────────────────────────────
// Which tabs require login
const AUTH_REQUIRED_TABS = new Set(['Create', 'Messages', 'Market', 'Profile']);

// Tab icon renderer
function TabIcon({
  routeName,
  color,
  size,
  focused,
  userId,
}: {
  routeName: string;
  color: string;
  size: number;
  focused: boolean;
  userId?: string;
}) {
  switch (routeName) {
    case 'Home':
      return <Ionicons name="home" size={size} color={color} />;

    case 'Explore':
      return <Ionicons name="search" size={size} color={color} />;

    case 'Create':
      return (
        <View
          style={[
            styles.createBtn,
            { backgroundColor: focused ? '#00ff88' : '#1a1a1a' },
          ]}
        >
          <Ionicons
            name="add"
            size={24}
            color={focused ? '#000' : '#00ff88'}
          />
        </View>
      );

    case 'Messages':
      return (
        <View style={{ position: 'relative' }}>
          <Ionicons
            name={focused ? 'chatbubble' : 'chatbubble-outline'}
            size={size}
            color={color}
          />
          <UnreadDot userId={userId} />
        </View>
      );

    case 'Videos':
      return <Ionicons name="play-circle" size={size} color={color} />;

    case 'Market':
      return <Feather name="shopping-bag" size={size} color={color} />;

    case 'Profile':
      return <Ionicons name="person" size={size} color={color} />;

    default:
      return <Ionicons name="ellipse" size={size} color={color} />;
  }
}

// Tab label — Create tab has no label
function TabLabel({
  routeName,
  color,
  focused,
}: {
  routeName: string;
  color: string;
  focused: boolean;
}) {
  if (routeName === 'Create') return null;
  const labels: Record<string, string> = {
    Home: 'Home',
    Explore: 'Explore',
    Messages: 'Messages',
    Videos: 'Videos',
    Market: 'Market',
    Profile: 'Profile',
  };
  return (
    <Text style={[styles.tabLabel, { color }]}>
      {labels[routeName] ?? routeName}
    </Text>
  );
}

// ── MAIN TAB BAR ───────────────────────────────────────────────────────────
export function MainTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { user } = useAuthStore();
  const insets = useSafeAreaInsets();

  // Bottom padding: respect safe area on iPhone notch/Dynamic Island
  // but keep a minimum of 10px to match Expo managed version
  const bottomPad = Math.max(insets.bottom, 10);

  return (
    <View
      style={[
        styles.tabBar,
        {
          // ✅ Same height logic as Expo managed version
          height: (Platform.OS === 'android' ? 68 : 64) + (insets.bottom > 0 ? insets.bottom - 10 : 0),
          paddingBottom: bottomPad,
        },
      ]}
    >
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const focused = state.index === index;
        const color = focused ? '#00ff88' : '#555';

        const onPress = () => {
          // Auth guard
          if (AUTH_REQUIRED_TABS.has(route.name) && !user) {
            Alert.alert(
              'Login Required',
              `Please login to ${
                route.name === 'Create' ? 'create posts' :
                route.name === 'Messages' ? 'view your messages' :
                route.name === 'Market' ? 'access the Marketplace' :
                'view your profile'
              }`,
              [
                {
                  text: 'Go to Login',
                  onPress: () => navigation.navigate('Auth' as never),
                },
                { text: 'Cancel' },
              ]
            );
            return;
          }

          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });

          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        const onLongPress = () => {
          navigation.emit({
            type: 'tabLongPress',
            target: route.key,
          });
        };

        return (
          <TouchableOpacity
            key={route.key}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={options.tabBarAccessibilityLabel}
            onPress={onPress}
            onLongPress={onLongPress}
            activeOpacity={0.7}
            style={styles.tabItem}
          >
            <TabIcon
              routeName={route.name}
              color={color}
              size={24}
              focused={focused}
              userId={user?.id}
            />
            <TabLabel
              routeName={route.name}
              color={color}
              focused={focused}
            />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── STYLES ─────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#000',
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    paddingTop: 6,
    // ✅ Critical for Android — keeps tab bar above all feed content
    elevation: 20,
    zIndex: 20,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
  createBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#00ff88',
  },
  unreadDot: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00ff88',
    borderWidth: 1.5,
    borderColor: '#000',
  },
}); 
