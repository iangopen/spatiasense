import { describe, expect, it } from "vitest";
import { INSIGHT, findInsights, groupStats, roundSeries, type Finding } from "./insight";
import { findingText } from "./insightText";
import { simulatePlayer, type SimOptions } from "./sim";
import { parseRounds } from "./storage";
import type { TrialResult } from "./types";
import { findTask } from "../tasks/registry";

const registered = findTask("multiply");
if (!registered) throw new Error("multiply not registered");
const dims = registered.core.insightDimensions;
const nDim = dims.find((d) => d.key === "n");
if (!nDim) throw new Error("n dimension missing");

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const allN = (pct: number) => Object.fromEntries(range(2, 8).map((n) => [n, pct]));
const run = (opts: SimOptions) => findInsights(simulatePlayer(opts).trials, dims).findings;
const rate = (seeds: number, claim: (seed: number) => boolean) => {
  let hits = 0;
  for (let s = 0; s < seeds; s++) if (claim(s)) hits++;
  return hits / seeds;
};
const isRange = (f: Finding, kind: Finding["kind"], from: number, to: number) =>
  f.kind === kind && "values" in f && f.dimension?.key === "n" && JSON.stringify(f.values) === JSON.stringify(range(from, to));

/** Hand-built trial for exact-arithmetic tests. */
function mk(signed: number, n: number, i: number, hitLimit = false): TrialResult {
  return {
    taskId: "multiply",
    params: { n, layout: "anchored" },
    seed: i,
    trueValue: 100,
    response: 100 + signed,
    signedErrorPct: signed,
    absErrorPct: Math.abs(signed),
    score: 0,
    hitLimit,
    responseMs: 1000,
    timestamp: 1000 + i,
  };
}

// Noise SD of 10 percentage points is the "realistic player" default in these tests.
const NOISE = 10;
const V1_BIAS = { 5: -12, 6: -12, 7: -12, 8: -12 };

describe("V1: engine recovers the truth", () => {
  const recovers = (trials: number) => (seed: number) => {
    const f = run({ seed, noiseSd: NOISE, trials, biasByN: V1_BIAS });
    const bias = f.find((x) => isRange(x, "bias", 5, 8));
    const acc = f.find((x) => isRange(x, "accurate", 2, 4));
    return !!bias && bias.kind === "bias" && Math.abs(bias.meanPct + 12) <= 3 && !!acc;
  };

  it("finds the −12% undershoot at n = 5–8 from 200 trials (≥ 90% of seeds)", () => {
    const r = rate(100, (seed) => {
      const f = run({ seed, noiseSd: NOISE, trials: 200, biasByN: V1_BIAS });
      const bias = f.find((x) => isRange(x, "bias", 5, 8));
      return !!bias && bias.kind === "bias" && Math.abs(bias.meanPct + 12) <= 3;
    });
    expect(r).toBeGreaterThanOrEqual(0.9); // measured: 0.94
  });

  it("the full claim (bias 5–8 AND well calibrated 2–4) needs ~400 trials at SD 10 (≥ 90% of seeds)", () => {
    expect(rate(100, recovers(400))).toBeGreaterThanOrEqual(0.9); // measured: 0.95
  });

  it("never claims the opposite sign or a bias at n = 2–4", () => {
    for (let seed = 0; seed < 50; seed++) {
      for (const f of run({ seed, noiseSd: NOISE, trials: 200, biasByN: V1_BIAS })) {
        if (f.kind !== "bias" || f.dimension.key !== "n") continue;
        expect(f.meanPct).toBeLessThan(0);
        expect(f.values.every((v) => typeof v === "number" && v >= 4)).toBe(true);
      }
    }
  });
});

describe("V2: false-positive guard (full pipeline)", () => {
  it("unbiased player, 100 trials: a bias claim in < 10% of 200 seeds", () => {
    const r = rate(200, (seed) => run({ seed: 10_000 + seed, noiseSd: NOISE, trials: 100 }).some((f) => f.kind === "bias"));
    expect(r).toBeLessThan(0.1); // measured: 0.055 (family now includes slope tests)
  });
});

describe("V3: small samples", () => {
  it("under MIN_TRIALS_PER_GROUP → only needsData, even with a huge bias", () => {
    const f = run({ seed: 1, noiseSd: NOISE, trials: 7, n: 5, layout: "anchored", biasByN: { 5: -40 } });
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((x) => x.kind === "needsData")).toBe(true);
  });

  it("points at the smallest groups first, capped", () => {
    const trials = [...range(0, 9).map((i) => mk(0, 3, i)), ...range(10, 14).map((i) => mk(0, 4, i)), mk(0, 5, 20), mk(0, 5, 21)];
    const needs = findInsights(trials, [nDim]).findings.filter((x) => x.kind === "needsData");
    expect(needs.map((x) => x.kind === "needsData" && [x.value, x.needed])).toEqual([
      [5, INSIGHT.MIN_TRIALS_PER_GROUP - 2],
      [4, INSIGHT.MIN_TRIALS_PER_GROUP - 5],
    ]);
    expect(needs.length).toBeLessThanOrEqual(INSIGHT.MAX_NEEDS_DATA_FINDINGS);
  });
});

describe("V4: censored (hitLimit) trials", () => {
  // 20 trials at n = 5, mean about −10: a clear undershoot.
  const base = range(0, 19).map((i) => mk(-10 + ((i % 5) - 2), 5, i));

  it("are kept in means at their recorded value and counted as censored", () => {
    const withCensored = base.map((t, i) => (i < 3 ? { ...t, signedErrorPct: 30, absErrorPct: 30, hitLimit: true } : t));
    const [g] = groupStats(withCensored, nDim);
    expect(g?.count).toBe(20);
    expect(g?.censored).toBe(3);
    const expected = withCensored.reduce((s, t) => s + t.signedErrorPct, 0) / 20;
    expect(g?.meanSignedPct).toBeCloseTo(expected, 9);
  });

  it("withhold an undershoot claim when more than MAX_CENSORED_FRACTION are censored", () => {
    expect(findInsights(base, [nDim]).findings.some((f) => f.kind === "bias")).toBe(true);
    const censored = base.map((t, i) => (i < 3 ? { ...t, hitLimit: true } : t)); // 15% > 10%
    expect(findInsights(censored, [nDim]).findings.some((f) => f.kind === "bias")).toBe(false);
  });

  it("keep an overshoot claim (censoring only understates overshoot)", () => {
    const over = base.map((t, i) => ({ ...t, signedErrorPct: -t.signedErrorPct, hitLimit: i < 5 }));
    expect(findInsights(over, [nDim]).findings.some((f) => f.kind === "bias" && f.meanPct > 0)).toBe(true);
  });

  it("the sim produces hitLimit trials through the real multiply clamp", () => {
    const { trials } = simulatePlayer({ seed: 3, noiseSd: 15, trials: 200, biasByN: allN(25) });
    expect(trials.some((t) => t.hitLimit)).toBe(true);
    expect(trials.filter((t) => t.hitLimit).every((t) => t.signedErrorPct >= 25)).toBe(true);
  });
});

describe("V5: trends (regression slope over the most recent TREND_MAX_TRIALS)", () => {
  const trendIn = (f: Finding[], dir?: "improving" | "worsening") =>
    f.some((x) => x.kind === "trend" && (dir === undefined || x.direction === dir));

  it("gradual learning, −15% → −3% over 200 trials (SD 10) → 'improving' in ≥ 80% of 200 seeds", () => {
    const r = rate(200, (seed) =>
      trendIn(run({ seed: 50_000 + seed, noiseSd: NOISE, trials: 200, biasByN: allN(-15), improvementPerTrial: 12 / 199 }), "improving"),
    );
    expect(r).toBeGreaterThanOrEqual(0.8); // measured: 0.98 (the two-window test managed 0.04)
  });

  it("reports the fitted start and end of the trend near the truth", () => {
    const { trials } = simulatePlayer({ seed: 7, noiseSd: 5, trials: 200, biasByN: allN(-15), improvementPerTrial: 12 / 199 });
    const t = findInsights(trials, dims).findings.find((f) => f.kind === "trend" && f.dimension === null);
    expect(t?.kind).toBe("trend");
    if (t?.kind !== "trend") return;
    expect(Math.abs(t.startPct + 15)).toBeLessThan(2);
    expect(Math.abs(t.endPct + 3)).toBeLessThan(2);
    expect(t.trials).toBe(200);
  });

  it("worsening from −3% to −15% over 200 trials is reported as 'worsening'", () => {
    const r = rate(100, (seed) =>
      trendIn(run({ seed: 60_000 + seed, noiseSd: NOISE, trials: 200, biasByN: allN(-3), improvementPerTrial: -12 / 199 }), "worsening"),
    );
    expect(r).toBeGreaterThanOrEqual(0.8); // measured: 0.985
  });

  it("only the most recent TREND_MAX_TRIALS count: 300 trials still report a 200-trial window", () => {
    const { trials } = simulatePlayer({ seed: 8, noiseSd: 5, trials: 300, biasByN: allN(-15), improvementPerTrial: 12 / 299 });
    const t = findInsights(trials, dims).findings.find((f) => f.kind === "trend" && f.dimension === null);
    expect(t?.kind === "trend" && t.trials).toBe(INSIGHT.TREND_MAX_TRIALS);
  });

  it("is silent below TREND_MIN_TRIALS, however steep", () => {
    const { trials } = simulatePlayer({ seed: 9, noiseSd: 1, trials: INSIGHT.TREND_MIN_TRIALS - 1, biasByN: allN(-30), improvementPerTrial: 0.7 });
    expect(trendIn(findInsights(trials, dims).findings)).toBe(false);
  });

  it("flat player: improving or worsening claimed in < 10% of 200 seeds (unbiased and at −8%)", () => {
    for (const bias of [0, -8]) {
      const r = rate(200, (seed) => trendIn(run({ seed: 20_000 + seed, noiseSd: NOISE, trials: 200, biasByN: allN(bias) })));
      expect(r).toBeLessThan(0.1); // measured: 0 (0%), 0.01 (−8%)
    }
  });
});

describe("progress findings", () => {
  const DIRECTIONAL = /\b(over|under|short|long|lean)/i;
  const progressOf = (f: Finding[]) => f.filter((x): x is Extract<Finding, { kind: "progress" }> => x.kind === "progress");

  it("an unclaimed, testable range reports its range and trial count", () => {
    // 14 trials at n = 5 and 14 at n = 6, around −4%: classed "under" but far too noisy to claim.
    const trials = range(0, 27).map((i) => mk(-4 + ((i >> 1) % 2 ? 25 : -25), 5 + (i % 2), i));
    const f = findInsights(trials, [nDim]).findings;
    expect(f.some((x) => x.kind === "bias" || x.kind === "accurate")).toBe(false);
    const [p] = progressOf(f);
    expect(p && [p.values, p.count]).toEqual([[5, 6], 28]);
    expect(p && findingText(p)).toBe("No clear bias at n = 5–6 yet (28 trials).");
  });

  it("a claimed range gets no progress line; unclaimed neighbours still do", () => {
    const { trials } = simulatePlayer({ seed: 3, noiseSd: NOISE, trials: 300, biasByN: V1_BIAS });
    const f = findInsights(trials, dims).findings;
    const claimed = f.filter((x) => x.kind === "bias" || x.kind === "accurate");
    for (const p of progressOf(f)) {
      expect(
        claimed.some((c) => (c.kind === "bias" || c.kind === "accurate") && c.dimension.key === p.dimension.key && JSON.stringify(c.values) === JSON.stringify(p.values)),
      ).toBe(false);
    }
  });

  it("at most MAX_PROGRESS_FINDINGS, fewest trials first", () => {
    // Alternating strong over/under per n: every n is its own range, none claimable at 8–9 noisy trials.
    const trials = range(2, 8).flatMap((n) =>
      range(0, 8 + n - 2).map((i) => mk((n % 2 ? 1 : -1) * (6 + (i % 2 ? 30 : -30)), n, n * 100 + i)),
    );
    const p = progressOf(findInsights(trials, [nDim]).findings);
    expect(p.length).toBeLessThanOrEqual(INSIGHT.MAX_PROGRESS_FINDINGS);
    expect(p.map((x) => x.count)).toEqual([...p.map((x) => x.count)].sort((a, b) => a - b));
  });

  it("the sentence never contains a directional word, across many players", () => {
    let seen = 0;
    for (let seed = 0; seed < 60; seed++) {
      for (const bias of [-25, -8, 0, 8, 25]) {
        const trials = simulatePlayer({ seed: 70_000 + seed, noiseSd: 14, trials: 30 + (seed % 5) * 20, biasByN: allN(bias) }).trials;
        for (const p of progressOf(findInsights(trials, dims).findings)) {
          seen++;
          expect(findingText(p)).not.toMatch(DIRECTIONAL);
          expect(findingText(p)).toMatch(/^No clear bias at \S+ = \S+ yet \(\d+ trials?\)\.$/);
        }
      }
    }
    expect(seen).toBeGreaterThan(20);
  });
});

describe("V6: session-1 data", () => {
  it("a stored round without hitLimit loads and feeds the engine", () => {
    const trials = range(0, 11).map((i) => {
      const { hitLimit: _h, ...old } = mk(-6 + (i % 3), 4, i);
      return old;
    });
    const raw = JSON.stringify({
      version: 1,
      rounds: [{ id: "old", taskId: "multiply", roundSeed: 1, params: { n: "random", layout: "anchored" }, startedAt: 1, finishedAt: 2, trials }],
    });
    const { rounds, problems } = parseRounds(raw);
    expect(problems).toEqual([]);
    const all = rounds.flatMap((r) => r.trials);
    expect(() => findInsights(all, dims)).not.toThrow();
    expect(groupStats(all, nDim)[0]?.censored).toBe(0);
    expect(roundSeries(rounds)).toHaveLength(1);
  });

  it("unreadable params are skipped, never thrown", () => {
    const bad = [{ ...mk(5, 3, 0), params: null }, { ...mk(5, 3, 1), params: { n: "x" } }, mk(5, 3, 2)];
    expect(() => findInsights(bad, dims)).not.toThrow();
    expect(groupStats(bad, nDim).map((g) => g.count)).toEqual([1]);
  });
});

describe("Bonferroni family", () => {
  it("counts every claim tested: level ranges AND trends", () => {
    const { trials } = simulatePlayer({ seed: 5, noiseSd: NOISE, trials: 200, biasByN: V1_BIAS });
    const report = findInsights(trials, dims);
    expect(report.familySize).toBeGreaterThan(3);
    expect(report.claimAlpha).toBeCloseTo(INSIGHT.FAMILY_ALPHA / report.familySize, 12);
  });
});

describe("sim", () => {
  it("is deterministic per seed and differs across seeds", () => {
    const a = simulatePlayer({ seed: 9, noiseSd: NOISE });
    expect(simulatePlayer({ seed: 9, noiseSd: NOISE })).toEqual(a);
    expect(simulatePlayer({ seed: 10, noiseSd: NOISE }).trials).not.toEqual(a.trials);
  });

  it("builds rounds of 10 with increasing timestamps", () => {
    const { rounds, trials } = simulatePlayer({ seed: 1, noiseSd: NOISE, trials: 35 });
    expect(rounds.map((r) => r.trials.length)).toEqual([10, 10, 10, 5]);
    expect(trials.every((t, i) => i === 0 || t.timestamp > (trials[i - 1]?.timestamp ?? 0))).toBe(true);
  });
});

describe("roundSeries", () => {
  it("orders rounds oldest first with per-round means", () => {
    const { rounds } = simulatePlayer({ seed: 2, noiseSd: 0, trials: 30, biasByN: allN(-10) });
    const s = roundSeries([...rounds].reverse());
    expect(s.map((p) => p.index)).toEqual([0, 1, 2]);
    s.forEach((p) => expect(p.meanSignedPct).toBeCloseTo(-10, 6));
  });
});
