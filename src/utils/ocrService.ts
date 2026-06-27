// utils/ocrService.ts - FINAL FIX (No EncodingType errors)
import * as FileSystem from 'expo-file-system';

const GOOGLE_VISION_API_KEY = 'AIzaSyA8VxZRW6lOSytp6Bh5dSpFf1gGVWdSGwQ'

export async function extractTextFromId(imageUri: string) {
  try {
    // FIX: Use string directly instead of EncodingType
    const base64 = await FileSystem.readAsStringAsync(imageUri, {
      encoding: 'base64', // ✅ Direct string, no TypeScript errors
    });

    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: base64 },
            features: [
              { type: 'TEXT_DETECTION', maxResults: 1 },
              { type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }
            ]
          }]
        })
      }
    );

    const data = await response.json();
    
    if (!data.responses || !data.responses[0].fullTextAnnotation) {
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
	
