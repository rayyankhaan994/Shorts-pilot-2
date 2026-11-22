import { Calendar, ChevronLeft, ChevronRight, Clock, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  formatDateKeyInTimezone,
  formatInTimezone,
  formatTimeOnlyInTimezone,
} from '../lib/timezone';
import type {
  PublishingHistoryRecord,
  PublishingSettings,
  VideoRecord,
} from '../types/shortspilot';

interface PublishingCalendarViewProps {
  videos: VideoRecord[];
  history: PublishingHistoryRecord[];
  settings: PublishingSettings | null;
}

interface CalendarEventItem {
  id: string;
  dateKey: string;
  timestampIso: string;
  title: string;
  filename: string;
  status: 'Scheduled' | 'Published' | 'Failed';
  youtubeVideoId?: string;
  errorMessage?: string;
}

export function PublishingCalendarView({
  videos,
  history,
  settings,
}: PublishingCalendarViewProps) {
  const [viewMode, setViewMode] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventItem | null>(null);

  const timeZone = settings?.timezone || 'Asia/Kolkata';

  const events = useMemo(() => {
    const list: CalendarEventItem[] = [];
    const seenVideoIds = new Set<string>();

    for (const v of videos) {
      if (v.status === 'Scheduled' && v.scheduledAt) {
        seenVideoIds.add(v.id);
        list.push({
          id: v.id,
          dateKey: formatDateKeyInTimezone(v.scheduledAt, timeZone),
          timestampIso: v.scheduledAt,
          title: v.title,
          filename: v.filename,
          status: 'Scheduled',
          youtubeVideoId: v.youtubeVideoId,
        });
      } else if (v.status === 'Published' && (v.publishedAt || v.scheduledAt)) {
        const ts = v.publishedAt || v.scheduledAt || '';
        seenVideoIds.add(v.id);
        list.push({
          id: v.id,
          dateKey: formatDateKeyInTimezone(ts, timeZone),
          timestampIso: ts,
          title: v.title,
          filename: v.filename,
          status: 'Published',
          youtubeVideoId: v.youtubeVideoId,
        });
      } else if (v.status === 'Failed' && v.scheduledAt) {
        list.push({
          id: v.id,
          dateKey: formatDateKeyInTimezone(v.scheduledAt, timeZone),
          timestampIso: v.scheduledAt,
          title: v.title,
          filename: v.filename,
          status: 'Failed',
          errorMessage: v.errorMessage,
        });
      }
    }

    for (const h of history) {
      if (!seenVideoIds.has(h.videoId) && h.publishedAt) {
        list.push({
          id: h.id,
          dateKey: formatDateKeyInTimezone(h.publishedAt, timeZone),
          timestampIso: h.publishedAt,
          title: h.title,
          filename: h.filename,
          status: 'Published',
          youtubeVideoId: h.youtubeVideoId,
        });
      }
    }

    list.sort((a, b) => Date.parse(a.timestampIso) - Date.parse(b.timestampIso));
    return list;
  }, [videos, history, timeZone]);

  const navigatePeriod = (delta: number) => {
    const next = new Date(anchorDate);
    if (viewMode === 'daily') next.setDate(next.getDate() + delta);
    else if (viewMode === 'weekly') next.setDate(next.getDate() + delta * 7);
    else next.setMonth(next.getMonth() + delta);
    setAnchorDate(next);
  };

  const dayColumns = useMemo(() => {
    if (viewMode === 'daily') {
      return [anchorDate];
    }
    if (viewMode === 'weekly') {
      const start = new Date(anchorDate);
      const dayOfWeek = start.getDay();
      start.setDate(start.getDate() - dayOfWeek);
      return Array.from({ length: 7 }).map((_, i) => {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        return d;
      });
    }
    const year = anchorDate.getFullYear();
    const month = anchorDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: daysInMonth }).map((_, i) => new Date(year, month, i + 1));
  }, [anchorDate, viewMode]);

  const anchorLabel =
    viewMode === 'monthly'
      ? anchorDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : viewMode === 'daily'
        ? anchorDate.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
        : `Week of ${dayColumns[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="heading-4 text-white">Publishing calendar</h1>
          <p className="body-6 text-[#A3A3A3]">
            Scheduled, published, and failed Shorts slots in {timeZone}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-[#181818] border border-[#272727] rounded-lg">
            {(['daily', 'weekly', 'monthly'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 rounded-md caption-3 capitalize transition-colors ${
                  viewMode === mode
                    ? 'bg-[#272727] text-white'
                    : 'text-[#A3A3A3] hover:text-white'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => navigatePeriod(-1)}
              aria-label="Previous period"
              className="p-2 rounded-lg bg-[#181818] border border-[#272727] text-white hover:bg-[#1F1F1F]"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setAnchorDate(new Date())}
              className="px-3 py-2 rounded-lg bg-[#181818] border border-[#272727] text-[#D4D4D4] caption-3 hover:text-white"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => navigatePeriod(1)}
              aria-label="Next period"
              className="p-2 rounded-lg bg-[#181818] border border-[#272727] text-white hover:bg-[#1F1F1F]"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 title-3 text-white">
        <Calendar className="w-4 h-4 text-[#A3A3A3]" />
        <span>{anchorLabel}</span>
      </div>

      {/* Calendar Grid */}
      <div
        className={`grid gap-3 ${
          viewMode === 'daily'
            ? 'grid-cols-1'
            : viewMode === 'weekly'
              ? 'grid-cols-1 md:grid-cols-7'
              : 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-7'
        }`}
      >
        {dayColumns.map((day) => {
          const key = formatDateKeyInTimezone(day, timeZone);
          const dayEvents = events.filter((e) => e.dateKey === key);
          return (
            <div
              key={key}
              className="bg-[#181818] border border-[#272727] rounded-xl p-3 space-y-2.5 min-h-[140px]"
            >
              <div className="flex items-center justify-between pb-2 border-b border-[#272727]">
                <span className="caption-3 text-white font-mono-tabular">
                  {day.toLocaleDateString('en-US', {
                    weekday: viewMode === 'monthly' ? undefined : 'short',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
                <span className="caption-5 text-[#737373] font-mono-tabular">
                  {dayEvents.length}
                </span>
              </div>

              {dayEvents.length === 0 ? (
                <p className="caption-5 text-[#525252]">No slots</p>
              ) : (
                <div className="space-y-2">
                  {dayEvents.map((ev) => (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => setSelectedEvent(ev)}
                      className="w-full text-left p-2 rounded-lg bg-[#1F1F1F] border border-[#272727] hover:border-[#525252] transition-colors space-y-0.5"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="caption-5 font-mono-tabular text-white">
                          {formatTimeOnlyInTimezone(ev.timestampIso, timeZone)}
                        </span>
                        <span
                          className={`caption-5 ${
                            ev.status === 'Published'
                              ? 'text-emerald-400'
                              : ev.status === 'Failed'
                                ? 'text-red-400'
                                : 'text-sky-400'
                          }`}
                        >
                          {ev.status}
                        </span>
                      </div>
                      <p className="caption-4 text-[#D4D4D4] truncate">{ev.filename}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selectedEvent && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="heading-6 text-white">Slot details</h2>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                aria-label="Close slot details"
                className="p-1.5 rounded-lg text-[#A3A3A3] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 body-6">
              <p className="text-white body-4">{selectedEvent.filename}</p>
              <p className="text-[#A3A3A3]">{selectedEvent.title}</p>
              <div className="flex items-center gap-2 caption-2 font-mono-tabular text-[#D4D4D4] pt-2">
                <Clock className="w-4 h-4" />
                <span>{formatInTimezone(selectedEvent.timestampIso, timeZone)}</span>
              </div>
              {selectedEvent.youtubeVideoId && (
                <p className="caption-2 font-mono-tabular text-[#A3A3A3]">
                  YouTube ID: {selectedEvent.youtubeVideoId}
                </p>
              )}
              {selectedEvent.errorMessage && (
                <p className="caption-2 text-red-400">{selectedEvent.errorMessage}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
