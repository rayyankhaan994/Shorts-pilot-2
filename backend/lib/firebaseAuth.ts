import type { AuthUser } from '../types.ts';
import { fromBase64Url, toArrayBuffer } from './crypto.ts';

const FIREBASE_JWK_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

interface CachedJwks {
  keys: Record<string, JsonWebKey>;
  expiresAt: number;
}

let jwkCache: CachedJwks | null = null;
const decoder = new TextDecoder();

async function getFirebasePublicKeys(forceRefresh = false): Promise<Record<string, JsonWebKey>> {
  if (!forceRefresh && jwkCache && Date.now() < jwkCache.expiresAt) {
    return jwkCache.keys;
  }

  const res = await fetch(FIREBASE_JWK_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch Firebase public keys (${res.status})`);
  }

  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = /max-age=(\d+)/i.exec(cacheControl);
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;

  const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
  const map: Record<string, JsonWebKey> = {};
  for (const k of body.keys || []) {
    if (k.kid) {
      map[k.kid] = k;
    }
  }

  jwkCache = {
    keys: map,
    expiresAt: Date.now() + maxAgeSec * 1000,
  };
  return map;
}

export async function verifyFirebaseIdToken(
  idToken: string,
  projectId: string
): Promise<AuthUser> {
  if (!projectId) {
    throw new Error('Firebase projectId is not configured');
  }

  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed Firebase ID token');
  }

  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(decoder.decode(fromBase64Url(headerB64))) as {
    alg?: string;
    kid?: string;
  };
  const payload = JSON.parse(decoder.decode(fromBase64Url(payloadB64))) as {
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    email?: string;
    email_verified?: boolean;
  };

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Invalid Firebase token header');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= nowSec) {
    throw new Error('Firebase ID token has expired');
  }
  if (!payload.iat || payload.iat > nowSec + 300) {
    throw new Error('Firebase ID token issued in the future');
  }
  if (payload.aud !== projectId) {
    throw new Error('Firebase token audience mismatch');
  }
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error('Firebase token issuer mismatch');
  }
  if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.length > 128) {
    throw new Error('Firebase token missing valid subject UID');
  }

  let keys = await getFirebasePublicKeys(false);
  let jwk = keys[header.kid];
  if (!jwk) {
    keys = await getFirebasePublicKeys(true);
    jwk = keys[header.kid];
  }
  if (!jwk) {
    throw new Error('Unable to find matching Firebase signing key');
  }

  const publicKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signatureBytes = fromBase64Url(sigB64);

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    toArrayBuffer(signatureBytes),
    signingInput
  );

  if (!valid) {
    throw new Error('Firebase ID token signature verification failed');
  }

  return {
    uid: payload.sub,
    email: payload.email ?? null,
    emailVerified: Boolean(payload.email_verified),
  };
}
