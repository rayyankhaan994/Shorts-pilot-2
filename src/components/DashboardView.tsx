import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Pause,
  Play,
  RefreshCw,
  UploadCloud,
  Youtube,
} from 'lucide-react';
import {
  formatDateKeyInTimezone,
  formatInTimezone,
  formatTimestampField,
} from '../lib/timezone';
import type {
  NotificationRecord,
  PublishingHistoryRecord,
  PublishingSettings,
  RefillResult,
  SidebarTab,
  VideoRecord,
  YouTubeChannel,
} from '../types/shortspilot';

interface DashboardViewProps {
  videos: VideoRecord[];
  settings: PublishingSettings | null;
  channel: YouTubeChannel | null;
  history: PublishingHistoryRecord[];
  notifications: NotificationRecord[];
  loading: boolean;
  refilling: boolean;
  refillResult: RefillResult | null;
  refillError: string;
  onRefillQueue: () => Promise<void>;
  onNavigate: (tab: SidebarTab) => void;
  onToggleAutomation: (enabled: boolean) => Promise<void>;
}

export function DashboardView({
  videos,
  settings,
  channel,
  history,
  notifications,
  loading,
  refilling,
  refillResult,
  refillError,
  onRefillQueue,
  onNavigate,
  onToggleAutomation,
}: DashboardViewProps) {
  const timeZone = settings?.timezone || 'Asia/Kolkata';
  const limit = settings?.dailyPublishingLimit ?? 6;
  const nowMs = Date.now();

  const totalUploaded = videos.length;
  const waitingVideos = videos.filter((v) => v.status === 'Waiting');
  const scheduledUpcoming = videos
    .filter(
      (v) =>
        v.status === 'Scheduled' &&
        v.scheduledAt &&
        Date.parse(v.scheduledAt) > nowMs
    )
    .sort((a, b) => Date.parse(a.scheduledAt || '') - Date.parse(b.scheduledAt || ''));

  const publishedCount = videos.filter((v) => v.status === 'Published').length;
  const failedCount = videos.filter((v) => v.status === 'Failed').length;
  const upcomingCount = scheduledUpcoming.length;
  const nextScheduled = scheduledUpcoming[0] || null;

  const todayKey = formatDateKeyInTimezone(new Date(), timeZone);
  const todayPublishedCount = history.filter(
    (h) => h.publishedAt && formatDateKeyInTimezone(h.publishedAt, timeZone) === todayKey
  ).length;
  const todayScheduledCount = scheduledUpcoming.filter(
    (v) => v.scheduledAt && formatDateKeyInTimezone(v.scheduledAt, timeZone) === todayKey
  ).length;

  const automationStatusLabel = !channel?.connected
    ? 'Channel disconnected'
    : channel.tokenStatus === 'expired' || channel.tokenStatus === 'revoked'
      ? 'YouTube auth expired'
      : settings?.lastSchedulerError
        ? 'Scheduler error'
        : !settings?.automationEnabled
          ? 'Automation paused'
          : upcomingCount < limit && waitingVideos.length === 0
            ? 'Queue needs videos'
            : 'Automation active';

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-64 bg-[#181818] rounded-lg animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="h-24 bg-[#181818] border border-[#272727] rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-[#181818] border border-[#272727] rounded-2xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="heading-4 text-white">Dashboard</h1>
          <p className="body-6 text-[#A3A3A3]">
            Six daily publishing slots · {timeZone} · {automationStatusLabel}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {settings && (
            <button
              type="button"
              onClick={() => onToggleAutomation(!settings.automationEnabled)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#181818] border border-[#272727] text-[#D4D4D4] button-sm hover:text-white hover:bg-[#1F1F1F] transition-colors whitespace-nowrap shrink-0"
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
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#F5F5F5] text-[#000000] button-sm hover:bg-white active:scale-[0.98] transition-all duration-200 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${refilling ? 'animate-spin' : ''}`} />
            <span>{refilling ? 'Refilling queue...' : 'Refill Queue Now'}</span>
          </button>
        </div>
      </div>

      {/* Manual Refill Feedback */}
      {refillError && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-[#181818] border border-red-900/60 text-red-400 body-6">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{refillError}</span>
        </div>
      )}

      {refillResult && (
        <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-[#181818] border border-[#313131] text-[#F5F5F5] body-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="body-4 text-white">{refillResult.message}</p>
              <p className="caption-2 text-[#A3A3A3] font-mono-tabular">
                Scheduled now: {refillResult.newlyScheduled} · Upcoming: {refillResult.upcomingScheduledCount}/{limit} · Needed: {refillResult.shortageCount}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Shortage Warning Banner */}
      {upcomingCount < limit && waitingVideos.length === 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-[#131209] border border-amber-700/40">
          <div className="space-y-1">
            <p className="body-4 text-amber-300">
              Your upcoming queue is not full. Upload more videos to maintain six scheduled Shorts.
            </p>
            <p className="caption-2 text-[#A3A3A3]">
              Currently {upcomingCount} of {limit} upcoming Shorts are scheduled. Existing
              scheduled videos remain untouched.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('upload')}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#F5F5F5] text-[#000000] button-sm hover:bg-white whitespace-nowrap shrink-0"
          >
            <UploadCloud className="w-4 h-4" />
            <span>Upload videos</span>
          </button>
        </div>
      )}

      {/* 6 Overview Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: 'Total uploaded', value: totalUploaded },
          { label: 'Videos waiting', value: waitingVideos.length },
          { label: 'Videos scheduled', value: upcomingCount },
          { label: 'Videos published', value: publishedCount },
          { label: 'Failed videos', value: failedCount },
          { label: 'Upcoming queue', value: `${upcomingCount}/${limit}` },
        ].map((card) => (
          <div
            key={card.label}
            className="bg-[#181818] border border-[#272727] rounded-xl p-4 space-y-2"
          >
            <p className="caption-2 text-[#A3A3A3]">{card.label}</p>
            <p className="heading-5 text-white font-mono-tabular">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Main 2-Column Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upcoming Six Shorts */}
        <section className="lg:col-span-2 bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="title-2 text-white">Upcoming six Shorts</h2>
              <p className="caption-2 text-[#A3A3A3]">
                Rolling queue target: {limit} scheduled Shorts
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('queue')}
              className="caption-1 text-[#D4D4D4] hover:text-white transition-colors"
            >
              Manage queue
            </button>
          </div>

          {scheduledUpcoming.length === 0 ? (
            <div className="py-10 px-4 rounded-xl bg-[#1F1F1F] border border-[#272727] text-center space-y-3">
              <p className="body-4 text-white">No upcoming Shorts scheduled yet</p>
              <p className="body-6 text-[#A3A3A3] max-w-md mx-auto">
                Connect your YouTube channel, upload MP4 videos, and click Refill Queue Now to
                populate your next six publishing slots.
              </p>
              <div className="pt-1 flex justify-center gap-3">
                <button
                  type="button"
                  onClick={() => onNavigate('upload')}
                  className="px-3 py-2 rounded-lg bg-[#F5F5F5] text-[#000000] button-sm hover:bg-white"
                >
                  Upload videos
                </button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-[#272727] border-t border-[#272727]">
              {scheduledUpcoming.slice(0, 6).map((video, idx) => (
                <div
                  key={video.id}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="body-5 text-white truncate">
                      {idx + 1}. {video.filename}
                    </p>
                    <p className="caption-5 text-[#A3A3A3] truncate">
                      {video.title} · YouTube ID: {video.youtubeVideoId || 'Pending'}
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2 caption-4 font-mono-tabular text-emerald-400">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{formatInTimezone(video.scheduledAt, timeZone)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Channel, Next Slot & Today Progress */}
        <div className="space-y-6">
          <section className="bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="title-2 text-white">YouTube channel</h2>
              <button
                type="button"
                onClick={() => onNavigate('youtube')}
                className="caption-1 text-[#A3A3A3] hover:text-white"
              >
                Configure
              </button>
            </div>

            {channel?.connected ? (
              <div className="flex items-center gap-3">
                {channel.channelImage ? (
                  <img
                    src={channel.channelImage}
                    alt={channel.channelName}
                    referrerPolicy="no-referrer"
                    className="w-11 h-11 rounded-full object-cover border border-[#313131]"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-[#272727] flex items-center justify-center">
                    <Youtube className="w-5 h-5 text-white" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="body-4 text-white truncate">{channel.channelName}</p>
                  <p className="caption-5 text-[#A3A3A3] font-mono-tabular truncate">
                    {channel.channelId} · {channel.tokenStatus}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="body-6 text-[#A3A3A3]">
                  No YouTube channel connected yet.
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate('youtube')}
                  className="w-full py-2 px-3 rounded-lg bg-[#272727] border border-[#313131] text-white button-sm hover:bg-[#313131]"
                >
                  Connect YouTube channel
                </button>
              </div>
            )}
          </section>

          <section className="bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-4">
            <h2 className="title-2 text-white">Today in {timeZone}</h2>
            <div className="space-y-2">
              <div className="flex items-center justify-between caption-2">
                <span className="text-[#A3A3A3]">Published today</span>
                <span className="font-mono-tabular text-white">{todayPublishedCount}</span>
              </div>
              <div className="flex items-center justify-between caption-2">
                <span className="text-[#A3A3A3]">Scheduled remaining today</span>
                <span className="font-mono-tabular text-white">{todayScheduledCount}</span>
              </div>
              <div className="flex items-center justify-between caption-2 pt-2 border-t border-[#272727]">
                <span className="text-[#A3A3A3]">Next scheduled Short</span>
                <span className="font-mono-tabular text-white">
                  {nextScheduled
                    ? formatInTimezone(nextScheduled.scheduledAt, timeZone)
                    : 'None'}
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Recent Activity & Notifications */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-4">
          <h2 className="title-2 text-white">Recent publishing history</h2>
          {history.length === 0 ? (
            <p className="body-6 text-[#737373]">
              Published Shorts appear here permanently once YouTube confirms publication.
            </p>
          ) : (
            <div className="divide-y divide-[#272727]">
              {history.slice(0, 5).map((item) => (
                <div key={item.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="body-5 text-white truncate">{item.filename || item.title}</p>
                    <p className="caption-5 text-[#737373] font-mono-tabular">
                      YouTube ID: {item.youtubeVideoId}
                    </p>
                  </div>
                  <span className="caption-5 text-[#A3A3A3] font-mono-tabular shrink-0">
                    {formatInTimezone(item.publishedAt, timeZone)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="title-2 text-white">Recent notifications</h2>
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="caption-1 text-[#A3A3A3] hover:text-white"
            >
              View all
            </button>
          </div>
          {notifications.length === 0 ? (
            <p className="body-6 text-[#737373]">No notifications yet.</p>
          ) : (
            <div className="divide-y divide-[#272727]">
              {notifications.slice(0, 5).map((n) => (
                <div key={n.id} className="py-3 space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="body-5 text-white">{n.title}</p>
                    <span className="caption-5 text-[#737373] font-mono-tabular shrink-0">
                      {formatTimestampField(n.createdAt, timeZone)}
                    </span>
                  </div>
                  <p className="caption-2 text-[#A3A3A3]">{n.message}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
