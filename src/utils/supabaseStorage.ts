import { supabase } from '../config/supabase';
import { readAsStringAsync, EncodingType } from 'expo-file-system/legacy'; 
import { decode } from 'base64-arraybuffer';

export interface UploadResult {
  url:  string;
  path: string;
}

export async function uploadToSupabase(
  uri:    string,
  type:   'image' | 'video',
  userId: string,
): Promise<UploadResult> {
  try {
    const base64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });

    const fileExt  = uri.split('.').pop() || (type === 'image' ? 'jpg' : 'mp4');
    const fileName = `${userId}/${Date.now()}.${fileExt}`;
    const bucket   = 'posts-media';

    const arrayBuffer = decode(base64);

    const { error } = await supabase.storage
      .from(bucket)
      .upload(fileName, arrayBuffer, {
        contentType: type === 'image' ? 'image/jpeg' : 'video/mp4',
        upsert:      false,
      });

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(fileName);

    return { url: publicUrl, path: fileName };
  } catch (error) {
    console.error('uploadToSupabase error:', error);
    throw error;
  }
}

export async function uploadProfilePhoto(
  uri:    string,
  userId: string,
): Promise<UploadResult> {
  try {
    const base64  = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
    const fileExt = uri.split('.').pop() || 'jpg';
    const fileName = `${userId}/avatar.${fileExt}`;
    const bucket   = 'profile-photos';

    const arrayBuffer = decode(base64);

    await supabase.storage.from(bucket).remove([fileName]);

    const { error } = await supabase.storage
      .from(bucket)
      .upload(fileName, arrayBuffer, { contentType: 'image/jpeg', upsert: true });

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(fileName);

    return { url: publicUrl, path: fileName };
  } catch (error) {
    console.error('uploadProfilePhoto error:', error);
    throw error;
  }
}

export async function deleteFromSupabase(
  path:   string,
  bucket: 'posts-media' | 'profile-photos',
): Promise<void> {
  try {
    const { error } = await supabase.storage.from(bucket).remove([path]);
    if (error) throw error;
  } catch (error) {
    console.error('deleteFromSupabase error:', error);
    throw error;
  }
}