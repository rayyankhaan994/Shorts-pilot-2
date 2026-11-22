import fs from 'node:fs';
import path from 'node:path';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getB2Config } from '../config.ts';
import type {
  StorageMultipartPart,
  StorageObjectBody,
  StorageObjectHead,
  VideoStorageAdapter,
} from '../types.ts';

let warnedLocalStorage = false;
let cachedB2Adapter: VideoStorageAdapter | null = null;
let cachedB2Signature = '';

function isS3NotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e.name === 'NotFound' ||
    e.name === 'NoSuchKey' ||
    e.Code === 'NoSuchKey' ||
    e.$metadata?.httpStatusCode === 404
  );
}

function toWebReadable(body: unknown): ReadableStream<Uint8Array> {
  if (body && typeof (body as { transformToWebStream?: () => unknown }).transformToWebStream === 'function') {
    return (body as { transformToWebStream: () => ReadableStream<Uint8Array> }).transformToWebStream();
  }
  if (body instanceof ReadableStream) {
    return body;
  }
  throw new Error('Unsupported S3 response body stream type');
}

async function bodyToUint8Array(body: unknown): Promise<Uint8Array> {
  if (body && typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === 'function') {
    return (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
  }
  const stream = toWebReadable(body);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return merged;
}

export function createBackblazeB2Storage(): VideoStorageAdapter {
  const cfg = getB2Config();
  if (!cfg.configured) {
    throw new Error(
      'Backblaze B2 credentials (B2_ENDPOINT, B2_BUCKET_NAME, B2_KEY_ID, B2_APPLICATION_KEY) are not configured.'
    );
  }

  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    credentials: {
      accessKeyId: cfg.keyId,
      secretAccessKey: cfg.applicationKey,
    },
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  const Bucket = cfg.bucketName;

  const adapter: VideoStorageAdapter = {
    backendName: 'backblaze-b2',
    isConfigured: true,

    async head(key: string): Promise<StorageObjectHead | null> {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return {
          key,
          size: Number(res.ContentLength || 0),
          etag: res.ETag?.replace(/"/g, ''),
          contentType: res.ContentType,
          metadata: res.Metadata,
        };
      } catch (err) {
        if (isS3NotFound(err)) return null;
        throw err;
      }
    },

    async get(
      key: string,
      options?: { range?: { offset: number; length: number } }
    ): Promise<StorageObjectBody | null> {
      try {
        const rangeStr = options?.range
          ? `bytes=${options.range.offset}-${options.range.offset + options.range.length - 1}`
          : undefined;
        const res = await client.send(
          new GetObjectCommand({
            Bucket,
            Key: key,
            ...(rangeStr ? { Range: rangeStr } : {}),
          })
        );
        if (!res.Body) return null;

        let totalSize = Number(res.ContentLength || 0);
        if (res.ContentRange) {
          const m = /\/(\d+)$/.exec(res.ContentRange);
          if (m) totalSize = Number(m[1]);
        }

        return {
          key,
          size: totalSize,
          contentType: res.ContentType,
          body: toWebReadable(res.Body),
          async arrayBuffer() {
            const bytes = await bodyToUint8Array(res.Body);
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
          },
        };
      } catch (err) {
        if (isS3NotFound(err)) return null;
        throw err;
      }
    },

    async put(
      key: string,
      value: ArrayBuffer | Uint8Array | string,
      contentType = 'video/mp4'
    ): Promise<StorageObjectHead> {
      const body =
        typeof value === 'string'
          ? Buffer.from(value)
          : Buffer.from(value instanceof Uint8Array ? value : new Uint8Array(value));
      const res = await client.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        })
      );
      return {
        key,
        size: body.byteLength,
        etag: res.ETag?.replace(/"/g, ''),
        contentType,
      };
    },

    async delete(key: string): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },

    async createMultipartUpload(
      key: string,
      options?: { contentType?: string; metadata?: Record<string, string> }
    ): Promise<{ uploadId: string }> {
      const res = await client.send(
        new CreateMultipartUploadCommand({
          Bucket,
          Key: key,
          ContentType: options?.contentType || 'video/mp4',
          Metadata: options?.metadata,
        })
      );
      if (!res.UploadId) {
        throw new Error('Backblaze B2 did not return a multipart UploadId.');
      }
      return { uploadId: res.UploadId };
    },

    async uploadPart(
      key: string,
      uploadId: string,
      partNumber: number,
      value: ArrayBuffer | Uint8Array
    ): Promise<StorageMultipartPart> {
      const buf = Buffer.from(value instanceof Uint8Array ? value : new Uint8Array(value));
      const res = await client.send(
        new UploadPartCommand({
          Bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: buf,
          ContentLength: buf.byteLength,
        })
      );
      if (!res.ETag) {
        throw new Error(`Backblaze B2 did not return an ETag for part ${partNumber}.`);
      }
      return {
        partNumber,
        etag: res.ETag,
      };
    },

    async completeMultipartUpload(
      key: string,
      uploadId: string,
      parts: StorageMultipartPart[]
    ): Promise<StorageObjectHead> {
      const sorted = [...parts]
        .sort((a, b) => a.partNumber - b.partNumber)
        .map((p) => ({
          PartNumber: p.partNumber,
          ETag: p.etag,
        }));

      const res = await client.send(
        new CompleteMultipartUploadCommand({
          Bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: sorted },
        })
      );

      const head = await adapter.head(key);
      return {
        key,
        size: head?.size ?? 0,
        etag: res.ETag?.replace(/"/g, '') || head?.etag,
        contentType: head?.contentType,
      };
    },

    async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
      await client.send(
        new AbortMultipartUploadCommand({
          Bucket,
          Key: key,
          UploadId: uploadId,
        })
      );
    },
  };

  return adapter;
}

/**
 * Local filesystem fallback storage adapter used ONLY in AI Studio preview or automated tests
 * when Backblaze B2 credentials are not set in process.env.
 */
export function createLocalDevStorage(
  rootDir = path.resolve(process.cwd(), '.dev-storage')
): VideoStorageAdapter {
  fs.mkdirSync(rootDir, { recursive: true });
  const partsRoot = path.join(rootDir, '_multipart');
  fs.mkdirSync(partsRoot, { recursive: true });

  const resolveKeyPath = (key: string) => {
    const safe = path.resolve(rootDir, key.replace(/^\/+/, ''));
    if (!safe.startsWith(rootDir + path.sep)) {
      throw new Error('Invalid storage key path');
    }
    return safe;
  };

  const resolveMetaPath = (key: string) => `${resolveKeyPath(key)}.meta.json`;

  return {
    backendName: 'local-dev-storage',
    isConfigured: false,

    async head(key: string): Promise<StorageObjectHead | null> {
      const p = resolveKeyPath(key);
      if (!fs.existsSync(p)) return null;
      const stat = fs.statSync(p);
      const mp = resolveMetaPath(key);
      const meta = fs.existsSync(mp)
        ? (JSON.parse(fs.readFileSync(mp, 'utf8')) as {
            contentType?: string;
            metadata?: Record<string, string>;
          })
        : {};
      return {
        key,
        size: stat.size,
        etag: `${stat.size}-${stat.mtimeMs}`,
        contentType: meta.contentType || 'video/mp4',
        metadata: meta.metadata,
      };
    },

    async get(
      key: string,
      options?: { range?: { offset: number; length: number } }
    ): Promise<StorageObjectBody | null> {
      const p = resolveKeyPath(key);
      if (!fs.existsSync(p)) return null;
      const full = fs.readFileSync(p);
      const offset = options?.range?.offset ?? 0;
      const length = options?.range?.length ?? full.byteLength - offset;
      const slice = full.subarray(offset, offset + length);
      const mp = resolveMetaPath(key);
      const meta = fs.existsSync(mp)
        ? (JSON.parse(fs.readFileSync(mp, 'utf8')) as { contentType?: string })
        : {};
      const arr = Uint8Array.from(slice);
      return {
        key,
        size: full.byteLength,
        contentType: meta.contentType || 'video/mp4',
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(arr);
            controller.close();
          },
        }),
        async arrayBuffer() {
          return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength);
        },
      };
    },

    async put(
      key: string,
      value: ArrayBuffer | Uint8Array | string,
      contentType = 'video/mp4'
    ): Promise<StorageObjectHead> {
      const p = resolveKeyPath(key);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      const buf =
        typeof value === 'string'
          ? Buffer.from(value)
          : Buffer.from(value instanceof Uint8Array ? value : new Uint8Array(value));
      fs.writeFileSync(p, buf);
      fs.writeFileSync(resolveMetaPath(key), JSON.stringify({ contentType }));
      return { key, size: buf.byteLength, etag: `${buf.byteLength}`, contentType };
    },

    async delete(key: string): Promise<void> {
      const p = resolveKeyPath(key);
      const mp = resolveMetaPath(key);
      if (fs.existsSync(p)) fs.rmSync(p);
      if (fs.existsSync(mp)) fs.rmSync(mp);
    },

    async createMultipartUpload(
      key: string,
      options?: { contentType?: string; metadata?: Record<string, string> }
    ): Promise<{ uploadId: string }> {
      const uploadId = `b2dev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const upDir = path.join(partsRoot, uploadId);
      fs.mkdirSync(upDir, { recursive: true });
      fs.writeFileSync(path.join(upDir, 'meta.json'), JSON.stringify({ key, ...(options || {}) }));
      return { uploadId };
    },

    async uploadPart(
      _key: string,
      uploadId: string,
      partNumber: number,
      value: ArrayBuffer | Uint8Array
    ): Promise<StorageMultipartPart> {
      const upDir = path.join(partsRoot, uploadId);
      fs.mkdirSync(upDir, { recursive: true });
      const buf = Buffer.from(value instanceof Uint8Array ? value : new Uint8Array(value));
      fs.writeFileSync(path.join(upDir, `part_${partNumber}`), buf);
      return { partNumber, etag: `"etag_${partNumber}_${buf.byteLength}"` };
    },

    async completeMultipartUpload(
      key: string,
      uploadId: string,
      parts: StorageMultipartPart[]
    ): Promise<StorageObjectHead> {
      const upDir = path.join(partsRoot, uploadId);
      const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
      const chunks = sorted.map((p) => fs.readFileSync(path.join(upDir, `part_${p.partNumber}`)));
      const merged = Buffer.concat(chunks);
      const dest = resolveKeyPath(key);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, merged);
      const metaFile = path.join(upDir, 'meta.json');
      let contentType = 'video/mp4';
      if (fs.existsSync(metaFile)) {
        const parsed = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as {
          contentType?: string;
          metadata?: Record<string, string>;
        };
        contentType = parsed.contentType || 'video/mp4';
        fs.writeFileSync(resolveMetaPath(key), JSON.stringify(parsed));
      }
      fs.rmSync(upDir, { recursive: true, force: true });
      return { key, size: merged.byteLength, etag: `${merged.byteLength}`, contentType };
    },

    async abortMultipartUpload(_key: string, uploadId: string): Promise<void> {
      const upDir = path.join(partsRoot, uploadId);
      fs.rmSync(upDir, { recursive: true, force: true });
    },
  };
}

export function getVideoStorage(): VideoStorageAdapter {
  const cfg = getB2Config();
  if (cfg.configured) {
    const sig = `${cfg.endpoint}|${cfg.region}|${cfg.bucketName}|${cfg.keyId}`;
    if (!cachedB2Adapter || cachedB2Signature !== sig) {
      cachedB2Adapter = createBackblazeB2Storage();
      cachedB2Signature = sig;
    }
    return cachedB2Adapter;
  }

  if (!warnedLocalStorage) {
    warnedLocalStorage = true;
    console.warn(
      '[ShortsPilot] Backblaze B2 env vars not set; using local .dev-storage fallback for preview.'
    );
  }
  return createLocalDevStorage();
}
