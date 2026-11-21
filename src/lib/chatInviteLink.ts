// src/lib/chatInviteLink.ts
//
// "Share my chat invite link" — the receiving side.
//
// Someone taps  https://lumvibe.site/chat/invite/<code>  (or the app's own
// lumvibenative://chat/invite/<code>). This hook:
//   1. remembers the code on the phone (so it survives sign-up, the e-mail
//      verification trip and closing the app),
//   2. as soon as the person is LOGGED IN, asks the server to open the
//      one-to-one chat with whoever shared the link (public.accept_chat_invite),
//   3. takes them straight into that chat.
//
// A person who is not logged in simply keeps the code until they sign up /
// log in — that is the "they must create an account first" part.

import { useCallback, useEffect, useRef } from 'react';
import { Alert, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NavigationContainerRef } from '@react-navigation/native';
import { supabase } from '../config/supabase';
import { useAuthStore } from '../store/authStore';

const PENDING_KEY = 'lumvibe_pending_chat_invite';

export function parseChatInviteCode(url?: string | null): string | null {
  if (!url) return null;
  const m = url.match(/chat\/invite\/([A-Za-z0-9]{6,40})/);
  return m ? m[1] : null;
}

export async function getPendingChatInvite(): Promise<string | null> {
  try { return await AsyncStorage.getItem(PENDING_KEY); } catch { return null; }
}

async function savePendingChatInvite(code: string) {
  try { await AsyncStorage.setItem(PENDING_KEY, code); } catch {}
}

export async function clearPendingChatInvite() {
  try { await AsyncStorage.removeItem(PENDING_KEY); } catch {}
}

export function useChatInviteLink(navigationRef: React.RefObject<NavigationContainerRef<any>>) {
  const { user } = useAuthStore();
  const busy = useRef(false);

  // wait (up to ~6 s) until the navigator has switched to the logged-in screens
  const navigateWhenReady = useCallback((go: () => void) => {
    let tries = 0;
    const tick = () => {
      const nav = navigationRef.current;
      if (nav && nav.isReady() && nav.getRootState()?.routeNames?.includes('Main')) { go(); return; }
      if (++tries < 20) setTimeout(tick, 300);
    };
    tick();
  }, [navigationRef]);

  const acceptPending = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const code = await getPendingChatInvite();
      if (!code) return;

      const { data, error } = await supabase.rpc('accept_chat_invite', { p_code: code });
      if (error) return;                       // probably no internet — keep the code, try again later
      if (!data?.success) {
        await clearPendingChatInvite();
        Alert.alert('Invite link', data?.error || 'This invite link is not valid any more.');
        return;
      }

      const { data: other } = await supabase
        .from('users')
        .select('id, username, display_name, photo_url, avatar_url')
        .eq('id', data.inviter_id)
        .maybeSingle();

      await clearPendingChatInvite();

      navigateWhenReady(() => {
        navigationRef.current?.navigate('Main', {
          screen: 'Messages',
          params: {
            screen: 'ChatDM',
            params: {
              id: data.conversation_id,
              otherUserId: data.inviter_id,
              otherName: other?.display_name || other?.username || 'LumVibe user',
              otherPhoto: other?.photo_url || other?.avatar_url || '',
            },
          },
        });
      });
    } catch (e) {
      console.warn('chat invite accept failed:', e);
    } finally {
      busy.current = false;
    }
  }, [navigateWhenReady, navigationRef]);

  // 1) catch the link — app opened by it (cold start) or already running
  useEffect(() => {
    const handle = async (url?: string | null) => {
      const code = parseChatInviteCode(url);
      if (!code) return;
      await savePendingChatInvite(code);
      if (useAuthStore.getState().user?.id) acceptPending();
    };
    Linking.getInitialURL().then(handle).catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => { handle(url); });
    return () => sub.remove();
  }, [acceptPending]);

  // 2) once the person is logged in, open the chat
  useEffect(() => {
    if (user?.id) acceptPending();
  }, [user?.id, acceptPending]);
}
