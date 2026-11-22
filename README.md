# ShortsPilot

Automated YouTube Shorts publishing SaaS built with React, Vite, TypeScript, Tailwind CSS, **Hono on Node.js (Render Free Web Service)**, **Backblaze B2 (Private S3-Compatible Storage)**, **Firebase Auth & Firestore**, and a separate **Cloudflare Workers Free Cron Relay (`shortspilot-cron-relay`)**.

## Deployment Architecture

- **GitHub**: Source code repository.
- **Render Free Node.js Web Service (`server.ts` + `backend/` + `dist/`)**: Serves the React SPA, authenticates Firebase ID tokens, handles multipart video uploads to Backblaze B2, manages YouTube OAuth 2.0 with AES-256-GCM encrypted refresh tokens, and runs the atomic 6-slot rolling scheduler.
- **Backblaze B2 (Private Bucket)**: Stores bulk uploaded MP4 Shorts (`users/{uid}/videos/{videoId}/original.mp4`) using the S3-compatible API (`@aws-sdk/client-s3`) with multipart chunked uploads and byte-range streaming directly to YouTube.
- **Firebase Auth & Firestore**: Stores user metadata, queue order, publishing settings, encrypted channel secrets (`youtube_channel_secrets`, server-only), distributed locks (`scheduler_locks`, server-only), and job idempotency records (`publishing_jobs`).
- **Cloudflare Workers Free (`shortspilot-cron-relay/`)**: Runs a lightweight `scheduled()` handler every minute (`* * * * *`) and calls `POST https://YOUR-RENDER-URL/api/scheduler/run` with `Authorization: Bearer $CRON_SECRET` without requiring any paid Render Cron Job or Cloudflare R2 billing.

---

## Step 1: Backblaze B2 Private Bucket Setup (No Credit Card Required for Private Buckets)

1. Sign in to Backblaze B2 and create a **Private** bucket (e.g. `shortspilot-videos-private`). Keep it **Private** — browser clients stream via short-lived signed backend URLs and Render uploads directly to YouTube.
2. Note your bucket's **S3 Endpoint** (e.g. `https://s3.us-west-004.backblazeb2.com`) and **Region** (e.g. `us-west-004`).
3. Create an **Application Key** scoped to that bucket (`Read and Write`) and copy:
   - `B2_KEY_ID` (`keyID`)
   - `B2_APPLICATION_KEY` (`applicationKey`)

---

## Step 2: GitHub → Render Free Web Service Deployment

1. Push this repository to GitHub (`shortspilot`).
2. In Render Dashboard, create a **Blueprint** (using `render.yaml`) or a **Web Service** (`Free` plan):
   - **Runtime**: `Node`
   - **Build Command**: `npm install --include=dev && npm run build`
   - **Start Command**: `npx tsx server.ts`
   - **Health Check Path**: `/api/health`
3. Add these environment variables in Render Dashboard → **Environment** (all secrets stay server-side only):
   - `NODE_ENV=production`
   - `APP_URL=https://<your-render-service>.onrender.com`
   - `FIREBASE_PROJECT_ID=gen-lang-client-0302189886`
   - `FIRESTORE_DATABASE_ID=ai-studio-b9d0addf-9235-428d-87b4-d952010d5b26`
   - `FIREBASE_CLIENT_EMAIL` *(service account email)*
   - `FIREBASE_PRIVATE_KEY` *(service account private key)*
   - `B2_ENDPOINT` *(e.g. `https://s3.us-west-004.backblazeb2.com`)*
   - `B2_REGION` *(e.g. `us-west-004`)*
   - `B2_BUCKET_NAME` *(your private B2 bucket name)*
   - `B2_KEY_ID`
   - `B2_APPLICATION_KEY`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI=https://<your-render-service>.onrender.com/api/youtube/callback`
   - `TOKEN_ENCRYPTION_KEY` *(64-character hex secret for AES-256-GCM)*
   - `CRON_SECRET` *(long random shared secret matching the Cloudflare Cron Relay)*
4. Add `https://<your-render-service>.onrender.com/api/youtube/callback` (and your preview URLs) under **Authorized redirect URIs** in Google Cloud Console.

---

## Step 3: Cloudflare Workers Free Cron Relay (`shortspilot-cron-relay/`)

1. Navigate to the separate relay project:
   ```bash
   cd shortspilot-cron-relay
   npm install
   npx wrangler login
   ```
2. Set `RENDER_APP_URL` in `shortspilot-cron-relay/wrangler.jsonc` (or as a Worker secret) to your deployed Render URL (`https://<your-render-service>.onrender.com`).
3. Store the exact same `CRON_SECRET` as a Cloudflare Worker secret (never commit it):
   ```bash
   npx wrangler secret put CRON_SECRET
   ```
4. Deploy the free relay Worker:
   ```bash
   npx wrangler deploy
   ```
   Cloudflare's `* * * * *` Cron Trigger will call `POST https://<your-render-service>.onrender.com/api/scheduler/run` every minute automatically.

---

## Local Development & Verification

```bash
npm install
npm run dev
```

When `B2_*` variables are omitted locally, `backend/services/b2Storage.ts` automatically uses a local `.dev-storage/` directory so preview uploads and tests work without external credentials.

Run all checks and tests:

```bash
npm run lint
npm run build
npm test
npx eslint firestore.rules
```
