// src/lib/googleAuth.ts
//
// "Continue with Google" for both Sign up and Log in (it is the same thing:
// a new Google account gets a LumVibe account created automatically).
//
// How it works: Supabase runs the Google sign-in in the phone's browser and
// sends the person back to the app with a code/token, which we turn into a
// session. No new native package, so this works with your current build.
//
// ONE-TIME SETUP (cannot be done from code) — see the notes that came with this file:
//   Google Cloud  → create an OAuth "Web application" client
//   Supabase      → Authentication → Providers → Google: paste Client ID + Secret
//   Supabase      → Authentication → URL Configuration → Redirect URLs: add
//                   lumvibenative://google-auth

import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { supabase } from '../config/supabase';
import { useAuthStore } from '../store/authStore';
import { generateReferralCode } from '../utils/referralRewards';
import { checkAndApplyPendingReferral } from '../utils/referralUtils';

WebBrowser.maybeCompleteAuthSession();

export type GoogleResult = { ok: boolean; cancelled?: boolean; error?: string };

async function waitForStoreUser(ms = 3000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (useAuthStore.getState().user?.id) return true;
    await new Promise(r => setTimeout(r, 150));
  }
  return !!useAuthStore.getState().user?.id;
}

// things every NEW account gets in the normal sign-up (referral code), and any
// referral code the person typed before tapping the Google button
async function finishGoogleAccount(userId: string) {
  try {
    const { data: row } = await supabase.from('users').select('username, referral_code').eq('id', userId).maybeSingle();
    if (row && !row.referral_code && row.username) {
      const code = await generateReferralCode(row.username);
      if (code) await supabase.from('users').update({ referral_code: code }).eq('id', userId);
    }
  } catch (e) { console.warn('google referral code skipped:', e); }
  try { await checkAndApplyPendingReferral(userId); } catch {}
}

export async function signInWithGoogle(): Promise<GoogleResult> {
  try {
    // a different path from the e-mail link ("auth-callback") so the two never collide
    const redirectTo = Linking.createURL('google-auth');

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
    });
    if (error || !data?.url) throw error || new Error('Could not start Google sign-in.');

    const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (res.type !== 'success' || !res.url) return { ok: false, cancelled: true };

    const url = res.url;
    const query = url.includes('?') ? url.split('?')[1].split('#')[0] : '';
    const frag  = url.includes('#') ? url.split('#')[1] : '';
    const qp = new URLSearchParams(query);
    const fp = new URLSearchParams(frag);

    const code = qp.get('code');
    const at = fp.get('access_token');
    const rt = fp.get('refresh_token');

    if (code) {
      const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
      if (exErr) throw exErr;
    } else if (at && rt) {
      const { error: sessErr } = await supabase.auth.setSession({ access_token: at, refresh_token: rt });
      if (sessErr) throw sessErr;
    } else {
      throw new Error(qp.get('error_description') || fp.get('error_description') || 'Google sign-in did not finish.');
    }

    const { data: sess } = await supabase.auth.getSession();
    const userId = sess.session?.user?.id;
    if (!userId) throw new Error('Signed in, but no session was found.');

    // your authStore already listens for new sessions (onAuthStateChange), so the
    // app switches to the main screens by itself — we only wait a moment for it
    await waitForStoreUser();
    await finishGoogleAccount(userId);
    return { ok: true };
  } catch (e: any) {
    console.warn('Google sign-in failed:', e);
    return { ok: false, error: e?.message || 'Google sign-in failed. Please try again.' };
  }
}
