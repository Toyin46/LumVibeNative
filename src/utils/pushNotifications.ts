// utils/pushNotifications.ts
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from '../config/supabase'; 
import Constants from 'expo-constants';

export interface PushNotificationData {
  type: 'like' | 'comment' | 'follow' | 'mention' | 'coin';
  fromUserId: string;
  fromUsername: string;
  postId?: string;
  commentText?: string;
  coinAmount?: number;
}

/**
* Register for push notifications and save token to database
*/
export async function registerForPushNotificationsAsync(userId: string): Promise<string | null> {
  let token: string | null = null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#00ff88',
    });
  }

  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Failed to get push token for push notification!');
      return null;
    }

    try {
      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    
      const expoPushToken = await Notifications.getExpoPushTokenAsync({
        projectId,
      });
     
      token = expoPushToken.data;

      console.log('Push token:', token);

      // Save token to database
      if (token && userId) {
        await savePushToken(userId, token);
      }
    } catch (error) {
      console.error('Error getting push token:', error);
    }
  } else {
    console.log('Must use physical device for Push Notifications');
  }

  return token;
}

/**
* Save push token to database
*/
async function savePushToken(userId: string, token: string): Promise<void> {
  try {
    const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';

    const { error } = await supabase
      .from('push_tokens')
      .upsert(
        {
          user_id: userId,
          token: token,
          platform: platform,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id,token',
        }
      );

    if (error) throw error;

    console.log('Push token saved successfully');
  } catch (error) {
    console.error('Error saving push token:', error);
  }
}

/**
* Remove push token from database (on logout)
*/
export async function removePushToken(userId: string, token: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('push_tokens')
      .delete()
      .eq('user_id', userId)
      .eq('token', token);

    if (error) throw error;

    console.log('Push token removed successfully');
  } catch (error) {
    console.error('Error removing push token:', error);
  }
}

/**
* Send push notification via Expo Push Notification Service
*/
export async function sendPushNotification(
  recipientUserId: string,
  title: string,
  body: string,
  data: PushNotificationData
): Promise<void> {
  try {
    // Get recipient's push tokens
    const { data: tokens, error: tokensError } = await supabase
      .from('push_tokens')
      .select('token')
      .eq('user_id', recipientUserId);

    if (tokensError) throw tokensError;

    if (!tokens || tokens.length === 0) {
      console.log('No push tokens found for user');
      return;
    }

    // ✅ FIX: .single() throws when zero rows come back, not just when
    // there's more than one — and a brand-new user who's never opened
    // notification settings has NO row here at all. That throw was being
    // silently swallowed by the outer catch, so push notifications quietly
    // never sent for any such user, forever, with zero visible error.
    // .maybeSingle() returns null instead of throwing, and we default to
    // "notifications on" when no row exists yet — the sensible default,
    // since nobody should have to visit settings just to receive their
    // first notification.
    const { data: prefs, error: prefsError } = await supabase
      .from('notification_preferences')
      .select('push_enabled, likes_enabled, comments_enabled, follows_enabled, coins_enabled')
      .eq('user_id', recipientUserId)
      .maybeSingle();

    if (prefsError) throw prefsError;

    const pushEnabled = prefs ? prefs.push_enabled : true;
    if (!pushEnabled) {
      console.log('Push notifications disabled for user');
      return;
    }

    // Check if this type of notification is enabled
    const typeEnabled = prefs
      ? (data.type === 'like' && prefs.likes_enabled) ||
        (data.type === 'comment' && prefs.comments_enabled) ||
        (data.type === 'follow' && prefs.follows_enabled) ||
        (data.type === 'coin' && prefs.coins_enabled) ||
        (data.type === 'mention' && prefs.comments_enabled)
      : true; // no row yet — default every type to enabled

    if (!typeEnabled) {
      console.log(`${data.type} notifications disabled for user`);
      return;
    }

    // Send notifications to all tokens
    const messages = tokens.map((tokenData) => ({
      to: tokenData.token,
      sound: 'default',
      title: title,
      body: body,
      data: data,
      badge: 1,
    }));

    // Send via Expo push notification service
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    const result = await response.json();
    console.log('Push notification sent:', result);
  } catch (error) {
    console.error('Error sending push notification:', error);
  }
}

/**
* Get badge count
*/
export async function getBadgeCount(): Promise<number> {
  return await Notifications.getBadgeCountAsync();
}

/**
* Set badge count
*/
export async function setBadgeCount(count: number): Promise<void> {
  await Notifications.setBadgeCountAsync(count);
}

/**
* Clear all notifications
*/
export async function clearAllNotifications(): Promise<void> {
  await Notifications.dismissAllNotificationsAsync();
  await setBadgeCount(0);
} 
	
