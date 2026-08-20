// app/buy-coins.tsx
//
// REDUNDANCY FIX: this used to be a full 308-line screen duplicated almost
// entirely from screens/marketplace/buy-coins.tsx. All shared logic now
// lives in components/BuyCoinsScreen.tsx — this file only declares what's
// different: the packages, the wallet column, and the color theme.

import React from 'react';
import BuyCoinsScreenBase, { CoinPackage } from './components/BuyCoinsScreen';

const PROFILE_PACKAGES: readonly CoinPackage[] = [
  { id: 'rose',        coins: 10,    bonusCoins: 0,   priceNgn: 1_500,   popular: false, label: 'Rose',        icon: '🌹', hint: 'Send 1 Rose gift' },
  { id: 'ice_cream',   coins: 50,    bonusCoins: 0,   priceNgn: 7_500,   popular: false, label: 'Ice Cream',   icon: '🍦', hint: 'Send Ice Cream gifts' },
  { id: 'love_letter', coins: 100,   bonusCoins: 10,  priceNgn: 15_000,  popular: true,  label: 'Love Letter', icon: '💌', hint: 'Send Love Letter gifts' },
  { id: 'trophy',      coins: 500,   bonusCoins: 60,  priceNgn: 75_000,  popular: false, label: 'Trophy',      icon: '🏆', hint: 'Send Trophy gifts' },
  { id: 'crown',       coins: 1000,  bonusCoins: 100, priceNgn: 150_000, popular: false, label: 'Crown',       icon: '👑', hint: 'Send Crown gifts' },
  { id: 'diamond',     coins: 5_000, bonusCoins: 500, priceNgn: 750_000, popular: false, label: 'Diamond',     icon: '💎', hint: 'Send Diamond gifts' },
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
