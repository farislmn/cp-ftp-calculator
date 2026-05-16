# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## The Vision

Transitioning the SuperPower Calculator (spreadsheet) into a **"Performance Prescription Engine"** web app. The core value loop is connecting to Intervals.icu to pull maximal efforts, calculating CP/W′, and providing clear target power prescriptions.

## Core Guardrails (NEVER VIOLATE)

1. **Mathematical Parity:** All calculations must yield the exact same results as the original `v4 Calcs` spreadsheet.
2. **Embrace the Mess:** Do not enforce strict errors on messy data. Calculate the result but surface a warning (e.g., R² < 0.95 triggers a "low confidence" UI warning rather than a crash).
3. **Dual-Lens UI:** Build for the Performer (clean, simple answers) first, with a toggle for the Data Nerd (Riegel exponents, RE adjustments, regression stats).

## Architecture (The 4 Pillars)

1. **The Lab** — CP/W′ engine + `LabWorkbench` UI. **Live.**
2. **The Strategy Room** — Riegel/RE race scenario engine + `StrategyRoom` UI + `PacingSplitPlan` sub-component. **Live — math verified, pacing module active, Riegel auto-calibration live, push to Intervals.icu live.**
3. **The Progress Journal** — Historical CP/W′ tracking. **Live — Supabase-backed, SVG line chart, 3/6-month window, Save to Journal from Lab.**
4. **The Data Orchestrator** — Automatic context extraction from Intervals.icu (environment, training terrain CVI, RE). **Live — feeds Pillars 1 & 2. Results cached 4 h to avoid repeat fetches.**

---

## Version

Current release: **v0.2.0** (2026-05-17)

---

## Next Immediate Goals (v0.3 roadmap)

### 1 — Power Zones panel

Display an individualized power zone table in The Lab once CP/W′ are calculated.

**Zone structure:**
- Zones 1–5: standard %CP bands (e.g. Z1 < 55%, Z2 55–75%, Z3 75–87%, Z4 87–93%, Z5 93–100%)
- Zones above CP: derived from W′ depletion time. For a target power P > CP: `t = W′ / (P − CP)`. Landmark powers shown for durations 40 min, 20 min, 10 min, 5 min, 3 min, 1 min, 30 s above CP.
- Output formatted as a copyable zone table the user can enter into Intervals.icu power zones manually.

**Implementation notes:**
- Pure calculation — no new API calls needed.
- Show in both Performer (landmark durations only) and Data Nerd (full table) views.
- Lives in `LabWorkbench.tsx` as a sub-component, rendered below the Power-Duration Curve.

### 2 — Critical Pace mode

A pace-based parallel to the CP/W′ model for runners without a power meter or who prefer pace-based targets.

**Math model:** Same OLS regression as `labEngine.ts` but units change:
- Inputs: effort duration (s) + average pace (min/km or min/mile), converted to average speed (m/s)
- Regression: `Distance = CS × Duration + D′` → slope = Critical Speed (m/s), intercept = D′ (m)
- Above-CP equivalent: `D_remaining = D′ − (actual_speed − CS) × elapsed_time`

**Scope:**
- The Lab: "Pace" mode pill alongside "Power". Manual entry accepts pace + distance or duration. No Intervals.icu fetch path for pace (manual only for now).
- Strategy Room: when pace mode is active, scenario outputs show min/km pace instead of watts; `targetPowerWatts` field replaced by `targetPaceSecPerKm`.
- Pacing Plan: splits shown as min/km targets instead of watts.

**Toggle:** A top-level `mode: 'power' | 'pace'` state in `App.tsx`, passed as prop; Strategy Room and Pacing Plan adapt their display accordingly. Persists to localStorage (`ppe_mode`).

### 3 — Strategy Room debounce (minor)

- `useEffect` in `StrategyRoom.tsx` re-syncs the orchestrator on every `targetDistanceM` change. Cache mitigates impact but debouncing (~400 ms) would be cleaner.

---

## Build Status

| Module | Status |
|---|---|
| `labEngine.ts` — CP/W′ regression | ✅ **LOCKED** — parity-verified (3-pt: CP 194.9 W, W′ 7.65 kJ, R² 0.9998; 4-pt: CP 189.5 W, W′ 10.22 kJ, R² 0.9989) |
| `envAdjustment.ts` — environmental factor | ✅ parity-verified (98.23 %, 100.56 %) |
| `strategyEngine.ts` — Riegel/RE race scenarios | ✅ parity-verified (53 kg / CP 191 W / TTE 3000 s / env 98.23 % / 42 400 m — ΔW ≤ 0.04 W, ΔT ≤ 1 s) |
| `intervalsClient.ts` — MMP extraction from streams | ✅ live-tested (13 MMP efforts, values match spreadsheet) |
| `effortSelector.ts` — Goldilocks effort picker | ✅ complete |
| `cache.ts` — localStorage TTL cache | ✅ live — MMP 1 h, race list 24 h, orchestrator 4 h |
| `riegelLookup.ts` — Riegel exponent lookup table | ✅ live — auto-calibrates from nearest past race on Strategy Room mount |
| `dataOrchestrator.ts` — Pillar 4 context sync | ✅ live-tested. Extracts environment, training terrain CVI (3 longest runs last 6 weeks), and RE. `fetchRecentRaces()` caches 24 h. |
| `supabaseClient.ts` — Supabase singleton | ✅ live — reads `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` env vars |
| `components/AuthSection.tsx` — auth UI | ✅ live — Intervals.icu OAuth + Google OAuth + email/password. OAuth scope: `ACTIVITY:WRITE,CALENDAR:WRITE` (comma unencoded — intervals.icu separator). |
| `components/LabWorkbench.tsx` — Pillar 1 UI | ✅ live — weight/sex/powerMeter persist to localStorage. MMP cache auto-restores on refresh (1 h TTL). "Last saved" banner shows most-recent journal CP. Disconnect clears MMP cache. |
| `components/StrategyRoom.tsx` — Pillar 2 UI | ✅ live — all 7 race inputs persist to localStorage. Orchestrator result cached 4 h. Race list cached 24 h. Riegel auto-calibrated from nearest past race on mount. Scenario cards use diagonal-switching for correct power/time ordering at all distances. |
| `intervalsWorkout.ts` — push pacing plan to Intervals.icu | ✅ live — uses `buildAuthHeader` (supports both OAuth Bearer and manual Basic API key). POSTs to `/api/v1/athlete/{id}/events`. |
| `components/PacingSplitPlan.tsx` — Pacing sub-component | ✅ live — splitEveryKm/splitType/deviationPct/raceDate persist to localStorage. CALENDAR:WRITE error shows inline reconnect button. `npm run test:pacing` passes (Δ = 0.000 s) |
| `components/ProgressJournal.tsx` — Pillar 3 UI | ✅ live — SVG line chart of CP over time, W′ annotation at each node, 3/6-month window toggle, prev/next page navigation, full entry list with delete confirmation |
| `components/StrategyDashboard.tsx` | ⚠️ **Dead code** — `App.tsx` mounts `StrategyRoom`; this file is never rendered. Safe to delete unless a redesign resurrects it. |

**Do not modify `labEngine.ts` regression logic without a full parity re-check against the `v4 Calcs` spreadsheet.**

---

## Tech Stack

React 19 · Vite 8 · TypeScript 5.8 · Supabase (auth + database) · Netlify (hosting) · `tsx` for CLI scripts · no test framework (custom parity scripts only).

## Deployment

- **Hosting:** Netlify at `https://aturpace.netlify.app`
- **Repo:** `https://github.com/farislmn/cp-ftp-calculator` — push to `main` triggers auto-deploy
- **Build config:** `netlify.toml` — build command `npm run build`, publish `dist`, SPA fallback `/*` → `/index.html`
- **API proxy:** `netlify.toml` proxies `/api/*` → `https://intervals.icu/api/:splat` (mirrors the Vite dev server proxy; avoids CORS in the browser)
- **Env vars (Netlify + local `.env`):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- **Supabase Auth redirect URL:** `https://aturpace.netlify.app/**` must be in Supabase → Authentication → URL Configuration → Redirect URLs

## Commands

```bash
npm install                # install deps
npm run dev                # start Vite dev server (http://localhost:5173)
npm run build              # production bundle → dist/
npm run preview            # preview the production build locally
npm test                   # Lab Engine parity checks
npm run test:strategy      # Strategy Room console verification
npm run test:pacing        # Pacing split plan verification (21.1 km, 2% neg split, 5 km splits)
npm run test:api           # Live Intervals.icu API fetch + MMP extraction
npm run auto-cp            # Full pipeline CLI: fetch → select → calculate → print
npm run test:orchestrator  # Data Orchestrator sync test (requires env vars — see below)
npm run typecheck          # tsc --noEmit (uses tsconfig.app.json), zero errors expected
```

**Orchestrator test env vars:**
```bash
ATHLETE_ID=iXXXXXX API_KEY=your-key WEIGHT_KG=53 CP_WATTS=190 \
  TARGET_RACE_DISTANCE=42195 npm run test:orchestrator
```

**Two TypeScript configs:**
- `tsconfig.json` — NodeNext module resolution, used by `tsx` for all CLI scripts.
- `tsconfig.app.json` — bundler + JSX, used by Vite. `npm run typecheck` targets this one. Explicitly sets `types: ["vite/client", "node"]` to satisfy both `import.meta.env` and Supabase's Node type dependencies.

**Import extension rule:** All intra-project imports must use `.js` extensions even though the source files are `.ts` (e.g. `import { calculateCP } from '../labEngine.js'`). This is required by NodeNext module resolution and applies everywhere — Vite, `tsx`, and Node all expect it.

**No linting:** There is no ESLint or Prettier setup. `npm run typecheck` is the only automated correctness check beyond the parity test scripts.

## State Architecture

`App.tsx` manages auth state (Supabase `onAuthStateChange`), tab navigation, and the `LabContext` bridge between pillars.

- **Auth:** `user` (Supabase `User | null`) is read from `supabase.auth.getSession()` on load, then kept live via `onAuthStateChange`. On sign-in, the user's `user_profiles` row is fetched to pre-fill `savedAthleteId` / `savedApiKey`.
- **Tab nav:** Three tabs — The Lab, Strategy Room, Progress Journal. `LabWorkbench` and `StrategyRoom` (once `labCtx` exists) are **always mounted** and toggled via `display: none` so their internal state survives tab switches. Progress Journal is conditionally mounted (requires auth).
- **Lab → Strategy bridge:** `LabWorkbench` calls `onLabUpdate` with a `LabContext` object (cpWatts, wPrimeJoules, weightKg, athleteId, apiKey, selectedEfforts). `App.tsx` stores this and passes it as props to `StrategyRoom`. `StrategyRoom` calls `syncStrategyData` internally and manages all orchestrator state itself.
- **Save to Journal:** `App.tsx` owns `handleSaveToJournal` — upserts `user_profiles` (credentials) and inserts to `journal_entries`. Called by `LabWorkbench` via `onSaveToJournal` prop.

### localStorage persistence keys

| Prefix | Component | What's stored |
|---|---|---|
| `ppe_lab_*` | LabWorkbench | weight, sex, powerMeter, lastSaved CP snapshot |
| `ppe_lab_sel_{athleteId}` | LabWorkbench | selected effort keys per athlete |
| `ppe_strategy_*` | StrategyRoom | distanceLabel, customKm, gainM, lossM, tempC, humidity, altitudeM |
| `ppe_pacing_*` | PacingSplitPlan | splitEveryKm, splitType, deviationPct, raceDate |
| `ppe_v1_mmp_v1_{athleteId}` | cache.ts | MMP efforts (1 h TTL) |
| `ppe_v1_races_v1_{athleteId}` | cache.ts | Race list (24 h TTL) |
| `ppe_v1_orch_v1_{athleteId}_{distM}_{cpBucket}` | cache.ts | Orchestrator result (4 h TTL) |

## Supabase Schema

Two tables, both with RLS enabled (users can only access their own rows):

```sql
-- Stores Intervals.icu credentials so they persist across sessions
create table public.user_profiles (
  id         uuid references auth.users(id) on delete cascade primary key,
  athlete_id text,
  api_key    text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- One row per "Save to Journal" click in the Lab
create table public.journal_entries (
  id              uuid default gen_random_uuid() primary key,
  user_id         uuid references auth.users(id) on delete cascade not null,
  recorded_at     date not null default current_date,
  cp_watts        numeric(6,2) not null,
  w_prime_joules  numeric(10,2) not null,
  r_squared       numeric(6,4),
  efforts         jsonb,   -- [{durationSeconds, averagePower, date}]
  created_at      timestamptz default now()
);
```

## Code Structure

```
index.html                      # Vite HTML entry point
netlify.toml                    # Netlify build config + API proxy + SPA fallback
public/
  mockup.html                   # Static UI mockup — not part of the app build
  privacy.html                  # Hosted privacy policy (https://aturpace.netlify.app/privacy.html)
  tos.html                      # Hosted terms of service (https://aturpace.netlify.app/tos.html)
vite.config.ts                  # Vite config — proxies /api → intervals.icu (dev only; netlify.toml handles prod)
src/
  main.tsx                      # React entry point
  App.tsx                       # Root — auth state, tab nav, Lab/Strategy/Journal orchestration
  index.css                     # Global stylesheet (CSS custom properties, responsive)
  supabaseClient.ts             # Supabase client singleton (reads VITE_ env vars)
  cache.ts                      # localStorage TTL cache — getCached/setCached/clearCached/clearAllCache
  labEngine.ts                  # CP / W′ regression — LOCKED, parity-verified
  envAdjustment.ts              # Standalone environmental adjustment factor
  strategyEngine.ts             # Pillar 2 engine — CVI, Riegel, RE, race scenarios
  riegelLookup.ts               # Riegel exponent lookup table — getRiegelExponent(), distMetersToKey()
  intervalsClient.ts            # MMP extraction from raw watts streams; buildAuthHeader() for OAuth/Basic
  effortSelector.ts             # Goldilocks effort selector — autoSelectGoldilocksEfforts()
  dataOrchestrator.ts           # Pillar 4 — environment, prior race, RE from Intervals.icu
  intervalsWorkout.ts           # Push pacing plan to Intervals.icu as a calendar event
  autoCp.ts                     # Full-pipeline CLI script
  test.ts                       # Lab Engine parity verifier
  strategyTest.ts               # Strategy Engine parity verifier
  testApi.ts                    # Live Intervals.icu API test
  testOrchestrator.ts           # Orchestrator sync test
  testPacing.ts                 # Pacing split plan verifier (npm run test:pacing)
  components/
    AuthSection.tsx              # Auth bar — Intervals.icu OAuth + Google OAuth + email sign-in/sign-up
    LabWorkbench.tsx             # Pillar 1 UI — config form + prescription card + workbench + Save to Journal
    StrategyRoom.tsx             # Pillar 2 UI — race setup, scenario cards, pacing module
    PacingSplitPlan.tsx          # Pacing sub-component — split table + SVG power chart + push to Intervals.icu
    ProgressJournal.tsx          # Pillar 3 UI — SVG CP-over-time chart + entry list + delete
    StrategyDashboard.tsx        # ⚠️ Alternate Pillar 2 UI — not mounted, keep or delete
```

---

## Module Reference

### cache.ts

`getCached<T>(key)` — reads from `ppe_v1_{key}` in localStorage; returns `null` if missing or expired.
`setCached<T>(key, data, ttlMs)` — writes with expiry timestamp.
`clearCached(key)` — removes one entry.
`clearAllCache()` — wipes all `ppe_v1_` entries.

TTL constants (ms): `TTL.MMP_EFFORTS` (1 h), `TTL.RACE_LIST` (24 h), `TTL.ORCHESTRATOR` (4 h).

### riegelLookup.ts

`getRiegelExponent(targetDistance, knownDistance, knownTimeSeconds): number | null`
Looks up the Riegel exponent from a precomputed table covering four target distances (5K, 10K, HM, Marathon) × ten pace/time bands. Returns `null` when inputs are out of range.

`distMetersToKey(distanceMeters): DistKey | null` — maps a distance in metres to `'5k' | '10k' | 'halfMarathon' | 'marathon'`.
`distLabelToKey(label): DistKey | null` — maps UI labels (`'5K'`, `'10K'`, `'Half Marathon'`, `'Marathon'`) to the same keys.

Riegel values in the table are negative (e.g. −0.07) matching `baseRiegel` sign convention in `strategyEngine.ts`.

### supabaseClient.ts

Exports a single `supabase` client instance (created once) and re-exports the `User` type from `@supabase/supabase-js`. All Supabase calls go through this singleton.

### AuthSection.tsx

`<AuthSection user={user} onSignOut={fn} intervalsConnected={bool} />`

- Signed-out collapsed state: auth bar with "Sign in" / "Create account" buttons.
- Expanded: Intervals.icu OAuth + Google OAuth (`signInWithOAuth`) + email/password form. Sign-up sends a Supabase verification email; `emailRedirectTo` is `window.location.origin`.
- Signed-in state: shows display name + "Sign out". Non-Intervals users see "Connect Intervals.icu" button if not yet connected.
- OAuth scope: `ACTIVITY:WRITE,CALENDAR:WRITE` — comma must NOT be URL-encoded (intervals.icu uses raw comma as separator; `%2C` is treated as a literal character, breaking scope parsing).

`initiateIntervalsOAuth(mode)` — exported; called by `PacingSplitPlan` for the CALENDAR:WRITE reconnect flow.

### ProgressJournal.tsx

`<ProgressJournal user={user} />`

Fetches all `journal_entries` for the user on mount. State:
- `windowMonths: 3 | 6` — default 3, toggled by button pair.
- `pageIndex: number` — 0 = most recent window, increments backward in time. Each page covers `windowMonths` months. Resets to 0 when `windowMonths` changes.
- Window bounds: `windowEnd = today − pageIndex × windowMonths months`, `windowStart = windowEnd − windowMonths`.

**SVG chart:** viewBox 660×290, padding 44/24/48/58 (top/right/bottom/left). Y axis = CP watts with 5 gridlines auto-scaled to data range ±20%. X axis = monthly ticks. Polyline + area fill + interactive circles. W′ (kJ) shown as static annotation above each node; CP + date shown in a tooltip rect on hover.

**Delete:** confirmation modal (`modal-overlay` / `modal-box`). Deletes by `id` + `user_id` (double-checks RLS client-side).

### envAdjustment.ts

`calcEnvAdjustment(test, target)` — accepts two `EnvironmentConditions` (`{ altitudeM, temperatureC, humidityPercent }`) and returns `{ factor, factorPercent, components }`.

```
tAdj   = 1 − ΔTemp   × 0.0029
hAdj   = 1 − ΔHumid  × 0.0007
altAdj = 1 − ΔAlt    × 0.00003
factor = clamp(tAdj × hAdj × altAdj, 0.80, 1.20)
```

### labEngine.ts

**Math model:** Work (J) = averagePower × durationSeconds. OLS regression of Work (y) vs durationSeconds (x) → slope = CP (W), intercept = W′ (J).

**W′ rating:** ±15% band around sex × meter baselines. Stryd Wind/non-Wind only; `'Others (Garmin/Coros-based power, etc)'` → `'N/A'`.

**Low-confidence path:** R² < 0.95 adds a `warning` object. `suggestedCorrection` ranks efforts by *relative* residual to avoid scale bias. Always returns CP and W′ — the warning is additive.

**Effort validation:** inclusive [180 s, 2400 s]. Throws (hard error) on out-of-range durations.

### intervalsClient.ts

`fetchMaxEfforts(athleteId, apiKey, daysBack?)` — fetches the 20 most recent power-run activities, computes MMP for 13 canonical durations (120–1800 s) via O(n) sliding window. Returns `MaxEffort[]`.

`buildAuthHeader(apiKey)` — returns `'Bearer {token}'` if `apiKey` starts with `'Bearer '`, otherwise `'Basic ' + btoa('API_KEY:' + apiKey)`. Used everywhere auth is sent to Intervals.icu.

**Critical API details:**
- MMP must be computed from raw watts stream: `GET /api/v1/activity/{id}/streams?types=watts` → `[{ type: 'watts', data: number[] }]`. `icu_power_curve` is not in the API.
- **Auth:** `buildAuthHeader(apiKey)` — supports both OAuth Bearer tokens and manual Basic auth API keys.
- **Filter:** `icu_ftp > 0` (not `has_power` — unreliable). Sport: `Run` / `VirtualRun`.
- **Browser vs Node:** `BASE_URL` = `''` (browser, Vite proxy / Netlify proxy) or `'https://intervals.icu'` (Node). Uses `btoa()`.

### effortSelector.ts

`autoSelectGoldilocksEfforts(allEfforts)` — returns exactly 2 efforts for the 3-min / 12-min CP protocol.

- **Point 1:** best 180 s match within 180–300 s. Sort: `|dur − 180|` asc → date desc → power desc.
- **Point 2:** best 720 s match within 720–900 s. Same logic.
- **Fallback:** absolute shortest + longest if a bracket is empty.

`effortKey(e)` — stable `${durationSeconds}-${activityId}` used as React key and selection state.

### dataOrchestrator.ts

Pillar 4 — extracts environmental context, training terrain CVI, and Running Effectiveness from Intervals.icu automatically. Three extractors run in parallel via `Promise.all`. Race list is fetched separately (cached 24 h).

**`syncStrategyData(selectedEfforts, athleteId, apiKey, targetDistanceM, cpWatts, weightKg)`**
Returns `StrategyDataResult { environment, trainingTerrainCVI, re, warnings }`.
*Caching is handled by the caller (`StrategyRoom.tsx`) — key `orch_v1_{athleteId}_{distM}_{cpBucket}`, TTL 4 h.*

What the caller still supplies to `calculateRaceScenario`:
- `athlete.cpWatts / wPrimeJoules / weightKg` → from the Lab
- `targetRace.distanceMeters / cvi` → from user input (gain + loss entered separately)
- `targetConditions` (race-day env) → from user input; call `calcEnvAdjustment(result.environment, targetConditions)` to get the factor
- `athlete.trainingTerrainCVI` → from `result.trainingTerrainCVI`

**`fetchRecentRaces(athleteId, apiKey)`** *(exported, cached 24 h internally)*
Returns `RaceRecord[]` — all `race === true` runs from the last 6 months, sorted most-recent first. Cache key `races_v1_{athleteId}`. Used by the Riegel Calibration panel and auto-calibration. Each record: `{ id, date, name?, distanceMeters, movingTimeSeconds, elevationGainMeters }`. Throws on network failure.

**`extractEnvironmentContext(selectedEfforts, athleteId, apiKey)`**
Fetches the activity detail for the CP test efforts and returns `EnvironmentContext { altitudeM, temperatureC, humidityPercent }`.
- Temperature source: `average_temp` field. If max−min across test activities > 10 °C, falls back to 90-day median.
- Humidity source: `StrydHumidity` sensor field (no native weather humidity in the API).
- Altitude source: `average_altitude` field.

**`extractTrainingTerrainCVI(athleteId, headers)`** *(internal)*
Returns average CVI from the 3 longest non-race runs in the last **6 weeks** (42 days). Uses `total_elevation_gain` as both climb and descent (symmetric assumption). Returns 0 with a warning when no qualifying runs exist.

**`extractPriorRaceAnchor(athleteId, apiKey, targetRaceDistanceMeters?)`** *(exported, dead code — safe to delete)*
No longer called by `syncStrategyData` or any other file. The Riegel panel uses `fetchRecentRaces` instead.

**`extractRunningEffectiveness(athleteId, apiKey, targetDistanceM, cpWatts, weightKg)`**
Returns `REResult { longRunRE, intervalRE }`. Throws (strict error) if `targetDistanceM` is null.
- **Long Run RE:** 3 longest non-race runs > 10 km in last 90 days. Fetches `GET /api/v1/activity/{id}/intervals` → `{ icu_intervals: [...] }` (note: object wrapper, not raw array). Finds the longest active interval; falls back to whole-activity averages.
- **Interval RE:** Scans last 90 days for intervals whose `average_watts` falls in the %CP bracket for the target distance (5K: 97–110%, 10K: 90–100%, HM: 85–93%, Marathon: 79–87%). Speed derived as `distance / moving_time` if `average_speed` is absent.
- Uses 90 days (not 6 weeks) to capture a full training block — athletes in post-race recovery may have no relevant runs in 6 weeks.

**Critical Intervals.icu API field names** (verified against live data, May 2026):

| Concept | Field | Notes |
|---|---|---|
| Race detection | `race: boolean` | `workout_type` is always `null` — do not use |
| Temperature | `average_temp` | Device sensor, °C |
| Humidity | `StrydHumidity` | Stryd sensor only; no native weather humidity field |
| Altitude | `average_altitude` | Average during run; `min_altitude` can be negative near sea level |
| Activity avg power | `icu_average_watts` | |
| Intervals endpoint | `GET /api/v1/activity/{id}/intervals` | Returns `{ icu_intervals: [...] }`, not a bare array |

### strategyEngine.ts

**CVI:** `calculateCVI(distanceM, climbM, descM)` → `{ cvi, cviNet }` (feet/miles).

**Distance brackets:** `resolveDistanceBracket(distanceM)` — 5K (4 850–5 500 m), 10K (9 500–10 500 m), HM (20 000–22 000 m), Marathon (40 929–43 460 m). Outside → `'Custom'` + `outOfBounds: true`.

**RE Adjustment Matrix** (Δ applied to `baseRE`):

| Training → Target | Flat | SlightlyHilly | ModeratelyHilly |
|---|---|---|---|
| **Flat** | 0 | −0.015 | −0.030 |
| **SlightlyHilly** | +0.015 | 0 | −0.015 |
| **ModeratelyHilly** | +0.030 | +0.015 | 0 |

**`calculateRaceScenario(athlete, targetRace, priorRace?, envAdjustmentFactor = 1.0)`**
- `envAdjustmentFactor` multiplies CP before solving (obtain from `calcEnvAdjustment`).
- `percentCP` is always relative to `adjustedCP`.
- `Athlete`: `cpWatts`, `wPrimeJoules`, `weightKg`, `baseRE`, `tteSeconds?` (default 3000), `baseRiegel?`, `trainingTerrainCVI?` (default 0 — flat).
- `ScenarioResult`: `formattedTime` (e.g. `"4:12:22"`), `percentCP`, `targetPowerWatts`, `riegelExponent`, `adjustedRE`.
- Training terrain: `trainingTerrainCVI` on the `Athlete` drives the RE adjustment matrix. Falls back to `priorRace.cvi` then 0.

**Riegel anchor:**
- *With prior race (optional):* `r = log(priorPower / CP) / log(priorTime / TTE)` — derived so the curve passes through both `(priorTime, priorPower)` and `(TTE, CP)`.
- *Without (normal path in StrategyRoom):* `r` from `athlete.baseRiegel` (set by the Riegel Calibration panel or auto-calibrated) or the distance-bracket default; anchor = `(tteSeconds, adjustedCP)`.

**Performer card scenario selection (StrategyRoom.tsx) — diagonal switching:**

The 3×3 scenario matrix varies Riegel (rows: r+0.01, r, r−0.01) and RE (cols: RE+0.01, RE, RE−0.01):

```
[0](r+,RE+)  [1](r+,RE)  [2](r+,RE−)
[3](r, RE+)  [4](r, RE)  [5](r, RE−)
[6](r−,RE+)  [7](r−,RE)  [8](r−,RE−)
```

For **T > TTE** (long race — HM, Marathon): `P = CP × (T/TTE)^r` with T/TTE > 1 and r < 0 means higher r (closer to 0) → higher P. **Main diagonal:**
- Aggressive = `scenarios[0]` (r+0.01, RE+0.01) → highest P + fastest time
- Expected   = `scenarios[4]`
- Conservative = `scenarios[8]` (r−0.01, RE−0.01) → lowest P + slowest time

For **T < TTE** (short race — 5K, 10K): T/TTE < 1 and r < 0 means more-negative r → higher P (the relationship inverts). **Anti-diagonal:**
- Aggressive = `scenarios[6]` (r−0.01, RE+0.01) → highest P + fastest time
- Expected   = `scenarios[4]`
- Conservative = `scenarios[2]` (r+0.01, RE−0.01) → lowest P + slowest time

Detection: `expTime = output.scenarios[4].estimatedTimeSeconds < 3000` (default TTE).

**Closed-form solver:**
```
T = ((D × W × T₀^r) / (P₀ × RE))^(1 / (1 + r))
P = P₀ × (T / T₀)^r
```

### intervalsWorkout.ts

`pushPacingPlan(athleteId, apiKey, raceDate, distanceMeters, totalTimeSeconds, splits, cpWatts)` — POSTs the pacing split plan to Intervals.icu as a calendar event.

Uses `buildAuthHeader(apiKey)` — works for both OAuth Bearer tokens and manual Basic auth API keys.

**Intervals.icu events API gotchas (verified live, May 2026):**
- Endpoint: `POST /api/v1/athlete/{id}/events`
- `category` is required and must be `'WORKOUT'` (all caps — other casings cause a 400 JSON parse error).
- `start_date_local` must be a full datetime string: `'YYYY-MM-DDTHH:MM:SS'` (date-only causes a 422 DateTimeParseException).
- Workout steps go in the `description` field as **native Intervals.icu text format** — one line per step, newline-separated. The `workout_doc` field is silently ignored by the events endpoint (it works only for the dedicated workouts endpoint).
- Native step format: `- {distKm}km {lowPct}%-{highPct}% {label}` — percentages are relative to raw Lab CP (`cpWatts`), applied to the env-adjusted split power (±2% band around the split target).

**Power zone format:** `%CP` — `Math.round(split.powerW * 0.98 / cpWatts * 100)%` to `Math.round(split.powerW * 1.02 / cpWatts * 100)%`. Numerator is split power after environmental factor; denominator is raw Lab CP.

### PacingSplitPlan.tsx

`buildSplits(targetPowerW, re, weightKg, distanceMeters, splitEveryM, splitType, deviationPct)` — exported for testing.

**Pace interpolation (not power):** Average pace = `W / (P × RE)` s/m. A pace *factor* is linearly interpolated at each chunk's midpoint, then time and back-calculated power are derived from that pace. This guarantees `Σ T_i = T_scenario` exactly (power interpolation violates this via the harmonic-mean inequality).

- Negative Split (2% deviation): `startFactor = 1 + dev/2`, `endFactor = 1 − dev/2` → slower start, faster finish
- Positive Split: reversed
- Even Split: factor = 1 throughout

`Σ T_i = T_scenario` exactly — verified by `npm run test:pacing` (Δ = 0.000 s).

**Split every:** Free number input in km. `0` (or empty) collapses all splits into one step covering the full distance. `splitEveryM = (!splitEveryKm || splitEveryKm <= 0) ? distanceMeters : splitEveryKm * 1000`.

**Persistence:** `splitEveryKm`, `splitType`, `deviationPct`, and `raceDate` are stored to localStorage immediately on change (`ppe_pacing_*` keys) and restored on mount. Survives page refresh.

**Push to Intervals.icu:** Race date picker + push button at the bottom of the section. Calls `pushPacingPlan` from `intervalsWorkout.ts`. Push status resets via `useEffect` whenever `splits` changes (prevents stale success/error banner). Requires `cpWatts` prop (raw Lab CP) for %CP zone calculation. If the push fails with `CALENDAR:WRITE` missing, an inline "Reconnect Intervals.icu" button initiates the OAuth flow with the correct scope.
