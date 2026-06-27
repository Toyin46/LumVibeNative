// store/authStore.ts - COMPLETE FIXED VERSION WITH SIGNOUT
import { create } from 'zustand';
import { supabase } from '../config/supabase';
import { User } from '@supabase/supabase-js';

export interface UserProfile {
  id: string;
  email: string;
  username: string;
  display_name: string;
  bio: string;
  coins: number;
  photo_url?: string;
  points: number;
  level: number;
  badges_count: number;
  streak_days: number;
  followers: number;
  following: number;
  avatar_url?: string;
  wallet_balance?: number;
  total_earnings?: number;
  created_at?: string;
  is_private?: boolean;
  notif_likes?: boolean;
  notif_comments?: boolean;
  notif_followers?: boolean;
  notif_mentions?: boolean;
  notif_weekly?: boolean;
  notif_weekly_email?: boolean;
  posts_count?: number;
  business_email?: string;
  creator_tier?: string;
  is_premium?: boolean;
  referral_code: boolean;
}

interface AuthState {
  user: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  isLoading?: boolean;
  initialized: boolean;
  initAuth: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, username: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  signOut: () => Promise<void>; // ADDED THIS
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
  loadUserProfile: (userId: string) => Promise<void>;
  loadProfile: () => Promise<void>;
  setUserProfile: (profile: UserProfile) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  userProfile: null,
  loading: false,
  initialized: false,

  initAuth: async () => {
    try {
      console.log('🔄 Initializing auth...');
     
      const { data: { session }, error } = await supabase.auth.getSession();
     
      if (error) {
        console.error('Session error:', error);
      }
     
      if (session?.user) {
        console.log('✅ Session found:', session.user.email);
        set({ user: session.user });
        await get().loadUserProfile(session.user.id);
      } else {
        console.log('ℹ️ No active session');
      }

      set({ initialized: true });

      supabase.auth.onAuthStateChange(async (event, session) => {
        console.log('🔔 Auth event:', event);
       
        if (session?.user) {
          set({ user: session.user });
          await get().loadUserProfile(session.user.id);
        } else {
          set({ user: null, userProfile: null });
        }
      });
    } catch (error) {
      console.error('Init auth error:', error);
      set({ initialized: true });
    }
  },

  login: async (email: string, password: string) => {
    try {
      set({ loading: true });
     
      console.log('🔐 Logging in:', email);

      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) throw error;

      if (data.user) {
        console.log('✅ Auth successful');
        set({ user: data.user });
       
        let retries = 3;
        let profileLoaded = false;
       
        while (retries > 0 && !profileLoaded) {
          try {
            await get().loadUserProfile(data.user.id);
            const { userProfile } = get();
           
            if (userProfile) {
              console.log('✅ Profile loaded:', userProfile.username);
              profileLoaded = true;
              break;
            }
          } catch (error) {
            console.error(`Profile load attempt ${4 - retries} failed:`, error);
            retries--;
            if (retries > 0) {
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
        }

        if (!profileLoaded) {
          throw new Error('Profile not found. Please contact support.');
        }
      }
    } catch (error: any) {
      console.error('Login error:', error);
      throw new Error(error.message || 'Login failed');
    } finally {
      set({ loading: false });
    }
  },

  signup: async (email: string, password: string, username: string, displayName: string) => {
    try {
      set({ loading: true });

      console.log('📝 Starting signup...');

      // Check username
      const { data: existingUsername } = await supabase
        .from('users')
        .select('username')
        .eq('username', username.toLowerCase())
        .maybeSingle();

      if (existingUsername) {
        throw new Error('Username already taken');
      }

      console.log('✅ Username available');

      // Sign up
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: {
            username: username.toLowerCase(),
            display_name: displayName,
          },
        },
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error('Signup failed');

      console.log('✅ Auth user created');

      // Wait for auth
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check if profile already exists (prevent duplicates)
      const { data: existingProfile } = await supabase
        .from('users')
        .select('id')
        .eq('id', authData.user.id)
        .maybeSingle();

      if (existingProfile) {
        console.log('✅ Profile already exists');
        set({ user: authData.user, userProfile: existingProfile as UserProfile });
        return;
      }

      // Create profile with gamification fields
      const profileData = {
        id: authData.user.id,
        email: email.trim().toLowerCase(),
        username: username.toLowerCase(),
        display_name: displayName,
        bio: '',
        avatar_url: null,
        coins: 100,
        points: 0,
        level: 1,
        badges_count: 0,
        streak_days: 0,
        followers: 0,
        following: [],
      };

      const { error: profileError, data: profileResult } = await supabase
        .from('users')
        .insert(profileData)
        .select()
        .single();

      if (profileError) {
        console.error('Profile creation failed:', profileError);
        throw new Error(`Failed to create profile: ${profileError.message}`);
      }

      console.log('✅ Profile created');

      set({ user: authData.user, userProfile: profileResult });
    } catch (error: any) {
      console.error('Signup error:', error);
      throw new Error(error.message || 'Signup failed');
    } finally {
      set({ loading: false });
    }
  },

  logout: async () => {
    try {
      set({ loading: true });
      await supabase.auth.signOut();
      set({ user: null, userProfile: null });
    } catch (error: any) {
      throw new Error(error.message || 'Logout failed');
    } finally {
      set({ loading: false });
    }
  },

  // ADDED SIGNOUT FUNCTION (same as logout)
  signOut: async () => {
    try {
      set({ loading: true });
      console.log('🚪 Signing out...');
      await supabase.auth.signOut();
      set({ user: null, userProfile: null });
      console.log('✅ Signed out successfully');
    } catch (error: any) {
      console.error('Sign out error:', error);
      throw new Error(error.message || 'Sign out failed');
    } finally {
      set({ loading: false });
    }
  },

  loadUserProfile: async (userId: string) => {
    try {
      console.log('📥 Loading profile for user:', userId);
     
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('Profile load error:', error);
        throw error;
      }
     
      if (!data) {
        console.log('⚠️ No profile found');
        throw new Error('Profile not found');
      }

      console.log('✅ Profile loaded:', data.username);
      set({ userProfile: data });
    } catch (error) {
      console.error('Load profile error:', error);
      throw error;
    }
  },

  loadProfile: async () => {
    const { user } = get();
   
    if (!user?.id) {
      console.log('⚠️ No user logged in, cannot load profile');
      return;
    }

    try {
      console.log('📥 Loading current user profile:', user.id);
     
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) {
        console.error('Profile load error:', error);
        throw error;
      }
     
      if (!data) {
        console.log('⚠️ No profile found');
        throw new Error('Profile not found');
      }

      console.log('✅ Profile loaded:', data.username);
      console.log('💎 Current coins:', data.coins);
      console.log('⭐ Current points:', data.points || 0);
      console.log('🎯 Current level:', data.level || 1);
      set({ userProfile: data });
    } catch (error) {
      console.error('Load profile error:', error);
      throw error;
    }
  },

  updateProfile: async (updates: Partial<UserProfile>) => {
    try {
      const { user } = get();
      if (!user) throw new Error('Not authenticated');

      set({ loading: true });

      const { error } = await supabase
        .from('users')
        .update(updates)
        .eq('id', user.id);

      if (error) throw error;

      await get().loadUserProfile(user.id);
    } catch (error: any) {
      throw new Error(error.message || 'Update failed');
    } finally {
      set({ loading: false });
    }
  },

  setUserProfile: (profile: UserProfile) => {
    set({ userProfile: profile });
  },
}));