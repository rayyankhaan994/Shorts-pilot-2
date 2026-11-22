import { Edit3, Play, Search, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import {
  formatBytes,
  formatDuration,
  formatInTimezone,
  validateYouTubeMetadata,
} from '../lib/timezone';
import type { PublishingSettings, VideoRecord, VideoStatus } from '../types/shortspilot';

interface VideoLibraryViewProps {
  videos: VideoRecord[];
  settings: PublishingSettings | null;
  onGetPlaybackUrl: (videoId: string) => Promise<string>;
  onUpdateMetadata: (
    videoId: string,
    updates: { title: string; description: string; hashtags: string; metadataOverride: boolean }
  ) => Promise<void>;
  onDeleteVideo: (video: VideoRecord) => Promise<void>;
}

const STATUS_FILTERS: ('All' | VideoStatus)[] = [
  'All',
  'Waiting',
  'Scheduled',
  'Published',
  'Failed',
  'Processing',
  'Uploaded',
];

export function VideoLibraryView({
  videos,
  settings,
  onGetPlaybackUrl,
  onUpdateMetadata,
  onDeleteVideo,
}: VideoLibraryViewProps) {
  const [filter, setFilter] = useState<'All' | VideoStatus>('All');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<VideoRecord | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [previewVideo, setPreviewVideo] = useState<VideoRecord | null>(null);
  const [previewStreamUrl, setPreviewStreamUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const openPreview = async (video: VideoRecord) => {
    setPreviewVideo(video);
    setPreviewStreamUrl('');
    setPreviewError('');
    setPreviewLoading(true);
    try {
      const url = await onGetPlaybackUrl(video.id);
      setPreviewStreamUrl(url);
    } catch (err) {
      if (video.thumbnailUrl) {
        setPreviewStreamUrl(video.thumbnailUrl);
      } else {
        setPreviewError(err instanceof Error ? err.message : 'Unable to load video stream.');
      }
    } finally {
      setPreviewLoading(false);
    }
  };

  const timeZone = settings?.timezone || 'Asia/Kolkata';

  const filtered = videos.filter((v) => {
    const matchesStatus = filter === 'All' || v.status === filter;
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      v.filename.toLowerCase().includes(q) ||
      v.title.toLowerCase().includes(q) ||
      (v.youtubeVideoId || '').toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  const openEditor = (v: VideoRecord) => {
    setEditing(v);
    setTitle(v.title);
    setDescription(v.description);
    setHashtags(v.hashtags);
    setError('');
  };

  const handleSaveOverride = async () => {
    if (!editing) return;
    const check = validateYouTubeMetadata(title, description, hashtags);
    if (!check.titleValid) {
      setError('Title must be between 1 and 100 characters.');
      return;
    }
    if (!check.descriptionValid) {
      setError('Combined description and hashtags cannot exceed 5,000 characters.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await onUpdateMetadata(editing.id, {
        title,
        description,
        hashtags,
        metadataOverride: true,
      });
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save metadata');
    } finally {
      setSaving(false);
    }
  };

  const validation = validateYouTubeMetadata(title, description, hashtags);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="heading-4 text-white">Video library</h1>
        <p className="body-6 text-[#A3A3A3]">
          Inspect uploaded clips, preview playback, or override metadata on unpublished videos.
        </p>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-[#181818] border border-[#272727] rounded-lg">
          {STATUS_FILTERS.map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setFilter(st)}
              className={`px-3 py-1.5 rounded-md caption-3 transition-colors whitespace-nowrap shrink-0 ${
                filter === st ? 'bg-[#272727] text-white' : 'text-[#A3A3A3] hover:text-white'
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 text-[#737373] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search filename or YouTube ID"
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#181818] border border-[#272727] text-white body-6 placeholder:text-[#737373] focus:outline-none focus:border-[#525252]"
          />
        </div>
      </div>

      {/* Video Table */}
      {filtered.length === 0 ? (
        <div className="bg-[#181818] border border-[#272727] rounded-2xl p-10 text-center space-y-2">
          <p className="body-4 text-white">No matching videos</p>
          <p className="body-6 text-[#A3A3A3]">
            Upload Shorts clips or change your active status filter.
          </p>
        </div>
      ) : (
        <div className="bg-[#181818] border border-[#272727] rounded-2xl overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#272727] caption-4 text-[#A3A3A3]">
                <th className="py-3 px-4">File & Title</th>
                <th className="py-3 px-4">Duration</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Schedule / YouTube ID</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#272727]">
              {filtered.map((video) => {
                const editable =
                  video.status === 'Uploaded' ||
                  video.status === 'Waiting' ||
                  video.status === 'Failed';

                return (
                  <tr key={video.id} className="hover:bg-[#1F1F1F]/60 transition-colors">
                    <td className="py-3.5 px-4 max-w-xs">
                      <p className="body-5 text-white truncate">{video.filename}</p>
                      <p className="caption-5 text-[#A3A3A3] truncate">
                        {video.title}
                        {video.metadataOverride ? ' · Custom override' : ''}
                      </p>
                    </td>
                    <td className="py-3.5 px-4 caption-4 font-mono-tabular text-[#D4D4D4] whitespace-nowrap">
                      {formatDuration(video.duration)} · {formatBytes(video.fileSize)}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span
                        className={`caption-3 ${
                          video.status === 'Published'
                            ? 'text-emerald-400'
                            : video.status === 'Scheduled'
                              ? 'text-sky-400'
                              : video.status === 'Failed'
                                ? 'text-red-400'
                                : 'text-[#D4D4D4]'
                        }`}
                      >
                        {video.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 caption-5 font-mono-tabular text-[#A3A3A3] whitespace-nowrap">
                      {video.scheduledAt
                        ? formatInTimezone(video.scheduledAt, timeZone)
                        : 'Waiting slot'}
                      {video.youtubeVideoId ? ` · ${video.youtubeVideoId}` : ''}
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        {(video.storagePath || video.thumbnailUrl) && (
                          <button
                            type="button"
                            onClick={() => void openPreview(video)}
                            title="Preview video"
                            className="p-2 rounded-lg text-[#A3A3A3] hover:text-white hover:bg-[#272727]"
                          >
                            <Play className="w-4 h-4" />
                          </button>
                        )}
                        {editable && (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditor(video)}
                              title="Override metadata"
                              className="p-2 rounded-lg text-[#A3A3A3] hover:text-white hover:bg-[#272727]"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteVideo(video)}
                              title="Delete waiting video"
                              className="p-2 rounded-lg text-[#A3A3A3] hover:text-red-400 hover:bg-[#272727]"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Override Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="heading-6 text-white">Override metadata</h2>
              <button
                type="button"
                onClick={() => setEditing(null)}
                aria-label="Close modal"
                className="p-1.5 rounded-lg text-[#A3A3A3] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="caption-2 text-[#A3A3A3] truncate">{editing.filename}</p>

            {error && <p className="caption-2 text-red-400">{error}</p>}

            <div className="space-y-3">
              <div className="space-y-1">
                <div className="flex justify-between caption-2 text-[#D4D4D4]">
                  <label htmlFor="override-title">Title</label>
                  <span className="font-mono-tabular text-[#737373]">
                    {validation.titleLength}/100
                  </span>
                </div>
                <input
                  id="override-title"
                  type="text"
                  maxLength={100}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#1F1F1F] border border-[#272727] text-white body-6"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="override-desc" className="caption-2 text-[#D4D4D4] block">
                  Description
                </label>
                <textarea
                  id="override-desc"
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#1F1F1F] border border-[#272727] text-white body-6"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between caption-2 text-[#D4D4D4]">
                  <label htmlFor="override-tags">Hashtags</label>
                  <span className="font-mono-tabular text-[#737373]">
                    Combined: {validation.descriptionCombinedLength}/5000
                  </span>
                </div>
                <input
                  id="override-tags"
                  type="text"
                  value={hashtags}
                  onChange={(e) => setHashtags(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#1F1F1F] border border-[#272727] text-white body-6"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="px-3 py-2 rounded-lg bg-[#1F1F1F] border border-[#272727] text-white button-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveOverride}
                className="px-4 py-2 rounded-lg bg-[#F5F5F5] text-[#000000] button-sm hover:bg-white disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save override'}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewVideo && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setPreviewVideo(null)}
        >
          <div
            className="bg-[#181818] border border-[#272727] rounded-2xl p-4 max-w-sm w-full space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="body-5 text-white truncate">{previewVideo.filename}</p>
            {previewLoading ? (
              <div className="h-56 rounded-xl bg-black flex items-center justify-center caption-2 text-[#A3A3A3]">
                Loading signed video stream...
              </div>
            ) : previewError ? (
              <div className="p-4 rounded-xl bg-black border border-red-900/60 caption-2 text-red-400">
                {previewError}
              </div>
            ) : (
              <video
                src={previewStreamUrl}
                controls
                autoPlay
                className="w-full rounded-xl bg-black max-h-[70vh]"
              />
            )}
            <button
              type="button"
              onClick={() => setPreviewVideo(null)}
              className="w-full py-2 rounded-lg bg-[#272727] text-white button-sm"
            >
              Close preview
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
