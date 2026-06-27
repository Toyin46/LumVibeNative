// utils/flutterwaveUtils.ts
// ✅ Set FLW_TEST_MODE = false for live payments
// ✅ Public key matches your LIVE Flutterwave dashboard

import { supabase } from "../config/supabase"; 

// ─── CHANGE THIS TO false WHEN YOU WANT REAL PAYMENTS ───────────────────────
export const FLW_TEST_MODE  = false;

// ─── THIS MUST BE YOUR LIVE PUBLIC KEY (starts with FLWPUBK- not FLWPUBK_TEST)
export const FLW_PUBLIC_KEY = 'FLWPUBK-20215d0d202344b523585e924b627d86-X';
// ^^^^^ This is already your LIVE public key — keep it as is

// ─── Call Edge Function helper ────────────────────────────────────────────────
async function callFlwEdge(action: string, params: Record<string, any>) {
  const { data, error } = await supabase.functions.invoke('flutterwave-api', {
    body: { action, ...params },
  });
  if (error) throw new Error(error.message || 'Edge Function error');
  return data;
}

// ─── Supported countries ──────────────────────────────────────────────────────
export const SUPPORTED_COUNTRIES = [
  { code: 'NG', name: 'Nigeria',        currency: 'NGN', flag: '🇳🇬' },
  { code: 'GH', name: 'Ghana',          currency: 'GHS', flag: '🇬🇭' },
  { code: 'KE', name: 'Kenya',          currency: 'KES', flag: '🇰🇪' },
  { code: 'ZA', name: 'South Africa',   currency: 'ZAR', flag: '🇿🇦' },
  { code: 'TZ', name: 'Tanzania',       currency: 'TZS', flag: '🇹🇿' },
  { code: 'UG', name: 'Uganda',         currency: 'UGX', flag: '🇺🇬' },
  { code: 'RW', name: 'Rwanda',         currency: 'RWF', flag: '🇷🇼' },
  { code: 'US', name: 'United States',  currency: 'USD', flag: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', flag: '🇬🇧' },
  { code: 'EU', name: 'Europe (SEPA)',  currency: 'EUR', flag: '🇪🇺' },
];

export async function getFlutterwaveBanks(
  countryCode: string
): Promise<Array<{ name: string; code: string }>> {
  try {
    const result = await callFlwEdge('get_banks', { countryCode });
    return result.banks || [];
  } catch (e: any) {
    console.warn('getFlutterwaveBanks error:', e.message);
    return [];
  }
}

export async function verifyFlutterwaveAccount(
  accountNumber: string,
  bankCode: string
): Promise<{ success: boolean; accountName?: string; message?: string }> {
  try {
    return await callFlwEdge('verify_account', { accountNumber, bankCode });
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function sendFlutterwavePayout(
  userId: string,
  amountNGN: number,
  bankDetails: {
    accountNumber: string;
    bankCode:      string;
    accountName:   string;
    countryCode:   string;
    currency:      string;
    routingNumber?: string;
    iban?:          string;
  }
): Promise<{ success: boolean; reference?: string; message?: string }> {
  try {
    return await callFlwEdge('send_payout', { userId, amountNGN, bankDetails });
  } catch (e: any) {
    return { success: false, message: e.message || 'Unexpected error. Your coins have been refunded.' };
  }
}

export function getFlutterwavePaymentUrl(params: {
  amount:    number;
  email:     string;
  name:      string;
  reference: string;
  label:     string;
  currency?: string;
  redirectUrl?: string;
}): string {
  const { amount, email, name, reference, label, currency = 'NGN', redirectUrl } = params;
  return (
    `https://checkout.flutterwave.com/v3/hosted/pay` +
    `?public_key=${FLW_PUBLIC_KEY}` +
    `&tx_ref=${reference}` +
    `&amount=${amount}` +
    `&currency=${currency}` +
    `&payment_options=card,banktransfer,ussd` +
    `&customer[email]=${encodeURIComponent(email)}` +
    `&customer[name]=${encodeURIComponent(name)}` +
    `&customizations[title]=${encodeURIComponent('Kinsta')}` +
    `&customizations[description]=${encodeURIComponent(label)}` +
    `&customizations[logo]=https://kinstaapp.com/logo.png`
    + (redirectUrl ? `&redirect_url=${encodeURIComponent(redirectUrl)}` : '')
  );
}

export async function verifyFlutterwavePaymentByRef(
  txRef: string
): Promise<{ success: boolean; amount?: number; currency?: string; message?: string }> {
  try {
    return await callFlwEdge('verify_payment', { tx_ref: txRef });
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function verifyFlutterwavePayment(
  transactionId: string
): Promise<{ success: boolean; amount?: number; currency?: string }> {
  try {
    return await callFlwEdge('verify_payment', { tx_ref: transactionId });
  } catch {
    return { success: false };
  }
} 
