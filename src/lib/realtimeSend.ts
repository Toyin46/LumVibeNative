// src/lib/realtimeSend.ts   (NEW FILE)
//
// One-shot realtime broadcast that never disturbs a channel the screen already
// has open. Supabase returns the SAME channel object when you ask for a topic
// that already exists on this phone (e.g. the chat screen's
// `call_signal:<conversationId>`). The old fire-and-forget helpers then called
// subscribe() on it a second time and removeChannel() afterwards, which closes
// the chat screen's own channel — after that the chat screen stops hearing
// anything until it is re-opened. This sends on the open channel if there is
// one, and only creates + removes a channel when it made it itself.

import { supabase } from '../config/supabase';

export function sendBroadcastOnce(topic: string, event: string, payload: any) {
  try {
    const existing = (supabase as any).getChannels?.().find((c: any) => c.topic === `realtime:${topic}`);
    if (existing && existing.state === 'joined') {
      existing.send({ type: 'broadcast', event, payload }).catch(() => {});
      return;
    }
  } catch (_) {}

  try {
    const channel = supabase.channel(topic, { config: { broadcast: { self: false } } });
    channel.subscribe((status: string) => {
      if (status === 'SUBSCRIBED') {
        channel.send({ type: 'broadcast', event, payload })
          .catch(() => {})
          .finally(() => { supabase.removeChannel(channel); });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        supabase.removeChannel(channel);
      }
    });
  } catch (e) {
    console.warn('[ring] sendBroadcastOnce failed:', topic, event, e);
  }
}
