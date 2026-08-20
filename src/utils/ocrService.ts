// utils/ocrService.ts
//
// SECURITY FIX: GOOGLE_VISION_API_KEY removed from this file — it was
// hardcoded in plaintext and shipped inside the app bundle, extractable by
// anyone who decompiled the app. The Vision API call now runs server-side
// through the ocr-proxy Edge Function (see supabase-edge-functions/ocr-proxy).

import * as FileSystem from 'expo-file-system';
import { supabase } from '../config/supabase';

export async function extractTextFromId(imageUri: string) {
  try {
    const base64 = await FileSystem.readAsStringAsync(imageUri, {
      encoding: 'base64',
    });

    const { data, error } = await supabase.functions.invoke('ocr-proxy', {
      body: { base64Image: base64 },
    });

    if (error) {
      throw new Error('OCR request failed');
    }

    if (!data?.responses || !data.responses[0]?.fullTextAnnotation) {
      throw new Error('No text found in image');
    }

    const extractedText = data.responses[0].fullTextAnnotation.text;
    return parseIdDocument(extractedText);
  } catch (error) {
    console.error('OCR Error:', error);
    throw error;
  }
}

function parseIdDocument(text: string) {
  const lines = text.split('\n').filter(line => line.trim());

  let name = '';
  let dateOfBirth = '';
  let idNumber = '';

  const namePattern = /^[A-Z][a-z]+ [A-Z][a-z]+/;
  for (const line of lines) {
    if (namePattern.test(line)) {
      name = line;
      break;
    }
  }

  const datePattern = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/;
  for (const line of lines) {
    const match = line.match(datePattern);
    if (match) {
      const [_, day, month, year] = match;
      dateOfBirth = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      break;
    }
  }

  const idPattern = /\b[A-Z0-9]{6,12}\b/;
  for (const line of lines) {
    const match = line.match(idPattern);
    if (match && !datePattern.test(line)) {
      idNumber = match[0];
      break;
    }
  }

  return { name, dateOfBirth, idNumber };
}
