// app/terms.tsx
import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

export default function TermsOfServiceScreen() {
  const navigation = useNavigation();

  return (
    <View style={s.container}>
      <View style={s.header}>
      <TouchableOpacity onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Terms of Service</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.lastUpdated}>Last updated: March 2026</Text>

        <Text style={s.intro}>
          Welcome to LumVibe. By creating an account or using our app, you agree to these
          Terms of Service. Please read them carefully.
        </Text>

        <Text style={s.sectionTitle}>1. About LumVibe</Text>
        <Text style={s.body}>
          LumVibe is a social media platform owned and operated by JOSEPH TECHNOLOGIES LIMITED,
          a technology company based in Nigeria. LumVibe allows users to create and share short
          videos, send virtual gifts, earn coins, and access a creator marketplace.
        </Text>

        <Text style={s.sectionTitle}>2. Eligibility</Text>
        <Text style={s.body}>
          You must be at least 13 years old to use LumVibe. If you are under 18, you must have
          permission from a parent or guardian. By registering, you confirm that the information
          you provide is accurate and complete.
        </Text>

        <Text style={s.sectionTitle}>3. Your Account</Text>
        <Text style={s.body}>
          You are responsible for keeping your account password secure. You must not share your
          account with anyone else. We reserve the right to suspend or terminate accounts that
          violate these terms. You can delete your account at any time from your profile settings.
        </Text>

        <Text style={s.sectionTitle}>4. Coins and Payments</Text>
        <Text style={s.body}>
          LumVibe uses a virtual coin system for in-app purchases and creator rewards.{'\n\n'}
          • Coins are purchased using real money via Flutterwave.{'\n'}
          • Coins are non-refundable once purchased.{'\n'}
          • Coins are non-transferable between accounts.{'\n'}
          • Unused coins are forfeited permanently upon account deletion.{'\n'}
          • 1 coin = ₦150 Nigerian Naira at current rates.{'\n\n'}
          We are not responsible for coins lost due to account deletion, suspension,
          or violation of these terms.
        </Text>

        <Text style={s.sectionTitle}>5. Creator Earnings and Withdrawals</Text>
        <Text style={s.body}>
          Creators can earn coins through gifts, views, and the marketplace.{'\n\n'}
          • A platform fee of 30% is deducted from all profile withdrawals.{'\n'}
          • If referred by another user, an additional 5% referral commission is deducted.{'\n'}
          • Minimum withdrawal is 34 coins for profile wallet.{'\n'}
          • Minimum withdrawal is 50 coins for marketplace wallet.{'\n'}
          • Withdrawals are processed via Flutterwave within 1-3 business days.{'\n'}
          • We reserve the right to hold withdrawals for fraud review.
        </Text>

        <Text style={s.sectionTitle}>6. Content Rules</Text>
        <Text style={s.body}>
          You must NOT post:{'\n\n'}
          • Nudity or sexually explicit content{'\n'}
          • Any content that sexualizes, exploits, or endangers minors — this is never allowed on LumVibe under any circumstances, and violating accounts are permanently banned and may be reported to the relevant authorities{'\n'}
          • Hate speech, racism, or content promoting violence{'\n'}
          • Spam, scams, or misleading information{'\n'}
          • Content that infringes copyright or trademarks{'\n\n'}
          Violating content rules may result in immediate account suspension without
          refund of any coin balance.
        </Text>

        <Text style={s.sectionTitle}>7. Child Safety</Text>
        <Text style={s.body}>
          LumVibe has zero tolerance for child sexual abuse and exploitation (CSAE) of any kind.
          This applies to every part of the app, including posts, chats, voice and video calls,
          and Co-Watch. Any account found engaging in or facilitating this will be permanently
          banned and reported to the National Agency for Prohibition of Trafficking in Persons
          (NAPTIP) and/or the National Center for Missing & Exploited Children (NCMEC), as
          applicable.{'\n\n'}
          To report a concern about child safety, use the in-app Report button, or email
          {'\n'}📧 childsafety@lumvibe.site
        </Text>

        <Text style={s.sectionTitle}>8. Marketplace</Text>
        <Text style={s.body}>
          • LumVibe takes a 10% platform fee on all marketplace transactions.{'\n'}
          • Sellers receive 90% of the order value upon completion.{'\n'}
          • Disputes must be raised within 7 days of order completion.{'\n'}
          • LumVibe is not responsible for the quality of services provided by sellers.
        </Text>

        <Text style={s.sectionTitle}>9. Referral Programme</Text>
        <Text style={s.body}>
          • You earn 100 points when someone signs up with your referral code.{'\n'}
          • You earn 5% of coins whenever your referred user makes a withdrawal — forever.{'\n'}
          • Fraudulent referrals will result in account termination and forfeiture of all rewards.
        </Text>

        <Text style={s.sectionTitle}>10. Limitation of Liability</Text>
        <Text style={s.body}>
          LumVibe is provided "as is" without warranties of any kind. We are not liable for
          loss of data, technical outages, or actions of other users on the platform.
        </Text>

        <Text style={s.sectionTitle}>11. Governing Law</Text>
        <Text style={s.body}>
          These Terms are governed by the laws of the Federal Republic of Nigeria.
          Any disputes shall be subject to the jurisdiction of Nigerian courts.
        </Text>

        <Text style={s.sectionTitle}>12. Contact Us</Text>
        <Text style={s.body}>
          {'📧 Email: support@lumvibe.site\n'}
          {'🏢 Company: JOSEPH TECHNOLOGIES LIMITED\n'}
          {'📍 Location: Minna, Niger State, Nigeria'}
        </Text>

        <View style={s.footer}>
          <Text style={s.footerText}>© 2026 JOSEPH TECHNOLOGIES LIMITED. All rights reserved.</Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#000' },
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  headerTitle:  { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  scroll:       { padding: 20 },
  lastUpdated:  { color: '#555', fontSize: 12, marginBottom: 12, fontStyle: 'italic' },
  intro:        { color: '#aaa', fontSize: 14, lineHeight: 22, marginBottom: 24, padding: 16, backgroundColor: '#111', borderRadius: 12, borderWidth: 1, borderColor: '#1a1a1a' },
  sectionTitle: { color: '#00ff88', fontSize: 15, fontWeight: 'bold', marginTop: 24, marginBottom: 10 },
  body:         { color: '#aaa', fontSize: 14, lineHeight: 24 },
  footer:       { marginTop: 32, padding: 16, backgroundColor: '#111', borderRadius: 12, alignItems: 'center' },
  footerText:   { color: '#555', fontSize: 12, textAlign: 'center' },
}); 
