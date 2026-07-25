// src/navigation/ChatStackTypes.ts
//
// Param list for the chat nested stack. Mirrors the old app/chat/
// expo-router folder structure, converted to React Navigation screen
// names. Same pattern as MarketplaceStackTypes.ts.
//
// ⚠️ STATUS: Cowatch and GroupInfo are referenced by navigate() calls in
// the screens below, but their source files haven't been sent/converted
// yet. They're in this type so other screens can reference them without
// type errors, but aren't registered as real Stack.Screen entries in
// ChatStack.tsx until you send those files.

export type ChatStackParamList = {
    MessagesHome: undefined; // existing inbox screen (screens/messages.tsx)
    ChatDM:       { id: string; otherUserId: string; otherName: string; otherPhoto: string };
    NewChat:      undefined;
    NewGroup:     undefined;
    NewCircle:    undefined;
    GroupChat:    { id: string };
    Circle:       { id: string };
    Cowatch:      { conversationId: string; otherName: string; otherPhoto: string }; // TODO: needs cowatch.tsx source
    GroupInfo:    { id: string }; // TODO: needs group/info.tsx source
  }; 
  