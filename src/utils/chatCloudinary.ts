// utils/chatCloudinary.ts
// ─────────────────────────────────────────────────────────────
// LumVibe — Cloudinary upload for chat media
// Voice notes, images, videos sent in chat
// ─────────────────────────────────────────────────────────────

const CLOUD_NAME = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME || 'dvikzffqe';
const UPLOAD_PRESET = process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET || 'unsigned_preset_name';

export type UploadType = 'voice' | 'image' | 'video';

export interface UploadResult {
  url: string;
  publicId: string;
  duration?: number;
  thumbnail?: string;
  width?: number;
  height?: number;
}

// Upload any media file to Cloudinary
export async function uploadChatMedia(
  fileUri: string,
  type: UploadType,
  onProgress?: (percent: number) => void
): Promise<UploadResult | null> {
  try {
    const resourceType =
      type === 'image' ? 'image' : 'video'; // Cloudinary uses 'video' for audio too

    const folder = `lumvibe_chat/${type}s`;

    const formData = new FormData();
    formData.append('file', {
      uri: fileUri,
      type: type === 'voice' ? 'audio/m4a' : type === 'image' ? 'image/jpeg' : 'video/mp4',
      name: `${type}_${Date.now()}.${type === 'voice' ? 'm4a' : type === 'image' ? 'jpg' : 'mp4'}`,
    } as any);
    formData.append('upload_preset', UPLOAD_PRESET);
    formData.append('folder', folder);

    if (type === 'video') {
      formData.append('eager', 'w_300,h_200,c_fill|so_0'); // Generate thumbnail
    }

    const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`;

    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Cloudinary upload error:', error);
      return null;
    }

    const data = await response.json();

    return {
      url: data.secure_url,
      publicId: data.public_id,
      duration: data.duration,
      thumbnail: data.eager?.[0]?.secure_url || data.secure_url,
      width: data.width,
      height: data.height,
    };
  } catch (error) {
    console.error('uploadChatMedia error:', error);
    return null;
  }
}

// Upload voice note specifically
export async function uploadVoiceNote(
  fileUri: string
): Promise<UploadResult | null> {
  return uploadChatMedia(fileUri, 'voice');
}

// Upload chat image
export async function uploadChatImage(
  fileUri: string
): Promise<UploadResult | null> {
  return uploadChatMedia(fileUri, 'image');
}

// Upload story media
export async function uploadStoryMedia(
  fileUri: string,
  type: 'image' | 'video'
): Promise<UploadResult | null> {
  try {
    const formData = new FormData();
    formData.append('file', {
      uri: fileUri,
      type: type === 'image' ? 'image/jpeg' : 'video/mp4',
      name: `story_${Date.now()}.${type === 'image' ? 'jpg' : 'mp4'}`,
    } as any);
    formData.append('upload_preset', UPLOAD_PRESET);
    formData.append('folder', 'lumvibe_chat/stories');

    const resourceType = type === 'image' ? 'image' : 'video';
    const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`;

    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) return null;

    const data = await response.json();
    return {
      url: data.secure_url,
      publicId: data.public_id,
      duration: data.duration,
      thumbnail: data.secure_url,
    };
  } catch (error) {
    console.error('uploadStoryMedia error:', error);
    return null;
  }
} 
