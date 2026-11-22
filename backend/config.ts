import appletConfigJson from '../firebase-applet-config.json' with { type: 'json' };

export interface AppletConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId: string;
  storageBucket: string;
  messagingSenderId: string;
}

const appletConfig = appletConfigJson as AppletConfig;

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
}

export function getFirebaseProjectId(): string {
  return process.env.FIREBASE_PROJECT_ID?.trim() || appletConfig.projectId || '';
}

export function getFirestoreDatabaseId(): string {
  return (
    process.env.FIRESTORE_DATABASE_ID?.trim() ||
    appletConfig.firestoreDatabaseId ||
    '(default)'
  );
}

export function getBaseAppUrl(): string {
  const raw = process.env.APP_URL?.trim();
  if (raw && raw !== 'MY_APP_URL') {
    return raw.replace(/\/+$/, '');
  }
  const renderExternalUrl = process.env.RENDER_EXTERNAL_URL?.trim();
  if (renderExternalUrl) {
    return renderExternalUrl.replace(/\/+$/, '');
  }
  return `http://localhost:${process.env.PORT || 3000}`;
}

export function hasServiceAccountCredentials(): boolean {
  return Boolean(
    getFirebaseProjectId() &&
      process.env.FIREBASE_CLIENT_EMAIL?.trim() &&
      process.env.FIREBASE_PRIVATE_KEY?.trim()
  );
}

export function getB2Config() {
  const endpointRaw = process.env.B2_ENDPOINT?.trim() || '';
  const withScheme = endpointRaw
    ? endpointRaw.startsWith('http://') || endpointRaw.startsWith('https://')
      ? endpointRaw
      : `https://${endpointRaw}`
    : '';

  let endpoint = '';
  let endpointHost = '';
  let endpointHadExtraPath = false;
  if (withScheme) {
    try {
      const parsed = new URL(withScheme);
      endpoint = parsed.origin;
      endpointHost = parsed.host;
      endpointHadExtraPath = parsed.pathname !== '' && parsed.pathname !== '/';
    } catch {
      endpoint = withScheme.replace(/\/+$/, '');
    }
  }

  const regionMatch = /s3\.([a-z0-9-]+)\.backblazeb2\.com/i.exec(endpoint);
  const endpointRegion = regionMatch?.[1] || null;
  const configuredRegion = process.env.B2_REGION?.trim() || '';
  const region = configuredRegion || endpointRegion || 'us-west-004';
  const regionMismatch = Boolean(
    endpointRegion &&
      configuredRegion &&
      endpointRegion.toLowerCase() !== configuredRegion.toLowerCase()
  );

  const bucketName = process.env.B2_BUCKET_NAME?.trim() || '';
  const keyId = process.env.B2_KEY_ID?.trim() || '';
  const applicationKey = process.env.B2_APPLICATION_KEY?.trim() || '';

  return {
    endpoint,
    endpointHost,
    endpointHadExtraPath,
    endpointRegion,
    region,
    regionMismatch,
    bucketName,
    keyId,
    applicationKey,
    configured: Boolean(endpoint && bucketName && keyId && applicationKey),
  };
}

export function getServerEnvReadiness() {
  const b2 = getB2Config();
  const prod = isProductionRuntime();
  return {
    appUrl: getBaseAppUrl(),
    runtime: 'render-node-hono',
    productionMode: prod,
    storageBackend: b2.configured
      ? 'backblaze-b2'
      : prod
        ? 'backblaze-b2-unconfigured'
        : 'local-dev-storage',
    firebaseProjectId: getFirebaseProjectId(),
    firestoreDatabaseId: getFirestoreDatabaseId(),
    b2Configured: b2.configured,
    b2EndpointHost: b2.endpointHost || undefined,
    b2Region: b2.configured ? b2.region : undefined,
    b2BucketName: b2.bucketName || undefined,
    b2RegionMismatch: b2.regionMismatch,
    firebaseClientConfigured: Boolean(appletConfig.apiKey && appletConfig.projectId),
    firebaseAdminConfigured: hasServiceAccountCredentials(),
    googleOAuthConfigured: Boolean(
      process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()
    ),
    encryptionKeyConfigured: Boolean(process.env.TOKEN_ENCRYPTION_KEY?.trim()),
    cronSecretConfigured: Boolean(process.env.CRON_SECRET?.trim()),
  };
}
