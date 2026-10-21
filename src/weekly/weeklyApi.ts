// src/weekly/weeklyApi.ts
// Shared helpers for the Weekly leaderboard + Top 10 voting. The app talks to the SAME database functions as the
// website (get_weekly_board, cast_weekly_vote, retract_weekly_vote), so web and app always show the same board and votes.
import { supabase } from '../config/supabase';

export const SITE = 'https://lumvibe.site';
export const SHARE_BASE = 'https://lively-sun-4c51.lumvibe86.workers.dev';
export const GREEN = '#00FF88';
export const GOLD = '#FFD700';

export type WeeklyPhase = 'points' | 'voting' | 'closed';
export interface WeeklyRow {
  user_id: string; username: string; display_name?: string | null; avatar_url?: string | null; rank: number;
  points?: number;                       // points phase
  post_id?: string | null; votes?: number; seed_rank?: number; points_at_freeze?: number; voted_by_me?: boolean; // voting / closed
  wins?: number;                         // how many weeks this person has won (shown as 🏆×N)
}
export interface WeeklyBoard {
  phase: WeeklyPhase; week_start: string; voting_ends_at?: string; max_votes?: number; votes_left?: number; rows: WeeklyRow[];
}

export async function rpc<T = any>(name: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    const { data, error } = await supabase.rpc(name, (args ?? {}) as any);
    if (error) return null;
    return data as T;
  } catch { return null; }
}

export const getWeeklyBoard = () => rpc<WeeklyBoard>('get_weekly_board');
export const weeklyShareUrl = (userId: string) => `${SHARE_BASE}/w/${encodeURIComponent(userId)}`;

/** Thursday 7:00 AM Nigeria time (06:00 UTC) of the board's week: when the Top 10 is locked in. */
export const lockTime = (b: WeeklyBoard) => Date.parse(b.week_start) + (4 * 24 + 6) * 3600e3;

export function watLabel(ms: number): string {
  try { return new Date(ms).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', weekday: 'long', hour: 'numeric', minute: '2-digit' }) + ' (Nigeria time)'; }
  catch { return ''; }
}
export function weekLabel(iso: string): string {
  try { return new Date(iso).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short' }).toUpperCase(); }
  catch { return ''; }
}

const VOTE_ERRORS: Record<string, string> = {
  verify_email: 'Please confirm your email first (check your inbox), then vote.',
  voting_closed: 'Voting is closed.',
  own_entry: "You can't vote for yourself.",
  host_cannot_vote: 'LumVibe host accounts cannot vote.',
  already_voted: 'You already voted for this one.',
  not_found: 'That finalist was not found.',
  login: 'Please log in to vote.',
};

/** Votes (or removes the vote). Returns a ready-to-show message. */
export async function toggleWeeklyVote(finalistId: string, alreadyVoted: boolean): Promise<{ ok: boolean; message: string }> {
  const r: any = await rpc(alreadyVoted ? 'retract_weekly_vote' : 'cast_weekly_vote', { p_finalist: finalistId });
  if (r && r.ok) {
    if (alreadyVoted) return { ok: true, message: 'Vote removed.' };
    return { ok: true, message: r.remaining != null ? `Vote counted! ${r.remaining} left.` : 'Vote counted!' };
  }
  if (r && r.error === 'vote_limit') return { ok: false, message: `You've used all ${r.max ?? 3} of your votes. Tap ✓ Voted on one to move it.` };
  return { ok: false, message: VOTE_ERRORS[r?.error as string] ?? 'Could not save your vote. Try again.' };
}

/** Thumbnail for a post (video frame via Cloudinary, or the photo itself). */
export function thumbOf(p?: { thumbnail_url?: string | null; media_type?: string | null; media_url?: string | null; image_url?: string | null } | null): string {
  if (!p) return '';
  if (p.thumbnail_url) return p.thumbnail_url;
  if (p.media_type === 'image') return p.image_url || p.media_url || '';
  const u = p.media_url || '';
  if (u.includes('cloudinary.com') && u.includes('/video/upload/')) {
    return u.replace('/video/upload/', '/video/upload/so_0,w_480,f_jpg/').replace(/\.[a-z0-9]+(\?.*)?$/i, '.jpg');
  }
  return p.image_url || '';
}

export async function loadPostThumbs(ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  if (!uniq.length) return out;
  try {
    const { data } = await supabase.from('posts').select('id, media_type, media_url, image_url, thumbnail_url').in('id', uniq);
    (data || []).forEach((p: any) => { out[p.id] = thumbOf(p); });
  } catch { /* thumbnails are optional */ }
  return out;
}
