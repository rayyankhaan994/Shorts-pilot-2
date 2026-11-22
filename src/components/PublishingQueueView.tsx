import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { formatInTimezone } from '../lib/timezone';
import type { PublishingSettings, VideoRecord } from '../types/shortspilot';

interface PublishingQueueViewProps {
  videos: VideoRecord[];
  settings: PublishingSettings | null;
  refilling: boolean;
  onRefillQueue: () => Promise<void>;
  onToggleAutomation: (enabled: boolean) => Promise<void>;
  onReorderWaiting: (orderedIds: string[]) => Promise<void>;
  onRetryFailed: (videoId: string) => Promise<void>;
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
  onDeleteWaiting,
}: PublishingQueueViewProps) {
  const timeZone = settings?.timezone || 'Asia/Kolkata';
  const nowMs = Date.now();

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

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="heading-4 text-white">Publishing queue</h1>
          <p className="body-6 text-[#A3A3A3]">
            Reorder waiting clips, retry failed uploads, and monitor upcoming YouTube slots.
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

      {/* Failed Uploads */}
      <section className="bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-4">
        <h2 className="title-2 text-white">Failed jobs ({failed.length})</h2>
        {failed.length === 0 ? (
          <p className="body-6 text-[#737373]">No failed uploads.</p>
        ) : (
          <div className="divide-y divide-[#272727] border-t border-[#272727]">
            {failed.map((video) => (
              <div
                key={video.id}
                className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 text-red-400">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <p className="body-5 text-white truncate">{video.filename}</p>
                  </div>
                  <p className="caption-2 text-red-400 break-words">
                    {video.errorMessage || 'Upload failed before YouTube confirmation.'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onRetryFailed(video.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#272727] border border-[#313131] text-white caption-3 hover:bg-[#313131]"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Move back to waiting</span>
                  </button>
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
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
