// app/(tabs)/marketplace/order/[id].tsx
// ✅ File 404 FIXED — signed URLs always used
// ✅ Translations added via useTranslation()

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, TextInput, Image, Linking,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../../../config/supabase'; 
import { useAuthStore } from '../../../store/authStore'; 
import { useTranslation } from '../../../locales/LanguageContext'; 

const STATUS_CONFIG: Record<string, { color: string; label: string; emoji: string }> = {
  pending:   { color: '#ffd700', label: 'Waiting for seller to start', emoji: '⏳' },
  active:    { color: '#00bfff', label: 'Seller is working on it',     emoji: '🔨' },
  delivered: { color: '#00ff88', label: 'Delivery ready — review it',  emoji: '📦' },
  completed: { color: '#00ff88', label: 'Order completed',             emoji: '✅' },
  disputed:  { color: '#ff4d4d', label: 'Under dispute review',        emoji: '⚠️' },
  cancelled: { color: '#666',    label: 'Order cancelled',             emoji: '❌' },
};

const BUCKET = 'marketplace-files';

function extractStoragePath(value: string): string {
  if (!value) return '';
  if (!value.startsWith('http')) {
    const prefix = `${BUCKET}/`;
    return value.startsWith(prefix) ? value.slice(prefix.length) : value;
  }
  const patterns = [`/object/public/${BUCKET}/`, `/object/sign/${BUCKET}/`, `/object/authenticated/${BUCKET}/`];
  for (const p of patterns) {
    const idx = value.indexOf(p);
    if (idx !== -1) return value.slice(idx + p.length).split('?')[0];
  }
  return value;
}

async function getSignedUrl(storedValue: string): Promise<string> {
  if (!storedValue) throw new Error('No file path provided');
  const path = extractStoragePath(storedValue);
  if (!path) throw new Error('Could not extract storage path from: ' + storedValue);
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error(error?.message || `Could not create signed URL for path: ${path}.`);
  return data.signedUrl;
}

function isImageFile(value: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(value);
}

export default function OrderDetailScreen() {
  const router   = useRouter();
  const { id }   = useLocalSearchParams<{ id: string }>();
  const { user } = useAuthStore();
  const { t }    = useTranslation();

  const [order,         setOrder]         = useState<any>(null);
  const [listing,       setListing]       = useState<any>(null);
  const [loading,       setLoading]       = useState(true);
  const [note,          setNote]          = useState('');
  const [acting,        setActing]        = useState(false);
  const [uploading,     setUploading]     = useState(false);
  const [deliveryFiles, setDeliveryFiles] = useState<string[]>([]);
  const [accessUrls,    setAccessUrls]    = useState<Record<number, string>>({});

  useEffect(() => { if (id) loadOrder(); }, [id]);

  const loadOrder = async () => {
    try {
      const { data: orderData, error } = await supabase
        .from('marketplace_orders')
        .select('*, buyer:users!marketplace_orders_buyer_id_fkey(id, username, display_name, avatar_url), seller:users!marketplace_orders_seller_id_fkey(id, username, display_name, avatar_url)')
        .eq('id', id).single();
      if (error) throw error;
      setOrder(orderData);
      const files: string[] = orderData.delivery_files || [];
      setDeliveryFiles(files);
      prefetchSignedUrls(files);
      const { data: listingData } = await supabase.from('marketplace_listings')
        .select('title, price_coins, delivery_days, portfolio_urls, orders_count').eq('id', orderData.listing_id).single();
      setListing(listingData);
    } catch (e: any) { Alert.alert(t.errors.generic, e.message); }
    finally { setLoading(false); }
  };

  const prefetchSignedUrls = async (files: string[]) => {
    const results: Record<number, string> = {};
    await Promise.all(files.map(async (f, i) => {
      try { results[i] = await getSignedUrl(f); } catch { results[i] = ''; }
    }));
    setAccessUrls(results);
  };

  const isBuyer  = user?.id === order?.buyer_id;
  const isSeller = user?.id === order?.seller_id;

  const uploadToStorage = async (uri: string, fileName: string, mimeType: string): Promise<string> => {
    const base64      = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const storagePath = `orders/${id}/${fileName}`;
    const { error }   = await supabase.storage.from(BUCKET).upload(storagePath, decode(base64), { contentType: mimeType, upsert: false });
    if (error) throw error;
    return storagePath;
  };

  const saveFilesToOrder = async (newFiles: string[]) => {
    await supabase.from('marketplace_orders').update({ delivery_files: newFiles }).eq('id', id);
    setDeliveryFiles(newFiles);
    prefetchSignedUrls(newFiles);
  };

  const handleUploadImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.9 });
      if (!result.canceled && result.assets[0]) {
        setUploading(true);
        const asset    = result.assets[0];
        const fileExt  = asset.uri.split('.').pop()?.toLowerCase() || 'jpg';
        const fileName = `${Date.now()}.${fileExt}`;
        const mime     = asset.type === 'video' ? `video/${fileExt}` : `image/${fileExt}`;
        const path     = await uploadToStorage(asset.uri, fileName, mime);
        await saveFilesToOrder([...deliveryFiles, path]);
      }
    } catch (e: any) { Alert.alert(t.errors.uploadFailed, e.message); }
    finally { setUploading(false); }
  };

  const handleUploadDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (!result.canceled && result.assets[0]) {
        setUploading(true);
        const asset    = result.assets[0];
        const fileName = `${Date.now()}-${asset.name}`;
        const mime     = asset.mimeType || 'application/octet-stream';
        const path     = await uploadToStorage(asset.uri, fileName, mime);
        await saveFilesToOrder([...deliveryFiles, path]);
      }
    } catch (e: any) { Alert.alert(t.errors.uploadFailed, e.message); }
    finally { setUploading(false); }
  };

  const handleRemoveFile = async (index: number) => {
    Alert.alert('Remove File', 'Remove this file from the delivery?', [
      { text: t.common.cancel, style: 'cancel' },
      { text: t.common.delete, style: 'destructive', onPress: async () => {
        const updated = deliveryFiles.filter((_, i) => i !== index);
        await saveFilesToOrder(updated);
      }},
    ]);
  };

  const handleOpenFile = async (index: number) => {
    try {
      const storedValue = deliveryFiles[index];
      const url = await getSignedUrl(storedValue);
      const canOpen = await Linking.canOpenURL(url).catch(() => false);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        Alert.alert('Cannot Open', 'Your device cannot open this file type directly.', [
          { text: t.common.ok },
          { text: 'Copy Link', onPress: () => Alert.alert('Link', url) },
        ]);
      }
    } catch (e: any) {
      Alert.alert(t.errors.loadFailed, 'This file could not be accessed.\n\n' + e.message);
    }
  };

  const handleMarkDelivered = async () => {
    if (deliveryFiles.length === 0 && !note.trim()) {
      Alert.alert('Required', 'Please upload at least one file or add a delivery note before marking as delivered.');
      return;
    }
    setActing(true);
    try {
      await supabase.from('marketplace_orders').update({
        status: 'delivered', delivery_note: note, delivery_files: deliveryFiles, delivered_at: new Date().toISOString(),
      }).eq('id', id);
      await supabase.from('notifications').insert({
        user_id: order.buyer_id, from_user_id: user!.id, type: 'marketplace',
        title: '📦 Order Delivered!',
        message: `Your order "${listing?.title}" has been delivered. Tap to review and accept.`,
        is_read: false,
      });
      Alert.alert('Delivered! ✅', 'The buyer has been notified to review your delivery.');
      loadOrder();
    } catch (e: any) { Alert.alert(t.errors.generic, e.message); }
    finally { setActing(false); }
  };

  const handleComplete = async () => {
    Alert.alert('Accept Delivery ✅', 'Happy with the delivery? This will release payment to the seller.', [
      { text: t.common.cancel, style: 'cancel' },
      { text: 'Accept & Pay', onPress: async () => {
        setActing(true);
        try {
          const fee    = Math.floor(order.price_coins * 0.10);
          const payout = order.price_coins - fee;
          const { data: sellerData } = await supabase.from('users').select('marketplace_coins').eq('id', order.seller_id).single();
          await supabase.from('users').update({ marketplace_coins: (sellerData?.marketplace_coins || 0) + payout }).eq('id', order.seller_id);
          await supabase.from('marketplace_orders').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', id);
          if (listing) await supabase.from('marketplace_listings').update({ orders_count: (listing.orders_count || 0) + 1 }).eq('id', order.listing_id);
          await supabase.from('notifications').insert({
            user_id: order.seller_id, from_user_id: user!.id, type: 'marketplace',
            title: '💰 Payment Released!',
            message: `${payout} coins sent to your wallet (10% platform fee applied).`,
            is_read: false,
          });
          Alert.alert('Order Complete! 🎉', `${payout} coins paid to seller.`, [
            { text: t.common.ok, onPress: () => router.push('/(tabs)/marketplace/orders') },
          ]);
        } catch (e: any) { Alert.alert(t.errors.generic, e.message); }
        finally { setActing(false); }
      }},
    ]);
  };

  const handleDispute = async () => {
    Alert.alert('Open Dispute ⚠️', 'Use this only if the seller did not deliver what was promised. Our team will review.', [
      { text: t.common.cancel, style: 'cancel' },
      { text: 'Open Dispute', style: 'destructive', onPress: async () => {
        await supabase.from('marketplace_orders').update({ status: 'disputed' }).eq('id', id);
        loadOrder();
      }},
    ]);
  };

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color="#00ff88" /></View>;
  if (!order)  return <View style={s.center}><Text style={{ color: '#fff' }}>Order not found</Text></View>;

  const statusCfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}><Feather name="arrow-left" size={24} color="#fff" /></TouchableOpacity>
        <Text style={s.headerTitle}>Order Details</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        <View style={[s.statusCard, { borderColor: statusCfg.color }]}>
          <Text style={s.statusEmoji}>{statusCfg.emoji}</Text>
          <View>
            <Text style={[s.statusText, { color: statusCfg.color }]}>{order.status?.toUpperCase()}</Text>
            <Text style={s.statusSub}>{statusCfg.label}</Text>
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardSectionTitle}>Service</Text>
          <Text style={s.cardValue}>{listing?.title || '—'}</Text>
          <View style={s.infoRow}>
            <View style={s.infoItem}>
              <Text style={s.infoLabel}>{t.marketplace.price}</Text>
              <Text style={[s.infoValue, { color: '#00ff88' }]}>{order.price_coins} 🪙</Text>
            </View>
            <View style={s.infoItem}>
              <Text style={s.infoLabel}>Deadline</Text>
              <Text style={s.infoValue}>{order.deadline ? new Date(order.deadline).toLocaleDateString() : '—'}</Text>
            </View>
            <View style={s.infoItem}>
              <Text style={s.infoLabel}>Kinst Fee</Text>
              <Text style={[s.infoValue, { color: '#ff6b6b' }]}>10%</Text>
            </View>
          </View>
        </View>

        <View style={s.card}>
          <View style={s.partyRow}>
            <View style={s.partyInfo}>
              <Text style={s.partyRole}>👤 Buyer</Text>
              <Text style={s.partyName}>{order.buyer?.display_name}</Text>
              <Text style={s.partyUsername}>@{order.buyer?.username}</Text>
            </View>
            <View style={s.partySep} />
            <View style={s.partyInfo}>
              <Text style={s.partyRole}>🛠 Seller</Text>
              <Text style={s.partyName}>{order.seller?.display_name}</Text>
              <Text style={s.partyUsername}>@{order.seller?.username}</Text>
            </View>
          </View>
        </View>

        {deliveryFiles.length > 0 && (
          <View style={s.card}>
            <Text style={s.cardSectionTitle}>📦 {t.marketplace.deliveryFiles}</Text>
            <Text style={s.cardHint}>Tap any file to open / download it</Text>
            <View style={s.filesGrid}>
              {deliveryFiles.map((storedValue, i) => {
                const previewUrl = accessUrls[i] || '';
                const isImg      = isImageFile(storedValue);
                return (
                  <View key={i} style={s.fileItem}>
                    {isImg ? (
                      <TouchableOpacity onPress={() => handleOpenFile(i)} activeOpacity={0.8}>
                        {previewUrl
                          ? <Image source={{ uri: previewUrl }} style={s.fileThumb} onError={() => prefetchSignedUrls(deliveryFiles)} />
                          : <View style={[s.fileThumb, s.filePlaceholder]}><ActivityIndicator size="small" color="#00ff88" /></View>}
                        <Text style={s.fileLabel}>Image {i + 1}</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity style={s.fileDoc} onPress={() => handleOpenFile(i)} activeOpacity={0.8}>
                        <Feather name="file" size={28} color="#00ff88" />
                        <Text style={s.fileLabel}>File {i + 1}</Text>
                        <Text style={s.fileOpen}>Tap to open</Text>
                      </TouchableOpacity>
                    )}
                    {isSeller && order.status !== 'completed' && (
                      <TouchableOpacity style={s.fileRemove} onPress={() => handleRemoveFile(i)}>
                        <Feather name="x" size={12} color="#fff" />
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {order.delivery_note ? (
          <View style={s.card}>
            <Text style={s.cardSectionTitle}>📝 Seller's Delivery Note</Text>
            <Text style={s.noteText}>{order.delivery_note}</Text>
          </View>
        ) : null}

        {isSeller && (order.status === 'pending' || order.status === 'active') && (
          <View style={s.card}>
            <Text style={s.cardSectionTitle}>📤 Upload Your Delivery</Text>
            <Text style={s.cardHint}>Upload the completed work here. The buyer will be notified and can download the files.</Text>
            <View style={s.uploadBtns}>
              <TouchableOpacity style={s.uploadBtn} onPress={handleUploadImage} disabled={uploading}>
                {uploading
                  ? <ActivityIndicator size="small" color="#00ff88" />
                  : <><Feather name="image" size={18} color="#00ff88" /><Text style={s.uploadBtnText}>Image / Video</Text></>}
              </TouchableOpacity>
              <TouchableOpacity style={s.uploadBtn} onPress={handleUploadDocument} disabled={uploading}>
                {uploading
                  ? <ActivityIndicator size="small" color="#00ff88" />
                  : <><Feather name="file" size={18} color="#00ff88" /><Text style={s.uploadBtnText}>File / Doc</Text></>}
              </TouchableOpacity>
            </View>
            {deliveryFiles.length > 0 && <Text style={s.uploadCount}>✅ {deliveryFiles.length} file(s) uploaded</Text>}
            <Text style={[s.cardSectionTitle, { marginTop: 16 }]}>Add a note for buyer (optional)</Text>
            <TextInput
              style={s.noteInput}
              placeholder="E.g. Here is your logo in PNG and SVG format."
              placeholderTextColor="#555"
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={4}
            />
            <TouchableOpacity style={[s.deliverBtn, acting && { opacity: 0.6 }]} onPress={handleMarkDelivered} disabled={acting}>
              {acting ? <ActivityIndicator size="small" color="#000" /> : <Text style={s.deliverBtnText}>📦 Mark as Delivered</Text>}
            </TouchableOpacity>
          </View>
        )}

        {isBuyer && order.status === 'delivered' && (
          <View style={s.card}>
            <Text style={s.cardSectionTitle}>Review Delivery</Text>
            <Text style={s.cardHint}>Happy with the work? Accept to release payment. If there's an issue, open a dispute.</Text>
            <TouchableOpacity style={[s.acceptBtn, acting && { opacity: 0.6 }]} onPress={handleComplete} disabled={acting}>
              {acting ? <ActivityIndicator size="small" color="#000" /> : <Text style={s.acceptBtnText}>✅ Accept & Release Payment</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[s.disputeBtn, acting && { opacity: 0.6 }]} onPress={handleDispute} disabled={acting}>
              <Text style={s.disputeBtnText}>⚠️ Open Dispute</Text>
            </TouchableOpacity>
          </View>
        )}

        {order.status === 'completed' && (
          <View style={[s.card, { borderColor: '#00ff88', borderWidth: 1 }]}>
            <Text style={{ color: '#00ff88', fontSize: 16, fontWeight: 'bold', textAlign: 'center' }}>🎉 Order Successfully Completed</Text>
            <Text style={{ color: '#666', fontSize: 13, textAlign: 'center', marginTop: 8 }}>
              {order.completed_at ? `Completed on ${new Date(order.completed_at).toLocaleDateString()}` : ''}
            </Text>
          </View>
        )}

      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#000' },
  center:           { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  header:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  headerTitle:      { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  scroll:           { padding: 16, paddingBottom: 60 },
  statusCard:       { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 14, borderWidth: 2, padding: 16, marginBottom: 14, backgroundColor: '#0a0a0a' },
  statusEmoji:      { fontSize: 32 },
  statusText:       { fontSize: 15, fontWeight: 'bold', letterSpacing: 1 },
  statusSub:        { color: '#888', fontSize: 12, marginTop: 3 },
  card:             { backgroundColor: '#111', borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: '#1a1a1a' },
  cardSectionTitle: { color: '#fff', fontSize: 13, fontWeight: '700', marginBottom: 6 },
  cardValue:        { color: '#aaa', fontSize: 14, marginBottom: 12 },
  cardHint:         { color: '#555', fontSize: 12, marginBottom: 12, lineHeight: 17 },
  infoRow:          { flexDirection: 'row', gap: 8 },
  infoItem:         { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 10, padding: 10, alignItems: 'center' },
  infoLabel:        { color: '#666', fontSize: 10, marginBottom: 4 },
  infoValue:        { color: '#fff', fontSize: 13, fontWeight: '700' },
  partyRow:         { flexDirection: 'row', alignItems: 'center' },
  partyInfo:        { flex: 1 },
  partySep:         { width: 1, height: 50, backgroundColor: '#222', marginHorizontal: 16 },
  partyRole:        { color: '#666', fontSize: 11, marginBottom: 4 },
  partyName:        { color: '#fff', fontSize: 14, fontWeight: '600' },
  partyUsername:    { color: '#666', fontSize: 12, marginTop: 2 },
  filesGrid:        { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  fileItem:         { position: 'relative' },
  fileThumb:        { width: 90, height: 90, borderRadius: 10, backgroundColor: '#1a1a1a' },
  filePlaceholder:  { justifyContent: 'center', alignItems: 'center' },
  fileDoc:          { width: 90, height: 90, borderRadius: 10, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#00ff8855', justifyContent: 'center', alignItems: 'center', gap: 4 },
  fileLabel:        { color: '#888', fontSize: 10, marginTop: 4, textAlign: 'center' },
  fileOpen:         { color: '#00ff88', fontSize: 9 },
  fileRemove:       { position: 'absolute', top: -6, right: -6, backgroundColor: '#ff4d4d', borderRadius: 10, width: 20, height: 20, justifyContent: 'center', alignItems: 'center' },
  noteText:         { color: '#aaa', fontSize: 14, lineHeight: 20 },
  uploadBtns:       { flexDirection: 'row', gap: 10, marginBottom: 12 },
  uploadBtn:        { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#00ff8844' },
  uploadBtnText:    { color: '#00ff88', fontSize: 13, fontWeight: '600' },
  uploadCount:      { color: '#00ff88', fontSize: 12, marginBottom: 8 },
  noteInput:        { backgroundColor: '#1a1a1a', borderRadius: 10, borderWidth: 1, borderColor: '#333', color: '#fff', fontSize: 14, padding: 14, minHeight: 100, textAlignVertical: 'top', marginBottom: 14 },
  deliverBtn:       { backgroundColor: '#00ff88', padding: 16, borderRadius: 12, alignItems: 'center' },
  deliverBtnText:   { color: '#000', fontWeight: 'bold', fontSize: 15 },
  acceptBtn:        { backgroundColor: '#00ff88', padding: 16, borderRadius: 12, alignItems: 'center', marginBottom: 10 },
  acceptBtnText:    { color: '#000', fontWeight: 'bold', fontSize: 15 },
  disputeBtn:       { backgroundColor: '#1a0a0a', padding: 16, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#ff4d4d44' },
  disputeBtnText:   { color: '#ff6b6b', fontWeight: '600', fontSize: 15 },
}); 
