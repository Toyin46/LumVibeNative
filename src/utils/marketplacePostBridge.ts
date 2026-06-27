// utils/marketplacePostBridge.ts
// ─── Simple in-memory bridge between create-listing and create screens ────────
// When a seller publishes a listing with media, we store the pre-fill data here.
// create.tsx reads it on mount and pre-populates caption + media.

export interface MarketplacePostBridgeData {
  listingId:   string;
  caption:     string;   // pre-built caption with title + price + hashtags
  mediaUri:    string | null;  // local URI to pre-load into create screen
  isVideo:     boolean;
  price?:     string;
  title?:      string;
}

let _pending: MarketplacePostBridgeData | null = null;

export function setMarketplacePostBridge(data: MarketplacePostBridgeData) {
  _pending = data;
}

export function getMarketplacePostBridge(): MarketplacePostBridgeData | null {
  return _pending;
}

export function clearMarketplacePostBridge() {
  _pending = null;
} 
