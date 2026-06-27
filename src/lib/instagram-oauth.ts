// app/lib/instagram-oauth.ts
import { supabase } from '@/config/supabase';

const INSTAGRAM_CLIENT_ID = process.env.EXPO_PUBLIC_INSTAGRAM_CLIENT_ID || '';
const INSTAGRAM_CLIENT_SECRET = process.env.EXPO_PUBLIC_INSTAGRAM_CLIENT_SECRET || '';
const INSTAGRAM_REDIRECT_URI = process.env.EXPO_PUBLIC_INSTAGRAM_REDIRECT_URI || 'kinsta://instagram-callback';

export async function initiateInstagramOAuth(userId: string): Promise<string> {
  try {
    // Generate a random state for security
    const state = Math.random().toString(36).substring(7);
   
    // Store the state in the database
    await supabase.from('oauth_states').insert({
      user_id: userId,
      provider: 'instagram',
      state: state,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes
    });

    // Build Instagram OAuth URL
    const params = new URLSearchParams({
      client_id: INSTAGRAM_CLIENT_ID,
      redirect_uri: INSTAGRAM_REDIRECT_URI,
      scope: 'user_profile,user_media',
      response_type: 'code',
      state: state,
    });

    const authUrl = `https://api.instagram.com/oauth/authorize?${params.toString()}`;
    return authUrl;
  } catch (error) {
    console.error('Instagram OAuth initiation error:', error);
    throw new Error('Failed to initiate Instagram OAuth');
  }
}

export async function handleInstagramCallback(
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
      .eq('provider', 'instagram')
      .eq('state', state)
      .single();

    if (stateError || !stateData) {
      throw new Error('Invalid OAuth state');
    }

    // Exchange code for access token
    const tokenResponse = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: INSTAGRAM_CLIENT_ID,
        client_secret: INSTAGRAM_CLIENT_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: INSTAGRAM_REDIRECT_URI,
        code: code,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.access_token) {
      // Get user info
      const userResponse = await fetch(
        `https://graph.instagram.com/me?fields=id,username&access_token=${tokenData.access_token}`
      );

      const userData = await userResponse.json();

      // Store connected account
      await supabase.from('connected_accounts').upsert({
        user_id: userId,
        provider: 'instagram',
        provider_user_id: userData.id,
        provider_username: userData.username,
        access_token: tokenData.access_token,
        connected_at: new Date().toISOString(),
      });

      // Clean up state
      await supabase.from('oauth_states').delete().eq('id', stateData.id);
    } else {
      throw new Error('Failed to get access token');
    }
  } catch (error) {
    console.error('Instagram callback error:', error);
    throw error;
  }
}

// NEW FUNCTIONS
export async function connectInstagram(userId: string): Promise<string> {
  return await initiateInstagramOAuth(userId);
}

export async function disconnectInstagram(userId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('connected_accounts')
      .delete()
      .eq('user_id', userId)
      .eq('provider', 'instagram');

    if (error) {
      throw error;
    }
  } catch (error) {
    console.error('Instagram disconnect error:', error);
    throw new Error('Failed to disconnect Instagram account');
  }
}

export async function checkInstagramConnection(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('connected_accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'instagram')
      .single();

    if (error || !data) {
      return false;
    }

    return true;
  } catch (error) {
    console.error('Instagram connection check error:', error);
    return false;
  }
}