// src/components/GoogleSignInButton.tsx
import React, { useState } from 'react';
import { Alert, ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { signInWithGoogle } from '../lib/googleAuth';

export default function GoogleSignInButton({ label = 'Continue with Google', disabled, onBefore }: { label?: string; disabled?: boolean; onBefore?: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);

  const onPress = async () => {
    if (busy || disabled) return;
    setBusy(true);
    try { await onBefore?.(); } catch {}
    const r = await signInWithGoogle();
    setBusy(false);
    if (!r.ok && !r.cancelled) Alert.alert('Google sign-in', r.error || 'Please try again.');
    // on success the app's navigator switches to the main screens by itself
  };

  return (
    <View>
      <TouchableOpacity style={[styles.btn, (busy || disabled) && { opacity: 0.6 }]} onPress={onPress} activeOpacity={0.85} disabled={busy || disabled}>
        {busy ? <ActivityIndicator color="#000" /> : <Ionicons name="logo-google" size={20} color="#000" />}
        <Text style={styles.text}>{busy ? 'Opening Google…' : label}</Text>
      </TouchableOpacity>
      <Text style={styles.terms}>By continuing you agree to our Terms of Service and Privacy Policy.</Text>
      <View style={styles.divider}>
        <View style={styles.line} /><Text style={styles.or}>or</Text><View style={styles.line} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 12, paddingVertical: 14 },
  text: { color: '#000', fontSize: 16, fontWeight: '700' },
  terms: { color: '#777', fontSize: 11.5, textAlign: 'center', marginTop: 8 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, marginBottom: 4 },
  line: { flex: 1, height: 1, backgroundColor: '#2a2a2a' },
  or: { color: '#777', fontSize: 13 },
});
