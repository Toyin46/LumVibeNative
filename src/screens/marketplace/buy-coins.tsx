// src/screens/marketplace/buy-coins.tsx
//
// REDUNDANCY FIX: see app/buy-coins.tsx for the full explanation. This file
// used to be a 362-line near-duplicate of that screen; now it just declares
// what's different for the marketplace wallet.

import React from 'react';
import BuyCoinsScreenBase, { CoinPackage } from '../../components/BuyCoinsScreen';

// ✅ CHANGED: 5 -> 21 packages. The original 5 (Starter, Basic, Standard,
// Premium, Enterprise) are untouched — same id, coins, bonus, price — so
// nothing changes for anyone who already bought one. 16 new tiers fill the
// gaps between and below them, all priced at exactly ₦150 per coin with no
// bonus, matching your documented rate exactly.
//
// Why not start at ₦50 like we first discussed: at any rate cheaper than the
// standard ₦150/coin, buying enough of the cheap tier always beats a pricier
// tier for the same coin total — that's the exact bug you caught last round,
// just moved from the gift catalog to here. A uniform rate makes that
// impossible: any combination of tiers costs the same per coin, so there's
// no cheap path to exploit. If you still want a genuinely cheap one-time
// starter deal, that needs a real "one per account" rule enforced on the
// server (Play doesn't limit a consumable to one purchase by itself) — a
// bigger, separate feature. Say the word and I'll build that next.
const MARKETPLACE_PACKAGES: readonly CoinPackage[] = [
  { id: 'mkt_trial',      coins: 1,    bonusCoins: 0,   priceNgn: 150,     popular: false, label: 'Trial',      icon: '🧪', hint: 'Try it out'                  },
  { id: 'mkt_sample',     coins: 5,    bonusCoins: 0,   priceNgn: 750,     popular: false, label: 'Sample',     icon: '🔖', hint: 'A small taste'               },
  { id: 'mkt_pouch',      coins: 10,   bonusCoins: 0,   priceNgn: 1_500,   popular: false, label: 'Pouch',      icon: '👝', hint: 'A little more'               },
  { id: 'mkt_parcel',     coins: 20,   bonusCoins: 0,   priceNgn: 3_000,   popular: false, label: 'Parcel',     icon: '📮', hint: 'Getting started'             },
  { id: 'mkt_starter',    coins: 50,   bonusCoins: 0,   priceNgn: 7_500,   popular: false, label: 'Starter',    icon: '🛍️', hint: 'Great for small orders'     },
  { id: 'mkt_bundle',     coins: 70,   bonusCoins: 0,   priceNgn: 10_500,  popular: false, label: 'Bundle',     icon: '🎒', hint: 'A handy bundle'              },
  { id: 'mkt_satchel',    coins: 85,   bonusCoins: 0,   priceNgn: 12_750,  popular: false, label: 'Satchel',    icon: '👜', hint: 'Just under Basic'            },
  { id: 'mkt_basic',      coins: 100,  bonusCoins: 10,  priceNgn: 15_000,  popular: false, label: 'Basic',      icon: '📦', hint: 'Good for mid-range services' },
  { id: 'mkt_cargo',      coins: 150,  bonusCoins: 0,   priceNgn: 22_500,  popular: false, label: 'Cargo',      icon: '🚚', hint: 'Room to grow'                },
  { id: 'mkt_freight',    coins: 200,  bonusCoins: 0,   priceNgn: 30_000,  popular: false, label: 'Freight',    icon: '🚛', hint: 'Bigger orders'               },
  { id: 'mkt_container',  coins: 300,  bonusCoins: 0,   priceNgn: 45_000,  popular: false, label: 'Container',  icon: '🚢', hint: 'For regular buyers'          },
  { id: 'mkt_warehouse',  coins: 400,  bonusCoins: 0,   priceNgn: 60_000,  popular: false, label: 'Warehouse',  icon: '🏭', hint: 'Stock up'                    },
  { id: 'mkt_standard',   coins: 500,  bonusCoins: 50,  priceNgn: 75_000,  popular: true,  label: 'Standard',   icon: '🚀', hint: 'Best value for creators'     },
  { id: 'mkt_wholesale',  coins: 600,  bonusCoins: 0,   priceNgn: 90_000,  popular: false, label: 'Wholesale',  icon: '🏬', hint: 'For serious buyers'          },
  { id: 'mkt_distributor',coins: 700,  bonusCoins: 0,   priceNgn: 105_000, popular: false, label: 'Distributor',icon: '🛒', hint: 'High volume'                 },
  { id: 'mkt_merchant',   coins: 800,  bonusCoins: 0,   priceNgn: 120_000, popular: false, label: 'Merchant',   icon: '🧾', hint: 'For active sellers'          },
  { id: 'mkt_tycoon',     coins: 900,  bonusCoins: 0,   priceNgn: 135_000, popular: false, label: 'Tycoon',     icon: '🎩', hint: 'Just under Premium'          },
  { id: 'mkt_premium',    coins: 1000, bonusCoins: 150, priceNgn: 150_000, popular: false, label: 'Premium',    icon: '💼', hint: 'For frequent buyers'         },
  { id: 'mkt_empire',     coins: 1500, bonusCoins: 0,   priceNgn: 225_000, popular: false, label: 'Empire',     icon: '🏰', hint: 'Scaling up'                  },
  { id: 'mkt_dynasty',    coins: 2000, bonusCoins: 0,   priceNgn: 300_000, popular: false, label: 'Dynasty',    icon: '👑', hint: 'Just under Enterprise'       },
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
