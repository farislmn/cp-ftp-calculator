import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LabWorkbench } from './components/LabWorkbench.js';
import type { LabContext } from './components/LabWorkbench.js';
import { StrategyRoom } from './components/StrategyRoom.js';
import { AuthSection } from './components/AuthSection.js';
import { ProgressJournal } from './components/ProgressJournal.js';
import { PowerZones } from './components/PowerZones.js';
import { supabase } from './supabaseClient.js';
import type { User } from './supabaseClient.js';
import type { CPResult } from './labEngine.js';
import type { MaxEffort } from './intervalsClient.js';
import { clearCached } from './cache.js';

const LS_TOKEN  = 'ppe_intervals_access_token';
const LS_ID     = 'ppe_intervals_athlete_id';
const LS_NAME   = 'ppe_intervals_athlete_name';

type Tab = 'lab' | 'strategy' | 'journal' | 'zones';

const TAB_META: Record<Tab, { title: string; sub: string }> = {
  lab:      { title: 'The Lab',             sub: 'CP · W′ from maximal efforts'       },
  strategy: { title: 'Strategy Room',       sub: 'Race scenario planner'              },
  journal:  { title: 'Progress Journal',    sub: 'CP over time'                       },
  zones:    { title: 'Individualized Zones', sub: 'Palladino 7-zone prescription'     },
};

// ── Nav icons ─────────────────────────────────────────────────────────────────

function IconLab() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3h8M10 3v7l-5 9h14l-5-9V3"/>
      <line x1="7.5" y1="14" x2="16.5" y2="14"/>
    </svg>
  );
}

function IconStrategy() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9"/>
      <circle cx="12" cy="12" r="3"/>
      <line x1="12" y1="2" x2="12" y2="5"/>
      <line x1="12" y1="19" x2="12" y2="22"/>
      <line x1="2"  y1="12" x2="5"  y2="12"/>
      <line x1="19" y1="12" x2="22" y2="12"/>
    </svg>
  );
}

function IconJournal() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="22 7 13 16 9 11 2 18"/>
      <polyline points="16 7 22 7 22 13"/>
    </svg>
  );
}

function IconZones() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="20" x2="18" y2="10"/>
      <line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6"  y1="20" x2="6"  y2="14"/>
    </svg>
  );
}

const NAV_ICONS: Record<Tab, React.ReactElement> = {
  lab:      <IconLab />,
  strategy: <IconStrategy />,
  journal:  <IconJournal />,
  zones:    <IconZones />,
};

const NAV_LABELS: Record<Tab, string> = {
  lab:      'The Lab',
  strategy: 'Strategy Room',
  journal:  'Progress Journal',
  zones:    'Individualized Zones',
};

const NAV_LABELS_MOBILE: Record<Tab, string> = {
  lab:      'The Lab',
  strategy: 'Strategy',
  journal:  'Journal',
  zones:    'Zones',
};

// ── Focus trap for modal dialogs ─────────────────────────────────────────────

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active || !containerRef.current) return;
    const el = containerRef.current;
    const nodes = el.querySelectorAll<HTMLElement>(FOCUSABLE);
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last?.focus(); }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active, containerRef]);
}

// ── Sidebar footer ────────────────────────────────────────────────────────────

interface SidebarFooterProps {
  user: User | null;
  savedAthleteName: string;
  intervalsConnected: boolean;
  onSignInClick: () => void;
  onSignOut: () => void;
}

function SidebarFooter({ user, savedAthleteName, intervalsConnected, onSignInClick, onSignOut }: SidebarFooterProps) {
  const isConnected = intervalsConnected || !!user;
  const rawName     = savedAthleteName || user?.email?.split('@')[0] || '';
  const displayName = rawName;
  const initials    = rawName.slice(0, 2).toUpperCase() || '??';

  if (!isConnected) {
    return (
      <div className="sidebar-footer">
        <button className="sidebar-signin-btn" onClick={onSignInClick}>
          Sign in
        </button>
        <div className="sidebar-footer-links">
          <a href="/privacy.html" target="_blank" rel="noopener">Privacy</a>
          <span>·</span>
          <a href="/tos.html" target="_blank" rel="noopener">Terms</a>
        </div>
      </div>
    );
  }

  const statusLine = intervalsConnected
    ? 'Connected · Intervals.icu'
    : user ? 'Account only' : '';

  return (
    <div className="sidebar-footer">
      <div className="sidebar-athlete">
        <div className="sidebar-avatar">{initials}</div>
        <div className="sidebar-athlete-info">
          <div className="sidebar-athlete-name">{displayName}</div>
          {statusLine && <div className="sidebar-athlete-sub">{statusLine}</div>}
        </div>
      </div>
      <div className="sidebar-footer-actions">
        <button className="sidebar-signout-btn" onClick={onSignOut}>
          Sign out
        </button>
      </div>
      <div className="sidebar-footer-links">
        <a href="/privacy.html" target="_blank" rel="noopener">Privacy</a>
        <span>·</span>
        <a href="/tos.html" target="_blank" rel="noopener">Terms</a>
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [labCtx,             setLabCtx]             = useState<LabContext | null>(null);
  const [calibratedRiegel,   setCalibratedRiegel]   = useState<number | null>(null);
  const [activeTab,          setActiveTab]          = useState<Tab>('lab');
  const [user,               setUser]               = useState<User | null>(null);
  const [authReady,          setAuthReady]          = useState(false);
  const [oauthStatus,        setOauthStatus]        = useState<string | null>(null);
  const [showAuthPanel,      setShowAuthPanel]      = useState(false);
  const authPanelRef  = useRef<HTMLDivElement>(null);
  const mobileNavRef  = useRef<HTMLElement>(null);
  const lastScrollY   = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      const y     = window.scrollY;
      const delta = y - lastScrollY.current;
      const nav   = mobileNavRef.current;
      if (nav) {
        if (y <= 0) {
          nav.classList.remove('nav-hidden');
        } else if (delta > 5) {
          nav.classList.add('nav-hidden');
        } else if (delta < -8) {
          nav.classList.remove('nav-hidden');
        }
      }
      lastScrollY.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useFocusTrap(authPanelRef, showAuthPanel && !user);

  // Close auth panel on Escape — attached to document so it fires regardless of
  // which element inside the panel has focus (more reliable than onKeyDown on the backdrop).
  useEffect(() => {
    if (!showAuthPanel || user) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowAuthPanel(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showAuthPanel, user]);

  // Persisted Intervals.icu credentials
  const [savedAthleteId,     setSavedAthleteId]     = useState('');
  const [savedApiKey,        setSavedApiKey]        = useState('');
  const [savedAthleteName,   setSavedAthleteName]   = useState('');
  const [intervalsConnected, setIntervalsConnected] = useState(false);

  // Close auth panel when user signs in
  useEffect(() => {
    if (user) setShowAuthPanel(false);
  }, [user]);

  // ── Load data-only Intervals.icu token from localStorage ──────────────────
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

  // ── Auth listener ─────────────────────────────────────────────────────────
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

  // ── Intervals.icu OAuth callback ──────────────────────────────────────────
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

    window.history.replaceState({}, '', window.location.pathname);

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
        const { error: otpErr } = await supabase.auth.verifyOtp({
          token_hash: data.tokenHash as string,
          type: 'magiclink',
        });
        if (otpErr) {
          setOauthStatus(`Sign-in failed: ${otpErr.message}`);
          return;
        }
        setSavedAthleteId(data.athleteId as string);
        setSavedApiKey(`Bearer ${data.intervalsToken as string}`);
        setIntervalsConnected(true);
      } else {
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

  // ── Load profile when user changes ───────────────────────────────────────
  useEffect(() => {
    if (!user) {
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

  // ── Disconnect Intervals.icu ──────────────────────────────────────────────
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

  // ── Sign out (both Supabase + Intervals) ──────────────────────────────────
  const handleSignOut = useCallback(async () => {
    handleDisconnectIntervals();
    if (user) await supabase.auth.signOut();
    // onAuthStateChange fires and clears user state
  }, [user, handleDisconnectIntervals]);

  // ── Save to journal ───────────────────────────────────────────────────────
  const handleSaveToJournal = useCallback(async (result: CPResult, efforts: MaxEffort[]) => {
    if (!user) throw new Error('Not signed in');

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

  const tabMeta = TAB_META[activeTab];

  return (
    <>
    <a href="#main-content" className="skip-link">Skip to content</a>
    <div className="shell">

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-mark">SuperPower</div>
          <div className="sidebar-logo-name">Performance<br />Prescription Engine</div>
        </div>

        <nav className="sidebar-nav" aria-label="Sidebar navigation">
          <div className="sidebar-nav-label">Navigate</div>
          {(['lab', 'strategy', 'journal', 'zones'] as Tab[]).map(tab => (
            <button
              key={tab}
              className={`nav-item${activeTab === tab ? ' active' : ''}`}
              onClick={() => setActiveTab(tab)}
              aria-current={activeTab === tab ? 'page' : undefined}
            >
              {NAV_ICONS[tab]}
              {NAV_LABELS[tab]}
            </button>
          ))}
        </nav>

        <SidebarFooter
          user={user}
          savedAthleteName={savedAthleteName}
          intervalsConnected={intervalsConnected}
          onSignInClick={() => setShowAuthPanel(true)}
          onSignOut={handleSignOut}
        />
      </aside>

      {/* ── Shell main ────────────────────────────────────────────────────── */}
      <div className="shell-main">

        {/* ── Mobile tab bar ──────────────────────────────────────────────── */}
        <nav ref={mobileNavRef} className="mobile-tab-nav" aria-label="Mobile navigation">
          {(['lab', 'strategy', 'journal', 'zones'] as Tab[]).map(tab => (
            <button
              key={tab}
              className={`mobile-tab-btn${activeTab === tab ? ' active' : ''}`}
              onClick={() => setActiveTab(tab)}
              aria-current={activeTab === tab ? 'page' : undefined}
            >
              {NAV_LABELS_MOBILE[tab]}
            </button>
          ))}
          {/* Mobile-only auth ─────────────────────────────────────────────── */}
          <div className="mobile-nav-auth">
            {!(intervalsConnected || !!user) ? (
              <button className="mobile-signin-btn" onClick={() => setShowAuthPanel(true)}>
                Sign in
              </button>
            ) : (
              <div className="mobile-user-pill">
                <div className="mobile-avatar" title={savedAthleteName || user?.email || ''}>
                  {(savedAthleteName || user?.email?.split('@')[0] || '??').slice(0, 2).toUpperCase()}
                </div>
                <button className="mobile-signout-btn" onClick={handleSignOut}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </nav>

        {/* ── Topbar ──────────────────────────────────────────────────────── */}
        <header className="topbar">
          <div>
            <div className="topbar-title">{tabMeta.title}</div>
            <div className="topbar-sub">{tabMeta.sub}</div>
          </div>
          {intervalsConnected && (
            <>
              <div className="topbar-divider" />
              <div className="topbar-status">
                <div className="topbar-status-dot" aria-hidden="true" />
                <span className="topbar-status-text">Connected</span>
              </div>
            </>
          )}
        </header>

        {/* ── OAuth toast ─────────────────────────────────────────────────── */}
        {oauthStatus && (
          <div className="oauth-toast" role="status">{oauthStatus}</div>
        )}

        {/* ── Content ─────────────────────────────────────────────────────── */}
        <main className="content" id="main-content">

          {/* The Lab — always mounted so state survives tab switches */}
          <div style={{ display: activeTab === 'lab' ? 'contents' : 'none' }}>
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

          {/* Strategy Room gate */}
          {!labCtx && activeTab === 'strategy' && (
            <div className="card tab-gate">
              <p>Run a Lab session first to unlock the Strategy Room.</p>
              <button className="btn-primary btn-sm" onClick={() => setActiveTab('lab')}>
                Go to The Lab
              </button>
            </div>
          )}

          {/* Strategy Room — always mounted once labCtx exists */}
          {labCtx && (
            <div style={{ display: activeTab === 'strategy' ? 'contents' : 'none' }}>
              <StrategyRoom
                cpWatts={labCtx.cpWatts}
                wPrimeJoules={labCtx.wPrimeJoules}
                weightKg={labCtx.weightKg}
                athleteId={labCtx.athleteId}
                apiKey={labCtx.apiKey}
                selectedEfforts={labCtx.selectedEfforts}
                testEnvironment={labCtx.testEnvironment}
                onRiegelChange={setCalibratedRiegel}
              />
            </div>
          )}

          {/* Progress Journal */}
          {activeTab === 'journal' && (
            user ? (
              <ProgressJournal user={user} />
            ) : (
              <div className="card tab-gate">
                <p>Sign in to view your Progress Journal.</p>
                <button
                  className="btn-primary btn-sm"
                  onClick={() => setShowAuthPanel(true)}
                >
                  Sign in
                </button>
              </div>
            )
          )}

          {/* Individualized Zones — always mounted when labCtx exists */}
          {labCtx && (
            <div style={{ display: activeTab === 'zones' ? 'contents' : 'none' }}>
              <PowerZones labCtx={labCtx} calibratedRiegel={calibratedRiegel} />
            </div>
          )}
          {!labCtx && activeTab === 'zones' && (
            <div className="card tab-gate">
              <p>Run a Lab session first to generate individualized power zones.</p>
              <button className="btn-primary btn-sm" onClick={() => setActiveTab('lab')}>
                Go to The Lab
              </button>
            </div>
          )}

        </main>
      </div>

      {/* ── Auth overlay ─────────────────────────────────────────────────── */}
      {showAuthPanel && !user && (
        <div
          className="auth-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setShowAuthPanel(false); }}
        >
          <div
            className="auth-overlay-panel"
            ref={authPanelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Sign in"
          >
            <button
              className="auth-overlay-close"
              onClick={() => setShowAuthPanel(false)}
              aria-label="Close sign in panel"
              autoFocus
            >
              ✕
            </button>
            <AuthSection
              user={user}
              onSignOut={handleSignOut}
              intervalsConnected={intervalsConnected}
            />
          </div>
        </div>
      )}

    </div>
    </>
  );
}
