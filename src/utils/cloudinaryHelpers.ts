// ═══════════════════════════════════════════════════════════
// cloudinaryHelpers.ts — Cloudinary upload (matches original)
// ═══════════════════════════════════════════════════════════

import { CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } from './constants';

// ─── UPLOAD VIDEO — exact signature from original ─────────
export async function uploadVideoToCloudinary(
  uri: string,
  onProgress: (p: number) => void,
  username?: string,
  addWatermark?: boolean,
): Promise<{ url: string; publicId: string; watermarkedUrl: string | null }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fd  = new FormData();
    fd.append('file', { uri, type: 'video/mp4', name: `v_${Date.now()}.mp4` } as any);
    fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    fd.append('cloud_name', CLOUDINARY_CLOUD_NAME);

    if (addWatermark && username) {
      const safeUser    = username.replace(/[^a-zA-Z0-9_]/g, '').substring(0, 30);
      const wmText      = encodeURIComponent(`LumVibe @${safeUser}`);
      const eagerTransform =
        `l_text:Arial_22_bold:${wmText},co_rgb:00ff88,g_south_west,` +
        `x_20,y_20,b_rgb:000000,bo_8px_solid_rgb:000000,o_85`;
      fd.append('eager', eagerTransform);
      fd.append('eager_async', 'false');
    }

    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100));
    };
    xhr.onload = () => {
      if (xhr.status === 200) {
        try {
          const d              = JSON.parse(xhr.responseText);
          const url: string    = d.secure_url;
          const publicId       = d.public_id;
          const watermarkedUrl = d.eager?.[0]?.secure_url ?? null;
          resolve({ url, publicId, watermarkedUrl });
        } catch { reject(new Error('Parse error')); }
      } else { reject(new Error(`Cloudinary ${xhr.status}`)); }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`);
    xhr.send(fd);
  });
}

// ─── UPLOAD IMAGE ─────────────────────────────────────────
export async function uploadImageToCloudinary(
  uri: string,
  onProgress?: (p: number) => void,
): Promise<{ url: string; publicId: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fd  = new FormData();
    fd.append('file', { uri, type: 'image/jpeg', name: `img_${Date.now()}.jpg` } as any);
    fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

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
      } else { reject(new Error(`Cloudinary ${xhr.status}`)); }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`);
    xhr.send(fd);
  });
}

// ─── HELPERS ──────────────────────────────────────────────
export function buildDeliveryUrl(publicId: string, type: 'video' | 'image' = 'video'): string {
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/${type}/upload/q_auto:good,f_auto/${publicId}`;
}

export function buildThumbnailUrl(publicId: string, w = 400, h = 400): string {
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/w_${w},h_${h},c_fill,so_0/${publicId}.jpg`;
} 

 
