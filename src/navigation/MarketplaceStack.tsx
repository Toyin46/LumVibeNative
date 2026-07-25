// src/navigation/MarketplaceStack.tsx
//
// Nested stack for the Marketplace tab — React Navigation native-stack.

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { MarketplaceStackParamList } from './MarketplaceStackTypes';

import MarketplaceHomeScreen      from '../screens/marketplace/index';
import MarketplaceBuyCoinsScreen  from '../screens/marketplace/buy-coins';
import CreateListingScreen        from '../screens/marketplace/create-listing';
import MyListingsScreen           from '../screens/marketplace/my-listings';
import MarketplaceOrdersScreen    from '../screens/marketplace/orders';
import SellerDashboardScreen      from '../screens/marketplace/seller-dashboard';
import SellerVerificationScreen   from '../screens/marketplace/seller-verification';
import WithdrawMarketplaceScreen  from '../screens/marketplace/withdraw';
import ListingDetailScreen        from '../screens/marketplace/listing/[id]';
import OrderDetailScreen          from '../screens/marketplace/order/[id]';

const Stack = createNativeStackNavigator<MarketplaceStackParamList>();

export function MarketplaceStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#000' },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="MarketplaceHome"    component={MarketplaceHomeScreen} />
      <Stack.Screen name="BuyCoins"           component={MarketplaceBuyCoinsScreen} />
      <Stack.Screen name="CreateListing"      component={CreateListingScreen} />
      <Stack.Screen name="MyListings"         component={MyListingsScreen} />
      <Stack.Screen name="Orders"             component={MarketplaceOrdersScreen} />
      <Stack.Screen name="SellerDashboard"    component={SellerDashboardScreen} />
      <Stack.Screen name="SellerVerification" component={SellerVerificationScreen} />
      <Stack.Screen name="Withdraw"           component={WithdrawMarketplaceScreen} />
      <Stack.Screen name="ListingDetail"      component={ListingDetailScreen} />
      <Stack.Screen name="OrderDetail"        component={OrderDetailScreen} />
    </Stack.Navigator>
  );
}

export default MarketplaceStack;
