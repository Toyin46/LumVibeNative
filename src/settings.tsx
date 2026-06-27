// app/settings.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from './store/authStore'; 
import { supabase } from './config/supabase'; 
import {
  connectTikTok,
  disconnectTikTok,
  checkTikTokConnection,
} from './lib/tiktok-oauth';
import {
  connectInstagram,
  disconnectInstagram,
  checkInstagramConnection,
} from './lib/instagram-oauth';
import {
  connectYouTube,
  disconnectYouTube,
  checkYouTubeConnection,
} from './lib/youtube-oauth';

export default function SettingsScreen() {
  const router = useRouter();
  const { user, signOut } = useAuthStore();

  const [loading, setLoading] = useState(true);
  const [tiktokConnected, setTiktokConnected] = useState(false);
  const [instagramConnected, setInstagramConnected] = useState(false);
  const [youtubeConnected, setYoutubeConnected] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  useEffect(() => {
    checkConnections();
  }, []);

  const checkConnections = async () => {
    if (!user) return;

    try {
      const [tiktok, instagram, youtube] = await Promise.all([
        checkTikTokConnection(user.id),
        checkInstagramConnection(user.id),
        checkYouTubeConnection(user.id),
      ]);

      setTiktokConnected(tiktok);
      setInstagramConnected(instagram);
      setYoutubeConnected(youtube);
    } catch (error) {
      console.error('Error checking connections:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTikTokConnect = async () => {
    if (tiktokConnected) {
      Alert.alert('Disconnect TikTok', 'Are you sure you want to disconnect?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await disconnectTikTok(user!.id);
            setTiktokConnected(false);
          },
        },
      ]);
    } else {
      try {
        const authUrl = await connectTikTok(user!.id);
        // Open auth URL
        Alert.alert('TikTok', 'Opening TikTok authorization...');
      } catch (error: any) {
        Alert.alert('Error', error.message);
      }
    }
  };

  const handleInstagramConnect = async () => {
    if (instagramConnected) {
      Alert.alert('Disconnect Instagram', 'Are you sure?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await disconnectInstagram(user!.id);
            setInstagramConnected(false);
          },
        },
      ]);
    } else {
      try {
        const authUrl = await connectInstagram(user!.id);
        Alert.alert('Instagram', 'Opening Instagram authorization...');
      } catch (error: any) {
        Alert.alert('Error', error.message);
      }
    }
  };

  const handleYouTubeConnect = async () => {
    if (youtubeConnected) {
      Alert.alert('Disconnect YouTube', 'Are you sure?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await disconnectYouTube(user!.id);
            setYoutubeConnected(false);
          },
        },
      ]);
    } else {
      try {
        const authUrl = await connectYouTube(user!.id);
        Alert.alert('YouTube', 'Opening YouTube authorization...');
      } catch (error: any) {
        Alert.alert('Error', error.message);
      }
    }
  };

  const handleSignOut = async () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/');
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Settings</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.centerContainer}>
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
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Account Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>

          <TouchableOpacity style={styles.item} onPress={() => router.push('./edit-profile')}>
            <View style={styles.itemLeft}>
              <Ionicons name="person-outline" size={22} color="#00ff88" />
              <Text style={styles.itemText}>Edit Profile</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#666" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.item} onPress={() => router.push('/privacy-settings')}>
            <View style={styles.itemLeft}>
              <Ionicons name="shield-outline" size={22} color="#00ff88" />
              <Text style={styles.itemText}>Privacy & Security</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#666" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.item} onPress={() => router.push('./blocked-users')}>
            <View style={styles.itemLeft}>
              <Ionicons name="ban-outline" size={22} color="#00ff88" />
              <Text style={styles.itemText}>Blocked Users</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#666" />
          </TouchableOpacity>
        </View>

        {/* Connect Accounts Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Connect Accounts</Text>

          <TouchableOpacity style={styles.item} onPress={handleTikTokConnect}>
            <View style={styles.itemLeft}>
              <Ionicons name="logo-tiktok" size={22} color="#00ff88" />
              <Text style={styles.itemText}>TikTok</Text>
            </View>
            <View style={styles.connectionStatus}>
              {tiktokConnected && <Text style={styles.connectedText}>Connected</Text>}
              <Ionicons
                name={tiktokConnected ? 'checkmark-circle' : 'add-circle-outline'}
                size={22}
                color={tiktokConnected ? '#00ff88' : '#666'}
              />
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.item} onPress={handleInstagramConnect}>
            <View style={styles.itemLeft}>
              <Ionicons name="logo-instagram" size={22} color="#00ff88" />
              <Text style={styles.itemText}>Instagram</Text>
            </View>
            <View style={styles.connectionStatus}>
              {instagramConnected && <Text style={styles.connectedText}>Connected</Text>}
              <Ionicons
                name={instagramConnected ? 'checkmark-circle' : 'add-circle-outline'}
                size={22}
                color={instagramConnected ? '#00ff88' : '#666'}
              />
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.item} onPress={handleYouTubeConnect}>
            <View style={styles.itemLeft}>
              <Ionicons name="logo-youtube" size={22} color="#00ff88" />
              <Text style={styles.itemText}>YouTube</Text>
            </View>
            <View style={styles.connectionStatus}>
              {youtubeConnected && <Text style={styles.connectedText}>Connected</Text>}
              <Ionicons
                name={youtubeConnected ? 'checkmark-circle' : 'add-circle-outline'}
                size={22}
                color={youtubeConnected ? '#00ff88' : '#666'}
              />
            </View>
          </TouchableOpacity>
        </View>

        {/* Notifications Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notifications</Text>

          <View style={styles.item}>
            <View style={styles.itemLeft}>
              <Ionicons name="notifications-outline" size={22} color="#00ff88" />
              <Text style={styles.itemText}>Push Notifications</Text>
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={setNotificationsEnabled}
              trackColor={{ false: '#333', true: '#00ff88' }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* Help & Support */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Help & Support</Text>

          <TouchableOpacity style={styles.item}>
            <View style={styles.itemLeft}>
              <Ionicons name="help-circle-outline" size={22} color="#00ff88" />
              <Text style={styles.itemText}>Help Center</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#666" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.item}>
            <View style={styles.itemLeft}>
              <Ionicons name="document-text-outline" size={22} color="#00ff88" />
              <Text style={styles.itemText}>Terms of Service</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#666" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.item}>
            <View style={styles.itemLeft}>
              <Ionicons name="shield-checkmark-outline" size={22} color="#00ff88" />
              <Text style={styles.itemText}>Privacy Policy</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#666" />
          </TouchableOpacity>
        </View>

        {/* Sign Out */}
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Ionicons name="log-out-outline" size={22} color="#ff4444" />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
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
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  section: { paddingHorizontal: 20, marginTop: 24 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  itemLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  itemText: { fontSize: 16, color: '#fff' },
  connectionStatus: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  connectedText: { fontSize: 13, color: '#00ff88' },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginHorizontal: 20,
    marginTop: 32,
    paddingVertical: 16,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ff4444',
  },
  signOutText: { fontSize: 16, fontWeight: '600', color: '#ff4444' },
});