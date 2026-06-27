// app/apply-subscriptions.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from './store/authStore';
import { supabase } from './config/supabase'; 

export default function ApplySubscriptionsScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [canApply, setCanApply] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [existingApplication, setExistingApplication] = useState<any>(null);

  // Tier 1 (Bronze)
  const [tier1Name, setTier1Name] = useState('Bronze Supporter');
  const [tier1Price, setTier1Price] = useState('4.99');
  const [tier1Perks, setTier1Perks] = useState('Exclusive content\nCustom badge\nSupporter shoutouts');

  // Tier 2 (Silver)
  const [tier2Name, setTier2Name] = useState('Silver VIP');
  const [tier2Price, setTier2Price] = useState('9.99');
  const [tier2Perks, setTier2Perks] = useState('All Bronze perks\nMonthly live Q&A access\nPriority replies to comments\nBehind-the-scenes content');

  // Tier 3 (Gold)
  const [tier3Name, setTier3Name] = useState('Gold Elite');
  const [tier3Price, setTier3Price] = useState('19.99');
  const [tier3Perks, setTier3Perks] = useState('All Silver perks\nPrivate chat access\nMonthly 1-on-1 video call\nCustom content requests\nEarly access to all posts');

  const [welcomeMessage, setWelcomeMessage] = useState('Thank you for subscribing! 🎉');

  useEffect(() => {
    checkEligibility();
    loadExistingApplication();
  }, [user?.id]);

  const checkEligibility = async () => {
    if (!user?.id) return;

    try {
      const { count } = await supabase
        .from('follows')
        .select('*', { count: 'exact', head: true })
        .eq('following_id', user.id);

      setFollowerCount(count || 0);
      setCanApply((count || 0) >= 1000);
    } catch (error) {
      console.error('Error checking eligibility:', error);
    }
  };

  const loadExistingApplication = async () => {
    if (!user?.id) return;

    try {
      const { data } = await supabase
        .from('creator_subscriptions')
        .select('*')
        .eq('creator_id', user.id)
        .single();

      if (data) {
        setExistingApplication(data);
        
        if (data.is_enabled) {
          // Load existing settings
          setTier1Name(data.tier_1_name);
          setTier1Price(data.tier_1_price.toString());
          setTier1Perks(data.tier_1_perks.join('\n'));
          
          setTier2Name(data.tier_2_name);
          setTier2Price(data.tier_2_price.toString());
          setTier2Perks(data.tier_2_perks.join('\n'));
          
          setTier3Name(data.tier_3_name);
          setTier3Price(data.tier_3_price.toString());
          setTier3Perks(data.tier_3_perks.join('\n'));
          
          if (data.custom_welcome_message) {
            setWelcomeMessage(data.custom_welcome_message);
          }
        }
      }
    } catch (error) {
      console.error('Error loading application:', error);
    }
  };

  const handleApply = async () => {
    if (!canApply) {
      Alert.alert(
        'Not Eligible',
        `You need 1,000 followers to enable subscriptions.\n\nCurrent followers: ${followerCount}`
      );
      return;
    }

    setLoading(true);

    try {
      const tier1PriceNum = parseFloat(tier1Price);
      const tier2PriceNum = parseFloat(tier2Price);
      const tier3PriceNum = parseFloat(tier3Price);

      if (isNaN(tier1PriceNum) || isNaN(tier2PriceNum) || isNaN(tier3PriceNum)) {
        Alert.alert('Invalid Prices', 'Please enter valid prices for all tiers');
        setLoading(false);
        return;
      }

      if (tier2PriceNum <= tier1PriceNum || tier3PriceNum <= tier2PriceNum) {
        Alert.alert('Invalid Pricing', 'Each tier must be more expensive than the previous one');
        setLoading(false);
        return;
      }

      const { error } = await supabase
        .from('creator_subscriptions')
        .upsert({
          creator_id: user?.id,
          is_enabled: true,
          tier_1_name: tier1Name,
          tier_1_price: tier1PriceNum,
          tier_1_perks: tier1Perks.split('\n').filter(p => p.trim()),
          tier_2_name: tier2Name,
          tier_2_price: tier2PriceNum,
          tier_2_perks: tier2Perks.split('\n').filter(p => p.trim()),
          tier_3_name: tier3Name,
          tier_3_price: tier3PriceNum,
          tier_3_perks: tier3Perks.split('\n').filter(p => p.trim()),
          custom_welcome_message: welcomeMessage,
          application_status: 'approved',
          applied_at: new Date().toISOString(),
          approved_at: new Date().toISOString(),
        });

      if (error) throw error;

      // Update user to mark as subscription creator
      await supabase
        .from('users')
        .update({ is_subscription_creator: true })
        .eq('id', user?.id);

      Alert.alert(
        '🎉 Subscriptions Enabled!',
        'Your subscription tiers are now live! Fans can now subscribe to your exclusive content.',
        [
          {
            text: 'View Profile',
            onPress: () => router.back(),
          }
        ]
      );
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to enable subscriptions');
    } finally {
      setLoading(false);
    }
  };

  if (existingApplication && existingApplication.is_enabled) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Feather name="arrow-left" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Manage Subscriptions</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <View style={styles.successCard}>
            <MaterialCommunityIcons name="check-circle" size={64} color="#00ff88" />
            <Text style={styles.successTitle}>Subscriptions Active!</Text>
            <Text style={styles.successText}>
              You have {existingApplication.subscriber_only_posts_count} subscriber-only posts
            </Text>
            <Text style={styles.successEarnings}>
              Total Earned: ${existingApplication.total_earned.toFixed(2)}
            </Text>
          </View>

          <TouchableOpacity style={styles.statsButton} onPress={() => router.push('./subscription-wallet')}>
            <MaterialCommunityIcons name="wallet" size={24} color="#00ff88" />
            <Text style={styles.statsButtonText}>View Subscription Wallet</Text>
            <Feather name="chevron-right" size={20} color="#00ff88" />
          </TouchableOpacity>

          {/* Continue with form to edit tiers */}
          <Text style={styles.sectionTitle}>Edit Your Tiers</Text>
          {/* Same form fields as below */}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Enable Subscriptions</Text>
        <View style={{ width: 24 }} />
        </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Eligibility Card */}
        <View style={[styles.eligibilityCard, canApply && styles.eligibilityCardSuccess]}>
          <MaterialCommunityIcons 
            name={canApply ? "check-circle" : "alert-circle"} 
            size={48} 
            color={canApply ? "#00ff88" : "#ffd700"} 
          />
          <Text style={styles.eligibilityTitle}>
            {canApply ? '✅ You\'re Eligible!' : '⚠️ Not Yet Eligible'}
          </Text>
          <Text style={styles.eligibilityText}>
            Current Followers: {followerCount} / 1,000
          </Text>
          {!canApply && (
            <Text style={styles.eligibilitySubtext}>
              Keep creating great content! You need {1000 - followerCount} more followers.
            </Text>
          )}
        </View>

        {canApply && (
          <>
            {/* Info Card */}
            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>💰 How It Works</Text>
              <View style={styles.infoItem}>
                <Text style={styles.infoBullet}>•</Text>
                <Text style={styles.infoText}>You keep 70% of subscription fees</Text>
              </View>
              <View style={styles.infoItem}>
                <Text style={styles.infoBullet}>•</Text>
                <Text style={styles.infoText}>Platform takes 30% (payment processing + hosting)</Text>
              </View>
              <View style={styles.infoItem}>
                <Text style={styles.infoBullet}>•</Text>
                <Text style={styles.infoText}>Separate wallet from coins</Text>
              </View>
              <View style={styles.infoItem}>
                <Text style={styles.infoBullet}>•</Text>
                <Text style={styles.infoText}>Monthly recurring income</Text>
              </View>
            </View>

            {/* Tier 1 */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🥉 Tier 1 - Entry Level</Text>
              <TextInput
                style={styles.input}
                placeholder="Tier Name (e.g., Bronze Supporter)"
                placeholderTextColor="#666"
                value={tier1Name}
                onChangeText={setTier1Name}
              />
              <TextInput
                style={styles.input}
                placeholder="Price (USD)"
                placeholderTextColor="#666"
                keyboardType="decimal-pad"
                value={tier1Price}
                onChangeText={setTier1Price}
              />
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Perks (one per line)"
                placeholderTextColor="#666"
                multiline
                value={tier1Perks}
                onChangeText={setTier1Perks}
              />
            </View>

            {/* Tier 2 */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🥈 Tier 2 - Mid Level</Text>
              <TextInput
                style={styles.input}
                placeholder="Tier Name (e.g., Silver VIP)"
                placeholderTextColor="#666"
                value={tier2Name}
                onChangeText={setTier2Name}
              />
              <TextInput
                style={styles.input}
                placeholder="Price (USD)"
                placeholderTextColor="#666"
                keyboardType="decimal-pad"
                value={tier2Price}
                onChangeText={setTier2Price}
              />
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Perks (one per line)"
                placeholderTextColor="#666"
                multiline
                value={tier2Perks}
                onChangeText={setTier2Perks}
              />
            </View>

            {/* Tier 3 */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🥇 Tier 3 - Premium</Text>
              <TextInput
                style={styles.input}
                placeholder="Tier Name (e.g., Gold Elite)"
                placeholderTextColor="#666"
                value={tier3Name}
                onChangeText={setTier3Name}
              />
              <TextInput
                style={styles.input}
                placeholder="Price (USD)"
                placeholderTextColor="#666"
                keyboardType="decimal-pad"
                value={tier3Price}
                onChangeText={setTier3Price}
              />
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Perks (one per line)"
                placeholderTextColor="#666"
                multiline
                value={tier3Perks}
                onChangeText={setTier3Perks}
              />
            </View>

            {/* Welcome Message */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Welcome Message</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Message for new subscribers"
                placeholderTextColor="#666"
                multiline
                value={welcomeMessage}
                onChangeText={setWelcomeMessage}
              />
            </View>

            {/* Submit Button */}
            <TouchableOpacity
              style={[styles.submitButton, loading && styles.submitButtonDisabled]}
              onPress={handleApply}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#000" />
              ) : (
                <>
                  <MaterialCommunityIcons name="rocket-launch" size={20} color="#000" />
                  <Text style={styles.submitButtonText}>Enable Subscriptions</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  eligibilityCard: { backgroundColor: '#1a1a00', margin: 20, padding: 24, borderRadius: 16, alignItems: 'center', borderWidth: 2, borderColor: '#ffd700' },
  eligibilityCardSuccess: { backgroundColor: '#001a0f', borderColor: '#00ff88' },
  eligibilityTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginTop: 12, marginBottom: 8 },
  eligibilityText: { fontSize: 16, color: '#fff', marginBottom: 8 },
  eligibilitySubtext: { fontSize: 14, color: '#999', textAlign: 'center' },
  infoCard: { backgroundColor: '#0a0a0a', marginHorizontal: 20, marginBottom: 20, padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#00ff88' },
  infoTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 16 },
  infoItem: { flexDirection: 'row', marginBottom: 12 },
  infoBullet: { fontSize: 16, color: '#00ff88', marginRight: 8 },
  infoText: { flex: 1, fontSize: 14, color: '#999', lineHeight: 20 },
  section: { marginHorizontal: 20, marginBottom: 24 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 12 },
  input: { backgroundColor: '#0a0a0a', borderRadius: 12, borderWidth: 1, borderColor: '#333', padding: 16, fontSize: 16, color: '#fff', marginBottom: 12 },
  textArea: { minHeight: 100, textAlignVertical: 'top' },
  submitButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#00ff88', marginHorizontal: 20, marginBottom: 40, padding: 16, borderRadius: 12, gap: 8 },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { fontSize: 16, fontWeight: 'bold', color: '#000' },
  successCard: { backgroundColor: '#0a0a0a', margin: 20, padding: 24, borderRadius: 16, alignItems: 'center', borderWidth: 2, borderColor: '#00ff88' },
  successTitle: { fontSize: 24, fontWeight: 'bold', color: '#00ff88', marginTop: 16, marginBottom: 8 },
  successText: { fontSize: 14, color: '#999', textAlign: 'center', marginBottom: 8 },
  successEarnings: { fontSize: 18, fontWeight: 'bold', color: '#ffd700', marginTop: 8 },
  statsButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0a0a0a', marginHorizontal: 20, marginBottom: 20, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#00ff88', gap: 12 },
  statsButtonText: { flex: 1, fontSize: 16, fontWeight: '600', color: '#fff' },
});