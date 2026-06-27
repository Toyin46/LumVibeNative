// app/marketplace/seller-verification.tsx
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../../config/supabase'; 
import { useAuthStore } from '../../store/authStore'; 

const COUNTRIES = [
  'Nigeria','Ghana','Kenya','Uganda','Tanzania','South Africa','Rwanda',
  'United States','United Kingdom','Canada','Australia','India',
  'Germany','France','Netherlands','Brazil','Mexico','Philippines',
  'Indonesia','Pakistan','Bangladesh','Egypt','Ethiopia','Cameroon',
  'Senegal','Zambia','Zimbabwe','Mozambique','Singapore','UAE',
];

export default function SellerVerificationScreen() {
  const router = useRouter();
  const { user, userProfile, loadProfile } = useAuthStore();
  const [country,  setCountry]  = useState('');
  const [payEmail, setPayEmail] = useState('');
  const [saving,   setSaving]   = useState(false);
  const [step,     setStep]     = useState<'country' | 'payment' | 'done'>('country');

  const handleSaveCountry = () => {
    if (!country) { Alert.alert('Required', 'Please select your country'); return; }
    setStep('payment');
  };

  const handleSavePayment = async () => {
    if (!payEmail.trim()) { Alert.alert('Required', 'Please enter your Payoneer email'); return; }
    setSaving(true);
    try {
      await supabase.from('users').update({
        seller_status:   'verified',
        seller_country:  country,
        seller_payment_provider: 'payoneer',
      }).eq('id', user!.id);
      await loadProfile();
      setStep('done');
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSaving(false); }
  };

  if (step === 'done') {
    return (
      <View style={s.container}>
        <View style={s.center}>
          <Text style={{ fontSize: 72 }}>🎉</Text>
          <Text style={s.doneTitle}>You're a Seller!</Text>
          <Text style={s.doneSub}>Your account is now verified. Create your first listing and start earning.</Text>
          <TouchableOpacity style={s.doneBtn} onPress={() => router.replace('/marketplace/create-listing')}>
            <Text style={s.doneBtnText}>Create First Listing</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.backLink} onPress={() => router.replace('/(tabs)/marketplace')}>
            <Text style={s.backLinkText}>Go to Marketplace</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}><Feather name="arrow-left" size={24} color="#fff" /></TouchableOpacity>
        <Text style={s.headerTitle}>Become a Seller</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        {/* Progress */}
        <View style={s.progress}>
          <View style={[s.progressDot, { backgroundColor: '#00ff88' }]} />
          <View style={[s.progressLine, { backgroundColor: step === 'payment' ? '#00ff88' : '#333' }]} />
          <View style={[s.progressDot, { backgroundColor: step === 'payment' ? '#00ff88' : '#333' }]} />
        </View>
        <Text style={s.stepLabel}>{step === 'country' ? 'Step 1 of 2 — Your Location' : 'Step 2 of 2 — Payment Setup'}</Text>

        {step === 'country' && (
          <>
            <Text style={s.sectionTitle}>Select your country</Text>
            <Text style={s.sectionSub}>This determines which payment methods are available to you.</Text>
            <View style={s.countryGrid}>
              {COUNTRIES.map(c => (
                <TouchableOpacity
                  key={c}
                  style={[s.countryChip, country === c && s.countryChipActive]}
                  onPress={() => setCountry(c)}
                >
                  <Text style={[s.countryChipText, country === c && { color: '#00ff88' }]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={[s.nextBtn, !country && { opacity: 0.4 }]} onPress={handleSaveCountry} disabled={!country}>
              <Text style={s.nextBtnText}>Continue →</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'payment' && (
          <>
            <View style={s.infoBox}>
              <Text style={s.infoTitle}>💰 How you get paid</Text>
              <Text style={s.infoText}>When a buyer accepts your delivery, 90% of the coins are sent to your Kinsta wallet. You can withdraw to your local bank via Payoneer — available in 200+ countries worldwide.</Text>
            </View>
            <Text style={s.sectionTitle}>Your Payoneer email</Text>
            <Text style={s.sectionSub}>Don't have Payoneer? Sign up free at payoneer.com — takes 5 minutes.</Text>
            <View style={s.inputRow}>
              <Feather name="mail" size={18} color="#666" />
              <TouchableOpacity
                style={s.inputFake}
                onPress={() => {
                  // We use Alert.prompt on iOS or a TextInput approach
                  Alert.alert('Enter Payoneer Email', '', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Save', onPress: () => {},}
                  ]);
                }}
              >
                <Text style={payEmail ? s.inputValue : s.inputPlaceholder}>
                  {payEmail || 'Tap to enter your Payoneer email'}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={s.tierBox}>
              <Text style={s.tierTitle}>🏅 Seller Tiers</Text>
              <Text style={s.tierRow}>🆕 <Text style={{ color: '#fff' }}>New Seller</Text> — max 500 coins/order (fraud protection)</Text>
              <Text style={s.tierRow}>⭐ <Text style={{ color: '#fff' }}>Trusted</Text> — 3+ orders, no disputes</Text>
              <Text style={s.tierRow}>🏅 <Text style={{ color: '#fff' }}>Top Seller</Text> — 10+ orders, 4.5+ rating, featured in search</Text>
            </View>
            <TouchableOpacity style={[s.nextBtn, saving && { opacity: 0.6 }]} onPress={handleSavePayment} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#000" /> : <Text style={s.nextBtnText}>Complete Verification ✅</Text>}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#000' },
  center:           { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 16 },
  header:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  headerTitle:      { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  scroll:           { padding: 20, paddingBottom: 60 },
  progress:         { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  progressDot:      { width: 12, height: 12, borderRadius: 6 },
  progressLine:     { flex: 1, height: 2, marginHorizontal: 4 },
  stepLabel:        { color: '#666', fontSize: 12, marginBottom: 24 },
  sectionTitle:     { color: '#fff', fontSize: 16, fontWeight: 'bold', marginBottom: 6, marginTop: 16 },
  sectionSub:       { color: '#666', fontSize: 13, marginBottom: 14 },
  countryGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  countryChip:      { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#111', borderRadius: 20, borderWidth: 1, borderColor: '#222' },
  countryChipActive:{ backgroundColor: '#00ff8818', borderColor: '#00ff88' },
  countryChipText:  { color: '#888', fontSize: 12, fontWeight: '600' },
  nextBtn:          { backgroundColor: '#00ff88', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  nextBtnText:      { color: '#000', fontWeight: 'bold', fontSize: 16 },
  infoBox:          { backgroundColor: '#0a1a0a', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#00ff8833', marginBottom: 8 },
  infoTitle:        { color: '#00ff88', fontSize: 14, fontWeight: 'bold', marginBottom: 8 },
  infoText:         { color: '#888', fontSize: 13, lineHeight: 20 },
  inputRow:         { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#111', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#2a2a2a', marginBottom: 16 },
  inputFake:        { flex: 1 },
  inputValue:       { color: '#fff', fontSize: 14 },
  inputPlaceholder: { color: '#555', fontSize: 14 },
  tierBox:          { backgroundColor: '#111', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#1a1a1a', marginBottom: 20, gap: 8 },
  tierTitle:        { color: '#ffd700', fontSize: 14, fontWeight: 'bold', marginBottom: 4 },
  tierRow:          { color: '#666', fontSize: 13, lineHeight: 20 },
  doneTitle:        { color: '#fff', fontSize: 28, fontWeight: 'bold', textAlign: 'center' },
  doneSub:          { color: '#888', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  doneBtn:          { backgroundColor: '#00ff88', paddingHorizontal: 32, paddingVertical: 16, borderRadius: 12, marginTop: 8 },
  doneBtnText:      { color: '#000', fontWeight: 'bold', fontSize: 16 },
  backLink:         { paddingVertical: 12 },
  backLinkText:     { color: '#666', fontSize: 14 },
}); 
