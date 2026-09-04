// src/config/supabase.ts
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl      = process.env.EXPO_PUBLIC_SUPABASE_URL      ?? 'https://exwhnzhnxvwatnvbilcq.supabase.co';
const supabaseAnonKey  = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4d2huemhueHZ3YXRudmJpbGNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM0ODkzNzUsImV4cCI6MjA3OTA2NTM3NX0.PQQqltyfegA_wunC7MmjsahJj1T87ARFa5JNIwuxl6o';

// ✅ FIX (real root cause of "asks me to log in every single time I open
// the app"): createClient() was called with zero auth options. React
// Native has no localStorage (that's browser-only) — Supabase's client
// needs to be told explicitly where to persist a session, or by default
// it persists NOWHERE. Every app launch was starting from a completely
// empty session, even though a perfectly valid one existed from last
// time — nothing was ever saved to restore. authStore.ts's initAuth()
// (getSession() + onAuthStateChange) was already correct; it just had
// nothing to actually restore.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    // React Native has no browser URL bar to auto-detect a session from —
    // this must be false here (it's a web-only feature). The email
    // verification / magic-link flow is instead handled manually via a
    // deep link listener in App.tsx, which explicitly exchanges the
    // incoming URL for a session.
    detectSessionInUrl: false,
  },
});

export interface User {
  id:           string;
  username:     string;
  display_name: string;
  email:        string;
  photo_url?:   string;
  bio?:         string;
  coins:        number;
  followers:    number;
  streak_days:  number;
  created_at:   string;
}

export interface Post {
  id:             string;
  user_id:        string;
  username:       string;
  display_name:   string;
  user_photo_url?: string;
  caption?:       string;
  image_url?:     string;
  video_url?:     string;
  media_type?:    'image' | 'video';
  likes:          number;
  comments:       number;
  coins_received: number;
  created_at:     string;
}

export interface Comment {
  id:             string;
  post_id:        string;
  user_id:        string;
  username:       string;
  display_name:   string;
  user_photo_url?: string;
  text:           string;
  created_at:     string;
}

export interface Like {
  id:         string;
  post_id:    string;
  user_id:    string;
  coins_sent: number;
  created_at: string;
}

export interface Following {
  id:           string;
  follower_id:  string;
  following_id: string;
  created_at:   string;
}