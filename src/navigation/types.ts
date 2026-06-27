// ═══════════════════════════════════════════════════════════
// types.ts — Navigation param lists for LumVibe
// ═══════════════════════════════════════════════════════════

export type RootStackParamList = {
  Main:         undefined;
  Auth:         undefined;
  UserProfile:  { userId?: string } | undefined;
  Notification: undefined;
  BuyCoins:     undefined;
  Search:       undefined;
};

export type MainTabParamList = {
  Home:     undefined;
  Explore:  undefined;
  Create:   undefined;
  Messages: undefined;
  Videos:   undefined;
  Market:   undefined;
  Profile:  undefined;
};