// app/buy-coins.tsx
//
// REDUNDANCY FIX: this used to be a full 308-line screen duplicated almost
// entirely from screens/marketplace/buy-coins.tsx. All shared logic now
// lives in components/BuyCoinsScreen.tsx — this file only declares what's
// different: the packages, the wallet column, and the color theme.

import React from 'react';
import BuyCoinsScreenBase, { CoinPackage } from './components/BuyCoinsScreen';

// ✅ CHANGED: 6 -> 22 packages. The original 6 (Rose, Ice Cream, Love Letter,
// Trophy, Crown, Diamond) are untouched — same id, coins, bonus, price — so
// nothing changes for anyone who already bought one. 16 new tiers fill the
// gaps between and below them, all priced at exactly ₦150 per coin with no
// bonus — same uniform-rate rule as the marketplace wallet, so no
// combination of packages is ever a cheaper backdoor to a bigger one.
//
// These new tiers are named differently from your gift catalog on purpose —
// buying "Coin Pouch" just adds coins to the wallet, it doesn't send
// anything, so giving it a gift-sounding name (Rose, Heart, etc.) would make
// people think tapping Buy sends that gift immediately. The 6 originals
// (Rose, Ice Cream, Love Letter, Trophy, Crown, Diamond) already carry that
// naming from before the buy/send split — I left them exactly as they were
// rather than rename something already live, but it's worth knowing that's
// legacy naming now, not the pattern to keep extending.
const PROFILE_PACKAGES: readonly CoinPackage[] = [
  { id: 'coin_pouch',     coins: 1,    bonusCoins: 0,   priceNgn: 150,     popular: false, label: 'Coin Pouch',     icon: '🪙', hint: 'Try it out' },
  { id: 'coin_purse',     coins: 5,    bonusCoins: 0,   priceNgn: 750,     popular: false, label: 'Coin Purse',     icon: '👛', hint: 'A small top-up' },
  { id: 'rose',           coins: 10,   bonusCoins: 0,   priceNgn: 1_500,   popular: false, label: 'Rose',           icon: '🌹', hint: 'Send 1 Rose gift' },
  { id: 'money_bag',      coins: 20,   bonusCoins: 0,   priceNgn: 3_000,   popular: false, label: 'Money Bag',      icon: '💰', hint: 'Getting started' },
  { id: 'piggy_bank',     coins: 35,   bonusCoins: 0,   priceNgn: 5_250,   popular: false, label: 'Piggy Bank',     icon: '🐷', hint: 'Just under Ice Cream' },
  { id: 'ice_cream',      coins: 50,   bonusCoins: 0,   priceNgn: 7_500,   popular: false, label: 'Ice Cream',      icon: '🍦', hint: 'Send Ice Cream gifts' },
  { id: 'treasure_map',   coins: 60,   bonusCoins: 0,   priceNgn: 9_000,   popular: false, label: 'Treasure Map',   icon: '🗺️', hint: 'Room to grow' },
  { id: 'treasure_chest', coins: 70,   bonusCoins: 0,   priceNgn: 10_500,  popular: false, label: 'Treasure Chest', icon: '🗃️', hint: 'A bigger stash' },
  { id: 'love_letter',    coins: 100,  bonusCoins: 10,  priceNgn: 15_000,  popular: true,  label: 'Love Letter',    icon: '💌', hint: 'Send Love Letter gifts' },
  { id: 'jackpot',        coins: 150,  bonusCoins: 0,   priceNgn: 22_500,  popular: false, label: 'Jackpot',        icon: '🎰', hint: 'For regular gifting' },
  { id: 'vault',          coins: 200,  bonusCoins: 0,   priceNgn: 30_000,  popular: false, label: 'Vault',          icon: '🔐', hint: 'A serious stash' },
  { id: 'fortune',        coins: 300,  bonusCoins: 0,   priceNgn: 45_000,  popular: false, label: 'Fortune',        icon: '🍀', hint: 'For a generous run' },
  { id: 'trophy',         coins: 500,  bonusCoins: 60,  priceNgn: 75_000,  popular: false, label: 'Trophy',         icon: '🏆', hint: 'Send Trophy gifts' },
  { id: 'the_bank',       coins: 600,  bonusCoins: 0,   priceNgn: 90_000,  popular: false, label: 'The Bank',      icon: '🏦', hint: 'Just above Trophy' },
  { id: 'riches',         coins: 750,  bonusCoins: 0,   priceNgn: 112_500, popular: false, label: 'Riches',         icon: '💵', hint: 'For power gifters' },
  { id: 'bullion',        coins: 900,  bonusCoins: 0,   priceNgn: 135_000, popular: false, label: 'Bullion',        icon: '🥇', hint: 'Just under Crown' },
  { id: 'crown',          coins: 1000, bonusCoins: 100, priceNgn: 150_000, popular: false, label: 'Crown',          icon: '👑', hint: 'Send Crown gifts' },
  { id: 'empire',         coins: 1500, bonusCoins: 0,   priceNgn: 225_000, popular: false, label: 'Empire',         icon: '🏰', hint: 'Scaling up' },
  { id: 'dynasty',        coins: 2000, bonusCoins: 0,   priceNgn: 300_000, popular: false, label: 'Dynasty',        icon: '🏯', hint: 'Serious spending power' },
  { id: 'legacy',         coins: 3000, bonusCoins: 0,   priceNgn: 450_000, popular: false, label: 'Legacy',         icon: '🏛️', hint: 'Just under Diamond' },
  { id: 'titan',          coins: 4000, bonusCoins: 0,   priceNgn: 600_000, popular: false, label: 'Titan',          icon: '⚡', hint: 'For the biggest gifters' },
  { id: 'diamond',        coins: 5_000,bonusCoins: 500, priceNgn: 750_000, popular: false, label: 'Diamond',        icon: '💎', hint: 'Send Diamond gifts' },
];

export default function BuyCoinsScreen() {
  return (
    <BuyCoinsScreenBase
      config={{
        walletType: 'profile',
        walletColumn: 'coins',
        purchaseType: 'profile',
        packages: PROFILE_PACKAGES,
        accentColor: '#00ff88',
        headerTitle: 'Buy Coins',
        walletLabel: 'Profile Wallet',
        bottomInfoLines: [
          'Send coins as gifts or tips to creators',
          'Coins are non-refundable once purchased',
          'Payments processed securely by Paystack',
          'Coins credited instantly after payment verified',
          'Issues? Email lumvibesupport@gmail.com with your payment reference',
        ],
        successMessage: {
          title: '🎉 Coins Added!',
          body: 'Your coins have been credited to your wallet!',
          ctaLabel: 'Done',
        },
        redirectUrlMatch: 'buy-coins',
      }}
    />
  );
}
