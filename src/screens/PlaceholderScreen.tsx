// Temporary placeholder for screens not yet built
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export function PlaceholderScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Coming Soon</Text>
    </View>
  );
}

export default PlaceholderScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A1A', justifyContent: 'center', alignItems: 'center' },
  text:      { color: '#888', fontSize: 18, fontWeight: '600' },
});