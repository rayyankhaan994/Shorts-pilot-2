import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import React, { useRef, useState } from 'react';
import { formatInTimezone } from '../lib/timezone';
import type {
  PublishingSettings,
  SafeRecoveryReport,
  VideoRecord,
} from '../types/shortspilot';

interface PublishingQueueViewProps {
  videos: VideoRecord[];
  settings: PublishingSettings | null;
  refilling: boolean;
  onRefillQueue: () => Promise<void>;
  onToggleAutomation: (enabled: boolean) => Promise<void>;
  onReorderWaiting: (orderedIds: string[]) => Promise<void>;
  onRetryFailed: (videoId: string) => Promise<void>;
  onVerifyAndRecoverAll: () => Promise<SafeRecoveryReport>;
  onReuploadMissing: (
    videoId: string,
    file: File,
    onProgress: (pct: number) => void
  ) => Promise<SafeRecoveryReport>;
  onDeleteWaiting: (video: VideoRecord) => Promise<void>;
}

export function PublishingQueueView({
  videos,
  settings,
  refilling,
  onRefillQueue,
  onToggleAutomation,
  onReorderWaiting,
  onRetryFailed,
  onVerifyAndRecoverAll,
  onReuploadMissing,
  onDeleteWaiting,
}: PublishingQueueViewProps) {
  const timeZone = settings?.timezone || 'Asia/Kolkata';
  const nowMs = Date.now();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [reuploadTargetId, setReuploadTargetId] = useState<string | null>(null);
  const [reuploadProgress, setReuploadProgress] = useState<Record<string, number>>({});
  const [recoveringAll, setRecoveringAll] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState<string>('');
  const [recoveryError, setRecoveryError] = useState<string>('');

  const upcomingScheduled = videos
    .filter(
      (v) =>
        v.status === 'Scheduled' &&
        v.scheduledAt &&
        Date.parse(v.scheduledAt) > nowMs
    )
    .sort((a, b) => Date.parse(a.scheduledAt || '') - Date.parse(b.scheduledAt || ''));

  const waiting = videos
    .filter((v) => v.status === 'Waiting' || v.status === 'Uploaded')
    .sort((a, b) => (a.queueOrder ?? 0) - (b.queueOrder ?? 0));

  const failed = videos.filter((v) => v.status === 'Failed');
  const processing = videos.filter((v) => v.status === 'Processing');

  const moveWaiting = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= waiting.length) return;
    const copy = [...waiting];
    const [item] = copy.splice(index, 1);
    copy.splice(target, 0, item);
    await onReorderWaiting(copy.map((v) => v.id));
  };

  const handleVerifyAndRecoverAll = async () => {
    setRecoveringAll(true);
    setRecoveryNotice('');
    setRecoveryError('');
    try {
      const report = await onVerifyAndRecoverAll();
      setRecoveryNotice(
        `Verified against ${report.storageBackend}: restored ${report.restoredCount} video(s) with valid B2 MP4s to Waiting; ${report.missingCount} missing MP4(s) still require re-upload.`
      );
    } catch (err) {
      setRecoveryError(err instanceof Error ? err.message : 'Recovery verification failed.');
    } finally {
      setRecoveringAll(false);
    }
  };

  const handleRetrySingle = async (videoId: string) => {
    setRecoveryNotice('');
    setRecoveryError('');
    try {
      await onRetryFailed(videoId);
      setRecoveryNotice(`Verified MP4 in B2 and restored ${videoId} to Waiting.`);
    } catch (err) {
      setRecoveryError(err instanceof Error ? err.message : 'Could not verify video in B2.');
    }
  };

  const handleTriggerReupload = (videoId: string) => {
    setReuploadTargetId(videoId);
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const targetId = reuploadTargetId;
    e.target.value = '';
    if (!file || !targetId) return;

    setRecoveryNotice('');
    setRecoveryError('');
    setReuploadProgress((prev) => ({ ...prev, [targetId]: 1 }));

    try {
      const report = await onReuploadMissing(targetId, file, (pct) => {
        setReuploadProgress((prev) => ({ ...prev, [targetId]: pct }));
      });
      const item = report.results[0];
      if (item?.action === 'restored_to_waiting') {
        setRecoveryNotice(
          `Re-uploaded and verified "${file.name}" into existing slot ${targetId}. Status restored to Waiting.`
        );
      } else {
        setRecoveryError(item?.message || 'Re-upload could not be verified.');
      }
    } catch (err) {
      setRecoveryError(err instanceof Error ? err.message : 'Failed re-uploading MP4 to B2.');
    } finally {
      setReuploadProgress((prev) => {
        const next = { ...prev };
        delete next[targetId];
        return next;
      });
      setReuploadTargetId(null);
    }
  };

  return (
    <div className="space-y-8">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        className="hidden"
        onChange={handleFileSelected}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="heading-4 text-white">Publishing queue</h1>
          <p className="body-6 text-[#A3A3A3]">
            Reorder waiting clips, verify failed jobs against Backblaze B2, and monitor upcoming
            YouTube slots.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {settings && (
            <button
              type="button"
              onClick={() => onToggleAutomation(!settings.automationEnabled)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#181818] border border-[#272727] text-[#D4D4D4] button-sm hover:text-white whitespace-nowrap shrink-0"
            >
              {settings.automationEnabled ? (
                <>
                  <Pause className="w-4 h-4" />
                  <span>Pause automation</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  <span>Resume automation</span>
                </>
              )}
            </button>
          )}
          <button
            type="button"
            disabled={refilling}
            onClick={onRefillQueue}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#F5F5F5] text-[#000000] button-sm hover:bg-white disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${refilling ? 'animate-spin' : ''}`} />
            <span>{refilling ? 'Refilling...' : 'Refill Queue Now'}</span>
          </button>
        </div>
      </div>

      {/* Processing indicator */}
      {processing.length > 0 && (
        <div className="bg-[#181818] border border-[#313131] rounded-xl p-4 space-y-2">
          <p className="body-4 text-white">Currently uploading to YouTube ({processing.length})</p>
          {processing.map((v) => (
            <p key={v.id} className="caption-2 text-[#A3A3A3]">
              {v.filename} · Processing upload
            </p>
          ))}
        </div>
      )}

      {/* Upcoming Scheduled Shorts */}
      <section className="bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="title-2 text-white">
            Upcoming scheduled Shorts ({upcomingScheduled.length}/{settings?.dailyPublishingLimit ?? 6})
          </h2>
          <span className="caption-4 text-[#737373]">Protected on YouTube</span>
        </div>
        {upcomingScheduled.length === 0 ? (
          <p className="body-6 text-[#A3A3A3]">No scheduled Shorts in the upcoming queue.</p>
        ) : (
          <div className="divide-y divide-[#272727] border-t border-[#272727]">
            {upcomingScheduled.map((video, idx) => (
              <div
                key={video.id}
                className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="body-5 text-white truncate">
                    Slot {idx + 1} · {video.filename}
                  </p>
                  <p className="caption-5 text-[#A3A3A3] font-mono-tabular">
                    YouTube ID: {video.youtubeVideoId || 'Confirmed'} · {video.title}
                  </p>
                </div>
                <span className="caption-4 font-mono-tabular text-sky-400 shrink-0">
                  {formatInTimezone(video.scheduledAt, timeZone)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Waiting Queue */}
      <section className="bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="title-2 text-white">Waiting queue ({waiting.length})</h2>
          <span className="caption-4 text-[#737373]">Next eligible clips promote top to bottom</span>
        </div>

        {waiting.length === 0 ? (
          <p className="body-6 text-[#A3A3A3]">
            Waiting queue is empty. Upload more MP4 videos to keep your six scheduled slots filled.
          </p>
        ) : (
          <div className="divide-y divide-[#272727] border-t border-[#272727]">
            {waiting.map((video, idx) => (
              <div
                key={video.id}
                className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="body-5 text-white truncate">
                    #{idx + 1} · {video.filename}
                  </p>
                  <p className="caption-5 text-[#A3A3A3] truncate">{video.title}</p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => moveWaiting(idx, -1)}
                    aria-label="Move up"
                    className="p-2 rounded-lg bg-[#1F1F1F] border border-[#272727] text-[#D4D4D4] hover:text-white disabled:opacity-30"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === waiting.length - 1}
                    onClick={() => moveWaiting(idx, 1)}
                    aria-label="Move down"
                    className="p-2 rounded-lg bg-[#1F1F1F] border border-[#272727] text-[#D4D4D4] hover:text-white disabled:opacity-30"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteWaiting(video)}
                    aria-label="Remove from queue"
                    className="p-2 rounded-lg bg-[#1F1F1F] border border-[#272727] text-[#A3A3A3] hover:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Failed Uploads & Safe Recovery */}
      <section className="bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <h2 className="title-2 text-white">Failed jobs ({failed.length})</h2>
            <p className="caption-2 text-[#A3A3A3]">
              Videos only return to Waiting after Backblaze B2 verifies the source MP4 exists.
            </p>
          </div>
          {failed.length > 0 && (
            <button
              type="button"
              disabled={recoveringAll}
              onClick={handleVerifyAndRecoverAll}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#272727] border border-[#313131] text-white caption-3 hover:bg-[#313131] disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>
                {recoveringAll ? 'Checking B2 objects...' : 'Verify & recover ready jobs'}
              </span>
            </button>
          )}
        </div>

        {recoveryNotice && (
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-[#1F1F1F] border border-[#313131] text-emerald-400 caption-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{recoveryNotice}</span>
          </div>
        )}

        {recoveryError && (
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-[#1F1F1F] border border-red-900/60 text-red-400 caption-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{recoveryError}</span>
          </div>
        )}

        {failed.length === 0 ? (
          <p className="body-6 text-[#737373]">No failed uploads.</p>
        ) : (
          <div className="divide-y divide-[#272727] border-t border-[#272727]">
            {failed.map((video) => {
              const pct = reuploadProgress[video.id];
              const isMissingMsg = (video.errorMessage || '')
                .toLowerCase()
                .includes('missing from b2');

              return (
                <div
                  key={video.id}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 text-red-400">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <p className="body-5 text-white truncate">{video.filename}</p>
                    </div>
                    <p className="caption-5 text-[#737373] font-mono-tabular truncate">
                      ID: {video.id} · Path: {video.storagePath || 'Unassigned'}
                    </p>
                    <p className="caption-2 text-red-400 break-words">
                      {video.errorMessage || 'Upload failed before YouTube confirmation.'}
                    </p>
                    {typeof pct === 'number' && (
                      <div className="h-1.5 w-full max-w-xs bg-[#272727] rounded-full overflow-hidden mt-1">
                        <div className="h-full bg-white transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={typeof pct === 'number'}
                      onClick={() => handleTriggerReupload(video.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F5F5F5] text-[#000000] caption-3 hover:bg-white disabled:opacity-50"
                    >
                      <UploadCloud className="w-3.5 h-3.5" />
                      <span>
                        {typeof pct === 'number' ? `Uploading ${pct}%` : 'Re-upload MP4'}
                      </span>
                    </button>
                    {!isMissingMsg && (
                      <button
                        type="button"
                        disabled={typeof pct === 'number'}
                        onClick={() => handleRetrySingle(video.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#272727] border border-[#313131] text-white caption-3 hover:bg-[#313131] disabled:opacity-50"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Verify & restore</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDeleteWaiting(video)}
                      className="p-2 rounded-lg text-[#A3A3A3] hover:text-red-400 hover:bg-[#1F1F1F]"
                      aria-label="Delete failed entry"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
