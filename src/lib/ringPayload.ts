// src/lib/ringPayload.ts   (NEW FILE)
//
// One canonical shape for "something is ringing" (voice call, video call,
// or a Watch Together invite), plus a tolerant parser for every wrapper the
// payload can arrive in:
//   • raw FCM data                        -> { type, callerName, ... }
//   • Expo push service (Android)         -> { body: '{"type":...}', title, message, ... }
//   • expo-notifications background task  -> { data: { dataString: '{"type":...}' } }
//   • our own notifee notification data   -> { type, id, fromName, ... }
//   • Supabase realtime broadcast payload -> { callerName, callerPhoto, ... }
//
// Nothing here imports React, Supabase or native modules, so it is safe to
// load from index.js in a headless (app-killed) JS context.

export type RingType = 'incoming_call' | 'cowatch_invite';

export interface RingPayload {
  type: RingType;
  /** Dedupe key. Calls: call:<roomName>_<sentAt>. Cowatch: cowatch:<sessionId>. */
  id: string;
  /** false when an old client sent no callId (dedupe window is then short). */
  unique: boolean;
  conversationId: string;
  fromId: string;
  fromName: string;
  fromPhoto?: string;
  // calls
  callType?: 'voice' | 'video';
  roomName?: string;
  // cowatch
  sessionId?: string;
}

export interface CancelPayload {
  type: 'call_cancelled' | 'cowatch_cancelled';
  roomName?: string;
  sessionId?: string;
}

const RING_TYPES = new Set(['incoming_call', 'cowatch_invite']);
const CANCEL_TYPES = new Set(['call_cancelled', 'cowatch_cancelled']);

function tryJson(v: any): any {
  if (typeof v !== 'string') return null;
  try { return JSON.parse(v); } catch { return null; }
}

function isObj(v: any): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

const str = (v: any): string | undefined =>
  v === undefined || v === null || v === '' ? undefined : String(v);

/** Finds the object that actually carries our `type` inside any wrapper. */
export function extractPushData(raw: any): Record<string, any> | null {
  if (!raw) return null;
  const candidates: any[] = [
    raw,
    raw?.data,
    raw?.data?.data,
    tryJson(raw?.dataString),
    tryJson(raw?.data?.dataString),
    tryJson(raw?.body),
    tryJson(raw?.data?.body),
    raw?.notification?.request?.content?.data,
    raw?.notification?.data,
    tryJson(raw?.notification?.data?.dataString),
    tryJson(raw?.notification?.request?.trigger?.remoteMessage?.data?.body),
  ];
  for (const c of candidates) {
    if (isObj(c) && typeof c.type === 'string' && (RING_TYPES.has(c.type) || CANCEL_TYPES.has(c.type))) {
      return c;
    }
  }
  return null;
}

export function parseRingData(raw: any): RingPayload | null {
  const d = extractPushData(raw);
  if (!d || !RING_TYPES.has(d.type)) return null;

  if (d.type === 'cowatch_invite') {
    const sessionId = str(d.sessionId);
    if (!sessionId) return null;
    return {
      type: 'cowatch_invite',
      id: str(d.id) || `cowatch:${sessionId}`,
      unique: true,
      conversationId: str(d.conversationId) || '',
      fromId: str(d.inviterId) || str(d.fromId) || str(d.from_user_id) || '',
      fromName: str(d.inviterName) || str(d.fromName) || str(d.otherName) || 'Someone',
      fromPhoto: str(d.inviterPhoto) || str(d.fromPhoto),
      sessionId,
    };
  }

  const roomName = str(d.roomName);
  if (!roomName) return null;
  const callId = str(d.callId);
  return {
    type: 'incoming_call',
    id: str(d.id) || `call:${callId || roomName}`,
    unique: !!(callId || str(d.id)),
    conversationId: str(d.conversationId) || '',
    fromId: str(d.callerId) || str(d.fromId) || '',
    fromName: str(d.callerName) || str(d.fromName) || 'Someone',
    fromPhoto: str(d.callerPhoto) || str(d.fromPhoto),
    callType: d.callType === 'video' ? 'video' : 'voice',
    roomName,
  };
}

export function parseCancelData(raw: any): CancelPayload | null {
  const d = extractPushData(raw);
  if (!d || !CANCEL_TYPES.has(d.type)) return null;
  return { type: d.type, roomName: str(d.roomName), sessionId: str(d.sessionId) };
}

/** notifee needs a flat string->string map. */
export function toNotifeeData(p: RingPayload): Record<string, string> {
  const out: Record<string, string> = {
    type: p.type,
    id: p.id,
    conversationId: p.conversationId,
    fromId: p.fromId,
    fromName: p.fromName,
    fromPhoto: p.fromPhoto || '',
  };
  if (p.callType) out.callType = p.callType;
  if (p.roomName) out.roomName = p.roomName;
  if (p.sessionId) out.sessionId = p.sessionId;
  return out;
}

/** Deterministic notifee id, so a cancel push (which only knows the
 *  roomName / sessionId) can find the notification to remove. */
export function ringNotificationId(t: { type: string; roomName?: string; sessionId?: string }): string {
  return t.type === 'cowatch_invite' || t.type === 'cowatch_cancelled'
    ? `cowatch_${t.sessionId}`
    : `call_${t.roomName}`;
}
