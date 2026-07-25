// src/navigation/ChatStack.tsx
//
// Nested stack for the Messages tab — replaces the old expo-router
// app/chat/_layout.tsx, which had no direct React Navigation equivalent
// (same situation as MarketplaceStack.tsx — expo-router's <Stack> only
// works inside an actual expo-router file-based app).
//
// ✅ Cowatch is registered and live.
// ⚠️ GroupInfo still isn't — source file (group/info.tsx) hasn't been
// sent/converted yet. The button that opens it in group/[id].tsx will
// throw "not handled by any navigator" if tapped until this is added.
//
// ⚠️ STILL REQUIRED ELSEWHERE: MainTabs.tsx must render <ChatStack />
// for the "Messages" tab, not <MessagesScreen /> directly — otherwise
// none of the screens registered below are reachable at all, no matter
// how correct their navigate() calls are. MessagesScreen becomes the
// initial route ("MessagesHome") inside this stack instead.

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ChatStackParamList } from './ChatStackTypes';

import { MessagesScreen } from '../screens';
import ChatDMScreen     from '../chat/[id]';
import NewChatScreen    from '../chat/new';
import NewGroupScreen   from '../chat/new-group';
import NewCircleScreen  from '../chat/new-circle';
import GroupChatScreen  from '../chat/group/[id]';
import CircleScreen     from '../chat/circle/[id]';
// TEMP DISABLED: cowatch.tsx imports livekit-client, which crashes on
// the currently-installed @livekit/react-native-webrtc version (the
// event-target-shim bug). Re-enable this import once the LiveKit
// package versions are bumped and the dev client is rebuilt natively.
// import CowatchScreen    from '../chat/cowatch';

// TODO: uncomment once group/info.tsx is sent and converted:
// import GroupInfoScreen from '../chat/group/info';

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
      <Stack.Screen name="Circle"       component={CircleScreen} />
      {/* TEMP DISABLED — see import comment above */}
      {/* <Stack.Screen name="Cowatch"      component={CowatchScreen} /> */}
      {/* TODO: <Stack.Screen name="GroupInfo" component={GroupInfoScreen} /> */}
    </Stack.Navigator>
  );
}

export default ChatStack; 
