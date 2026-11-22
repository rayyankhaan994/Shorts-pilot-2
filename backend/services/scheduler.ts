import { randomHex } from '../lib/crypto.ts';
import { FirestoreRestClient, toFirestoreFields } from '../lib/firestoreRest.ts';
import { computeUpcomingSlots } from '../lib/timezone.ts';
import type { VideoStorageAdapter } from '../types.ts';
import { getVideoStorage } from './b2Storage.ts';
import {
  deleteStoredVideoIfPresent,
  fetchExistingYouTubeScheduledTimes,
  uploadScheduledShortToYouTube,
  verifyYouTubeVideoStatus,
} from './youtube.ts';

export interface RefillResult {
  userId: string;
  locked: boolean;
  publishedVerified: number;
  newlyScheduled: number;
  upcomingScheduledCount: number;
  shortageCount: number;
  waitingRemaining: number;
  errors: string[];
  message: string;
}

interface VideoDoc {
  id: string;
  userId?: string;
  storagePath?: string;
  filename?: string;
  mimeType?: string;
  title?: string;
  description?: string;
  hashtags?: string;
  youtubeVideoId?: string;
  scheduledAt?: string;
  publishedAt?: string;
  queueOrder?: number;
  status?: string;
  retryCount?: number;
  createdAt?: string;
}

const LOCK_TTL_MS = 90 * 1000;
const inProcessLocks = new Set<string>();

async function acquireSchedulerLock(
  db: FirestoreRestClient,
  uid: string,
  ownerInstance: string
): Promise<boolean> {
  const tx = await db.beginTransaction();
  try {
    const lockPath = `scheduler_locks/${uid}`;
    const snap = await db.getDoc(lockPath, tx);
    const now = Date.now();

    if (snap.exists && snap.data) {
      const expiresAtStr = snap.data.expiresAt as string | undefined;
      const expiresAtMs = expiresAtStr ? Date.parse(expiresAtStr) : 0;
      if (expiresAtMs > now) {
        await db.rollback(tx);
        return false;
      }
    }

    const write = {
      update: {
        name: db.docName(lockPath),
        fields: toFirestoreFields({
          lockKey: uid,
          ownerInstance,
          expiresAt: new Date(now + LOCK_TTL_MS),
          createdAt: new Date(now),
        }),
      },
      currentDocument:
        snap.exists && snap.updateTime ? { updateTime: snap.updateTime } : { exists: false },
    };

    const committed = await db.commitWrites(tx, [write]);
    return committed.ok;
  } catch (err) {
    await db.rollback(tx);
    throw err;
  }
}

async function releaseSchedulerLock(
  db: FirestoreRestClient,
  uid: string,
  ownerInstance: string
): Promise<void> {
  try {
    const tx = await db.beginTransaction();
    const lockPath = `scheduler_locks/${uid}`;
    const snap = await db.getDoc(lockPath, tx);
    if (snap.exists && snap.data?.ownerInstance === ownerInstance) {
      await db.commitWrites(tx, [
        {
          delete: db.docName(lockPath),
          ...(snap.updateTime ? { currentDocument: { updateTime: snap.updateTime } } : {}),
        },
      ]);
    } else {
      await db.rollback(tx);
    }
  } catch {
    // Lock expires automatically via TTL
  }
}

async function claimVideoForPublishing(
  db: FirestoreRestClient,
  uid: string,
  videoId: string,
  idempotencyKey: string,
  slotIso: string,
  retryCount: number
): Promise<boolean> {
  const tx = await db.beginTransaction();
  try {
    const videoPath = `videos/${videoId}`;
    const jobPath = `publishing_jobs/${idempotencyKey}`;
    const vSnap = await db.getDoc(videoPath, tx);
    const jSnap = await db.getDoc(jobPath, tx);

    if (!vSnap.exists || vSnap.data?.status !== 'Waiting') {
      await db.rollback(tx);
      return false;
    }

    if (
      jSnap.exists &&
      (jSnap.data?.status === 'Scheduled' || jSnap.data?.status === 'Processing')
    ) {
      await db.rollback(tx);
      return false;
    }

    const now = new Date();
    const updatedVideoFields = {
      ...vSnap.data,
      status: 'Processing',
      errorMessage: '',
      updatedAt: now,
    };

    const writes = [
      {
        update: {
          name: db.docName(videoPath),
          fields: toFirestoreFields(updatedVideoFields),
        },
        currentDocument: vSnap.updateTime ? { updateTime: vSnap.updateTime } : { exists: true },
      },
      {
        update: {
          name: db.docName(jobPath),
          fields: toFirestoreFields({
            userId: uid,
            videoId,
            scheduledAt: slotIso,
            youtubeVideoId: '',
            status: 'Processing',
            retryCount,
            lastError: '',
            idempotencyKey,
            createdAt: now,
            updatedAt: now,
          }),
        },
        currentDocument:
          jSnap.exists && jSnap.updateTime ? { updateTime: jSnap.updateTime } : { exists: false },
      },
    ];

    const committed = await db.commitWrites(tx, writes);
    return committed.ok;
  } catch {
    await db.rollback(tx);
    return false;
  }
}

async function addNotification(
  db: FirestoreRestClient,
  uid: string,
  type:
    | 'youtube_connected'
    | 'video_uploaded'
    | 'video_scheduled'
    | 'video_published'
    | 'upload_failed'
    | 'queue_empty'
    | 'queue_refilled'
    | 'auth_expired'
    | 'quota_exhausted'
    | 'automation_paused',
  title: string,
  message: string
) {
  await db.addDoc('notifications', {
    userId: uid,
    type,
    title: title.slice(0, 140),
    message: message.slice(0, 500),
    read: false,
    createdAt: new Date(),
  });
}

export async function refillUserQueue(
  uid: string,
  options: { ignoreAutomationPause?: boolean; storage?: VideoStorageAdapter } = {}
): Promise<RefillResult> {
  if (inProcessLocks.has(uid)) {
    return {
      userId: uid,
      locked: true,
      publishedVerified: 0,
      newlyScheduled: 0,
      upcomingScheduledCount: 0,
      shortageCount: 0,
      waitingRemaining: 0,
      errors: [],
      message: 'Another scheduler execution is already processing this queue.',
    };
  }

  inProcessLocks.add(uid);
  const db = new FirestoreRestClient();
  const storage = options.storage || getVideoStorage();
  const ownerInstance = `render-${randomHex(8)}`;
  let acquired = false;

  try {
    acquired = await acquireSchedulerLock(db, uid, ownerInstance);
    if (!acquired) {
      return {
        userId: uid,
        locked: true,
        publishedVerified: 0,
        newlyScheduled: 0,
        upcomingScheduledCount: 0,
        shortageCount: 0,
        waitingRemaining: 0,
        errors: [],
        message: 'Another scheduler execution is already processing this queue.',
      };
    }

    const errors: string[] = [];
    let publishedVerified = 0;
    let newlyScheduled = 0;

    const settingsSnap = await db.getDoc(`publishing_settings/${uid}`);
    if (!settingsSnap.exists || !settingsSnap.data) {
      return {
        userId: uid,
        locked: false,
        publishedVerified: 0,
        newlyScheduled: 0,
        upcomingScheduledCount: 0,
        shortageCount: 6,
        waitingRemaining: 0,
        errors: ['Publishing settings have not been initialized yet.'],
        message: 'Initialize automation settings before scheduling.',
      };
    }

    const settings = settingsSnap.data;
    const limit = Math.min(6, Math.max(1, Number(settings.dailyPublishingLimit || 6)));
    const timeZone = String(settings.timezone || 'Asia/Kolkata');
    const dailyTimes: string[] = Array.isArray(settings.dailyPublishingTimes)
      ? (settings.dailyPublishingTimes as string[])
      : ['09:00', '12:00', '15:00', '18:00', '21:00', '23:00'];

    const channelSnap = await db.getDoc(`youtube_channels/${uid}`);
    const channelData = channelSnap.exists ? channelSnap.data : null;
    if (!channelData?.connected || channelData.tokenStatus === 'disconnected') {
      return {
        userId: uid,
        locked: false,
        publishedVerified: 0,
        newlyScheduled: 0,
        upcomingScheduledCount: 0,
        shortageCount: limit,
        waitingRemaining: 0,
        errors: ['No connected YouTube channel found.'],
        message: 'Connect your YouTube channel before scheduling Shorts.',
      };
    }

    const videoRows = await db.runQuery('videos', [
      { field: 'userId', op: 'EQUAL', value: uid },
    ]);
    const allVideos: VideoDoc[] = videoRows.map((row) => ({
      ...(row.data as Omit<VideoDoc, 'id'>),
      id: row.id,
    }));

    const nowMs = Date.now();

    // STEP 1: Verify due Scheduled videos against YouTube Data API v3
    const dueScheduled = allVideos.filter(
      (v) =>
        v.status === 'Scheduled' &&
        typeof v.youtubeVideoId === 'string' &&
        v.youtubeVideoId.length > 0 &&
        typeof v.scheduledAt === 'string' &&
        Date.parse(v.scheduledAt) <= nowMs
    );

    for (const video of dueScheduled) {
      const ytId = String(video.youtubeVideoId);
      try {
        const ytStatus = await verifyYouTubeVideoStatus(uid, ytId);
        if (ytStatus.found && ytStatus.privacyStatus === 'public') {
          const publishedIso = new Date().toISOString();
          await db.updateDoc(`videos/${video.id}`, {
            status: 'Published',
            publishedAt: publishedIso,
            errorMessage: '',
            updatedAt: new Date(),
          });

          await db.addDoc('publishing_history', {
            userId: uid,
            videoId: video.id,
            youtubeVideoId: ytId,
            title: String(video.title || ''),
            filename: String(video.filename || ''),
            scheduledAt: String(video.scheduledAt || ''),
            publishedAt: publishedIso,
            status: 'Published',
            createdAt: new Date(),
          });

          const jobRows = await db.runQuery('publishing_jobs', [
            { field: 'userId', op: 'EQUAL', value: uid },
            { field: 'videoId', op: 'EQUAL', value: video.id },
          ]);
          for (const jRow of jobRows) {
            await db.updateDoc(`publishing_jobs/${jRow.id}`, {
              status: 'Published',
              updatedAt: new Date(),
            });
          }

          if (settings.autoCleanupStorage === true && typeof video.storagePath === 'string') {
            await deleteStoredVideoIfPresent(video.storagePath, storage);
          }

          await addNotification(
            db,
            uid,
            'video_published',
            'Short published on YouTube',
            `"${String(video.filename || video.title)}" is now live on YouTube (${ytId}).`
          );

          video.status = 'Published';
          publishedVerified += 1;
        } else if (ytStatus.uploadStatus === 'failed' || ytStatus.uploadStatus === 'rejected') {
          const reason =
            ytStatus.failureReason || 'YouTube rejected or failed processing the upload.';
          await db.updateDoc(`videos/${video.id}`, {
            status: 'Failed',
            errorMessage: reason,
            updatedAt: new Date(),
          });
          video.status = 'Failed';
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Status check failed for ${ytId}: ${msg}`);
      }
    }

    // STEP 2: Respect automation pause unless manual refill was explicitly triggered
    if (!settings.automationEnabled && !options.ignoreAutomationPause) {
      const upcomingCount = allVideos.filter(
        (v) =>
          v.status === 'Scheduled' &&
          typeof v.scheduledAt === 'string' &&
          Date.parse(v.scheduledAt) > Date.now()
      ).length;
      const waitingCount = allVideos.filter((v) => v.status === 'Waiting').length;
      return {
        userId: uid,
        locked: false,
        publishedVerified,
        newlyScheduled: 0,
        upcomingScheduledCount: upcomingCount,
        shortageCount: Math.max(0, limit - upcomingCount),
        waitingRemaining: waitingCount,
        errors,
        message: 'Automation is paused. Publication verification ran without scheduling new slots.',
      };
    }

    // STEP 3: Count upcoming scheduled videos (Firestore + external YouTube channel scheduled slots)
    const firestoreScheduledVideos = allVideos.filter(
      (v) =>
        v.status === 'Scheduled' &&
        typeof v.scheduledAt === 'string' &&
        Date.parse(v.scheduledAt) > Date.now()
    );

    const firestoreScheduledIsos = firestoreScheduledVideos.map((v) => String(v.scheduledAt));
    const youtubeExternalIsos = await fetchExistingYouTubeScheduledTimes(uid);

    const uniqueUpcomingIsos: string[] = [...firestoreScheduledIsos];
    for (const ytIso of youtubeExternalIsos) {
      const ytMs = Date.parse(ytIso);
      const alreadyTracked = uniqueUpcomingIsos.some(
        (fIso) => Math.abs(Date.parse(fIso) - ytMs) < 10 * 60 * 1000
      );
      if (!alreadyTracked) {
        uniqueUpcomingIsos.push(ytIso);
      }
    }

    const currentUpcomingCount = uniqueUpcomingIsos.length;
    const slotsNeeded = Math.max(0, limit - currentUpcomingCount);

    const waitingVideos = allVideos
      .filter((v) => v.status === 'Waiting')
      .sort((a, b) => {
        const orderA = Number(a.queueOrder ?? 0);
        const orderB = Number(b.queueOrder ?? 0);
        if (orderA !== orderB) return orderA - orderB;
        const tsA = a.createdAt ? Date.parse(a.createdAt) : 0;
        const tsB = b.createdAt ? Date.parse(b.createdAt) : 0;
        return tsA - tsB;
      });

    if (slotsNeeded === 0) {
      return {
        userId: uid,
        locked: false,
        publishedVerified,
        newlyScheduled: 0,
        upcomingScheduledCount: currentUpcomingCount,
        shortageCount: 0,
        waitingRemaining: waitingVideos.length,
        errors,
        message: `Upcoming queue is full (${currentUpcomingCount}/${limit} scheduled Shorts).`,
      };
    }

    if (waitingVideos.length === 0) {
      await addNotification(
        db,
        uid,
        'queue_empty',
        'Upcoming queue needs videos',
        `Your upcoming queue has ${currentUpcomingCount}/${limit} scheduled Shorts. Upload more videos to maintain ${limit} scheduled Shorts.`
      );
      return {
        userId: uid,
        locked: false,
        publishedVerified,
        newlyScheduled: 0,
        upcomingScheduledCount: currentUpcomingCount,
        shortageCount: slotsNeeded,
        waitingRemaining: 0,
        errors,
        message: `Queue is short by ${slotsNeeded} video(s). Upload more videos to fill all ${limit} slots.`,
      };
    }

    const videosToSchedule = waitingVideos.slice(0, slotsNeeded);
    const nextSlots = computeUpcomingSlots({
      timeZone,
      dailyPublishingTimes: dailyTimes,
      existingScheduledIsos: uniqueUpcomingIsos,
      slotsNeeded: videosToSchedule.length,
    });

    for (let i = 0; i < videosToSchedule.length && i < nextSlots.length; i++) {
      const video = videosToSchedule[i];
      const slotIso = nextSlots[i];
      const idempotencyKey = `${uid}_${video.id}_${slotIso.replace(/[:.]/g, '-')}`;

      const claimed = await claimVideoForPublishing(
        db,
        uid,
        video.id,
        idempotencyKey,
        slotIso,
        Number(video.retryCount || 0)
      );
      if (!claimed) continue;

      try {
        const result = await uploadScheduledShortToYouTube(
          {
            uid,
            storagePath: String(video.storagePath),
            mimeType: String(video.mimeType || 'video/mp4'),
            title: String(video.title || settings.defaultTitle || 'ShortsPilot Video #shorts'),
            description: String(video.description ?? settings.defaultDescription ?? ''),
            hashtags: String(video.hashtags ?? settings.defaultHashtags ?? ''),
            publishAtIso: slotIso,
          },
          storage
        );

        await db.updateDoc(`videos/${video.id}`, {
          status: 'Scheduled',
          youtubeVideoId: result.youtubeVideoId,
          scheduledAt: slotIso,
          errorMessage: '',
          updatedAt: new Date(),
        });

        await db.updateDoc(`publishing_jobs/${idempotencyKey}`, {
          status: 'Scheduled',
          youtubeVideoId: result.youtubeVideoId,
          updatedAt: new Date(),
        });

        newlyScheduled += 1;
        await addNotification(
          db,
          uid,
          'video_scheduled',
          'Short scheduled on YouTube',
          `"${String(video.filename || video.title)}" scheduled for ${slotIso} (YouTube ID: ${result.youtubeVideoId}).`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isQuota = msg.toLowerCase().includes('quota');
        const nextRetryCount = Number(video.retryCount || 0) + 1;
        const canRetry = Boolean(settings.autoRetry) && !isQuota && nextRetryCount < 3;

        await db.updateDoc(`videos/${video.id}`, {
          status: canRetry ? 'Waiting' : 'Failed',
          retryCount: nextRetryCount,
          errorMessage: msg.slice(0, 1000),
          updatedAt: new Date(),
        });

        await db.updateDoc(`publishing_jobs/${idempotencyKey}`, {
          status: 'Failed',
          retryCount: nextRetryCount,
          lastError: msg.slice(0, 1000),
          updatedAt: new Date(),
        });

        await db.setDoc(
          `publishing_settings/${uid}`,
          {
            lastSchedulerError: msg.slice(0, 500),
            updatedAt: new Date(),
          },
          true
        );

        await addNotification(
          db,
          uid,
          isQuota ? 'quota_exhausted' : 'upload_failed',
          isQuota ? 'YouTube API quota reached' : 'Short upload failed',
          `Failed uploading "${String(video.filename || video.title)}": ${msg.slice(0, 350)}`
        );

        errors.push(msg);
        if (isQuota) break;
      }
    }

    const totalUpcomingAfter = currentUpcomingCount + newlyScheduled;
    const waitingRemaining = Math.max(0, waitingVideos.length - newlyScheduled);
    const shortageAfter = Math.max(0, limit - totalUpcomingAfter);

    if (newlyScheduled > 0) {
      await addNotification(
        db,
        uid,
        'queue_refilled',
        'Queue refilled',
        `Scheduled ${newlyScheduled} Short(s). Upcoming queue is at ${totalUpcomingAfter}/${limit}.`
      );
      await db.setDoc(
        `publishing_settings/${uid}`,
        {
          lastSchedulerError: '',
          updatedAt: new Date(),
        },
        true
      );
    }

    return {
      userId: uid,
      locked: false,
      publishedVerified,
      newlyScheduled,
      upcomingScheduledCount: totalUpcomingAfter,
      shortageCount: shortageAfter,
      waitingRemaining,
      errors,
      message:
        shortageAfter > 0
          ? `Scheduled ${newlyScheduled} Short(s). Upcoming queue has ${totalUpcomingAfter}/${limit}; upload ${shortageAfter} more video(s) to fill the queue.`
          : `Scheduled ${newlyScheduled} Short(s). Upcoming queue is full (${totalUpcomingAfter}/${limit}).`,
    };
  } finally {
    if (acquired) {
      await releaseSchedulerLock(db, uid, ownerInstance);
    }
    inProcessLocks.delete(uid);
  }
}

export async function runGlobalCronScheduler(storage: VideoStorageAdapter = getVideoStorage()) {
  const db = new FirestoreRestClient();
  const activeSettings = await db.runQuery('publishing_settings', [
    { field: 'automationEnabled', op: 'EQUAL', value: true },
  ]);

  const results: RefillResult[] = [];
  for (const row of activeSettings) {
    const uid = row.id;
    try {
      const res = await refillUserQueue(uid, { ignoreAutomationPause: false, storage });
      results.push(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        userId: uid,
        locked: false,
        publishedVerified: 0,
        newlyScheduled: 0,
        upcomingScheduledCount: 0,
        shortageCount: 0,
        waitingRemaining: 0,
        errors: [msg],
        message: msg,
      });
    }
  }

  return {
    processedUsers: activeSettings.length,
    timestamp: new Date().toISOString(),
    results,
  };
}
