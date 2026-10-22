# Spatiasense — CLAUDE.md

> This file was seeded BEFORE session 1 and is the project's source of truth.
> Read it in full at the start of every session. UPDATE it, never rewrite it
> from scratch: keep every section, change only what became true or false.
> STATUS starts empty on purpose — only add a line once you've verified it.

---

## Product

A browser app that trains spatial estimation. The first and flagship task is
EXTRAPOLATION: the user sees one reference bar and clicks where N copies of it
laid end to end would end ("how long do 6 bars look side by side?"). The
reference bar counts as copy 1: the correct answer is where copy n ends,
measured from the track origin.

### Why it's different (drives design calls)

Existing tools (Matthias Wandel's Eyeballing Game, CanYouGames' perception
games, Eyeball It!, daily estimation games) do matching, bisecting, and
center-finding. Nobody leads with extrapolation. Our second differentiator is
LONG-TERM BIAS TRACKING — "you undershoot by 12% once N is above 4, and it's
improving" — rather than one-off round scores. A daily-seed mode comes later.

When a design decision is unclear, pick the option that (a) keeps extrapolation
central and (b) preserves data needed for bias-over-time analysis.

---

## Stack

- Vite + React + TypeScript — `strict: true`, `noUncheckedIndexedAccess: true`
- Vitest for tests
- Plain SVG rendering, Pointer Events for input
- localStorage for persistence
- NO UI library, NO chart library, NO router, NO Supabase (yet)
- Screens are switched by state in `App.tsx`. There's no router, so no SPA
  404 fallback is needed. If a router is ever added, use hash routing or copy
  index.html to 404.html in the workflow.

## Environment

- Windows / PowerShell. Every command run or documented must work in
  PowerShell. Chain commands with `;` — not `&&` (PowerShell 5.1 lacks it).
- NEVER run a command that waits for interactive input; it hangs the session.
  Use non-interactive flags, or write files by hand.
- GitHub: `iangopen/spatiasense` (PUBLIC — required for Pages on the free
  plan; visibility is Ian's call, never change it). The account was renamed
  from `iangopenbusinessai-lab`; Pages does NOT redirect old usernames.
  `gh` was authenticated on the Windows machine; it is not installed on the
  current macOS machine (use `curl` against the public GitHub API instead).
- Local dev ports: 5199 belongs to another project (strategylab) — use another
  (5231 worked). `npm run preview` uses 4173.

## Deploy

GitHub Pages via GitHub Actions. Push to `main` → `.github/workflows/deploy.yml`
→ Pages. Live: https://iangopen.github.io/spatiasense/
  localStorage is per ORIGIN: history saved at the old
  `iangopenbusinessai-lab.github.io` URL does not carry over to the new one.

- Build job: checkout → setup-node (Node 24, npm cache) → `npm ci` →
  `npm run test` → `npm run build` → upload `dist/`. Tests run BEFORE the
  build, so a failing test never ships. Deploy job: `deploy-pages`.
- Pages source is "GitHub Actions" (`build_type=workflow`), not a branch.
- Vite `base` is `/spatiasense/` for build and preview, `/` for dev. Every
  asset URL must go through Vite (imports, `public/`, or
  `import.meta.env.BASE_URL`) — a hard-coded root path is a blank page in
  production. Check with `npm run preview` → http://localhost:4173/spatiasense/.
- SHARED ORIGIN: every Pages project on this account shares
  `iangopen.github.io` and ONE localStorage. Keys must start
  with `spatiasense:`; never call `clear()`, never use sessionStorage or
  IndexedDB. Enforced by `src/storageSafety.test.ts`.

## Scripts

| Command         | Purpose                                   |
| --------------- | ----------------------------------------- |
| `npm run dev`   | Dev server                                |
| `npm run build` | Type-check + production build (strict gate) |
| `npm run test`  | Vitest, single run                        |

---

## Absolute rules

These are non-negotiable. If a change would violate one, stop and ask Ian.

1. Pure logic lives in `src/core/` and imports NOTHING from React or the DOM.
   React only renders core state and forwards input.

2. Every task type implements one interface in `src/core/types.ts`:
   ```ts
   interface TaskType<P, T, R> {
     id: string;
     label: string;
     defaultParams: P;
     generate(params: P, rng: Rng): T;
     score(trial: T, response: R): TrialScore<P>;
     insightDimensions?: Array<{            // how insight may group trials
       key: string; label: string;
       kind: "ordinal" | "category";
       extract(params: P): number | string; // reads RESOLVED params
     }>;
   }
   interface TrialScore<P> {
     params: P;              // RESOLVED values (e.g. the n actually drawn)
     trueValue: number;
     response: number;
     signedErrorPct: number;
     absErrorPct: number;
     score: number;
     hitLimit: boolean;      // response sat at the input limit → censored
   }
   ```
   The session builds `TrialResult = TrialScore + { taskId, seed, responseMs,
   timestamp }` — `score()` never sees the seed or timings.
   The matching React components live in `src/tasks/[id]/View.tsx` and
   `src/tasks/[id]/Settings.tsx` (props `{ value: P; onChange: (next: P) => void }`).
   All three are registered in ONE place: `src/tasks/registry.ts` (one import,
   one entry), via a `defineTask<P, T, R>(core, View, Settings)` helper that erases the generics to
   an `AnyTask` type IN THAT ONE PLACE. Session code only ever sees unknown
   trials/responses. NO `any` and no casts outside that helper. Adding a future
   task type (fractions, angles, area, rotated bars) must never require editing
   core or session code — if it would, the abstraction is wrong; stop and ask.

3. ALL randomness flows through a seeded RNG (mulberry32) in `src/core/rng.ts`.
   `Math.random` is banned in `src/core/`. Same seed must always produce the
   identical trial sequence. Each round has a `roundSeed`; per-trial seed =
   `hash(roundSeed, trialIndex)`, so any single trial can be regenerated alone.
   `Date.now` is also banned in `src/core/` — timestamps arrive in action
   payloads, because the reducer must stay pure.

4. ALL geometry is in viewBox units, NEVER pixels. Fixed SVG viewBox 1000 x 600.
   Convert pointer positions with `svg.getScreenCTM().inverse()` — never
   offsetX/clientX math. The conversion is a pure function in
   `src/core/geometry.ts` so it's unit-testable. A given answer must score
   identically on a 390px phone and a 1440px monitor. The SVG sets
   `touch-action: none` so dragging never scrolls the page.

5. Session flow is a `useReducer` state machine in `src/core/session.ts`
   (pure reducer, no React import, no clock reads):
   `idle → showing → answering → feedback → (next trial | results)`.
   Components dispatch actions; they never mutate session data. Illegal
   actions for the current state are ignored, never thrown.

6. Every trial produces a `TrialResult` with: `taskId, params, seed, trueValue,
   response, signedErrorPct, absErrorPct, score, hitLimit, responseMs, timestamp`.
   SIGNED error is mandatory — bias direction is the product's core insight.
   `params` stores RESOLVED values: if n was `"random"`, record the n drawn.

---

## Storage

- `src/core/storage.ts` = pure serialize/parse. A thin wrapper outside core
  touches `localStorage`.
- Key: `spatiasense:v1:rounds`. Bump the version on any breaking schema
  change and write a migration (or explicitly drop old data — document which).
- Parse defensively: corrupt or unknown-version data is ignored and reported;
  it NEVER crashes the app.

---

## Task spec: `multiply` (`src/core/tasks/multiply.ts`)

- **Params:** `n` — integer 2–8, default 6, or `"random"` per trial.
  `layout` — `"anchored" | "detached"`, default anchored.
- **generate:** pick `refLength` (min 30 units) and random `startX` / `trackY`
  such that `startX + n * refLength <= 1000 - 40`. Randomize every trial.
  The true endpoint's x must vary widely — never pick the largest refLength
  that fits, or the right screen edge becomes a landmark. The true endpoint
  also leaves room for a 30% overshoot (`end + 0.3 * trueLength <= 960`) so
  the marker clamp never censors overshoots.
- **anchored:** reference bar sits at the start of the answer track (copy 1).
- **detached:** reference bar drawn elsewhere (different x and y, never
  overlapping the track or confirm UI); track starts at its own marked origin.
  The reference bar must itself fit inside the viewBox with the 40-unit margin
  (checked by the 1000-seed fit test).
- **No landmarks:** no gridlines, ticks, rulers, or anything else to measure by.
- **hitLimit:** true when the confirmed marker is within 0.5 units of the
  clamp maximum (`1000 - 40`).
- **Response:** click or drag a marker along the track, adjust, confirm with
  a button or Enter. Marker x clamped to `[origin, 1000 - 40]`. Dragging uses
  pointer capture so the marker keeps tracking when the pointer leaves the bar.
- **score:**
  ```
  trueLength     = n * refLength
  answerLength   = response - origin
  signedErrorPct = (answerLength - trueLength) / trueLength * 100
  score          = max(0, round(100 - 2 * |signedErrorPct|))
  ```
- **Feedback:** draw the true endpoint and ghost-tile all n copies along the
  track. Show signed error, e.g. "+8.3% — overshot".

## Screens

- **Home:** pick a task from the registry, edit params via that task's
  Settings component, start a 10-trial round. Home has no task-specific controls.
- **Play:** the task view.
- **Results:** mean |error|, mean signed bias, best trial, per-trial list.
- **History:** rounds from localStorage, newest first, mean bias per round.
- **Insight** ("Your bias", linked from Home, Results, History): findings
  sentences → BiasChart (x/series selectors from `insightDimensions`) →
  TrendChart (bias per round + rolling average) → per-group table. Empty
  state says what to do. DEV-only "Load demo player" shows sim data IN
  MEMORY ONLY; the screen has no path to storage writes.

## Insight engine (`src/core/insight.ts`)

Rules (all enforced by tests; the engine stays SILENT when in doubt):
- Groups ONLY by a task's `insightDimensions`; imports nothing from
  `core/tasks/` (guard test).
- Censored (`hitLimit`) trials are KEPT at their recorded value and counted
  as `censored`; undershoot and "well calibrated" claims are withheld when
  the censored fraction exceeds `MAX_CENSORED_FRACTION`.
- Ordinal groups with enough data are classed by point estimate (over /
  under / near ±`MIN_BIAS_PCT`); adjacent same-class groups merge into a
  range; a thin group breaks a range. The POOLED range is then tested.
  Category groups stand alone (only if the dimension has 2+ values).
- Bonferroni: the family is EVERY claim tested in a pass (bias ranges,
  accurate ranges, trends). Claim alpha = `FAMILY_ALPHA / familySize`.
- bias: Student-t interval at claim alpha excludes 0 AND |mean| ≥ MIN_BIAS_PCT.
- accurate: the claim-alpha interval lies inside ±`ACCURATE_BAND_PCT`.
- trend: last `TREND_WINDOW` trials vs the window before, Welch t-test at
  claim alpha, AND |bias| changed by ≥ MIN_BIAS_PCT. "improving" if |bias|
  shrank, "worsening" (phrased neutrally) if it grew.
- needsData: thin groups, smallest first, at most MAX_NEEDS_DATA_FINDINGS.
- Displayed intervals are 95% Student-t (not ±1.96).

Thresholds — the ONLY tunables, all in the exported `INSIGHT` object:

| Constant                  | Value | Meaning |
| ------------------------- | ----- | ------- |
| `MIN_TRIALS_PER_GROUP`    | 8     | trials before any claim; below → hollow dot, needsData |
| `MIN_BIAS_PCT`            | 3     | smallest \|mean\| called a bias; class boundary for merging |
| `ACCURATE_BAND_PCT`       | 5     | "well calibrated" interval must sit inside ±this |
| `TREND_WINDOW`            | 20    | trials per trend window (needs 2× in scope) |
| `FAMILY_ALPHA`            | 0.05  | family-wise error rate, Bonferroni-split |
| `CI_LEVEL`                | 0.95  | level of intervals shown to the player |
| `MAX_CENSORED_FRACTION`   | 0.10  | above this, withhold undershoot/accurate claims |
| `MAX_NEEDS_DATA_FINDINGS` | 2     | "play more" prompts shown at once |
| `ROLLING_ROUNDS`          | 5     | TrendChart rolling-average window |

---

## Folder map

```
src/
  core/            pure logic — no React, no DOM, no Math.random, no Date.now
    rng.ts         mulberry32 + seed hashing
    types.ts       TaskType, TrialResult, shared types
    geometry.ts    pointer → viewBox conversion (pure)
    session.ts     reducer state machine
    scoring.ts     shared error/score math + round aggregates
    storage.ts     versioned serialize/parse
    stats.ts       mean, sample SD, Student-t CDF/quantile (no library)
    insight.ts     insight engine: groups by task-declared dimensions ONLY
    insightText.ts findings → plain English
    sim.ts         seeded synthetic players (tests + dev demo)
    tasks/
      multiply.ts  generate + score for "multiply"
  tasks/
    registry.ts    THE ONLY place task types are registered (+ defineTask)
    props.ts       ViewProps / SettingsProps shared by task components
    multiply/
      View.tsx     SVG rendering + input for "multiply"
      Settings.tsx params form for "multiply"
  lib/
    chartMath.ts   pure scales/ticks/symmetric axis/rolling mean (tested)
  components/
    charts/        ChartFrame, BiasChart, TrendChart (hand-rolled SVG)
  screens/
    Home.tsx  Play.tsx  Results.tsx  History.tsx  Insight.tsx
  persistence.ts   thin localStorage wrapper around core/storage
  App.tsx          screen switching via state
```

Test location: colocated `*.test.ts` next to the file under test (matches
the `src/**/*.test.ts` include in `vite.config.ts`).

## How to add a new task type

1. Create `src/core/tasks/<id>.ts` exporting a `TaskType<P, T, R>`:
   params type, trial type, response type, `generate`, `score`. Use only the
   passed-in `rng`. All geometry in viewBox units. Declare
   `insightDimensions` for anything worth grouping bias by.
2. Write its tests: same seed → same trial; every generated trial fits the
   viewBox with margin across 1000 seeds; perfect response → score 100;
   known over/undershoot → correct signed error sign and size.
3. Create `src/tasks/<id>/View.tsx`: render the trial as SVG, convert input
   via `core/geometry.ts`, dispatch actions only. No scoring in the view.
4. Create `src/tasks/<id>/Settings.tsx`: a form with props
   `{ value: P; onChange: (next: P) => void }`. Home renders it generically,
   starting from `defaultParams`.
5. Add ONE entry to `src/tasks/registry.ts` via `defineTask(core, View, Settings)`.
6. If any step required touching `core/session.ts`, `core/types.ts`,
   `core/storage.ts`, or a screen — STOP. The abstraction is wrong; tell Ian.
7. Update this file: folder map, STATUS, session log.

---

## Roadmap (in order)

1. Bias-vs-N chart (hand-rolled SVG, no chart library)
2. More task types: fraction, angle, area, rotated/vertical bars,
   reference-disappears mode
3. Daily seed mode
4. Supabase accounts + leaderboard

Ideas parked mid-session go here, not into the code:

- Trend by regression slope over all trials in a scope (much more power for
  gradual learning than two adjacent 20-trial windows — see STATUS).
- Shrinkage estimates across adjacent n, so sparse n values borrow strength
  instead of going silent.
- Suppress category findings that just restate an ordinal range.

---

## STATUS

Only verified facts. Each line says HOW it was verified.

### Verified

- Session 2: `npm run build` clean and `npm run test` 87/87 pass — run at
  end of session 2 (commit b339751).
- Insight rates, measured over seeded sims (noise SD 10 pp unless noted):
  - V1 truth recovery, −12% at n 5–8 / 0% at n 2–4: bias finding for n 5–8
    within ±3 of −12 in 94% of seeds at 200 trials (97% at SD 8). The FULL
    check (+ "well calibrated for n 2–4") needs more data: 64% at 200,
    79% at 300, **95% at 400 trials** (SD 8: 83% / 96% / 99%). Thresholds
    were NOT loosened; the test asserts ≥ 90% at 400 trials.
  - V2 false positives, unbiased player, 100 trials, full pipeline: a bias
    claim in **11/200 = 5.5%** of seeds; a trend claim in 1/200 = 0.5%.
  - Trend false positives, flat player, 200 trials: 2/200 = 1.0% (bias 0),
    5/200 = 2.5% (bias −8%).
  - Trend power: improving −15→−3% over 40 trials: 68% (SD 6), 21% (SD 10);
    over 200 trials (gradual): **4%**. Worsening −3→−15% over 40 (SD 6): 76%.
  - V3 small samples → only needsData; V4 hitLimit set at the clamp edge and
    not 1 unit inside, censored counted, undershoot claim withheld above 10%;
    V6 a session-1 round (no hitLimit) loads and feeds the engine. Unit tests.
  - V7: insight.ts / insightText.ts / stats.ts import nothing from
    `core/tasks/`; the core purity guard now self-tests its patterns.
- Browser (Chrome extension, session 2, dev server): Insight screen with the
  demo player at 1440px and at 390px (a 390px same-origin iframe, since the
  window would not shrink): findings render; x/series selectors work; split
  by layout shows 2 hollow groups; no horizontal page scroll at 390px (the
  table scrolls in its own box); chart ticks ≈12.6px at 390px; a
  `Storage.prototype.setItem` spy recorded **0 writes** and localStorage
  stayed empty after loading the demo.
- `npm run build` passes (tsc strict + vite build) — run at end of session 1.
- `npm run test`: 39 tests pass — run at end of session 1. Covers: rng
  determinism; pointer→viewBox at 390px and 1440px widths; scoring math;
  multiply fit test (1000 seeds × every n × both layouts, incl. detached
  reference bar and overshoot room); same seed → same trial; signed error
  sign/size; session state machine incl. ignored illegal actions; storage
  round-trip and corrupt/unknown-version data; `src/core/` contains no
  `Math.random`/`Date.now`/React/DOM access (guard test).
- Dev server boots and serves every module (HTTP 200) — checked via curl.
- Repo `iangopenbusinessai-lab/spatiasense` (pre-rename name) was PRIVATE after session 1;
  it is PUBLIC as of the deploy session (`gh repo view`, changed by Ian).
- Deploy session, local: `npm run test` 171/171 (count includes per-file
  guard cases) and `npm run build` clean. `npm run preview` →
  http://localhost:4173/spatiasense/ in Chrome: page, JS and CSS all 200
  (network log), favicon.svg 200 (curl), no other requests; played one
  trial (drag + Enter) → "−0.1% — undershot · score 100" with 6 ghosts.
- Built `dist/index.html` has no root-absolute URL outside `/spatiasense/`
  (grep).
- LIVE (deploy session, push of 3881c50): Pages source switched to
  `build_type=workflow` (`gh api`); Actions run 35836740764 — build ✅
  (171 tests passed in CI, then build), deploy ✅ (`gh run watch`).
  `curl -I` → 200 for https://iangopenbusinessai-lab.github.io/spatiasense/ (pre-rename URL),
  its JS (`index-DP3irSSw.js`, same hash as local), CSS and favicon.svg.
- LIVE play in Chrome (desktop): page/JS/CSS 200 in the network log; one
  trial confirmed with Enter → "+0.5% — overshot · score 99", 6 ghosts and
  the true endpoint drawn. Drag + pointer capture verified by an event log:
  pointerdown → gotpointercapture → pointermove×3 (button held) → pointerup
  → lostpointercapture, marker ended at the drag end. (Two earlier automated
  drags dropped their moves — a tool artifact, not the app.) No
  `spatiasense:` key was written (round quit before 10 trials).

### Open / unverified

- UI not yet exercised in a real browser (the Chrome extension was not
  connected in session 1): drag, pointer capture, Enter-to-confirm, phone
  layout, and History are unverified by hand.
- Nothing Spatiasense-specific is open for the deploy itself. Still open from
  earlier sessions: phone (touch) play, History with real rounds, Insight
  with real rounds.
- Insight with REAL played rounds not checked in a browser (only demo data
  and unit tests with stored-round JSON).
- Trend detection is weak for gradual learning (4% at 200 trials): a design
  limit of adjacent-window comparison, not a bug. See parked ideas.
- "Well calibrated" for a 3-value range needs ~400 trials at SD 10; players
  will see bias findings long before calibration credit.

---

## Decisions log

Choices the spec didn't dictate, with a one-line reason.

- **`score()` returns `TrialScore`, not `TrialResult`** — score() can't know
  the seed (session-owned) or timings (action payloads); returning the full
  TrialResult would force placeholder values like 0 into stored data.
- **`defineTask(core, View, Settings)`** — each task supplies its own params
  form; if Home hard-coded n/layout, every new task would mean editing a screen.
- **(Superseded: repo is PUBLIC and now `iangopen/spatiasense`.) Repo stayed `iangopenbusinessai-lab/spatiasense`, private** — set via
  `gh repo edit --visibility private` (it was public).
- **Tests colocated** as `*.test.ts`. The core purity guard uses
  `import.meta.glob(..., { query: "?raw" })` so tests need no Node types.
- **Storage key renamed to `spatiasense:v1:rounds`** — no data existed yet.
- **multiply generation: total length first, then endpoint** with 30%
  overshoot room. "Uniform refLength, then uniform start" put 14% of
  endpoints within 20 units of the edge, and a clamp at the true end censors
  overshoots → fake undershoot bias. Cost: n=2 bars max ≈354 (not 460).
- **multiply `trueValue`/`response` are lengths** (from the origin), not x
  positions — lengths are what bias analysis compares; x = origin + length.
- **Session phases:** `showing` = trial on screen with no response;
  first `respond` → `answering`; `confirm` only legal in `answering`.
  Round id = `${startedAt base36}-${roundSeed base36}`; saving is idempotent by id.
- **Confirm button is HTML below the SVG**, so the detached reference can
  never overlap it.
- **`hitLimit` added to TrialScore/TrialResult (session 2), additive — NO
  storage version bump.** Stored trials without the field parse as
  `hitLimit: false`; a non-boolean value drops the round.
- **Censored trials are KEPT in means at their recorded value** (the stats
  call them `censored`). Ian's original directive was to exclude them; that
  was wrong: a hitLimit trial is an overshoot whose real error is LARGER than
  recorded, so dropping it removes a big positive value and biases the mean
  toward undershoot even more than keeping the lower bound does (true
  +40,0,0 clamped at +30: truth 13.3, keep 10, drop 0). Since the recorded
  mean is a lower bound, overshoot claims stay safe; undershoot and
  "well calibrated" claims are suppressed where the censored fraction is
  above `MAX_CENSORED_FRACTION`.
- **`insightDimensions` added to TaskType (session 2) — planned one-time
  interface change.** The insight engine groups ONLY by dimensions the task
  declares, so a new task never requires editing the engine. `defineTask`
  erases them (always an array on `AnyTaskCore`).
- **Student-t + Bonferroni (session 2, approved)** instead of mean ±1.96·sd/√n.
  Measured per-group: ±1.96 false-alarmed in 26–45% of unbiased seeds;
  Bonferroni with z ≈ 10%; t + Bonferroni ≈ 4%; full pipeline 5.5%.
  Family = every claim tested in a pass (Ian's addition).
- **Trend test = Welch two-sample t at claim alpha**, not "difference vs each
  window's CI": the latter false-alarmed 8.5% on a flat −8% player (now 2.5%).
  Welch's interval is wider than either window's, so a claimed change is
  outside both windows' noise.
- **"Well calibrated" = claim interval inside ±5%** (equivalence), not merely
  "not significant" — absence of evidence would otherwise earn credit.
- **Ordinal merging uses point estimates, then tests the pooled range**; thin
  groups break ranges; adjacency is among OBSERVED groups (the engine can't
  know unobserved n exist).
- **Category claims need 2+ observed values** (else the group = all trials);
  same rule for category needsData.
- **Unreadable stored params skip that trial** for that dimension; never throw.
- **`simulatePlayer` returns `{ rounds, trials }`** (TrendChart is per round);
  `improvementPerTrial` = pp per trial toward 0; layout random per round.
- **Results shows a censored note**; feedback reads "≥ +31.2% — hit the edge".
- **Charts:** viewBox 380×270, max-width 560px; over/undershoot shown by
  position plus signed tick labels and ↑/↓ words; series by marker SHAPE;
  groups below MIN_TRIALS_PER_GROUP hollow.
- **No casts outside `defineTask`, tests included**: session tests use the
  registry's erased core; two session-1 test casts removed.
- **Session-1 purity guard was broken**: a Python edit wrote a literal
  backspace for the regex word boundary in the DOM check, so it never
  matched. Fixed; the guard now self-tests every pattern. Lesson: edit with
  the Edit tool or raw strings, never escape-processed Python strings.
- **Dev server port**: 5199 is used by another local project (strategylab);
  use another port (5231 worked). Never kill that server.
- **Hosting moved from Vercel to GitHub Pages (deploy session).** Vercel was
  never connected; nothing to tear down.
- **`base` also applies to `vite preview`** (`isPreview`), not build only:
  preview serves the built files, and with base "/" it would 404 every asset.
- **Added `public/favicon.svg` + `<link rel="icon">`**: without it browsers
  request `/favicon.ico` at the shared account root (404 / another project).
- **Pages already existed as a legacy branch build** (main, `/`) serving the
  unbuilt source — a blank page. Switched to `build_type=workflow` right
  before the first push, not earlier, so the live site isn't left with no
  deployment while waiting.
- **Action versions pinned by major** from each repo's latest release
  (checked via `gh api`, deploy session): checkout@v7, setup-node@v7,
  upload-pages-artifact@v5, deploy-pages@v5. No configure-pages step: Pages
  is configured once via the API.
- **roundSeed** comes from `crypto.getRandomValues` in `App.tsx` (outside core).

## Session log

- **Session 0 (planning):** spec and this file written. No code exists.
- **Session 1:** approved TrialScore + defineTask(core, View, Settings) and
  written into rules; repo set private. Built all of core (rng, types,
  geometry, scoring, session, storage, multiply) with tests, registry, the
  multiply View/Settings, and Home/Play/Results/History screens. Changed
  multiply generation to leave overshoot room (see decisions).
- **Session 2 (insight):** hitLimit (kept-and-guarded, not excluded),
  insightDimensions, t-statistics, insight engine + text, seeded sim,
  chartMath, BiasChart/TrendChart, Insight screen with dev demo. 7 commits
  (5119d8b…b339751), not pushed. Rates measured and recorded in STATUS.
  Fixed the silently broken purity guard from session 1.
- **Deploy session:** Vercel → GitHub Pages via Actions; Vite base path;
  favicon; shared-origin storage guard test; CLAUDE.md deploy flow. Found
  the repo PUBLIC (Ian's change) and Pages already on a legacy branch build.
  Pushed on Ian's "push"; CI green; live site verified (see STATUS).
