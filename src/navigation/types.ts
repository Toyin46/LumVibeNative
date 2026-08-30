import type { NavigatorScreenParams } from '@react-navigation/native';
import type { ChatStackParamList } from './ChatStackTypes';

export type RootStackParamList = {
  Main:                NavigatorScreenParams<MainTabParamList> | undefined;
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
  // NEW: real standalone entry point for "add a story" — see story.tsx.
  // Accepts an optional context (which chat/group/circle it was launched
  // from) so create.tsx can offer the private/public choice and tag the
  // story accordingly. No context = posted from the plain Create tab,
  // always a normal public-to-profile story.
  Story: { contextType?: 'dm' | 'group' | 'circle'; contextId?: string; contextLabel?: string } | undefined;
};

export type MainTabParamList = {
  Home:     undefined;
  Explore:  undefined;
  Create:   { initialMode?: 'post' | 'story' | 'live'; contextType?: 'dm' | 'group' | 'circle'; contextId?: string; contextLabel?: string } | undefined;
  // NavigatorScreenParams lets callers on other tabs (e.g. videos.tsx)
  // navigate straight into a nested ChatStack screen with typed params:
  // navigation.navigate('Messages', { screen: 'Cowatch', params: {...} })
  Messages: NavigatorScreenParams<ChatStackParamList> | undefined;
  Videos:   undefined;
  Market:   undefined;
  Profile:  undefined;
};