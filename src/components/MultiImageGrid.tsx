// src/components/MultiImageGrid.tsx   (new file: put it next to AdSlot.tsx)
//
// Facebook-style photo collage for posts with more than one photo.
//   2 photos  -> side by side
//   3 photos  -> one wide on top, two below
//   4 photos  -> 2 x 2
//   5+ photos -> two on top, three below, "+N" on the last one
// Tap any photo to open a full-screen viewer you can swipe through (photos shown whole, nothing cropped).

import React, { useRef, useState, memo } from 'react';
import {
  View, Image, TouchableOpacity, Text, Modal, FlatList, Dimensions, StyleSheet, StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const { width: SW, height: SH } = Dimensions.get('window');
const GAP = 2;

type Props = { urls: string[]; isVisible?: boolean };

function MultiImageGrid({ urls, isVisible = true }: Props) {
  const [w, setW] = useState(SW);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const listRef = useRef<FlatList<string>>(null);

  const list = (urls || []).filter(Boolean);
  if (list.length < 2) return null;

  const extra = list.length - 5;

  const tile = (i: number, tw: number, th: number) => (
    <TouchableOpacity key={i} activeOpacity={0.9} onPress={() => setViewerIndex(i)} style={{ width: tw, height: th }}>
      {isVisible ? (
        <Image source={{ uri: list[i] }} style={{ width: tw, height: th, backgroundColor: '#111' }} resizeMode="cover" />
      ) : (
        <View style={{ width: tw, height: th, backgroundColor: '#111' }} />
      )}
      {i === 4 && extra > 0 && (
        <View style={s.moreOverlay}>
          <Text style={s.moreTxt}>+{extra}</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  const half = (w - GAP) / 2;
  const third = (w - GAP * 2) / 3;

  let body: React.ReactNode;
  if (list.length === 2) {
    body = (
      <View style={s.row}>{tile(0, half, w * 0.8)}{tile(1, half, w * 0.8)}</View>
    );
  } else if (list.length === 3) {
    body = (
      <>
        <View style={s.row}>{tile(0, w, w * 0.62)}</View>
        <View style={[s.row, { marginTop: GAP }]}>{tile(1, half, w * 0.5)}{tile(2, half, w * 0.5)}</View>
      </>
    );
  } else if (list.length === 4) {
    body = (
      <>
        <View style={s.row}>{tile(0, half, w * 0.5)}{tile(1, half, w * 0.5)}</View>
        <View style={[s.row, { marginTop: GAP }]}>{tile(2, half, w * 0.5)}{tile(3, half, w * 0.5)}</View>
      </>
    );
  } else {
    body = (
      <>
        <View style={s.row}>{tile(0, half, w * 0.5)}{tile(1, half, w * 0.5)}</View>
        <View style={[s.row, { marginTop: GAP }]}>{tile(2, third, w * 0.36)}{tile(3, third, w * 0.36)}{tile(4, third, w * 0.36)}</View>
      </>
    );
  }

  return (
    <View style={{ width: '100%' }} onLayout={(e) => { const nw = e.nativeEvent.layout.width; if (nw > 0 && Math.abs(nw - w) > 1) setW(nw); }}>
      {body}

      <Modal visible={viewerIndex !== null} transparent={false} animationType="fade" onRequestClose={() => setViewerIndex(null)} statusBarTranslucent>
        <View style={s.viewer}>
          <StatusBar hidden />
          {viewerIndex !== null && (
            <FlatList
              ref={listRef}
              data={list}
              keyExtractor={(u, i) => u + i}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              initialScrollIndex={viewerIndex}
              getItemLayout={(_, i) => ({ length: SW, offset: SW * i, index: i })}
              onMomentumScrollEnd={(e) => setViewerIndex(Math.round(e.nativeEvent.contentOffset.x / SW))}
              renderItem={({ item }) => (
                <View style={{ width: SW, height: SH, justifyContent: 'center' }}>
                  <Image source={{ uri: item }} style={{ width: SW, height: SH }} resizeMode="contain" />
                </View>
              )}
            />
          )}
          <View style={s.topBar} pointerEvents="box-none">
            <Text style={s.counter}>{(viewerIndex ?? 0) + 1} / {list.length}</Text>
            <TouchableOpacity style={s.closeBtn} onPress={() => setViewerIndex(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={26} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', width: '100%' },
  moreOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  moreTxt: { color: '#fff', fontSize: 28, fontWeight: '700' },
  viewer: { flex: 1, backgroundColor: '#000' },
  topBar: { position: 'absolute', top: 36, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  counter: { color: '#fff', fontSize: 15, fontWeight: '700', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, overflow: 'hidden' },
  closeBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
});

export default memo(MultiImageGrid);
