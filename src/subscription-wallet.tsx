// app/subscription-wallet.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  FlatList,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from './store/authStore'; 
import { supabase } from './config/supabase'; 

export default function SubscriptionWalletScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [balance, setBalance] = useState(0);
  const [totalEarned, setTotalEarned] = useState(0);
  const [subscriberCount, setSubscriberCount] = useState(0);
  const [earnings, setEarnings] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [withdrawModalVisible, setWithdrawModalVisible] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'paypal' | 'bank'>('paypal');
  const [paymentEmail, setPaymentEmail] = useState('');

  useEffect(() => {
    loadWalletData();
  }, [user?.id]);

  const loadWalletData = async () => {
    if (!user?.id) return;

    try {
      // Load wallet balance
      const { data: userData } = await supabase
        .from('users')
        .select('subscription_wallet, total_subscribers')
        .eq('id', user.id)
        .single();

      if (userData) {
        setBalance(userData.subscription_wallet || 0);
        setSubscriberCount(userData.total_subscribers || 0);
      }

      // Load creator subscription data
      const { data: creatorData } = await supabase
        .from('creator_subscriptions')
        .select('total_earned')
        .eq('creator_id', user.id)
        .single();

      if (creatorData) {
        setTotalEarned(creatorData.total_earned || 0);
      }

      // Load earnings history
      const { data: earningsData } = await supabase
        .from('subscription_earnings')
        .select('*, subscriber:users!subscription_earnings_subscriber_id_fkey(username, display_name, avatar_url)')
        .eq('creator_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      setEarnings(earningsData || []);

      // Load withdrawal history
      const { data: withdrawalsData } = await supabase
        .from('withdrawal_requests')
        .select('*')
        .eq('user_id', user.id)
        .eq('withdrawal_type', 'subscription')
        .order('created_at', { ascending: false })
        .limit(20);

      setWithdrawals(withdrawalsData || []);
    } catch (error) {
      console.error('Error loading wallet data:', error);
    }
  };

  const handleWithdraw = () => {
    if (balance < 25) {
      Alert.alert('Minimum Withdrawal', `You need at least $25 to withdraw.\n\nCurrent balance: $${balance.toFixed(2)}`);
      return;
    }

    setWithdrawAmount('');
    setPaymentEmail('');
    setWithdrawModalVisible(true);
  };

  const processWithdrawal = async () => {
    const amount = parseFloat(withdrawAmount);

    if (isNaN(amount) || amount < 25) {
      Alert.alert('Invalid Amount', 'Minimum withdrawal is $25');
      return;
    }

    if (amount > balance) {
      Alert.alert('Insufficient Balance', `You only have $${balance.toFixed(2)} available`);
      return;
    }

    if (!paymentEmail.trim()) {
      Alert.alert('Email Required', 'Please enter your payment email');
      return;
    }

    setLoading(true);

    try {
      // Create withdrawal request
      const { error: withdrawError } = await supabase
        .from('withdrawal_requests')
        .insert({
          user_id: user?.id,
          amount: amount,
          original_amount: amount,
          platform_fee: 0, // No additional fee for subscription withdrawals
          payment_method: paymentMethod,
          payment_email: paymentEmail.trim(),
          status: 'pending',
          withdrawal_type: 'subscription',
        });

      if (withdrawError) throw withdrawError;

      // Deduct from subscription wallet
      const { error: updateError } = await supabase
        .from('users')
        .update({ subscription_wallet: balance - amount })
        .eq('id', user?.id);

      if (updateError) throw updateError;

      setWithdrawModalVisible(false);
      
      Alert.alert(
        '✅ Withdrawal Requested!',
        `Amount: $${amount.toFixed(2)}\nMethod: ${paymentMethod}\n\nYour withdrawal will be processed within 3-5 business days.`,
        [{ text: 'OK', onPress: () => loadWalletData() }]
      );
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to process withdrawal');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getStatusColor = (status: string) => {
    const colors: any = {
      pending: '#ffd700',
      processing: '#00aaff',
      completed: '#00ff88',
      rejected: '#ff4444',
    };
    return colors[status] || '#666';
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Subscription Wallet</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Balance Card */}
        <View style={styles.balanceCard}>
          <MaterialCommunityIcons name="wallet" size={48} color="#00ff88" />
          <Text style={styles.balanceLabel}>Available Balance</Text>
          <Text style={styles.balanceAmount}>${balance.toFixed(2)}</Text>
          
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Total Earned</Text>
              <Text style={styles.statValue}>${totalEarned.toFixed(2)}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Subscribers</Text>
              <Text style={styles.statValue}>{subscriberCount}</Text>
            </View>
          </View>

          <TouchableOpacity 
            style={[styles.withdrawButton, balance < 25 && styles.withdrawButtonDisabled]}
            onPress={handleWithdraw}
            disabled={balance < 25}
          >
            <Feather name="download" size={20} color={balance < 25 ? "#666" : "#fff"} />
            <Text style={[styles.withdrawButtonText, balance < 25 && styles.withdrawButtonTextDisabled]}>
              Withdraw
            </Text>
          </TouchableOpacity>

          {balance < 25 && (
            <Text style={styles.minimumText}>Minimum withdrawal: $25</Text>
          )}
        </View>

        {/* Info Card */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>💰 About Subscription Earnings</Text>
          <View style={styles.infoItem}>
            <Text style={styles.infoBullet}>•</Text>
            <Text style={styles.infoText}>You receive 70% of all subscription fees</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoBullet}>•</Text>
            <Text style={styles.infoText}>Separate from your coins wallet</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoBullet}>•</Text>
            <Text style={styles.infoText}>Minimum withdrawal: $25</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoBullet}>•</Text>
            <Text style={styles.infoText}>Processing time: 3-5 business days</Text>
          </View>
        </View>

        {/* Recent Earnings */}
        {earnings.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Earnings</Text>
            {earnings.map((earning) => (
              <View key={earning.id} style={styles.earningItem}>
                <View style={styles.earningIcon}>
                  <MaterialCommunityIcons name="cash-plus" size={24} color="#00ff88" />
                </View>
                <View style={styles.earningContent}>
                  <Text style={styles.earningText}>
                    {earning.subscriber?.display_name || 'Subscriber'}
                  </Text>
                  <Text style={styles.earningDate}>{formatDate(earning.created_at)}</Text>
                  <Text style={styles.earningType}>{earning.transaction_type}</Text>
                </View>
                <View style={styles.earningAmount}>
                  <Text style={styles.earningAmountText}>+${earning.creator_gets.toFixed(2)}</Text>
                  <Text style={styles.earningTotalText}>${earning.amount.toFixed(2)} total</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Withdrawal History */}
        {withdrawals.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Withdrawal History</Text>
            {withdrawals.map((withdrawal) => (
              <View key={withdrawal.id} style={styles.withdrawalItem}>
                <View style={styles.withdrawalContent}>
                  <Text style={styles.withdrawalAmount}>${withdrawal.amount.toFixed(2)}</Text>
                  <Text style={styles.withdrawalDate}>{formatDate(withdrawal.created_at)}</Text>
                  <Text style={styles.withdrawalMethod}>{withdrawal.payment_method}</Text>
                </View>
                <View style={[
                  styles.withdrawalStatus,
                  { backgroundColor: getStatusColor(withdrawal.status) + '20', borderColor: getStatusColor(withdrawal.status) }
                ]}>
                  <Text style={[styles.withdrawalStatusText, { color: getStatusColor(withdrawal.status) }]}>
                    {withdrawal.status.toUpperCase()}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Withdrawal Modal */}
      <Modal
        visible={withdrawModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setWithdrawModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>💰 Withdraw Earnings</Text>
            <Text style={styles.modalBalance}>Available: ${balance.toFixed(2)}</Text>
            <Text style={styles.modalNote}>Minimum: $25 • No additional fees</Text>

            <TextInput
              style={styles.input}
              placeholder="Amount (USD)"
              placeholderTextColor="#666"
              keyboardType="decimal-pad"
              value={withdrawAmount}
              onChangeText={setWithdrawAmount}
            />

            <View style={styles.paymentMethodSection}>
              <Text style={styles.paymentMethodLabel}>Payment Method:</Text>
              <View style={styles.paymentMethodButtons}>
                <TouchableOpacity
                  style={[styles.paymentMethodButton, paymentMethod === 'paypal' && styles.paymentMethodButtonActive]}
                  onPress={() => setPaymentMethod('paypal')}
                >
                  <Text style={[styles.paymentMethodText, paymentMethod === 'paypal' && styles.paymentMethodTextActive]}>
                    PayPal
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.paymentMethodButton, paymentMethod === 'bank' && styles.paymentMethodButtonActive]}
                  onPress={() => setPaymentMethod('bank')}
                >
                  <Text style={[styles.paymentMethodText, paymentMethod === 'bank' && styles.paymentMethodTextActive]}>
                    Bank Transfer
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <TextInput
              style={styles.input}
              placeholder={paymentMethod === 'paypal' ? "PayPal Email" : "Bank Account Email"}
              placeholderTextColor="#666"
              keyboardType="email-address"
              autoCapitalize="none"
              value={paymentEmail}
              onChangeText={setPaymentEmail}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setWithdrawModalVisible(false)}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirmButton}
                onPress={processWithdrawal}
                disabled={loading}
              >
                <Text style={styles.modalConfirmButtonText}>
                  {loading ? 'Processing...' : 'Submit Request'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  balanceCard: { backgroundColor: '#0a0a0a', margin: 20, padding: 24, borderRadius: 20, alignItems: 'center', borderWidth: 2, borderColor: '#00ff88' },
  balanceLabel: { fontSize: 14, color: '#666', marginTop: 12, marginBottom: 8 },
  balanceAmount: { fontSize: 48, fontWeight: 'bold', color: '#00ff88', marginBottom: 20 },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, width: '100%' },
  statItem: { flex: 1, alignItems: 'center' },
  statLabel: { fontSize: 12, color: '#666', marginBottom: 4 },
  statValue: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  statDivider: { width: 1, height: 40, backgroundColor: '#333' },
  withdrawButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#00ff88', paddingVertical: 16, paddingHorizontal: 32, borderRadius: 12, gap: 8 },
  withdrawButtonDisabled: { backgroundColor: '#1a1a1a' },
  withdrawButtonText: { fontSize: 16, fontWeight: 'bold', color: '#000' },
  withdrawButtonTextDisabled: { color: '#666' },
  minimumText: { fontSize: 12, color: '#666', marginTop: 12 },
  infoCard: { backgroundColor: '#0a0a0a', marginHorizontal: 20, marginBottom: 20, padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#1a1a1a' },
  infoTitle: { fontSize: 16, fontWeight: 'bold', color: '#fff', marginBottom: 16 },
  infoItem: { flexDirection: 'row', marginBottom: 12 },
  infoBullet: { fontSize: 16, color: '#00ff88', marginRight: 8 },
  infoText: { flex: 1, fontSize: 14, color: '#999', lineHeight: 20 },
  section: { marginHorizontal: 20, marginBottom: 24 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 16 },
  earningItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0a0a0a', padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#1a1a1a' },
  earningIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,255,136,0.1)', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  earningContent: { flex: 1 },
  earningText: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 4 },
  earningDate: { fontSize: 12, color: '#666' },
  earningType: { fontSize: 11, color: '#999', marginTop: 2, textTransform: 'capitalize' },
  earningAmount: { alignItems: 'flex-end' },
  earningAmountText: { fontSize: 18, fontWeight: 'bold', color: '#00ff88', marginBottom: 2 },
  earningTotalText: { fontSize: 11, color: '#666' },
  withdrawalItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0a0a0a', padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#1a1a1a' },
  withdrawalContent: { flex: 1 },
  withdrawalAmount: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  withdrawalDate: { fontSize: 12, color: '#666', marginBottom: 2 },
  withdrawalMethod: { fontSize: 11, color: '#999', textTransform: 'capitalize' },
  withdrawalStatus: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1 },
  withdrawalStatusText: { fontSize: 12, fontWeight: 'bold' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#1a1a1a', borderRadius: 20, padding: 24, borderWidth: 2, borderColor: '#00ff88' },
  modalTitle: { fontSize: 24, fontWeight: 'bold', color: '#00ff88', textAlign: 'center', marginBottom: 12 },
  modalBalance: { fontSize: 16, color: '#ffd700', textAlign: 'center', marginBottom: 8 },
  modalNote: { fontSize: 12, color: '#999', textAlign: 'center', marginBottom: 20 },
  input: { backgroundColor: '#0a0a0a', borderRadius: 12, borderWidth: 1, borderColor: '#00ff88', padding: 16, fontSize: 18, color: '#fff', textAlign: 'center', marginBottom: 16 },
  paymentMethodSection: { marginBottom: 16 },
  paymentMethodLabel: { fontSize: 14, color: '#999', marginBottom: 8 },
  paymentMethodButtons: { flexDirection: 'row', gap: 12 },
  paymentMethodButton: { flex: 1, backgroundColor: '#0a0a0a', padding: 12, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  paymentMethodButtonActive: { backgroundColor: '#00ff88', borderColor: '#00ff88' },
  paymentMethodText: { fontSize: 14, fontWeight: '600', color: '#999' },
  paymentMethodTextActive: { color: '#000' },
  modalButtons: { flexDirection: 'row', gap: 12 },
  modalCancelButton: { flex: 1, backgroundColor: '#333', padding: 16, borderRadius: 12, alignItems: 'center' },
  modalCancelButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  modalConfirmButton: { flex: 1, backgroundColor: '#00ff88', padding: 16, borderRadius: 12, alignItems: 'center' },
  modalConfirmButtonText: { color: '#000', fontSize: 16, fontWeight: 'bold' },
});