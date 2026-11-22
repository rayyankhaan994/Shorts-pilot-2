import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Mail, X } from 'lucide-react';
import type { User } from 'firebase/auth';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  user: User | null;
  onGoogleSignIn: () => Promise<unknown>;
  onEmailLogin: (email: string, password: string) => Promise<unknown>;
  onEmailRegister: (email: string, password: string, displayName: string) => Promise<unknown>;
  onResetPassword: (email: string) => Promise<void>;
  onResendVerification: () => Promise<void>;
  onRefreshUser: () => Promise<void>;
  onLogout: () => Promise<void>;
}

export function AuthModal({
  open,
  onClose,
  user,
  onGoogleSignIn,
  onEmailLogin,
  onEmailRegister,
  onResetPassword,
  onResendVerification,
  onRefreshUser,
  onLogout,
}: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  if (!open) return null;

  const formatAuthError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('auth/operation-not-allowed')) {
      return 'Email and password login is not enabled in Firebase Authentication yet. Use Google Sign In below or enable Email/Password in your Firebase Console.';
    }
    if (msg.includes('auth/popup-closed-by-user')) {
      return 'Sign in popup was closed before completing.';
    }
    if (msg.includes('auth/invalid-credential') || msg.includes('auth/wrong-password')) {
      return 'Invalid email or password. Please check your credentials.';
    }
    if (msg.includes('auth/email-already-in-use')) {
      return 'An account with this email already exists. Try signing in instead.';
    }
    if (msg.includes('auth/weak-password')) {
      return 'Password must be at least 6 characters long.';
    }
    return msg;
  };

  const handleGoogle = async () => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await onGoogleSignIn();
      onClose();
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');

    const cleanEmail = email.trim();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Enter a valid email address.');
      return;
    }

    if (mode !== 'reset' && password.length < 6) {
      setError('Password must contain at least 6 characters.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'login') {
        await onEmailLogin(cleanEmail, password);
        onClose();
      } else if (mode === 'register') {
        await onEmailRegister(cleanEmail, password, displayName);
        setNotice('Account created. Check your inbox and verify your email address before continuing.');
      } else {
        await onResetPassword(cleanEmail);
        setNotice('Password reset link sent to your email address.');
      }
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  if (user && !user.emailVerified) {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h2 className="heading-6 text-white">Verify your email</h2>
              <p className="body-6 text-[#A3A3A3]">
                We sent a verification link to {user.email}. Click it, then confirm below.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="p-2 rounded-lg text-[#A3A3A3] hover:text-white hover:bg-[#272727] transition-colors duration-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {notice && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-[#1F1F1F] border border-[#313131] text-emerald-400 caption-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{notice}</span>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-[#1F1F1F] border border-red-900/60 text-red-400 caption-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await onRefreshUser();
                } catch (err) {
                  setError(formatAuthError(err));
                } finally {
                  setBusy(false);
                }
              }}
              className="w-full py-2.5 px-3 rounded-lg bg-[#F5F5F5] text-[#000000] button-sm hover:bg-white transition-colors duration-200 disabled:opacity-50"
            >
              I verified my email
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onResendVerification();
                  setNotice('Verification email resent.');
                } catch (err) {
                  setError(formatAuthError(err));
                } finally {
                  setBusy(false);
                }
              }}
              className="w-full py-2.5 px-3 rounded-lg bg-[#1F1F1F] border border-[#272727] text-white button-sm hover:bg-[#272727] transition-colors duration-200"
            >
              Resend verification link
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="w-full py-2 px-3 rounded-lg text-[#A3A3A3] hover:text-white caption-1 transition-colors duration-200"
            >
              Sign out and switch account
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="heading-6 text-white">
              {mode === 'login'
                ? 'Sign in to ShortsPilot'
                : mode === 'register'
                  ? 'Create your ShortsPilot account'
                  : 'Reset your password'}
            </h2>
            <p className="body-6 text-[#A3A3A3]">
              {mode === 'login'
                ? 'Access your queue, channel connection, and scheduling slots.'
                : mode === 'register'
                  ? 'Each account isolates your videos, settings, and YouTube tokens.'
                  : 'Enter your account email to receive a password reset link.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close authentication modal"
            className="p-2 rounded-lg text-[#A3A3A3] hover:text-white hover:bg-[#272727] transition-colors duration-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={handleGoogle}
          className="w-full flex items-center justify-center gap-2.5 py-2.5 px-3 rounded-lg bg-[#F5F5F5] text-[#000000] button-sm hover:bg-white active:scale-[0.98] transition-all duration-200 disabled:opacity-50"
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#000000"
              d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81z"
            />
          </svg>
          <span>Continue with Google</span>
        </button>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-[#272727]" />
          <span className="caption-4 text-[#737373]">or use email</span>
          <div className="h-px flex-1 bg-[#272727]" />
        </div>

        {error && (
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-[#1F1F1F] border border-red-900/60 text-red-400 caption-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {notice && (
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-[#1F1F1F] border border-[#313131] text-emerald-400 caption-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{notice}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5" noValidate>
          {mode === 'register' && (
            <div className="space-y-1.5">
              <label className="caption-1 text-[#D4D4D4] block" htmlFor="auth-name">
                Full name
              </label>
              <input
                id="auth-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Rayyan Khan"
                className="w-full px-3 py-2 rounded-lg bg-[#1F1F1F] border border-[#272727] text-white body-6 placeholder:text-[#737373] focus:outline-none focus:border-[#525252]"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="caption-1 text-[#D4D4D4] block" htmlFor="auth-email">
              Email address
            </label>
            <input
              id="auth-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3 py-2 rounded-lg bg-[#1F1F1F] border border-[#272727] text-white body-6 placeholder:text-[#737373] focus:outline-none focus:border-[#525252]"
            />
          </div>

          {mode !== 'reset' && (
            <div className="space-y-1.5">
              <label className="caption-1 text-[#D4D4D4] block" htmlFor="auth-password">
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                className="w-full px-3 py-2 rounded-lg bg-[#1F1F1F] border border-[#272727] text-white body-6 placeholder:text-[#737373] focus:outline-none focus:border-[#525252]"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-[#272727] border border-[#313131] text-white button-sm hover:bg-[#313131] active:scale-[0.98] transition-all duration-200 disabled:opacity-50"
          >
            <Mail className="w-4 h-4" />
            <span>
              {busy
                ? 'Please wait...'
                : mode === 'login'
                  ? 'Sign in with email'
                  : mode === 'register'
                    ? 'Create account'
                    : 'Send reset link'}
            </span>
          </button>
        </form>

        <div className="flex items-center justify-between pt-2 border-t border-[#272727] caption-2 text-[#A3A3A3]">
          {mode === 'login' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError('');
                  setNotice('');
                }}
                className="hover:text-white transition-colors"
              >
                Create an account
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('reset');
                  setError('');
                  setNotice('');
                }}
                className="hover:text-white transition-colors"
              >
                Forgot password?
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
                setNotice('');
              }}
              className="hover:text-white transition-colors"
            >
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
