// src/components/StatusAvatar.tsx
//
// A profile picture that knows about Status:
//   • green ring  = this person has a status you have not seen
//   • grey ring   = you have seen all of their status
//   • no ring     = no status
// Tap  → opens their status (if they have one), otherwise the BIG picture.
// Hold → always the BIG picture.
//
// Use it anywhere a profile picture is shown (profile screens, chat header, lists).
import React, { useCallback, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../store/authStore';
import { loadStatusInfo } from '../status/statusInfoCache';
import ProfilePhotoViewer from './ProfilePhotoViewer';

export function useUserStatusInfo(userId?: string | null) {
  const { user } = useAuthStore();
  const [info, setInfo] = useState({ count: 0, hasUnseen: false });
  useFocusEffect(useCallback(() => {
    let dead = false;
    if (!userId) { setInfo({ count: 0, hasUnseen: false }); return; }
    loadStatusInfo(userId).then(i => { if (!dead) setInfo(i); });
    return () => { dead = true; };
  }, [userId]));
  return info;
}

export default function StatusAvatar({ userId, avatarUrl, name, letter, size = 44, style, disableStatus, imageBorder, placeholder }: {
  userId?: string | null; avatarUrl?: string | null; name?: string; letter?: string;
  size?: number; style?: ViewStyle; disableStatus?: boolean; imageBorder?: string; placeholder?: React.ReactNode;
}) {
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();
  const info = useUserStatusInfo(disableStatus ? null : userId);
  const [bigOpen, setBigOpen] = useState(false);

  const hasStatus = info.count > 0;
  const isMe = userId && userId === user?.id;
  const ring = hasStatus ? (info.hasUnseen || isMe ? '#00ff88' : '#5a5a5a') : 'transparent';
  const first = String(letter || name || 'U').charAt(0).toUpperCase();
  const outer = size + 10;

  const onPress = () => {
    if (hasStatus && userId) navigation.navigate('StatusViewer', { userId, name, avatar: avatarUrl || '' });
    else setBigOpen(true);
  };

  return (
    <>
      <TouchableOpacity activeOpacity={0.85} onPress={onPress} onLongPress={() => setBigOpen(true)} style={style}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
        <View style={{ width: outer, height: outer, borderRadius: outer / 2, borderWidth: hasStatus ? 2.5 : 0, borderColor: ring, alignItems: 'center', justifyContent: 'center' }}>
          {avatarUrl
            ? <Image source={{ uri: avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#111', ...(imageBorder ? { borderWidth: 2, borderColor: imageBorder } : {}) }} />
            : (placeholder || (
                <View style={[styles.ph, { width: size, height: size, borderRadius: size / 2 }]}>
                  <Text style={{ color: '#00ff88', fontWeight: '800', fontSize: size * 0.42 }}>{first}</Text>
                </View>))}
        </View>
      </TouchableOpacity>
      <ProfilePhotoViewer visible={bigOpen} uri={avatarUrl} name={name} letter={letter} onClose={() => setBigOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  ph: { backgroundColor: '#0b1f14', borderWidth: 1.5, borderColor: '#00ff88', alignItems: 'center', justifyContent: 'center' },
});
