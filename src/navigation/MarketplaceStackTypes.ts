// src/navigation/MarketplaceStackTypes.ts
//
// Param list for the marketplace nested stack. Mirrors the folder
// structure from the old app/(tabs)/marketplace/ expo-router layout,
// converted to React Navigation screen names.
//
// ⚠️ STATUS: Screens marked TODO below don't have converted source files
// yet — I haven't seen index.tsx, orders.tsx, seller-dashboard.tsx,
// seller-verification.tsx, or listing/[id].tsx. Send those next and I'll
// wire them into MarketplaceStack.tsx properly. Until then, those routes
// exist in this type (so other screens can reference them without type
// errors) but aren't registered as actual Stack.Screen entries yet.

export type MarketplaceStackParamList = {
  MarketplaceHome:     undefined; // TODO: needs index.tsx source
  BuyCoins:            undefined;
  CreateListing:       undefined;
  MyListings:          undefined;
  Orders:              undefined; // TODO: needs orders.tsx source
  SellerDashboard:      undefined; // TODO: needs seller-dashboard.tsx source
  SellerVerification:  undefined; // TODO: needs seller-verification.tsx source
  Withdraw:            undefined;
  ListingDetail:       { listingId: string }; // TODO: needs listing/[id].tsx source
  OrderDetail:         { orderId: string };
}; 
