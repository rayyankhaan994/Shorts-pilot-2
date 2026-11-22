import { AlertCircle, CheckCircle2, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  DEFAULT_DAILY_TIMES,
  DEFAULT_TIMEZONES,
  validateYouTubeMetadata,
} from '../lib/timezone';
import type { PublishingSettings, VideoRecord } from '../types/shortspilot';

interface AutomationSettingsViewProps {
  settings: PublishingSettings | null;
  videos: VideoRecord[];
  onSaveSettings: (
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
  ) => Promise<void>;
}

export function AutomationSettingsView({
  settings,
  videos,
  onSaveSettings,
}: AutomationSettingsViewProps) {
  const [defaultTitle, setDefaultTitle] = useState('Wait Until You See This 😱 #shorts');
  const [defaultDescription, setDefaultDescription] = useState('Amazing videos every day!');
  const [defaultHashtags, setDefaultHashtags] = useState('#shorts #viral #trending #facts');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [times, setTimes] = useState<string[]>(DEFAULT_DAILY_TIMES);
  const [dailyLimit, setDailyLimit] = useState(6);
  const [automationEnabled, setAutomationEnabled] = useState(true);
  const [autoRetry, setAutoRetry] = useState(true);
  const [autoCleanupStorage, setAutoCleanupStorage] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedNotice, setSavedNotice] = useState('');
  const [askApplyScope, setAskApplyScope] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setDefaultTitle(settings.defaultTitle);
    setDefaultDescription(settings.defaultDescription);
    setDefaultHashtags(settings.defaultHashtags);
    setTimezone(settings.timezone || 'Asia/Kolkata');
    setTimes(
      settings.dailyPublishingTimes?.length === 6
        ? settings.dailyPublishingTimes
        : [...(settings.dailyPublishingTimes || DEFAULT_DAILY_TIMES), ...DEFAULT_DAILY_TIMES].slice(
            0,
            6
          )
    );
    setDailyLimit(settings.dailyPublishingLimit ?? 6);
    setAutomationEnabled(Boolean(settings.automationEnabled));
    setAutoRetry(Boolean(settings.autoRetry));
    setAutoCleanupStorage(Boolean(settings.autoCleanupStorage));
  }, [settings]);

  const metadataChanged =
    settings &&
    (settings.defaultTitle !== defaultTitle.trim() ||
      settings.defaultDescription !== defaultDescription.trim() ||
      settings.defaultHashtags !== defaultHashtags.trim());

  const unpublishedCount = videos.filter(
    (v) =>
      (v.status === 'Uploaded' || v.status === 'Waiting' || v.status === 'Failed') &&
      !v.metadataOverride
  ).length;

  const commitSave = async (applyToUnpublished: boolean) => {
    setError('');
    setSavedNotice('');

    const check = validateYouTubeMetadata(defaultTitle, defaultDescription, defaultHashtags);
    if (!check.titleValid) {
      setError('Default title must be between 1 and 100 characters.');
      return;
    }
    if (!check.descriptionValid) {
      setError('Combined default description and hashtags cannot exceed 5,000 characters.');
      return;
    }

    const activeTimes = times.slice(0, Math.min(6, Math.max(1, dailyLimit)));
    for (const t of activeTimes) {
      if (!/^\d{2}:\d{2}$/.test(t)) {
        setError('Each publishing time slot must be in HH:mm format.');
        return;
      }
    }

    setSaving(true);
    try {
      await onSaveSettings(
        {
          defaultTitle,
          defaultDescription,
          defaultHashtags,
          timezone,
          dailyPublishingTimes: activeTimes,
          dailyPublishingLimit: dailyLimit,
          automationEnabled,
          autoRetry,
          autoCleanupStorage,
        },
        applyToUnpublished
      );
      setAskApplyScope(false);
      setSavedNotice(
        applyToUnpublished
          ? 'Settings saved and default metadata applied to unpublished waiting videos.'
          : 'Settings saved. New uploads will use these defaults.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save automation settings');
    } finally {
      setSaving(false);
    }
  };

  const handlePrimarySave = () => {
    if (metadataChanged && unpublishedCount > 0) {
      setAskApplyScope(true);
      return;
    }
    void commitSave(false);
  };

  const validation = validateYouTubeMetadata(defaultTitle, defaultDescription, defaultHashtags);

  return (
    <div className="space-y-8 max-w-4xl">
      <div className="space-y-1">
        <h1 className="heading-4 text-white">Automation & default metadata</h1>
        <p className="body-6 text-[#A3A3A3]">
          Configure your shared title template, six daily publishing slots, and queue rules.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 p-4 rounded-xl bg-[#181818] border border-red-900/60 text-red-400 body-6">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {savedNotice && (
        <div className="flex items-start gap-2.5 p-4 rounded-xl bg-[#181818] border border-[#313131] text-emerald-400 body-6">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{savedNotice}</span>
        </div>
      )}

      {/* Default Metadata Section */}
      <section className="bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-5">
        <div className="space-y-1">
          <h2 className="title-2 text-white">Default metadata template</h2>
          <p className="caption-2 text-[#A3A3A3]">
            Applied automatically to newly uploaded videos. Already scheduled or published YouTube
            videos are never modified.
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex justify-between caption-2 text-[#D4D4D4]">
              <label htmlFor="default-title">Default title</label>
              <span className="font-mono-tabular text-[#737373]">{validation.titleLength}/100</span>
            </div>
            <input
              id="default-title"
              type="text"
              maxLength={100}
              value={defaultTitle}
              onChange={(e) => setDefaultTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#1F1F1F] border border-[#272727] text-white body-6"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="default-description" className="caption-2 text-[#D4D4D4] block">
              Default description
            </label>
            <textarea
              id="default-description"
              rows={3}
              value={defaultDescription}
              onChange={(e) => setDefaultDescription(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#1F1F1F] border border-[#272727] text-white body-6"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between caption-2 text-[#D4D4D4]">
              <label htmlFor="default-hashtags">Default hashtags</label>
              <span className="font-mono-tabular text-[#737373]">
                Combined: {validation.descriptionCombinedLength}/5000
              </span>
            </div>
            <input
              id="default-hashtags"
              type="text"
              value={defaultHashtags}
              onChange={(e) => setDefaultHashtags(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#1F1F1F] border border-[#272727] text-white body-6"
            />
          </div>
        </div>
      </section>

      {/* Schedule Slots & Timezone */}
      <section className="bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-5">
        <div className="space-y-1">
          <h2 className="title-2 text-white">Six daily publishing slots</h2>
          <p className="caption-2 text-[#A3A3A3]">
            Defaults to India Standard Time (Asia/Kolkata) at 9 AM, 12 PM, 3 PM, 6 PM, 9 PM, and 11
            PM.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="timezone-select" className="caption-2 text-[#D4D4D4] block">
              Timezone
            </label>
            <select
              id="timezone-select"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#1F1F1F] border border-[#272727] text-white body-6"
            >
              {DEFAULT_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="daily-limit" className="caption-2 text-[#D4D4D4] block">
              Target upcoming Shorts count (max 6)
            </label>
            <input
              id="daily-limit"
              type="number"
              min={1}
              max={6}
              value={dailyLimit}
              onChange={(e) => setDailyLimit(Math.min(6, Math.max(1, Number(e.target.value) || 6)))}
              className="w-full px-3 py-2 rounded-lg bg-[#1F1F1F] border border-[#272727] text-white body-6 font-mono-tabular"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {times.slice(0, dailyLimit).map((slot, idx) => (
            <div key={idx} className="space-y-1">
              <label
                htmlFor={`slot-time-${idx}`}
                className="caption-4 text-[#A3A3A3] block font-mono-tabular"
              >
                Slot {idx + 1}
              </label>
              <input
                id={`slot-time-${idx}`}
                type="time"
                value={slot}
                onChange={(e) => {
                  const val = e.target.value;
                  setTimes((prev) => prev.map((t, i) => (i === idx ? val : t)));
                }}
                className="w-full px-3 py-2 rounded-lg bg-[#1F1F1F] border border-[#272727] text-white body-6 font-mono-tabular"
              />
            </div>
          ))}
        </div>
      </section>

      {/* Automation Controls */}
      <section className="bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-4">
        <h2 className="title-2 text-white">Automation behavior</h2>

        <label className="flex items-start justify-between gap-4 py-2 cursor-pointer">
          <div>
            <p className="body-4 text-white">Enable rolling six Shorts automation</p>
            <p className="caption-2 text-[#A3A3A3]">
              Automatically schedule replacement clips when scheduled Shorts publish.
            </p>
          </div>
          <input
            type="checkbox"
            checked={automationEnabled}
            onChange={(e) => setAutomationEnabled(e.target.checked)}
            className="mt-1 w-4 h-4 accent-white"
          />
        </label>

        <label className="flex items-start justify-between gap-4 py-2 border-t border-[#272727] cursor-pointer">
          <div>
            <p className="body-4 text-white">Automatic upload retries</p>
            <p className="caption-2 text-[#A3A3A3]">
              Safely return transient failures to the waiting queue up to 3 attempts while keeping
              your source file intact.
            </p>
          </div>
          <input
            type="checkbox"
            checked={autoRetry}
            onChange={(e) => setAutoRetry(e.target.checked)}
            className="mt-1 w-4 h-4 accent-white"
          />
        </label>

        <label className="flex items-start justify-between gap-4 py-2 border-t border-[#272727] cursor-pointer">
          <div>
            <p className="body-4 text-white">Delete source file from storage after confirmed publish</p>
            <p className="caption-2 text-[#A3A3A3]">
              Leave unchecked to keep original MP4 files in Backblaze B2 permanently. Never
              deletes the YouTube video.
            </p>
          </div>
          <input
            type="checkbox"
            checked={autoCleanupStorage}
            onChange={(e) => setAutoCleanupStorage(e.target.checked)}
            className="mt-1 w-4 h-4 accent-white"
          />
        </label>
      </section>

      <div className="flex justify-end gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={handlePrimarySave}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#F5F5F5] text-[#000000] button-sm hover:bg-white disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          <span>{saving ? 'Saving...' : 'Save Defaults & Settings'}</span>
        </button>
      </div>

      {/* Scope Confirmation Modal */}
      {askApplyScope && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-4">
            <h3 className="heading-6 text-white">Apply default metadata changes?</h3>
            <p className="body-6 text-[#A3A3A3]">
              You have {unpublishedCount} unpublished video(s) without custom overrides. Already
              scheduled or published YouTube videos will never be altered.
            </p>
            <div className="flex flex-col gap-2.5 pt-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => commitSave(false)}
                className="w-full py-2.5 px-3 rounded-lg bg-[#F5F5F5] text-[#000000] button-sm hover:bg-white"
              >
                Apply to new videos only
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => commitSave(true)}
                className="w-full py-2.5 px-3 rounded-lg bg-[#272727] border border-[#313131] text-white button-sm hover:bg-[#313131]"
              >
                Apply to all unpublished waiting videos ({unpublishedCount})
              </button>
              <button
                type="button"
                onClick={() => setAskApplyScope(false)}
                className="w-full py-2 text-[#A3A3A3] hover:text-white caption-1"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
