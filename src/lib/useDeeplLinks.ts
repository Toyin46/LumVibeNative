// src/lib/useDeepLinks.ts
//
// This is the missing "root _layout.tsx Linking listener" that
// referralUtils.ts's own comments already referenced — savePendingReferral/
// savePendingPost were fully built for this, they just had nothing calling
// them since the expo-router → React Navigation migration. This hook is
// that listener, for all three link types the website builds via
// buildAppLink() in lumvibe-web/public/index.html:
//   - lumvibe://invite?ref=<code>       → savePendingReferral (existing)
//   - lumvibe://post/<id>, .../video/<id> → savePendingPost (existing)
//   - lumvibe://cowatch/<sessionId>     → savePendingCowatch (new, added
//     to referralUtils.ts alongside the post pair, same pattern)
//
// Referral deliberately does NOT get "resumed" from this hook — that's
// already handled by login.tsx's checkAndApplyPendingReferral() (for the
// email-verification gap) and signup.tsx's new peekPendingReferralCode()
// prefill (for the immediate-session case). This hook's only job for
// referral is the save, which is the one piece that was actually missing.
//
// Post and cowatch DO get resumed here, since neither had an existing
// "resume" call site anywhere:
//   - If `user` is already truthy when the link arrives (warm open,
//     already logged in), navigate immediately.
//   - If not, save and wait — the `user` effect below fires the moment
//     RootNavigator swaps from AuthStack to Main, and resumes then.
//
// Native-config caveats (unchanged from before):
// 1. Needs "lumvibe" registered as a scheme — fixed in app.json/app.config.js
//    ("scheme": ["lumvibenative", "lumvibe"]), needs a new EAS build.
// 2. Real Universal/App Links (no browser flash) need apple-app-site-
//    association + assetlinks.json + native associated-domains config —
//    bigger, separate lift, not attempted here.

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { Linking } from 'react-native';
import type { NavigationContainerRef } from '@react-navigation/native';
import {
  savePendingReferral,
  savePendingPost,
  getAndClearPendingPost,
  savePendingCowatch,
  getAndClearPendingCowatch,
} from '../utils/referralUtils';
import { useAuthStore } from '../store/authStore';

type DeepLinkAction =
  | { type: 'cowatch'; sessionId: string }
  | { type: 'post'; postId: string; postType: 'post' | 'video' }
  | { type: 'referral'; code: string };

function parseDeepLink(url: string | null): DeepLinkAction | null {
  if (!url) return null;
  let m = url.match(/cowatch\/([a-zA-Z0-9-]+)/);
  if (m) return { type: 'cowatch', sessionId: m[1] };
  // Check video/ before post/ — sharePostLink() in referralUtils.ts uses
  // distinct video/ vs post/ paths for the two post types.
  m = url.match(/video\/([a-zA-Z0-9-]+)/);
  if (m) return { type: 'post', postId: m[1], postType: 'video' };
  m = url.match(/post\/([a-zA-Z0-9-]+)/);
  if (m) return { type: 'post', postId: m[1], postType: 'post' };
  m = url.match(/[?&]ref=([a-zA-Z0-9_-]+)/);
  if (m) return { type: 'referral', code: m[1] };
  return null;
}

// ✅ FIX: was `RefObject<NavigationContainerRef<any>>` (no null) — but
// App.tsx creates it with `useRef<NavigationContainerRef<any>>(null)`,
// which types as `RefObject<NavigationContainerRef<any> | null>` since
// the ref genuinely is null until NavigationContainer mounts and attaches
// it. Every access below already uses `navigationRef.current?.` so the
// null case was always handled correctly at runtime — this only widens
// the parameter type to match what TS actually infers for the ref.
export function useDeepLinks(navigationRef: RefObject<NavigationContainerRef<any> | null>) {
  const { user } = useAuthStore();
  const userRef = useRef(user);
  userRef.current = user;

  const goToPost = (postId: string) => {
    navigationRef.current?.navigate('PostDetail', { postId } as never);
  };
  const goToCowatch = (sessionId: string) => {
    navigationRef.current?.navigate('Main', {
      screen: 'Messages',
      params: {
        screen: 'Cowatch',
        // conversationId: '' is what puts cowatch.tsx's setupSession into
        // its isExternalInvite branch.
        params: { conversationId: '', otherName: '', otherPhoto: '', sessionId },
      },
    } as never);
  };

  useEffect(() => {
    const handleUrl = async (url: string | null) => {
      const action = parseDeepLink(url);
      if (!action) return;

      if (action.type === 'referral') {
        // Save only — see file header for where this gets applied.
        await savePendingReferral(action.code);
        return;
      }

      if (action.type === 'post') {
        await savePendingPost(action.postId, action.postType);
        if (userRef.current) {
          await getAndClearPendingPost(); // clear it, we're navigating now
          goToPost(action.postId);
        }
        return;
      }

      // cowatch
      await savePendingCowatch(action.sessionId);
      if (userRef.current) {
        await getAndClearPendingCowatch();
        goToCowatch(action.sessionId);
      }
    };

    // Cold start: app was fully closed and opened directly via the link.
    Linking.getInitialURL().then(handleUrl);
    // Warm/backgrounded: app was already running when the link was tapped.
    const sub = Linking.addEventListener('url', ({ url }: { url: string }) => handleUrl(url));
    return () => sub.remove();
  }, []);

  // Resumes a post/cowatch link that arrived while logged out, the moment
  // RootNavigator swaps to Main (user just became truthy).
  useEffect(() => {
    if (!user) return;
    (async () => {
      const pendingPost = await getAndClearPendingPost();
      if (pendingPost) { setTimeout(() => goToPost(pendingPost.postId), 300); return; }
      const pendingCowatchId = await getAndClearPendingCowatch();
      if (pendingCowatchId) setTimeout(() => goToCowatch(pendingCowatchId), 300);
    })();
  }, [user]);
}
