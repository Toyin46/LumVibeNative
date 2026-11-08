// src/overlays/OverlayLayer.tsx   (new file)
//
// "Add on top": text and pictures placed over a photo, a video or a text card.
//   - drag with one finger, pinch with two fingers to resize and rotate
//   - tap a text to edit it, tap the little x to remove an item
// A third kind, a VIDEO, can also be placed on a video (picture-in-picture). It is moved and resized the same way
// (it cannot be rotated) and the native baker plays it frame by frame in step with the main video.
// Positions are saved as FRACTIONS of the picture (0..1), so they land in exactly the same place on the final
// photo or video, whatever its size.

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Image, TouchableOpacity, PanResponder, StyleSheet, Modal, TextInput, ScrollView,
  Platform, KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';

const GREEN = '#00ff88';

export type OverlayBg = 'none' | 'dark' | 'light' | 'accent';
export type OverlayFont = 'bold' | 'serif' | 'mono';

export type OverlayItem = {
  id: string;
  kind: 'text' | 'image' | 'video';
  x: number; y: number;              // centre of the item, as a fraction of the picture's width / height
  scale: number; rotation: number;   // rotation in radians
  // text
  text?: string; color?: string; bg?: OverlayBg; font?: OverlayFont;
  // picture
  uri?: string; aspect?: number;     // width / height (pictures and videos)
};

/** Width of a placed video at scale 1, as a fraction of the picture's width (the baker uses the same number). */
export const PIP_BASE_WIDTH = 0.4;

export const makeOverlayId = () => `ov_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// The small moving preview of a placed video (muted, looping). It is NOT part of the layer snapshot: the baker draws it.
function PipPreview({ uri, w, h }: { uri: string; w: number; h: number }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.muted = true; p.play(); });
  return (
    <View style={{ width: w, height: h, borderWidth: 2, borderColor: '#fff', backgroundColor: '#000' }}>
      <VideoView player={player} style={{ width: '100%', height: '100%' }} contentFit="cover" nativeControls={false} />
    </View>
  );
}

const FONT_FAMILY: Record<OverlayFont, string | undefined> = {
  bold: undefined,
  serif: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
};
const BG_STYLE: Record<OverlayBg, { backgroundColor: string; textColor?: string }> = {
  none:   { backgroundColor: 'transparent' },
  dark:   { backgroundColor: 'rgba(0,0,0,0.65)' },
  light:  { backgroundColor: 'rgba(255,255,255,0.92)', textColor: '#111' },
  accent: { backgroundColor: GREEN, textColor: '#000' },
};
const COLORS = ['#ffffff', '#000000', '#00ff88', '#ffd400', '#ff4d6d', '#4da3ff', '#c77dff'];

// ─────────────────────────── ONE MOVABLE ITEM ───────────────────────────
type ItemProps = {
  item: OverlayItem; width: number; height: number; selected: boolean; editable: boolean;
  onSelect: () => void; onUpdate: (patch: Partial<OverlayItem>) => void; onEdit: () => void; onDelete: () => void;
};

function OverlayItemView(props: ItemProps) {
  const { item, width, height, selected, editable } = props;
  const [size, setSize] = useState({ w: 0, h: 0 });

  // The gesture handler is created once, so it always reads the latest props through this ref.
  const latest = useRef(props); latest.current = props;
  const st = useRef({ x: 0, y: 0, scale: 1, rotation: 0, dist: 0, angle: 0, two: false, baseDx: 0, baseDy: 0 });

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => latest.current.editable,
    onMoveShouldSetPanResponder: () => latest.current.editable,
    onPanResponderGrant: () => {
      const p = latest.current;
      p.onSelect();
      st.current = { x: p.item.x, y: p.item.y, scale: p.item.scale, rotation: p.item.rotation, dist: 0, angle: 0, two: false, baseDx: 0, baseDy: 0 };
    },
    onPanResponderMove: (e, g) => {
      const p = latest.current; const s = st.current;
      const t = e.nativeEvent.touches;
      if (t && t.length >= 2) {
        const dx = t[1].pageX - t[0].pageX, dy = t[1].pageY - t[0].pageY;
        const dist = Math.hypot(dx, dy), angle = Math.atan2(dy, dx);
        if (!s.two) { s.two = true; s.dist = dist || 1; s.angle = angle; s.scale = p.item.scale; s.rotation = p.item.rotation; }
        const isVid = p.item.kind === 'video';
        p.onUpdate({ scale: clamp(s.scale * (dist / s.dist), 0.25, isVid ? 2.2 : 6), rotation: isVid ? 0 : s.rotation + (angle - s.angle) });
      } else {
        if (s.two) { s.two = false; s.x = p.item.x; s.y = p.item.y; s.baseDx = g.dx; s.baseDy = g.dy; }
        p.onUpdate({
          x: clamp(s.x + (g.dx - s.baseDx) / p.width, 0.02, 0.98),
          y: clamp(s.y + (g.dy - s.baseDy) / p.height, 0.02, 0.98),
        });
      }
    },
    onPanResponderRelease: (_e, g) => {
      const p = latest.current;
      if (Math.abs(g.dx) < 6 && Math.abs(g.dy) < 6 && !st.current.two && p.item.kind === 'text') p.onEdit();   // a tap edits the text
    },
  })).current;

  const baseFont = width * 0.075;
  let content: React.ReactNode = null;
  if (item.kind === 'text') {
    const bg = BG_STYLE[item.bg || 'none'];
    content = (
      <View style={{ backgroundColor: bg.backgroundColor, paddingHorizontal: baseFont * 0.45, paddingVertical: baseFont * 0.2, borderRadius: baseFont * 0.35, maxWidth: width * 0.9 }}>
        <Text
          style={{
            color: bg.textColor && (item.bg === 'light' || item.bg === 'accent') ? bg.textColor : (item.color || '#fff'),
            fontSize: baseFont, fontWeight: item.font === 'serif' ? '700' : '800', fontFamily: FONT_FAMILY[item.font || 'bold'], textAlign: 'center',
            textShadowColor: item.bg === 'none' || !item.bg ? 'rgba(0,0,0,0.55)' : 'transparent', textShadowRadius: 5, textShadowOffset: { width: 0, height: 1 },
          }}
        >{item.text}</Text>
      </View>
    );
  } else if (item.kind === 'video' && item.uri) {
    const w = width * PIP_BASE_WIDTH, h = w / (item.aspect || 1);
    // while the layer picture is taken this stays empty: the baker draws the video itself
    content = editable ? <PipPreview uri={item.uri} w={w} h={h} /> : <View style={{ width: w, height: h }} />;
  } else if (item.uri) {
    const w = width * 0.38;
    content = <Image source={{ uri: item.uri }} style={{ width: w, height: w / (item.aspect || 1) }} resizeMode="contain" />;
  }

  return (
    <View
      {...(editable ? pan.panHandlers : {})}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      style={{
        position: 'absolute',
        left: item.x * width - size.w / 2,
        top: item.y * height - size.h / 2,
        opacity: size.w > 0 ? 1 : 0,
        transform: [{ rotate: `${item.kind === 'video' ? 0 : item.rotation}rad` }, { scale: item.scale }],
        borderWidth: editable && selected ? 1.5 : 0, borderColor: GREEN, borderStyle: 'dashed', borderRadius: 8,
      }}
    >
      {content}
      {editable && selected && (
        <TouchableOpacity style={s.delBtn} onPress={props.onDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={13} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─────────────────────────── THE LAYER ───────────────────────────
type LayerProps = {
  items: OverlayItem[]; onChange: (items: OverlayItem[]) => void;
  selectedId: string | null; onSelect: (id: string | null) => void;
  width: number; height: number;
  editable: boolean;                       // false while the snapshot is taken (no selection frame / x button)
  onEditText: (id: string) => void;
};

export default function OverlayLayer({ items, onChange, selectedId, onSelect, width, height, editable, onEditText }: LayerProps) {
  // Always read the newest list, so a fast gesture never overwrites a newer change.
  const itemsRef = useRef(items); itemsRef.current = items;
  const update = (id: string, patch: Partial<OverlayItem>) => onChange(itemsRef.current.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  if (width <= 0 || height <= 0) return null;
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {items.map((it) => (
        <OverlayItemView
          key={it.id} item={it} width={width} height={height} selected={selectedId === it.id} editable={editable}
          onSelect={() => onSelect(it.id)}
          onUpdate={(patch) => update(it.id, patch)}
          onEdit={() => onEditText(it.id)}
          onDelete={() => { onChange(itemsRef.current.filter((i) => i.id !== it.id)); onSelect(null); }}
        />
      ))}
    </View>
  );
}

// ─────────────────────────── TEXT EDITOR ───────────────────────────
type EditorProps = {
  visible: boolean;
  initial: OverlayItem | null;            // null = a brand-new text
  onCancel: () => void;
  onDone: (fields: { text: string; color: string; bg: OverlayBg; font: OverlayFont }) => void;
};

export function OverlayTextEditor({ visible, initial, onCancel, onDone }: EditorProps) {
  const [text, setText] = useState('');
  const [color, setColor] = useState('#ffffff');
  const [bg, setBg] = useState<OverlayBg>('none');
  const [font, setFont] = useState<OverlayFont>('bold');

  useEffect(() => {
    if (visible) {
      setText(initial?.text || ''); setColor(initial?.color || '#ffffff');
      setBg(initial?.bg || 'none'); setFont(initial?.font || 'bold');
    }
  }, [visible, initial]);

  const preview = BG_STYLE[bg];
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel} statusBarTranslucent>
      <KeyboardAvoidingView style={s.edRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.edTop}>
          <TouchableOpacity onPress={onCancel}><Text style={s.edBtn}>Cancel</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => { const t = text.trim(); if (t) onDone({ text: t, color, bg, font }); else onCancel(); }}>
            <Text style={[s.edBtn, { color: GREEN, fontWeight: '800' }]}>Done</Text>
          </TouchableOpacity>
        </View>

        <View style={s.edCenter}>
          <View style={{ backgroundColor: preview.backgroundColor, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8, maxWidth: '90%' }}>
            <TextInput
              autoFocus multiline value={text} onChangeText={(v) => setText(v.slice(0, 120))}
              placeholder="Type something..." placeholderTextColor="rgba(255,255,255,0.4)"
              style={{
                color: (bg === 'light' || bg === 'accent') ? (preview.textColor || '#000') : color, fontSize: 30, textAlign: 'center', minWidth: 120,
                fontWeight: font === 'serif' ? '700' : '800', fontFamily: FONT_FAMILY[font],
              }}
            />
          </View>
        </View>

        <View style={s.edTools}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 16 }}>
            {COLORS.map((c) => (
              <TouchableOpacity key={c} onPress={() => setColor(c)} style={[s.swatch, { backgroundColor: c }, color === c && s.swatchOn]} />
            ))}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 12 }}>
            {(['none', 'dark', 'light', 'accent'] as OverlayBg[]).map((b) => (
              <TouchableOpacity key={b} onPress={() => setBg(b)} style={[s.chip, bg === b && s.chipOn]}>
                <Text style={[s.chipTxt, bg === b && { color: '#000' }]}>{b === 'none' ? 'No box' : b === 'dark' ? 'Dark' : b === 'light' ? 'Light' : 'Green'}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 8 }}>
            {(['bold', 'serif', 'mono'] as OverlayFont[]).map((f) => (
              <TouchableOpacity key={f} onPress={() => setFont(f)} style={[s.chip, font === f && s.chipOn]}>
                <Text style={[s.chipTxt, font === f && { color: '#000' }, { fontFamily: FONT_FAMILY[f] }]}>{f === 'bold' ? 'Bold' : f === 'serif' ? 'Serif' : 'Mono'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  delBtn: { position: 'absolute', top: -13, right: -13, width: 24, height: 24, borderRadius: 12, backgroundColor: '#ff3b5c', alignItems: 'center', justifyContent: 'center' },
  edRoot: { flex: 1, backgroundColor: 'rgba(0,0,0,0.88)' },
  edTop: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: Platform.OS === 'ios' ? 56 : 42 },
  edBtn: { color: '#fff', fontSize: 16, fontWeight: '600' },
  edCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  edTools: { paddingBottom: 22 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)' },
  swatchOn: { borderColor: '#fff', transform: [{ scale: 1.15 }] },
  chip: { backgroundColor: '#1d1d1d', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7 },
  chipOn: { backgroundColor: GREEN },
  chipTxt: { color: '#ddd', fontSize: 13, fontWeight: '700' },
});
