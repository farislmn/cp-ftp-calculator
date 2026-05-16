import React, { useState, useEffect, useCallback } from 'react';
import { LabWorkbench } from './components/LabWorkbench.js';
import type { LabContext } from './components/LabWorkbench.js';
import { StrategyRoom } from './components/StrategyRoom.js';
import { AuthSection } from './components/AuthSection.js';
import { ProgressJournal } from './components/ProgressJournal.js';
import { supabase } from './supabaseClient.js';
import type { User } from './supabaseClient.js';
import type { CPResult } from './labEngine.js';
import type { MaxEffort } from './intervalsClient.js';
import { clearCached } from './cache.js';

const LS_TOKEN  = 'ppe_intervals_access_token';
const LS_ID     = 'ppe_intervals_athlete_id';
const LS_NAME   = 'ppe_intervals_athlete_name';

type Tab = 'lab' | 'strategy' | 'journal';

export default function App() {
  const [labCtx,             setLabCtx]             = useState<LabContext | null>(null);
  const [activeTab,          setActiveTab]          = useState<Tab>('lab');
  const [user,               setUser]               = useState<User | null>(null);
  const [authReady,          setAuthReady]          = useState(false);
  const [oauthStatus,        setOauthStatus]        = useState<string | null>(null);

  // Persisted Intervals.icu credentials for the logged-in user
  const [savedAthleteId,     setSavedAthleteId]     = useState('');
  const [savedApiKey,        setSavedApiKey]        = useState('');
  const [savedAthleteName,   setSavedAthleteName]   = useState('');
  const [intervalsConnected, setIntervalsConnected] = useState(false);

  // ── Load data-only Intervals.icu token from localStorage on first render ────
  useEffect(() => {
    const token = localStorage.getItem(LS_TOKEN);
    const id    = localStorage.getItem(LS_ID);
    const name  = localStorage.getItem(LS_NAME);
    if (token && id) {
      setSavedAthleteId(id);
      setSavedApiKey(`Bearer ${token}`);
      setSavedAthleteName(name ?? '');
      setIntervalsConnected(true);
    }
  }, []);

  // ── Auth listener ──────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // ── Intervals.icu OAuth callback ───────────────────────────────────────────
  // Fires on mount when the page loads with ?code= (the redirect back from intervals.icu)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code  = params.get('code');
    const error = params.get('error');
    const state = params.get('state');

    if (error) {
      setOauthStatus('Intervals.icu authorisation was cancelled.');
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }
    if (!code || !state) return;

    // Clean the URL immediately so a refresh doesn't re-trigger
    window.history.replaceState({}, '', window.location.pathname);

    // Verify CSRF nonce stored before the redirect
    let parsedState: { mode: 'login' | 'connect' | 'data'; nonce: string };
    try {
      parsedState = JSON.parse(atob(state));
    } catch {
      setOauthStatus('OAuth state invalid — please try again.');
      return;
    }
    const storedNonce = localStorage.getItem('oauth_nonce');
    localStorage.removeItem('oauth_nonce');
    if (parsedState.nonce !== storedNonce) {
      setOauthStatus('OAuth security check failed — please try again.');
      return;
    }

    setOauthStatus('Connecting to Intervals.icu…');

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();

      const body: Record<string, string> = { code, mode: parsedState.mode };
      if (parsedState.mode === 'connect' && session?.access_token) {
        body.supabaseToken = session.access_token;
      }

      const res = await fetch('/.netlify/functions/intervals-oauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json() as Record<string, unknown>;

      if (!res.ok) {
        setOauthStatus(`Connection failed: ${String(data.error ?? res.statusText)}`);
        return;
      }

      if (parsedState.mode === 'data') {
        // No Supabase — store token in localStorage for persistence
        localStorage.setItem(LS_TOKEN,  data.intervalsToken as string);
        localStorage.setItem(LS_ID,     data.athleteId as string);
        localStorage.setItem(LS_NAME,   data.athleteName as string);
        setSavedAthleteId(data.athleteId as string);
        setSavedApiKey(`Bearer ${data.intervalsToken as string}`);
        setSavedAthleteName(data.athleteName as string);
        setIntervalsConnected(true);
        setOauthStatus(null);
        return;
      }

      if (parsedState.mode === 'login') {
        // Sign the user into Supabase using the hashed magic-link token
        const { error: otpErr } = await supabase.auth.verifyOtp({
          token_hash: data.tokenHash as string,
          type: 'magiclink',
        });
        if (otpErr) {
          setOauthStatus(`Sign-in failed: ${otpErr.message}`);
          return;
        }
        // onAuthStateChange will fire and update `user`
        setSavedAthleteId(data.athleteId as string);
        setSavedApiKey(`Bearer ${data.intervalsToken as string}`);
        setIntervalsConnected(true);
      } else {
        // connect mode — refresh credentials from the profile we just updated
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('intervals_access_token')
          .eq('id', session!.user.id)
          .single();
        setSavedAthleteId(data.athleteId as string);
        setSavedApiKey(`Bearer ${profile?.intervals_access_token ?? ''}`);
        setIntervalsConnected(true);
      }

      setOauthStatus(null);
    })().catch((e: Error) => setOauthStatus(`Connection error: ${e.message}`));
  }, []); // intentionally runs once on mount only

  // ── Load profile when user changes ─────────────────────────────────────────
  useEffect(() => {
    if (!user) {
      // Keep localStorage (data-only) credentials alive even when not signed in to Supabase
      const token = localStorage.getItem(LS_TOKEN);
      const id    = localStorage.getItem(LS_ID);
      if (token && id) {
        setSavedAthleteId(id);
        setSavedApiKey(`Bearer ${token}`);
        setSavedAthleteName(localStorage.getItem(LS_NAME) ?? '');
        setIntervalsConnected(true);
      } else {
        setSavedAthleteId('');
        setSavedApiKey('');
        setSavedAthleteName('');
        setIntervalsConnected(false);
      }
      return;
    }
    supabase
      .from('user_profiles')
      .select('athlete_id, api_key, intervals_access_token')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setSavedAthleteId(data.athlete_id ?? '');
          // Prefer the OAuth token; fall back to the manually-entered API key
          if (data.intervals_access_token) {
            setSavedApiKey(`Bearer ${data.intervals_access_token}`);
            setIntervalsConnected(true);
          } else {
            setSavedApiKey(data.api_key ?? '');
            setIntervalsConnected(false);
          }
        }
      });
  }, [user]);

  // ── Disconnect Intervals.icu (data-only mode) ──────────────────────────────
  const handleDisconnectIntervals = useCallback(() => {
    const id = localStorage.getItem(LS_ID);
    if (id) { clearCached(`mmp_v1_${id}`); clearCached(`races_v1_${id}`); }
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_ID);
    localStorage.removeItem(LS_NAME);
    setSavedAthleteId('');
    setSavedApiKey('');
    setSavedAthleteName('');
    setIntervalsConnected(false);
  }, []);

  // ── Save to journal ────────────────────────────────────────────────────────
  const handleSaveToJournal = useCallback(async (result: CPResult, efforts: MaxEffort[]) => {
    if (!user) throw new Error('Not signed in');

    // Upsert profile — store credential under the right column
    if (labCtx?.athleteId || labCtx?.apiKey) {
      const isOAuth = labCtx.apiKey?.startsWith('Bearer ');
      await supabase.from('user_profiles').upsert({
        id: user.id,
        athlete_id: labCtx.athleteId,
        ...(isOAuth
          ? { intervals_access_token: labCtx.apiKey.replace('Bearer ', '') }
          : { api_key: labCtx.apiKey }),
        updated_at: new Date().toISOString(),
      });
    }

    const { error } = await supabase.from('journal_entries').insert({
      user_id: user.id,
      recorded_at: new Date().toISOString().slice(0, 10),
      cp_watts: result.criticalPowerWatts,
      w_prime_joules: result.wPrimeJoules,
      r_squared: result.r2,
      efforts: efforts.map(e => ({
        durationSeconds: e.durationSeconds,
        averagePower: e.averagePower,
        date: e.date,
      })),
    });

    if (error) throw error;
  }, [user, labCtx]);

  if (!authReady) return null;

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-top">
          <div>
            <h1>Performance Prescription Engine</h1>
            <p>Critical Power · W′ · Race Strategy</p>
          </div>
        </div>

        {oauthStatus && (
          <div className="oauth-status-bar">{oauthStatus}</div>
        )}

        <AuthSection
          user={user}
          onSignOut={() => setUser(null)}
          intervalsConnected={intervalsConnected}
        />

        {/* ── Tab nav ──────────────────────────────────────────────────────── */}
        <nav className="tab-nav">
          <button
            className={activeTab === 'lab' ? 'tab-btn active' : 'tab-btn'}
            onClick={() => setActiveTab('lab')}
          >
            The Lab
          </button>
          <button
            className={activeTab === 'strategy' ? 'tab-btn active' : 'tab-btn'}
            onClick={() => setActiveTab('strategy')}
          >
            Strategy Room
          </button>
          <button
            className={activeTab === 'journal' ? 'tab-btn active' : 'tab-btn'}
            onClick={() => setActiveTab('journal')}
          >
            Progress Journal
          </button>
        </nav>
      </header>

      <main className="app-main">

        {/* ── The Lab — always mounted so state survives tab switches ─────── */}
        <div style={{ display: activeTab === 'lab' ? 'block' : 'none' }}>
          <LabWorkbench
            onLabUpdate={setLabCtx}
            user={user}
            initialAthleteId={savedAthleteId}
            initialApiKey={savedApiKey}
            initialAthleteName={savedAthleteName}
            onSaveToJournal={handleSaveToJournal}
            onDisconnectIntervals={handleDisconnectIntervals}
          />
        </div>

        {/* ── Strategy Room gate (only when no lab data) ───────────────────── */}
        {!labCtx && activeTab === 'strategy' && (
          <div className="card tab-gate">
            <p>Run a Lab session first to unlock the Strategy Room.</p>
            <button className="btn-primary btn-sm" onClick={() => setActiveTab('lab')}>
              Go to The Lab
            </button>
          </div>
        )}

        {/* ── Strategy Room — always mounted once labCtx exists ─────────────── */}
        {labCtx && (
          <div style={{ display: activeTab === 'strategy' ? 'block' : 'none' }}>
            <StrategyRoom
              cpWatts={labCtx.cpWatts}
              wPrimeJoules={labCtx.wPrimeJoules}
              weightKg={labCtx.weightKg}
              athleteId={labCtx.athleteId}
              apiKey={labCtx.apiKey}
              selectedEfforts={labCtx.selectedEfforts}
              testEnvironment={labCtx.testEnvironment}
            />
          </div>
        )}

        {/* ── Progress Journal ──────────────────────────────────────────────── */}
        {activeTab === 'journal' && (
          user ? (
            <ProgressJournal user={user} />
          ) : (
            <div className="card tab-gate">
              <p>Sign in to view your Progress Journal.</p>
            </div>
          )
        )}

      </main>

      <footer className="app-footer">
        <a href="/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>
        <span>·</span>
        <a href="/tos.html" target="_blank" rel="noopener">Terms of Service</a>
      </footer>
    </div>
  );
}
