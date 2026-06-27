// app/themes.tsx
// ✅ Translations added via useTranslation()

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from './store/authStore'; 
import { supabase } from './config/supabase'; 
import { useTranslation } from './locales/LanguageContext'; 

const THEMES = [
  { id: 'default', name: 'Default',       primary: '#00ff88', background: '#000',    card: '#111',    icon: '🌙' },
  { id: 'ocean',   name: 'Ocean Blue',    primary: '#00b4d8', background: '#001219', card: '#003049', icon: '🌊' },
  { id: 'sunset',  name: 'Sunset Orange', primary: '#ff6b35', background: '#1a0800', card: '#2d1810', icon: '🌅' },
  { id: 'forest',  name: 'Forest Green',  primary: '#2d6a4f', background: '#0a1f0f', card: '#1b4332', icon: '🌲' },
  { id: 'purple',  name: 'Purple Night',  primary: '#9d4edd', background: '#10002b', card: '#240046', icon: '🌌' },
  { id: 'rose',    name: 'Rose Pink',     primary: '#ff006e', background: '#1a0010', card: '#330022', icon: '🌹' },
];

export default function ThemesScreen() {
  const { user } = useAuthStore();
  const { t }    = useTranslation();
  const [currentTheme, setCurrentTheme] = useState('default');
  const [loading,      setLoading]      = useState(false);

  useEffect(() => { loadCurrentTheme(); }, []);

  const loadCurrentTheme = async () => {
    if (!user?.id) return;
    try {
      const { data } = await supabase.from('users').select('profile_theme').eq('id', user.id).single();
      if (data?.profile_theme) setCurrentTheme(data.profile_theme);
    } catch (error) { console.error('Error loading theme:', error); }
  };

  const applyTheme = async (themeId: string) => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { error } = await supabase.from('users').update({ profile_theme: themeId }).eq('id', user.id);
      if (error) throw error;
      setCurrentTheme(themeId);
      Alert.alert('Theme Applied! 🎨', t.settings.languageChanged.replace('Language', 'Theme'));
    } catch (error) {
      console.error('Error applying theme:', error);
      Alert.alert(t.errors.generic, t.errors.saveFailed);
    } finally { setLoading(false); }
  };

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{t.settings.selectTheme}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={s.content}>
        <Text style={s.description}>
          Customize your profile with beautiful themes! Your selected theme will be displayed on your profile page.
        </Text>

        {THEMES.map((theme) => {
          const isActive = currentTheme === theme.id;
          return (
            <TouchableOpacity
              key={theme.id}
              style={[s.themeCard, isActive && s.themeCardActive]}
              onPress={() => applyTheme(theme.id)}
              disabled={loading}
            >
              <View style={s.themeInfo}>
                <Text style={s.themeIcon}>{theme.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.themeName}>{theme.name}</Text>
                  <View style={s.colorPreview}>
                    <View style={[s.colorDot, { backgroundColor: theme.primary }]} />
                    <View style={[s.colorDot, { backgroundColor: theme.card }]} />
                    <View style={[s.colorDot, { backgroundColor: theme.background }]} />
                  </View>
                </View>
              </View>
              {isActive && (
                <View style={s.activeBadge}>
                  <Feather name="check" size={16} color="#000" />
                  <Text style={s.activeBadgeText}>{t.common.done}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#000' },
  header:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 15, backgroundColor: '#000', borderBottomWidth: 1, borderBottomColor: '#222' },
  headerTitle:    { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  content:        { flex: 1, padding: 20 },
  description:    { color: '#999', fontSize: 14, lineHeight: 20, marginBottom: 20, textAlign: 'center' },
  themeCard:      { backgroundColor: '#111', borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 2, borderColor: '#222' },
  themeCardActive:{ borderColor: '#00ff88', backgroundColor: '#0a1f10' },
  themeInfo:      { flexDirection: 'row', alignItems: 'center', gap: 12 },
  themeIcon:      { fontSize: 32 },
  themeName:      { color: '#fff', fontSize: 16, fontWeight: 'bold', marginBottom: 8 },
  colorPreview:   { flexDirection: 'row', gap: 6 },
  colorDot:       { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: '#333' },
  activeBadge:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#00ff88', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, marginTop: 12, alignSelf: 'flex-start' },
  activeBadgeText:{ color: '#000', fontSize: 12, fontWeight: 'bold' },
}); 
