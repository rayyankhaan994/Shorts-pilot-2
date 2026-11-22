import type { User } from 'firebase/auth';
import {
  AlertCircle,
  Bell,
  Check,
  CheckCircle2,
  Database,
  KeyRound,
  RefreshCw,
  Server,
} from 'lucide-react';
import { useState } from 'react';
import { formatBytes, formatTimestampField } from '../lib/timezone';
import type {
  EnvReadiness,
  NotificationRecord,
  StorageDiagnosticsReport,
} from '../types/shortspilot';

interface SettingsViewProps {
  user: User;
  readiness: EnvReadiness | null;
  notifications: NotificationRecord[];
  timezone: string;
  onResetPassword: (email: string) => Promise<void>;
  onMarkNotificationRead: (id: string) => Promise<void>;
  onRunDiagnostics: () => Promise<StorageDiagnosticsReport>;
}

export function SettingsView({
  user,
  readiness,
  notifications,
  timezone,
  onResetPassword,
  onMarkNotificationRead,
  onRunDiagnostics,
}: SettingsViewProps) {
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState('');
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagError, setDiagError] = useState('');
  const [diagnostics, setDiagnostics] = useState<StorageDiagnosticsReport | null>(null);

  const handlePasswordReset = async () => {
    if (!user.email) return;
    setResetError('');
    try {
      await onResetPassword(user.email);
      setResetSent(true);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Could not send reset email');
    }
  };

  const handleRunDiagnostics = async () => {
    setDiagLoading(true);
    setDiagError('');
    try {
      const report = await onRunDiagnostics();
      setDiagnostics(report);
    } catch (err) {
      setDiagError(err instanceof Error ? err.message : 'Could not run B2 diagnostics');
    } finally {
      setDiagLoading(false);
    }
  };

  return (
    <div className="space-y-8 max-w-4xl">
      <div className="space-y-1">
        <h1 className="heading-4 text-white">Settings & diagnostics</h1>
        <p className="body-6 text-[#A3A3A3]">
          Manage your account security, run live Backblaze B2 storage checks, and review notifications.
        </p>
      </div>

      {/* Account Profile */}
      <section className="bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-4">
        <h2 className="title-2 text-white">Account</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 caption-2">
          <div>
            <p className="text-[#737373]">Email</p>
            <p className="text-white body-5">{user.email}</p>
          </div>
          <div>
            <p className="text-[#737373]">User UID</p>
            <p className="text-[#D4D4D4] font-mono-tabular">{user.uid}</p>
          </div>
        </div>

        <div className="pt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handlePasswordReset}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#272727] border border-[#313131] text-white button-sm hover:bg-[#313131]"
          >
            <KeyRound className="w-4 h-4" />
            <span>Send password reset email</span>
          </button>
          {resetSent && (
            <span className="inline-flex items-center gap-1.5 caption-2 text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              <span>Reset link sent to {user.email}</span>
            </span>
          )}
          {resetError && <span className="caption-2 text-red-400">{resetError}</span>}
        </div>
      </section>

      {/* Backblaze B2 Live Diagnostics */}
      <section className="bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Database className="w-4 h-4 text-[#D4D4D4]" />
            <h2 className="title-2 text-white">Backblaze B2 live storage diagnostics</h2>
          </div>
          <button
            type="button"
            disabled={diagLoading}
            onClick={handleRunDiagnostics}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#F5F5F5] text-[#000000] button-sm hover:bg-white disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${diagLoading ? 'animate-spin' : ''}`} />
            <span>{diagLoading ? 'Checking B2 bucket...' : 'Run B2 diagnostics'}</span>
          </button>
        </div>

        {diagError && (
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-[#1F1F1F] border border-red-900/60 text-red-400 caption-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{diagError}</span>
          </div>
        )}

        {diagnostics && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 caption-2">
              <div className="p-3 rounded-lg bg-[#1F1F1F] border border-[#272727]">
                <p className="text-[#737373]">Active backend</p>
                <p className="text-white font-mono-tabular mt-0.5">
                  {diagnostics.storageHealth.backendName}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-[#1F1F1F] border border-[#272727]">
                <p className="text-[#737373]">B2 connection & bucket</p>
                <p
                  className={`font-mono-tabular mt-0.5 ${
                    diagnostics.storageHealth.bucketAccessible
                      ? 'text-emerald-400'
                      : 'text-red-400'
                  }`}
                >
                  {diagnostics.storageHealth.bucketAccessible ? 'Connected & accessible' : 'Failed'}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-[#1F1F1F] border border-[#272727]">
                <p className="text-[#737373]">Verified in B2</p>
                <p className="text-white font-mono-tabular mt-0.5">
                  {diagnostics.summary.verifiedInB2} / {diagnostics.summary.totalVideos}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-[#1F1F1F] border border-[#272727]">
                <p className="text-[#737373]">Missing from B2</p>
                <p
                  className={`font-mono-tabular mt-0.5 ${
                    diagnostics.summary.missingFromB2 > 0 ? 'text-amber-400' : 'text-emerald-400'
                  }`}
                >
                  {diagnostics.summary.missingFromB2}
                </p>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-[#1F1F1F] border border-[#272727] caption-2 text-[#A3A3A3] space-y-1">
              <p>
                Bucket:{' '}
                <span className="text-white font-mono-tabular">
                  {diagnostics.storageHealth.bucketName || 'Unset'}
                </span>{' '}
                · Endpoint:{' '}
                <span className="text-white font-mono-tabular">
                  {diagnostics.storageHealth.endpointHost || 'Unset'}
                </span>{' '}
                · Region:{' '}
                <span className="text-white font-mono-tabular">
                  {diagnostics.storageHealth.region || 'Unset'}
                </span>
                {diagnostics.storageHealth.regionMismatch ? (
                  <span className="text-red-400"> (Region mismatch with endpoint!)</span>
                ) : null}
              </p>
              {diagnostics.storageHealth.error && (
                <p className="text-red-400">{diagnostics.storageHealth.error}</p>
              )}
            </div>

            {diagnostics.videos.length > 0 && (
              <div className="bg-[#1F1F1F] border border-[#272727] rounded-xl overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#272727] caption-4 text-[#A3A3A3]">
                      <th className="py-2.5 px-3">Video</th>
                      <th className="py-2.5 px-3">Queue status</th>
                      <th className="py-2.5 px-3">B2 Object</th>
                      <th className="py-2.5 px-3">Diagnosis</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#272727] caption-3">
                    {diagnostics.videos.map((v) => (
                      <tr key={v.videoId}>
                        <td className="py-2.5 px-3">
                          <p className="text-white truncate max-w-[200px]">{v.filename}</p>
                          <p className="caption-5 text-[#737373] font-mono-tabular">{v.videoId}</p>
                        </td>
                        <td className="py-2.5 px-3 text-[#D4D4D4]">{v.status}</td>
                        <td className="py-2.5 px-3 font-mono-tabular">
                          {v.b2ObjectExists ? (
                            <span className="text-emerald-400">
                              Present ({formatBytes(v.b2ObjectSize || 0)})
                            </span>
                          ) : (
                            <span className="text-red-400">Missing</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-[#A3A3A3] max-w-xs">{v.recoveryNote}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Render Backend, Backblaze B2 & Cloudflare Cron Relay Readiness */}
      <section className="bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <Server className="w-4 h-4 text-[#D4D4D4]" />
          <h2 className="title-2 text-white">Render Web Service & Cron Relay readiness</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 caption-2">
          {[
            {
              label: 'Backblaze B2 Private Bucket',
              ok: readiness?.b2Configured && !readiness?.b2RegionMismatch,
            },
            { label: 'Firebase Client Auth', ok: readiness?.firebaseClientConfigured },
            { label: 'Firebase Service Account', ok: readiness?.firebaseAdminConfigured },
            { label: 'Google OAuth 2.0 Client', ok: readiness?.googleOAuthConfigured },
            { label: 'AES 256 GCM Token Key', ok: readiness?.encryptionKeyConfigured },
            { label: 'Cron Relay Secret', ok: readiness?.cronSecretConfigured },
          ].map((item) => (
            <div
              key={item.label}
              className="p-3 rounded-lg bg-[#1F1F1F] border border-[#272727] flex items-center justify-between"
            >
              <span className="text-[#D4D4D4]">{item.label}</span>
              <span className={item.ok ? 'text-emerald-400' : 'text-amber-400'}>
                {item.ok ? 'Ready' : 'Attention needed'}
              </span>
            </div>
          ))}
        </div>

        <div className="p-4 rounded-xl bg-[#1F1F1F] border border-[#272727] space-y-2 caption-2 text-[#A3A3A3]">
          <p className="text-white body-5">Cloudflare Cron Relay target endpoint</p>
          <p>
            The free `shortspilot-cron-relay` Cloudflare Worker sends a minute trigger (`* * * * *`)
            to your Render Web Service scheduler endpoint using the shared `CRON_SECRET`:
          </p>
          <code className="block p-2.5 rounded-lg bg-[#000000] border border-[#272727] font-mono-tabular text-[#D4D4D4] overflow-x-auto">
            POST https://YOUR-RENDER-URL/api/scheduler/run · Authorization: Bearer $CRON_SECRET
          </code>
        </div>
      </section>

      {/* Notifications Inbox */}
      <section className="bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <Bell className="w-4 h-4 text-[#D4D4D4]" />
          <h2 className="title-2 text-white">Notifications ({notifications.length})</h2>
        </div>

        {notifications.length === 0 ? (
          <p className="body-6 text-[#737373]">No notifications recorded yet.</p>
        ) : (
          <div className="divide-y divide-[#272727] border-t border-[#272727]">
            {notifications.map((n) => (
              <div key={n.id} className="py-3.5 flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <p className={`body-5 ${n.read ? 'text-[#A3A3A3]' : 'text-white'}`}>
                    {n.title}
                  </p>
                  <p className="caption-2 text-[#A3A3A3]">{n.message}</p>
                  <p className="caption-5 text-[#737373] font-mono-tabular">
                    {formatTimestampField(n.createdAt, timezone)}
                  </p>
                </div>
                {!n.read && (
                  <button
                    type="button"
                    onClick={() => onMarkNotificationRead(n.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#272727] text-white caption-4 hover:bg-[#313131] shrink-0"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Mark read</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
