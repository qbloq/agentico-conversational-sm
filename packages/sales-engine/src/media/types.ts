/**
 * Media Service Types
 */

export interface MediaFile {
  id: string;
  url: string;           // Public/Signed URL
  storagePath: string;   // Internal path in bucket
  mimeType: string;
  sizeBytes?: number;
}

export interface AudioTranscription {
  text: string;
  confidence: number;
  duration: number;
  language?: string;
}

export interface ImageAnalysis {
  description: string;
  detectedText?: string;
  labels?: string[];
}

/**
 * Service for handling media operations
 */
export interface MediaService {
  /**
   * Download media from external URL (e.g. WhatsApp)
   */
  download(url: string, headers?: Record<string, string>): Promise<ArrayBuffer>;
  
  /**
   * Upload media to storage
   */
  upload(
    file: ArrayBuffer, 
    path: string, 
    mimeType: string
  ): Promise<MediaFile>;
  
  /**
   * Transcribe audio file
   */
  transcribe(audioUrl: string): Promise<AudioTranscription>;
  
  /**
   * Analyze image content
   */
  analyzeImage(imageUrl: string): Promise<ImageAnalysis>;
}

export interface StorageProvider {
  upload(
    bucket: string, 
    path: string, 
    data: ArrayBuffer, 
    contentType: string
  ): Promise<{ path: string; publicUrl: string }>;
}

export interface TranscriberProvider {
  transcribe(audioUrl: string): Promise<AudioTranscription>;
}

export interface VisionProvider {
  analyze(imageUrl: string): Promise<ImageAnalysis>;
}
