export type VideoStatus =
  | 'Uploaded'
  | 'Waiting'
  | 'Processing'
  | 'Scheduled'
  | 'Published'
  | 'Failed';

export type SidebarTab =
  | 'dashboard'
  | 'videos'
  | 'upload'
  | 'queue'
  | 'calendar'
  | 'automation'
  | 'youtube'
  | 'settings';

export interface VideoRecord {
  id: string;
  userId: string;
  storagePath: string;
  filename: string;
  fileSize?: number;
  mimeType?: string;
  title: string;
  description: string;
  hashtags: string;
  duration: number;
  thumbnailUrl?: string;
  youtubeVideoId?: string;
  scheduledAt?: string;
  publishedAt?: string;
  queueOrder: number;
  status: VideoStatus;
  errorMessage?: string;
  retryCount: number;
  metadataOverride?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PublishingSettings {
  userId: string;
  defaultTitle: string;
  defaultDescription: string;
  defaultHashtags: string;
  timezone: string;
  dailyPublishingTimes: string[];
  dailyPublishingLimit: number;
  automationEnabled: boolean;
  autoRetry: boolean;
  autoCleanupStorage: boolean;
  lastSchedulerError?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface YouTubeChannel {
  userId: string;
  channelId: string;
  channelName: string;
  channelImage?: string;
  connected: boolean;
  tokenStatus: 'valid' | 'expired' | 'revoked' | 'disconnected';
  tokenExpiry?: string;
  connectedAt?: unknown;
  updatedAt?: unknown;
}

export interface PublishingJobRecord {
  id: string;
  userId: string;
  videoId: string;
  scheduledAt: string;
  youtubeVideoId?: string;
  status: 'Pending' | 'Processing' | 'Scheduled' | 'Published' | 'Failed';
  retryCount: number;
  lastError?: string;
  idempotencyKey: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PublishingHistoryRecord {
  id: string;
  userId: string;
  videoId: string;
  youtubeVideoId: string;
  title: string;
  filename: string;
  scheduledAt?: string;
  publishedAt: string;
  status: 'Published';
  createdAt?: unknown;
}

export type NotificationType =
  | 'youtube_connected'
  | 'video_uploaded'
  | 'video_scheduled'
  | 'video_published'
  | 'upload_failed'
  | 'queue_empty'
  | 'queue_refilled'
  | 'auth_expired'
  | 'quota_exhausted'
  | 'automation_paused';

export interface NotificationRecord {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  createdAt?: unknown;
}

export interface EnvReadiness {
  appUrl: string;
  runtime?: string;
  storageBackend?: string;
  firebaseProjectId: string;
  firestoreDatabaseId: string;
  storageBucket?: string;
  b2Configured?: boolean;
  firebaseClientConfigured: boolean;
  firebaseAdminConfigured: boolean;
  googleOAuthConfigured: boolean;
  encryptionKeyConfigured: boolean;
  cronSecretConfigured: boolean;
}

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
