import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { S3Client } from '@aws-sdk/client-s3';
import type { ExecutionContext, ScheduledController } from '@cloudflare/workers-types';
import { encryptSecret, toBase64Url } from '../backend/lib/crypto.ts';
import { fromFirestoreFields, toFirestoreFields } from '../backend/lib/firestoreRest.ts';
import { createApiApp } from '../backend/routes/api.ts';
import {
  createBackblazeB2Storage,
  createLocalDevStorage,
  getVideoStorage,
} from '../backend/services/b2Storage.ts';
import { refillUserQueue } from '../backend/services/scheduler.ts';
import cronRelayWorker, { runCronRelay } from '../shortspilot-cron-relay/src/index.ts';

const TEST_ENCRYPTION_KEY =
  'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
const PROJECT_ID = 'gen-lang-client-0302189886';

function arrayBufferToPem(buf: ArrayBuffer, label: string): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  const lines = b64.match(/.{1,64}/g)?.join('\n') || b64;
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
}

async function createTestRsaKeypair() {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );
  const publicJwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as JsonWebKey & {
    kid?: string;
  };
  publicJwk.kid = 'test-kid-1';
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  const privatePem = arrayBufferToPem(pkcs8, 'PRIVATE KEY');
  return { privateKey: keyPair.privateKey, publicJwk, privatePem };
}

async function mintFirebaseIdToken(
  privateKey: CryptoKey,
  uid: string,
  emailVerified = true
): Promise<string> {
  const enc = new TextEncoder();
  const nowSec = Math.floor(Date.now() / 1000);
  const header = toBase64Url(enc.encode(JSON.stringify({ alg: 'RS256', kid: 'test-kid-1' })));
  const payload = toBase64Url(
    enc.encode(
      JSON.stringify({
        aud: PROJECT_ID,
        iss: `https://securetoken.google.com/${PROJECT_ID}`,
        sub: uid,
        email: 'creator@example.com',
        email_verified: emailVerified,
        iat: nowSec - 10,
        exp: nowSec + 3600,
      })
    )
  );
  const input = `${header}.${payload}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, enc.encode(input));
  return `${input}.${toBase64Url(new Uint8Array(sig))}`;
}

function makeRelayExecCtx(): { ctx: ExecutionContext; flush: () => Promise<void> } {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(p: Promise<unknown>) {
      pending.push(p);
    },
    passThroughOnException() {},
  } as unknown as ExecutionContext;
  return {
    ctx,
    async flush() {
      await Promise.all(pending);
    },
  };
}

async function runTests() {
  const tmpStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortspilot-b2-test-'));
  const storage = createLocalDevStorage(tmpStorageDir);
  const { privateKey, publicJwk, privatePem } = await createTestRsaKeypair();

  // Save & restore env vars cleanly
  const prevEnv = { ...process.env };
  process.env.APP_URL = 'https://shortspilot.onrender.com';
  process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
  process.env.FIRESTORE_DATABASE_ID = 'ai-studio-b9d0addf-9235-428d-87b4-d952010d5b26';
  process.env.FIREBASE_CLIENT_EMAIL = 'firebase-adminsdk@example.iam.gserviceaccount.com';
  process.env.FIREBASE_PRIVATE_KEY = privatePem;
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  process.env.CRON_SECRET = 'super-secret-cron-token-123';
  process.env.B2_ENDPOINT = 'https://s3.us-west-004.backblazeb2.com';
  process.env.B2_REGION = 'us-west-004';
  process.env.B2_BUCKET_NAME = 'shortspilot-private-test';
  process.env.B2_KEY_ID = '004testkeyid';
  process.env.B2_APPLICATION_KEY = 'K004testapplicationkey';

  const apiApp = createApiApp({ getStorage: () => storage });
  const originalFetch = globalThis.fetch;

  try {
    // Test 1: Backblaze B2 S3Client adapter instantiation compiles & initializes cleanly
    {
      const b2 = createBackblazeB2Storage();
      assert.equal(b2.backendName, 'backblaze-b2');
      assert.equal(b2.isConfigured, true);
    }

    // Test 2: Health endpoint reports Render Node + Hono + B2 readiness
    {
      const res = await apiApp.fetch(new Request('https://shortspilot.onrender.com/api/health'));
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        ok: boolean;
        runtime: string;
        storageBackend: string;
        readiness: { b2Configured: boolean; cronSecretConfigured: boolean };
      };
      assert.equal(body.ok, true);
      assert.equal(body.runtime, 'render-node-hono');
      assert.equal(body.storageBackend, 'backblaze-b2');
      assert.equal(body.readiness.b2Configured, true);
      assert.equal(body.readiness.cronSecretConfigured, true);
    }

    // Test 3: Unauthenticated protected routes & bad CRON_SECRET rejected properly
    {
      for (const req of [
        new Request('https://shortspilot.onrender.com/api/system/readiness'),
        new Request('https://shortspilot.onrender.com/api/youtube/auth-url'),
        new Request('https://shortspilot.onrender.com/api/storage/uploads/init', {
          method: 'POST',
          body: '{}',
        }),
        new Request('https://shortspilot.onrender.com/api/scheduler/refill', { method: 'POST' }),
        new Request('https://shortspilot.onrender.com/api/scheduler/run', { method: 'POST' }),
        new Request('https://shortspilot.onrender.com/api/storage/diagnostics'),
        new Request('https://shortspilot.onrender.com/api/storage/recover', {
          method: 'POST',
          body: '{}',
        }),
      ]) {
        const res = await apiApp.fetch(req);
        assert.equal(res.status, 401, `Expected 401 for ${req.url}`);
      }

      const badCron = await apiApp.fetch(
        new Request('https://shortspilot.onrender.com/api/scheduler/run', {
          method: 'POST',
          headers: { Authorization: 'Bearer wrong-secret' },
        })
      );
      assert.equal(badCron.status, 403);
    }

    // Prepare in-memory Firestore REST + YouTube API state
    const uid = 'user_render_001';
    const encryptedRefresh = await encryptSecret('1//mock_refresh_token', TEST_ENCRYPTION_KEY);
    const encryptedAccess = await encryptSecret('ya29.mock_access_token', TEST_ENCRYPTION_KEY);
    const futureExpiryIso = new Date(Date.now() + 3600_000).toISOString();

    const docs = new Map<string, Record<string, unknown>>([
      [
        `publishing_settings/${uid}`,
        {
          userId: uid,
          defaultTitle: 'Test Short #shorts',
          defaultDescription: 'Daily upload',
          defaultHashtags: '#shorts #test',
          timezone: 'Asia/Kolkata',
          dailyPublishingTimes: ['09:00', '12:00', '15:00', '18:00', '21:00', '23:00'],
          dailyPublishingLimit: 6,
          automationEnabled: true,
          autoRetry: true,
          autoCleanupStorage: false,
        },
      ],
      [
        `youtube_channels/${uid}`,
        {
          userId: uid,
          channelId: 'UC_TEST_CHANNEL',
          channelName: 'ShortsPilot Test Channel',
          connected: true,
          tokenStatus: 'valid',
        },
      ],
      [
        `youtube_channel_secrets/${uid}`,
        {
          userId: uid,
          encryptedAccessToken: encryptedAccess,
          encryptedRefreshToken: encryptedRefresh,
          tokenExpiry: futureExpiryIso,
        },
      ],
      [
        'videos/vid_due_1',
        {
          userId: uid,
          storagePath: `users/${uid}/videos/vid_due_1/original.mp4`,
          filename: 'due_clip.mp4',
          mimeType: 'video/mp4',
          title: 'Due Short #shorts',
          description: 'Already uploaded',
          hashtags: '#shorts',
          youtubeVideoId: 'yt_existing_99',
          scheduledAt: new Date(Date.now() - 120_000).toISOString(),
          queueOrder: 0,
          status: 'Scheduled',
        },
      ],
      [
        'videos/vid_wait_1',
        {
          userId: uid,
          storagePath: `users/${uid}/videos/vid_wait_1/original.mp4`,
          filename: 'waiting_clip.mp4',
          mimeType: 'video/mp4',
          title: 'Waiting Short #shorts',
          description: 'Queued in B2',
          hashtags: '#shorts',
          queueOrder: 1,
          status: 'Waiting',
          retryCount: 0,
        },
      ],
    ]);

    await storage.put(`users/${uid}/videos/vid_due_1/original.mp4`, new Uint8Array([1, 2, 3, 4]));
    await storage.put(
      `users/${uid}/videos/vid_wait_1/original.mp4`,
      new Uint8Array(1024 * 64).fill(7)
    );

    let youtubeUploadInitCount = 0;
    let simulateSlowUploadMs = 0;
    let firestoreWriteCount = 0;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      // Local Render API calls routed directly into Hono app for Cron Relay tests
      if (urlStr.startsWith('https://shortspilot.onrender.com/')) {
        return apiApp.fetch(new Request(urlStr, init));
      }

      if (urlStr.includes('securetoken@system.gserviceaccount.com')) {
        return new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' },
        });
      }

      if (urlStr === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'mock-sa-token', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const firestoreMarker = '/documents';
      if (urlStr.startsWith('https://firestore.googleapis.com/v1/')) {
        if (urlStr.endsWith(':beginTransaction')) {
          return new Response(JSON.stringify({ transaction: `tx_${Date.now()}_${Math.random()}` }), {
            status: 200,
          });
        }
        if (urlStr.endsWith(':rollback')) {
          return new Response(JSON.stringify({}), { status: 200 });
        }
        if (urlStr.endsWith(':commit')) {
          firestoreWriteCount += 1;
          const body = JSON.parse(String(init?.body || '{}')) as {
            writes?: {
              update?: { name: string; fields?: Record<string, unknown> };
              delete?: string;
            }[];
          };
          for (const w of body.writes || []) {
            if (w.update?.name) {
              const rel = w.update.name.split(`${firestoreMarker}/`)[1];
              docs.set(rel, fromFirestoreFields((w.update.fields || {}) as never));
            } else if (w.delete) {
              const rel = w.delete.split(`${firestoreMarker}/`)[1];
              docs.delete(rel);
            }
          }
          return new Response(JSON.stringify({ writeResults: [] }), { status: 200 });
        }
        if (urlStr.endsWith(':runQuery')) {
          const body = JSON.parse(String(init?.body || '{}')) as {
            structuredQuery?: {
              from?: { collectionId: string }[];
              where?: {
                fieldFilter?: { field: { fieldPath: string }; value: Record<string, unknown> };
                compositeFilter?: {
                  filters: {
                    fieldFilter: { field: { fieldPath: string }; value: Record<string, unknown> };
                  }[];
                };
              };
            };
          };
          const col = body.structuredQuery?.from?.[0]?.collectionId || '';
          const filterList = body.structuredQuery?.where?.compositeFilter
            ? body.structuredQuery.where.compositeFilter.filters.map((f) => f.fieldFilter)
            : body.structuredQuery?.where?.fieldFilter
              ? [body.structuredQuery.where.fieldFilter]
              : [];

          const matched: {
            document: { name: string; fields: Record<string, unknown>; updateTime: string };
          }[] = [];
          for (const [docPath, docVal] of docs.entries()) {
            if (!docPath.startsWith(`${col}/`)) continue;
            let pass = true;
            for (const ff of filterList) {
              const parsedVal = fromFirestoreFields({ v: ff.value } as never).v;
              if (docVal[ff.field.fieldPath] !== parsedVal) {
                pass = false;
                break;
              }
            }
            if (pass) {
              matched.push({
                document: {
                  name: `projects/${PROJECT_ID}/databases/test/documents/${docPath}`,
                  fields: toFirestoreFields(docVal),
                  updateTime: '2026-11-22T00:00:00.000Z',
                },
              });
            }
          }
          return new Response(JSON.stringify(matched.length > 0 ? matched : [{}]), { status: 200 });
        }

        const relPath = urlStr.split(`${firestoreMarker}/`)[1]?.split('?')[0] || '';
        if (!init?.method || init.method === 'GET') {
          const existing = docs.get(relPath);
          if (!existing) {
            return new Response(JSON.stringify({ error: { message: 'Not found' } }), {
              status: 404,
            });
          }
          return new Response(
            JSON.stringify({
              name: `projects/${PROJECT_ID}/databases/test/documents/${relPath}`,
              fields: toFirestoreFields(existing),
              updateTime: '2026-11-22T00:00:00.000Z',
            }),
            { status: 200 }
          );
        }
        if (init.method === 'PATCH') {
          firestoreWriteCount += 1;
          const parsedBody = JSON.parse(String(init.body || '{}')) as {
            fields?: Record<string, unknown>;
          };
          const prev = docs.get(relPath) || {};
          docs.set(relPath, { ...prev, ...fromFirestoreFields((parsedBody.fields || {}) as never) });
          return new Response(JSON.stringify({ name: relPath }), { status: 200 });
        }
        if (init.method === 'POST') {
          firestoreWriteCount += 1;
          const parsedBody = JSON.parse(String(init.body || '{}')) as {
            fields?: Record<string, unknown>;
          };
          const newId = `${relPath}/doc_${docs.size + 1}`;
          docs.set(newId, fromFirestoreFields((parsedBody.fields || {}) as never));
          return new Response(
            JSON.stringify({ name: `projects/${PROJECT_ID}/databases/test/documents/${newId}` }),
            { status: 200 }
          );
        }
      }

      if (urlStr.startsWith('https://www.googleapis.com/youtube/v3/videos')) {
        return new Response(
          JSON.stringify({
            items: [{ status: { privacyStatus: 'public', uploadStatus: 'processed' } }],
          }),
          { status: 200 }
        );
      }
      if (urlStr.startsWith('https://www.googleapis.com/youtube/v3/channels')) {
        return new Response(
          JSON.stringify({
            items: [{ contentDetails: { relatedPlaylists: { uploads: 'UU_MOCK' } } }],
          }),
          { status: 200 }
        );
      }
      if (urlStr.startsWith('https://www.googleapis.com/youtube/v3/playlistItems')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      if (urlStr.startsWith('https://www.googleapis.com/upload/youtube/v3/videos')) {
        youtubeUploadInitCount += 1;
        if (simulateSlowUploadMs > 0) {
          await new Promise((r) => setTimeout(r, simulateSlowUploadMs));
        }
        return new Response('', {
          status: 200,
          headers: { Location: 'https://upload.youtube.mock/session/abc' },
        });
      }
      if (urlStr === 'https://upload.youtube.mock/session/abc') {
        return new Response(
          JSON.stringify({ id: 'yt_uploaded_new_1', status: { privacyStatus: 'private' } }),
          { status: 200 }
        );
      }

      // Mock targets for Cron Relay error handling tests
      if (urlStr === 'https://bad-upstream.onrender.com/api/scheduler/run') {
        return new Response('Bad Gateway from origin', { status: 502 });
      }
      if (urlStr === 'https://unreachable.onrender.com/api/scheduler/run') {
        throw new Error('ECONNREFUSED');
      }

      throw new Error(`Unexpected unmocked fetch call in backend test: ${urlStr}`);
    }) as typeof fetch;

    const idToken = await mintFirebaseIdToken(privateKey, uid, true);

    // Test 4: Multipart Upload Lifecycle + 200 & HTTP 206 Range Streaming
    {
      const videoId = 'vid_upload_b2_test';
      const initRes = await apiApp.fetch(
        new Request('https://shortspilot.onrender.com/api/storage/uploads/init', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            videoId,
            filename: 'demo_short.mp4',
            fileSize: 1024,
            mimeType: 'video/mp4',
          }),
        })
      );
      assert.equal(initRes.status, 200);
      const initJson = (await initRes.json()) as { uploadId: string; key: string };
      assert.ok(initJson.uploadId);
      assert.equal(initJson.key, `users/${uid}/videos/${videoId}/original.mp4`);

      const payloadBytes = new Uint8Array(1024).fill(42);
      const partRes = await apiApp.fetch(
        new Request(
          `https://shortspilot.onrender.com/api/storage/uploads/${videoId}/part?uploadId=${encodeURIComponent(
            initJson.uploadId
          )}&partNumber=1`,
          {
            method: 'PUT',
            headers: { Authorization: `Bearer ${idToken}` },
            body: payloadBytes,
          }
        )
      );
      assert.equal(partRes.status, 200);
      const partJson = (await partRes.json()) as { partNumber: number; etag: string };

      const completeRes = await apiApp.fetch(
        new Request(`https://shortspilot.onrender.com/api/storage/uploads/${videoId}/complete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            uploadId: initJson.uploadId,
            parts: [partJson],
          }),
        })
      );
      assert.equal(completeRes.status, 200);
      const completeJson = (await completeRes.json()) as {
        ok: boolean;
        size: number;
        previewUrl: string;
      };
      assert.equal(completeJson.ok, true);
      assert.equal(completeJson.size, 1024);

      const streamRes = await apiApp.fetch(
        new Request(`https://shortspilot.onrender.com${completeJson.previewUrl}`)
      );
      assert.equal(streamRes.status, 200);
      const streamedBuf = new Uint8Array(await streamRes.arrayBuffer());
      assert.equal(streamedBuf.byteLength, 1024);
      assert.equal(streamedBuf[0], 42);

      const rangeRes = await apiApp.fetch(
        new Request(`https://shortspilot.onrender.com${completeJson.previewUrl}`, {
          headers: { Range: 'bytes=0-127' },
        })
      );
      assert.equal(rangeRes.status, 206);
      assert.equal(rangeRes.headers.get('content-range'), 'bytes 0-127/1024');
      assert.equal((await rangeRes.arrayBuffer()).byteLength, 128);
    }

    // Test 5: Source deletion safeguard blocks deleting Scheduled video files
    {
      const delRes = await apiApp.fetch(
        new Request('https://shortspilot.onrender.com/api/storage/uploads/vid_due_1', {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${idToken}` },
        })
      );
      assert.equal(delRes.status, 409);
      assert.ok(await storage.head(`users/${uid}/videos/vid_due_1/original.mp4`));
    }

    // Test 6: Concurrent overlap protection + Cloudflare Cron Relay end-to-end trigger
    {
      simulateSlowUploadMs = 60;
      const { ctx, flush } = makeRelayExecCtx();

      // Trigger two overlapping requests simultaneously (Cloudflare Cron Relay + duplicate /api/scheduler/run)
      const [relayRunPromise, overlappingRunPromise] = [
        cronRelayWorker.scheduled(
          {} as ScheduledController,
          {
            RENDER_APP_URL: 'https://shortspilot.onrender.com',
            CRON_SECRET: 'super-secret-cron-token-123',
          },
          ctx
        ),
        apiApp.fetch(
          new Request('https://shortspilot.onrender.com/api/scheduler/run', {
            method: 'POST',
            headers: { Authorization: 'Bearer super-secret-cron-token-123' },
          })
        ),
      ];

      const [, overlapRes] = await Promise.all([relayRunPromise, overlappingRunPromise, flush()]);
      const overlapJson = (await overlapRes.json()) as {
        skipped?: boolean;
        processedUsers?: number;
      };

      // Exactly ONE YouTube upload should happen despite two concurrent scheduler runs!
      assert.equal(youtubeUploadInitCount, 1);
      assert.ok(
        overlapJson.skipped === true || overlapJson.processedUsers === 1,
        'Concurrent scheduler invocation must either lock safely or execute once'
      );

      assert.equal(docs.get('videos/vid_due_1')?.status, 'Published');
      assert.ok(await storage.head(`users/${uid}/videos/vid_due_1/original.mp4`));
      assert.equal(docs.get('videos/vid_wait_1')?.status, 'Scheduled');
      assert.equal(docs.get('videos/vid_wait_1')?.youtubeVideoId, 'yt_uploaded_new_1');
      assert.ok(docs.get('videos/vid_wait_1')?.scheduledAt);
      assert.equal(docs.has(`scheduler_locks/${uid}`), false);
    }

    // Test 6B: Direct concurrent refillUserQueue calls (e.g. manual refill overlapping cron)
    {
      await storage.put(
        `users/${uid}/videos/vid_wait_2/original.mp4`,
        new Uint8Array(1024 * 32).fill(9)
      );
      docs.set('videos/vid_wait_2', {
        userId: uid,
        storagePath: `users/${uid}/videos/vid_wait_2/original.mp4`,
        filename: 'waiting_clip_2.mp4',
        mimeType: 'video/mp4',
        title: 'Second Waiting Short #shorts',
        description: 'Concurrent lock test',
        hashtags: '#shorts',
        queueOrder: 2,
        status: 'Waiting',
        retryCount: 0,
      });

      const [resA, resB] = await Promise.all([
        refillUserQueue(uid, { ignoreAutomationPause: true, storage }),
        refillUserQueue(uid, { ignoreAutomationPause: true, storage }),
      ]);

      const lockedCount = [resA, resB].filter((r) => r.locked).length;
      const scheduledTotal = resA.newlyScheduled + resB.newlyScheduled;
      assert.equal(lockedCount, 1, 'Second concurrent refillUserQueue must hit per-user lock');
      assert.equal(scheduledTotal, 1, 'Waiting video must only be scheduled once');
      assert.equal(youtubeUploadInitCount, 2, 'Total YouTube uploads across tests must equal 2');
    }

    // Test 7: Cloudflare Cron Relay safety checks (missing config, non-2xx, network failure, no secret leak)
    {
      const loggedMessages: string[] = [];
      const origErr = console.error;
      const origWarn = console.warn;
      const origLog = console.log;
      console.error = (...args: unknown[]) => loggedMessages.push(args.map(String).join(' '));
      console.warn = (...args: unknown[]) => loggedMessages.push(args.map(String).join(' '));
      console.log = (...args: unknown[]) => loggedMessages.push(args.map(String).join(' '));

      try {
        const placeholderOutcome = await runCronRelay({
          RENDER_APP_URL: 'https://YOUR-RENDER-URL',
          CRON_SECRET: 'secret-never-logged',
        });
        assert.equal(placeholderOutcome.skipped, true);
        assert.equal(placeholderOutcome.ok, false);

        const missingSecretOutcome = await runCronRelay({
          RENDER_APP_URL: 'https://shortspilot.onrender.com',
          CRON_SECRET: '',
        });
        assert.equal(missingSecretOutcome.skipped, true);

        const non2xxOutcome = await runCronRelay({
          RENDER_APP_URL: 'https://bad-upstream.onrender.com',
          CRON_SECRET: 'secret-never-logged',
        });
        assert.equal(non2xxOutcome.ok, false);
        assert.equal(non2xxOutcome.status, 502);

        const networkErrOutcome = await runCronRelay({
          RENDER_APP_URL: 'https://unreachable.onrender.com',
          CRON_SECRET: 'secret-never-logged',
        });
        assert.equal(networkErrOutcome.ok, false);
        assert.equal(networkErrOutcome.status, null);

        const healthRes = await cronRelayWorker.fetch(
          new Request('https://shortspilot-cron-relay.workers.dev/')
        );
        assert.equal(healthRes.status, 200);

        for (const msg of loggedMessages) {
          assert.equal(
            msg.includes('secret-never-logged'),
            false,
            'Cron Relay logs must never expose CRON_SECRET'
          );
        }
      } finally {
        console.error = origErr;
        console.warn = origWarn;
        console.log = origLog;
      }
    }

    // Test 8: AWS SDK stream double-transformation regression guard ("The stream has already been transformed.")
    {
      let getObjectCalls = 0;
      const sampleBytes = new Uint8Array([10, 20, 30, 40, 50, 60]);
      let simulateMissingHeadOnComplete = false;

      const makeSingleUseSdkBody = (bytes: Uint8Array) => {
        let transformed = false;
        return {
          transformToWebStream() {
            if (transformed) throw new Error('The stream has already been transformed.');
            transformed = true;
            return new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(bytes);
                controller.close();
              },
            });
          },
          async transformToByteArray() {
            if (transformed) throw new Error('The stream has already been transformed.');
            transformed = true;
            return bytes;
          },
        };
      };

      const fakeS3Client = {
        async send(cmd: { constructor?: { name?: string }; input?: { Key?: string } }) {
          const name = cmd.constructor?.name || '';
          if (name === 'GetObjectCommand') {
            getObjectCalls += 1;
            return {
              ContentLength: sampleBytes.byteLength,
              ContentType: 'video/mp4',
              Body: makeSingleUseSdkBody(sampleBytes),
            };
          }
          if (name === 'HeadObjectCommand') {
            if (simulateMissingHeadOnComplete) {
              const err = Object.assign(new Error('NotFound'), {
                name: 'NotFound',
                $metadata: { httpStatusCode: 404 },
              });
              throw err;
            }
            return {
              ContentLength: sampleBytes.byteLength,
              ContentType: 'video/mp4',
              ETag: '"abc123"',
            };
          }
          if (name === 'CompleteMultipartUploadCommand') {
            return { ETag: '"abc123"' };
          }
          if (name === 'ListObjectsV2Command') {
            return {
              Contents: [{ Key: `users/${uid}/videos/vid_stream_test/original.mp4`, Size: 6 }],
            };
          }
          return {};
        },
      } as unknown as S3Client;

      const b2Mocked = createBackblazeB2Storage({
        client: fakeS3Client,
        bucketName: 'shortspilot-private-test',
        endpointHost: 's3.us-west-004.backblazeb2.com',
        region: 'us-west-004',
        regionMismatch: false,
      });

      // 8a. get() -> arrayBuffer() must NOT trigger transformToWebStream() first
      const obj1 = await b2Mocked.get(`users/${uid}/videos/vid_stream_test/original.mp4`);
      assert.ok(obj1);
      const ab1 = await obj1.arrayBuffer();
      const ab2 = await obj1.arrayBuffer();
      assert.equal(ab1.byteLength, 6);
      assert.equal(ab2.byteLength, 6);
      assert.equal(getObjectCalls, 1);

      // 8b. Reading .body after arrayBuffer() opens a fresh B2 GetObject rather than crashing
      const readerAfterAb = obj1.body.getReader();
      const read1 = await readerAfterAb.read();
      assert.equal(read1.done, false);
      assert.equal(read1.value?.byteLength, 6);
      assert.equal(getObjectCalls, 2);

      // 8c. Reading .body first then arrayBuffer() also opens a fresh B2 GetObject cleanly
      const obj2 = await b2Mocked.get(`users/${uid}/videos/vid_stream_test/original.mp4`);
      assert.ok(obj2);
      const readerFirst = obj2.body.getReader();
      const readFirst = await readerFirst.read();
      assert.equal(readFirst.value?.byteLength, 6);
      const abAfterBody = await obj2.arrayBuffer();
      assert.equal(abAfterBody.byteLength, 6);
      assert.equal(getObjectCalls, 4);

      // 8d. completeMultipartUpload rejects when HeadObject verification returns 404
      simulateMissingHeadOnComplete = true;
      await assert.rejects(
        () =>
          b2Mocked.completeMultipartUpload('users/u/videos/v/original.mp4', 'up1', [
            { partNumber: 1, etag: '"e1"' },
          ]),
        /verification failed/i
      );

      // 8e. checkHealth succeeds cleanly
      const health = await b2Mocked.checkHealth?.();
      assert.equal(health?.connected, true);
      assert.equal(health?.bucketAccessible, true);
    }

    // Test 9: Production mode refuses silent .dev-storage fallback when B2_* vars are unset
    {
      const savedNodeEnv = process.env.NODE_ENV;
      const savedB2Key = process.env.B2_KEY_ID;
      process.env.NODE_ENV = 'production';
      process.env.B2_KEY_ID = '';
      try {
        assert.throws(() => getVideoStorage(), /Backblaze B2 is not configured in production/i);
      } finally {
        process.env.NODE_ENV = savedNodeEnv;
        process.env.B2_KEY_ID = savedB2Key;
      }
    }

    // Test 10: Upload completion enforces size match against HeadObject (returns 502 on mismatch)
    {
      const videoId = 'vid_size_mismatch';
      const initRes = await apiApp.fetch(
        new Request('https://shortspilot.onrender.com/api/storage/uploads/init', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            videoId,
            filename: 'mismatch.mp4',
            fileSize: 512,
            mimeType: 'video/mp4',
          }),
        })
      );
      const initJson = (await initRes.json()) as { uploadId: string };
      const partRes = await apiApp.fetch(
        new Request(
          `https://shortspilot.onrender.com/api/storage/uploads/${videoId}/part?uploadId=${encodeURIComponent(
            initJson.uploadId
          )}&partNumber=1`,
          {
            method: 'PUT',
            headers: { Authorization: `Bearer ${idToken}` },
            body: new Uint8Array(256).fill(1),
          }
        )
      );
      const partJson = (await partRes.json()) as { partNumber: number; etag: string };

      const badComplete = await apiApp.fetch(
        new Request(`https://shortspilot.onrender.com/api/storage/uploads/${videoId}/complete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            uploadId: initJson.uploadId,
            expectedFileSize: 512,
            parts: [partJson],
          }),
        })
      );
      assert.equal(badComplete.status, 502);
      const badJson = (await badComplete.json()) as { verified: boolean; error: string };
      assert.equal(badJson.verified, false);
      assert.match(badJson.error, /size mismatch/i);
    }

    // Test 11: Authenticated B2 diagnostics & safe non-destructive recovery (never calls YouTube!)
    {
      // Seed 1 failed video missing in B2, 1 failed video present in B2 (recovering from stream bug), and 1 intact Waiting video
      docs.set('videos/vid_missing_b2', {
        userId: uid,
        storagePath: `users/${uid}/videos/vid_missing_b2/original.mp4`,
        filename: 'missing_clip.mp4',
        mimeType: 'video/mp4',
        title: 'Missing clip',
        description: '',
        hashtags: '#shorts',
        queueOrder: 10,
        status: 'Failed',
        errorMessage: 'Source video file is missing from B2 storage',
        retryCount: 3,
      });
      docs.set('videos/vid_stream_failed', {
        userId: uid,
        storagePath: `users/${uid}/videos/vid_stream_failed/original.mp4`,
        filename: 'recoverable_clip.mp4',
        mimeType: 'video/mp4',
        title: 'Stream error clip',
        description: '',
        hashtags: '#shorts',
        queueOrder: 11,
        status: 'Failed',
        errorMessage: 'The stream has already been transformed.',
        retryCount: 3,
      });
      await storage.put(
        `users/${uid}/videos/vid_stream_failed/original.mp4`,
        new Uint8Array(2048).fill(5)
      );
      docs.set('videos/vid_waiting_intact', {
        userId: uid,
        storagePath: `users/${uid}/videos/vid_waiting_intact/original.mp4`,
        filename: 'lv_0_waiting_intact.mp4',
        mimeType: 'video/mp4',
        title: 'Intact waiting clip',
        description: '',
        hashtags: '#shorts',
        queueOrder: 12,
        status: 'Waiting',
        retryCount: 0,
      });
      await storage.put(
        `users/${uid}/videos/vid_waiting_intact/original.mp4`,
        new Uint8Array(2048).fill(6)
      );

      const diagRes = await apiApp.fetch(
        new Request('https://shortspilot.onrender.com/api/storage/diagnostics', {
          headers: { Authorization: `Bearer ${idToken}` },
        })
      );
      assert.equal(diagRes.status, 200);
      const diagText = await diagRes.text();
      assert.equal(diagText.includes(process.env.B2_KEY_ID!), false, 'Must never leak B2_KEY_ID');
      assert.equal(
        diagText.includes(process.env.B2_APPLICATION_KEY!),
        false,
        'Must never leak B2_APPLICATION_KEY'
      );

      const diagJson = JSON.parse(diagText) as {
        videos: { videoId: string; b2ObjectExists: boolean; recoveryStatus: string }[];
      };
      const missingDiag = diagJson.videos.find((v) => v.videoId === 'vid_missing_b2');
      const streamDiag = diagJson.videos.find((v) => v.videoId === 'vid_stream_failed');
      assert.equal(missingDiag?.b2ObjectExists, false);
      assert.equal(missingDiag?.recoveryStatus, 'missing_requires_reupload');
      assert.equal(streamDiag?.b2ObjectExists, true);
      assert.equal(streamDiag?.recoveryStatus, 'ready_in_b2');

      const uploadsBeforeRecover = youtubeUploadInitCount;
      const recoverRes = await apiApp.fetch(
        new Request('https://shortspilot.onrender.com/api/storage/recover', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: '{}',
        })
      );
      assert.equal(recoverRes.status, 200);
      const recoverJson = (await recoverRes.json()) as {
        restoredCount: number;
        missingCount: number;
      };
      assert.equal(recoverJson.restoredCount, 1);
      assert.equal(recoverJson.missingCount, 1);
      // Must NEVER publish or trigger YouTube during recovery
      assert.equal(youtubeUploadInitCount, uploadsBeforeRecover);

      // Stream-failed video was verified in B2 and restored to Waiting with retryCount reset
      assert.equal(docs.get('videos/vid_stream_failed')?.status, 'Waiting');
      assert.equal(docs.get('videos/vid_stream_failed')?.retryCount, 0);
      // Missing video stays Failed (never falsely marked Waiting)
      assert.equal(docs.get('videos/vid_missing_b2')?.status, 'Failed');
      // Existing Waiting video stays untouched
      assert.equal(docs.get('videos/vid_waiting_intact')?.status, 'Waiting');
    }

    // Test 12: Queue eligibility & transient B2 outage protection
    {
      // Move recovered video back to Waiting queue and inject a transient B2 503 storage wrapper
      const transientStorage = {
        ...storage,
        async head() {
          const err = Object.assign(new Error('ServiceUnavailable'), {
            name: 'ServiceUnavailable',
            $metadata: { httpStatusCode: 503 },
          });
          throw err;
        },
      };

      const uploadsBeforeTransient = youtubeUploadInitCount;
      const transientRes = await refillUserQueue(uid, {
        ignoreAutomationPause: true,
        storage: transientStorage,
      });
      assert.equal(transientRes.newlyScheduled, 0);
      assert.equal(youtubeUploadInitCount, uploadsBeforeTransient);
      // Both Waiting videos remain Waiting with retryCount=0 (no permanent corruption!)
      assert.equal(docs.get('videos/vid_waiting_intact')?.status, 'Waiting');
      assert.equal(docs.get('videos/vid_waiting_intact')?.retryCount, 0);
      assert.equal(docs.get('videos/vid_stream_failed')?.status, 'Waiting');
      assert.equal(docs.get('videos/vid_stream_failed')?.retryCount, 0);

      // Now test missing-object Waiting item in front of valid Waiting items:
      docs.set('videos/vid_missing_waiting', {
        userId: uid,
        storagePath: `users/${uid}/videos/vid_missing_waiting/original.mp4`,
        filename: 'ghost_file.mp4',
        mimeType: 'video/mp4',
        title: 'Ghost',
        description: '',
        hashtags: '#shorts',
        queueOrder: 0,
        status: 'Waiting',
        retryCount: 0,
      });

      const selectiveRes = await refillUserQueue(uid, {
        ignoreAutomationPause: true,
        storage,
      });
      // Missing file must NEVER be scheduled and must be marked Failed, while valid verified videos proceed cleanly
      assert.equal(docs.get('videos/vid_missing_waiting')?.status, 'Failed');
      assert.equal(selectiveRes.newlyScheduled, 2);
      assert.equal(docs.get('videos/vid_stream_failed')?.status, 'Scheduled');
      assert.equal(docs.get('videos/vid_waiting_intact')?.status, 'Scheduled');
    }

    // Test 13: recoverFailedVideosSafely MUST ONLY touch status === 'Failed' and perform zero Firestore writes for any other status
    {
      const nonFailedCases: { id: string; status?: string; putInB2: boolean }[] = [
        { id: 'vid_nonfailed_uploaded_b2', status: 'Uploaded', putInB2: true },
        { id: 'vid_nonfailed_uploaded_missing', status: 'Uploaded', putInB2: false },
        { id: 'vid_nonfailed_unknown', status: 'DraftCustom', putInB2: true },
        { id: 'vid_nonfailed_missing_status', status: undefined, putInB2: false },
        { id: 'vid_nonfailed_waiting', status: 'Waiting', putInB2: true },
        { id: 'vid_nonfailed_processing', status: 'Processing', putInB2: true },
        { id: 'vid_nonfailed_scheduled', status: 'Scheduled', putInB2: true },
        { id: 'vid_nonfailed_published', status: 'Published', putInB2: true },
      ];

      const snapshotsBefore = new Map<string, string>();
      for (const item of nonFailedCases) {
        const key = `users/${uid}/videos/${item.id}/original.mp4`;
        const docData: Record<string, unknown> = {
          userId: uid,
          storagePath: key,
          filename: `${item.id}.mp4`,
          mimeType: 'video/mp4',
          title: item.id,
          errorMessage: 'preserved-marker',
          retryCount: 2,
          ...(item.status !== undefined ? { status: item.status } : {}),
        };
        docs.set(`videos/${item.id}`, docData);
        snapshotsBefore.set(`videos/${item.id}`, JSON.stringify(docData));
        if (item.putInB2) {
          await storage.put(key, new Uint8Array(1024).fill(9));
        }
      }

      const writesBeforeTargeted = firestoreWriteCount;
      const targetedRecover = await apiApp.fetch(
        new Request('https://shortspilot.onrender.com/api/storage/recover', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            videoIds: nonFailedCases.map((c) => c.id),
          }),
        })
      );
      assert.equal(targetedRecover.status, 200);
      const targetedJson = (await targetedRecover.json()) as {
        restoredCount: number;
        missingCount: number;
        skippedCount: number;
        results: { videoId: string; action: string }[];
      };
      assert.equal(targetedJson.restoredCount, 0);
      assert.equal(targetedJson.missingCount, 0);
      assert.equal(targetedJson.skippedCount, nonFailedCases.length);
      for (const item of nonFailedCases) {
        const r = targetedJson.results.find((res) => res.videoId === item.id);
        assert.equal(r?.action, 'skipped_not_failed', `Expected skipped_not_failed for ${item.id}`);
        assert.equal(
          JSON.stringify(docs.get(`videos/${item.id}`)),
          snapshotsBefore.get(`videos/${item.id}`),
          `Expected zero mutations on non-Failed record ${item.id}`
        );
      }
      assert.equal(
        firestoreWriteCount,
        writesBeforeTargeted,
        'Expected zero Firestore writes when recovering non-Failed records'
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(tmpStorageDir, { recursive: true, force: true });
    process.env = prevEnv;
  }

  console.log(
    'All ShortsPilot Render Node.js, Backblaze B2, and Cloudflare Cron Relay tests passed.'
  );
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
