import { getFirebaseProjectId, getFirestoreDatabaseId } from '../config.ts';
import { toBase64Url } from './crypto.ts';

interface CachedAccessToken {
  token: string;
  expiresAtMs: number;
  clientEmail: string;
}

let cachedServiceToken: CachedAccessToken | null = null;
const encoder = new TextEncoder();

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const normalized = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function getGoogleServiceAccountToken(): Promise<string> {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKeyPem = process.env.FIREBASE_PRIVATE_KEY?.trim();

  if (!clientEmail || !privateKeyPem) {
    throw new Error(
      'Firebase service account secrets (FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY) are not configured.'
    );
  }

  if (
    cachedServiceToken &&
    cachedServiceToken.clientEmail === clientEmail &&
    Date.now() < cachedServiceToken.expiresAtMs - 60_000
  ) {
    return cachedServiceToken.token;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: nowSec,
    exp: nowSec + 3600,
  };

  const signingInput = `${toBase64Url(encoder.encode(JSON.stringify(header)))}.${toBase64Url(
    encoder.encode(JSON.stringify(claim))
  )}`;

  const keyData = pemToArrayBuffer(privateKeyPem);
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    encoder.encode(signingInput)
  );
  const assertion = `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Failed to mint Google service account access token: ${data.error_description || res.status}`
    );
  }

  cachedServiceToken = {
    token: data.access_token,
    expiresAtMs: Date.now() + (data.expires_in || 3600) * 1000,
    clientEmail,
  };
  return data.access_token;
}

type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { stringValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

export class ServerTimestampSentinel {
  readonly __isServerTimestamp = true;
}

export function toFirestoreValue(val: unknown): FirestoreValue {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (val instanceof Date) {
    return { timestampValue: val.toISOString() };
  }
  if (val instanceof ServerTimestampSentinel) {
    return { timestampValue: new Date().toISOString() };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (Number.isInteger(val)) {
      return { integerValue: String(val) };
    }
    return { doubleValue: val };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map((item) => toFirestoreValue(item)) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, FirestoreValue> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function toFirestoreFields(obj: Record<string, unknown>): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      fields[k] = toFirestoreValue(v);
    }
  }
  return fields;
}

export function fromFirestoreValue(val: FirestoreValue): unknown {
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('timestampValue' in val) return val.timestampValue;
  if ('stringValue' in val) return val.stringValue;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map((item) => fromFirestoreValue(item));
  }
  if ('mapValue' in val) {
    return fromFirestoreFields(val.mapValue.fields || {});
  }
  return null;
}

export function fromFirestoreFields(
  fields: Record<string, FirestoreValue>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = fromFirestoreValue(v);
  }
  return out;
}

export interface FirestoreDocResult {
  exists: boolean;
  id: string;
  name: string;
  data: Record<string, unknown> | null;
  updateTime?: string;
}

export class FirestoreRestClient {
  private readonly projectId: string;
  private readonly databaseId: string;

  constructor(projectId = getFirebaseProjectId(), databaseId = getFirestoreDatabaseId()) {
    this.projectId = projectId;
    this.databaseId = databaseId;
  }

  get docsRoot(): string {
    return `projects/${this.projectId}/databases/${this.databaseId}/documents`;
  }

  private get baseUrl(): string {
    return `https://firestore.googleapis.com/v1/${this.docsRoot}`;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await getGoogleServiceAccountToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  docName(docPath: string): string {
    return `${this.docsRoot}/${docPath.replace(/^\/+/, '')}`;
  }

  async getDoc(docPath: string, transactionId?: string): Promise<FirestoreDocResult> {
    const clean = docPath.replace(/^\/+/, '');
    const qs = transactionId ? `?transaction=${encodeURIComponent(transactionId)}` : '';
    const res = await fetch(`${this.baseUrl}/${clean}${qs}`, {
      headers: await this.authHeaders(),
    });
    if (res.status === 404) {
      return {
        exists: false,
        id: clean.split('/').pop() || '',
        name: this.docName(clean),
        data: null,
      };
    }
    const body = (await res.json()) as {
      name?: string;
      fields?: Record<string, FirestoreValue>;
      updateTime?: string;
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(`Firestore getDoc(${clean}) failed: ${body.error?.message || res.status}`);
    }
    return {
      exists: true,
      id: clean.split('/').pop() || '',
      name: body.name || this.docName(clean),
      data: fromFirestoreFields(body.fields || {}),
      updateTime: body.updateTime,
    };
  }

  async setDoc(docPath: string, data: Record<string, unknown>, merge = false): Promise<void> {
    const clean = docPath.replace(/^\/+/, '');
    const keys = Object.keys(data).filter((k) => data[k] !== undefined);
    const params = new URLSearchParams();
    if (merge) {
      for (const k of keys) {
        params.append('updateMask.fieldPaths', k);
      }
    }
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${this.baseUrl}/${clean}${qs}`, {
      method: 'PATCH',
      headers: await this.authHeaders(),
      body: JSON.stringify({ fields: toFirestoreFields(data) }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Firestore setDoc(${clean}) failed: ${err}`);
    }
  }

  async updateDoc(docPath: string, fields: Record<string, unknown>): Promise<void> {
    await this.setDoc(docPath, fields, true);
  }

  async addDoc(collectionPath: string, data: Record<string, unknown>): Promise<string> {
    const clean = collectionPath.replace(/^\/+/, '');
    const res = await fetch(`${this.baseUrl}/${clean}`, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify({ fields: toFirestoreFields(data) }),
    });
    const body = (await res.json()) as { name?: string; error?: { message?: string } };
    if (!res.ok || !body.name) {
      throw new Error(`Firestore addDoc(${clean}) failed: ${body.error?.message || res.status}`);
    }
    return body.name.split('/').pop() || '';
  }

  async deleteDoc(docPath: string): Promise<void> {
    const clean = docPath.replace(/^\/+/, '');
    const res = await fetch(`${this.baseUrl}/${clean}`, {
      method: 'DELETE',
      headers: await this.authHeaders(),
    });
    if (!res.ok && res.status !== 404) {
      const err = await res.text();
      throw new Error(`Firestore deleteDoc(${clean}) failed: ${err}`);
    }
  }

  async runQuery(
    collectionId: string,
    filters: { field: string; op: 'EQUAL' | 'LESS_THAN_OR_EQUAL' | 'GREATER_THAN'; value: unknown }[]
  ): Promise<{ id: string; data: Record<string, unknown>; updateTime?: string }[]> {
    const fieldFilters = filters.map((f) => ({
      fieldFilter: {
        field: { fieldPath: f.field },
        op: f.op,
        value: toFirestoreValue(f.value),
      },
    }));

    const where =
      fieldFilters.length === 1
        ? fieldFilters[0]
        : fieldFilters.length > 1
          ? { compositeFilter: { op: 'AND', filters: fieldFilters } }
          : undefined;

    const res = await fetch(`${this.baseUrl}:runQuery`, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId }],
          ...(where ? { where } : {}),
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Firestore runQuery(${collectionId}) failed: ${err}`);
    }

    const rows = (await res.json()) as {
      document?: {
        name: string;
        fields?: Record<string, FirestoreValue>;
        updateTime?: string;
      };
    }[];

    return rows
      .filter((r) => Boolean(r.document))
      .map((r) => ({
        id: r.document!.name.split('/').pop() || '',
        data: fromFirestoreFields(r.document!.fields || {}),
        updateTime: r.document!.updateTime,
      }));
  }

  async beginTransaction(): Promise<string> {
    const res = await fetch(`${this.baseUrl}:beginTransaction`, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify({ options: { readWrite: {} } }),
    });
    const body = (await res.json()) as { transaction?: string; error?: { message?: string } };
    if (!res.ok || !body.transaction) {
      throw new Error(
        `Firestore beginTransaction failed: ${body.error?.message || res.status}`
      );
    }
    return body.transaction;
  }

  async rollback(transactionId: string): Promise<void> {
    await fetch(`${this.baseUrl}:rollback`, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify({ transaction: transactionId }),
    }).catch(() => {});
  }

  async commitWrites(
    transactionId: string,
    writes: Record<string, unknown>[]
  ): Promise<{ ok: boolean; conflict: boolean }> {
    const res = await fetch(`${this.baseUrl}:commit`, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify({
        transaction: transactionId,
        writes,
      }),
    });
    if (res.status === 409 || res.status === 400) {
      const txt = await res.text();
      if (txt.includes('FAILED_PRECONDITION') || txt.includes('ABORTED') || res.status === 409) {
        return { ok: false, conflict: true };
      }
      throw new Error(`Firestore commit failed (${res.status}): ${txt}`);
    }
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Firestore commit failed (${res.status}): ${txt}`);
    }
    return { ok: true, conflict: false };
  }
}
