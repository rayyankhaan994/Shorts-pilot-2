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
  productionMode?: boolean;
  storageBackend?: string;
  firebaseProjectId: string;
  firestoreDatabaseId: string;
  storageBucket?: string;
  b2Configured?: boolean;
  b2EndpointHost?: string;
  b2Region?: string;
  b2BucketName?: string;
  b2RegionMismatch?: boolean;
  firebaseClientConfigured: boolean;
  firebaseAdminConfigured: boolean;
  googleOAuthConfigured: boolean;
  encryptionKeyConfigured: boolean;
  cronSecretConfigured: boolean;
}

export interface StorageHealthCheck {
  backendName: 'backblaze-b2' | 'local-dev-storage';
  connected: boolean;
  bucketAccessible: boolean;
  bucketName?: string;
  endpointHost?: string;
  region?: string;
  regionMismatch?: boolean;
  error: string | null;
}

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
  readiness: EnvReadiness;
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
