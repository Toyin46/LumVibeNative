// src/navigation/ChatStack.tsx
//
// Nested stack for the Messages tab — replaces the old expo-router
// app/chat/_layout.tsx, which had no direct React Navigation equivalent
// (same situation as MarketplaceStack.tsx — expo-router's <Stack> only
// works inside an actual expo-router file-based app).
//
// ✅ Cowatch is registered and live.
// ✅ GroupInfo is now built and registered — see group/info.tsx.
// ✅ MainTabs.tsx already renders <ChatStack /> for the "Messages" tab
// (confirmed, not just a TODO) — so every screen below is reachable.
//
// FIX: MessagesHome points to the ORIGINAL messages.tsx (now fixed), not
// the chat/index.tsx built earlier in the same session. The original
// screen turned out to be far more complete — Friends/Groups/Requests/
// Circles tabs, a working Stories viewer — none of which chat/index.tsx
// has. It just had the same class of bugs everything else in this app
// had (iOS-only SafeAreaView, silently-swallowed mutation errors, and a
// mount-only data load with no focus-triggered refresh). All three are
// now fixed directly in messages.tsx. chat/index.tsx is no longer wired
// in anywhere — keep it only if you want a simpler alternative later.

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ChatStackParamList } from './ChatStackTypes';

import { MessagesScreen } from '../screens';
import CowatchScreen    from '@/chat/cowatch';
import ChatDMScreen     from '../chat/[id]';
import NewChatScreen    from '../chat/new';
import NewGroupScreen   from '../chat/new-group';
import NewCircleScreen  from '../chat/new-circle';
import GroupChatScreen  from '../chat/group/[id]';
import GroupInfoScreen  from '../chat/group/info';
import CircleScreen     from '../chat/circle/[id]';

const Stack = createNativeStackNavigator<ChatStackParamList>();

export function ChatStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#000' },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="MessagesHome" component={MessagesScreen} />
      <Stack.Screen name="ChatDM"       component={ChatDMScreen} />
      <Stack.Screen name="NewChat"      component={NewChatScreen} />
      <Stack.Screen name="NewGroup"     component={NewGroupScreen} />
      <Stack.Screen name="NewCircle"    component={NewCircleScreen} />
      <Stack.Screen name="GroupChat"    component={GroupChatScreen} />
      <Stack.Screen name="GroupInfo"    component={GroupInfoScreen} />
      <Stack.Screen name="Circle"       component={CircleScreen} />
      <Stack.Screen name="Cowatch"      component={CowatchScreen} />
    </Stack.Navigator>
  );
}

export default ChatStack;
