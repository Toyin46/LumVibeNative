// src/navigation/ChatStackTypes.ts
//
// Param list for the chat nested stack. Mirrors the old app/chat/
// expo-router folder structure, converted to React Navigation screen
// names. Same pattern as MarketplaceStackTypes.ts.
//
// ✅ Cowatch is registered as a real Stack.Screen in ChatStack.tsx.
// ✅ GroupInfo now has a real source file (group/info.tsx) and is
// registered in ChatStack.tsx.
//
// ⚠️ Cowatch lives inside this nested stack (the "Messages" tab), so any
// navigate() call to it from a screen OUTSIDE this stack (e.g. videos.tsx
// on the "Videos" tab) must use the nested form:
//   navigation.navigate('Messages', { screen: 'Cowatch', params: {...} })
// A plain navigation.navigate('Cowatch', ...) from a sibling tab won't
// find it — and the screen name must match this file exactly ('Cowatch',
// not 'CoWatch'), since React Navigation route names are case-sensitive.

export type ChatStackParamList = {
  MessagesHome: undefined; // existing inbox screen (screens/messages.tsx)
  ChatDM:       { id: string; otherUserId: string; otherName: string; otherPhoto: string };
  NewChat:      undefined;
  NewGroup:     undefined;
  NewCircle:    undefined;
  GroupChat:    { id: string };
  Circle:       { id: string };
  Cowatch:      { conversationId: string; otherName: string; otherPhoto: string; isAiMatch?: string };
  GroupInfo:    { id: string };
}; 
