/**
 * Gemini Vision Analyzer Implementation
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { VisionProvider, ImageAnalysis } from './types.js';

export class GeminiVisionAnalyzer implements VisionProvider {
  private genAI: GoogleGenerativeAI;
  private modelName = 'gemini-2.0-flash'; // Supports vision

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async analyze(imageUrl: string): Promise<ImageAnalysis> {
    // We need to fetch the image data first to convert to base64
    // Gemini expects inline data or a file URI (but file URI is for Google AI Studio)
    
    const imageResp = await fetch(imageUrl);
    if (!imageResp.ok) {
      throw new Error(`Failed to fetch image for analysis: ${imageResp.statusText}`);
    }
    
    const arrayBuffer = await imageResp.arrayBuffer();
    const base64Data = this.arrayBufferToBase64(arrayBuffer);
    const mimeType = imageResp.headers.get('content-type') || 'image/jpeg';

    const model = this.genAI.getGenerativeModel({ model: this.modelName });

    const prompt = `
      Analyze this image for a sales context.
      Describe what you see.
      If it is a payment receipt or bank transfer screenshot, extract:
      - Amount
      - Date
      - Transaction ID (if visible)
      - Bank Name (if visible)
      
      Format the response as a concise description.
    `;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Data,
          mimeType,
        },
      },
    ]);

    const response = await result.response;
    const text = response.text();

    return {
      description: text,
      detectedText: undefined, // Gemini handles OCR implicitly in description
    };
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
