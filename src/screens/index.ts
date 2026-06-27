// HomeScreen — default export
import HomeScreenDefault from './HomeScreen';
export const HomeScreen = HomeScreenDefault;

// Default exports from screen files
export { default as ExploreScreen }      from './explore';
export { default as MessagesScreen }     from './messages';
export { default as NotificationScreen } from './notification';
export { default as ProfileScreen }      from './profile';
export { default as VideosScreen }       from './videos';

// BuyCoins lives in src/buy-coins.tsx
export { default as BuyCoinsScreen }     from '../buy-coins';

// CreateScreen
export { default as CreateScreen }       from './create/CreateScreen';