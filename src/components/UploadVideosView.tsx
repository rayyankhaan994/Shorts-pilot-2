import { AlertCircle, CheckCircle2, Play, RotateCcw, Trash2, UploadCloud } from 'lucide-react';
import React, { useRef, useState } from 'react';
import { uploadVideoToB2Multipart } from '../lib/b2Upload';
import { formatBytes, formatDuration } from '../lib/timezone';
import type { PublishingSettings, VideoRecord } from '../types/shortspilot';

interface UploadVideosViewProps {
  settings: PublishingSettings | null;
  existingVideos: VideoRecord[];
  getIdToken: () => Promise<string>;
  onCreateVideoRecord: (payload: {
    videoId: string;
    storagePath: string;
    filename: string;
    fileSize: number;
    mimeType: string;
    duration: number;
    thumbnailUrl: string;
    queueOrder: number;
  }) => Promise<void>;
}

interface UploadItem {
  localId: string;
  videoId: string;
  file: File;
  previewUrl: string;
  duration: number;
  progress: number;
  status: 'ready' | 'uploading' | 'completed' | 'error';
  error: string;
}

const MAX_FILE_SIZE_BYTES = 256 * 1024 * 1024;
const ALLOWED_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

function extractVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const dur = Number.isFinite(video.duration) ? video.duration : 0;
      URL.revokeObjectURL(url);
      resolve(dur);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    video.src = url;
  });
}

function makeVideoId(): string {
  return `vid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function UploadVideosView({
  settings,
  existingVideos,
  getIdToken,
  onCreateVideoRecord,
}: UploadVideosViewProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [validationError, setValidationError] = useState('');

  const addFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setValidationError('');
    const nextItems: UploadItem[] = [];

    for (const file of Array.from(fileList)) {
      if (!ALLOWED_TYPES.includes(file.type) && !file.name.toLowerCase().endsWith('.mp4')) {
        setValidationError(`Skipped "${file.name}". Only MP4, MOV, or WebM video files are allowed.`);
        continue;
      }
      if (file.size <= 0 || file.size > MAX_FILE_SIZE_BYTES) {
        setValidationError(`Skipped "${file.name}". File size must be between 1 byte and 256 MB.`);
        continue;
      }
      const duration = await extractVideoDuration(file);
      nextItems.push({
        localId: `${file.name}-${Date.now()}-${Math.random()}`,
        videoId: makeVideoId(),
        file,
        previewUrl: URL.createObjectURL(file),
        duration,
        progress: 0,
        status: 'ready',
        error: '',
      });
    }

    setItems((prev) => [...prev, ...nextItems]);
  };

  const uploadSingleItem = async (item: UploadItem, orderIndex: number) => {
    setItems((prev) =>
      prev.map((it) =>
        it.localId === item.localId
          ? { ...it, status: 'uploading', progress: 0, error: '' }
          : it
      )
    );

    try {
      const verified = await uploadVideoToB2Multipart({
        videoId: item.videoId,
        file: item.file,
        getIdToken,
        onProgress: (pct) => {
          setItems((prev) =>
            prev.map((it) => (it.localId === item.localId ? { ...it, progress: pct } : it))
          );
        },
      });

      await onCreateVideoRecord({
        videoId: item.videoId,
        storagePath: verified.storagePath,
        filename: item.file.name,
        fileSize: verified.size,
        mimeType: verified.contentType,
        duration: item.duration,
        thumbnailUrl: '',
        queueOrder: orderIndex,
      });

      setItems((prev) =>
        prev.map((it) =>
          it.localId === item.localId ? { ...it, status: 'completed', progress: 100 } : it
        )
      );
    } catch (err) {
      setItems((prev) =>
        prev.map((it) =>
          it.localId === item.localId
            ? {
                ...it,
                status: 'error',
                error:
                  err instanceof Error
                    ? err.message
                    : 'Backblaze B2 upload failed. Retry upload.',
              }
            : it
        )
      );
    }
  };

  const handleUploadAll = async () => {
    const pending = items.filter((it) => it.status === 'ready' || it.status === 'error');
    const maxExistingOrder = existingVideos.reduce(
      (max, v) => Math.max(max, v.queueOrder || 0),
      0
    );

    for (let i = 0; i < pending.length; i++) {
      await uploadSingleItem(pending[i], maxExistingOrder + i + 1);
    }
  };

  const removeItem = (localId: string) => {
    setItems((prev) => {
      const target = prev.find((it) => it.localId === localId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((it) => it.localId !== localId);
    });
  };

  const pendingCount = items.filter((i) => i.status === 'ready' || i.status === 'error').length;

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="heading-4 text-white">Upload videos</h1>
          <p className="body-6 text-[#A3A3A3]">
            Upload multiple Shorts clips to your private Backblaze B2 bucket with resumable chunked
            transfers. Only confirmed uploads enter the waiting queue.
          </p>
        </div>

        {pendingCount > 0 && (
          <button
            type="button"
            onClick={handleUploadAll}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#F5F5F5] text-[#000000] button-sm hover:bg-white whitespace-nowrap shrink-0"
          >
            <UploadCloud className="w-4 h-4" />
            <span>Upload {pendingCount} video(s)</span>
          </button>
        )}
      </div>

      {/* Applied Metadata Template Preview */}
      <div className="bg-[#181818] border border-[#272727] rounded-xl p-4 space-y-1.5">
        <p className="caption-3 text-white">Default metadata applied to each uploaded clip</p>
        <p className="body-6 text-[#D4D4D4]">
          Title: {settings?.defaultTitle || 'Wait Until You See This 😱 #shorts'}
        </p>
        <p className="caption-2 text-[#A3A3A3]">
          Description: {settings?.defaultDescription || 'Amazing videos every day!'} · Hashtags:{' '}
          {settings?.defaultHashtags || '#shorts #viral #trending #facts'}
        </p>
      </div>

      {validationError && (
        <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-[#181818] border border-red-900/60 text-red-400 body-6">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{validationError}</span>
        </div>
      )}

      {/* Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          void addFiles(e.dataTransfer.files);
        }}
        className={`rounded-2xl border border-dashed p-10 text-center space-y-4 transition-colors ${
          dragActive
            ? 'bg-[#1F1F1F] border-white'
            : 'bg-[#181818] border-[#313131] hover:border-[#525252]'
        }`}
      >
        <UploadCloud className="w-8 h-8 text-[#D4D4D4] mx-auto" />
        <div className="space-y-1">
          <p className="title-2 text-white">Drag and drop MP4 Shorts here</p>
          <p className="caption-2 text-[#A3A3A3]">
            Select 10, 50, or 100+ vertical MP4 files (up to 256 MB per file)
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="video/mp4,video/quicktime,video/webm"
          className="hidden"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="px-4 py-2 rounded-lg bg-[#272727] border border-[#313131] text-white button-sm hover:bg-[#313131]"
        >
          Choose video files
        </button>
      </div>

      {/* Selected / Uploading Queue */}
      {items.length > 0 && (
        <div className="bg-[#181818] border border-[#272727] rounded-2xl divide-y divide-[#272727]">
          {items.map((item) => (
            <div key={item.localId} className="p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="body-4 text-white truncate">{item.file.name}</p>
                  <p className="caption-5 text-[#A3A3A3] font-mono-tabular">
                    {formatDuration(item.duration)} · {formatBytes(item.file.size)} ·{' '}
                    {item.status === 'completed'
                      ? 'Uploaded to queue'
                      : item.status === 'uploading'
                        ? `Uploading ${item.progress}%`
                        : item.status === 'error'
                          ? 'Upload failed'
                          : 'Ready to upload'}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setPreviewUrl(item.previewUrl)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#1F1F1F] border border-[#272727] text-[#D4D4D4] caption-3 hover:text-white"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Preview</span>
                  </button>

                  {item.status === 'error' && (
                    <button
                      type="button"
                      onClick={() => {
                        const maxOrder = existingVideos.reduce(
                          (m, v) => Math.max(m, v.queueOrder || 0),
                          0
                        );
                        void uploadSingleItem(item, maxOrder + 1);
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#272727] border border-[#313131] text-white caption-3 hover:bg-[#313131]"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Retry</span>
                    </button>
                  )}

                  {item.status === 'completed' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    item.status !== 'uploading' && (
                      <button
                        type="button"
                        onClick={() => removeItem(item.localId)}
                        aria-label={`Remove ${item.file.name}`}
                        className="p-1.5 rounded-lg text-[#A3A3A3] hover:text-red-400 hover:bg-[#1F1F1F]"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )
                  )}
                </div>
              </div>

              {(item.status === 'uploading' || item.status === 'completed') && (
                <div className="h-1.5 w-full bg-[#272727] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white transition-all duration-300"
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
              )}

              {item.error && <p className="caption-2 text-red-400">{item.error}</p>}
            </div>
          ))}
        </div>
      )}

      {previewUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <div
            className="bg-[#181818] border border-[#272727] rounded-2xl p-4 max-w-sm w-full space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <video src={previewUrl} controls autoPlay className="w-full rounded-xl bg-black max-h-[70vh]" />
            <button
              type="button"
              onClick={() => setPreviewUrl(null)}
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
