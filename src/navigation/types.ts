export type RootStackParamList = {
  Main:                undefined;
  Auth:                undefined;
  UserProfile:         { userId?: string } | undefined;
  Notification:        undefined;
  BuyCoins:            undefined;
  Search:              undefined;
  PostDetail:          { postId: string };
  Settings:            undefined;
  Privacy:             undefined;
  Terms:               undefined;
  Leaderboard:         undefined;
  TransactionHistory:  undefined;
  SubscriptionWallet:  undefined;
  Themes:              undefined;
  ConnectAccounts:     undefined;
  LanguagePicker:      undefined;
  ApplySubscriptions:  undefined;
  Premium:             undefined;
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