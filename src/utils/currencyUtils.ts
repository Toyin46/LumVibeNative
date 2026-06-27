// utils/currencyUtils.ts
// ✅ Shared currency detection + conversion for all buy-coins screens
// ✅ NGN is always the base (Paystack charges NGN)
// ✅ All other currencies are display-only conversions

export interface CurrencyInfo {
  code: string;
  symbol: string;
  // How many units of this currency = 1 NGN
  rateFromNgn: number;
  locale: string;
  decimals: number;
}

// Exchange rates: 1 NGN = X foreign currency
// Update these periodically or fetch from an exchange rate API in production
const CURRENCY_BY_TIMEZONE: Record<string, CurrencyInfo> = {
  // ── Africa ──────────────────────────────────────────────────────────────
  'Africa/Lagos':        { code: 'NGN', symbol: '₦',   rateFromNgn: 1,        locale: 'en-NG', decimals: 0 },
  'Africa/Abuja':        { code: 'NGN', symbol: '₦',   rateFromNgn: 1,        locale: 'en-NG', decimals: 0 },
  'Africa/Accra':        { code: 'GHS', symbol: 'GH₵', rateFromNgn: 0.0067,   locale: 'en-GH', decimals: 2 },
  'Africa/Nairobi':      { code: 'KES', symbol: 'KSh', rateFromNgn: 0.087,    locale: 'en-KE', decimals: 0 },
  'Africa/Johannesburg': { code: 'ZAR', symbol: 'R',   rateFromNgn: 0.012,    locale: 'en-ZA', decimals: 2 },
  'Africa/Cairo':        { code: 'EGP', symbol: 'E£',  rateFromNgn: 0.033,    locale: 'ar-EG', decimals: 2 },
  'Africa/Dar_es_Salaam':{ code: 'TZS', symbol: 'TSh', rateFromNgn: 1.67,     locale: 'sw-TZ', decimals: 0 },
  'Africa/Kampala':      { code: 'UGX', symbol: 'USh', rateFromNgn: 2.42,     locale: 'en-UG', decimals: 0 },
  'Africa/Kigali':       { code: 'RWF', symbol: 'RF',  rateFromNgn: 0.88,     locale: 'en-RW', decimals: 0 },
  'Africa/Douala':       { code: 'XAF', symbol: 'FCFA',rateFromNgn: 0.39,     locale: 'fr-CM', decimals: 0 },

  // ── Europe ───────────────────────────────────────────────────────────────
  'Europe/London':       { code: 'GBP', symbol: '£',   rateFromNgn: 0.000533, locale: 'en-GB', decimals: 2 },
  'Europe/Paris':        { code: 'EUR', symbol: '€',   rateFromNgn: 0.000617, locale: 'fr-FR', decimals: 2 },
  'Europe/Berlin':       { code: 'EUR', symbol: '€',   rateFromNgn: 0.000617, locale: 'de-DE', decimals: 2 },
  'Europe/Rome':         { code: 'EUR', symbol: '€',   rateFromNgn: 0.000617, locale: 'it-IT', decimals: 2 },
  'Europe/Madrid':       { code: 'EUR', symbol: '€',   rateFromNgn: 0.000617, locale: 'es-ES', decimals: 2 },
  'Europe/Amsterdam':    { code: 'EUR', symbol: '€',   rateFromNgn: 0.000617, locale: 'nl-NL', decimals: 2 },
  'Europe/Zurich':       { code: 'CHF', symbol: 'Fr',  rateFromNgn: 0.000595, locale: 'de-CH', decimals: 2 },
  'Europe/Stockholm':    { code: 'SEK', symbol: 'kr',  rateFromNgn: 0.0067,   locale: 'sv-SE', decimals: 2 },

  // ── Americas ─────────────────────────────────────────────────────────────
  'America/New_York':    { code: 'USD', symbol: '$',   rateFromNgn: 0.000667, locale: 'en-US', decimals: 2 },
  'America/Chicago':     { code: 'USD', symbol: '$',   rateFromNgn: 0.000667, locale: 'en-US', decimals: 2 },
  'America/Denver':      { code: 'USD', symbol: '$',   rateFromNgn: 0.000667, locale: 'en-US', decimals: 2 },
  'America/Los_Angeles': { code: 'USD', symbol: '$',   rateFromNgn: 0.000667, locale: 'en-US', decimals: 2 },
  'America/Toronto':     { code: 'CAD', symbol: 'CA$', rateFromNgn: 0.000917, locale: 'en-CA', decimals: 2 },
  'America/Vancouver':   { code: 'CAD', symbol: 'CA$', rateFromNgn: 0.000917, locale: 'en-CA', decimals: 2 },
  'America/Sao_Paulo':   { code: 'BRL', symbol: 'R$',  rateFromNgn: 0.0033,   locale: 'pt-BR', decimals: 2 },
  'America/Mexico_City': { code: 'MXN', symbol: 'MX$', rateFromNgn: 0.011,    locale: 'es-MX', decimals: 2 },

  // ── Asia ─────────────────────────────────────────────────────────────────
  'Asia/Dubai':          { code: 'AED', symbol: 'د.إ', rateFromNgn: 0.00245,  locale: 'ar-AE', decimals: 2 },
  'Asia/Kolkata':        { code: 'INR', symbol: '₹',   rateFromNgn: 0.0557,   locale: 'en-IN', decimals: 0 },
  'Asia/Tokyo':          { code: 'JPY', symbol: '¥',   rateFromNgn: 0.10,     locale: 'ja-JP', decimals: 0 },
  'Asia/Shanghai':       { code: 'CNY', symbol: '¥',   rateFromNgn: 0.00484,  locale: 'zh-CN', decimals: 2 },
  'Asia/Singapore':      { code: 'SGD', symbol: 'S$',  rateFromNgn: 0.000894, locale: 'en-SG', decimals: 2 },
  'Asia/Hong_Kong':      { code: 'HKD', symbol: 'HK$', rateFromNgn: 0.00520,  locale: 'zh-HK', decimals: 2 },
  'Asia/Seoul':          { code: 'KRW', symbol: '₩',   rateFromNgn: 0.884,    locale: 'ko-KR', decimals: 0 },
  'Asia/Riyadh':         { code: 'SAR', symbol: '﷼',   rateFromNgn: 0.0025,   locale: 'ar-SA', decimals: 2 },

  // ── Oceania ───────────────────────────────────────────────────────────────
  'Australia/Sydney':    { code: 'AUD', symbol: 'A$',  rateFromNgn: 0.001033, locale: 'en-AU', decimals: 2 },
  'Australia/Melbourne': { code: 'AUD', symbol: 'A$',  rateFromNgn: 0.001033, locale: 'en-AU', decimals: 2 },
  'Pacific/Auckland':    { code: 'NZD', symbol: 'NZ$', rateFromNgn: 0.001117, locale: 'en-NZ', decimals: 2 },
};

export const DEFAULT_CURRENCY: CurrencyInfo = {
  code: 'USD', symbol: '$', rateFromNgn: 0.000667, locale: 'en-US', decimals: 2,
};

export function detectCurrency(): CurrencyInfo {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (CURRENCY_BY_TIMEZONE[tz]) return CURRENCY_BY_TIMEZONE[tz];
    // Fallback: match by continent prefix
    const continent = tz.split('/')[0];
    const match = Object.entries(CURRENCY_BY_TIMEZONE).find(([key]) =>
      key.startsWith(continent)
    );
    if (match) return match[1];
  } catch {}
  return DEFAULT_CURRENCY;
}

/**
* Convert NGN amount to local currency and format it
* e.g. convertFromNgn(1500, gbpInfo) → "£0.80"
*/
export function convertFromNgn(amountNgn: number, currency: CurrencyInfo): string {
  const localAmount = amountNgn * currency.rateFromNgn;
  if (currency.decimals === 0) {
    return `${currency.symbol}${Math.round(localAmount).toLocaleString(currency.locale)}`;
  }
  return `${currency.symbol}${localAmount.toLocaleString(currency.locale, {
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
  })}`;
}

export function formatNgn(amount: number): string {
  return `₦${Math.round(amount).toLocaleString('en-NG')}`;
} 
