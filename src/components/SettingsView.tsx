import type { User } from 'firebase/auth';
import { Bell, Check, CheckCircle2, KeyRound, Server } from 'lucide-react';
import { useState } from 'react';
import { formatTimestampField } from '../lib/timezone';
import type { EnvReadiness, NotificationRecord } from '../types/shortspilot';

interface SettingsViewProps {
  user: User;
  readiness: EnvReadiness | null;
  notifications: NotificationRecord[];
  timezone: string;
  onResetPassword: (email: string) => Promise<void>;
  onMarkNotificationRead: (id: string) => Promise<void>;
}

export function SettingsView({
  user,
  readiness,
  notifications,
  timezone,
  onResetPassword,
  onMarkNotificationRead,
}: SettingsViewProps) {
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState('');

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

  return (
    <div className="space-y-8 max-w-4xl">
      <div className="space-y-1">
        <h1 className="heading-4 text-white">Settings & notifications</h1>
        <p className="body-6 text-[#A3A3A3]">
          Manage your account security, review activity notifications, and inspect backend readiness.
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

      {/* Render Backend, Backblaze B2 & Cloudflare Cron Relay Readiness */}
      <section className="bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <Server className="w-4 h-4 text-[#D4D4D4]" />
          <h2 className="title-2 text-white">Render Web Service & Cron Relay readiness</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 caption-2">
          {[
            { label: 'Backblaze B2 Private Bucket', ok: readiness?.b2Configured },
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
                {item.ok ? 'Ready' : 'Not configured'}
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
