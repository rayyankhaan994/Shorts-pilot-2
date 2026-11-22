import { getB2Config, getServerEnvReadiness, hasServiceAccountCredentials } from '../config.ts';
import { FirestoreRestClient } from '../lib/firestoreRest.ts';
import type { StorageHealthCheck, VideoStorageAdapter } from '../types.ts';
import { getVideoStorage, isTransientStorageError } from './b2Storage.ts';

export type RecoveryStatus =
  | 'ready_in_b2'
  | 'missing_requires_reupload'
  | 'already_scheduled_or_published'
  | 'storage_error';

export interface VideoStorageDiagnostic {
  videoId: string;
  filename: string;
  status: string;
  errorMessage: string;
  firestoreStoragePath: string;
  expectedStoragePath: string;
  storagePathMatchesExpected: boolean;
  b2ObjectExists: boolean;
  b2ObjectSize: number | null;
  b2ContentType: string | null;
  alternateKeysFound: string[];
  recoveryStatus: RecoveryStatus;
  recoveryNote: string;
}

export interface StorageDiagnosticsReport {
  checkedAt: string;
  readiness: ReturnType<typeof getServerEnvReadiness>;
  storageHealth: StorageHealthCheck;
  summary: {
    totalVideos: number;
    waiting: number;
    scheduled: number;
    published: number;
    failed: number;
    verifiedInB2: number;
    missingFromB2: number;
    mismatchedStoragePaths: number;
  };
  videos: VideoStorageDiagnostic[];
}

export interface SafeRecoveryItemResult {
  videoId: string;
  filename: string;
  action: 'restored_to_waiting' | 'missing_requires_reupload' | 'skipped_not_failed' | 'error';
  storagePath: string;
  size: number | null;
  message: string;
}

export interface SafeRecoveryReport {
  checkedAt: string;
  storageBackend: string;
  restoredCount: number;
  missingCount: number;
  skippedCount: number;
  results: SafeRecoveryItemResult[];
}

export function buildExpectedVideoKey(uid: string, videoId: string): string {
  return `users/${uid}/videos/${videoId}/original.mp4`;
}

async function inspectSingleVideoObject(
  uid: string,
  videoId: string,
  row: Record<string, unknown>,
  storage: VideoStorageAdapter
): Promise<VideoStorageDiagnostic> {
  const filename = String(row.filename || '');
  const status = String(row.status || 'Unknown');
  const errorMessage = String(row.errorMessage || '');
  const firestoreStoragePath = String(row.storagePath || '');
  const expectedStoragePath = buildExpectedVideoKey(uid, videoId);
  const storagePathMatchesExpected = firestoreStoragePath === expectedStoragePath;

  let b2ObjectExists = false;
  let b2ObjectSize: number | null = null;
  let b2ContentType: string | null = null;
  const alternateKeysFound: string[] = [];
  let storageErrorMsg: string | null = null;

  try {
    if (firestoreStoragePath) {
      const primaryHead = await storage.head(firestoreStoragePath);
      if (primaryHead && primaryHead.size > 0) {
        b2ObjectExists = true;
        b2ObjectSize = primaryHead.size;
        b2ContentType = primaryHead.contentType || null;
      }
    }

    if (!b2ObjectExists && expectedStoragePath !== firestoreStoragePath) {
      const expectedHead = await storage.head(expectedStoragePath);
      if (expectedHead && expectedHead.size > 0) {
        alternateKeysFound.push(expectedStoragePath);
      }
    }

    if (!b2ObjectExists && typeof storage.listPrefix === 'function') {
      const prefixMatches = await storage.listPrefix(`users/${uid}/videos/${videoId}/`, 10);
      for (const item of prefixMatches) {
        if (item.size > 0 && !alternateKeysFound.includes(item.key)) {
          alternateKeysFound.push(item.key);
        }
      }
    }
  } catch (err) {
    storageErrorMsg = err instanceof Error ? err.message : String(err);
  }

  let recoveryStatus: RecoveryStatus;
  let recoveryNote: string;

  if (storageErrorMsg) {
    recoveryStatus = 'storage_error';
    recoveryNote = `B2 lookup failed: ${storageErrorMsg}`;
  } else if (status === 'Scheduled' || status === 'Published') {
    recoveryStatus = 'already_scheduled_or_published';
    recoveryNote = b2ObjectExists
      ? 'Already on YouTube; B2 source object verified.'
      : 'Already uploaded to YouTube.';
  } else if (b2ObjectExists) {
    recoveryStatus = 'ready_in_b2';
    recoveryNote =
      status === 'Failed'
        ? 'MP4 object verified in B2. Safe to restore to Waiting.'
        : 'MP4 object verified in B2.';
  } else if (alternateKeysFound.length > 0) {
    recoveryStatus = 'ready_in_b2';
    recoveryNote = `Alternate object found in B2 (${alternateKeysFound[0]}). Safe to relink and restore.`;
  } else {
    recoveryStatus = 'missing_requires_reupload';
    recoveryNote =
      'Original MP4 object is missing from Backblaze B2. Re-upload this MP4 into the existing slot to recover.';
  }

  return {
    videoId,
    filename,
    status,
    errorMessage,
    firestoreStoragePath,
    expectedStoragePath,
    storagePathMatchesExpected,
    b2ObjectExists,
    b2ObjectSize,
    b2ContentType,
    alternateKeysFound,
    recoveryStatus,
    recoveryNote,
  };
}

export async function runStorageDiagnostics(
  uid: string,
  options: { storage?: VideoStorageAdapter; videoId?: string } = {}
): Promise<StorageDiagnosticsReport> {
  const readiness = getServerEnvReadiness();
  const cfg = getB2Config();

  let storage: VideoStorageAdapter;
  let storageHealth: StorageHealthCheck;

  try {
    storage = options.storage || getVideoStorage();
    if (typeof storage.checkHealth === 'function') {
      storageHealth = await storage.checkHealth();
    } else {
      storageHealth = {
        backendName: storage.backendName,
        connected: storage.isConfigured,
        bucketAccessible: storage.isConfigured,
        bucketName: cfg.bucketName || undefined,
        endpointHost: cfg.endpointHost || undefined,
        region: cfg.region,
        regionMismatch: cfg.regionMismatch,
        error: null,
      };
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      checkedAt: new Date().toISOString(),
      readiness,
      storageHealth: {
        backendName: 'backblaze-b2',
        connected: false,
        bucketAccessible: false,
        bucketName: cfg.bucketName || undefined,
        endpointHost: cfg.endpointHost || undefined,
        region: cfg.region,
        regionMismatch: cfg.regionMismatch,
        error: errMsg,
      },
      summary: {
        totalVideos: 0,
        waiting: 0,
        scheduled: 0,
        published: 0,
        failed: 0,
        verifiedInB2: 0,
        missingFromB2: 0,
        mismatchedStoragePaths: 0,
      },
      videos: [],
    };
  }

  const videoDiagnostics: VideoStorageDiagnostic[] = [];
  if (hasServiceAccountCredentials()) {
    const db = new FirestoreRestClient();
    if (options.videoId) {
      const snap = await db.getDoc(`videos/${options.videoId}`);
      if (!snap.exists || !snap.data) {
        throw new Error('Video not found');
      }
      if (snap.data.userId !== uid) {
        throw new Error('Forbidden');
      }
      videoDiagnostics.push(
        await inspectSingleVideoObject(uid, options.videoId, snap.data, storage)
      );
    } else {
      const rows = await db.runQuery('videos', [{ field: 'userId', op: 'EQUAL', value: uid }]);
      for (const row of rows) {
        videoDiagnostics.push(await inspectSingleVideoObject(uid, row.id, row.data, storage));
      }
    }
  }

  const summary = {
    totalVideos: videoDiagnostics.length,
    waiting: videoDiagnostics.filter((v) => v.status === 'Waiting' || v.status === 'Uploaded')
      .length,
    scheduled: videoDiagnostics.filter((v) => v.status === 'Scheduled').length,
    published: videoDiagnostics.filter((v) => v.status === 'Published').length,
    failed: videoDiagnostics.filter((v) => v.status === 'Failed').length,
    verifiedInB2: videoDiagnostics.filter(
      (v) => v.b2ObjectExists || v.alternateKeysFound.length > 0
    ).length,
    missingFromB2: videoDiagnostics.filter(
      (v) => v.recoveryStatus === 'missing_requires_reupload'
    ).length,
    mismatchedStoragePaths: videoDiagnostics.filter((v) => !v.storagePathMatchesExpected).length,
  };

  return {
    checkedAt: new Date().toISOString(),
    readiness,
    storageHealth,
    summary,
    videos: videoDiagnostics,
  };
}

/**
 * Safely verifies and recovers Failed video records ONLY when their source MP4 object
 * is verified present (size > 0) in Backblaze B2. Never calls YouTube or the scheduler,
 * never duplicates Firestore docs, and never pretends a missing MP4 exists.
 */
export async function recoverFailedVideosSafely(
  uid: string,
  options: { videoIds?: string[]; storage?: VideoStorageAdapter } = {}
): Promise<SafeRecoveryReport> {
  const storage = options.storage || getVideoStorage();
  const db = new FirestoreRestClient();

  const targetIds = options.videoIds?.filter(Boolean);
  const rows = targetIds && targetIds.length > 0
    ? (
        await Promise.all(
          targetIds.map(async (id) => {
            const snap = await db.getDoc(`videos/${id}`);
            if (!snap.exists || !snap.data) return null;
            if (snap.data.userId !== uid) {
              throw new Error(`Forbidden access to video ${id}`);
            }
            return { id, data: snap.data };
          })
        )
      ).filter((r): r is { id: string; data: Record<string, unknown> } => Boolean(r))
    : (await db.runQuery('videos', [{ field: 'userId', op: 'EQUAL', value: uid }])).filter(
        (r) => r.data.status === 'Failed'
      );

  const results: SafeRecoveryItemResult[] = [];
  let restoredCount = 0;
  let missingCount = 0;
  let skippedCount = 0;

  for (const row of rows) {
    const filename = String(row.data.filename || row.id);
    const status = String(row.data.status || '');
    const currentStoragePath = String(row.data.storagePath || '');
    const expectedPath = buildExpectedVideoKey(uid, row.id);

    if (status !== 'Failed') {
      skippedCount += 1;
      results.push({
        videoId: row.id,
        filename,
        action: 'skipped_not_failed',
        storagePath: currentStoragePath || expectedPath,
        size: typeof row.data.fileSize === 'number' ? row.data.fileSize : null,
        message: `Video status is "${status || 'Unknown'}" (not Failed) and was left untouched.`,
      });
      continue;
    }

    // Check candidate paths in B2 (primary stored path, canonical path, then prefix scan)
    const candidatePaths: string[] = [];
    if (currentStoragePath) candidatePaths.push(currentStoragePath);
    if (!candidatePaths.includes(expectedPath)) candidatePaths.push(expectedPath);
    if (typeof storage.listPrefix === 'function') {
      try {
        const alt = await storage.listPrefix(`users/${uid}/videos/${row.id}/`, 10);
        for (const item of alt) {
          if (item.size > 0 && !candidatePaths.includes(item.key)) {
            candidatePaths.push(item.key);
          }
        }
      } catch {
        // Ignore prefix scan error; primary head check below is authoritative
      }
    }

    let verifiedHead: { key: string; size: number; contentType?: string } | null = null;
    let checkError: unknown = null;

    for (const candidate of candidatePaths) {
      try {
        const head = await storage.head(candidate);
        if (head && head.size > 0) {
          verifiedHead = {
            key: candidate,
            size: head.size,
            contentType: head.contentType,
          };
          break;
        }
      } catch (err) {
        checkError = err;
        break;
      }
    }

    if (checkError) {
      results.push({
        videoId: row.id,
        filename,
        action: 'error',
        storagePath: currentStoragePath || expectedPath,
        size: null,
        message: isTransientStorageError(checkError)
          ? 'Temporary Backblaze B2 connection error while checking this file. Please retry.'
          : checkError instanceof Error
            ? checkError.message
            : 'Backblaze B2 check failed.',
      });
      continue;
    }

    if (!verifiedHead) {
      missingCount += 1;
      const missingMessage = `Original MP4 missing from B2 storage (${currentStoragePath || expectedPath}). Re-upload this MP4 into slot ${row.id} to recover.`;
      await db.updateDoc(`videos/${row.id}`, {
        status: 'Failed',
        errorMessage: missingMessage.slice(0, 1000),
        updatedAt: new Date(),
      });
      results.push({
        videoId: row.id,
        filename,
        action: 'missing_requires_reupload',
        storagePath: currentStoragePath || expectedPath,
        size: null,
        message: missingMessage,
      });
      continue;
    }

    // Verified in B2: safely restore existing Firestore record (preserving videoId, queueOrder, metadata)
    await db.updateDoc(`videos/${row.id}`, {
      status: 'Waiting',
      storagePath: verifiedHead.key,
      fileSize: verifiedHead.size,
      ...(verifiedHead.contentType ? { mimeType: verifiedHead.contentType } : {}),
      errorMessage: '',
      retryCount: 0,
      updatedAt: new Date(),
    });

    restoredCount += 1;
    results.push({
      videoId: row.id,
      filename,
      action: 'restored_to_waiting',
      storagePath: verifiedHead.key,
      size: verifiedHead.size,
      message: 'Verified MP4 in Backblaze B2 and restored existing video record to Waiting.',
    });
  }

  return {
    checkedAt: new Date().toISOString(),
    storageBackend: storage.backendName,
    restoredCount,
    missingCount,
    skippedCount,
    results,
  };
}
