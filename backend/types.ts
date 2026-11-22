export interface AuthUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
}

export interface StorageObjectHead {
  key: string;
  size: number;
  etag?: string;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface StorageObjectBody {
  key: string;
  size: number;
  contentType?: string;
  body: ReadableStream<Uint8Array>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export interface StorageMultipartPart {
  partNumber: number;
  etag: string;
}

export interface VideoStorageAdapter {
  readonly backendName: 'backblaze-b2' | 'local-dev-storage';
  readonly isConfigured: boolean;
  head(key: string): Promise<StorageObjectHead | null>;
  get(key: string, options?: { range?: { offset: number; length: number } }): Promise<StorageObjectBody | null>;
  put(key: string, value: ArrayBuffer | Uint8Array | string, contentType?: string): Promise<StorageObjectHead>;
  delete(key: string): Promise<void>;
  createMultipartUpload(
    key: string,
    options?: { contentType?: string; metadata?: Record<string, string> }
  ): Promise<{ uploadId: string }>;
  uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    value: ArrayBuffer | Uint8Array
  ): Promise<StorageMultipartPart>;
  completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: StorageMultipartPart[]
  ): Promise<StorageObjectHead>;
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
}
