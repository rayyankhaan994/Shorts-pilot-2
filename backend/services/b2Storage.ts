import fs from 'node:fs';
import path from 'node:path';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getB2Config, isProductionRuntime } from '../config.ts';
import type {
  StorageHealthCheck,
  StorageMultipartPart,
  StorageObjectBody,
  StorageObjectHead,
  StorageObjectListItem,
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

export function isTransientStorageError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    const msg = String(err || '').toLowerCase();
    return (
      msg.includes('timeout') ||
      msg.includes('timed out') ||
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('socket hang up') ||
      msg.includes('fetch failed')
    );
  }
  if (isS3NotFound(err)) return false;

  const e = err as {
    name?: string;
    code?: string;
    Code?: string;
    message?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const status = e.$metadata?.httpStatusCode;
  if (status === 429 || (typeof status === 'number' && status >= 500)) {
    return true;
  }

  const codeOrName = `${e.name || ''} ${e.code || ''} ${e.Code || ''}`.toLowerCase();
  const msg = String(e.message || '').toLowerCase();

  if (
    codeOrName.includes('timeout') ||
    codeOrName.includes('networking') ||
    codeOrName.includes('slowdown') ||
    codeOrName.includes('serviceunavailable') ||
    codeOrName.includes('internalerror') ||
    codeOrName.includes('aborterror')
  ) {
    return true;
  }

  return (
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('eai_again') ||
    msg.includes('econnrefused') ||
    msg.includes('socket hang up') ||
    msg.includes('fetch failed') ||
    msg.includes('temporarily unavailable') ||
    msg.includes('service unavailable') ||
    msg.includes('slow down')
  );
}

function sanitizeStorageErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || 'Unknown storage error');
  return raw
    .replace(/Authorization:\s*[^\s]+/gi, 'Authorization: [REDACTED]')
    .replace(/Signature=[a-zA-Z0-9%+/=_-]+/gi, 'Signature=[REDACTED]')
    .replace(/Credential=[^&\s]+/gi, 'Credential=[REDACTED]')
    .slice(0, 300);
}

function toWebReadable(body: unknown): ReadableStream<Uint8Array> {
  if (
    body &&
    typeof (body as { transformToWebStream?: () => unknown }).transformToWebStream === 'function'
  ) {
    return (body as { transformToWebStream: () => ReadableStream<Uint8Array> }).transformToWebStream();
  }
  if (body instanceof ReadableStream) {
    return body;
  }
  throw new Error('Unsupported S3 response body stream type');
}

async function bodyToUint8Array(body: unknown): Promise<Uint8Array> {
  if (
    body &&
    typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray ===
      'function'
  ) {
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

function cloneArrayBuffer(buf: ArrayBuffer): ArrayBuffer {
  return buf.slice(0);
}

export function createBackblazeB2Storage(options?: {
  client?: S3Client;
  bucketName?: string;
  endpointHost?: string;
  region?: string;
  regionMismatch?: boolean;
}): VideoStorageAdapter {
  const cfg = getB2Config();
  if (!options?.client && !cfg.configured) {
    throw new Error(
      'Backblaze B2 credentials (B2_ENDPOINT, B2_BUCKET_NAME, B2_KEY_ID, B2_APPLICATION_KEY) are not configured.'
    );
  }

  const client =
    options?.client ||
    new S3Client({
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

  const Bucket = options?.bucketName || cfg.bucketName;
  const endpointHost = options?.endpointHost || cfg.endpointHost;
  const region = options?.region || cfg.region;
  const regionMismatch = options?.regionMismatch ?? cfg.regionMismatch;

  async function fetchFreshGetResponse(key: string, rangeStr?: string) {
    return client.send(
      new GetObjectCommand({
        Bucket,
        Key: key,
        ...(rangeStr ? { Range: rangeStr } : {}),
      })
    );
  }

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
      getOptions?: { range?: { offset: number; length: number } }
    ): Promise<StorageObjectBody | null> {
      try {
        const rangeStr = getOptions?.range
          ? `bytes=${getOptions.range.offset}-${getOptions.range.offset + getOptions.range.length - 1}`
          : undefined;
        const initialRes = await fetchFreshGetResponse(key, rangeStr);
        if (!initialRes.Body) return null;

        let totalSize = Number(initialRes.ContentLength || 0);
        if (initialRes.ContentRange) {
          const m = /\/(\d+)$/.exec(initialRes.ContentRange);
          if (m) totalSize = Number(m[1]);
        }

        // Track single-use consumption on initialRes.Body so the same AWS SDK stream
        // is never transformed twice ("The stream has already been transformed.").
        let initialBodyUsed = false;
        let cachedArrayBufferPromise: Promise<ArrayBuffer> | null = null;

        const storageBody: StorageObjectBody = {
          key,
          size: totalSize,
          contentType: initialRes.ContentType,

          get body(): ReadableStream<Uint8Array> {
            if (!initialBodyUsed) {
              initialBodyUsed = true;
              return toWebReadable(initialRes.Body);
            }

            // Subsequent stream read opens a fresh B2 GetObject request transparently.
            let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
            return new ReadableStream<Uint8Array>({
              async start() {
                const fresh = await fetchFreshGetResponse(key, rangeStr);
                if (!fresh.Body) {
                  throw new Error(`Backblaze B2 object missing during stream read (${key}).`);
                }
                activeReader = toWebReadable(fresh.Body).getReader();
              },
              async pull(controller) {
                if (!activeReader) {
                  controller.close();
                  return;
                }
                const { done, value } = await activeReader.read();
                if (done) {
                  controller.close();
                  return;
                }
                if (value) controller.enqueue(value);
              },
              async cancel(reason) {
                if (activeReader) {
                  await activeReader.cancel(reason).catch(() => {});
                }
              },
            });
          },

          async arrayBuffer(): Promise<ArrayBuffer> {
            if (cachedArrayBufferPromise) {
              const buf = await cachedArrayBufferPromise;
              return cloneArrayBuffer(buf);
            }

            const readTask = (async () => {
              let sourceBody = initialRes.Body;
              if (initialBodyUsed) {
                // initialRes.Body was already consumed via .body; open a fresh B2 request.
                const fresh = await fetchFreshGetResponse(key, rangeStr);
                if (!fresh.Body) {
                  throw new Error(`Backblaze B2 object missing during buffered read (${key}).`);
                }
                sourceBody = fresh.Body;
              } else {
                initialBodyUsed = true;
              }

              const bytes = await bodyToUint8Array(sourceBody);
              return bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength
              ) as ArrayBuffer;
            })();

            cachedArrayBufferPromise = readTask;
            try {
              const buf = await readTask;
              return cloneArrayBuffer(buf);
            } catch (err) {
              // Do not cache failed reads so callers can retry cleanly
              cachedArrayBufferPromise = null;
              throw err;
            }
          },
        };

        return storageBody;
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

    async listPrefix(prefix: string, maxKeys = 25): Promise<StorageObjectListItem[]> {
      const res = await client.send(
        new ListObjectsV2Command({
          Bucket,
          Prefix: prefix,
          MaxKeys: maxKeys,
        })
      );
      return (res.Contents || [])
        .filter((item): item is { Key: string; Size?: number } => Boolean(item.Key))
        .map((item) => ({
          key: item.Key,
          size: Number(item.Size || 0),
        }));
    },

    async checkHealth(): Promise<StorageHealthCheck> {
      try {
        await client.send(
          new ListObjectsV2Command({
            Bucket,
            MaxKeys: 1,
          })
        );
        return {
          backendName: 'backblaze-b2',
          connected: true,
          bucketAccessible: true,
          bucketName: Bucket,
          endpointHost,
          region,
          regionMismatch,
          error: null,
        };
      } catch (err) {
        const msg = sanitizeStorageErrorMessage(err);
        return {
          backendName: 'backblaze-b2',
          connected: false,
          bucketAccessible: false,
          bucketName: Bucket,
          endpointHost,
          region,
          regionMismatch,
          error: msg,
        };
      }
    },

    async createMultipartUpload(
      key: string,
      uploadOptions?: { contentType?: string; metadata?: Record<string, string> }
    ): Promise<{ uploadId: string }> {
      const res = await client.send(
        new CreateMultipartUploadCommand({
          Bucket,
          Key: key,
          ContentType: uploadOptions?.contentType || 'video/mp4',
          Metadata: uploadOptions?.metadata,
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
      if (!head || head.size <= 0) {
        throw new Error(
          `Backblaze B2 verification failed after multipart upload completion: object missing or empty (${key}).`
        );
      }

      return {
        key,
        size: head.size,
        etag: res.ETag?.replace(/"/g, '') || head.etag,
        contentType: head.contentType,
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
 * Local filesystem fallback storage adapter used ONLY in non-production preview or automated tests
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
      getOptions?: { range?: { offset: number; length: number } }
    ): Promise<StorageObjectBody | null> {
      const p = resolveKeyPath(key);
      if (!fs.existsSync(p)) return null;
      const full = fs.readFileSync(p);
      const offset = getOptions?.range?.offset ?? 0;
      const length = getOptions?.range?.length ?? full.byteLength - offset;
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
        get body() {
          const copy = Uint8Array.from(arr);
          return new ReadableStream({
            start(controller) {
              controller.enqueue(copy);
              controller.close();
            },
          });
        },
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

    async listPrefix(prefix: string, maxKeys = 25): Promise<StorageObjectListItem[]> {
      const results: StorageObjectListItem[] = [];
      const walk = (dir: string) => {
        if (results.length >= maxKeys || !fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.name === '_multipart') continue;
          if (entry.isDirectory()) {
            walk(full);
          } else if (!entry.name.endsWith('.meta.json')) {
            const rel = path.relative(rootDir, full).replace(/\\/g, '/');
            if (rel.startsWith(prefix)) {
              results.push({ key: rel, size: fs.statSync(full).size });
              if (results.length >= maxKeys) return;
            }
          }
        }
      };
      walk(rootDir);
      return results;
    },

    async checkHealth(): Promise<StorageHealthCheck> {
      return {
        backendName: 'local-dev-storage',
        connected: false,
        bucketAccessible: false,
        error: 'Backblaze B2 credentials are not set; using local preview storage.',
      };
    },

    async createMultipartUpload(
      key: string,
      uploadOptions?: { contentType?: string; metadata?: Record<string, string> }
    ): Promise<{ uploadId: string }> {
      const uploadId = `b2dev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const upDir = path.join(partsRoot, uploadId);
      fs.mkdirSync(upDir, { recursive: true });
      fs.writeFileSync(
        path.join(upDir, 'meta.json'),
        JSON.stringify({ key, ...(uploadOptions || {}) })
      );
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
      if (merged.byteLength <= 0) {
        throw new Error(`Completed multipart upload is empty (${key}).`);
      }
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

  if (isProductionRuntime()) {
    throw new Error(
      'Backblaze B2 is not configured in production. Set B2_ENDPOINT, B2_REGION, B2_BUCKET_NAME, B2_KEY_ID, and B2_APPLICATION_KEY in Render Environment.'
    );
  }

  if (!warnedLocalStorage) {
    warnedLocalStorage = true;
    console.warn(
      '[ShortsPilot] Backblaze B2 env vars not set; using local .dev-storage fallback for local preview.'
    );
  }
  return createLocalDevStorage();
}
