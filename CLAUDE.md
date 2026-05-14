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
2. **The Strategy Room** — Riegel/RE race scenario engine + `StrategyRoom` UI + `PacingSplitPlan` sub-component. **Live — math verified, pacing module active, Riegel calibration panel live, push to Intervals.icu live.**
3. **The Progress Journal** — Historical CP/W′ tracking. **Live — Supabase-backed, SVG line chart, 3/6-month window, Save to Journal from Lab.**
4. **The Data Orchestrator** — Automatic context extraction from Intervals.icu (environment, training terrain CVI, RE). **Live — feeds Pillars 1 & 2.**

---

## Next Immediate Goals

### 1 — Intervals.icu OAuth (deferred)

Intervals.icu OAuth app registration requires a live Privacy Policy URL (`https://aturpace.netlify.app/privacy.html` — now live). Registration not yet done. Once registered, the Intervals.icu OAuth flow replaces manual API key + athlete ID entry for users who connect via Intervals.icu.

### 2 — Strategy Room refinements (open)

- `useEffect` in `StrategyRoom.tsx` re-syncs the orchestrator on every `targetDistanceM` change — may cause excess API calls if the user rapidly changes the distance dropdown. Consider debouncing.
- Pacing currently interpolates pace linearly from start to finish; CVI-adjusted pace per split (terrain-aware effort distribution) is a possible future enhancement.

---

## Build Status

| Module | Status |
|---|---|
| `labEngine.ts` — CP/W′ regression | ✅ **LOCKED** — parity-verified (3-pt: CP 194.9 W, W′ 7.65 kJ, R² 0.9998; 4-pt: CP 189.5 W, W′ 10.22 kJ, R² 0.9989) |
| `envAdjustment.ts` — environmental factor | ✅ parity-verified (98.23 %, 100.56 %) |
| `strategyEngine.ts` — Riegel/RE race scenarios | ✅ parity-verified (53 kg / CP 191 W / TTE 3000 s / env 98.23 % / 42 400 m — ΔW ≤ 0.04 W, ΔT ≤ 1 s) |
| `intervalsClient.ts` — MMP extraction from streams | ✅ live-tested (13 MMP efforts, values match spreadsheet) |
| `effortSelector.ts` — Goldilocks effort picker | ✅ complete |
| `dataOrchestrator.ts` — Pillar 4 context sync | ✅ live-tested. Extracts environment, training terrain CVI (3 longest runs last 6 weeks), and RE. `fetchRecentRaces()` fetches the 6-month race list on demand for the Riegel panel. |
| `supabaseClient.ts` — Supabase singleton | ✅ live — reads `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` env vars |
| `components/AuthSection.tsx` — auth UI | ✅ live — Google OAuth + email/password sign-up/sign-in via Supabase; collapsed bar when signed out, user email + sign-out when signed in |
| `components/LabWorkbench.tsx` — Pillar 1 UI | ✅ live — exports `LabContext`; fires `onLabUpdate` callback to `App.tsx`; accepts `user`, `initialAthleteId`, `initialApiKey`, `onSaveToJournal` props; shows "Save to Journal" button when signed in and CP result is available |
| `components/StrategyRoom.tsx` — Pillar 2 UI | ✅ live — clickable scenario cards, pacing module, RE averaging. Riegel calibration panel: fetches race list on open, shows recommended race with recency + distance scoring, user picks anchor → Riegel table → selects exponent. Separate elevation gain/loss inputs for net-downhill CVI. Training terrain CVI auto-derived from orchestrator. |
| `intervalsWorkout.ts` — push pacing plan to Intervals.icu | ✅ live — POSTs to `/api/v1/athlete/{id}/events`; description in native Intervals.icu text format using %CP zones |
| `components/PacingSplitPlan.tsx` — Pacing sub-component | ✅ live — Negative/Positive/Even split, free km number input (0 = whole distance), SVG chart, split table, push to Intervals.icu with race date picker. `npm run test:pacing` passes (Δ = 0.000 s) |
| `components/ProgressJournal.tsx` — Pillar 3 UI | ✅ live — SVG line chart of CP over time, W′ annotation at each node, 3/6-month window toggle, prev/next page navigation for data older than 6 months, full entry list with delete confirmation |
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
  labEngine.ts                  # CP / W′ regression — LOCKED, parity-verified
  envAdjustment.ts              # Standalone environmental adjustment factor
  strategyEngine.ts             # Pillar 2 engine — CVI, Riegel, RE, race scenarios
  intervalsClient.ts            # MMP extraction from raw watts streams
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
    AuthSection.tsx              # Auth bar — Google OAuth + email sign-in/sign-up; collapsed when signed out
    LabWorkbench.tsx             # Pillar 1 UI — config form + prescription card + workbench + Save to Journal
    StrategyRoom.tsx             # Pillar 2 UI — race setup, scenario cards, pacing module
    PacingSplitPlan.tsx          # Pacing sub-component — split table + SVG power chart + push to Intervals.icu
    ProgressJournal.tsx          # Pillar 3 UI — SVG CP-over-time chart + entry list + delete
    StrategyDashboard.tsx        # ⚠️ Alternate Pillar 2 UI — not mounted, keep or delete
```

---

## Module Reference

### supabaseClient.ts

Exports a single `supabase` client instance (created once) and re-exports the `User` type from `@supabase/supabase-js`. All Supabase calls go through this singleton.

### AuthSection.tsx

`<AuthSection user={user} onSignOut={fn} />`

- Signed-out collapsed state: auth bar with "Sign in" / "Create account" buttons.
- Expanded: Google OAuth (`signInWithOAuth`) + email/password form (`signInWithPassword` / `signUp`). Sign-up sends a Supabase verification email; `emailRedirectTo` is `window.location.origin`.
- Signed-in state: shows `user.email` + "Sign out" button.

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

**Critical API details:**
- MMP must be computed from raw watts stream: `GET /api/v1/activity/{id}/streams?types=watts` → `[{ type: 'watts', data: number[] }]`. `icu_power_curve` is not in the API.
- **Auth:** Basic Auth, username = literal `API_KEY`, password = user's key.
- **Filter:** `icu_ftp > 0` (not `has_power` — unreliable). Sport: `Run` / `VirtualRun`.
- **Browser vs Node:** `BASE_URL` = `''` (browser, Vite proxy / Netlify proxy) or `'https://intervals.icu'` (Node). Uses `btoa()`.

### effortSelector.ts

`autoSelectGoldilocksEfforts(allEfforts)` — returns exactly 2 efforts for the 3-min / 12-min CP protocol.

- **Point 1:** best 180 s match within 180–300 s. Sort: `|dur − 180|` asc → date desc → power desc.
- **Point 2:** best 720 s match within 720–900 s. Same logic.
- **Fallback:** absolute shortest + longest if a bracket is empty.

`effortKey(e)` — stable `${durationSeconds}-${activityId}` used as React key and selection state.

### dataOrchestrator.ts

Pillar 4 — extracts environmental context, training terrain CVI, and Running Effectiveness from Intervals.icu automatically. Three extractors run in parallel via `Promise.all`. Race list is fetched separately on demand (not during the main sync).

**`syncStrategyData(selectedEfforts, athleteId, apiKey, targetDistanceM, cpWatts, weightKg)`**
Returns `StrategyDataResult { environment, trainingTerrainCVI, re, warnings }`.

What the caller still supplies to `calculateRaceScenario`:
- `athlete.cpWatts / wPrimeJoules / weightKg` → from the Lab
- `targetRace.distanceMeters / cvi` → from user input (gain + loss entered separately)
- `targetConditions` (race-day env) → from user input; call `calcEnvAdjustment(result.environment, targetConditions)` to get the factor
- `athlete.trainingTerrainCVI` → from `result.trainingTerrainCVI`

**`fetchRecentRaces(athleteId, apiKey)`** *(exported, called on demand)*
Returns `RaceRecord[]` — all `race === true` runs from the last 6 months, sorted most-recent first. Used by the Riegel Calibration panel. Each record: `{ id, date, name?, distanceMeters, movingTimeSeconds, elevationGainMeters }`. Throws on network failure.

**`extractEnvironmentContext(selectedEfforts, athleteId, apiKey)`**
Fetches the activity detail for the CP test efforts and returns `EnvironmentContext { altitudeM, temperatureC, humidityPercent }`.
- Temperature source: `average_temp` field. If max−min across test activities > 10 °C, falls back to 90-day median.
- Humidity source: `StrydHumidity` sensor field (no native weather humidity in the API).
- Altitude source: `average_altitude` field.

**`extractTrainingTerrainCVI(athleteId, headers)`** *(internal)*
Returns average CVI from the 3 longest non-race runs in the last **6 weeks** (42 days). Uses `total_elevation_gain` as both climb and descent (symmetric assumption). Returns 0 with a warning when no qualifying runs exist.

**`extractPriorRaceAnchor(athleteId, apiKey, targetRaceDistanceMeters?)`** *(exported, dead code — safe to delete)*
No longer called by `syncStrategyData` or any other file. Scans last 180 days for `race === true` runs, returns the race closest to `targetRaceDistanceMeters`. The Riegel panel uses `fetchRecentRaces` instead.

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
- *Without (normal path in StrategyRoom):* `r` from `athlete.baseRiegel` (set by the Riegel Calibration panel) or the distance-bracket default; anchor = `(tteSeconds, adjustedCP)`.

**Performer card scenario selection (StrategyRoom.tsx):**
Cards use the main diagonal of the 3×3 matrix — Riegel and RE vary together:
- `scenarios[0]` — Aggressive Riegel (r+0.01) + Optimistic RE (+0.01) → **Aggressive**
- `scenarios[4]` — Expected Riegel + Expected RE → **Expected**
- `scenarios[8]` — Conservative Riegel (r−0.01) + Pessimistic RE (−0.01) → **Conservative**

Both axes moving together maximises the visible power spread across cards. The full 3×3 matrix remains available for inspection.

**Closed-form solver:**
```
T = ((D × W × T₀^r) / (P₀ × RE))^(1 / (1 + r))
P = P₀ × (T / T₀)^r
```

### intervalsWorkout.ts

`pushPacingPlan(athleteId, apiKey, raceDate, distanceMeters, totalTimeSeconds, splits, cpWatts)` — POSTs the pacing split plan to Intervals.icu as a calendar event.

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

**Push to Intervals.icu:** Race date picker + push button at the bottom of the section. Calls `pushPacingPlan` from `intervalsWorkout.ts`. Push status resets via `useEffect` whenever `splits` changes (prevents stale success/error banner). Requires `cpWatts` prop (raw Lab CP) for %CP zone calculation.
