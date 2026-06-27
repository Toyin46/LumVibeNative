import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  CreateScreen,
  ExploreScreen,
  HomeScreen,
  MessagesScreen,
  ProfileScreen,
  VideosScreen,
} from '../screens';
import { PlaceholderScreen } from '../screens/PlaceholderScreen';
import { MainTabBar }        from './MainTabBar';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

export function MainTabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <MainTabBar {...props} />}
      screenOptions={{
        headerShown:     false,
        tabBarShowLabel: false,
      }}
    >
      <Tab.Screen name="Home"     component={HomeScreen} />
      <Tab.Screen name="Explore"  component={ExploreScreen} />
      <Tab.Screen name="Create"   component={CreateScreen} />
      <Tab.Screen name="Messages" component={MessagesScreen} />
      <Tab.Screen name="Videos"   component={VideosScreen} />
      <Tab.Screen name="Market"   component={PlaceholderScreen} />
      <Tab.Screen name="Profile"  component={ProfileScreen} />
    </Tab.Navigator>
  );
}