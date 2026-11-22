import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  getFirebaseProjectId,
  getServerEnvReadiness,
  hasServiceAccountCredentials,
} from '../config.ts';
import { signStreamToken, timingSafeEqual, verifyStreamToken } from '../lib/crypto.ts';
import { verifyFirebaseIdToken } from '../lib/firebaseAuth.ts';
import { FirestoreRestClient } from '../lib/firestoreRest.ts';
import { getVideoStorage } from '../services/b2Storage.ts';
import { refillUserQueue, runGlobalCronScheduler } from '../services/scheduler.ts';
import {
  disconnectYouTubeChannel,
  generateYouTubeAuthUrl,
  handleYouTubeOAuthCallback,
  refreshAndSyncChannelProfile,
} from '../services/youtube.ts';
import type { AuthUser, VideoStorageAdapter } from '../types.ts';

type Variables = {
  authUser: AuthUser;
};

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
const MAX_VIDEO_SIZE_BYTES = 256 * 1024 * 1024;
const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const MULTIPART_CHUNK_SIZE = 5 * 1024 * 1024; // 5 MiB S3/B2 minimum part size

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '\"': '&quot;',
    "'": '&#39;',
  })[char] || char);
}

function buildVideoKey(uid: string, videoId: string): string {
  return `users/${uid}/videos/${videoId}/original.mp4`;
}

async function requireFirebaseUser(
  c: Context<{ Variables: Variables }>
): Promise<AuthUser | Response> {
  const authHeader = c.req.header('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing Authorization Bearer token' }, 401);
  }
  const idToken = authHeader.slice(7).trim();
  if (!idToken) {
    return c.json({ error: 'Empty Firebase ID token' }, 401);
  }
  try {
    const projectId = getFirebaseProjectId();
    const user = await verifyFirebaseIdToken(idToken, projectId);
    if (user.email && !user.emailVerified) {
      return c.json(
        { error: 'Email verification required before accessing ShortsPilot APIs.' },
        403
      );
    }
    return user;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid Firebase ID token';
    return c.json({ error: `Authentication failed: ${msg}` }, 401);
  }
}

export function createApiApp(options: { getStorage?: () => VideoStorageAdapter } = {}) {
  const app = new Hono<{ Variables: Variables }>();
  const resolveStorage = () => (options.getStorage ? options.getStorage() : getVideoStorage());

  let globalCronInFlight = false;

  app.get('/api/health', (c) => {
    const readiness = getServerEnvReadiness();
    return c.json({
      ok: true,
      service: 'shortspilot',
      runtime: readiness.runtime,
      storageBackend: readiness.storageBackend,
      timestamp: new Date().toISOString(),
      readiness: {
        b2Configured: readiness.b2Configured,
        firebaseClientConfigured: readiness.firebaseClientConfigured,
        firebaseAdminConfigured: readiness.firebaseAdminConfigured,
        googleOAuthConfigured: readiness.googleOAuthConfigured,
        cronSecretConfigured: readiness.cronSecretConfigured,
      },
    });
  });

  app.get('/api/system/readiness', async (c) => {
    const authResult = await requireFirebaseUser(c);
    if (authResult instanceof Response) return authResult;
    return c.json(getServerEnvReadiness());
  });

  // --- YouTube OAuth Routes ---

  app.get('/api/youtube/auth-url', async (c) => {
    const authResult = await requireFirebaseUser(c);
    if (authResult instanceof Response) return authResult;
    try {
      const origin = c.req.query('origin') || c.req.header('origin');
      const url = await generateYouTubeAuthUrl(authResult.uid, origin);
      return c.json({ url });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not build OAuth URL';
      return c.json({ error: msg }, 400);
    }
  });

  async function youtubeCallbackHandler(c: Context<{ Variables: Variables }>) {
    const code = c.req.query('code') || '';
    const state = c.req.query('state') || '';
    const oauthError = c.req.query('error') || '';

    if (oauthError) {
      const safeErrorJson = JSON.stringify(oauthError);
      return c.html(
        `<!doctype html>
<html>
  <body style="background:#000;color:#f5f5f5;font-family:sans-serif;padding:32px;">
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: ${safeErrorJson} }, '*');
      }
    </script>
    <h2>YouTube authorization was not completed</h2>
    <p>${escapeHtml(oauthError)}</p>
    <p>You can close this window and try again.</p>
  </body>
</html>`,
        400
      );
    }

    if (!code || !state) {
      return c.text('Missing OAuth code or state parameter.', 400);
    }

    if (!hasServiceAccountCredentials()) {
      const safeErrorJson = JSON.stringify(
        'Firebase service account secrets (FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY) are required on Render to store encrypted OAuth refresh tokens.'
      );
      return c.html(
        `<!doctype html>
<html>
  <body style="background:#000;color:#f5f5f5;font-family:sans-serif;padding:32px;">
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: ${safeErrorJson} }, '*');
      }
    </script>
    <h2>YouTube connection could not be saved</h2>
    <p>Firebase service account secrets are not configured on the server.</p>
    <p>Set FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in Render, then retry.</p>
  </body>
</html>`,
        503
      );
    }

    try {
      const result = await handleYouTubeOAuthCallback(code, state);
      const safeChannelJson = JSON.stringify(result.channelName);
      return c.html(
        `<!doctype html>
<html>
  <body style="background:#000;color:#f5f5f5;font-family:sans-serif;padding:32px;">
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', channelName: ${safeChannelJson} }, '*');
        window.close();
      } else {
        window.location.href = '/';
      }
    </script>
    <p>YouTube channel connected. This window will close automatically.</p>
  </body>
</html>`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'OAuth callback failed';
      const safeErrorJson = JSON.stringify(msg);
      return c.html(
        `<!doctype html>
<html>
  <body style="background:#000;color:#f5f5f5;font-family:sans-serif;padding:32px;">
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: ${safeErrorJson} }, '*');
      }
    </script>
    <h2>Failed to connect YouTube channel</h2>
    <p>${escapeHtml(msg)}</p>
    <p>You can close this window and retry after fixing the issue.</p>
  </body>
</html>`,
        500
      );
    }
  }

  app.get('/api/youtube/callback', youtubeCallbackHandler);
  app.get('/api/youtube/callback/', youtubeCallbackHandler);

  app.post('/api/youtube/disconnect', async (c) => {
    const authResult = await requireFirebaseUser(c);
    if (authResult instanceof Response) return authResult;
    if (!hasServiceAccountCredentials()) {
      return c.json(
        { error: 'Firebase service account secrets are required for server-side token revocation.' },
        503
      );
    }
    try {
      await disconnectYouTubeChannel(authResult.uid);
      return c.json({ ok: true });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'Failed to disconnect YouTube channel' },
        500
      );
    }
  });

  app.post('/api/youtube/refresh', async (c) => {
    const authResult = await requireFirebaseUser(c);
    if (authResult instanceof Response) return authResult;
    if (!hasServiceAccountCredentials()) {
      return c.json(
        { error: 'Firebase service account secrets are required to refresh encrypted YouTube tokens.' },
        503
      );
    }
    try {
      const profile = await refreshAndSyncChannelProfile(authResult.uid);
      return c.json({ ok: true, profile });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'Failed to refresh YouTube token' },
        400
      );
    }
  });

  // --- Backblaze B2 Private S3-Compatible Multipart Upload & Streaming Routes ---

  const initUploadSchema = z.object({
    videoId: z.string().regex(VALID_ID_REGEX),
    filename: z.string().min(1).max(255),
    fileSize: z.number().int().positive().max(MAX_VIDEO_SIZE_BYTES),
    mimeType: z.string().min(1).max(100),
  });

  app.post('/api/storage/uploads/init', async (c) => {
    const authResult = await requireFirebaseUser(c);
    if (authResult instanceof Response) return authResult;

    const json = await c.req.json().catch(() => null);
    const parsed = initUploadSchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: 'Invalid upload metadata payload.' }, 400);
    }

    const { videoId, filename, mimeType } = parsed.data;
    if (!ALLOWED_VIDEO_TYPES.has(mimeType) && !filename.toLowerCase().endsWith('.mp4')) {
      return c.json({ error: 'Only MP4, MOV, or WebM video files are allowed.' }, 400);
    }

    const storage = resolveStorage();
    const key = buildVideoKey(authResult.uid, videoId);
    const multipart = await storage.createMultipartUpload(key, {
      contentType: mimeType || 'video/mp4',
      metadata: {
        userid: authResult.uid,
        videoid: videoId,
        filename,
      },
    });

    return c.json({
      uploadId: multipart.uploadId,
      key,
      chunkSize: MULTIPART_CHUNK_SIZE,
      storageBackend: storage.backendName,
    });
  });

  app.put('/api/storage/uploads/:videoId/part', async (c) => {
    const authResult = await requireFirebaseUser(c);
    if (authResult instanceof Response) return authResult;

    const videoId = c.req.param('videoId');
    if (!VALID_ID_REGEX.test(videoId)) {
      return c.json({ error: 'Invalid videoId' }, 400);
    }

    const uploadId = c.req.query('uploadId') || '';
    const partNumber = Number(c.req.query('partNumber') || '0');
    if (!uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
      return c.json({ error: 'Invalid uploadId or partNumber' }, 400);
    }

    const body = await c.req.arrayBuffer();
    if (!body || body.byteLength === 0 || body.byteLength > 64 * 1024 * 1024) {
      return c.json({ error: 'Invalid chunk size' }, 400);
    }

    const storage = resolveStorage();
    const key = buildVideoKey(authResult.uid, videoId);
    const uploadedPart = await storage.uploadPart(key, uploadId, partNumber, body);

    return c.json({
      partNumber: uploadedPart.partNumber,
      etag: uploadedPart.etag,
    });
  });

  const completeUploadSchema = z.object({
    uploadId: z.string().min(1),
    parts: z
      .array(
        z.object({
          partNumber: z.number().int().min(1),
          etag: z.string().min(1),
        })
      )
      .min(1),
  });

  app.post('/api/storage/uploads/:videoId/complete', async (c) => {
    const authResult = await requireFirebaseUser(c);
    if (authResult instanceof Response) return authResult;

    const videoId = c.req.param('videoId');
    if (!VALID_ID_REGEX.test(videoId)) {
      return c.json({ error: 'Invalid videoId' }, 400);
    }

    const json = await c.req.json().catch(() => null);
    const parsed = completeUploadSchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: 'Invalid multipart completion payload' }, 400);
    }

    const storage = resolveStorage();
    const key = buildVideoKey(authResult.uid, videoId);
    const completed = await storage.completeMultipartUpload(
      key,
      parsed.data.uploadId,
      parsed.data.parts
    );
    const streamToken = await signStreamToken({ uid: authResult.uid, key });

    return c.json({
      ok: true,
      storagePath: key,
      size: completed.size,
      previewUrl: `/api/storage/stream?token=${encodeURIComponent(streamToken)}`,
    });
  });

  app.post('/api/storage/uploads/:videoId/abort', async (c) => {
    const authResult = await requireFirebaseUser(c);
    if (authResult instanceof Response) return authResult;

    const videoId = c.req.param('videoId');
    if (!VALID_ID_REGEX.test(videoId)) {
      return c.json({ error: 'Invalid videoId' }, 400);
    }

    const body = (await c.req.json().catch(() => ({}))) as { uploadId?: string };
    if (!body.uploadId) {
      return c.json({ error: 'Missing uploadId' }, 400);
    }

    const storage = resolveStorage();
    const key = buildVideoKey(authResult.uid, videoId);
    await storage.abortMultipartUpload(key, body.uploadId).catch(() => {});
    return c.json({ ok: true });
  });

  app.delete('/api/storage/uploads/:videoId', async (c) => {
    const authResult = await requireFirebaseUser(c);
    if (authResult instanceof Response) return authResult;

    const videoId = c.req.param('videoId');
    if (!VALID_ID_REGEX.test(videoId)) {
      return c.json({ error: 'Invalid videoId' }, 400);
    }

    // Never delete B2 source file if Firestore indicates video is Scheduled, Processing, or Published
    if (hasServiceAccountCredentials()) {
      const db = new FirestoreRestClient();
      const vDoc = await db.getDoc(`videos/${videoId}`);
      if (vDoc.exists && vDoc.data) {
        if (vDoc.data.userId !== authResult.uid) {
          return c.json({ error: 'Forbidden' }, 403);
        }
        const status = String(vDoc.data.status || '');
        if (status === 'Scheduled' || status === 'Published' || status === 'Processing') {
          return c.json(
            { error: 'Source files for Scheduled or Published videos cannot be deleted.' },
            409
          );
        }
      }
    }

    const storage = resolveStorage();
    const key = buildVideoKey(authResult.uid, videoId);
    await storage.delete(key);
    return c.json({ ok: true });
  });

  app.get('/api/storage/video/:videoId/url', async (c) => {
    const authResult = await requireFirebaseUser(c);
    if (authResult instanceof Response) return authResult;

    const videoId = c.req.param('videoId');
    if (!VALID_ID_REGEX.test(videoId)) {
      return c.json({ error: 'Invalid videoId' }, 400);
    }

    const storage = resolveStorage();
    const key = buildVideoKey(authResult.uid, videoId);
    const head = await storage.head(key);
    if (!head) {
      return c.json({ error: 'Video file not found in storage' }, 404);
    }

    const token = await signStreamToken({ uid: authResult.uid, key });
    return c.json({ url: `/api/storage/stream?token=${encodeURIComponent(token)}` });
  });

  app.get('/api/storage/stream', async (c) => {
    const token = c.req.query('token') || '';
    if (!token) {
      return c.json({ error: 'Missing stream token' }, 401);
    }

    let claims;
    try {
      claims = await verifyStreamToken(token);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'Invalid stream token' },
        401
      );
    }

    const storage = resolveStorage();
    const rangeHeader = c.req.header('range');
    if (rangeHeader) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
      if (match) {
        const start = Number(match[1]);
        const head = await storage.head(claims.key);
        if (!head) return c.json({ error: 'Video not found' }, 404);
        const end = match[2] ? Math.min(Number(match[2]), head.size - 1) : head.size - 1;
        if (start > end || start >= head.size) {
          return new Response('Range Not Satisfiable', { status: 416 });
        }
        const length = end - start + 1;
        const obj = await storage.get(claims.key, { range: { offset: start, length } });
        if (!obj) return c.json({ error: 'Video not found' }, 404);

        return new Response(obj.body, {
          status: 206,
          headers: {
            'Content-Type': head.contentType || 'video/mp4',
            'Content-Range': `bytes ${start}-${end}/${head.size}`,
            'Content-Length': String(length),
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'private, max-age=300',
          },
        });
      }
    }

    const obj = await storage.get(claims.key);
    if (!obj) {
      return c.json({ error: 'Video not found' }, 404);
    }

    return new Response(obj.body, {
      status: 200,
      headers: {
        'Content-Type': obj.contentType || 'video/mp4',
        'Content-Length': String(obj.size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=300',
      },
    });
  });

  // --- Scheduler Routes ---

  const refillBodySchema = z
    .object({
      manual: z.boolean().optional(),
    })
    .optional();

  app.post('/api/scheduler/refill', async (c) => {
    const authResult = await requireFirebaseUser(c);
    if (authResult instanceof Response) return authResult;

    const json = await c.req.json().catch(() => undefined);
    const parsed = refillBodySchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request body' }, 400);
    }

    if (!hasServiceAccountCredentials()) {
      return c.json(
        {
          error:
            'Firebase service account secrets (FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY) are not configured on Render yet.',
        },
        503
      );
    }

    try {
      const result = await refillUserQueue(authResult.uid, {
        ignoreAutomationPause: Boolean(parsed.data?.manual),
        storage: resolveStorage(),
      });
      return c.json(result);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'Queue refill failed' },
        500
      );
    }
  });

  app.post('/api/scheduler/run', async (c) => {
    const expectedSecret = process.env.CRON_SECRET?.trim();
    if (!expectedSecret) {
      return c.json({ error: 'CRON_SECRET is not configured on the server.' }, 503);
    }

    const authHeader = c.req.header('authorization');
    const headerSecret = c.req.header('x-cron-secret');
    const provided =
      (authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null) ||
      (headerSecret ? headerSecret.trim() : null);

    if (!provided) {
      return c.json({ error: 'Missing cron authorization credentials' }, 401);
    }
    if (!timingSafeEqual(expectedSecret, provided)) {
      return c.json({ error: 'Invalid cron secret' }, 403);
    }

    if (!hasServiceAccountCredentials()) {
      return c.json({ error: 'Firebase service account secrets are not configured.' }, 503);
    }

    if (globalCronInFlight) {
      return c.json(
        {
          ok: true,
          skipped: true,
          reason: 'Scheduler execution already in progress.',
          timestamp: new Date().toISOString(),
        },
        200
      );
    }

    globalCronInFlight = true;
    try {
      const report = await runGlobalCronScheduler(resolveStorage());
      return c.json(report);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'Scheduler cron run failed' },
        500
      );
    } finally {
      globalCronInFlight = false;
    }
  });

  return app;
}

export const apiApp = createApiApp();
