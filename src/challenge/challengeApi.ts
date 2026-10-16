// src/challenge/challengeApi.ts
// Shared helpers for the LumVibe community challenge. The app talks to the SAME database functions as the website
// (get_challenge, list_challenge_entries, cast_vote, ...), so web and app always show the same entries and votes.
import { supabase } from '../config/supabase';

export const SITE = 'https://lumvibe.site';
export const SHARE_BASE = 'https://lively-sun-4c51.lumvibe86.workers.dev';
export const GREEN = '#00FF88';

export async function rpc<T = any>(name: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    const { data, error } = await supabase.rpc(name, (args ?? {}) as any);
    if (error) return null;
    return data as T;
  } catch {
    return null;
  }
}

export const entryShareUrl = (postId: string) => `${SHARE_BASE}/e/${encodeURIComponent(postId)}`;
export const challengeShareUrl = (slug: string) => `${SHARE_BASE}/c/${encodeURIComponent(slug)}`;

export type Phase = 'upcoming' | 'entries' | 'voting' | 'closed';
export interface ChallengeTimes {
  entries_open_at: string; entries_close_at?: string; voting_opens_at: string; voting_closes_at: string;
}
export const phaseOf = (c: ChallengeTimes, now: number): Phase =>
  now >= Date.parse(c.voting_closes_at) ? 'closed'
  : now >= Date.parse(c.voting_opens_at) ? 'voting'
  : now >= Date.parse(c.entries_open_at) ? 'entries'
  : 'upcoming';

export function watLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) + ' WAT';
  } catch { return iso; }
}

export function durLabel(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`;
}

const VOTE_ERRORS: Record<string, string> = {
  verify_email: 'Please confirm your email first (check your inbox), then vote.',
  voting_closed: 'Voting is closed.',
  own_entry: "You can't vote for your own entry.",
  host_cannot_vote: 'LumVibe host accounts cannot vote.',
  already_voted: 'You already voted for this one.',
  not_found: 'This entry is no longer available.',
  login: 'Please log in to vote.',
};

/** Votes (or removes the vote) on an entry. Returns a ready-to-show message. */
export async function toggleVote(entryId: string, alreadyVoted: boolean): Promise<{ ok: boolean; message: string }> {
  const r: any = await rpc(alreadyVoted ? 'retract_vote' : 'cast_vote', { p_entry_id: entryId });
  if (r && r.ok) {
    if (alreadyVoted) return { ok: true, message: 'Vote removed.' };
    return { ok: true, message: r.remaining != null ? `Vote counted! ${r.remaining} left.` : 'Vote counted!' };
  }
  if (r && r.error === 'vote_limit') return { ok: false, message: `You've used all ${r.max ?? 3} of your votes. Remove one to vote again.` };
  return { ok: false, message: VOTE_ERRORS[r?.error as string] ?? 'Could not save your vote. Try again.' };
}

/** Video frame used as a thumbnail (same trick the website uses). */
export function thumbFor(e: { thumbnail_url?: string | null; media_url?: string | null }): string {
  if (e.thumbnail_url) return e.thumbnail_url;
  const u = e.media_url || '';
  if (u.includes('cloudinary.com') && u.includes('/video/upload/')) {
    return u.replace('/video/upload/', '/video/upload/so_0,w_480,f_jpg/').replace(/\.[a-z0-9]+(\?.*)?$/i, '.jpg');
  }
  return '';
}
