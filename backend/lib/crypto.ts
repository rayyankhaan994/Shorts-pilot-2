let ephemeralBytes: Uint8Array | null = null;
let warnedEphemeral = false;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function fromBase64Url(b64u: string): Uint8Array {
  const padded = b64u.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64u.length + 3) % 4);
  return fromBase64(padded);
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function getMasterKeyBytes(envKey?: string): Promise<Uint8Array> {
  const raw = (envKey ?? process.env.TOKEN_ENCRYPTION_KEY)?.trim();
  if (raw) {
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      return hexToBytes(raw);
    }
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(raw));
    return new Uint8Array(digest);
  }
  if (!ephemeralBytes) {
    ephemeralBytes = crypto.getRandomValues(new Uint8Array(32));
    if (!warnedEphemeral) {
      warnedEphemeral = true;
      console.warn(
        '[ShortsPilot] TOKEN_ENCRYPTION_KEY is unset. Using an ephemeral runtime key; set TOKEN_ENCRYPTION_KEY in Render Environment before production.'
      );
    }
  }
  return ephemeralBytes;
}

async function getAesKey(envKey?: string): Promise<CryptoKey> {
  const raw = await getMasterKeyBytes(envKey);
  return crypto.subtle.importKey('raw', toArrayBuffer(raw), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

async function getHmacKey(envKey?: string): Promise<CryptoKey> {
  const raw = await getMasterKeyBytes(envKey);
  return crypto.subtle.importKey(
    'raw',
    toArrayBuffer(raw),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function encryptSecret(plaintext: string, envKey?: string): Promise<string> {
  const key = await getAesKey(envKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv), tagLength: 128 },
    key,
    encoder.encode(plaintext)
  );
  const full = new Uint8Array(encryptedBuf);
  const ciphertext = full.slice(0, full.length - 16);
  const authTag = full.slice(full.length - 16);
  return `${toBase64(iv)}:${toBase64(authTag)}:${toBase64(ciphertext)}`;
}

export async function decryptSecret(payload: string, envKey?: string): Promise<string> {
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted token payload');
  }
  const [ivB64, tagB64, dataB64] = parts;
  const iv = fromBase64(ivB64);
  const tag = fromBase64(tagB64);
  const data = fromBase64(dataB64);
  const combined = new Uint8Array(data.length + tag.length);
  combined.set(data, 0);
  combined.set(tag, data.length);

  const key = await getAesKey(envKey);
  const decryptedBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv), tagLength: 128 },
    key,
    toArrayBuffer(combined)
  );
  return decoder.decode(decryptedBuf);
}

export interface OAuthStatePayload {
  uid: string;
  originUrl: string;
  redirectUri: string;
  exp: number;
  nonce: string;
}

export async function signOAuthState(
  payload: Omit<OAuthStatePayload, 'exp' | 'nonce'>,
  envKey?: string
): Promise<string> {
  const nonceBytes = crypto.getRandomValues(new Uint8Array(12));
  const nonce = Array.from(nonceBytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const fullPayload: OAuthStatePayload = {
    ...payload,
    exp: Date.now() + 10 * 60 * 1000,
    nonce,
  };
  const encoded = toBase64Url(encoder.encode(JSON.stringify(fullPayload)));
  const hmacKey = await getHmacKey(envKey);
  const sigBuf = await crypto.subtle.sign('HMAC', hmacKey, encoder.encode(encoded));
  const sig = toBase64Url(new Uint8Array(sigBuf));
  return `${encoded}.${sig}`;
}

export async function verifyOAuthState(
  stateToken: string,
  envKey?: string
): Promise<OAuthStatePayload> {
  const parts = stateToken.split('.');
  if (parts.length !== 2) {
    throw new Error('Invalid OAuth state format');
  }
  const [encoded, sig] = parts;
  const hmacKey = await getHmacKey(envKey);
  const sigBytes = fromBase64Url(sig);
  const valid = await crypto.subtle.verify(
    'HMAC',
    hmacKey,
    toArrayBuffer(sigBytes),
    encoder.encode(encoded)
  );
  if (!valid) {
    throw new Error('OAuth state signature verification failed');
  }
  const parsed = JSON.parse(decoder.decode(fromBase64Url(encoded))) as OAuthStatePayload;
  if (!parsed.uid || !parsed.exp || Date.now() > parsed.exp) {
    throw new Error('OAuth state has expired. Please try connecting again.');
  }
  return parsed;
}

export interface StreamTokenPayload {
  uid: string;
  key: string;
  exp: number;
}

export async function signStreamToken(
  payload: Omit<StreamTokenPayload, 'exp'>,
  envKey?: string
): Promise<string> {
  const full: StreamTokenPayload = {
    ...payload,
    exp: Date.now() + 15 * 60 * 1000,
  };
  const encoded = toBase64Url(encoder.encode(JSON.stringify(full)));
  const hmacKey = await getHmacKey(envKey);
  const sigBuf = await crypto.subtle.sign('HMAC', hmacKey, encoder.encode(encoded));
  return `${encoded}.${toBase64Url(new Uint8Array(sigBuf))}`;
}

export async function verifyStreamToken(
  token: string,
  envKey?: string
): Promise<StreamTokenPayload> {
  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new Error('Invalid stream token');
  }
  const [encoded, sig] = parts;
  const hmacKey = await getHmacKey(envKey);
  const valid = await crypto.subtle.verify(
    'HMAC',
    hmacKey,
    toArrayBuffer(fromBase64Url(sig)),
    encoder.encode(encoded)
  );
  if (!valid) {
    throw new Error('Stream token signature mismatch');
  }
  const parsed = JSON.parse(decoder.decode(fromBase64Url(encoded))) as StreamTokenPayload;
  if (!parsed.uid || !parsed.key || !parsed.exp || Date.now() > parsed.exp) {
    throw new Error('Stream token expired');
  }
  return parsed;
}

export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

export function randomHex(byteCount = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteCount));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
