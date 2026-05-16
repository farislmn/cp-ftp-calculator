# Changelog

All notable changes to the Performance Prescription Engine.

---

## [Unreleased]

### Planned

- **Power Zones panel** (`LabWorkbench.tsx`) — individualized zone table derived from CP/W′. Zones 1–5 as %CP bands; zones above CP calculated from W′ depletion time (`t = W′ / (P − CP)`), giving landmark durations (e.g. 5 min, 3 min, 1 min, 30 s above CP). Output formatted for manual entry into Intervals.icu power zones.
- **Critical Pace mode** — pace-based equivalent of the CP/W′ model for runners without a power meter. Uses the same OLS regression on Distance vs Duration (slope = Critical Speed in m/s, intercept = D′ in metres). Covers The Lab (pace effort input), Strategy Room (pace-based scenarios), and Pacing Plan (min/km splits). Toggle between Power mode and Pace mode throughout the app.

---

## [0.2.0] — 2026-05-17

### Added

- **Manual CP input mode** (`LabWorkbench.tsx`) — pill toggle between Intervals.icu data and manual entry. Two rows by default; add/remove buttons; accepts `mm:ss` or plain-seconds duration. CP Test Conditions (temperature, altitude, humidity) captured alongside manual efforts and passed to Strategy Room as `testEnvironment`. Persists to localStorage (`ppe_lab_cp_source`, `ppe_lab_manual_points`, `ppe_lab_manual_env`). Strategy Room uses `testEnvironment` directly as the environmental baseline when no orchestrator data is available (no Intervals.icu connection required).
- **Power-Duration Curve** (`LabWorkbench.tsx`) — SVG chart (580×240, log X axis, 1 min–1 hour) rendered below the prescription card whenever CP/W′ results exist. Shows the model curve (`P = CP + W′/t`), a dashed CP asymptote, and effort dots for selected inputs. Watt annotations at landmark durations (1 m, 3 m, 5 m, 20 m, 40 m, 1 h) are suppressed when an effort dot is within 15% of that landmark to prevent overlap; effort dots always show their actual measured watt value. Visible in both Performer and Data Nerd views.
- **Intervals.icu OAuth — Netlify serverless function** (`netlify/functions/intervals-oauth.ts`) — handles the OAuth code exchange on the server. Supports three modes: `data` (token-only, no Supabase account), `login` (create/find Supabase account keyed to athlete ID and return a magic-link token), `connect` (attach Intervals.icu token to an existing Supabase session). Requires `INTERVALS_CLIENT_ID`, `INTERVALS_CLIENT_SECRET`, `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` as Netlify env vars.

---

## [0.1.0] — 2026-05-16

### Added

- **`src/cache.ts`** — localStorage TTL cache module. `getCached<T>`, `setCached<T>`, `clearCached`, `clearAllCache`. TTL constants: MMP_EFFORTS 1 h, RACE_LIST 24 h, ORCHESTRATOR 4 h.
- **`src/riegelLookup.ts`** — Riegel exponent lookup table (TypeScript port of `riegel-lookup.js`). Covers 5K / 10K / Half Marathon / Marathon × 10 pace/time bands. Exports `getRiegelExponent()`, `distMetersToKey()`, `distLabelToKey()`.
- **Riegel auto-calibration** (`StrategyRoom.tsx`) — on mount, the race list is fetched in the background and the best-matching past race (70% recency + 30% distance scoring) is used to look up the Riegel exponent automatically. Shown as `r = X.XX · auto` in the calibration panel header. User can override by selecting a row manually; override is persisted for the session.
- **localStorage persistence — Lab** (`LabWorkbench.tsx`) — weight, sex, and power meter survive page refresh. MMP efforts auto-restore from the 1-hour cache on mount (no re-fetch needed). "Last saved" banner shows the most-recently journalled CP when no live data is loaded. Disconnect button clears the MMP cache.
- **localStorage persistence — Strategy Room** (`StrategyRoom.tsx`) — all 7 race inputs (distance, custom km, elevation gain/loss, race temp/humidity/altitude) persist to localStorage and restore on mount.
- **localStorage persistence — Pacing Plan** (`PacingSplitPlan.tsx`) — split interval, split type, deviation %, and race date persist to localStorage and restore on mount.
- **Orchestrator result cache** (`StrategyRoom.tsx`) — `syncStrategyData` result cached 4 h per `{athleteId}_{targetDistanceM}_{cpBucket}`. On refresh within TTL, the Strategy Room populates instantly without hitting Intervals.icu.
- **Race list cache** (`dataOrchestrator.ts`) — `fetchRecentRaces` caches results 24 h per athlete (`races_v1_{athleteId}`). First fetch after expiry hits the API; subsequent calls within 24 h return cached data immediately.
- **CALENDAR:WRITE reconnect flow** (`PacingSplitPlan.tsx`) — when a push to Intervals.icu fails with a `CALENDAR:WRITE` scope error, an inline error box explains the steps and shows a "Reconnect Intervals.icu" button that initiates the OAuth flow with the correct scope.

### Fixed

- **Push to Intervals.icu 403 for OAuth users** (`intervalsWorkout.ts`) — hardcoded Basic auth replaced with `buildAuthHeader(apiKey)` from `intervalsClient.ts`. Now correctly sends `Authorization: Bearer {token}` for OAuth users and `Authorization: Basic ...` for manual API key users.
- **OAuth scope encoding** (`AuthSection.tsx`) — `ACTIVITY:WRITE,CALENDAR:WRITE` scope no longer passed through `encodeURIComponent`. Intervals.icu uses raw comma as scope separator; encoding it to `%2C` caused "Authentication failed" errors.
- **5K scenario power inversion** (`StrategyRoom.tsx`) — for races with expected finish time < TTE (3000 s), the scenario cards now use the anti-diagonal of the 3×3 matrix (`scenarios[6]/[4]/[2]`) instead of the main diagonal (`scenarios[0]/[4]/[8]`). This ensures Aggressive always shows the highest power and fastest time regardless of race distance. Root cause: `P = CP × (T/TTE)^r` with `T < TTE` inverts the effect of `r` on power.
- **Expected card persistent blue** (`StrategyRoom.tsx`) — removed `scenario-card-expected` class from `ScenarioCard`; selection state is now driven solely by `scenario-card-selected`. The Expected card only shows a blue outline when it is the selected card.
- **Prescription card overflow** (`index.css`) — added `overflow: hidden` to `.prescription-card` so inner scenario cards are clipped to the card's `border-radius: 14px` and do not bleed past rounded corners.

### Changed

- **App max-width** (`index.css`) — increased from `800px` to `960px` to give the three-column scenario grid more room at typical desktop widths.
- **Intervals.icu OAuth scope** (`AuthSection.tsx`) — added `CALENDAR:WRITE` to the OAuth scope (`ACTIVITY:WRITE,CALENDAR:WRITE`) so OAuth-authenticated users can push pacing plans to their calendar without a 403 error.

---

## Prior work (pre-changelog)

The following features were built before this changelog was established:

- CP/W′ lab engine with OLS regression (parity-verified against v4 spreadsheet)
- Environmental adjustment factor (`envAdjustment.ts`)
- Riegel/RE race scenario engine (`strategyEngine.ts`, parity-verified)
- MMP extraction from Intervals.icu raw watts streams (`intervalsClient.ts`)
- Data Orchestrator — parallel extraction of environment, training terrain CVI, and RE (`dataOrchestrator.ts`)
- Auth — Supabase email/password + Google OAuth (`AuthSection.tsx`, `supabaseClient.ts`)
- Progress Journal — Supabase-backed CP history with SVG chart (`ProgressJournal.tsx`)
- Pacing split plan with SVG chart and push to Intervals.icu (`PacingSplitPlan.tsx`, `intervalsWorkout.ts`)
- Riegel Calibration panel with race picker and exponent selection (`StrategyRoom.tsx`)
- Privacy Policy and Terms of Service pages (`public/privacy.html`, `public/tos.html`)
- Netlify deployment with API proxy (`netlify.toml`)
