// ═══════════════════════════════════════════════════════════
// cloudinaryHelpers.ts — Cloudinary upload with baked filters,
// watermark, and speed optimizations for low-end devices.
// ═══════════════════════════════════════════════════════════

import * as ImageManipulator from 'expo-image-manipulator';
import { CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } from './constants';
import type { FilterDef } from './types';

// ─── SHARED: convert 1.0-based manipulator scale to ────────
// ─── Cloudinary's 0-based percentage scale ──────────────────
function buildColorEffectChain(filter: FilterDef): string {
  const b = Math.round((filter.manipulator.brightness - 1) * 100);
  const c = Math.round((filter.manipulator.contrast   - 1) * 100);
  const s = Math.round(((filter.manipulator.saturate ?? 1) - 1) * 100);

  const parts: string[] = [];
  if (b !== 0) parts.push(`e_brightness:${b}`);
  if (c !== 0) parts.push(`e_contrast:${c}`);
  if (s !== 0) parts.push(`e_saturation:${s}`);
  return parts.join(',');
}

function buildWatermarkStep(username: string): string {
  const safeUser = username.replace(/[^a-zA-Z0-9_]/g, '').substring(0, 30);
  const wmText   = encodeURIComponent(`LumVibe @${safeUser}`);
  return (
    `l_text:Arial_22_bold:${wmText},co_rgb:00ff88,g_south_west,` +
    `x_20,y_20,b_rgb:000000,bo_8px_solid_rgb:000000,o_85`
  );
}

// ─── Compress image client-side before upload — caps width ─
// ─── at 1080px, JPEG quality 0.8. Cuts typical phone photos ─
// ─── (3000px+, 3-8MB) down to a few hundred KB. ─────────────
async function compressImage(uri: string): Promise<string> {
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1080 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
    );
    return result.uri;
  } catch (err) {
    console.error('Image compression failed, using original:', err);
    return uri; // fail-safe — never block upload if compression fails
  }
}

// ─── UPLOAD VIDEO — plain unsigned upload, no eager param ──
export async function uploadVideoToCloudinary(
  uri: string,
  onProgress: (p: number) => void,
): Promise<{ url: string; publicId: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fd  = new FormData();
    fd.append('file', { uri, type: 'video/mp4', name: `v_${Date.now()}.mp4` } as any);
    fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    fd.append('cloud_name', CLOUDINARY_CLOUD_NAME);

    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100));
    };
    xhr.onload = () => {
      if (xhr.status === 200) {
        try {
          const d = JSON.parse(xhr.responseText);
          resolve({ url: d.secure_url, publicId: d.public_id });
        } catch { reject(new Error('Parse error')); }
      } else {
        console.error('Cloudinary upload failed:', xhr.status, xhr.responseText);
        reject(new Error(`Cloudinary ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`);
    xhr.send(fd);
  });
}

// ─── UPLOAD IMAGE — compresses client-side first, then ─────
// ─── plain unsigned upload, no eager param. ─────────────────
export async function uploadImageToCloudinary(
  uri: string,
  onProgress?: (p: number) => void,
): Promise<{ url: string; publicId: string }> {
  const compressedUri = await compressImage(uri);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fd  = new FormData();
    fd.append('file', { uri: compressedUri, type: 'image/jpeg', name: `img_${Date.now()}.jpg` } as any);
    fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    fd.append('cloud_name', CLOUDINARY_CLOUD_NAME);

    if (onProgress) {
      xhr.upload.onprogress = e => {
        if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100));
      };
    }
    xhr.onload = () => {
      if (xhr.status === 200) {
        try {
          const d = JSON.parse(xhr.responseText);
          resolve({ url: d.secure_url, publicId: d.public_id });
        } catch { reject(new Error('Parse error')); }
      } else {
        console.error('Cloudinary upload failed:', xhr.status, xhr.responseText);
        reject(new Error(`Cloudinary ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`);
    xhr.send(fd);
  });
}

// ─── BAKE — builds the final delivery URL with filter, ─────
// ─── watermark, AND q_auto/f_auto baked in. q_auto tells ───
// ─── Cloudinary to auto-pick the smallest file size that ───
// ─── still looks good; f_auto serves WebP/modern formats ───
// ─── to devices that support them — both cut load time on ──
// ─── slow connections without you doing anything manually. ──
export function buildBakedUrl(
  publicId: string,
  type: 'video' | 'image',
  filter?: FilterDef,
  username?: string,
  addWatermark?: boolean,
): string {
  const steps: string[] = [];

  if (filter && filter.id !== 'original') {
    const colorChain = buildColorEffectChain(filter);
    if (colorChain) steps.push(colorChain);
  }
  if (addWatermark && username) {
    steps.push(buildWatermarkStep(username));
  }
  steps.push('q_auto:good,f_auto');

  const transformPath = steps.join('/');
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/${type}/upload/${transformPath}/${publicId}`;
}

// ─── HELPERS ──────────────────────────────────────────────
export function buildDeliveryUrl(publicId: string, type: 'video' | 'image' = 'video'): string {
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/${type}/upload/q_auto:good,f_auto/${publicId}`;
}

export function buildThumbnailUrl(publicId: string, w = 400, h = 400): string {
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/w_${w},h_${h},c_fill,so_0/${publicId}.jpg`;
}