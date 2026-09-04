// src/lib/authDeepLink.ts
//
// Catches the link from the "Check Your Email" verification email (and any
// other Supabase auth email — password reset, magic link, etc.) when it
// opens the app, and completes the sign-in.
//
// ✅ FIX (real root cause of the verification link freezing/crashing the
// app): this didn't exist anywhere before. signup.tsx's signUp() call had
// no emailRedirectTo, so Supabase sent people to a generic dashboard "Site
// URL" instead of the app — and even with that fixed (see signup.tsx),
// NOTHING was listening for the app to actually be opened via that link.
// This closes both gaps: emailRedirectTo now points at
// 'lumvibenative://auth-callback' (the scheme registered in
// app_config.js), and this hook is what actually catches that and
// completes the session.
//
// Handles two separate cases, both required for this to actually work:
//   1. App already running/backgrounded — the live 'url' event listener.
//   2. App was fully closed and the link itself launched it (cold start) —
//      Linking.getInitialURL(), checked once on mount, since the live
//      listener alone is registered too late to catch that original open.
//
// Handles both Supabase auth flow types, since supabase.ts doesn't pin one
// explicitly:
//   - PKCE:     the URL contains "?code=..." -> exchangeCodeForSession(url)
//   - Implicit: the URL contains "#access_token=...&refresh_token=..."
//               -> setSession({ access_token, refresh_token })

import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { supabase } from '../config/supabase';

async function completeSessionFromUrl(url: string) {
  if (!url || !url.includes('auth-callback')) return;

  try {
    if (url.includes('code=')) {
      const { error } = await supabase.auth.exchangeCodeForSession(url);
      if (error) console.warn('[LumVibe] exchangeCodeForSession failed:', error.message);
      return;
    }

    // Implicit flow puts the tokens after a "#", which Linking's URL
    // parser doesn't treat as a normal query string — parse manually.
    const hashIndex = url.indexOf('#');
    if (hashIndex !== -1) {
      const params = new URLSearchParams(url.slice(hashIndex + 1));
      const access_token  = params.get('access_token');
      const refresh_token = params.get('refresh_token');
      if (access_token && refresh_token) {
        const { error } = await supabase.auth.setSession({ access_token, refresh_token });
        if (error) console.warn('[LumVibe] setSession from deep link failed:', error.message);
      }
    }
  } catch (e) {
    console.warn('[LumVibe] auth deep link handling failed:', e);
  }
}

export function useAuthDeepLink() {
  useEffect(() => {
    // Case 1: app already running, link arrives via the live listener.
    const subscription = Linking.addEventListener('url', ({ url }) => {
      completeSessionFromUrl(url);
    });

    // Case 2: app was fully closed — the link is what launched it. The
    // live listener above is registered too late to have caught that
    // original open, so this checks for it once, right after mount.
    Linking.getInitialURL().then(url => {
      if (url) completeSessionFromUrl(url);
    });

    return () => subscription.remove();
  }, []);
}
