import { getBaseAppUrl } from '../config.ts';
import {
  decryptSecret,
  encryptSecret,
  signOAuthState,
  verifyOAuthState,
} from '../lib/crypto.ts';
import { FirestoreRestClient } from '../lib/firestoreRest.ts';
import { combineYouTubeDescription } from '../lib/timezone.ts';
import type { VideoStorageAdapter } from '../types.ts';
import { getVideoStorage } from './b2Storage.ts';

const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
].join(' ');

function isAllowedOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const appOrigin = new URL(getBaseAppUrl()).origin;
    if (parsed.origin === appOrigin) return true;
    if (parsed.hostname.endsWith('.onrender.com')) return true;
    if (parsed.hostname.endsWith('.run.app')) return true;
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return true;
    return false;
  } catch {
    return false;
  }
}

export function getGoogleOAuthConfig(originOverride?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      'Google OAuth credentials (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET) are not configured on the server.'
    );
  }

  const safeOrigin =
    originOverride && isAllowedOrigin(originOverride)
      ? new URL(originOverride).origin
      : getBaseAppUrl();

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI?.trim() || `${safeOrigin}/api/youtube/callback`;

  return { clientId, clientSecret, redirectUri, safeOrigin };
}

export async function generateYouTubeAuthUrl(
  uid: string,
  originOverride?: string
): Promise<string> {
  const { clientId, redirectUri, safeOrigin } = getGoogleOAuthConfig(originOverride);
  const state = await signOAuthState({ uid, originUrl: safeOrigin, redirectUri });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: YOUTUBE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function emitNotification(
  db: FirestoreRestClient,
  uid: string,
  type:
    | 'youtube_connected'
    | 'video_uploaded'
    | 'video_scheduled'
    | 'video_published'
    | 'upload_failed'
    | 'queue_empty'
    | 'queue_refilled'
    | 'auth_expired'
    | 'quota_exhausted'
    | 'automation_paused',
  title: string,
  message: string
) {
  await db.addDoc('notifications', {
    userId: uid,
    type,
    title: title.slice(0, 140),
    message: message.slice(0, 500),
    read: false,
    createdAt: new Date(),
  });
}

export async function handleYouTubeOAuthCallback(code: string, stateToken: string) {
  const state = await verifyOAuthState(stateToken);
  const { clientId, clientSecret } = getGoogleOAuthConfig(state.originUrl);

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: state.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
  };

  if (!tokenRes.ok || !tokens.access_token) {
    throw new Error(tokens.error_description || 'Google OAuth token exchange failed.');
  }

  const chRes = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
    {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }
  );
  const chData = (await chRes.json()) as {
    items?: {
      id?: string;
      snippet?: {
        title?: string;
        thumbnails?: {
          high?: { url?: string };
          medium?: { url?: string };
          default?: { url?: string };
        };
      };
    }[];
  };

  const channel = chData.items?.[0];
  if (!chRes.ok || !channel?.id) {
    throw new Error(
      'No YouTube channel was found on the selected Google account. Create a YouTube channel first and reconnect.'
    );
  }

  const db = new FirestoreRestClient();
  const uid = state.uid;
  const channelName = channel.snippet?.title || 'Connected YouTube Channel';
  const channelImage =
    channel.snippet?.thumbnails?.high?.url ||
    channel.snippet?.thumbnails?.medium?.url ||
    channel.snippet?.thumbnails?.default?.url ||
    '';

  const tokenExpiryIso = new Date(
    Date.now() + (tokens.expires_in || 3500) * 1000
  ).toISOString();

  const existingSecret = await db.getDoc(`youtube_channel_secrets/${uid}`);
  const existingEncryptedRefresh = existingSecret.exists
    ? (existingSecret.data?.encryptedRefreshToken as string | undefined)
    : undefined;

  const encryptedAccessToken = await encryptSecret(tokens.access_token);
  const encryptedRefreshToken = tokens.refresh_token
    ? await encryptSecret(tokens.refresh_token)
    : existingEncryptedRefresh;

  if (!encryptedRefreshToken) {
    throw new Error(
      'Google did not return a refresh token. Revoke app access in your Google Account permissions and reconnect with consent.'
    );
  }

  const now = new Date();
  await db.setDoc(
    `youtube_channel_secrets/${uid}`,
    {
      userId: uid,
      encryptedAccessToken,
      encryptedRefreshToken,
      tokenExpiry: tokenExpiryIso,
      updatedAt: now,
    },
    true
  );

  await db.setDoc(
    `youtube_channels/${uid}`,
    {
      userId: uid,
      channelId: channel.id,
      channelName,
      channelImage,
      connected: true,
      tokenStatus: 'valid',
      tokenExpiry: tokenExpiryIso,
      connectedAt: now,
      updatedAt: now,
    },
    true
  );

  await emitNotification(
    db,
    uid,
    'youtube_connected',
    'YouTube channel connected',
    `Connected channel "${channelName}" (${channel.id}).`
  );

  return {
    uid,
    channelId: channel.id,
    channelName,
    channelImage,
  };
}

export async function disconnectYouTubeChannel(uid: string) {
  const db = new FirestoreRestClient();
  const secretSnap = await db.getDoc(`youtube_channel_secrets/${uid}`);

  if (secretSnap.exists && secretSnap.data?.encryptedAccessToken) {
    try {
      const accessToken = await decryptSecret(String(secretSnap.data.encryptedAccessToken));
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`, {
        method: 'POST',
      }).catch(() => {});
    } catch {
      // Proceed with local disconnect
    }
    await db.deleteDoc(`youtube_channel_secrets/${uid}`);
  }

  await db.setDoc(
    `youtube_channels/${uid}`,
    {
      userId: uid,
      connected: false,
      tokenStatus: 'disconnected',
      updatedAt: new Date(),
    },
    true
  );
}

export async function getAuthorizedAccessToken(uid: string): Promise<string> {
  const db = new FirestoreRestClient();
  const secretSnap = await db.getDoc(`youtube_channel_secrets/${uid}`);
  if (!secretSnap.exists || !secretSnap.data) {
    throw new Error('YouTube channel is not connected.');
  }

  const accessToken = await decryptSecret(String(secretSnap.data.encryptedAccessToken));
  const refreshToken = await decryptSecret(String(secretSnap.data.encryptedRefreshToken));

  const expiryMs = secretSnap.data.tokenExpiry
    ? Date.parse(String(secretSnap.data.tokenExpiry))
    : 0;
  const needsRefresh = !expiryMs || expiryMs - Date.now() < 5 * 60 * 1000;

  if (!needsRefresh) {
    return accessToken;
  }

  const { clientId, clientSecret } = getGoogleOAuthConfig();
  const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const refreshed = (await refreshRes.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!refreshRes.ok || !refreshed.access_token) {
    const errText = refreshed.error_description || refreshed.error || String(refreshRes.status);
    await db.setDoc(
      `youtube_channels/${uid}`,
      {
        tokenStatus: errText.includes('invalid_grant') ? 'revoked' : 'expired',
        updatedAt: new Date(),
      },
      true
    );
    await emitNotification(
      db,
      uid,
      'auth_expired',
      'YouTube authorization expired',
      'Please reconnect your YouTube channel so automated uploads can continue.'
    );
    throw new Error(`YouTube token refresh failed: ${errText}`);
  }

  const newExpiryIso = new Date(
    Date.now() + (refreshed.expires_in || 3500) * 1000
  ).toISOString();

  await db.setDoc(
    `youtube_channel_secrets/${uid}`,
    {
      encryptedAccessToken: await encryptSecret(refreshed.access_token),
      ...(refreshed.refresh_token
        ? {
            encryptedRefreshToken: await encryptSecret(refreshed.refresh_token),
          }
        : {}),
      tokenExpiry: newExpiryIso,
      updatedAt: new Date(),
    },
    true
  );

  await db.setDoc(
    `youtube_channels/${uid}`,
    {
      tokenStatus: 'valid',
      tokenExpiry: newExpiryIso,
      updatedAt: new Date(),
    },
    true
  );

  return refreshed.access_token;
}

export async function refreshAndSyncChannelProfile(uid: string) {
  const accessToken = await getAuthorizedAccessToken(uid);
  const res = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = (await res.json()) as {
    items?: {
      id?: string;
      snippet?: {
        title?: string;
        thumbnails?: { high?: { url?: string }; default?: { url?: string } };
      };
    }[];
  };
  const channel = data.items?.[0];
  if (!res.ok || !channel?.id) {
    throw new Error('Could not retrieve channel information from YouTube.');
  }
  const db = new FirestoreRestClient();
  const channelName = channel.snippet?.title || 'Connected YouTube Channel';
  const channelImage =
    channel.snippet?.thumbnails?.high?.url ||
    channel.snippet?.thumbnails?.default?.url ||
    '';
  await db.setDoc(
    `youtube_channels/${uid}`,
    {
      channelId: channel.id,
      channelName,
      channelImage,
      connected: true,
      tokenStatus: 'valid',
      updatedAt: new Date(),
    },
    true
  );
  return { channelId: channel.id, channelName, channelImage };
}

export async function uploadScheduledShortToYouTube(
  params: {
    uid: string;
    storagePath: string;
    mimeType?: string;
    title: string;
    description: string;
    hashtags: string;
    publishAtIso: string;
  },
  storage: VideoStorageAdapter = getVideoStorage()
): Promise<{ youtubeVideoId: string; privacyStatus: string }> {
  const head = await storage.head(params.storagePath);
  if (!head || head.size <= 0) {
    throw new Error(`Source video file is missing from B2 storage (${params.storagePath}).`);
  }

  const totalSize = head.size;
  const contentType = params.mimeType || head.contentType || 'video/mp4';
  const accessToken = await getAuthorizedAccessToken(params.uid);
  const fullDescription = combineYouTubeDescription(params.description, params.hashtags);
  const safeTitle = params.title.trim().slice(0, 100) || 'ShortsPilot Video #shorts';

  // Step 1: Initiate YouTube Resumable Upload Session
  const initRes = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(totalSize),
        'X-Upload-Content-Type': contentType,
      },
      body: JSON.stringify({
        snippet: {
          title: safeTitle,
          description: fullDescription,
          categoryId: '22',
        },
        status: {
          privacyStatus: 'private',
          publishAt: params.publishAtIso,
          selfDeclaredMadeForKids: false,
        },
      }),
    }
  );

  if (!initRes.ok) {
    const errText = await initRes.text();
    throw new Error(`YouTube upload session init failed (${initRes.status}): ${errText}`);
  }

  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl) {
    throw new Error('YouTube did not return a resumable upload Location URL.');
  }

  // Step 2: Stream 8 MB chunks directly from Backblaze B2 private bucket to YouTube
  const CHUNK_SIZE = 8 * 1024 * 1024;
  let offset = 0;

  while (offset < totalSize) {
    const length = Math.min(CHUNK_SIZE, totalSize - offset);
    const end = offset + length - 1;
    const obj = await storage.get(params.storagePath, {
      range: { offset, length },
    });

    if (!obj) {
      throw new Error(`Failed reading chunk at offset ${offset} from Backblaze B2.`);
    }

    const chunkBuffer = await obj.arrayBuffer();
    if (chunkBuffer.byteLength !== length) {
      throw new Error(
        `Incomplete B2 chunk read at offset ${offset}: expected ${length} bytes, received ${chunkBuffer.byteLength} bytes.`
      );
    }
    const chunkBytes = new Uint8Array(chunkBuffer);
    let chunkSuccess = false;
    let lastChunkErr = '';

    for (let attempt = 1; attempt <= 3; attempt++) {
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(chunkBytes.byteLength),
          'Content-Range': `bytes ${offset}-${end}/${totalSize}`,
          'Content-Type': contentType,
        },
        body: new Uint8Array(chunkBytes),
      });

      if (putRes.status === 200 || putRes.status === 201) {
        const result = (await putRes.json()) as {
          id?: string;
          status?: { privacyStatus?: string };
        };
        if (!result.id) {
          throw new Error('YouTube upload completed without returning a video ID.');
        }
        return {
          youtubeVideoId: result.id,
          privacyStatus: result.status?.privacyStatus || 'private',
        };
      }

      if (putRes.status === 308) {
        chunkSuccess = true;
        break;
      }

      const txt = await putRes.text();
      lastChunkErr = `HTTP ${putRes.status}: ${txt}`;
      if ((putRes.status >= 500 || putRes.status === 429) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 800 * Math.pow(2, attempt - 1)));
        continue;
      }
      throw new Error(`YouTube chunk upload failed: ${lastChunkErr}`);
    }

    if (!chunkSuccess) {
      throw new Error(`YouTube chunk upload failed after retries: ${lastChunkErr}`);
    }

    offset += length;
  }

  throw new Error('YouTube upload stream ended before receiving final confirmation.');
}

export async function verifyYouTubeVideoStatus(uid: string, youtubeVideoId: string) {
  const accessToken = await getAuthorizedAccessToken(uid);
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=${encodeURIComponent(
      youtubeVideoId
    )}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  const data = (await res.json()) as {
    items?: {
      status?: {
        privacyStatus?: string;
        publishAt?: string;
        uploadStatus?: string;
        failureReason?: string;
      };
    }[];
  };

  const item = data.items?.[0];
  if (!res.ok || !item) {
    return {
      found: false,
      privacyStatus: 'unknown',
      publishAt: null as string | null,
      uploadStatus: 'unknown',
      failureReason: 'Video not found on YouTube channel',
    };
  }

  return {
    found: true,
    privacyStatus: item.status?.privacyStatus || 'private',
    publishAt: item.status?.publishAt || null,
    uploadStatus: item.status?.uploadStatus || 'processed',
    failureReason: item.status?.failureReason || null,
  };
}

export async function fetchExistingYouTubeScheduledTimes(uid: string): Promise<string[]> {
  try {
    const accessToken = await getAuthorizedAccessToken(uid);
    const chRes = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const chData = (await chRes.json()) as {
      items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[];
    };
    const uploadsPlaylistId =
      chData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) return [];

    const plRes = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${encodeURIComponent(
        uploadsPlaylistId
      )}&maxResults=25`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const plData = (await plRes.json()) as {
      items?: { contentDetails?: { videoId?: string } }[];
    };

    const videoIds = (plData.items || [])
      .map((i) => i.contentDetails?.videoId)
      .filter((id): id is string => Boolean(id));

    if (videoIds.length === 0) return [];

    const vRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=status&id=${encodeURIComponent(
        videoIds.join(',')
      )}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const vData = (await vRes.json()) as {
      items?: { status?: { publishAt?: string } }[];
    };

    const nowMs = Date.now();
    const scheduledTimes: string[] = [];
    for (const v of vData.items || []) {
      const publishAt = v.status?.publishAt;
      if (publishAt && Date.parse(publishAt) > nowMs) {
        scheduledTimes.push(new Date(publishAt).toISOString());
      }
    }
    return scheduledTimes;
  } catch {
    return [];
  }
}

export async function deleteStoredVideoIfPresent(
  storagePath: string,
  storage: VideoStorageAdapter = getVideoStorage()
) {
  if (!storagePath) return;
  try {
    await storage.delete(storagePath);
  } catch {
    // Non-fatal cleanup failure
  }
}
