// app/utils/referralRewards.ts - Referral Reward System
import { supabase } from "../config/supabase"; 

export const REFERRAL_REWARDS = {
  REFERRER_POINTS: 100,
  NEW_USER_POINTS: 50,
};

export const WITHDRAWAL_SPLIT = {
  PLATFORM_FEE:        0.30,
  REFERRAL_COMMISSION: 0.05,
  USER_REFERRED:       0.65,
  USER_NOT_REFERRED:   0.70,
};

export async function getWithdrawingUserReferrer(userId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('users')
      .select('referred_by')
      .eq('id', userId)
      .single();
    return data?.referred_by || null;
  } catch {
    return null;
  }
}

export async function processWithdrawalReferralCommission(
  withdrawingUserId: string,
  grossAmountCoins: number,
  referrerId: string
): Promise<void> {
  try {
    const commissionCoins = Math.floor(grossAmountCoins * WITHDRAWAL_SPLIT.REFERRAL_COMMISSION);
    if (commissionCoins <= 0) return;

    const { data: withdrawingUser } = await supabase
      .from('users')
      .select('display_name, username')
      .eq('id', withdrawingUserId)
      .single();

    const withdrawerName =
      withdrawingUser?.display_name || withdrawingUser?.username || 'your referral';

    const { error: txError } = await supabase.from('transactions').insert({
      user_id: referrerId,
      type: 'referral_commission',
      amount: commissionCoins,
      description: `💰 Referral commission: 5% from ${withdrawerName}'s withdrawal (${grossAmountCoins} coins gross)`,
      status: 'completed',
    });

    if (txError) {
      console.error('❌ Failed to credit referral commission:', txError);
      return;
    }

    await supabase.from('notifications').insert({
      user_id: referrerId,
      type: 'referral_commission',
      title: 'Referral Commission Earned! 💰',
      message: `You earned ${commissionCoins} coins (5% commission) from ${withdrawerName}'s withdrawal!`,
      from_user_id: withdrawingUserId,
      is_read: false,
    });

    console.log(`✅ Referral commission: ${commissionCoins} coins → referrer ${referrerId}`);
  } catch (error) {
    console.error('❌ Error processing withdrawal referral commission:', error);
  }
}

export async function processReferralReward(
  newUserId: string,
  referralCode: string
): Promise<{ success: boolean; message: string }> {
  // FIX: this used to update the referrer's row directly from the new
  // user's own client session — e.g. `.update({ points: ... }).eq('id',
  // referrer.id)`. Confirmed via the users table's RLS policies: the only
  // UPDATE policy is `auth.uid() = id`, meaning a user can only ever
  // update their OWN row. That update was silently matching zero rows —
  // no error thrown, the referrer's points/successful_referrals just
  // never actually changed, no matter how many people used their code.
  // apply_referral (Supabase → SQL Editor) runs server-side with the
  // correct elevated privilege for this one specific, narrow operation —
  // it doesn't open up general cross-user write access anywhere else.
  try {
    const { data, error } = await supabase.rpc('apply_referral', {
      p_new_user_id: newUserId,
      p_referral_code: referralCode.toUpperCase(),
    });

    if (error) {
      console.error('❌ apply_referral RPC error:', error);
      return { success: false, message: error.message || 'Failed to process referral' };
    }

    return {
      success: !!data?.success,
      message: data?.message || (data?.success ? 'Referral applied!' : 'Failed to process referral'),
    };
  } catch (error) {
    console.error('❌ Error processing referral reward:', error);
    return { success: false, message: 'Failed to process referral' };
  }
}

// FIX: removed the old client-side checkAndUnlockFeatures() — it's now
// handled inside the apply_referral SQL function (see apply_referral.sql),
// since it has the exact same RLS problem this whole fix addresses: it
// was writing to another user's (the referrer's) user_unlocked_features
// rows from the new user's own session.

export async function generateReferralCode(username: string): Promise<string> {
  let baseCode = username
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4)
    .padEnd(4, 'X');

  let code = `${baseCode}${Math.random().toString(36).substring(2, 4).toUpperCase()}`;
  let attempts = 0;

  while (attempts < 10) {
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('referral_code', code)
      .maybeSingle();

    if (!existing) return code;
    code = `${baseCode}${Math.random().toString(36).substring(2, 4).toUpperCase()}`;
    attempts++;
  }

  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export async function getReferralStats(userId: string) {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('referral_code, successful_referrals')
      .eq('id', userId)
      .single();

    const { data: referrals } = await supabase
      .from('referrals')
      .select(`id, referred_id, created_at, users!referrals_referred_id_fkey(username, display_name)`)
      .eq('referrer_id', userId)
      .order('created_at', { ascending: false });

    return {
      referralCode: user?.referral_code || null,
      totalReferrals: user?.successful_referrals || 0,
      referrals: referrals || [],
    };
  } catch (error) {
    return { referralCode: null, totalReferrals: 0, referrals: [] };
  }
} 
