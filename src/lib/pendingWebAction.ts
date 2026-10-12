// src/lib/pendingWebAction.ts  — app side of "like/comment after download"
// npx expo install expo-application   (Android only; uses the Play install referrer)
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'lv_pending_web_action';
export type PendingWebAction = { action: string; postId: string } | null;

// 1) Call ONCE on first app launch (e.g. in App.tsx useEffect) — before or after signup.
export async function captureWebIntent() {
  if (Platform.OS !== 'android' || (await AsyncStorage.getItem('lv_referrer_read'))) return;
  await AsyncStorage.setItem('lv_referrer_read', '1');
  try {
    const ref = await Application.getInstallReferrerAsync(); // "lv_action=like&lv_post=<id>&utm_source=web_share"
    const q = new URLSearchParams(ref || '');
    const action = q.get('lv_action'), postId = q.get('lv_post');
    if (action && postId) await AsyncStorage.setItem(KEY, JSON.stringify({ action, postId }));
  } catch {}
}

// 2) Call right after the user is signed in and the main navigator is ready.
//    Likes are done here; for comment/gift/watch the caller opens the video so the user finishes it.
export async function runPendingWebAction(supabase: any, userId: string): Promise<PendingWebAction> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return null;
  await AsyncStorage.removeItem(KEY);
  const p = JSON.parse(raw) as { action: string; postId: string };
  if (p.action === 'like') {
    const { data } = await supabase.from('likes').select('post_id').eq('post_id', p.postId).eq('user_id', userId).maybeSingle();
    if (!data) await supabase.from('likes').insert({ post_id: p.postId, user_id: userId });
  }
  return p; // then: navigate to the video p.postId (and open comments / gift sheet if p.action says so)
}
// Existing users who tap "I already have the app": the link is lumvibe://post/<id>?action=like —
// in useDeepLinks.ts read the `action` query param and pass it to runPendingWebAction-style handling.
