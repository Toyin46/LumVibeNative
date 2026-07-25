import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  CreateScreen,
  ExploreScreen,
  HomeScreen,
  ProfileScreen,
  VideosScreen,
} from '../screens';
import { MarketplaceStack } from './MarketplaceStack';
// FIX: the Messages tab must render the nested ChatStack, not
// MessagesScreen directly — otherwise NewChat/ChatDM/GroupChat/Circle/
// Cowatch aren't reachable no matter how correct their navigate() calls
// are, since none of those screens exist in any navigator that's
// actually mounted. Same pattern as the Market tab below, which already
// renders MarketplaceStack instead of a lone screen.
import { ChatStack } from './ChatStack';
import { MainTabBar } from './MainTabBar';
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
      <Tab.Screen name="Messages" component={ChatStack} />
      <Tab.Screen name="Videos"   component={VideosScreen} />
      <Tab.Screen name="Market"   component={MarketplaceStack} />
      <Tab.Screen name="Profile"  component={ProfileScreen} />
    </Tab.Navigator>
  );
} 
