// src/screens/marketplace/buy-coins.tsx
//
// REDUNDANCY FIX: see app/buy-coins.tsx for the full explanation. This file
// used to be a 362-line near-duplicate of that screen; now it just declares
// what's different for the marketplace wallet.

import React from 'react';
import BuyCoinsScreenBase, { CoinPackage } from '../../components/BuyCoinsScreen';

const MARKETPLACE_PACKAGES: readonly CoinPackage[] = [
  { id: 'mkt_starter',    coins: 50,   bonusCoins: 0,   priceNgn: 7_500,   popular: false, label: 'Starter',    icon: '🛍️', hint: 'Great for small orders'     },
  { id: 'mkt_basic',      coins: 100,  bonusCoins: 10,  priceNgn: 15_000,  popular: false, label: 'Basic',      icon: '📦', hint: 'Good for mid-range services' },
  { id: 'mkt_standard',   coins: 500,  bonusCoins: 50,  priceNgn: 75_000,  popular: true,  label: 'Standard',   icon: '🚀', hint: 'Best value for creators'     },
  { id: 'mkt_premium',    coins: 1000, bonusCoins: 150, priceNgn: 150_000, popular: false, label: 'Premium',    icon: '💼', hint: 'For frequent buyers'         },
  { id: 'mkt_enterprise', coins: 2500, bonusCoins: 500, priceNgn: 375_000, popular: false, label: 'Enterprise', icon: '🏢', hint: 'For power users & agencies'  },
];

export default function MarketplaceBuyCoinsScreen() {
  return (
    <BuyCoinsScreenBase
      config={{
        walletType: 'marketplace',
        walletColumn: 'marketplace_coins',
        purchaseType: 'marketplace',
        packages: MARKETPLACE_PACKAGES,
        accentColor: '#8888ff',
        headerTitle: 'Buy Marketplace Coins',
        walletLabel: 'Marketplace Wallet',
        walletIcon: 'storefront',
        infoBanner: {
          title: '🛍️ What are Marketplace Coins?',
          body: 'Used exclusively to purchase services from other creators. Separate from your profile gifting wallet.',
        },
        bottomInfoLines: [
          'Used to buy services from other creators',
          'Separate from your profile gifting wallet',
          'Non-refundable once purchased',
          'Payments secured by Paystack & Flutterwave',
          'Issues? Email lumvibesupport@gmail.com with your payment reference',
        ],
        successMessage: {
          title: '🎉 Coins Added!',
          body: 'Your marketplace coins have been credited! Start shopping.',
          ctaLabel: 'Start Shopping →',
        },
        redirectUrlMatch: 'marketplace',
        navigateBackViaParent: true,
      }}
    />
  );
}
