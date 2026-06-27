// app/(auth)/login.tsx - IMPROVED VERSION
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../store/authStore'; 
import { useRouter } from 'expo-router';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const { login } = useAuthStore();
  const router = useRouter();

  const handleLogin = async () => {
    // Validation
    const trimmedEmail = email.trim().toLowerCase();
    
    if (!trimmedEmail) {
      Alert.alert('Error', 'Please enter your email');
      return;
    }

    if (!password) {
      Alert.alert('Error', 'Please enter your password');
      return;
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    setLoading(true);

    try {
      console.log('🔐 Logging in:', trimmedEmail);
      
      await login(trimmedEmail, password);
      
      console.log('✅ Login successful');
      
      // Small delay for smooth transition
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Navigate to home
      router.replace('/(tabs)');
      
    } catch (error: any) {
      console.error('❌ Login error:', error);
      
      let errorTitle = 'Login Failed';
      let errorMessage = 'Unable to log in. Please try again.';
      
      // Handle specific error cases
      if (error.message?.toLowerCase().includes('invalid login credentials')) {
        errorMessage = 'Incorrect email or password. Please check and try again.';
      } else if (error.message?.toLowerCase().includes('email not confirmed')) {
        errorTitle = 'Email Not Confirmed';
        errorMessage = 'Please check your email and confirm your account before logging in.';
      } else if (error.message?.toLowerCase().includes('network')) {
        errorTitle = 'Connection Error';
        errorMessage = 'Please check your internet connection and try again.';
      } else if (error.message) {
        errorMessage = error.message;
      }

      Alert.alert(errorTitle, errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <LinearGradient colors={['#000000', '#1a1a1a']} style={styles.header}>
        <Text style={styles.headerTitle}>Welcome Back</Text>
        <Text style={styles.headerSubtitle}>Log in to continue to </Text>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Email</Text>
            <View style={[
              styles.inputWrapper,
              loading && styles.inputDisabled
            ]}>
              <Ionicons name="mail-outline" size={20} color="#00ff00" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Enter your email"
                placeholderTextColor="#666"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loading}
                returnKeyType="next"
              />
            </View>
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Password</Text>
            <View style={[
              styles.inputWrapper,
              loading && styles.inputDisabled
            ]}>
              <Ionicons name="lock-closed-outline" size={20} color="#00ff00" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Enter your password"
                placeholderTextColor="#666"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loading}
                returnKeyType="go"
                onSubmitEditing={handleLogin}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeIcon}
                disabled={loading}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color="#00ff00"
                />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={[
            styles.loginButton,
            loading && styles.loginButtonDisabled
          ]}
          onPress={handleLogin}
          disabled={loading}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={loading ? ['#333', '#333'] : ['#00ff00', '#00cc00']}
            style={styles.loginButtonGradient}
          >
            {loading ? (
              <>
                <ActivityIndicator color="#000" size="small" />
                <Text style={styles.loginButtonText}>Logging in...</Text>
              </>
            ) : (
              <Text style={styles.loginButtonText}>Log In</Text>
            )}
          </LinearGradient>
        </TouchableOpacity>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Don't have an account? </Text>
          <TouchableOpacity 
            onPress={() => router.push('/(auth)/signup')} 
            disabled={loading}
          >
            <Text style={[
              styles.signupLink,
              loading && styles.linkDisabled
            ]}>
              Sign Up
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    paddingTop: 60,
    paddingBottom: 40,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#00ff00',
    marginBottom: 8,
  },
  headerSubtitle: {
    fontSize: 16,
    color: '#888',
  },
  content: {
    padding: 24,
  },
  form: {
    marginBottom: 24,
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#00ff00',
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    paddingHorizontal: 16,
  },
  inputDisabled: {
    opacity: 0.6,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    paddingVertical: 16,
    fontSize: 16,
    color: '#ffffff',
  },
  eyeIcon: {
    padding: 4,
  },
  loginButton: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 24,
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  loginButtonGradient: {
    paddingVertical: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  loginButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: 'bold',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    color: '#888',
  },
  signupLink: {
    fontSize: 14,
    color: '#00ff00',
    fontWeight: '600',
  },
  linkDisabled: {
    opacity: 0.5,
  },
});