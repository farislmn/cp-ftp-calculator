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

type Tab = 'lab' | 'strategy' | 'journal';

export default function App() {
  const [labCtx,    setLabCtx]    = useState<LabContext | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('lab');
  const [user,      setUser]      = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  // Persisted Intervals.icu credentials for the logged-in user
  const [savedAthleteId, setSavedAthleteId] = useState('');
  const [savedApiKey,    setSavedApiKey]    = useState('');

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

  // ── Load profile when user changes ─────────────────────────────────────────
  useEffect(() => {
    if (!user) {
      setSavedAthleteId('');
      setSavedApiKey('');
      return;
    }
    supabase
      .from('user_profiles')
      .select('athlete_id, api_key')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setSavedAthleteId(data.athlete_id ?? '');
          setSavedApiKey(data.api_key ?? '');
        }
      });
  }, [user]);

  // ── Save to journal ────────────────────────────────────────────────────────
  const handleSaveToJournal = useCallback(async (result: CPResult, efforts: MaxEffort[]) => {
    if (!user) throw new Error('Not signed in');

    // Upsert profile with latest credentials
    if (labCtx?.athleteId || labCtx?.apiKey) {
      await supabase.from('user_profiles').upsert({
        id: user.id,
        athlete_id: labCtx.athleteId,
        api_key: labCtx.apiKey,
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

        <AuthSection user={user} onSignOut={() => setUser(null)} />

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

        {/* ── The Lab ──────────────────────────────────────────────────────── */}
        {activeTab === 'lab' && (
          <LabWorkbench
            onLabUpdate={setLabCtx}
            user={user}
            initialAthleteId={savedAthleteId}
            initialApiKey={savedApiKey}
            onSaveToJournal={handleSaveToJournal}
          />
        )}

        {/* ── Strategy Room ─────────────────────────────────────────────────── */}
        {activeTab === 'strategy' && (
          labCtx ? (
            <StrategyRoom
              cpWatts={labCtx.cpWatts}
              wPrimeJoules={labCtx.wPrimeJoules}
              weightKg={labCtx.weightKg}
              athleteId={labCtx.athleteId}
              apiKey={labCtx.apiKey}
              selectedEfforts={labCtx.selectedEfforts}
            />
          ) : (
            <div className="card tab-gate">
              <p>Run a Lab session first to unlock the Strategy Room.</p>
              <button className="btn-primary btn-sm" onClick={() => setActiveTab('lab')}>
                Go to The Lab
              </button>
            </div>
          )
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
    </div>
  );
}
