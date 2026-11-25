// src/status/statusInfoCache.ts
//
// "Does this person have a status I can see?" for MANY avatars at once.
// Every avatar on a screen asks for its person; the questions are collected for a
// moment and sent to the server as ONE request, and answers are remembered for a
// minute — so a list of 50 people costs one quick call, not 50.
import { supabase } from '../config/supabase';

export type StatusInfo = { count: number; hasUnseen: boolean };
const TTL = 60_000;
const cache = new Map<string, StatusInfo & { at: number }>();
const waiting = new Map<string, Array<(i: StatusInfo) => void>>();
let timer: ReturnType<typeof setTimeout> | null = null;

export function invalidateStatusInfo() { cache.clear(); }      // e.g. after watching a status

async function flush() {
  timer = null;
  const batch = new Map(waiting); waiting.clear();
  const ids = [...batch.keys()];
  const found = new Map<string, StatusInfo>();
  for (let i = 0; i < ids.length; i += 100) {
    try {
      const { data, error } = await supabase.rpc('get_status_summaries', { p_user_ids: ids.slice(i, i + 100) });
      if (!error && Array.isArray(data)) data.forEach((r: any) => found.set(r.user_id, { count: r.count || 0, hasUnseen: !!r.has_unseen }));
    } catch {}
  }
  ids.forEach(id => {
    const info = found.get(id) || { count: 0, hasUnseen: false };
    cache.set(id, { ...info, at: Date.now() });
    (batch.get(id) || []).forEach(cb => cb(info));
  });
}

export function loadStatusInfo(userId: string): Promise<StatusInfo> {
  const c = cache.get(userId);
  if (c && Date.now() - c.at < TTL) return Promise.resolve({ count: c.count, hasUnseen: c.hasUnseen });
  return new Promise(resolve => {
    const list = waiting.get(userId) || [];
    list.push(resolve); waiting.set(userId, list);
    if (!timer) timer = setTimeout(flush, 30);
  });
}
