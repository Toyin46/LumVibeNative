// app/connect-accounts.tsx - FIXED VERSION
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from './store/authStore'; 
import { supabase } from './config/supabase'; 

interface ConnectedAccount {
  id: string;
  provider: string;
  provider_username: string;
  connected_at: string;
}

export default function ConnectAccountsScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);

  useEffect(() => {
    loadConnectedAccounts();
  }, [user]);

  const loadConnectedAccounts = async () => {
    if (!user?.id) return;

    try {
      const { data, error } = await supabase
        .from('connected_accounts')
        .select('*')
        .eq('user_id', user.id);

      if (error) throw error;
      setConnectedAccounts(data || []);
    } catch (error) {
      console.error('Error loading connected accounts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConnectTikTok = async () => {
    setConnecting('tiktok');
    try {
      // For now, show a coming soon message
      Alert.alert(
        'TikTok Connection',
        'TikTok integration is coming soon! To enable it:\n\n1. Get TikTok API credentials\n2. Add them to your .env file\n3. Complete OAuth setup',
        [{ text: 'OK' }]
      );
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to connect TikTok');
    } finally {
      setConnecting(null);
    }
  };

  const handleConnectInstagram = async () => {
    setConnecting('instagram');
    try {
      Alert.alert(
        'Instagram Connection',
        'Instagram integration is coming soon! To enable it:\n\n1. Get Instagram API credentials\n2. Add them to your .env file\n3. Complete OAuth setup',
        [{ text: 'OK' }]
      );
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to connect Instagram');
    } finally {
      setConnecting(null);
    }
  };

  const handleConnectYouTube = async () => {
    setConnecting('youtube');
    try {
      Alert.alert(
        'YouTube Connection',
        'YouTube integration is coming soon! To enable it:\n\n1. Get YouTube API credentials\n2. Add them to your .env file\n3. Complete OAuth setup',
        [{ text: 'OK' }]
      );
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to connect YouTube');
    } finally {
      setConnecting(null);
    }
  };

  const handleDisconnect = async (accountId: string, provider: string) => {
    Alert.alert(
      'Disconnect Account',
      `Are you sure you want to disconnect your ${provider} account?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('connected_accounts')
                .delete()
                .eq('id', accountId);

              if (error) throw error;

              Alert.alert('Success', `${provider} disconnected`);
              loadConnectedAccounts();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to disconnect');
            }
          }
        }
      ]
    );
  };

  const isConnected = (provider: string) => {
    return connectedAccounts.some(acc => acc.provider === provider);
  };

  const getConnectedAccount = (provider: string) => {
    return connectedAccounts.find(acc => acc.provider === provider);
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00ff88" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Connect Accounts</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <Text style={styles.description}>
            Connect your social media accounts to cross-post content and grow your audience
          </Text>

          {/* TikTok */}
          <View style={styles.accountCard}>
            <View style={styles.accountHeader}>
              <View style={styles.accountIcon}>
                <MaterialCommunityIcons name="music-note" size={28} color="#000" />
              </View>
              <View style={styles.accountInfo}>
                <Text style={styles.accountName}>TikTok</Text>
                {isConnected('tiktok') ? (
                  <Text style={styles.accountStatus}>
                    @{getConnectedAccount('tiktok')?.provider_username}
                  </Text>
                ) : (
                  <Text style={styles.accountStatusDisconnected}>Not connected</Text>
                )}
              </View>
            </View>

            {isConnected('tiktok') ? (
              <TouchableOpacity
                style={styles.disconnectButton}
                onPress={() => handleDisconnect(getConnectedAccount('tiktok')!.id, 'TikTok')}
              >
                <Text style={styles.disconnectButtonText}>Disconnect</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.connectButton}
                onPress={handleConnectTikTok}
                disabled={connecting === 'tiktok'}
              >
                {connecting === 'tiktok' ? (
                  <ActivityIndicator color="#000" size="small" />
                ) : (
                  <Text style={styles.connectButtonText}>Connect</Text>
                )}
              </TouchableOpacity>
            )}
          </View>

          {/* Instagram */}
          <View style={styles.accountCard}>
            <View style={styles.accountHeader}>
              <View style={[styles.accountIcon, { backgroundColor: '#E4405F' }]}>
                <Ionicons name="logo-instagram" size={28} color="#fff" />
              </View>
              <View style={styles.accountInfo}>
                <Text style={styles.accountName}>Instagram</Text>
                {isConnected('instagram') ? (
                  <Text style={styles.accountStatus}>
                    @{getConnectedAccount('instagram')?.provider_username}
                  </Text>
                ) : (
                  <Text style={styles.accountStatusDisconnected}>Not connected</Text>
                )}
              </View>
            </View>

            {isConnected('instagram') ? (
              <TouchableOpacity
                style={styles.disconnectButton}
                onPress={() => handleDisconnect(getConnectedAccount('instagram')!.id, 'Instagram')}
              >
                <Text style={styles.disconnectButtonText}>Disconnect</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.connectButton}
                onPress={handleConnectInstagram}
                disabled={connecting === 'instagram'}
              >
                {connecting === 'instagram' ? (
                  <ActivityIndicator color="#000" size="small" />
                ) : (
                  <Text style={styles.connectButtonText}>Connect</Text>
                )}
              </TouchableOpacity>
            )}
          </View>

          {/* YouTube */}
          <View style={styles.accountCard}>
            <View style={styles.accountHeader}>
              <View style={[styles.accountIcon, { backgroundColor: '#FF0000' }]}>
                <Ionicons name="logo-youtube" size={28} color="#fff" />
              </View>
              <View style={styles.accountInfo}>
                <Text style={styles.accountName}>YouTube</Text>
                {isConnected('youtube') ? (
                  <Text style={styles.accountStatus}>
                    {getConnectedAccount('youtube')?.provider_username}
                  </Text>
                ) : (
                  <Text style={styles.accountStatusDisconnected}>Not connected</Text>
                )}
              </View>
            </View>

            {isConnected('youtube') ? (
              <TouchableOpacity
                style={styles.disconnectButton}
                onPress={() => handleDisconnect(getConnectedAccount('youtube')!.id, 'YouTube')}
              >
                <Text style={styles.disconnectButtonText}>Disconnect</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.connectButton}
                onPress={handleConnectYouTube}
                disabled={connecting === 'youtube'}
              >
                {connecting === 'youtube' ? (
                  <ActivityIndicator color="#000" size="small" />
                ) : (
                  <Text style={styles.connectButtonText}>Connect</Text>
                )}
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.infoBox}>
            <Ionicons name="information-circle" size={24} color="#00ff88" />
            <Text style={styles.infoText}>
              Connected accounts allow you to easily cross-post your content to multiple platforms.
              You can disconnect at any time.
            </Text>
          </View>

          <View style={styles.setupBox}>
            <Text style={styles.setupTitle}>🚀 To Enable OAuth Connections:</Text>
            <Text style={styles.setupStep}>1. Create OAuth apps on TikTok, Instagram, and YouTube</Text>
            <Text style={styles.setupStep}>2. Add credentials to your .env file</Text>
            <Text style={styles.setupStep}>3. Uncomment import statements in this file</Text>
            <Text style={styles.setupStep}>4. Configure deep linking in app.json</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  content: {
    padding: 20,
  },
  description: {
    fontSize: 14,
    color: '#888',
    marginBottom: 24,
    lineHeight: 20,
  },
  accountCard: {
    backgroundColor: '#0a0a0a',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  accountHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  accountIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#00ff88',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  accountStatus: {
    fontSize: 13,
    color: '#00ff88',
  },
  accountStatusDisconnected: {
    fontSize: 13,
    color: '#666',
  },
  connectButton: {
    backgroundColor: '#00ff88',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
  },
  connectButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
  },
  disconnectButton: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ff4444',
    minWidth: 100,
    alignItems: 'center',
  },
  disconnectButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ff4444',
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: '#0a0a0a',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#00ff88',
    marginTop: 24,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: '#ccc',
    lineHeight: 18,
    marginLeft: 12,
  },
  setupBox: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  setupTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#00ff88',
    marginBottom: 12,
  },
  setupStep: {
    fontSize: 13,
    color: '#999',
    marginBottom: 8,
    paddingLeft: 8,
  },
}); 
	
