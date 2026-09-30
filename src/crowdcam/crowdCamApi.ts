// ─────────────────────────────────────────────────────────────
// src/crowdcam/crowdCamApi.ts
// Everything that talks to Supabase / Cloudinary for Crowd Cam.
// Uses the same Cloudinary cloud + unsigned preset as create.tsx.
// ─────────────────────────────────────────────────────────────
import { supabase } from '../config/supabase';

export const CROWD_CLOUD_NAME = 'dvllxm0wg';
const CROWD_UPLOAD_PRESET = 'Kinsta_unsigned';

export interface CrowdRoom {
  id: string;
  host_id: string;
  title: string;
  join_code: string;
  status: 'open' | 'recording' | 'closed';
  film_url: string | null;
  created_at: string;
}

export interface CrowdClipRow {
  id: string;
  room_id: string;
  user_id: string;
  cloudinary_public_id: string;
  media_url: string;
  duration_sec: number | null;
  recorded_at: string;
}

export async function createRoom(title: string): Promise<CrowdRoom> {
  const { data, error } = await supabase.rpc('create_crowd_room', { p_title: title });
  if (error) throw new Error(error.message);
  return data as CrowdRoom;
}

export async function joinRoom(code: string): Promise<CrowdRoom> {
  const { data, error } = await supabase.rpc('join_crowd_room', { p_code: code });
  if (error) throw new Error(error.message);
  return data as CrowdRoom;
}

export async function getRoom(roomId: string): Promise<CrowdRoom | null> {
  const { data, error } = await supabase.from('crowd_rooms').select('*').eq('id', roomId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CrowdRoom) ?? null;
}

/** host only (enforced by the database) */
export async function setRoomStatus(roomId: string, status: CrowdRoom['status']): Promise<void> {
  const { error } = await supabase.from('crowd_rooms').update({ status }).eq('id', roomId);
  if (error) throw new Error(error.message);
}

/** phones call this to hear the host press Start. Returns an unsubscribe function. */
export function watchRoom(roomId: string, onChange: (room: CrowdRoom) => void): () => void {
  const channel = supabase
    .channel('crowd_room_' + roomId)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'crowd_rooms', filter: `id=eq.${roomId}` },
      (payload: any) => onChange(payload.new as CrowdRoom),
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export interface CrowdPerson {
  user_id: string;
  username: string | null;
  is_host: boolean;
  has_clip: boolean;
}

/** everyone in the room (host first) and whether their clip has arrived */
export async function listPeople(roomId: string): Promise<CrowdPerson[]> {
  const { data, error } = await supabase.rpc('crowd_room_people', { p_room: roomId });
  if (error) throw new Error(error.message);
  return (data ?? []) as CrowdPerson[];
}

export interface LiveChannel {
  /** send a tiny JPEG (base64) of what this phone is seeing */
  send: (userId: string, jpegBase64: string) => void;
  close: () => void;
}

/**
 * Near-live preview: every phone sends a very small picture every couple of
 * seconds through Supabase Realtime "broadcast". Nothing is stored.
 */
export function openLiveChannel(roomId: string, onFrame: (userId: string, jpegBase64: string) => void): LiveChannel {
  let ready = false;
  const ch = supabase.channel('crowd_live_' + roomId, { config: { broadcast: { self: false } } });
  ch.on('broadcast', { event: 'frame' }, (msg: any) => {
    const p = msg?.payload;
    if (p && p.u && p.i) onFrame(String(p.u), String(p.i));
  }).subscribe((status: string) => { ready = status === 'SUBSCRIBED'; });
  return {
    send: (userId, jpegBase64) => {
      if (!ready) return;
      ch.send({ type: 'broadcast', event: 'frame', payload: { u: userId, i: jpegBase64 } });
    },
    close: () => { supabase.removeChannel(ch); },
  };
}

export async function countMembers(roomId: string): Promise<number> {
  const { count, error } = await supabase
    .from('crowd_members').select('user_id', { count: 'exact', head: true }).eq('room_id', roomId);
  if (error) return 0;
  return count ?? 0;
}

export async function listClips(roomId: string): Promise<CrowdClipRow[]> {
  const { data, error } = await supabase
    .from('crowd_clips').select('*').eq('room_id', roomId).order('recorded_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CrowdClipRow[];
}

export async function contributorNames(roomId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('crowd_room_contributors', { p_room: roomId });
  if (error) return [];
  return ((data ?? []) as { username: string | null }[]).map(d => d.username).filter(Boolean) as string[];
}

/** upload one recorded clip to Cloudinary, then register it in the room */
export function uploadClip(
  args: { roomId: string; userId: string; localUri: string; durationSec: number; recordedAt: Date },
  onProgress: (pct: number) => void,
): Promise<CrowdClipRow> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fd = new FormData();
    fd.append('file', { uri: args.localUri, type: 'video/mp4', name: `cc_${Date.now()}.mp4` } as any);
    fd.append('upload_preset', CROWD_UPLOAD_PRESET);
    fd.append('cloud_name', CROWD_CLOUD_NAME);
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = async () => {
      if (xhr.status !== 200) return reject(new Error(`Upload failed (${xhr.status})`));
      try {
        const d = JSON.parse(xhr.responseText);
        const { data, error } = await supabase.from('crowd_clips').insert({
          room_id: args.roomId,
          user_id: args.userId,
          cloudinary_public_id: d.public_id,
          media_url: d.secure_url,
          duration_sec: args.durationSec,
          recorded_at: args.recordedAt.toISOString(),
        }).select('*').single();
        if (error) return reject(new Error(error.message));
        resolve(data as CrowdClipRow);
      } catch (e: any) { reject(new Error(e?.message || 'Upload parse error')); }
    };
    xhr.onerror = () => reject(new Error('Network error while uploading'));
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CROWD_CLOUD_NAME}/video/upload`);
    xhr.send(fd);
  });
}
