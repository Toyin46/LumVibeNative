// src/lib/chatNotifications.ts   (NEW FILE)
//
// WhatsApp-style message notifications for Android when the app is closed or in
// the background:
//
//   [round photo, logo badge]  David Joshua           now
//                              Hi
//                              How far?
//   [ Reply ]  [ Mark as read ]  [ Mute ]
//
// • one notification per conversation; new messages pile up inside it
// • all chats are grouped under one "LumVibe" stack
// • Reply sends the message straight from the notification (no app opening)
// • Mark as read / Mute work without opening the app
// • tapping it opens that chat
//
// The push itself comes from the notify-message edge function (a database
// trigger fires it whenever a message is saved), so it works no matter which
// screen or device sent the message.

import notifee, {
    AndroidImportance,
    AndroidVisibility,
    AndroidCategory,
    AndroidStyle,
    AndroidGroupAlertBehavior,
    Event,
    EventType,
    Notification,
  } from '@notifee/react-native';
  import { supabase } from '../config/supabase';
  import type { ChatPayload } from './ringPayload';
  import { enqueueRingAction } from './incomingRing';
  
  export const CHAT_CHANNEL_ID = 'chat_messages_v1';
  const GROUP_ID = 'lumvibe_chats';
  const SUMMARY_ID = 'chats_summary';
  const SMALL_ICON = 'notification_icon';
  const BRAND = '#00e676';
  const MAX_HISTORY = 8;
  const MUTE_HOURS = 8;
  
  interface HistItem { t: string; ts: number; mine?: boolean }
  interface ChatBase {
    conversationId: string;
    senderId: string;
    senderName: string;
    senderPhoto?: string;
    recipientId: string;
  }
  
  const notifId = (conversationId: string) => `chat_${conversationId}`;
  
  let channelReady: Promise<void> | null = null;
  function ensureChatChannel(): Promise<void> {
    if (!channelReady) {
      channelReady = (async () => {
        try {
          if (await notifee.getChannel(CHAT_CHANNEL_ID)) return;
          await notifee.createChannel({
            id: CHAT_CHANNEL_ID,
            name: 'Messages',
            importance: AndroidImportance.HIGH,
            sound: 'default',
            vibration: true,
            visibility: AndroidVisibility.PUBLIC,
          });
        } catch (e) {
          console.warn('[chat] channel create failed:', e);
        }
      })();
      channelReady.catch(() => { channelReady = null; });
    }
    return channelReady;
  }
  
  /** Messages already in this conversation's notification (kept in its data). */
  async function readHistory(conversationId: string): Promise<HistItem[]> {
    try {
      const shown = await notifee.getDisplayedNotifications();
      const n: any = shown.find((s: any) => s.id === notifId(conversationId));
      const raw = n?.notification?.data?.history;
      if (typeof raw === 'string') {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr.slice(-MAX_HISTORY);
      }
    } catch (_) {}
    return [];
  }
  
  async function post(base: ChatBase, history: HistItem[], alert: boolean) {
    await ensureChatChannel();
    const last = history[history.length - 1];
    const name = base.senderName || 'New message';
    const photo = base.senderPhoto || '';
  
    const build = (rich: boolean, withActions: boolean): Notification => ({
      id: notifId(base.conversationId),
      title: name,
      body: last?.t || 'New message',
      data: {
        type: 'chat_message',
        conversationId: base.conversationId,
        messageId: '',
        senderId: base.senderId,
        senderName: name,
        senderPhoto: photo,
        recipientId: base.recipientId,
        messageType: 'text',
        text: last?.t || '',
        sentAt: String(last?.ts || Date.now()),
        history: JSON.stringify(history),
      },
      android: {
        channelId: CHAT_CHANNEL_ID,
        ...(rich ? { smallIcon: SMALL_ICON } : {}),
        color: BRAND,
        category: AndroidCategory.MESSAGE,
        importance: AndroidImportance.HIGH,
        visibility: AndroidVisibility.PUBLIC,
        groupId: GROUP_ID,
        ...(photo ? { largeIcon: photo, circularLargeIcon: true } : {}),
        ...(rich
          ? {
              style: {
                type: AndroidStyle.MESSAGING,
                person: { name: 'You' },
                messages: history.map(h => ({
                  text: h.t,
                  timestamp: h.ts,
                  person: h.mine ? { name: 'You' } : { name, ...(photo ? { icon: photo } : {}) },
                })),
              },
            }
          : {}),
        showTimestamp: true,
        timestamp: last?.ts || Date.now(),
        autoCancel: true,
        onlyAlertOnce: !alert,
        pressAction: { id: 'open_chat', launchActivity: 'default' },
        ...(withActions
          ? {
              actions: [
                {
                  title: 'Reply',
                  pressAction: { id: 'reply' },
                  input: { placeholder: 'Reply…', allowFreeFormInput: true },
                },
                { title: 'Mark as read', pressAction: { id: 'mark_read' } },
                { title: 'Mute', pressAction: { id: 'mute' } },
              ],
            }
          : {}),
      },
    });
  
    const attempts: Array<[boolean, boolean]> = [[true, true], [true, false], [false, false]];
    for (const [rich, actions] of attempts) {
      try {
        await notifee.displayNotification(build(rich, actions));
        break;
      } catch (e) {
        console.warn('[chat] displayNotification attempt failed, trying simpler:', e);
      }
    }
  
    // The "LumVibe · N messages from N chats" stack header.
    try {
      await notifee.displayNotification({
        id: SUMMARY_ID,
        title: 'LumVibe',
        body: 'New messages',
        android: {
          channelId: CHAT_CHANNEL_ID,
          smallIcon: SMALL_ICON,
          color: BRAND,
          groupId: GROUP_ID,
          groupSummary: true,
          groupAlertBehavior: AndroidGroupAlertBehavior.CHILDREN,
          autoCancel: true,
          pressAction: { id: 'open_app', launchActivity: 'default' },
        },
      });
    } catch (_) {}
  }
  
  /** A message push arrived while the app is closed / in the background. */
  export async function displayChatNotification(p: ChatPayload): Promise<void> {
    const history = await readHistory(p.conversationId);
    history.push({ t: p.text, ts: p.sentAt });
    await post(
      {
        conversationId: p.conversationId,
        senderId: p.senderId,
        senderName: p.senderName,
        senderPhoto: p.senderPhoto,
        recipientId: p.recipientId,
      },
      history.slice(-MAX_HISTORY),
      true,
    );
  }
  
  async function removeSummaryIfEmpty() {
    try {
      const shown: any[] = await notifee.getDisplayedNotifications();
      if (!shown.some(s => typeof s.id === 'string' && s.id.startsWith('chat_'))) {
        await notifee.cancelNotification(SUMMARY_ID);
      }
    } catch (_) {}
  }
  
  /** Remove a conversation's notification (call when its chat is opened). */
  export async function cancelChatNotification(conversationId: string) {
    try {
      await notifee.cancelNotification(notifId(conversationId));
    } catch (_) {}
    await removeSummaryIfEmpty();
  }
  
  async function currentUserId(): Promise<string | null> {
    try {
      const { data } = await supabase.auth.getSession();
      return data?.session?.user?.id || null;
    } catch (_) { return null; }
  }
  
  async function markConversationRead(conversationId: string, userId: string) {
    try {
      await supabase.from('messages').update({ is_read: true })
        .eq('conversation_id', conversationId).neq('sender_id', userId).eq('is_read', false);
      await supabase.from('conversation_participants')
        .update({ unread_count: 0, last_read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId).eq('user_id', userId);
    } catch (e) { console.warn('[chat] mark read failed:', e); }
  }
  
  /** Reply / Mark as read / Mute / tap. Works with the app closed. */
  export async function handleChatEvent(event: Event, chat: ChatPayload): Promise<void> {
    const { type, detail } = event;
    if (type !== EventType.PRESS && type !== EventType.ACTION_PRESS) return;
    const actionId = detail.pressAction?.id;
    const base: ChatBase = {
      conversationId: chat.conversationId,
      senderId: chat.senderId,
      senderName: chat.senderName,
      senderPhoto: chat.senderPhoto,
      recipientId: chat.recipientId,
    };
  
    if (actionId === 'reply') {
      const text = String((detail as any).input || '').trim();
      const history = await readHistory(chat.conversationId);
      if (text) {
        const uid = await currentUserId();
        if (uid) {
          const { error } = await supabase.from('messages').insert({
            conversation_id: chat.conversationId,
            sender_id: uid,
            message_type: 'text',
            content: text,
            is_disappearing: false,
          });
          if (!error) {
            history.push({ t: text, ts: Date.now(), mine: true });
            markConversationRead(chat.conversationId, uid);
          } else {
            console.warn('[chat] reply failed:', error);
          }
        }
      }
      // Re-post (silently) so the "sending…" spinner on the Reply box goes away
      // and the person sees their reply in the thread, like WhatsApp.
      await post(base, history, false);
      return;
    }
  
    if (actionId === 'mark_read') {
      const uid = await currentUserId();
      if (uid) await markConversationRead(chat.conversationId, uid);
      await cancelChatNotification(chat.conversationId);
      return;
    }
  
    if (actionId === 'mute') {
      const uid = await currentUserId();
      if (uid) {
        try {
          await supabase.from('conversation_mutes').upsert({
            user_id: uid,
            conversation_id: chat.conversationId,
            muted_until: new Date(Date.now() + MUTE_HOURS * 3600 * 1000).toISOString(),
          });
        } catch (e) { console.warn('[chat] mute failed:', e); }
      }
      await cancelChatNotification(chat.conversationId);
      return;
    }
  
    // tap on the notification (or the app-open summary)
    await cancelChatNotification(chat.conversationId);
    enqueueRingAction({
      action: 'openchat',
      chat: {
        conversationId: chat.conversationId,
        senderId: chat.senderId,
        senderName: chat.senderName,
        senderPhoto: chat.senderPhoto,
      },
    });
  }
  