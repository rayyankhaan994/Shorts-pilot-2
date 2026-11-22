import type { User } from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { useCallback, useEffect, useState } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import type {
  EnvReadiness,
  NotificationRecord,
  NotificationType,
  PublishingHistoryRecord,
  PublishingJobRecord,
  PublishingSettings,
  RefillResult,
  VideoRecord,
  YouTubeChannel,
} from '../types/shortspilot';

export function useShortsPilotData(user: User | null, authReady: boolean) {
  const [videos, setVideos] = useState<VideoRecord[]>([]);
  const [settings, setSettings] = useState<PublishingSettings | null>(null);
  const [channel, setChannel] = useState<YouTubeChannel | null>(null);
  const [history, setHistory] = useState<PublishingHistoryRecord[]>([]);
  const [jobs, setJobs] = useState<PublishingJobRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [readiness, setReadiness] = useState<EnvReadiness | null>(null);
  const [loading, setLoading] = useState(true);

  const isEligible = Boolean(authReady && user && user.emailVerified);

  const getIdToken = useCallback(async (): Promise<string> => {
    if (!user) throw new Error('User not signed in');
    return user.getIdToken();
  }, [user]);

  const fetchReadiness = useCallback(async () => {
    if (!user || !user.emailVerified) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/system/readiness', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setReadiness((await res.json()) as EnvReadiness);
      }
    } catch {
      // Ignore network errors on readiness check
    }
  }, [user]);

  useEffect(() => {
    if (!isEligible || !user) {
      setVideos([]);
      setSettings(null);
      setChannel(null);
      setHistory([]);
      setJobs([]);
      setNotifications([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    void fetchReadiness();

    const unsubVideos = onSnapshot(
      query(collection(db, 'videos'), where('userId', '==', user.uid)),
      (snap) => {
        const items = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<VideoRecord, 'id'>),
        }));
        items.sort((a, b) => {
          const ao = a.queueOrder ?? 0;
          const bo = b.queueOrder ?? 0;
          return ao - bo;
        });
        setVideos(items);
        setLoading(false);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'videos')
    );

    const unsubSettings = onSnapshot(
      doc(db, 'publishing_settings', user.uid),
      (snap) => {
        setSettings(snap.exists() ? (snap.data() as PublishingSettings) : null);
      },
      (err) => handleFirestoreError(err, OperationType.GET, `publishing_settings/${user.uid}`)
    );

    const unsubChannel = onSnapshot(
      doc(db, 'youtube_channels', user.uid),
      (snap) => {
        setChannel(snap.exists() ? (snap.data() as YouTubeChannel) : null);
      },
      (err) => handleFirestoreError(err, OperationType.GET, `youtube_channels/${user.uid}`)
    );

    const unsubHistory = onSnapshot(
      query(collection(db, 'publishing_history'), where('userId', '==', user.uid)),
      (snap) => {
        const items = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<PublishingHistoryRecord, 'id'>),
        }));
        items.sort((a, b) => Date.parse(b.publishedAt || '') - Date.parse(a.publishedAt || ''));
        setHistory(items);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'publishing_history')
    );

    const unsubJobs = onSnapshot(
      query(collection(db, 'publishing_jobs'), where('userId', '==', user.uid)),
      (snap) => {
        const items = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<PublishingJobRecord, 'id'>),
        }));
        items.sort((a, b) => Date.parse(a.scheduledAt || '') - Date.parse(b.scheduledAt || ''));
        setJobs(items);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'publishing_jobs')
    );

    const unsubNotifications = onSnapshot(
      query(collection(db, 'notifications'), where('userId', '==', user.uid)),
      (snap) => {
        const items = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<NotificationRecord, 'id'>),
        }));
        items.sort((a, b) => {
          const at = (a.createdAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
          const bt = (b.createdAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
          return bt - at;
        });
        setNotifications(items);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
    );

    return () => {
      unsubVideos();
      unsubSettings();
      unsubChannel();
      unsubHistory();
      unsubJobs();
      unsubNotifications();
    };
  }, [isEligible, user, fetchReadiness]);

  const emitClientNotification = useCallback(
    async (type: NotificationType, title: string, message: string) => {
      if (!user) return;
      try {
        await addDoc(collection(db, 'notifications'), {
          userId: user.uid,
          type,
          title: title.slice(0, 140),
          message: message.slice(0, 500),
          read: false,
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, 'notifications');
      }
    },
    [user]
  );

  const createVideoRecord = useCallback(
    async (payload: {
      videoId: string;
      storagePath: string;
      filename: string;
      fileSize: number;
      mimeType: string;
      duration: number;
      thumbnailUrl: string;
      queueOrder: number;
    }) => {
      if (!user) throw new Error('Not authenticated');
      const title = (settings?.defaultTitle || 'Wait Until You See This 😱 #shorts').slice(0, 100);
      const description = (settings?.defaultDescription || 'Amazing videos every day!').slice(0, 4500);
      const hashtags = (settings?.defaultHashtags || '#shorts #viral #trending #facts').slice(0, 500);

      try {
        await setDoc(doc(db, 'videos', payload.videoId), {
          userId: user.uid,
          storagePath: payload.storagePath,
          filename: payload.filename.slice(0, 255),
          fileSize: payload.fileSize,
          mimeType: payload.mimeType,
          title,
          description,
          hashtags,
          duration: Math.round(payload.duration),
          thumbnailUrl: payload.thumbnailUrl.slice(0, 2000),
          youtubeVideoId: '',
          scheduledAt: '',
          publishedAt: '',
          queueOrder: payload.queueOrder,
          status: 'Waiting',
          errorMessage: '',
          retryCount: 0,
          metadataOverride: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await emitClientNotification(
          'video_uploaded',
          'Video uploaded to waiting queue',
          `"${payload.filename}" is stored in Backblaze B2 and ready for scheduling.`
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `videos/${payload.videoId}`);
      }
    },
    [user, settings, emitClientNotification]
  );

  const updateVideoMetadata = useCallback(
    async (
      videoId: string,
      updates: { title: string; description: string; hashtags: string; metadataOverride: boolean }
    ) => {
      try {
        await updateDoc(doc(db, 'videos', videoId), {
          title: updates.title.trim().slice(0, 100),
          description: updates.description.trim().slice(0, 4500),
          hashtags: updates.hashtags.trim().slice(0, 500),
          metadataOverride: updates.metadataOverride,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `videos/${videoId}`);
      }
    },
    []
  );

  const reorderWaitingVideos = useCallback(async (orderedIds: string[]) => {
    try {
      const batch = writeBatch(db);
      orderedIds.forEach((id, index) => {
        batch.update(doc(db, 'videos', id), {
          queueOrder: index + 1,
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'videos/reorder');
    }
  }, []);

  const retryFailedVideo = useCallback(async (videoId: string) => {
    try {
      await updateDoc(doc(db, 'videos', videoId), {
        status: 'Waiting',
        errorMessage: '',
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `videos/${videoId}`);
    }
  }, []);

  const getVideoPlaybackUrl = useCallback(
    async (videoId: string): Promise<string> => {
      const token = await getIdToken();
      const res = await fetch(`/api/storage/video/${encodeURIComponent(videoId)}/url`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Could not generate video stream URL');
      }
      return data.url;
    },
    [getIdToken]
  );

  const deleteWaitingVideo = useCallback(
    async (video: VideoRecord) => {
      if (video.status === 'Scheduled' || video.status === 'Published') {
        throw new Error('Scheduled or Published YouTube videos cannot be deleted from the queue.');
      }
      try {
        if (video.storagePath) {
          const token = await getIdToken();
          const res = await fetch(`/api/storage/uploads/${encodeURIComponent(video.id)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok && res.status !== 404) {
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(data.error || 'Failed to delete source video from Backblaze B2');
          }
        }
        await deleteDoc(doc(db, 'videos', video.id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `videos/${video.id}`);
      }
    },
    [getIdToken]
  );

  const savePublishingSettings = useCallback(
    async (
      next: {
        defaultTitle: string;
        defaultDescription: string;
        defaultHashtags: string;
        timezone: string;
        dailyPublishingTimes: string[];
        dailyPublishingLimit: number;
        automationEnabled: boolean;
        autoRetry: boolean;
        autoCleanupStorage: boolean;
      },
      applyToUnpublished: boolean
    ) => {
      if (!user) throw new Error('Not authenticated');
      try {
        const wasEnabled = settings?.automationEnabled ?? true;
        await updateDoc(doc(db, 'publishing_settings', user.uid), {
          defaultTitle: next.defaultTitle.trim().slice(0, 100),
          defaultDescription: next.defaultDescription.trim().slice(0, 4500),
          defaultHashtags: next.defaultHashtags.trim().slice(0, 500),
          timezone: next.timezone.trim(),
          dailyPublishingTimes: next.dailyPublishingTimes.slice(0, 6),
          dailyPublishingLimit: Math.min(6, Math.max(1, next.dailyPublishingLimit)),
          automationEnabled: next.automationEnabled,
          autoRetry: next.autoRetry,
          autoCleanupStorage: next.autoCleanupStorage,
          updatedAt: serverTimestamp(),
        });

        if (applyToUnpublished) {
          const unpublished = videos.filter(
            (v) =>
              (v.status === 'Uploaded' || v.status === 'Waiting' || v.status === 'Failed') &&
              !v.metadataOverride
          );
          if (unpublished.length > 0) {
            const batch = writeBatch(db);
            for (const v of unpublished) {
              batch.update(doc(db, 'videos', v.id), {
                title: next.defaultTitle.trim().slice(0, 100),
                description: next.defaultDescription.trim().slice(0, 4500),
                hashtags: next.defaultHashtags.trim().slice(0, 500),
                updatedAt: serverTimestamp(),
              });
            }
            await batch.commit();
          }
        }

        if (wasEnabled && !next.automationEnabled) {
          await emitClientNotification(
            'automation_paused',
            'Automation paused',
            'Automatic six-slot queue refilling has been paused.'
          );
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `publishing_settings/${user.uid}`);
      }
    },
    [user, settings, videos, emitClientNotification]
  );

  const toggleAutomation = useCallback(
    async (enabled: boolean) => {
      if (!user) return;
      try {
        await updateDoc(doc(db, 'publishing_settings', user.uid), {
          automationEnabled: enabled,
          updatedAt: serverTimestamp(),
        });
        if (!enabled) {
          await emitClientNotification(
            'automation_paused',
            'Automation paused',
            'Automatic publishing queue refill is paused.'
          );
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `publishing_settings/${user.uid}`);
      }
    },
    [user, emitClientNotification]
  );

  const markNotificationRead = useCallback(async (id: string) => {
    try {
      await updateDoc(doc(db, 'notifications', id), { read: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `notifications/${id}`);
    }
  }, []);

  const triggerManualRefill = useCallback(
    async (manual = true): Promise<RefillResult> => {
      const token = await getIdToken();
      const res = await fetch('/api/scheduler/refill', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ manual }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to refill publishing queue');
      }
      return data as RefillResult;
    },
    [getIdToken]
  );

  const connectYouTubeChannel = useCallback(async (): Promise<void> => {
    const token = await getIdToken();
    const origin = encodeURIComponent(window.location.origin);
    const res = await fetch(`/api/youtube/auth-url?origin=${origin}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok || !data.url) {
      throw new Error(data.error || 'Could not initiate YouTube OAuth flow');
    }
    const popup = window.open(data.url, 'shortspilot_youtube_oauth', 'width=600,height=720');
    if (!popup) {
      throw new Error('Popup was blocked by your browser. Please allow popups and try again.');
    }
  }, [getIdToken]);

  const disconnectYouTubeChannel = useCallback(async () => {
    const token = await getIdToken();
    const res = await fetch('/api/youtube/disconnect', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to disconnect YouTube channel');
    }
  }, [getIdToken]);

  const refreshYouTubeChannel = useCallback(async () => {
    const token = await getIdToken();
    const res = await fetch('/api/youtube/refresh', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to refresh YouTube token');
    }
    return data;
  }, [getIdToken]);

  return {
    videos,
    settings,
    channel,
    history,
    jobs,
    notifications,
    readiness,
    loading,
    getIdToken,
    getVideoPlaybackUrl,
    fetchReadiness,
    createVideoRecord,
    updateVideoMetadata,
    reorderWaitingVideos,
    retryFailedVideo,
    deleteWaitingVideo,
    savePublishingSettings,
    toggleAutomation,
    markNotificationRead,
    triggerManualRefill,
    connectYouTubeChannel,
    disconnectYouTubeChannel,
    refreshYouTubeChannel,
  };
}
