export interface MultipartUploadProgress {
  progress: number;
}

export interface VerifiedUploadResult {
  videoId: string;
  storagePath: string;
  size: number;
  contentType: string;
  storageBackend: string;
  previewUrl?: string;
}

export async function uploadVideoToB2Multipart(params: {
  videoId: string;
  file: File;
  getIdToken: () => Promise<string>;
  onProgress?: (pct: number) => void;
}): Promise<VerifiedUploadResult> {
  const { videoId, file, getIdToken, onProgress } = params;
  const mimeType = file.type || 'video/mp4';

  let activeUploadId: string | null = null;
  try {
    const token = await getIdToken();

    const initRes = await fetch('/api/storage/uploads/init', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        videoId,
        filename: file.name,
        fileSize: file.size,
        mimeType,
      }),
    });

    const initData = (await initRes.json().catch(() => ({}))) as {
      uploadId?: string;
      key?: string;
      chunkSize?: number;
      storageBackend?: string;
      error?: string;
    };

    if (!initRes.ok || !initData.uploadId || !initData.key) {
      throw new Error(initData.error || 'Could not initialize Backblaze B2 upload.');
    }

    activeUploadId = initData.uploadId;
    const chunkSize = initData.chunkSize || 5 * 1024 * 1024;
    const totalParts = Math.max(1, Math.ceil(file.size / chunkSize));
    const parts: { partNumber: number; etag: string }[] = [];
    let uploadedBytes = 0;

    for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
      const start = (partNumber - 1) * chunkSize;
      const end = Math.min(file.size, start + chunkSize);
      const chunkBlob = file.slice(start, end);

      let partResult: { partNumber: number; etag: string } | null = null;
      let lastPartErr = 'Chunk upload failed';

      for (let attempt = 1; attempt <= 3; attempt++) {
        const freshToken = attempt > 1 ? await getIdToken() : token;
        const partRes = await fetch(
          `/api/storage/uploads/${encodeURIComponent(videoId)}/part?uploadId=${encodeURIComponent(
            activeUploadId
          )}&partNumber=${partNumber}`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${freshToken}`,
              'Content-Type': 'application/octet-stream',
            },
            body: chunkBlob,
          }
        );

        const partJson = (await partRes.json().catch(() => ({}))) as {
          partNumber?: number;
          etag?: string;
          error?: string;
        };

        if (partRes.ok && partJson.etag && partJson.partNumber) {
          partResult = { partNumber: partJson.partNumber, etag: partJson.etag };
          break;
        }
        lastPartErr = partJson.error || `Part ${partNumber} upload failed (${partRes.status})`;
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 600 * attempt));
        }
      }

      if (!partResult) {
        throw new Error(lastPartErr);
      }

      parts.push(partResult);
      uploadedBytes = end;
      onProgress?.(Math.min(99, Math.round((uploadedBytes / Math.max(1, file.size)) * 100)));
    }

    const completeToken = await getIdToken();
    const completeRes = await fetch(
      `/api/storage/uploads/${encodeURIComponent(videoId)}/complete`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${completeToken}`,
        },
        body: JSON.stringify({
          uploadId: activeUploadId,
          expectedFileSize: file.size,
          parts,
        }),
      }
    );

    const completeData = (await completeRes.json().catch(() => ({}))) as {
      ok?: boolean;
      verified?: boolean;
      storageBackend?: string;
      storagePath?: string;
      size?: number;
      contentType?: string;
      previewUrl?: string;
      error?: string;
    };

    if (
      !completeRes.ok ||
      !completeData.ok ||
      !completeData.verified ||
      !completeData.storagePath ||
      completeData.storagePath !== initData.key ||
      !completeData.size ||
      completeData.size !== file.size
    ) {
      throw new Error(
        completeData.error ||
          'Backblaze B2 HeadObject verification failed after multipart upload completion.'
      );
    }

    activeUploadId = null;
    onProgress?.(100);

    return {
      videoId,
      storagePath: completeData.storagePath,
      size: completeData.size,
      contentType: completeData.contentType || mimeType,
      storageBackend: completeData.storageBackend || initData.storageBackend || 'backblaze-b2',
      previewUrl: completeData.previewUrl,
    };
  } catch (err) {
    if (activeUploadId) {
      const abortToken = await getIdToken().catch(() => null);
      if (abortToken) {
        await fetch(`/api/storage/uploads/${encodeURIComponent(videoId)}/abort`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${abortToken}`,
          },
          body: JSON.stringify({ uploadId: activeUploadId }),
        }).catch(() => {});
      }
    }
    throw err;
  }
}
