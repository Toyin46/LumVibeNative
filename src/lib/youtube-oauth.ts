// app/lib/youtube-oauth.ts
import { supabase } from '@/config/supabase';

const YOUTUBE_CLIENT_ID = process.env.EXPO_PUBLIC_YOUTUBE_CLIENT_ID || '';
const YOUTUBE_CLIENT_SECRET = process.env.EXPO_PUBLIC_YOUTUBE_CLIENT_SECRET || '';
const YOUTUBE_REDIRECT_URI = process.env.EXPO_PUBLIC_YOUTUBE_REDIRECT_URI || 'kinsta://youtube-callback';

export async function initiateYouTubeOAuth(userId: string): Promise<string> {
  try {
    // Generate a random state for security
    const state = Math.random().toString(36).substring(7);
   
    // Store the state in the database
    await supabase.from('oauth_states').insert({
      user_id: userId,
      provider: 'youtube',
      state: state,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes
    });

    // Build YouTube OAuth URL
    const params = new URLSearchParams({
      client_id: YOUTUBE_CLIENT_ID,
      redirect_uri: YOUTUBE_REDIRECT_URI,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/userinfo.profile',
      access_type: 'offline',
      state: state,
      prompt: 'consent',
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    return authUrl;
  } catch (error) {
    console.error('YouTube OAuth initiation error:', error);
    throw new Error('Failed to initiate YouTube OAuth');
  }
}

export async function handleYouTubeCallback(
  code: string,
  state: string,
  userId: string
): Promise<void> {
  try {
    // Verify state
    const { data: stateData, error: stateError } = await supabase
      .from('oauth_states')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'youtube')
      .eq('state', state)
      .single();

    if (stateError || !stateData) {
      throw new Error('Invalid OAuth state');
    }

    // Exchange code for access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: YOUTUBE_CLIENT_ID,
        client_secret: YOUTUBE_CLIENT_SECRET,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: YOUTUBE_REDIRECT_URI,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.access_token) {
      // Get user info
      const userResponse = await fetch(
        'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
        {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
          },
        }
      );

      const userData = await userResponse.json();
      const channel = userData.items?.[0];

      // Store connected account
      await supabase.from('connected_accounts').upsert({
        user_id: userId,
        provider: 'youtube',
        provider_user_id: channel?.id,
        provider_username: channel?.snippet?.title,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
        connected_at: new Date().toISOString(),
      });

      // Clean up state
      await supabase.from('oauth_states').delete().eq('id', stateData.id);
    } else {
      throw new Error('Failed to get access token');
    }
  } catch (error) {
    console.error('YouTube callback error:', error);
    throw error;
  }
}

// NEW FUNCTIONS
export async function connectYouTube(userId: string): Promise<string> {
  return await initiateYouTubeOAuth(userId);
}

export async function disconnectYouTube(userId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('connected_accounts')
      .delete()
      .eq('user_id', userId)
      .eq('provider', 'youtube');

    if (error) {
      throw error;
    }
  } catch (error) {
    console.error('YouTube disconnect error:', error);
    throw new Error('Failed to disconnect YouTube account');
  }
}

export async function checkYouTubeConnection(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('connected_accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'youtube')
      .single();

    if (error || !data) {
      return false;
    }

    return true;
  } catch (error) {
    console.error('YouTube connection check error:', error);
    return false;
  }
}