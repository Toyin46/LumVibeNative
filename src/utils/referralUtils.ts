// FILE: app/utils/referralUtils.ts
// ✅ Core referral utilities — points-only system
// ✅ NEW: shareReferralLink() — shares a proper lumvibe.site/invite?ref=CODE link
// ✅ NEW: sharePostLink()     — shares lumvibe.site/post/ID or /video/ID
// ✅ NEW: checkAndApplyPendingReferral() — reads AsyncStorage after signup, auto-applies code
// ✅ Deferred deep link support — no paid third party needed (uses AsyncStorage + Expo Linking)

import { Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../config/supabase'; 

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const BASE_URL = 'https://lumvibe.site';
const PENDING_REFERRAL_KEY = 'lumvibe_pending_referral';
const PENDING_POST_KEY     = 'lumvibe_pending_post';

// ─── CODE GENERATION ──────────────────────────────────────────────────────────

/**
* Generate a unique referral code (6 characters: LETTERS + NUMBERS)
* Excludes confusing characters: I, O, 0, 1
*/
export const generateReferralCode = (): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

/**
* Create a unique referral code for a user (checks DB for collisions)
*/
export const createUserReferralCode = async (userId: string): Promise<string> => {
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const code = generateReferralCode();

    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('referral_code', code)
      .maybeSingle();

    if (!existing) {
      const { error } = await supabase
        .from('users')
        .update({ referral_code: code })
        .eq('id', userId);

      if (!error) {
        console.log(`✅ Created referral code ${code} for user ${userId}`);
        return code;
      }
    }

    attempts++;
  }

  throw new Error('Failed to generate unique referral code');
};

// ─── REFERRAL PROCESSING ──────────────────────────────────────────────────────

/**
* Process a referral when someone signs up with a code.
* ✅ Gives POINTS ONLY (no coins)
*  - Referrer gets: 100 POINTS
*  - New user gets:  50 POINTS
*/
export const processReferral = async (
  newUserId: string,
  referralCode: string
): Promise<{ success: boolean; message: string; referrerId?: string }> => {
  try {
    console.log(`🔍 Processing referral: ${referralCode} for user ${newUserId}`);

    // Find the referrer by code
    const { data: referrer, error: referrerError } = await supabase
      .from('users')
      .select('id, username, successful_referrals, points')
      .eq('referral_code', referralCode.toUpperCase())
      .single();

    if (referrerError || !referrer) {
      console.error('❌ Referrer not found:', referrerError);
      return { success: false, message: 'Invalid referral code' };
    }

    // Can't refer yourself
    if (referrer.id === newUserId) {
      return { success: false, message: 'Cannot use your own referral code' };
    }

    // ✅ Check for duplicate referral BEFORE creating
    const { data: existingReferral } = await supabase
      .from('referrals')
      .select('id')
      .eq('referrer_id', referrer.id)
      .eq('referred_id', newUserId)
      .maybeSingle();

    if (existingReferral) {
      console.log('⚠️ Referral already exists — skipping');
      return {
        success: false,
        message: 'Referral already processed',
        referrerId: referrer.id,
      };
    }

    // Update new user's referred_by field
    await supabase
      .from('users')
      .update({ referred_by: referrer.id })
      .eq('id', newUserId);

    // ✅ Create referral record with duplicate prevention
    const { error: insertError } = await supabase
      .from('referrals')
      .insert({
        referrer_id:  referrer.id,
        referred_id:  newUserId,
        referral_code: referralCode.toUpperCase(),
        reward_given: true,
        status:       'completed',
      });

    // If DB unique constraint fires, just treat as success
    if (insertError) {
      if (insertError.code === '23505') {
        console.log('⚠️ Duplicate prevented by database constraint');
        return {
          success: true,
          message: 'Referral already processed',
          referrerId: referrer.id,
        };
      }
      throw insertError;
    }

    // ✅ Reward referrer: +100 POINTS
    const newReferrerPoints = (referrer.points || 0) + 100;
    await supabase
      .from('users')
      .update({
        points:               newReferrerPoints,
        successful_referrals: (referrer.successful_referrals || 0) + 1,
      })
      .eq('id', referrer.id);

    // ✅ Reward new user: +50 POINTS
    const { data: newUserData } = await supabase
      .from('users')
      .select('points')
      .eq('id', newUserId)
      .single();

    const newUserPoints = (newUserData?.points || 0) + 50;
    await supabase
      .from('users')
      .update({ points: newUserPoints })
      .eq('id', newUserId);

    // Send notification to referrer
    await supabase.from('notifications').insert({
      user_id:      referrer.id,
      type:         'referral',
      title:        'New Referral! 🎁',
      message:      `You earned 100 points for referring a friend!`,
      from_user_id: newUserId,
      is_read:      false,
    });

    console.log(`✅ Referral processed: ${referrer.username} → new user`);

    return {
      success:    true,
      message:    '🎉 Referral applied! You earned 50 points!',
      referrerId: referrer.id,
    };
  } catch (error: any) {
    console.error('❌ Referral processing error:', error);
    return {
      success: false,
      message: error.message || 'Failed to process referral',
    };
  }
};

// ─── REFERRAL STATS ───────────────────────────────────────────────────────────

/**
* Get referral stats for a user
*/
export const getUserReferralStats = async (userId: string) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('referral_code, successful_referrals')
      .eq('id', userId)
      .single();

    const { data: referrals } = await supabase
      .from('referrals')
      .select('referred_id, created_at')
      .eq('referrer_id', userId)
      .order('created_at', { ascending: false });

    return {
      referralCode:   user?.referral_code || null,
      totalReferrals: user?.successful_referrals || 0,
      referrals:      referrals || [],
    };
  } catch (error) {
    console.error('Error fetching referral stats:', error);
    return {
      referralCode:   null,
      totalReferrals: 0,
      referrals:      [],
    };
  }
};

// ─── SHARE LINKS ──────────────────────────────────────────────────────────────

/**
* Share a referral invite link.
* Link format: https://lumvibe.site/invite?ref=ABC123
*
* When clicked:
*  - If app is installed  → opens app, applies referral code automatically
*  - If not installed     → goes to Play Store, after install opens app and applies code
*
* @param referralCode  The user's 6-char referral code
* @param username      The user's @username (for personalised message)
* @param platform      Optional: 'whatsapp' | 'twitter' | 'instagram' | 'tiktok' | 'general'
*/
export const shareReferralLink = async (
  referralCode: string,
  username: string,
  platform?: 'whatsapp' | 'twitter' | 'instagram' | 'tiktok' | 'general'
): Promise<void> => {
  if (!referralCode || referralCode === 'ERROR') {
    console.warn('shareReferralLink: no valid referral code');
    return;
  }

  const link = `${BASE_URL}/invite?ref=${referralCode}`;

  const messages: Record<string, string> = {
    whatsapp:  `Hey! 👋 I just joined *LumVibe* — a new app where you actually get *PAID* for posting, getting likes and comments! 🤑\n\nUse my referral code *${referralCode}* to get 50 bonus points when you sign up!\n\nDownload here 👉 ${link}`,
    twitter:   `I'm earning money just by posting on @LumVibeApp 🤑\n\nNo more posting for free! Join me and start earning today 👉 ${link}\n\nUse my code: ${referralCode} for 50 bonus points! 🎁 #LumVibe #EarnOnline`,
    instagram: `Finally an app that PAYS creators! 🇳🇬💰\n\nI joined LumVibe — you earn coins from every post, like and comment. Real money! 🤑\n\nJoin me 👉 ${link}\nReferral code: ${referralCode} (get 50 bonus points!)\n\n#LumVibe #ContentCreator #EarnOnline`,
    tiktok:    `I found an app that pays you for posting — it's called LumVibe 🤑🇳🇬\n\nUse my code ${referralCode} to get 50 FREE points when you join!\n\nDownload 👉 ${link}\n\n#LumVibe #EarnOnline #ContentCreator #FYP`,
    general:   `Join me on LumVibe! 🚀\n\nUse my referral code: ${referralCode}\n\n✅ Get 50 bonus points\n✅ I get 100 bonus points\n✅ Earn from every post, like & comment!\n\nDownload: ${link}`,
  };

  const msg = messages[platform || 'general'];

  try {
    await Share.share({ message: msg, url: link });
  } catch (e: any) {
    console.error('shareReferralLink error:', e);
  }
};

/**
* Share a post link.
* Link format:
*   - Videos: https://lumvibe.site/video/POST_ID
*   - Others: https://lumvibe.site/post/POST_ID
*
* When clicked:
*  - If app is installed  → opens app directly on that post
*  - If not installed     → goes to Play Store, after install opens that exact post
*
* @param postId    The post UUID
* @param postType  'video' | 'image' | 'text' | 'voice'
* @param username  The poster's @username
* @param caption   Optional caption snippet for the share message
*/
export const sharePostLink = async (
  postId: string,
  postType: 'video' | 'image' | 'text' | 'voice',
  username: string,
  caption?: string
): Promise<void> => {
  const path = postType === 'video' ? 'video' : 'post';
  const link = `${BASE_URL}/${path}/${postId}`;

  const typeLabel: Record<string, string> = {
    video: 'video 🎥',
    image: 'photo 📸',
    text:  'post ✍️',
    voice: 'voice note 🎙️',
  };

  const captionSnippet = caption && caption.trim().length > 0
    ? `\n\n"${caption.trim().substring(0, 80)}${caption.trim().length > 80 ? '...' : ''}"`
    : '';

  const message = `Check out this ${typeLabel[postType] || 'post'} by @${username} on LumVibe!${captionSnippet}\n\n${link}`;

  try {
    await Share.share({ message, url: link });
  } catch (e: any) {
    console.error('sharePostLink error:', e);
  }
};

// ─── DEFERRED DEEP LINK HELPERS ───────────────────────────────────────────────
// These are called from your root _layout.tsx Linking listener.
// They save the referral code / post destination to AsyncStorage
// so they survive the Play Store install flow.

/**
* Save a pending referral code from a deep link URL.
* Call this when the app receives a lumvibe.site/invite?ref=XXX link.
*/
export const savePendingReferral = async (code: string): Promise<void> => {
  try {
    await AsyncStorage.setItem(PENDING_REFERRAL_KEY, code.toUpperCase());
    console.log(`📌 Saved pending referral: ${code}`);
  } catch (e) {
    console.error('savePendingReferral error:', e);
  }
};

/**
* Save a pending post destination from a deep link URL.
* Call this when the app receives a lumvibe.site/post/ID or /video/ID link.
*/
export const savePendingPost = async (
  postId: string,
  postType: 'post' | 'video'
): Promise<void> => {
  try {
    await AsyncStorage.setItem(PENDING_POST_KEY, JSON.stringify({ postId, postType }));
    console.log(`📌 Saved pending post: ${postType}/${postId}`);
  } catch (e) {
    console.error('savePendingPost error:', e);
  }
};

/**
* After the user signs up, call this to auto-apply any saved referral code.
* Clears the stored code after applying so it's only used once.
*
* Usage: call immediately after a successful signup with the new user's ID.
*/
export const checkAndApplyPendingReferral = async (
  newUserId: string
): Promise<{ applied: boolean; message: string }> => {
  try {
    const pendingCode = await AsyncStorage.getItem(PENDING_REFERRAL_KEY);
    if (!pendingCode) return { applied: false, message: 'No pending referral' };

    const result = await processReferral(newUserId, pendingCode);

    // Always clear after attempting — prevent double-apply
    await AsyncStorage.removeItem(PENDING_REFERRAL_KEY);

    return { applied: result.success, message: result.message };
  } catch (e: any) {
    console.error('checkAndApplyPendingReferral error:', e);
    return { applied: false, message: 'Error applying referral' };
  }
};

/**
* After the user opens the app post-install, call this to navigate them
* to the post they were trying to view before installing.
* Returns the saved destination or null if none exists.
* Clears the stored destination after reading.
*/
export const getAndClearPendingPost = async (): Promise<{
  postId: string;
  postType: 'post' | 'video';
} | null> => {
  try {
    const raw = await AsyncStorage.getItem(PENDING_POST_KEY);
    if (!raw) return null;

    await AsyncStorage.removeItem(PENDING_POST_KEY);
    const parsed = JSON.parse(raw);

    if (parsed?.postId && parsed?.postType) {
      console.log(`📌 Retrieved pending post: ${parsed.postType}/${parsed.postId}`);
      return parsed;
    }
    return null;
  } catch (e) {
    console.error('getAndClearPendingPost error:', e);
    return null;
  }
}; 
