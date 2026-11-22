// src/components/ProfilePhotoViewer.tsx
//
// Tap a profile picture → it opens BIG, full screen (pinch to zoom on iPhone).
// If the person has no picture it shows a large circle with the first letter.
import React from 'react';
import { Dimensions, Image, Modal, Platform, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function ProfilePhotoViewer({ visible, uri, name, letter, onClose }: {
  visible: boolean; uri?: string | null; name?: string; letter?: string; onClose: () => void;
}) {
  const { width, height } = Dimensions.get('window');
  const top = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 8 : 54;
  const first = String(letter || name || 'U').charAt(0).toUpperCase();
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        <TouchableOpacity activeOpacity={1} style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.top, { paddingTop: top }]} pointerEvents="box-none">
          <TouchableOpacity onPress={onClose} style={styles.close} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.name} numberOfLines={1}>{name || ''}</Text>
          <View style={{ width: 40 }} />
        </View>
        {uri ? (
          <ScrollView maximumZoomScale={4} minimumZoomScale={1} centerContent
            showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}
            contentContainerStyle={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
            <Image source={{ uri }} style={{ width, height: width }} resizeMode="contain" />
          </ScrollView>
        ) : (
          <View style={styles.center} pointerEvents="none">
            <View style={styles.bigCircle}><Text style={styles.bigLetter}>{first}</Text></View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'rgba(0,0,0,0.96)' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingBottom: 10, zIndex: 5 },
  close: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  name: { flex: 1, color: '#fff', fontSize: 17, fontWeight: '700', textAlign: 'center', marginHorizontal: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bigCircle: { width: 220, height: 220, borderRadius: 110, borderWidth: 3, borderColor: '#00ff88', backgroundColor: '#0b1f14', alignItems: 'center', justifyContent: 'center' },
  bigLetter: { color: '#00ff88', fontSize: 96, fontWeight: '800' },
});
