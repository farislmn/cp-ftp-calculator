import React, { useState } from 'react';
import { supabase } from '../supabaseClient.js';
import type { User } from '../supabaseClient.js';

interface AuthSectionProps {
  user: User | null;
  onSignOut: () => void;
}

type AuthMode = 'idle' | 'sign-in' | 'sign-up';

export function AuthSection({ user, onSignOut }: AuthSectionProps) {
  const [mode, setMode]         = useState<AuthMode>('idle');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy]         = useState(false);
  const [message, setMessage]   = useState<{ text: string; ok: boolean } | null>(null);

  async function handleGoogle() {
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) setMessage({ text: error.message, ok: false });
    setBusy(false);
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setBusy(true);
    setMessage(null);

    if (mode === 'sign-up') {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) {
        setMessage({ text: error.message, ok: false });
      } else {
        setMessage({
          text: 'Check your email for a verification link, then sign in.',
          ok: true,
        });
        setMode('sign-in');
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setMessage({ text: error.message, ok: false });
      } else {
        setMode('idle');
        setEmail('');
        setPassword('');
        setMessage(null);
      }
    }

    setBusy(false);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    onSignOut();
  }

  // ── Logged-in state ────────────────────────────────────────────────────────
  if (user) {
    return (
      <div className="auth-bar">
        <span className="auth-user">{user.email}</span>
        <button className="btn-ghost btn-sm" onClick={handleSignOut}>Sign out</button>
      </div>
    );
  }

  // ── Collapsed ─────────────────────────────────────────────────────────────
  if (mode === 'idle') {
    return (
      <div className="auth-bar">
        <span className="auth-prompt">Sign in to unlock the Progress Journal</span>
        <div className="auth-bar-actions">
          <button className="btn-ghost btn-sm" onClick={() => setMode('sign-in')}>Sign in</button>
          <button className="btn-primary btn-sm" onClick={() => setMode('sign-up')}>Create account</button>
        </div>
      </div>
    );
  }

  // ── Expanded form ─────────────────────────────────────────────────────────
  return (
    <div className="auth-panel card">
      <div className="auth-panel-header">
        <h3>{mode === 'sign-up' ? 'Create account' : 'Sign in'}</h3>
        <button
          className="btn-ghost btn-sm"
          onClick={() => { setMode('idle'); setMessage(null); }}
        >
          Cancel
        </button>
      </div>

      <button
        className="btn-google"
        onClick={handleGoogle}
        disabled={busy}
      >
        <GoogleIcon />
        Continue with Google
      </button>

      <div className="auth-divider"><span>or</span></div>

      <form onSubmit={handleEmail} className="auth-form">
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'sign-up' ? 'Min. 6 characters' : ''}
            autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
            required
          />
        </label>
        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? '…' : mode === 'sign-up' ? 'Create account' : 'Sign in'}
        </button>
      </form>

      {message && (
        <p className={message.ok ? 'msg-success' : 'msg-error'}>{message.text}</p>
      )}

      <p className="auth-switch">
        {mode === 'sign-in' ? (
          <>No account? <button className="btn-link" onClick={() => { setMode('sign-up'); setMessage(null); }}>Create one</button></>
        ) : (
          <>Already have an account? <button className="btn-link" onClick={() => { setMode('sign-in'); setMessage(null); }}>Sign in</button></>
        )}
      </p>

      <p className="auth-legal">
        By continuing you agree to our{' '}
        <a href="/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.
      </p>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z"/>
    </svg>
  );
}
