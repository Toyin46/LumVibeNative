// locales/LanguageContext.tsx
// FINAL VERSION — completely self-contained
// - Creates context here (ONE place only)
// - Provider exported for _layout.tsx to wrap the app
// - Hooks exported for any screen to use
// - No circular dependencies

import React, {
  createContext, useContext, useState, useEffect, useCallback,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import translations, { SupportedLanguage, TranslationKeys } from './translations';

const LANG_KEY = '@kinsta_lang_v2'; // new key — clears any corrupted old value

// ─── Context shape ────────────────────────────────────────────────────────────
interface LangCtx {
  language:    SupportedLanguage;
  t:           TranslationKeys;
  setLanguage: (code: SupportedLanguage) => Promise<void>;
}

// ─── Single context object ────────────────────────────────────────────────────
const LanguageContext = createContext<LangCtx>({
  language:    'en',
  t:           translations.en,
  setLanguage: async () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLang] = useState<SupportedLanguage>('en');
  const [t,        setT]    = useState<TranslationKeys>(translations.en);

  // Load saved language once on mount
  useEffect(() => {
    console.log('🌍 LanguageProvider mounted');
    AsyncStorage.getItem(LANG_KEY).then((saved) => {
      console.log('🌍 Stored language:', saved);
      if (saved && translations[saved as SupportedLanguage]) {
        setLang(saved as SupportedLanguage);
        setT(translations[saved as SupportedLanguage]);
        console.log('🌍 Restored language:', saved);
      }
    }).catch((e) => console.warn('🌍 Load error:', e?.message));
  }, []);

  const setLanguage = useCallback(async (code: SupportedLanguage) => {
    console.log('🌍 Changing language to:', code);
    // Update state first — UI changes immediately
    setLang(code);
    setT(translations[code] ?? translations.en);
    // Then persist
    try {
      await AsyncStorage.setItem(LANG_KEY, code);
      console.log('🌍 Language saved:', code);
    } catch (e: any) {
      console.warn('🌍 Save error:', e?.message);
    }
  }, []); // setLang and setT are stable — safe to omit from deps

  return (
    <LanguageContext.Provider value={{ language, t, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

// ─── useTranslation ───────────────────────────────────────────────────────────
// Returns { t, language } — re-renders caller when language changes
export function useTranslation() {
  return useContext(LanguageContext);
}

// ─── useLanguage ─────────────────────────────────────────────────────────────
// Returns { language, setLanguage } — for language picker
export function useLanguage() {
  const { language, setLanguage } = useContext(LanguageContext);
  return { language, setLanguage };
}

export default LanguageContext; 
