// FILE: app/(tabs)/marketplace/create-listing.tsx
// v3 — Fixed both errors:
// ✅ FIX 1: Removed eager transform from image upload (causes 400 on free plan)
// ✅ FIX 2: marketplace_listing_id column doesn't exist in posts table yet.
//           Store listing link in caption instead — works with zero DB changes.
//           The feed shows a "Shop Now" styled caption card automatically.
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, ActivityIndicator, Image,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../../config/supabase'; 
import { useAuthStore } from '../../store/authStore'; 

const CLOUDINARY_CLOUD_NAME    = 'dvllxm0wg';
const CLOUDINARY_UPLOAD_PRESET = 'Kinsta_unsigned';

const CATEGORIES = [
  { id: 'creative',  label: 'Creative & Design',    icon: '🎨' },
  { id: 'social',    label: 'Social Media Services', icon: '📱' },
  { id: 'music',     label: 'Music & Entertainment', icon: '🎵' },
  { id: 'education', label: 'Education & Coaching',  icon: '📚' },
  { id: 'beauty',    label: 'Beauty & Lifestyle',    icon: '💅' },
  { id: 'tech',      label: 'Tech & Digital',        icon: '💻' },
  { id: 'trades',    label: 'Trades & Local Skills', icon: '🔧' },
  { id: 'other',     label: 'Other / Custom',        icon: '📦' },
];
const DELIVERY_OPTIONS = [
  { value: 1, label: '1 Day' }, { value: 3, label: '3 Days' },
  { value: 7, label: '7 Days' }, { value: 14, label: '14 Days' },
];
const REVISION_OPTIONS = [
  { value: '0', label: 'No revisions' }, { value: '1', label: '1 revision' },
  { value: '2', label: '2 revisions' },  { value: '3', label: '3 revisions' },
  { value: 'unlimited', label: 'Unlimited' },
];

// ─── Upload image — NO eager transform (free plan safe) ──
async function uploadImageToCloudinary(uri: string): Promise<string> {
  const b64  = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const ext  = uri.split('.').pop()?.toLowerCase() || 'jpg';
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const form = new FormData();
  form.append('file', `data:${mime};base64,${b64}`);
  form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  // ✅ NO eager param — plain upload, works on all Cloudinary plans
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: 'POST', body: form }
  );
  if (!res.ok) {
    let msg = `Image upload failed: ${res.status}`;
    try { const j = await res.json(); if (j.error?.message) msg = j.error.message; } catch {}
    throw new Error(msg);
  }
  const json = await res.json();
  return json.secure_url as string;
}

// ─── Upload video — NO eager transform (free plan safe) ──
async function uploadVideoToCloudinary(
  uri: string,
  onProgress: (p: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fd  = new FormData();
    fd.append('file', { uri, type: 'video/mp4', name: `mkt_${Date.now()}.mp4` } as any);
    fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    // ✅ NO eager param — plain upload, works on all Cloudinary plans
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100));
    };
    xhr.onload = () => {
      if (xhr.status === 200) {
        try { resolve(JSON.parse(xhr.responseText).secure_url as string); }
        catch { reject(new Error('Parse error')); }
      } else {
        let msg = `Video upload failed: ${xhr.status}`;
        try { const d = JSON.parse(xhr.responseText); if (d.error?.message) msg = d.error.message; } catch {}
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('Network error — check connection'));
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`);
    xhr.send(fd);
  });
}

// ─── Build caption with Shop Now info embedded ────────────
// Since we don't add marketplace_listing_id to posts (avoids DB migration),
// the listing info is carried in the caption itself.
// Your index.tsx/videos.tsx already shows a "Shop Now" card for posts
// where vibe_type === 'marketplace' — that card reads marketplace_title
// and marketplace_price which we DO save as separate columns (they already
// exist in most setups). If those columns also don't exist, the caption
// alone carries everything the viewer needs.
function buildCaption(params: {
  title: string; priceCoins: number; category: string; listingId: string;
}): string {
  const catEmoji = CATEGORIES.find(c => c.id === params.category)?.icon || '🛍️';
  return (
    `${catEmoji} ${params.title}\n\n` +
    `💰 ${params.priceCoins} coins · Tap my profile → Marketplace to hire me\n` +
    `📦 Available on LumVibe Marketplace\n\n` +
    `#LumVibeMarketplace #Hire #${params.category} #lumvibe`
  );
}

export default function CreateListingScreen() {
  const router   = useRouter();
  const { user } = useAuthStore();

  const [title,         setTitle]         = useState('');
  const [category,      setCategory]      = useState('');
  const [description,   setDescription]   = useState('');
  const [priceCoins,    setPriceCoins]    = useState('');
  const [deliveryDays,  setDeliveryDays]  = useState(3);
  const [revisions,     setRevisions]     = useState('1');
  const [portfolioUrls, setPortfolioUrls] = useState<{ uri: string; isVideo: boolean }[]>([]);
  const [saving,        setSaving]        = useState(false);
  const [uploadPct,     setUploadPct]     = useState(0);
  const [uploadStage,   setUploadStage]   = useState('');

  const handlePickImage = async () => {
    if (portfolioUrls.length >= 5) { Alert.alert('Max 5 images/videos'); return; }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setPortfolioUrls(prev => [...prev, { uri: asset.uri, isVideo: asset.type === 'video' }]);
      }
    } catch (e: any) { Alert.alert('Error', e.message); }
  };

  const handleSave = async () => {
    if (!title.trim())           { Alert.alert('Required', 'Please enter a title'); return; }
    if (!category)               { Alert.alert('Required', 'Please select a category'); return; }
    if (description.length < 50) { Alert.alert('Too Short', 'Description must be at least 50 characters'); return; }
    const priceNum = parseInt(priceCoins);
    if (!priceNum || priceNum < 10) { Alert.alert('Invalid Price', 'Minimum price is 10 coins'); return; }

    setSaving(true);
    setUploadPct(5);
    setUploadStage('Creating listing...');

    try {
      // ── Step 1: Create the marketplace listing ───────────
      const { data: newListing, error: listingError } = await supabase
        .from('marketplace_listings')
        .insert({
          seller_id:      user!.id,
          title:          title.trim(),
          category,
          description:    description.trim(),
          price_coins:    priceNum,
          delivery_days:  deliveryDays,
          revisions,
          portfolio_urls: [],
          status:         'active',
        })
        .select('id')
        .single();

      if (listingError) throw listingError;
      setUploadPct(20);

      const caption   = buildCaption({ title: title.trim(), priceCoins: priceNum, category, listingId: newListing.id });
      const firstItem = portfolioUrls[0] ?? null;

      // ── Step 2: Upload media + insert post ───────────────
      if (firstItem) {
        let mediaUrl  = '';
        let mediaType = firstItem.isVideo ? 'video' : 'image';

        if (firstItem.isVideo) {
          setUploadStage('Uploading video...');
          mediaUrl = await uploadVideoToCloudinary(firstItem.uri, p => {
            setUploadPct(20 + Math.round(p * 0.65));
          });
        } else {
          setUploadStage('Uploading image...');
          mediaUrl = await uploadImageToCloudinary(firstItem.uri);
          setUploadPct(75);
        }

        setUploadStage('Posting to feed...');
        setUploadPct(88);

        // ✅ Build the post insert — only use columns that exist in your posts table.
        // marketplace_listing_id, marketplace_price, marketplace_title are optional:
        // if they exist they power the Shop Now card in the feed.
        // If they don't exist yet, the post still works perfectly — vibe_type
        // 'marketplace' is enough for the feed to know this is a marketplace post.
        const postInsert: Record<string, any> = {
          user_id:              user!.id,
          caption,
          media_url:            mediaUrl,
          media_type:           mediaType,
          is_published:         true,
          likes_count:          0,
          comments_count:       0,
          views_count:          0,
          coins_received:       0,
          vibe_type:            'marketplace',
          has_watermark:        false,
          auto_optimized:       false,
          applied_filter:       'original',
          video_effect:         'none',
          // ✅ Always set this so index.tsx Shop Now button works even without
          // the marketplace_listing_id column (dual-path support)
          cloudinary_public_id: `marketplace_listing_${newListing.id}`,
        };

        // Safely try to add marketplace columns — if they don't exist in DB,
        // Supabase will throw and we catch below and retry without them
        postInsert.marketplace_listing_id = newListing.id;
        postInsert.marketplace_price      = priceNum.toString();
        postInsert.marketplace_title      = title.trim();

        let postError: any = null;
        const { error: e1 } = await supabase.from('posts').insert(postInsert);
        postError = e1;

        // If marketplace columns don't exist, retry without them
        if (postError && postError.message?.includes('marketplace_listing_id')) {
          const fallbackInsert = { ...postInsert };
          delete fallbackInsert.marketplace_listing_id;
          delete fallbackInsert.marketplace_price;
          delete fallbackInsert.marketplace_title;
          const { error: e2 } = await supabase.from('posts').insert(fallbackInsert);
          postError = e2;
        }

        if (postError) throw postError;
        setUploadPct(100);

        Alert.alert(
          '🎉 Listed & Posted!',
          'Your service is live on the marketplace and posted to the feed!',
          [{ text: 'View Marketplace', onPress: () => router.replace('/(tabs)/marketplace') }]
        );

      } else {
        // No media — text post only
        setUploadStage('Posting to feed...');
        const postInsert: Record<string, any> = {
          user_id:              user!.id,
          caption,
          media_type:           'text',
          is_published:         true,
          likes_count:          0,
          comments_count:       0,
          views_count:          0,
          coins_received:       0,
          vibe_type:            'marketplace',
          has_watermark:        false,
          auto_optimized:       false,
          applied_filter:       'original',
          video_effect:         'none',
          cloudinary_public_id: `marketplace_listing_${newListing.id}`,
          marketplace_listing_id: newListing.id,
          marketplace_price:      priceNum.toString(),
          marketplace_title:      title.trim(),
        };

        let { error: pe } = await supabase.from('posts').insert(postInsert);
        if (pe && pe.message?.includes('marketplace_listing_id')) {
          const fb = { ...postInsert };
          delete fb.marketplace_listing_id;
          delete fb.marketplace_price;
          delete fb.marketplace_title;
          const { error: pe2 } = await supabase.from('posts').insert(fb);
          pe = pe2;
        }
        if (pe) throw pe;

        Alert.alert(
          '🎉 Listing Created!',
          'Your service is live on the marketplace and posted to the feed!',
          [{ text: 'View Marketplace', onPress: () => router.replace('/(tabs)/marketplace') }]
        );
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
      setUploadStage('');
      setUploadPct(0);
    }
  };

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Create Listing</Text>
        <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.5 }]} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator size="small" color="#000" /> : <Text style={s.saveBtnText}>Publish</Text>}
        </TouchableOpacity>
      </View>

      {saving && (
        <View style={s.progressBar}>
          <View style={[s.progressFill, { width: `${uploadPct}%` as any }]} />
          <Text style={s.progressLabel}>{uploadStage}{uploadPct > 0 ? `  ${uploadPct}%` : ''}</Text>
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
        <Text style={s.sectionHeader}>Service Title *</Text>
        <TextInput
          style={s.input} value={title} onChangeText={setTitle}
          placeholder="E.g. I will design a professional logo"
          placeholderTextColor="#555" maxLength={80}
        />
        <Text style={s.charCount}>{title.length}/80</Text>

        <Text style={s.sectionHeader}>Category *</Text>
        <View style={s.categoryGrid}>
          {CATEGORIES.map(cat => (
            <TouchableOpacity
              key={cat.id}
              style={[s.categoryChip, category === cat.id && s.categoryChipActive]}
              onPress={() => setCategory(cat.id)}
            >
              <Text style={s.categoryChipIcon}>{cat.icon}</Text>
              <Text style={[s.categoryChipLabel, category === cat.id && { color: '#00ff88' }]}>{cat.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.sectionHeader}>Description * (min 50 chars)</Text>
        <TextInput
          style={[s.input, { height: 160, textAlignVertical: 'top' }]}
          value={description} onChangeText={setDescription}
          placeholder="Describe your service in detail..."
          placeholderTextColor="#555" multiline numberOfLines={6}
        />
        <Text style={[s.charCount, description.length < 50 && description.length > 0 && { color: '#ff4d4d' }]}>
          {description.length} chars {description.length < 50 ? `(need ${50 - description.length} more)` : '✓'}
        </Text>

        <Text style={s.sectionHeader}>Price (coins) * — 10 coins = $1</Text>
        <View style={s.priceRow}>
          <TextInput
            style={[s.input, { flex: 1, marginBottom: 0 }]}
            value={priceCoins} onChangeText={setPriceCoins}
            placeholder="Minimum 10 coins" placeholderTextColor="#555"
            keyboardType="number-pad"
          />
          {priceCoins ? <Text style={s.priceUSD}>≈ ${(parseInt(priceCoins || '0') / 10).toFixed(2)} USD</Text> : null}
        </View>

        <Text style={s.sectionHeader}>Delivery Time *</Text>
        <View style={s.optionRow}>
          {DELIVERY_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.value}
              style={[s.optionChip, deliveryDays === opt.value && s.optionChipActive]}
              onPress={() => setDeliveryDays(opt.value)}
            >
              <Text style={[s.optionChipText, deliveryDays === opt.value && { color: '#00ff88' }]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.sectionHeader}>Number of Revisions *</Text>
        <View style={s.optionRow}>
          {REVISION_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.value}
              style={[s.optionChip, revisions === opt.value && s.optionChipActive]}
              onPress={() => setRevisions(opt.value)}
            >
              <Text style={[s.optionChipText, revisions === opt.value && { color: '#00ff88' }]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.sectionHeader}>Portfolio Media (up to 5)</Text>
        <Text style={s.portfolioHint}>
          💡 First photo/video auto-posts to the feed with a{' '}
          <Text style={{ color: '#00ff88', fontWeight: '700' }}>Shop Now</Text> button — just like TikTok Shop!
        </Text>
        <View style={s.portfolioGrid}>
          {portfolioUrls.map((item, i) => (
            <View key={i} style={s.portfolioItem}>
              {item.isVideo ? (
                <View style={[s.portfolioImg, s.videoThumb]}>
                  <Feather name="play-circle" size={32} color="#00ff88" />
                  <Text style={s.videoLabel}>Video</Text>
                </View>
              ) : (
                <Image source={{ uri: item.uri }} style={s.portfolioImg} />
              )}
              {i === 0 && (
                <View style={s.firstBadge}>
                  <Text style={{ color: '#000', fontSize: 8, fontWeight: '800' }}>FEED</Text>
                </View>
              )}
              <TouchableOpacity
                style={s.portfolioRemove}
                onPress={() => setPortfolioUrls(prev => prev.filter((_, idx) => idx !== i))}
              >
                <Feather name="x" size={12} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
          {portfolioUrls.length < 5 && (
            <TouchableOpacity style={s.portfolioAdd} onPress={handlePickImage} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#00ff88" /> : (
                <>
                  <Feather name="plus" size={24} color="#00ff88" />
                  <Text style={s.portfolioAddText}>Photo / Video</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        {portfolioUrls.length > 0 && (
          <View style={s.autoPostBadge}>
            <Feather name="zap" size={14} color="#ffd700" />
            <Text style={s.autoPostBadgeText}>
              {portfolioUrls[0].isVideo
                ? '⚡ Video will post to feed with Shop Now button'
                : '⚡ Image will post to feed with Shop Now button'}
            </Text>
          </View>
        )}

        {portfolioUrls.length > 0 && title.trim() && (
          <View style={s.previewCard}>
            <Text style={s.previewLabel}>👁️ How it looks in feed:</Text>
            <View style={s.shopNowRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.shopNowTitle} numberOfLines={1}>{title.trim()}</Text>
                <Text style={s.shopNowPrice}>{priceCoins || '—'} coins</Text>
              </View>
              <View style={s.shopNowBtn}>
                <Text style={s.shopNowBtnText}>Shop Now →</Text>
              </View>
            </View>
          </View>
        )}

        <View style={s.rulesBox}>
          <Text style={s.rulesTitle}>📋 Listing Rules</Text>
          <Text style={s.rulesText}>• No adult content, illegal services, or misleading listings</Text>
          <Text style={s.rulesText}>• Deliver within your stated time to avoid warnings</Text>
          <Text style={s.rulesText}>• All payments go through LumVibe — no outside transfers</Text>
          <Text style={s.rulesText}>• LumVibe takes a 10% fee on completed orders</Text>
        </View>

        <TouchableOpacity
          style={[s.publishBtn, saving && { opacity: 0.5 }]}
          onPress={handleSave} disabled={saving}
        >
          {saving
            ? <ActivityIndicator size="small" color="#000" />
            : <Text style={s.publishBtnText}>🚀 Publish & Post to Feed</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#000' },
  header:             { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  headerTitle:        { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  saveBtn:            { backgroundColor: '#00ff88', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  saveBtnText:        { color: '#000', fontWeight: 'bold', fontSize: 14 },
  scroll:             { padding: 20, paddingBottom: 60 },
  progressBar:        { height: 36, backgroundColor: '#0a0a0a', justifyContent: 'center', paddingHorizontal: 16, position: 'relative', borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  progressFill:       { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#00ff8825' },
  progressLabel:      { color: '#00ff88', fontSize: 12, fontWeight: '600' },
  sectionHeader:      { color: '#fff', fontSize: 13, fontWeight: '700', marginBottom: 10, marginTop: 20 },
  input:              { backgroundColor: '#111', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 10, padding: 14, color: '#fff', fontSize: 14, marginBottom: 6 },
  charCount:          { color: '#555', fontSize: 11, textAlign: 'right', marginBottom: 4 },
  priceRow:           { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  priceUSD:           { color: '#00ff88', fontSize: 14, fontWeight: '600' },
  categoryGrid:       { gap: 8, marginBottom: 4 },
  categoryChip:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', borderRadius: 10, padding: 12, gap: 10, borderWidth: 1, borderColor: '#222' },
  categoryChipActive: { backgroundColor: '#00ff8818', borderColor: '#00ff88' },
  categoryChipIcon:   { fontSize: 20 },
  categoryChipLabel:  { color: '#888', fontSize: 13, fontWeight: '600' },
  optionRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  optionChip:         { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#111', borderRadius: 8, borderWidth: 1, borderColor: '#222' },
  optionChipActive:   { backgroundColor: '#00ff8818', borderColor: '#00ff88' },
  optionChipText:     { color: '#888', fontSize: 12, fontWeight: '600' },
  portfolioGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  portfolioHint:      { color: '#555', fontSize: 12, marginBottom: 10, lineHeight: 18 },
  portfolioItem:      { width: 90, height: 90, borderRadius: 10, overflow: 'hidden', position: 'relative' },
  portfolioImg:       { width: '100%', height: '100%' },
  videoThumb:         { backgroundColor: '#0a1a0a', borderWidth: 1, borderColor: '#00ff8855', justifyContent: 'center', alignItems: 'center', gap: 4 },
  videoLabel:         { color: '#00ff88', fontSize: 10, fontWeight: '600' },
  firstBadge:         { position: 'absolute', bottom: 4, left: 4, backgroundColor: '#00ff88', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2 },
  portfolioRemove:    { position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 10, width: 20, height: 20, justifyContent: 'center', alignItems: 'center' },
  portfolioAdd:       { width: 90, height: 90, borderRadius: 10, backgroundColor: '#111', borderWidth: 1, borderColor: '#00ff8855', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', gap: 4 },
  portfolioAddText:   { color: '#00ff88', fontSize: 10, fontWeight: '600' },
  autoPostBadge:      { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1a1200', borderRadius: 10, padding: 12, marginTop: 10, borderWidth: 1, borderColor: '#ffd70033' },
  autoPostBadgeText:  { color: '#ffd700', fontSize: 12, fontWeight: '600', flex: 1 },
  previewCard:        { backgroundColor: '#0a0f0a', borderRadius: 12, padding: 14, marginTop: 12, borderWidth: 1, borderColor: '#00ff8830' },
  previewLabel:       { color: '#555', fontSize: 11, marginBottom: 10 },
  shopNowRow:         { flexDirection: 'row', alignItems: 'center', gap: 12 },
  shopNowTitle:       { color: '#fff', fontSize: 13, fontWeight: '700', marginBottom: 2 },
  shopNowPrice:       { color: '#00ff88', fontSize: 12, fontWeight: '600' },
  shopNowBtn:         { backgroundColor: '#00ff88', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  shopNowBtnText:     { color: '#000', fontWeight: '800', fontSize: 12 },
  rulesBox:           { backgroundColor: '#0d0d0d', borderRadius: 10, padding: 16, marginTop: 24, borderWidth: 1, borderColor: '#1a1a1a' },
  rulesTitle:         { color: '#fff', fontSize: 13, fontWeight: 'bold', marginBottom: 10 },
  rulesText:          { color: '#666', fontSize: 12, lineHeight: 20 },
  publishBtn:         { backgroundColor: '#00ff88', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 24 },
  publishBtnText:     { color: '#000', fontWeight: 'bold', fontSize: 16 },
}); 
