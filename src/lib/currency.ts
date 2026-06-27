// app/lib/currency.ts
// @ts-ignore - This is a helper file, not a route
export const _isHelper = true;
import { supabase } from "../config/supabase"; 

export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  rate?: number; // USD conversion rate
}

const CURRENCIES: CurrencyInfo[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$', rate: 1 },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', rate: 1500 },
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: '₵', rate: 12 },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', rate: 18 },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', rate: 130 },
  { code: 'EUR', name: 'Euro', symbol: '€', rate: 0.92 },
  { code: 'GBP', name: 'British Pound', symbol: '£', rate: 0.79 },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', rate: 1.35 },
];

/**
 * Get all available currencies
 */
export const getAllCurrencies = (): CurrencyInfo[] => {
  return CURRENCIES;
};

/**
 * Get user's preferred currency (defaults to USD)
 */
export const getUserCurrency = async (userId: string): Promise<CurrencyInfo> => {
  try {
    const { data } = await supabase
      .from('users')
      .select('preferred_currency')
      .eq('id', userId)
      .single();

    const currencyCode = data?.preferred_currency || 'USD';
    const currency = CURRENCIES.find(c => c.code === currencyCode);
    
    return currency || { code: 'USD', name: 'US Dollar', symbol: '$', rate: 1 };
  } catch (error) {
    console.error('Error loading currency:', error);
    return { code: 'USD', name: 'US Dollar', symbol: '$', rate: 1 };
  }
};

/**
 * Update user's preferred currency
 */
export const updateUserCurrency = async (userId: string, currencyCode: string): Promise<void> => {
  try {
    await supabase
      .from('users')
      .update({ preferred_currency: currencyCode })
      .eq('id', userId);
  } catch (error) {
    console.error('Error updating currency:', error);
    throw error;
  }
};

/**
 * Convert coins to local currency
 * Rate: 10 coins = $1 USD
 * ✅ FIXED: Now accepts CurrencyInfo object
 */
export const coinsToLocalCurrency = (coins: number, currency: CurrencyInfo): number => {
  const usd = coins / 10; // 10 coins = $1 USD
  const rate = currency.rate || 1;
  return usd * rate;
};

/**
 * Format currency amount with symbol
 */
export const formatCurrency = (amount: number, currency: CurrencyInfo): string => {
  return `${currency.symbol}${amount.toLocaleString('en-US', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  })}`;
};