// utils/coinUtils.ts
// Utility functions for coin transfers and management

import { supabase } from '../config/supabase'; 
import { Alert } from 'react-native';

export interface TransferResult {
  success: boolean;
  error?: string;
  transaction_id?: string;
  message?: string;
}

/**
* Transfer coins from one user to another
*/
export const transferCoins = async (
  fromUserId: string,
  toUserId: string,
  amount: number,
  description: string,
  postId?: string
): Promise<TransferResult> => {
  try {
    console.log('💰 Initiating transfer:', {
      from: fromUserId,
      to: toUserId,
      amount,
      description
    });

    const { data, error } = await supabase.rpc('transfer_coins', {
      p_from_user_id: fromUserId,
      p_to_user_id: toUserId,
      p_amount: amount,
      p_description: description,
      p_post_id: postId || null
    });

    if (error) {
      console.error('❌ Transfer error:', error);
      return {
        success: false,
        error: error.message
      };
    }

    console.log('✅ Transfer result:', data);
    return data as TransferResult;

  } catch (error: any) {
    console.error('❌ Transfer exception:', error);
    return {
      success: false,
      error: error.message || 'Transfer failed'
    };
  }
};

/**
* Send tip to a post author
*/
export const sendTip = async (
  fromUserId: string,
  toUserId: string,
  amount: number,
  postId: string
): Promise<TransferResult> => {
  if (fromUserId === toUserId) {
    return {
      success: false,
      error: "You can't tip yourself"
    };
  }

  return transferCoins(
    fromUserId,
    toUserId,
    amount,
    `Tip for post`,
    postId
  );
};

/**
* Process referral when new user signs up
*/
export const processReferral = async (
  newUserId: string,
  referralCode: string
): Promise<TransferResult> => {
  try {
    console.log('🎁 Processing referral:', { newUserId, referralCode });

    const { data, error } = await supabase.rpc('process_referral', {
      p_new_user_id: newUserId,
      p_referral_code: referralCode
    });

    if (error) {
      console.error('❌ Referral error:', error);
      return {
        success: false,
        error: error.message
      };
    }

    console.log('✅ Referral processed:', data);
    return data as TransferResult;

  } catch (error: any) {
    console.error('❌ Referral exception:', error);
    return {
      success: false,
      error: error.message || 'Referral processing failed'
    };
  }
};

/**
* Add coins to user (for purchases)
*/
export const addCoinsToUser = async (
  userId: string,
  amount: number,
  description: string = 'Coin purchase'
): Promise<TransferResult> => {
  try {
    console.log('💎 Adding coins:', { userId, amount });

    const { data, error } = await supabase.rpc('add_coins_to_user', {
      p_user_id: userId,
      p_amount: amount,
      p_description: description,
      p_type: 'purchased'
    });

    if (error) {
      console.error('❌ Add coins error:', error);
      return {
        success: false,
        error: error.message
      };
    }

    console.log('✅ Coins added:', data);
    return data as TransferResult;

  } catch (error: any) {
    console.error('❌ Add coins exception:', error);
    return {
      success: false,
      error: error.message || 'Failed to add coins'
    };
  }
};

/**
* Get user's coin balance
*/
export const getUserCoins = async (userId: string): Promise<number> => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('coins')
      .eq('id', userId)
      .single();

    if (error) throw error;

    return data?.coins || 0;

  } catch (error) {
    console.error('Error fetching user coins:', error);
    return 0;
  }
};

/**
* Get user's transaction history
*/
export const getUserTransactions = async (
  userId: string,
  limit: number = 50
) => {
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return data || [];

  } catch (error) {
    console.error('Error fetching transactions:', error);
    return [];
  }
};

/**
* Get referral statistics
*/
export const getReferralStats = async (userId: string) => {
  try {
    // Get referral code
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('referral_code')
      .eq('id', userId)
      .single();

    if (userError) throw userError;

    // Get count of referred users
    const { count, error: countError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('referred_by', userId);

    if (countError) throw countError;

    // Get total earnings from referrals
    const { data: transactions, error: txError } = await supabase
      .from('transactions')
      .select('amount')
      .eq('user_id', userId)
      .eq('type', 'referral');

    if (txError) throw txError;

    const totalEarned = transactions?.reduce(
      (sum, tx) => sum + parseFloat(tx.amount.toString()),
      0
    ) || 0;

    return {
      referralCode: userData?.referral_code || '',
      referralCount: count || 0,
      totalEarned
    };

  } catch (error) {
    console.error('Error fetching referral stats:', error);
    return {
      referralCode: '',
      referralCount: 0,
      totalEarned: 0
    };
  }
};

/**
* Validate if user has sufficient balance
*/
export const validateBalance = async (
  userId: string,
  amount: number
): Promise<{ valid: boolean; currentBalance: number; error?: string }> => {
  try {
    const currentBalance = await getUserCoins(userId);

    if (currentBalance < amount) {
      return {
        valid: false,
        currentBalance,
        error: `Insufficient balance. You have ${currentBalance} coins but need ${amount} coins.`
      };
    }

    return {
      valid: true,
      currentBalance
    };

  } catch (error) {
    return {
      valid: false,
      currentBalance: 0,
      error: 'Failed to check balance'
    };
  }
};

/**
* Show transfer result alert
*/
export const showTransferAlert = (result: TransferResult) => {
  if (result.success) {
    Alert.alert(
      'Success! 🎉',
      result.message || 'Transfer completed successfully',
      [{ text: 'OK' }]
    );
  } else {
    Alert.alert(
      'Transfer Failed',
      result.error || 'Something went wrong',
      [{ text: 'OK' }]
    );
  }
};

/**
* Format coin amount for display
*/
export const formatCoins = (amount: number): string => {
  return amount.toFixed(3);
};

/**
* Convert coins to USD
*/
export const coinsToUSD = (coins: number): string => {
  return (coins * 0.10).toFixed(2);
}; 
	
