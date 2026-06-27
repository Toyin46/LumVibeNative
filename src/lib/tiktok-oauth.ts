// app/lib/tiktok-oauth.ts
import { supabase } from '@/config/supabase';

const TIKTOK_CLIENT_KEY = process.env.EXPO_PUBLIC_TIKTOK_CLIENT_KEY || '';
const TIKTOK_CLIENT_SECRET = process.env.EXPO_PUBLIC_TIKTOK_CLIENT_SECRET || '';
const TIKTOK_REDIRECT_URI = process.env.EXPO_PUBLIC_TIKTOK_REDIRECT_URI || 'kinsta://tiktok-callback';

export async function initiateTikTokOAuth(userId: string): Promise<string> {
  try {
    // Generate a random state for security
    const state = Math.random().toString(36).substring(7);
   
    // Store the state in the database
    await supabase.from('oauth_states').insert({
      user_id: userId,
      provider: 'tiktok',
      state: state,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    const params = new URLSearchParams({
      client_key: TIKTOK_CLIENT_KEY,
      scope: 'user.info.basic,video.list',
      response_type: 'code',
      redirect_uri: TIKTOK_REDIRECT_URI,
      state: state,
    });

    const authUrl = `https://www.tiktok.com/v2/auth/authorize?${params.toString()}`;
    return authUrl;
  } catch (error) {
    console.error('TikTok OAuth initiation error:', error);
    throw new Error('Failed to initiate TikTok OAuth');
  }
}

export async function handleTikTokCallback(
  code: string,
  state: string,
  userId: string
): Promise<void> {
  try {
    const { data: stateData, error: stateError } = await supabase
      .from('oauth_states')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'tiktok')
      .eq('state', state)
      .single();

    if (stateError || !stateData) {
      throw new Error('Invalid OAuth state');
    }

    const tokenResponse = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        client_secret: TIKTOK_CLIENT_SECRET,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: TIKTOK_REDIRECT_URI,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.access_token) {
      const userResponse = await fetch('https://open.tiktokapis.com/v2/user/info/', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      });

      const userData = await userResponse.json();

      await supabase.from('connected_accounts').upsert({
        user_id: userId,
        provider: 'tiktok',
        provider_user_id: userData.data?.user?.open_id,
        provider_username: userData.data?.user?.display_name,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
        connected_at: new Date().toISOString(),
      });

      await supabase.from('oauth_states').delete().eq('id', stateData.id);
    } else {
      throw new Error('Failed to get access token');
    }
  } catch (error) {
    console.error('TikTok callback error:', error);
    throw error;
  }
}

export async function connectTikTok(userId: string): Promise<string> {
  return await initiateTikTokOAuth(userId);
}

export async function disconnectTikTok(userId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('connected_accounts')
      .delete()
      .eq('user_id', userId)
      .eq('provider', 'tiktok');

    if (error) {
      throw error;
    }
  } catch (error) {
    console.error('TikTok disconnect error:', error);
    throw new Error('Failed to disconnect TikTok account');
  }
}

export async function checkTikTokConnection(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('connected_accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'tiktok')
      .single();

    if (error || !data) {
      return false;
    }

    return true;
  } catch (error) {
    console.error('TikTok connection check error:', error);
    return false;
  }
}