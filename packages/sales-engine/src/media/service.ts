/**
 * Media Service Implementation
 */
import type { 
  MediaService, 
  MediaFile, 
  AudioTranscription, 
  ImageAnalysis,
  StorageProvider,
  TranscriberProvider,
  VisionProvider
} from './types.js';

export class MediaServiceImpl implements MediaService {
  constructor(
    private storage: StorageProvider,
    private transcriber: TranscriberProvider,
    private vision: VisionProvider,
    private bucketName: string
  ) {}

  async download(url: string, headers?: Record<string, string>): Promise<ArrayBuffer> {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Failed to download media: ${response.statusText}`);
    }
    return await response.arrayBuffer();
  }

  async upload(
    file: ArrayBuffer, 
    path: string, 
    mimeType: string
  ): Promise<MediaFile> {
    const { path: storagePath, publicUrl } = await this.storage.upload(
      this.bucketName,
      path,
      file,
      mimeType
    );

    return {
      id: path, // Using path as ID for now
      url: publicUrl,
      storagePath,
      mimeType,
      sizeBytes: file.byteLength,
    };
  }

  async transcribe(audioUrl: string): Promise<AudioTranscription> {
    return this.transcriber.transcribe(audioUrl);
  }

  async analyzeImage(imageUrl: string): Promise<ImageAnalysis> {
    return this.vision.analyze(imageUrl);
  }
}
