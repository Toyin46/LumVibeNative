import type { NavigatorScreenParams } from '@react-navigation/native';
import type { ChatStackParamList } from './ChatStackTypes';

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
  // NavigatorScreenParams lets callers on other tabs (e.g. videos.tsx)
  // navigate straight into a nested ChatStack screen with typed params:
  // navigation.navigate('Messages', { screen: 'Cowatch', params: {...} })
  Messages: NavigatorScreenParams<ChatStackParamList> | undefined;
  Videos:   undefined;
  Market:   undefined;
  Profile:  undefined;
};