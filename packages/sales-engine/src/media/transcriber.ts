/**
 * AssemblyAI Transcriber Implementation
 */
import type { TranscriberProvider, AudioTranscription } from './types.js';

export class AssemblyAITranscriber implements TranscriberProvider {
  private apiKey: string;
  private baseUrl = 'https://api.assemblyai.com/v2';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async transcribe(audioUrl: string): Promise<AudioTranscription> {
    // 1. Submit transcription job
    const submitResponse = await fetch(`${this.baseUrl}/transcript`, {
      method: 'POST',
      headers: {
        'Authorization': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: audioUrl,
        language_code: 'es', // Default to Spanish for this project
        speaker_labels: false,
      }),
    });

    if (!submitResponse.ok) {
      const error = await submitResponse.text();
      throw new Error(`AssemblyAI submission failed: ${error}`);
    }

    const { id } = await submitResponse.json();

    // 2. Poll for completion
    return this.pollForCompletion(id);
  }

  private async pollForCompletion(id: string): Promise<AudioTranscription> {
    const maxRetries = 60; // 1 minute max (usually takes 10-20s)
    const interval = 1000;

    for (let i = 0; i < maxRetries; i++) {
      const response = await fetch(`${this.baseUrl}/transcript/${id}`, {
        method: 'GET',
        headers: {
          'Authorization': this.apiKey,
        },
      });

      if (!response.ok) {
        throw new Error('AssemblyAI polling failed');
      }

      const result = await response.json();

      if (result.status === 'completed') {
        return {
          text: result.text || '',
          confidence: result.confidence || 0,
          duration: result.audio_duration || 0,
          language: result.language_code,
        };
      }

      if (result.status === 'error') {
        throw new Error(`Transcription failed: ${result.error}`);
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, interval));
    }

    throw new Error('Transcription timed out');
  }
}
