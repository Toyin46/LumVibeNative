// app/(tabs)/marketplace/_layout.tsx
import { Stack } from 'expo-router';

export default function MarketplaceLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#000' }, animation: 'slide_from_right' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="buy-coins" />
      <Stack.Screen name="create-listing" />
      <Stack.Screen name="my-listings" />
      <Stack.Screen name="orders" />
      <Stack.Screen name="seller-dashboard" />
      <Stack.Screen name="seller-verification" />
      <Stack.Screen name="withdraw" />
      <Stack.Screen name="listing/[id]" />
      <Stack.Screen name="order/[id]" />
    </Stack>
  );
} 
