// app/(auth)/signup.tsx - FIXED VERSION WITH WORKING REFERRALS + CONTACT INVITE + EMAIL VERIFICATION
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
  FlatList,
  Linking,
} from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../config/supabase'; 
import { generateReferralCode, processReferralReward } from '../utils/referralRewards';
import * as Contacts from 'expo-contacts';

// ─── Contact invite helpers ───────────────────────────────────────────────────
const AVATAR_COLORS = ['#00C96B','#00A8E8','#FF6B6B','#FFD166','#A78BFA','#F97316','#06B6D4','#EC4899'];

function buildInviteMessage(
  contactFirstName: string,
  senderName: string,
  referralCode: string,
  includeReferral: boolean,
): string {
  const base = `Hey ${contactFirstName}! It's me ${senderName} 👋\n\nI just joined Lumvibe and I'm loving it! It's a social app with short videos, marketplace to sell your talent, gifts for creators, weekly leaderboards, voice & image posts, and a lot more 🔥\n\nCome join me 👉 https://play.google.com/store/apps/details?id=com.lumvibe.app`;
  const ref  = `\n\nP.S. Use my referral code 🎁 *${referralCode}* when signing up to get 50 FREE bonus points! (totally optional 😊)`;
  return includeReferral && referralCode ? base + ref : base;
}

// ─────────────────────────────────────────────────────────────────────────────
// Post-signup Contact Invite Screen
// Shows AFTER signup is complete, before navigating to main app
// User sends SMS from their own phone — Lumvibe sends nothing
// Completely separate from the referral system
// ─────────────────────────────────────────────────────────────────────────────
function PostSignupContactInvite({
  visible,
  onSkip,
  onDone,
  referralCode,
  userName,
}: {
  visible: boolean;
  onSkip: () => void;
  onDone: () => void;
  referralCode: string;
  userName: string;
}) {
  const [step,            setStep]            = useState<'select' | 'preview' | 'sent'>('select');
  const [contacts,        setContacts]        = useState<any[]>([]);
  const [search,          setSearch]          = useState('');
  const [selected,        setSelected]        = useState<Set<string>>(new Set());
  const [includeReferral, setIncludeReferral] = useState(false);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [permDenied,      setPermDenied]      = useState(false);

  React.useEffect(() => {
    if (visible) loadContacts();
  }, [visible]);

  const loadContacts = async () => {
    setLoadingContacts(true);
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') { setPermDenied(true); setLoadingContacts(false); return; }
      setPermDenied(false);
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
      });
      const withPhone = (data || [])
        .filter(c => c.name && c.phoneNumbers && c.phoneNumbers.length > 0)
        .map(c => ({
          id:       c.id,
          name:     c.name,
          phone:    c.phoneNumbers![0].number || '',
          initials: c.name!.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase(),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setContacts(withPhone);
    } catch { setPermDenied(true); }
    finally { setLoadingContacts(false); }
  };

  const filtered = React.useMemo(() =>
    contacts.filter(c =>
      c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search)
    ), [contacts, search]);

  const toggle = (id: string) => {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const selectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(c => c.id)));
  };

  const selectedContacts = contacts.filter(c => selected.has(c.id));

  const handleSendSMS = async () => {
    for (const contact of selectedContacts) {
      const firstName = contact.name.split(' ')[0];
      const msg  = buildInviteMessage(firstName, userName, referralCode, includeReferral);
      const phone = contact.phone.replace(/\s+/g, '');
      const sep  = Platform.OS === 'ios' ? '&' : '?';
      const url  = `sms:${phone}${sep}body=${encodeURIComponent(msg)}`;
      if (await Linking.canOpenURL(url)) await Linking.openURL(url);
    }
    setStep('sent');
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={ps.container}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">

          {/* SELECT STEP */}
          {step === 'select' && (
            <View style={ps.inner}>
              {/* Skip button top right */}
              <TouchableOpacity style={ps.skipTop} onPress={onSkip}>
                <Text style={ps.skipTopText}>Skip</Text>
              </TouchableOpacity>

              <Text style={ps.emoji}>🙌</Text>
              <Text style={ps.bigTitle}>Bring Your People!</Text>
              <Text style={ps.bigSub}>
                Want to invite friends to Lumvibe? Pick contacts and we'll pre-write the message — you just hit send from your own phone.
              </Text>

              {/* Clarity: NOT a referral */}
              <View style={ps.infoBanner}>
                <Text style={{ fontSize: 15 }}>💬</Text>
                <View style={{ flex: 1 }}>
                  <Text style={ps.infoBannerTitle}>This is different from Referral</Text>
                  <Text style={ps.infoBannerText}>
                    This is a friendly personal invite — no rewards are earned just by inviting.
                    To earn 100 points + 5% commission, share your referral code from the Invite Friends section in your Profile.
                  </Text>
                </View>
              </View>

              {permDenied ? (
                <View style={ps.permBox}>
                  <Feather name="lock" size={30} color="#555" />
                  <Text style={ps.permTitle}>Contacts Access Needed</Text>
                  <Text style={ps.permText}>Allow Lumvibe to access your contacts to send personal invites.</Text>
                  <TouchableOpacity style={ps.permBtn} onPress={loadContacts}>
                    <Text style={ps.permBtnText}>Allow Access</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  {/* Search */}
                  <View style={ps.searchBox}>
                    <Feather name="search" size={15} color="#444" />
                    <TextInput
                      style={ps.searchInput}
                      value={search}
                      onChangeText={setSearch}
                      placeholder="Search contacts..."
                      placeholderTextColor="#444"
                    />
                  </View>

                  {/* Select all */}
                  <View style={ps.selectRow}>
                    <TouchableOpacity onPress={selectAll}>
                      <Text style={ps.selectAllText}>
                        {selected.size === filtered.length && filtered.length > 0 ? 'Deselect All' : 'Select All'}
                      </Text>
                    </TouchableOpacity>
                    <Text style={ps.countText}>
                      {selected.size > 0 ? `${selected.size} selected` : `${filtered.length} contacts`}
                    </Text>
                  </View>

                  {/* Contacts list */}
                  {loadingContacts
                    ? <ActivityIndicator color="#00ff88" style={{ marginVertical: 30 }} />
                    : <FlatList
                        data={filtered}
                        keyExtractor={item => item.id}
                        scrollEnabled={false}
                        keyboardShouldPersistTaps="handled"
                        renderItem={({ item, index }) => {
                          const isSelected = selected.has(item.id);
                          const color = AVATAR_COLORS[index % AVATAR_COLORS.length];
                          return (
                            <TouchableOpacity style={ps.contactRow} onPress={() => toggle(item.id)}>
                              <View style={[ps.avatar, { backgroundColor: color + '22', borderColor: isSelected ? '#00ff88' : '#222' }]}>
                                <Text style={[ps.avatarText, { color }]}>{item.initials}</Text>
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={[ps.contactName, isSelected && { color: '#00ff88' }]}>{item.name}</Text>
                                <Text style={ps.contactPhone}>{item.phone}</Text>
                              </View>
                              <View style={[ps.checkbox, isSelected && ps.checkboxOn]}>
                                {isSelected && <Text style={ps.checkmark}>✓</Text>}
                              </View>
                            </TouchableOpacity>
                          );
                        }}
                      />
                  }

                  {/* Referral toggle */}
                  <View style={ps.toggleRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={ps.toggleTitle}>🎁 Include referral code?</Text>
                      <Text style={ps.toggleSub}>Friend gets 50 bonus points on signup</Text>
                    </View>
                    <TouchableOpacity
                      style={[ps.toggleTrack, includeReferral && ps.toggleTrackOn]}
                      onPress={() => setIncludeReferral(!includeReferral)}
                    >
                      <View style={[ps.toggleThumb, includeReferral && ps.toggleThumbOn]} />
                    </TouchableOpacity>
                  </View>

                  {/* CTA */}
                  <TouchableOpacity
                    style={[ps.btn, selected.size === 0 && ps.btnDisabled]}
                    disabled={selected.size === 0}
                    onPress={() => setStep('preview')}
                  >
                    <Text style={ps.btnText}>
                      {selected.size === 0
                        ? 'Select contacts to invite'
                        : `Preview & Send to ${selected.size} Contact${selected.size > 1 ? 's' : ''}`}
                    </Text>
                  </TouchableOpacity>
                </>
              )}

              <TouchableOpacity onPress={onSkip} style={ps.skipBottom}>
                <Text style={ps.skipBottomText}>Skip for now</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* PREVIEW STEP */}
          {step === 'preview' && (
            <View style={ps.inner}>
              <TouchableOpacity onPress={() => setStep('select')} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 16 }}>
                <Feather name="chevron-left" size={18} color="#00ff88" />
                <Text style={{ color: '#00ff88', fontSize: 14, fontWeight: '600' }}>Back</Text>
              </TouchableOpacity>

              <Text style={ps.bigTitle}>Review Your Message</Text>
              <Text style={[ps.bigSub, { marginBottom: 12 }]}>Each contact gets their own name in the message.</Text>

              {/* Selected tags */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {selectedContacts.slice(0, 5).map(c => (
                  <View key={c.id} style={ps.tag}>
                    <Text style={ps.tagText}>{c.name.split(' ')[0]}</Text>
                  </View>
                ))}
                {selectedContacts.length > 5 && (
                  <View style={ps.tag}><Text style={ps.tagText}>+{selectedContacts.length - 5} more</Text></View>
                )}
              </View>

              {/* Message preview */}
              <View style={ps.previewBox}>
                <Text style={ps.previewText}>
                  {buildInviteMessage(
                    selectedContacts[0]?.name.split(' ')[0] || 'Friend',
                    userName,
                    referralCode,
                    includeReferral,
                  )}
                </Text>
              </View>

              <View style={ps.noteBox}>
                <Feather name="info" size={13} color="#555" />
                <Text style={ps.noteText}>
                  Tapping "Send Now" opens your SMS app for each contact. Your message — your phone number. Lumvibe sends nothing.
                </Text>
              </View>

              <TouchableOpacity style={ps.btn} onPress={handleSendSMS}>
                <Text style={ps.btnText}>Send Now via SMS 📲</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* SENT STEP */}
          {step === 'sent' && (
            <View style={[ps.inner, { alignItems: 'center', justifyContent: 'center', flex: 1 }]}>
              <Text style={{ fontSize: 64, marginBottom: 16 }}>🚀</Text>
              <Text style={[ps.bigTitle, { textAlign: 'center' }]}>Invites Sent!</Text>
              <Text style={[ps.bigSub, { textAlign: 'center', marginBottom: 16 }]}>
                You invited <Text style={{ color: '#00ff88', fontWeight: 'bold' }}>{selected.size}</Text>{' '}
                {selected.size === 1 ? 'person' : 'people'} to Lumvibe!
              </Text>
              <View style={[ps.noteBox, { marginBottom: 24 }]}>
                <Text style={[ps.noteText, { color: '#FFD166' }]}>
                  🎁 To earn referral rewards (100 points + 5% commission), go to Profile → Invite Friends and share your referral code.
                </Text>
              </View>
              <TouchableOpacity style={ps.btn} onPress={onDone}>
                <Text style={ps.btnText}>Go to Lumvibe 🎉</Text>
              </TouchableOpacity>
            </View>
          )}

        </ScrollView>
      </View>
    </Modal>
  );
}

const ps = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#000' },
  inner:           { padding: 24, paddingTop: 60, paddingBottom: 40 },
  skipTop:         { position: 'absolute', top: 56, right: 24, zIndex: 10 },
  skipTopText:     { color: '#555', fontSize: 14 },
  emoji:           { fontSize: 48, marginBottom: 12 },
  bigTitle:        { color: '#fff', fontSize: 24, fontWeight: 'bold', marginBottom: 6 },
  bigSub:          { color: '#666', fontSize: 14, lineHeight: 20, marginBottom: 16 },
  infoBanner:      { flexDirection: 'row', gap: 10, backgroundColor: '#0d1f16', borderWidth: 1, borderColor: '#1a3d28', borderRadius: 12, padding: 12, marginBottom: 16, alignItems: 'flex-start' },
  infoBannerTitle: { color: '#00ff88', fontSize: 13, fontWeight: '700', marginBottom: 2 },
  infoBannerText:  { color: '#666', fontSize: 12, lineHeight: 17 },
  permBox:         { alignItems: 'center', paddingVertical: 30, gap: 10 },
  permTitle:       { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  permText:        { color: '#666', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  permBtn:         { backgroundColor: '#00ff88', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12, marginTop: 10 },
  permBtnText:     { color: '#000', fontWeight: 'bold', fontSize: 14 },
  searchBox:       { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#111', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10, borderWidth: 1, borderColor: '#1e1e1e' },
  searchInput:     { flex: 1, color: '#fff', fontSize: 14 },
  selectRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  selectAllText:   { color: '#00ff88', fontSize: 13, fontWeight: '600' },
  countText:       { color: '#555', fontSize: 12 },
  contactRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#111' },
  avatar:          { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, justifyContent: 'center', alignItems: 'center' },
  avatarText:      { fontSize: 12, fontWeight: '700' },
  contactName:     { color: '#fff', fontSize: 13, fontWeight: '600' },
  contactPhone:    { color: '#555', fontSize: 11, marginTop: 1 },
  checkbox:        { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: '#333', justifyContent: 'center', alignItems: 'center' },
  checkboxOn:      { backgroundColor: '#00ff88', borderColor: '#00ff88' },
  checkmark:       { color: '#000', fontSize: 11, fontWeight: 'bold' },
  toggleRow:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', borderRadius: 10, padding: 12, marginVertical: 12, borderWidth: 1, borderColor: '#1e1e1e' },
  toggleTitle:     { color: '#FFD166', fontSize: 13, fontWeight: '600' },
  toggleSub:       { color: '#555', fontSize: 11, marginTop: 2 },
  toggleTrack:     { width: 40, height: 22, borderRadius: 11, backgroundColor: '#222', justifyContent: 'center', paddingHorizontal: 2 },
  toggleTrackOn:   { backgroundColor: '#00ff88' },
  toggleThumb:     { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', alignSelf: 'flex-start' },
  toggleThumbOn:   { alignSelf: 'flex-end' },
  btn:             { backgroundColor: '#00ff88', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  btnDisabled:     { backgroundColor: '#1a1a1a' },
  btnText:         { color: '#000', fontWeight: 'bold', fontSize: 15 },
  previewBox:      { backgroundColor: '#111', borderRadius: 12, padding: 14, borderLeftWidth: 3, borderLeftColor: '#00ff88', marginBottom: 12 },
  previewText:     { color: '#ccc', fontSize: 13, lineHeight: 20 },
  noteBox:         { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: '#0d1f16', borderRadius: 10, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: '#1a3d28' },
  noteText:        { color: '#666', fontSize: 11, lineHeight: 16, flex: 1 },
  tag:             { backgroundColor: '#111', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#222' },
  tagText:         { color: '#ccc', fontSize: 12 },
  skipBottom:      { alignItems: 'center', marginTop: 20 },
  skipBottomText:  { color: '#444', fontSize: 13 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Main Signup Screen
// ─────────────────────────────────────────────────────────────────────────────
export default function SignupScreen() {
  const [email,               setEmail]               = useState('');
  const [password,            setPassword]            = useState('');
  const [confirmPassword,     setConfirmPassword]     = useState('');
  const [username,            setUsername]            = useState('');
  const [displayName,         setDisplayName]         = useState('');
  const [referralCode,        setReferralCode]        = useState('');
  const [loading,             setLoading]             = useState(false);
  const [showPassword,        setShowPassword]        = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [agreedToTerms,       setAgreedToTerms]       = useState(false);

  // Contact invite screen state
  const [showContactInvite,   setShowContactInvite]   = useState(false);
  const [newReferralCode,     setNewReferralCode]      = useState('');

  const handleSignup = async () => {
    if (!email || !password || !username || !displayName) {
      Alert.alert('Missing Information', 'Please fill in all required fields');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      Alert.alert('Invalid Email', 'Please enter a valid email address');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Weak Password', 'Password must be at least 6 characters long');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Password Mismatch', 'Passwords do not match');
      return;
    }

    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(username)) {
      Alert.alert(
        'Invalid Username',
        'Username must be 3-20 characters and can only contain letters, numbers, and underscores'
      );
      return;
    }

    if (!agreedToTerms) {
      Alert.alert('Terms Required', 'Please agree to our Terms of Service and Privacy Policy to continue.');
      return;
    }

    setLoading(true);

    try {
      const { data: existingEmail } = await supabase
        .from('users')
        .select('email')
        .eq('email', email.trim().toLowerCase())
        .maybeSingle();

      if (existingEmail) {
        Alert.alert('Email Taken', 'This email is already registered. Please login instead.');
        return;
      }

      const { data: existingUsername } = await supabase
        .from('users')
        .select('username')
        .eq('username', username.toLowerCase())
        .maybeSingle();

      if (existingUsername) {
        Alert.alert('Username Taken', 'This username is already taken. Please choose another.');
        return;
      }

      console.log('🔐 Creating auth user...');
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: {
            username: username.toLowerCase(),
            display_name: displayName.trim(),
          },
        },
      });

      if (authError) {
        console.error('❌ Auth error:', authError);
        throw new Error(authError.message);
      }

      if (!authData.user) {
        throw new Error('Failed to create account. Please try again.');
      }

      // ✅ EMAIL VERIFICATION CHECK
      // When Supabase "Confirm email" is ON, session is null until user clicks
      // the verification link. We catch that here and stop — no profile is
      // created yet because the user hasn't confirmed they own the email.
      // Profile creation happens automatically via your Supabase trigger
      // OR the user logs in after verifying and your app handles it then.
      if (!authData.session) {
        Alert.alert(
          '📧 Check Your Email!',
          `We sent a verification link to:\n\n${email.trim().toLowerCase()}\n\nClick the link in the email to activate your account, then come back and log in.\n\n(Check your spam folder if you don't see it.)`,
          [{
            text: 'Got it!',
            onPress: () => router.replace('/(auth)/login'),
          }]
        );
        return;
      }

      // ─── Only reaches here if email confirmation is OFF in Supabase ───────
      // (session exists immediately — user is logged in straight away)

      const userId = authData.user.id;
      console.log('✅ Auth user created:', userId);

      console.log('🎁 Generating referral code...');
      const generatedCode = await generateReferralCode(username);
      console.log('✅ Referral code:', generatedCode);

      let referrerId = null;
      if (referralCode.trim()) {
        console.log('🔍 Looking up referral code:', referralCode.trim().toUpperCase());
        const { data: referrer } = await supabase
          .from('users')
          .select('id')
          .eq('referral_code', referralCode.trim().toUpperCase())
          .maybeSingle();

        if (referrer) {
          referrerId = referrer.id;
          console.log('✅ Found referrer ID:', referrerId);
        } else {
          console.log('⚠️ Referral code not found');
        }
      }

      let profileCreated = false;
      let retryCount = 0;
      const maxRetries = 3;

      while (!profileCreated && retryCount < maxRetries) {
        try {
          console.log(`📝 Creating profile (attempt ${retryCount + 1})...`);

          const { data: existingProfile } = await supabase
            .from('users')
            .select('id')
            .eq('id', userId)
            .maybeSingle();

          if (existingProfile) {
            console.log('⚠️ Profile already exists, skipping creation');
            profileCreated = true;
            break;
          }

          const profileData: any = {
            id: userId,
            email: email.trim().toLowerCase(),
            username: username.toLowerCase(),
            display_name: displayName.trim(),
            referral_code: generatedCode,
            points: 0,
            level: 1,
            current_streak: 0,
            coins: 0,
            is_premium: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          if (referrerId) {
            profileData.referred_by = referrerId;
          }

          const { error: profileError } = await supabase.from('users').insert(profileData);

          if (profileError) {
            console.error('❌ Profile error:', profileError);

            if (profileError.code === '23505') {
              console.log('⚠️ Duplicate detected, checking existing profile...');
              const { data: checkProfile } = await supabase
                .from('users')
                .select('id')
                .eq('id', userId)
                .maybeSingle();

              if (checkProfile) {
                console.log('✅ Profile exists, continuing...');
                profileCreated = true;
                break;
              }
            }

            throw profileError;
          }

          console.log('✅ Profile created successfully');
          profileCreated = true;

        } catch (error: any) {
          retryCount++;
          console.error(`❌ Profile creation attempt ${retryCount} failed:`, error);

          if (retryCount >= maxRetries) {
            await supabase.auth.signOut();
            throw new Error('Failed to create profile. Please try again.');
          }

          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      if (!profileCreated) {
        throw new Error('Failed to create profile after multiple attempts');
      }

      let referralProcessed = false;
      if (referralCode.trim() && referrerId) {
        console.log('🎁 Processing referral code...');
        try {
          const result = await processReferralReward(
            userId,
            referralCode.trim().toUpperCase()
          );

          if (result.success) {
            console.log('✅ Referral reward processed:', result.message);
            referralProcessed = true;
          } else {
            console.log('⚠️ Referral code issue:', result.message);
          }
        } catch (error) {
          console.error('⚠️ Referral processing error:', error);
        }
      }

      console.log('🎉 Signup complete!');

      setNewReferralCode(generatedCode);

      if (referralProcessed) {
        Alert.alert(
          'Welcome to Lumvibe! 🎉',
          `Account created successfully!\n\n🎁 You earned 50 bonus points from referral code!\n\n📱 Your referral code: ${generatedCode}\nShare it with friends to earn rewards!`,
          [{ text: 'Get Started!', onPress: () => setShowContactInvite(true) }]
        );
      } else {
        Alert.alert(
          'Welcome to Lumvibe! 🎉',
          `Account created successfully!\n\n📱 Your referral code: ${generatedCode}\nShare it with friends to earn rewards!`,
          [{ text: 'Get Started!', onPress: () => setShowContactInvite(true) }]
        );
      }

    } catch (error: any) {
      console.error('❌ Signup error:', error);

      let errorMessage = 'Failed to create account. Please try again.';

      if (error.message?.includes('email')) {
        errorMessage = 'Email is already registered. Please login instead.';
      } else if (error.message?.includes('User already registered')) {
        errorMessage = 'This account already exists. Please login instead.';
      } else if (error.message?.includes('username')) {
        errorMessage = 'Username is already taken. Please choose another.';
      } else if (error.message?.includes('Invalid')) {
        errorMessage = error.message;
      } else if (error.code === '23505') {
        errorMessage = 'This account already exists. Please login instead.';
      } else if (error.code === '23503') {
        errorMessage = 'Invalid referral code. Please check and try again.';
      }

      Alert.alert('Signup Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleContactInviteDone = () => {
    setShowContactInvite(false);
    router.replace('/(tabs)');
  };

  const handleContactInviteSkip = () => {
    setShowContactInvite(false);
    router.replace('/(tabs)');
  };

  return (
    <>
      <KeyboardAvoidingView
        style={s.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={s.header}>
            <Text style={s.title}>Create Account</Text>
            <Text style={s.subtitle}>Join Lumvibe today</Text>
          </View>

          <View style={s.form}>
            <View style={s.inputGroup}>
              <Text style={s.label}>Email *</Text>
              <View style={s.inputContainer}>
                <Feather name="mail" size={20} color="#666" />
                <TextInput
                  style={s.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Enter your email"
                  placeholderTextColor="#666"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!loading}
                />
              </View>
            </View>

            <View style={s.inputGroup}>
              <Text style={s.label}>Username *</Text>
              <View style={s.inputContainer}>
                <Feather name="at-sign" size={20} color="#666" />
                <TextInput
                  style={s.input}
                  value={username}
                  onChangeText={setUsername}
                  placeholder="Choose a username"
                  placeholderTextColor="#666"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!loading}
                />
              </View>
              <Text style={s.hint}>3-20 characters, letters, numbers, and underscores only</Text>
            </View>

            <View style={s.inputGroup}>
              <Text style={s.label}>Display Name *</Text>
              <View style={s.inputContainer}>
                <Feather name="user" size={20} color="#666" />
                <TextInput
                  style={s.input}
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="Your name"
                  placeholderTextColor="#666"
                  autoCorrect={false}
                  editable={!loading}
                />
              </View>
            </View>

            <View style={s.inputGroup}>
              <Text style={s.label}>Password *</Text>
              <View style={s.inputContainer}>
                <Feather name="lock" size={20} color="#666" />
                <TextInput
                  style={s.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Create a password"
                  placeholderTextColor="#666"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  editable={!loading}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                  <Feather name={showPassword ? 'eye' : 'eye-off'} size={20} color="#666" />
                </TouchableOpacity>
              </View>
              <Text style={s.hint}>At least 6 characters</Text>
            </View>

            <View style={s.inputGroup}>
              <Text style={s.label}>Confirm Password *</Text>
              <View style={s.inputContainer}>
                <Feather name="lock" size={20} color="#666" />
                <TextInput
                  style={s.input}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Confirm your password"
                  placeholderTextColor="#666"
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                  editable={!loading}
                />
                <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
                  <Feather
                    name={showConfirmPassword ? 'eye' : 'eye-off'}
                    size={20}
                    color="#666"
                  />
                </TouchableOpacity>
              </View>
            </View>

            <View style={s.inputGroup}>
              <View style={s.referralHeader}>
                <Text style={s.label}>Referral Code (Optional)</Text>
                <Text style={s.referralBonus}>🎁 Get 50 bonus points!</Text>
              </View>
              <View style={s.inputContainer}>
                <Feather name="gift" size={20} color="#00ff88" />
                <TextInput
                  style={s.input}
                  value={referralCode}
                  onChangeText={(text) => setReferralCode(text.toUpperCase())}
                  placeholder="Enter referral code"
                  placeholderTextColor="#666"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  editable={!loading}
                />
              </View>
            </View>

            <TouchableOpacity
              style={s.termsRow}
              onPress={() => setAgreedToTerms(!agreedToTerms)}
              activeOpacity={0.8}
              disabled={loading}
            >
              <View style={[s.checkbox, agreedToTerms && s.checkboxChecked]}>
                {agreedToTerms && <Text style={s.checkmark}>✓</Text>}
              </View>
              <Text style={s.termsText}>
                I agree to the{' '}
                <Text style={s.termsLink} onPress={() => router.push('/terms' as any)}>
                  Terms of Service
                </Text>
                {' '}and{' '}
                <Text style={s.termsLink} onPress={() => router.push('/privacy' as any)}>
                  Privacy Policy
                </Text>
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.signupButton, loading && s.buttonDisabled]}
              onPress={handleSignup}
              disabled={loading}
            >
              {loading ? (
                <View style={s.loadingContainer}>
                  <ActivityIndicator color="#000" />
                  <Text style={s.loadingText}>Creating account...</Text>
                </View>
              ) : (
                <Text style={s.signupButtonText}>Create Account</Text>
              )}
            </TouchableOpacity>

            <View style={s.footer}>
              <Text style={s.footerText}>Already have an account? </Text>
              <TouchableOpacity
                onPress={() => !loading && router.replace('/(auth)/login')}
                disabled={loading}
              >
                <Text style={[s.footerLink, loading && s.linkDisabled]}>Sign In</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Post-signup contact invite screen */}
      <PostSignupContactInvite
        visible={showContactInvite}
        onSkip={handleContactInviteSkip}
        onDone={handleContactInviteDone}
        referralCode={newReferralCode}
        userName={displayName.trim() || username}
      />
    </>
  );
}

const s = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#000' },
  scrollContent:    { flexGrow: 1, justifyContent: 'center', padding: 20, paddingTop: 60, paddingBottom: 40 },
  header:           { marginBottom: 40, alignItems: 'center' },
  title:            { fontSize: 32, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  subtitle:         { fontSize: 16, color: '#999' },
  form:             { gap: 20 },
  inputGroup:       { gap: 8 },
  label:            { color: '#fff', fontSize: 14, fontWeight: '600' },
  inputContainer:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', borderRadius: 12, borderWidth: 1, borderColor: '#222', paddingHorizontal: 15, gap: 10 },
  input:            { flex: 1, color: '#fff', fontSize: 16, paddingVertical: 15 },
  hint:             { color: '#666', fontSize: 12, marginTop: -4 },
  referralHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  referralBonus:    { color: '#00ff88', fontSize: 12, fontWeight: 'bold' },
  termsRow:         { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: -4 },
  checkbox:         { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#333', alignItems: 'center', justifyContent: 'center', marginTop: 1, backgroundColor: 'transparent' },
  checkboxChecked:  { backgroundColor: '#00ff88', borderColor: '#00ff88' },
  checkmark:        { color: '#000', fontSize: 13, fontWeight: 'bold' },
  termsText:        { color: '#888', fontSize: 13, lineHeight: 20, flex: 1 },
  termsLink:        { color: '#00ff88', fontWeight: '600', textDecorationLine: 'underline' },
  signupButton:     { backgroundColor: '#00ff88', borderRadius: 12, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', marginTop: 10, minHeight: 54 },
  signupButtonText: { color: '#000', fontSize: 16, fontWeight: 'bold' },
  loadingContainer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  loadingText:      { color: '#000', fontSize: 14, fontWeight: '600' },
  buttonDisabled:   { opacity: 0.6 },
  footer:           { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  footerText:       { color: '#999', fontSize: 14 },
  footerLink:       { color: '#00ff88', fontSize: 14, fontWeight: 'bold' },
  linkDisabled:     { opacity: 0.5 },
}); 
