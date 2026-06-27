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
  try {
    const { data: referrer, error: referrerError } = await supabase
      .from('users')
      .select('id, username, display_name, points, level, successful_referrals')
      .eq('referral_code', referralCode.toUpperCase())
      .single();

    if (referrerError || !referrer) {
      return { success: false, message: 'Invalid referral code' };
    }

    if (referrer.id === newUserId) {
      return { success: false, message: 'Cannot refer yourself' };
    }

    const { data: existingReferral } = await supabase
      .from('referrals')
      .select('id')
      .eq('referrer_id', referrer.id)
      .eq('referred_id', newUserId)
      .maybeSingle();

    if (existingReferral) {
      return { success: false, message: 'Referral already processed' };
    }

    const { error: referralError } = await supabase.from('referrals').insert({
      referrer_id: referrer.id,
      referred_id: newUserId,
      referral_code: referralCode.toUpperCase(),
      reward_given: true,
      status: 'completed',
    });

    if (referralError) {
      return { success: false, message: 'Failed to create referral' };
    }

    const newReferrerPoints = (referrer.points || 0) + REFERRAL_REWARDS.REFERRER_POINTS;
    const newReferrerLevel = Math.floor(newReferrerPoints / 1000) + 1;

    await supabase
      .from('users')
      .update({
        points: newReferrerPoints,
        level: newReferrerLevel,
        successful_referrals: (referrer.successful_referrals || 0) + 1,
      })
      .eq('id', referrer.id);

    const { data: newUser } = await supabase
      .from('users')
      .select('points, level')
      .eq('id', newUserId)
      .single();

    const newUserPoints = (newUser?.points || 0) + REFERRAL_REWARDS.NEW_USER_POINTS;
    const newUserLevel = Math.floor(newUserPoints / 1000) + 1;

    await supabase
      .from('users')
      .update({ points: newUserPoints, level: newUserLevel, referred_by: referrer.id })
      .eq('id', newUserId);

    await supabase.from('notifications').insert({
      user_id: referrer.id,
      type: 'referral',
      title: 'Referral Reward! 🎁',
      message: `You earned ${REFERRAL_REWARDS.REFERRER_POINTS} points for referring a friend! You'll also earn 5% commission on every withdrawal they make.`,
      from_user_id: newUserId,
      is_read: false,
    });

    const { count: referralCount } = await supabase
      .from('referrals')
      .select('*', { count: 'exact', head: true })
      .eq('referrer_id', referrer.id);

    if (referralCount && referralCount > 0) {
      await checkAndUnlockFeatures(referrer.id, referralCount);
    }

    return {
      success: true,
      message: `🎉 Referral success! You earned ${REFERRAL_REWARDS.NEW_USER_POINTS} points!`,
    };
  } catch (error) {
    console.error('❌ Error processing referral reward:', error);
    return { success: false, message: 'Failed to process referral' };
  }
}

async function checkAndUnlockFeatures(userId: string, referralCount: number) {
  const FEATURE_THRESHOLDS = [
    { count: 3,  feature: 'custom_themes',      name: 'Custom Themes' },
    { count: 5,  feature: 'advanced_analytics', name: 'Advanced Analytics' },
    { count: 10, feature: 'priority_support',   name: 'Priority Support' },
    // ─── NEW: Glowing Avatar Border at 20 referrals ───────────────────────
    { count: 20, feature: 'glowing_avatar',     name: 'Glowing Avatar Border ✨' },
    // ─────────────────────────────────────────────────────────────────────
  ];

  for (const threshold of FEATURE_THRESHOLDS) {
    if (referralCount >= threshold.count) {
      const { data: existing } = await supabase
        .from('user_unlocked_features')
        .select('id')
        .eq('user_id', userId)
        .eq('feature_id', threshold.feature)
        .maybeSingle();

      if (!existing) {
        const { error } = await supabase
          .from('user_unlocked_features')
          .insert({ user_id: userId, feature_id: threshold.feature });

        if (!error) {
          await supabase.from('notifications').insert({
            user_id: userId,
            type: 'achievement',
            title: 'Feature Unlocked! 🎉',
            message: `You unlocked ${threshold.name} by referring ${threshold.count} friends!`,
            is_read: false,
          });
          console.log(`✅ Unlocked ${threshold.feature} for user ${userId}`);
        }
      }
    }
  }
}

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
