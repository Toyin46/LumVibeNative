// app/premium-subscription.tsx - $10/MONTH SUBSCRIPTION
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Alert,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from './store/authStore'; 
import { supabase } from './config/supabase'; 

const TESTING_MODE = true;
const MONTHLY_PRICE = 10.00; // Changed from $5 to $10

export default function PremiumSubscriptionScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [subscription, setSubscription] = useState<any>(null);

  useEffect(() => {
    loadSubscription();
  }, [user?.id]);

  const loadSubscription = async () => {
    if (!user?.id) return;
    
    try {
      const { data } = await supabase
        .from('premium_subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .single();
      
      setSubscription(data);
    } catch (error) {
      // No active subscription
    }
  };

  const handleSubscribe = async () => {
    if (!user?.id) return;

    Alert.alert(
      '💎 Subscribe to Premium',
      `$${MONTHLY_PRICE.toFixed(2)}/month\n\nFeatures:\n✅ No ads\n✅ Custom profile themes\n✅ Analytics dashboard\n✅ Priority support\n✅ Exclusive badges\n✅ Higher feed visibility\n✅ Schedule posts`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Subscribe', onPress: processSubscription }
      ]
    );
  };

  const processSubscription = async () => {
    setLoading(true);

    try {
      // Simulate payment processing
      await new Promise(resolve => setTimeout(resolve, 2000));

      const startDate = new Date();
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + 1);

      // Create subscription
      const { error: subError } = await supabase
        .from('premium_subscriptions')
        .insert({
          user_id: user?.id,
          plan_type: 'monthly',
          price: MONTHLY_PRICE,
          status: 'active',
          current_period_start: startDate.toISOString(),
          current_period_end: endDate.toISOString(),
        });

      if (subError) throw subError;

      // Update user
      await supabase
        .from('users')
        .update({
          is_premium: true,
          premium_expires_at: endDate.toISOString(),
        })
        .eq('id', user?.id);

      // Create transaction
      await supabase.from('transactions').insert({
        user_id: user?.id,
        type: 'spent',
        amount: MONTHLY_PRICE * 10, // Convert to coins (100 coins)
        description: `Premium subscription: $${MONTHLY_PRICE.toFixed(2)}/month`,
      });

      setLoading(false);
      
      Alert.alert(
        '🎉 Welcome to Premium!',
        'You now have access to all premium features!',
        [{ text: 'Awesome!', onPress: () => router.back() }]
      );
    } catch (error: any) {
      setLoading(false);
      Alert.alert('Error', error.message || 'Subscription failed');
    }
  };

  const handleCancelSubscription = async () => {
    Alert.alert(
      'Cancel Subscription?',
      'You will lose access to premium features at the end of your billing period.',
      [
        { text: 'Keep Premium', style: 'cancel' },
        {
          text: 'Cancel',
          style: 'destructive',
          onPress: async () => {
            try {
              await supabase
                .from('premium_subscriptions')
                .update({ cancel_at_period_end: true })
                .eq('user_id', user?.id);
              
              Alert.alert('Cancelled', 'Your subscription will not renew.');
              loadSubscription();
            } catch (error: any) {
              Alert.alert('Error', error.message);
            }
          }
        }
      ]
    );
  };

  if (subscription) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Feather name="arrow-left" size={24} color="#00ff88" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Premium Status</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.activeCard}>
            <MaterialCommunityIcons name="crown" size={64} color="#ffd700" />
            <Text style={styles.activeTitle}>Premium Active</Text>
            <Text style={styles.activeText}>
              Your subscription renews on{'\n'}
              {new Date(subscription.current_period_end).toLocaleDateString()}
            </Text>
            
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleCancelSubscription}
            >
              <Text style={styles.cancelText}>Cancel Subscription</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.featuresCard}>
            <Text style={styles.featuresTitle}>Your Premium Features</Text>
            
            <View style={styles.feature}>
              <Feather name="check-circle" size={20} color="#00ff88" />
              <Text style={styles.featureText}>Ad-free experience</Text>
            </View>
            
            <View style={styles.feature}>
              <Feather name="check-circle" size={20} color="#00ff88" />
              <Text style={styles.featureText}>Custom profile themes</Text>
            </View>
            
            <View style={styles.feature}>
              <Feather name="check-circle" size={20} color="#00ff88" />
              <Text style={styles.featureText}>Advanced analytics</Text>
            </View>
            
            <View style={styles.feature}>
              <Feather name="check-circle" size={20} color="#00ff88" />
              <Text style={styles.featureText}>Priority support</Text>
            </View>
            
            <View style={styles.feature}>
              <Feather name="check-circle" size={20} color="#00ff88" />
              <Text style={styles.featureText}>Exclusive badge</Text>
            </View>
            
            <View style={styles.feature}>
              <Feather name="check-circle" size={20} color="#00ff88" />
              <Text style={styles.featureText}>Higher visibility</Text>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {TESTING_MODE && (
        <View style={styles.testBanner}>
          <Text style={styles.testText}>🧪 TEST MODE</Text>
        </View>
      )}

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color="#00ff88" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Go Premium</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <MaterialCommunityIcons name="crown" size={80} color="#ffd700" />
          <Text style={styles.heroTitle}>Unlock Premium</Text>
          <Text style={styles.heroPrice}>${MONTHLY_PRICE.toFixed(2)}/month</Text>
          <Text style={styles.heroSubtext}>Cancel anytime</Text>
        </View>

        <View style={styles.features}>
          <Text style={styles.sectionTitle}>Premium Features</Text>
          
          <View style={styles.featureCard}>
            <Feather name="x-circle" size={24} color="#ff6b6b" />
            <View style={styles.featureContent}>
              <Text style={styles.featureTitle}>No Ads</Text>
              <Text style={styles.featureDesc}>Browse without interruptions</Text>
            </View>
          </View>

          <View style={styles.featureCard}>
            <Feather name="layout" size={24} color="#9b59b6" />
            <View style={styles.featureContent}>
              <Text style={styles.featureTitle}>Custom Themes</Text>
              <Text style={styles.featureDesc}>Personalize your profile</Text>
            </View>
          </View>

          <View style={styles.featureCard}>
            <Feather name="bar-chart-2" size={24} color="#00ff88" />
            <View style={styles.featureContent}>
              <Text style={styles.featureTitle}>Analytics Dashboard</Text>
              <Text style={styles.featureDesc}>Track your growth & earnings</Text>
            </View>
          </View>

          <View style={styles.featureCard}>
            <Feather name="headphones" size={24} color="#3498db" />
            <View style={styles.featureContent}>
              <Text style={styles.featureTitle}>Priority Support</Text>
              <Text style={styles.featureDesc}>Get help faster</Text>
            </View>
          </View>

          <View style={styles.featureCard}>
            <Feather name="award" size={24} color="#ffd700" />
            <View style={styles.featureContent}>
              <Text style={styles.featureTitle}>Exclusive Badge</Text>
              <Text style={styles.featureDesc}>Stand out from the crowd</Text>
            </View>
          </View>

          <View style={styles.featureCard}>
            <Feather name="trending-up" size={24} color="#ff6b6b" />
            <View style={styles.featureContent}>
              <Text style={styles.featureTitle}>Higher Visibility</Text>
              <Text style={styles.featureDesc}>Boost your content reach</Text>
            </View>
          </View>

          <View style={styles.featureCard}>
            <Feather name="clock" size={24} color="#e67e22" />
            <View style={styles.featureContent}>
              <Text style={styles.featureTitle}>Schedule Posts</Text>
              <Text style={styles.featureDesc}>Plan your content ahead</Text>
            </View>
          </View>
        </View>

        <View style={styles.comparison}>
          <Text style={styles.sectionTitle}>Free vs Premium</Text>
          
          <View style={styles.comparisonRow}>
            <Text style={styles.comparisonFeature}>Ads</Text>
            <Text style={styles.comparisonFree}>Yes</Text>
            <Text style={styles.comparisonPremium}>None</Text>
          </View>

          <View style={styles.comparisonRow}>
            <Text style={styles.comparisonFeature}>Analytics</Text>
            <Text style={styles.comparisonFree}>Basic</Text>
            <Text style={styles.comparisonPremium}>Advanced</Text>
          </View>

          <View style={styles.comparisonRow}>
            <Text style={styles.comparisonFeature}>Support</Text>
            <Text style={styles.comparisonFree}>Standard</Text>
            <Text style={styles.comparisonPremium}>Priority</Text>
          </View>

          <View style={styles.comparisonRow}>
            <Text style={styles.comparisonFeature}>Profile Badge</Text>
            <Text style={styles.comparisonFree}>—</Text>
            <Text style={styles.comparisonPremium}>✓</Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.subscribeButton, loading && styles.subscribeButtonDisabled]}
          onPress={handleSubscribe}
          disabled={loading}
        >
          {loading ? (
            <Text style={styles.subscribeButtonText}>Processing...</Text>
          ) : (
            <>
              <MaterialCommunityIcons name="crown" size={20} color="#000" />
              <Text style={styles.subscribeButtonText}>
                Subscribe for ${MONTHLY_PRICE.toFixed(2)}/month
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  testBanner: { backgroundColor: '#ffd700', padding: 8, alignItems: 'center' },
  testText: { fontSize: 12, fontWeight: 'bold', color: '#000' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  hero: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 20 },
  heroTitle: { fontSize: 32, fontWeight: 'bold', color: '#fff', marginTop: 16 },
  heroPrice: { fontSize: 48, fontWeight: 'bold', color: '#00ff88', marginTop: 8 },
  heroSubtext: { fontSize: 14, color: '#999', marginTop: 8 },
  features: { paddingHorizontal: 20, marginTop: 20 },
  sectionTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 16 },
  featureCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0a0a0a', padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#1a1a1a', gap: 16 },
  featureContent: { flex: 1 },
  featureTitle: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 4 },
  featureDesc: { fontSize: 14, color: '#999' },
  comparison: { paddingHorizontal: 20, marginTop: 32, marginBottom: 20 },
  comparisonRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0a0a0a', padding: 16, borderRadius: 12, marginBottom: 8, borderWidth: 1, borderColor: '#1a1a1a' },
  comparisonFeature: { flex: 2, fontSize: 14, color: '#fff' },
  comparisonFree: { flex: 1, fontSize: 14, color: '#999', textAlign: 'center' },
  comparisonPremium: { flex: 1, fontSize: 14, color: '#00ff88', fontWeight: 'bold', textAlign: 'center' },
  footer: { padding: 20, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  subscribeButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#00ff88', paddingVertical: 16, borderRadius: 12, gap: 8 },
  subscribeButtonDisabled: { backgroundColor: '#333', opacity: 0.5 },
  subscribeButtonText: { fontSize: 16, fontWeight: 'bold', color: '#000' },
  content: { padding: 20 },
  activeCard: { backgroundColor: '#0a0a0a', padding: 32, borderRadius: 20, alignItems: 'center', borderWidth: 2, borderColor: '#ffd700', marginBottom: 20 },
  activeTitle: { fontSize: 24, fontWeight: 'bold', color: '#ffd700', marginTop: 16 },
  activeText: { fontSize: 14, color: '#999', textAlign: 'center', marginTop: 12, marginBottom: 24 },
  cancelButton: { backgroundColor: '#ff4444', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  cancelText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  featuresCard: { backgroundColor: '#0a0a0a', padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#1a1a1a' },
  featuresTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 16 },
  feature: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 12 },
  featureText: { fontSize: 14, color: '#999' },
});