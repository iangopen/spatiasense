# Spatiasense

Spatiasense is a browser app that trains spatial estimation. In its first task, **extrapolation**, you see one reference bar and click where N copies of it laid end to end would finish ("where do 6 of these bars end?"); the reference bar counts as copy 1, and you are scored on how far your click is from the true endpoint.

**Play it: <https://iangopen.github.io/spatiasense/>** (no account; your rounds stay in your browser's localStorage).

## Why it's different

- **It leads with extrapolation.** Existing eyeballing tools (Matthias Wandel's Eyeballing Game, CanYouGames' perception games, Eyeball It!, daily estimation games) do matching, bisecting and center-finding. Nobody leads with "make N of these".
- **It tracks your bias over time.** Instead of only a score per round, the *Your bias* screen says things like "you undershoot by about 12% when n is 5–8" and whether that is improving, using the *signed* error of every trial ever stored.

## How the insight engine stays honest

A trainer that tells you "you undershoot" from a handful of trials is worse than one that says nothing, so the engine (`src/core/insight.ts`) stays silent when in doubt:

- **Student-t intervals**, not mean ± 1.96·SD/√n. The ±1.96 version raised a false alarm in 26–45% of simulated unbiased players per group.
- **Bonferroni across every claim tested in a pass** (bias ranges, "well calibrated" ranges and trends together), at a 5% family-wise rate.
- **Trends are a regression slope** of signed error over your most recent 200 trials, t-tested at the same corrected level. A gradual −15% → −3% improvement over 200 trials is detected in 98% of simulated players; the earlier two-window test found it in 4%.
- **Censored overshoots are kept.** A click pinned at the right edge is an overshoot whose true error is larger than recorded; dropping it would bias the mean toward undershoot. Those trials are counted, and undershoot and "well calibrated" claims are withheld when more than 10% of a group is censored.
- **No directional hints from thin data.** A range with data but no claim says only "No clear bias at n = 5–8 yet (14 trials)."

Measured on seeded simulated players (noise SD 10 percentage points; all rates are tests in the repo):

| Check | Rate |
| --- | --- |
| Unbiased player, 100 trials: any bias claim (false positive) | 11/200 = 5.5% |
| Flat player, 200 trials: any trend claim | 0/200 (bias 0), 2/200 = 1.0% (bias −8%) |
| True −12% undershoot at n 5–8, 200 trials: found within ±3 points | 94% |
| Same, plus "well calibrated" at n 2–4, 400 trials | 95% (64% at 200 trials) |
| Gradual improvement −15% → −3%, 200 trials: "improving" | 98.0% (81.5% at 100 trials) |

The noise level of real players is an assumption (SD 10); the *Copy my data* button on History exports your rounds as JSON so it can be measured.

## Architecture

- **Pure core** (`src/core/`): scoring, session state machine, storage format, statistics and the insight engine import nothing from React or the DOM. A guard test fails if `Math.random`, `Date.now` or DOM access appears there.
- **Task registry** (`src/tasks/registry.ts`): every task implements one `TaskType` interface (generate, score, declared insight dimensions) and is registered in one place. Adding a task type should not require editing core, session or screen code.
- **Seeded RNG**: all randomness is mulberry32. Each round has a seed and each trial's seed is `hash(roundSeed, trialIndex)`, so any trial can be regenerated alone.
- **viewBox geometry**: everything is in a fixed 1000 × 600 SVG viewBox and pointer positions are converted with the inverse screen matrix, so an answer scores the same on a 390px phone and a 1440px monitor.
- Plain SVG and Pointer Events, localStorage persistence, no UI or chart library, no router.

Stack: Vite, React, TypeScript (`strict`, `noUncheckedIndexedAccess`), Vitest.

## Run it locally

```
npm install
npm run dev
npm run test
npm run build
```

These work the same in PowerShell, zsh and bash. `npm run preview` serves the production build at <http://localhost:4173/spatiasense/>. Pushing to `main` runs tests, builds, and deploys to GitHub Pages.

`CLAUDE.md` holds the full spec, decisions log and verified status.

## License

[MIT](LICENSE) © 2026 Ian
