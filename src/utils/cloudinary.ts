// utils/cloudinary.ts
export const CLOUDINARY_CONFIG = {
  cloudName: 'dvllxm0wg',
  uploadPreset: 'Kinsta_unsigned',
};

export const uploadToCloudinary = async (uri: string, type: 'image' | 'video' = 'image') => {
  try {
    const formData = new FormData();
    
    const file = {
      uri,
      type: type === 'image' ? 'image/jpeg' : 'video/mp4',
      name: `upload_${Date.now()}.${type === 'image' ? 'jpg' : 'mp4'}`,
    } as any;

    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/${type}/upload`,
      {
        method: 'POST',
        body: formData,
      }
    );

    if (!response.ok) {
      throw new Error('Upload failed');
    }

    const data = await response.json();
    return {
      url: data.secure_url,
      publicId: data.public_id,
    };
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw error;
  }
};