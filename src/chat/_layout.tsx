// app/chat/_layout.tsx
// ─────────────────────────────────────────────────────────────
// LumVibe — Chat Route Layout
// Only declare routes that actually have files
// ─────────────────────────────────────────────────────────────

import { Stack } from 'expo-router';

export default function ChatLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="[id]" />
      <Stack.Screen name="new" />
      <Stack.Screen name="cowatch" />
    </Stack>
  );
} 
