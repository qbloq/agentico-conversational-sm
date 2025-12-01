/**
 * Supabase Storage Provider Implementation
 */
import type { StorageProvider } from './types.js';

interface SupabaseStorageClient {
  storage: {
    from(bucket: string): {
      upload(path: string, fileBody: any, fileOptions?: any): Promise<{ data: any; error: any }>;
      getPublicUrl(path: string): { data: { publicUrl: string } };
    };
  };
}

export class SupabaseStorageProvider implements StorageProvider {
  private supabase: SupabaseStorageClient;

  constructor(supabaseClient: any) {
    this.supabase = supabaseClient as SupabaseStorageClient;
  }

  async upload(
    bucket: string, 
    path: string, 
    data: ArrayBuffer, 
    contentType: string
  ): Promise<{ path: string; publicUrl: string }> {
    const { data: uploadData, error } = await this.supabase.storage
      .from(bucket)
      .upload(path, data, {
        contentType,
        upsert: true,
      });

    if (error) {
      throw new Error(`Storage upload failed: ${error.message}`);
    }

    const { data: publicUrlData } = this.supabase.storage
      .from(bucket)
      .getPublicUrl(path);

    return {
      path: uploadData.path,
      publicUrl: publicUrlData.publicUrl,
    };
  }
}
