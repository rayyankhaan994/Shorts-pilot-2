import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  RefreshCw,
  Unlink,
  Youtube,
} from 'lucide-react';
import { useState } from 'react';
import { formatInTimezone } from '../lib/timezone';
import type { EnvReadiness, YouTubeChannel } from '../types/shortspilot';

interface YouTubeChannelViewProps {
  channel: YouTubeChannel | null;
  readiness: EnvReadiness | null;
  timezone: string;
  oauthError?: string;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onRefresh: () => Promise<unknown>;
}

export function YouTubeChannelView({
  channel,
  readiness,
  timezone,
  oauthError,
  onConnect,
  onDisconnect,
  onRefresh,
}: YouTubeChannelViewProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);

  const callbackUrl = `${window.location.origin}/api/youtube/callback`;

  const handleCopyCallback = async () => {
    await navigator.clipboard.writeText(callbackUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleConnect = async () => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await onConnect();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start YouTube OAuth');
    } finally {
      setBusy(false);
    }
  };

  const handleRefresh = async () => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await onRefresh();
      setNotice('OAuth token verified and channel details synced.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh YouTube token');
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await onDisconnect();
      setNotice('YouTube channel disconnected and encrypted tokens removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect channel');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8 max-w-3xl">
      <div className="space-y-1">
        <h1 className="heading-4 text-white">YouTube channel</h1>
        <p className="body-6 text-[#A3A3A3]">
          Connect your YouTube channel with official Google OAuth 2.0 using youtube.upload scope.
        </p>
      </div>

      {(error || oauthError) && (
        <div role="alert" className="p-4 rounded-xl bg-[#181818] border border-red-900/60 text-red-400 body-6 whitespace-pre-wrap">
          {error || oauthError}
        </div>
      )}

      {notice && (
        <div className="flex items-center gap-2.5 p-4 rounded-xl bg-[#181818] border border-[#313131] text-emerald-400 body-6">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Channel Status Card */}
      <section className="bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-5">
        {channel?.connected ? (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                {channel.channelImage ? (
                  <img
                    src={channel.channelImage}
                    alt={channel.channelName}
                    referrerPolicy="no-referrer"
                    className="w-14 h-14 rounded-full object-cover border border-[#313131]"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-[#272727] flex items-center justify-center">
                    <Youtube className="w-6 h-6 text-white" />
                  </div>
                )}
                <div className="space-y-1">
                  <h2 className="title-1 text-white">{channel.channelName}</h2>
                  <p className="caption-2 text-[#A3A3A3] font-mono-tabular">
                    Channel ID: {channel.channelId} · Token: {channel.tokenStatus}
                  </p>
                  {channel.tokenExpiry && (
                    <p className="caption-5 text-[#737373] font-mono-tabular">
                      Access token expiry: {formatInTimezone(channel.tokenExpiry, timezone)}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleRefresh}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#272727] border border-[#313131] text-white button-sm hover:bg-[#313131] disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
                  <span>Test & Refresh Token</span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleDisconnect}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1F1F1F] border border-[#272727] text-red-400 button-sm hover:bg-[#272727] disabled:opacity-50"
                >
                  <Unlink className="w-4 h-4" />
                  <span>Disconnect</span>
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <h2 className="title-2 text-white">No channel connected</h2>
              <p className="body-6 text-[#A3A3A3]">
                Authorize ShortsPilot to upload scheduled Shorts via YouTube Data API v3. Refresh
                tokens are encrypted on the backend with AES 256 GCM.
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={handleConnect}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#F5F5F5] text-[#000000] button-sm hover:bg-white disabled:opacity-50"
            >
              <Youtube className="w-4 h-4" />
              <span>{busy ? 'Opening Google OAuth...' : 'Connect YouTube Channel'}</span>
            </button>
          </div>
        )}
      </section>

      {/* Google Cloud OAuth Setup Reference */}
      <section className="bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-4">
        <h2 className="title-2 text-white">Google Cloud OAuth configuration</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 caption-2">
          <div className="p-3 rounded-lg bg-[#1F1F1F] border border-[#272727] flex items-center justify-between">
            <span className="text-[#A3A3A3]">Google OAuth client</span>
            <span className={readiness?.googleOAuthConfigured ? 'text-emerald-400' : 'text-amber-400'}>
              {readiness?.googleOAuthConfigured ? 'Configured' : 'Needs env vars'}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-[#1F1F1F] border border-[#272727] flex items-center justify-between">
            <span className="text-[#A3A3A3]">Server token storage</span>
            <span
              className={
                readiness?.firebaseAdminConfigured ? 'text-emerald-400' : 'text-amber-400'
              }
            >
              {readiness?.firebaseAdminConfigured ? 'Service account ready' : 'Needs service account'}
            </span>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="caption-2 text-[#D4D4D4]">Authorized Redirect URI</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 rounded-lg bg-[#1F1F1F] border border-[#272727] caption-5 font-mono-tabular text-[#D4D4D4] truncate">
              {callbackUrl}
            </code>
            <button
              type="button"
              onClick={handleCopyCallback}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#272727] text-white caption-3 hover:bg-[#313131] shrink-0"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </div>
      </section>

      {/* YouTube API Compliance & Shorts Eligibility Notice */}
      <section className="bg-[#131209] border border-amber-700/40 rounded-2xl p-6 space-y-2.5">
        <div className="flex items-center gap-2.5 text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <h2 className="title-3">YouTube Data API compliance & Shorts eligibility</h2>
        </div>
        <p className="body-6 text-[#D4D4D4]">
          Google restricts uploads from unverified OAuth projects to private visibility until your
          application passes Google&apos;s YouTube API Services compliance audit. ShortsPilot never
          falsely marks a private upload as published.
        </p>
        <p className="caption-2 text-[#A3A3A3]">
          YouTube independently determines Shorts eligibility based on vertical or square aspect
          ratio and its current duration limits.
        </p>
      </section>
    </div>
  );
}
