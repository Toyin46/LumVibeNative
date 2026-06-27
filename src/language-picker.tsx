// app/language-picker.tsx — FINAL VERSION
import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, StatusBar, SafeAreaView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LANGUAGES, SupportedLanguage } from './locales/translations'; 
import { useLanguage } from './locales/LanguageContext'; 

export default function LanguagePickerScreen() {
  const router = useRouter();
  const { language: currentLang, setLanguage } = useLanguage();
  const [saving,      setSaving]      = useState(false);
  const [pendingLang, setPendingLang] = useState<SupportedLanguage | null>(null);

  const handleSelect = async (code: SupportedLanguage) => {
    if (code === currentLang || saving) return;
    console.log('🌍 Picker: selected', code);
    setPendingLang(code);
    setSaving(true);
    try {
      await setLanguage(code);
      console.log('🌍 Picker: done, going back');
      router.back();
    } catch (e: any) {
      console.warn('🌍 Picker error:', e?.message);
      router.back();
    } finally {
      setSaving(false);
      setPendingLang(null);
    }
  };

  const renderItem = ({ item }: { item: typeof LANGUAGES[0] }) => {
    const isSelected = item.code === currentLang;
    const isLoading  = pendingLang === item.code && saving;
    return (
      <TouchableOpacity style={[s.row, isSelected && s.rowSelected]} onPress={() => handleSelect(item.code)} disabled={saving} activeOpacity={0.7}>
        <Text style={s.flag}>{item.flag}</Text>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[s.native, isSelected && s.nativeSelected]}>{item.name}</Text>
          <Text style={s.english}>{item.nameEn}</Text>
        </View>
        <View style={s.right}>
          {isLoading
            ? <ActivityIndicator size="small" color="#00ff88" />
            : isSelected
              ? <View style={s.check}><Feather name="check" size={14} color="#000" /></View>
              : <View style={s.circle} />}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={{ width: 40, height: 40, justifyContent: 'center' }}>
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={s.title}>Select Language</Text>
        <View style={{ width: 40 }} />
      </View>
      <Text style={s.sub}>Choose your preferred language. The app will update instantly. 🌍</Text>
      <FlatList
        data={LANGUAGES}
        keyExtractor={(item) => item.code}
        renderItem={renderItem}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: '#111' }} />}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  title:        { color: '#fff', fontSize: 18, fontWeight: '700' },
  sub:          { color: '#666', fontSize: 13, textAlign: 'center', paddingHorizontal: 24, paddingVertical: 14, lineHeight: 20 },
  row:          { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 12, borderRadius: 12, gap: 14 },
  rowSelected:  { backgroundColor: 'rgba(0,255,136,0.07)', borderWidth: 1, borderColor: 'rgba(0,255,136,0.25)', marginVertical: 2 },
  flag:         { fontSize: 32, width: 42, textAlign: 'center' },
  native:       { color: '#fff', fontSize: 16, fontWeight: '600' },
  nativeSelected: { color: '#00ff88' },
  english:      { color: '#666', fontSize: 13 },
  right:        { width: 28, alignItems: 'center', justifyContent: 'center' },
  check:        { width: 24, height: 24, borderRadius: 12, backgroundColor: '#00ff88', alignItems: 'center', justifyContent: 'center' },
  circle:       { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#333' },
}); 
