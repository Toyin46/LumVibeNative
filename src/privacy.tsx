// app/privacy.tsx
// ✅ Privacy Policy for LumVibe — JOSEPH TECHNOLOGIES LIMITED
// ✅ GDPR + NDPR (Nigeria Data Protection Regulation) compliant
// Usage: router.push('/privacy')

import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

export default function PrivacyPolicyScreen() {
  const router = useRouter();

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Privacy Policy</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        <Text style={s.lastUpdated}>Last updated: May 2026</Text>
        <Text style={s.intro}>
          JOSEPH TECHNOLOGIES LIMITED ("we", "us", "our") operates the LumVibe app.
          This Privacy Policy explains how we collect, use, and protect your personal
          information in compliance with the Nigeria Data Protection Regulation (NDPR)
          and applicable international laws.
        </Text>

        <Text style={s.sectionTitle}>1. Information We Collect</Text>
        <Text style={s.body}>
          <Text style={s.bold}>Information you provide:{'\n'}</Text>
          • Full name and username{'\n'}
          • Email address{'\n'}
          • Profile photo{'\n'}
          • Bio and social links{'\n'}
          • Bank account details (for withdrawals only){'\n'}
          • BVN verification (processed by Flutterwave — we do not store your BVN){'\n\n'}
          <Text style={s.bold}>Information collected automatically:{'\n'}</Text>
          • Device type and operating system{'\n'}
          • IP address and approximate location{'\n'}
          • App usage data (videos watched, likes, comments){'\n'}
          • Push notification token{'\n'}
          • Crash reports and performance data{'\n\n'}
          <Text style={s.bold}>Payment information:{'\n'}</Text>
          • Payment transactions are processed by Flutterwave and Paystack.
            We do not store your card details. Only transaction references and
            amounts are stored in our database.
        </Text>

        <Text style={s.sectionTitle}>2. How We Use Your Information</Text>
        <Text style={s.body}>
          We use your information to:{'\n\n'}
          • Create and manage your account{'\n'}
          • Process coin purchases and withdrawals{'\n'}
          • Display your content to other users{'\n'}
          • Send you notifications about activity on your posts{'\n'}
          • Calculate and distribute referral rewards{'\n'}
          • Detect and prevent fraud and abuse{'\n'}
          • Improve the app and fix bugs{'\n'}
          • Comply with legal obligations{'\n\n'}
          We do NOT sell your personal data to third parties for marketing purposes.
        </Text>

        <Text style={s.sectionTitle}>3. How We Share Your Information</Text>
        <Text style={s.body}>
          We share your information only with:{'\n\n'}
          <Text style={s.bold}>Flutterwave{'\n'}</Text>
          Payment processing and bank transfers. Their privacy policy applies
          to data they process.{'\n\n'}
          <Text style={s.bold}>Paystack{'\n'}</Text>
          Payment processing for coin purchases. Their privacy policy applies.{'\n\n'}
          <Text style={s.bold}>Google AdMob{'\n'}</Text>
          Advertising. Google may use device identifiers to show relevant ads.
          You can opt out of personalised ads in your device settings.{'\n\n'}
          <Text style={s.bold}>Supabase{'\n'}</Text>
          Our database and authentication provider. Data is stored on servers
          in the EU (Stockholm) region.{'\n\n'}
          <Text style={s.bold}>Cloudinary{'\n'}</Text>
          Video and image hosting for your uploaded content.{'\n\n'}
          <Text style={s.bold}>Law enforcement{'\n'}</Text>
          We may disclose information if required by Nigerian law or court order.
        </Text>

        <Text style={s.sectionTitle}>4. Public Information</Text>
        <Text style={s.body}>
          The following information is visible to all users of LumVibe:{'\n\n'}
          • Your username and display name{'\n'}
          • Your profile photo{'\n'}
          • Your bio{'\n'}
          • Your posts and videos{'\n'}
          • Your follower and following counts{'\n'}
          • Your badges and level{'\n\n'}
          Your email address, bank details, phone number, and exact coin balance
          are NEVER shown to other users.
        </Text>

        <Text style={s.sectionTitle}>5. Data Storage and Security</Text>
        <Text style={s.body}>
          Your data is stored securely on Supabase servers located in the EU
          (North Stockholm region). We implement the following security measures:{'\n\n'}
          • Row-level security on all database tables{'\n'}
          • Encrypted connections (HTTPS/TLS) for all data transfers{'\n'}
          • Passwords are hashed — we never store plain text passwords{'\n'}
          • Payment data is handled entirely by PCI-compliant providers{'\n'}
          • Regular security reviews of our database policies{'\n\n'}
          No system is 100% secure. If we discover a breach that affects your data,
          we will notify you within 72 hours.
        </Text>

        <Text style={s.sectionTitle}>6. Data Retention</Text>
        <Text style={s.body}>
          We retain your data for as long as your account is active.{'\n\n'}
          • If you delete your account, your personal data is deleted within 30 days.{'\n'}
          • Transaction records may be retained for up to 7 years for legal
            and financial compliance purposes.{'\n'}
          • Anonymised analytics data may be retained indefinitely.
        </Text>

        <Text style={s.sectionTitle}>7. Your Rights</Text>
        <Text style={s.body}>
          Under the Nigeria Data Protection Regulation (NDPR) and GDPR, you have the right to:{'\n\n'}
          • <Text style={s.bold}>Access</Text> — request a copy of your personal data{'\n'}
          • <Text style={s.bold}>Correction</Text> — ask us to fix inaccurate data{'\n'}
          • <Text style={s.bold}>Deletion</Text> — delete your account and data from your profile settings{'\n'}
          • <Text style={s.bold}>Portability</Text> — receive your data in a portable format{'\n'}
          • <Text style={s.bold}>Objection</Text> — object to how we process your data{'\n'}
          • <Text style={s.bold}>Withdraw consent</Text> — at any time for data processing based on consent{'\n\n'}
          To exercise any of these rights, email us at support@lumvibe.site.
          We will respond within 30 days.
        </Text>

        <Text style={s.sectionTitle}>8. Children's Privacy</Text>
        <Text style={s.body}>
          LumVibe is not directed at children under 13. We do not knowingly collect
          personal data from children under 13. If we discover that a child under 13
          has created an account, we will delete it immediately.{'\n\n'}
          If you believe a child under 13 is using LumVibe, please contact us at
          support@lumvibe.site.
        </Text>

        <Text style={s.sectionTitle}>9. Cookies and Tracking</Text>
        <Text style={s.body}>
          The LumVibe mobile app does not use browser cookies. However, we use:{'\n\n'}
          • <Text style={s.bold}>Device identifiers</Text> — to identify your device for push notifications{'\n'}
          • <Text style={s.bold}>Analytics</Text> — to understand how users interact with the app{'\n'}
          • <Text style={s.bold}>AdMob advertising ID</Text> — for ad personalisation (can be disabled in device settings)
        </Text>

        <Text style={s.sectionTitle}>10. Third-Party Links</Text>
        <Text style={s.body}>
          LumVibe may contain links to third-party websites or services. We are not
          responsible for the privacy practices of those third parties. Please review
          their privacy policies before providing any personal information.
        </Text>

        <Text style={s.sectionTitle}>11. International Users</Text>
        <Text style={s.body}>
          LumVibe is based in Nigeria but accessible worldwide. If you are using
          LumVibe from outside Nigeria, your data will be transferred to and processed
          in Nigeria and the EU (where our servers are located).{'\n\n'}
          By using LumVibe, you consent to this transfer and processing of your data.
        </Text>

        <Text style={s.sectionTitle}>12. Changes to This Policy</Text>
        <Text style={s.body}>
          We may update this Privacy Policy from time to time. We will notify you
          of significant changes via in-app notification at least 7 days before
          they take effect. Continued use of LumVibe after changes means you accept
          the updated policy.
        </Text>

        <Text style={s.sectionTitle}>13. Contact Us</Text>
        <Text style={s.body}>
          For privacy concerns or data requests, contact us:{'\n\n'}
          📧 Email: support@lumvibe.site{'\n'}
          🌐 Website: lumvibe.site{'\n'}
          🏢 Company: JOSEPH TECHNOLOGIES LIMITED{'\n'}
          📍 Location: Minna, Niger State, Nigeria{'\n'}
          {'\n'}
          🔢 TIN: 2622624204177
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
  bold:         { color: '#fff', fontWeight: 'bold' },
  footer:       { marginTop: 32, padding: 16, backgroundColor: '#111', borderRadius: 12, alignItems: 'center', gap: 6 },
  footerText:   { color: '#555', fontSize: 12, textAlign: 'center' },
}); 
