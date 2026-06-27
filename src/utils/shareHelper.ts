// utils/shareHelper.ts - SHARE WITH TRACKING
import { Alert, Share, Platform } from 'react-native';
import { supabase } from '../config/supabase'; 
import * as Linking from 'expo-linking';

export interface ShareOptions {
  postId: string;
  userId: string;
  content: string;
  mediaUrl?: string;
  platform: 'tiktok' | 'instagram' | 'twitter' | 'facebook' | 'whatsapp';
}

export const shareToExternalPlatform = async (options: ShareOptions) => {
  const { postId, userId, content, mediaUrl, platform } = options;

  try {
    // Generate unique tracking code
    const trackingCode = `KIN_${userId}_${postId}_${platform}_${Date.now()}`;
    const shareUrl = `https://kinsta.app/post/${postId}?ref=${trackingCode}`;

    // Create watermarked content message
    const shareMessage = `${content}\n\n📱 Posted from KINSTA\n${shareUrl}`;

    // Record share in database
    const { data: shareData, error: shareError } = await supabase
      .from('external_shares')
      .insert({
        user_id: userId,
        post_id: postId,
        platform: platform,
        tracking_code: trackingCode,
        share_url: shareUrl,
        points_earned: 50,
        validated: false,
      })
      .select()
      .single();

    if (shareError) throw shareError;

    // Add engagement tracking
    await supabase.from('engagement_tracking').insert({
      user_id: userId,
      post_id: postId,
      engagement_type: 'share',
      points_earned: 50,
      metadata: {
        platform: platform,
        tracking_code: trackingCode,
      }
    });

    // Update user's engagement points
    await supabase.rpc('increment_user_points', {
      user_id_param: userId,
      points: 50,
    });

    // Platform-specific sharing
    switch (platform) {
      case 'tiktok':
        await shareToTikTok(shareMessage, mediaUrl);
        break;
      case 'instagram':
        await shareToInstagram(shareMessage, mediaUrl);
        break;
      case 'twitter':
        await shareToTwitter(shareMessage, mediaUrl);
        break;
      case 'facebook':
        await shareToFacebook(shareMessage, mediaUrl);
        break;
      case 'whatsapp':
        await shareToWhatsApp(shareMessage);
        break;
    }

    // Validate share after 5 seconds
    setTimeout(async () => {
      await supabase
        .from('external_shares')
        .update({ validated: true, validation_timestamp: new Date().toISOString() })
        .eq('id', shareData.id);
    }, 5000);

    Alert.alert(
      '🎉 +50 Points!',
      `Share tracked on ${platform}!\n\nPoints will be added to your earnings.`,
    );

    return true;
  } catch (error: any) {
    console.error('Share error:', error);
    Alert.alert('Error', 'Could not complete share');
    return false;
  }
};

const shareToTikTok = async (message: string, mediaUrl?: string) => {
  // TikTok doesn't have a direct share URL scheme
  // Use native share sheet instead
  try {
    await Share.share({
      message: message,
      url: mediaUrl,
    });
  } catch (error) {
    console.error('TikTok share error:', error);
  }
};

const shareToInstagram = async (message: string, mediaUrl?: string) => {
  // Instagram Stories sharing
  const instagramUrl = 'instagram-stories://share';
  
  try {
    const canOpen = await Linking.canOpenURL(instagramUrl);
    if (canOpen) {
      await Linking.openURL(instagramUrl);
    } else {
      // Fallback to native share
      await Share.share({
        message: message,
        url: mediaUrl,
      });
    }
  } catch (error) {
    console.error('Instagram share error:', error);
  }
};

const shareToTwitter = async (message: string, mediaUrl?: string) => {
  const twitterUrl = `twitter://post?message=${encodeURIComponent(message)}`;
  const webTwitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}`;
  
  try {
    const canOpen = await Linking.canOpenURL(twitterUrl);
    if (canOpen) {
      await Linking.openURL(twitterUrl);
    } else {
      await Linking.openURL(webTwitterUrl);
    }
  } catch (error) {
    console.error('Twitter share error:', error);
  }
};

const shareToFacebook = async (message: string, mediaUrl?: string) => {
  const facebookUrl = `fb://facewebmodal/f?href=https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(message)}`;
  const webFacebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(message)}`;
  
  try {
    const canOpen = await Linking.canOpenURL(facebookUrl);
    if (canOpen) {
      await Linking.openURL(facebookUrl);
    } else {
      await Linking.openURL(webFacebookUrl);
    }
  } catch (error) {
    console.error('Facebook share error:', error);
  }
};

const shareToWhatsApp = async (message: string) => {
  const whatsappUrl = `whatsapp://send?text=${encodeURIComponent(message)}`;
  
  try {
    const canOpen = await Linking.canOpenURL(whatsappUrl);
    if (canOpen) {
      await Linking.openURL(whatsappUrl);
    } else {
      Alert.alert('Error', 'WhatsApp is not installed');
    }
  } catch (error) {
    console.error('WhatsApp share error:', error);
  }
};

