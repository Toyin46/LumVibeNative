// src/challenge/feedStore.ts
// One shared copy of "the challenge that is running + its entries", so the feed banner and every entry tag
// use a single database call (active_challenge_feed) instead of one per video.
import { useEffect, useSyncExternalStore } from 'react';
import { rpc } from './challengeApi';

export interface FeedChallenge {
  slug: string; title: string; phase: string; entries_open: boolean;
  entries_open_at: string; entries_close_at: string; voting_opens_at: string; voting_closes_at: string; server_now: string;
}
export interface FeedEntry { post_id: string; entry_id: string; my_vote: boolean; is_mine: boolean }
export interface FeedState {
  challenge: FeedChallenge | null; iEntered: boolean; entries: Map<string, FeedEntry>; skew: number; loaded: boolean;
}

let state: FeedState = { challenge: null, iEntered: false, entries: new Map(), skew: 0, loaded: false };
let lastFetch = 0;
let inflight: Promise<void> | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const snapshot = () => state;

export function refreshChallengeFeed(force = false): Promise<void> {
  if (inflight) return inflight;
  if (!force && state.loaded && Date.now() - lastFetch < 30000) return Promise.resolve();
  inflight = rpc<any>('active_challenge_feed')
    .then(d => {
      if (d && d.challenge) {
        const m = new Map<string, FeedEntry>();
        (d.entries || []).forEach((e: FeedEntry) => m.set(String(e.post_id), e));
        state = { challenge: d.challenge, iEntered: !!d.i_entered, entries: m, skew: Date.parse(d.challenge.server_now) - Date.now(), loaded: true };
      } else {
        state = { challenge: null, iEntered: false, entries: new Map(), skew: 0, loaded: true };
      }
      lastFetch = Date.now();
    })
    .catch(() => { /* keep the previous state */ })
    .then(() => { inflight = null; emit(); });
  return inflight;
}

/** Update one entry locally (e.g. right after a vote) without another round trip. */
export function patchFeedEntry(postId: string, patch: Partial<FeedEntry>) {
  const cur = state.entries.get(String(postId)); if (!cur) return;
  const m = new Map(state.entries); m.set(String(postId), { ...cur, ...patch });
  state = { ...state, entries: m }; emit();
}

export function useChallengeFeed(): FeedState {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => { refreshChallengeFeed(); }, []);
  return s;
}
