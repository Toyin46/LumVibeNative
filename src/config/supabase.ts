// src/config/supabase.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl      = process.env.EXPO_PUBLIC_SUPABASE_URL      ?? 'https://exwhnzhnxvwatnvbilcq.supabase.co';
const supabaseAnonKey  = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4d2huemhueHZ3YXRudmJpbGNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM0ODkzNzUsImV4cCI6MjA3OTA2NTM3NX0.PQQqltyfegA_wunC7MmjsahJj1T87ARFa5JNIwuxl6o';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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