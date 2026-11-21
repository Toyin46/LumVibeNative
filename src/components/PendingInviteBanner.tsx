// src/components/PendingInviteBanner.tsx
//
// Shown on the Login / Sign-up screens when the person arrived through a chat
// invite link: "@name invited you to chat — sign up or log in to start".
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../config/supabase';
import { getPendingChatInvite } from '../lib/chatInviteLink';

export default function PendingInviteBanner() {
  const [who, setWho] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      const code = await getPendingChatInvite();
      if (!code) return;
      const { data } = await supabase.rpc('get_chat_invite_preview', { p_code: code });
      if (!dead && data?.valid) setWho(data.display_name || data.username || 'Someone');
    })();
    return () => { dead = true; };
  }, []);

  if (!who) return null;
  return (
    <View style={styles.box}>
      <Ionicons name="chatbubbles" size={20} color="#00ff88" />
      <Text style={styles.text}>
        <Text style={{ fontWeight: '800' }}>{who}</Text> invited you to chat. Sign up or log in and your chat opens automatically.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,255,136,0.08)', borderColor: '#00ff88', borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 14 },
  text: { flex: 1, color: '#fff', fontSize: 13.5, lineHeight: 19 },
});
