// src/status/statusApi.ts
//
// Everything the Status feature asks the server. All privacy rules (who may
// see a status) are enforced INSIDE the database, so even a modified app can
// not read a status it is not allowed to see.
//
//   visibility 'friends' = private  → friends only
//   visibility 'public'             → friends + followers + anyone who opens the profile

import { supabase } from '../config/supabase';

export type StatusPerson = {
  user_id: string; username: string; display_name: string | null; avatar_url: string | null;
  story_count: number; latest_at: string; is_me: boolean; has_unseen: boolean;
};

export type StatusItem = {
  id: string; user_id: string; media_url: string; media_type: 'image' | 'video' | 'text';
  caption: string | null; text_content: string | null; bg_color: string | null;
  visibility: 'friends' | 'public'; created_at: string; expires_at: string;
  view_count: number; viewed: boolean; my_reaction: string | null; gift_total: number;
  audio_url?: string | null; audio_kind?: 'voice' | 'music' | null; audio_title?: string | null; audio_duration?: number | null;
};

export type StatusViewerRow = {
  viewer_id: string; username: string; display_name: string | null; avatar_url: string | null;
  viewed_at: string; emoji: string | null; gift_amount: number;
};

export async function fetchStatusFeed(): Promise<StatusPerson[]> {
  try {
    const { data, error } = await supabase.rpc('get_status_feed');
    if (error) throw error;
    return (data as StatusPerson[]) || [];
  } catch (e) { console.warn('fetchStatusFeed failed:', e); return []; }
}

export async function fetchUserStatuses(userId: string): Promise<StatusItem[]> {
  try {
    const { data, error } = await supabase.rpc('get_user_statuses', { p_user_id: userId });
    if (error) throw error;
    return (data as StatusItem[]) || [];
  } catch (e) { console.warn('fetchUserStatuses failed:', e); return []; }
}

export async function markStatusViewed(id: string) {
  try { await supabase.rpc('mark_status_viewed', { p_story_id: id }); } catch {}
}

export async function fetchStatusViewers(id: string): Promise<StatusViewerRow[]> {
  try {
    const { data, error } = await supabase.rpc('get_status_viewers', { p_story_id: id });
    if (error) throw error;
    return (data as StatusViewerRow[]) || [];
  } catch (e) { console.warn('fetchStatusViewers failed:', e); return []; }
}

export async function deleteStatus(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('delete_status', { p_story_id: id });
  return !error && !!data;
}

export async function setStatusVisibility(id: string, visibility: 'friends' | 'public'): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_status_visibility', { p_story_id: id, p_visibility: visibility });
  return !error && !!data;
}

type Res = { success: boolean; error?: string; conversation_id?: string; new_balance?: number };
async function call(fn: string, args: Record<string, any>): Promise<Res> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { success: false, error: error.message };
  return (data as Res) || { success: false, error: 'No answer from the server.' };
}
export const reactToStatus  = (id: string, emoji: string) => call('react_to_status', { p_story_id: id, p_emoji: emoji });
export const replyToStatus  = (id: string, text: string)  => call('reply_to_status', { p_story_id: id, p_text: text });
export const sendStatusGift = (id: string, amount: number, label: string, icon: string) =>
  call('send_status_gift', { p_story_id: id, p_amount: amount, p_label: label, p_icon: icon });

// "Today, 9:46 AM" / "Yesterday, 4:10 PM" / "12 Nov, 4:10 PM"
export function statusTimeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return `Today, ${time}`;
  if (sameDay(d, y)) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
}

// small picture for lists (Cloudinary resizes it for us; other hosts are left alone)
export function statusThumb(item: Pick<StatusItem, 'media_url' | 'media_type'>): string | undefined {
  const u = item.media_url;
  if (!u || item.media_type === 'text') return undefined;
  if (u.includes('res.cloudinary.com') && u.includes('/image/upload/'))
    return u.replace('/image/upload/', '/image/upload/w_160,h_160,c_fill,q_auto:low/');
  if (u.includes('res.cloudinary.com') && u.includes('/video/upload/'))
    return u.replace('/video/upload/', '/video/upload/so_0,w_160,h_160,c_fill,q_auto:low/').replace(/\.[a-z0-9]+(\?.*)?$/i, '.jpg');
  return item.media_type === 'image' ? u : undefined;
}

// the SAME gifts, prices and coin→naira rate as the feed and the chat
export const COIN_TO_NGN = 150;
export const coinsToNGN = (coins: number) => `₦${(coins * COIN_TO_NGN).toLocaleString('en-NG')}`;
export const GIFT_PACKAGES = [
  { id: 'spark', name: 'Spark', icon: '✨', coins: 1, color: '#ffdd55' },
  { id: 'heart', name: 'Heart', icon: '❤️', coins: 3, color: '#ff4757' },
  { id: 'smile', name: 'Smile', icon: '😊', coins: 5, color: '#ffd93d' },
  { id: 'rose', name: 'Rose', icon: '🌹', coins: 10, color: '#ff69b4' },
  { id: 'candy', name: 'Candy', icon: '🍬', coins: 15, color: '#ff85c8' },
  { id: 'balloon', name: 'Balloon', icon: '🎈', coins: 20, color: '#ff6b6b' },
  { id: 'star', name: 'Star', icon: '⭐', coins: 25, color: '#ffd700' },
  { id: 'cupcake', name: 'Cupcake', icon: '🧁', coins: 30, color: '#ffb6c1' },
  { id: 'bouquet', name: 'Bouquet', icon: '💐', coins: 40, color: '#ff8fab' },
  { id: 'ice_cream', name: 'Ice Cream', icon: '🍦', coins: 50, color: '#00bfff' },
  { id: 'gift_box', name: 'Gift Box', icon: '🎁', coins: 60, color: '#ff4d6d' },
  { id: 'sparkler', name: 'Sparkler', icon: '🎇', coins: 70, color: '#ffe066' },
  { id: 'diamond_ring', name: 'Diamond Ring', icon: '💍', coins: 80, color: '#00e5ff' },
  { id: 'love_letter', name: 'Love Letter', icon: '💌', coins: 100, color: '#ff4d8f' },
  { id: 'crown', name: 'Crown', icon: '👑', coins: 150, color: '#ffd700' },
  { id: 'fireworks', name: 'Fireworks', icon: '🎆', coins: 200, color: '#ff6347' },
  { id: 'rocket', name: 'Rocket', icon: '🚀', coins: 250, color: '#00ff88' },
  { id: 'unicorn', name: 'Unicorn', icon: '🦄', coins: 300, color: '#c77dff' },
  { id: 'castle', name: 'Castle', icon: '🏰', coins: 400, color: '#9d4edd' },
  { id: 'trophy', name: 'Trophy', icon: '🏆', coins: 500, color: '#cd7f32' },
];

// ───────────────────────── posting ─────────────────────────
const CLOUD_NAME    = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME    || 'dvllxm0wg';
const UPLOAD_PRESET = process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET || 'Kinsta_unsigned';

// upload a photo / video to Cloudinary with progress; resolves to the https link, or null
export function uploadStatusMedia(uri: string, type: 'image' | 'video' | 'audio', onProgress?: (pct: number) => void): Promise<string | null> {
  return new Promise(resolve => {
    try {
      const fd = new FormData();
      const mime = type === 'video' ? 'video/mp4' : type === 'audio' ? 'audio/mp4' : 'image/jpeg';
      const ext  = type === 'video' ? 'mp4' : type === 'audio' ? 'm4a' : 'jpg';
      fd.append('file', { uri, type: mime, name: `status_${Date.now()}.${ext}` } as any);
      fd.append('upload_preset', UPLOAD_PRESET);
      fd.append('folder', 'lumvibe_status');
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${type === 'image' ? 'image' : 'video'}/upload`);   // Cloudinary stores audio under "video"
      xhr.timeout = type === 'image' ? 90000 : 240000;
      xhr.upload.onprogress = (e: any) => { if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = () => {
        try {
          if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText).secure_url || null);
          else { console.warn('status upload failed', xhr.status, (xhr.responseText || '').slice(0, 200)); resolve(null); }
        } catch { resolve(null); }
      };
      xhr.onerror = () => resolve(null);
      xhr.ontimeout = () => resolve(null);
      xhr.send(fd);
    } catch { resolve(null); }
  });
}

export type PostStatusArgs = {
  mediaUrl?: string; mediaType: 'image' | 'video' | 'text'; caption?: string; text?: string; bg?: string;
  visibility: 'friends' | 'public' | 'private'; contextType?: 'dm' | 'group' | 'circle'; contextId?: string;
  audioUrl?: string; audioKind?: 'voice' | 'music'; audioTitle?: string; audioDuration?: number;
};

// ONE safe path for posting; the database keeps exactly the privacy you picked
export async function postStatus(a: PostStatusArgs): Promise<{ success: boolean; error?: string; id?: string }> {
  const { data, error } = await supabase.rpc('post_status', {
    p_media_url: a.mediaUrl || '', p_media_type: a.mediaType, p_caption: a.caption || null, p_text: a.text || null,
    p_bg: a.bg || null, p_visibility: a.visibility, p_context_type: a.contextType || null, p_context_id: a.contextId || null,
    p_audio_url: a.audioUrl || null, p_audio_kind: a.audioKind || null, p_audio_title: a.audioTitle || null,
    p_audio_duration: a.audioDuration ? Math.round(a.audioDuration) : null,
  });
  if (error) return { success: false, error: error.message };
  return (data as any) || { success: false, error: 'No answer from the server.' };
}
