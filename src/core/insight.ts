// Insight engine: turns stored trials into claims about the player's bias.
// Pure. Knows nothing about any task: it only groups by the dimensions a task
// declares. When in doubt it stays SILENT — a false claim costs more trust
// than no claim.
import { fitLine, mean, sampleSd, tCritical } from "./stats";
import type { InsightDimension, RoundRecord, TrialResult } from "./types";

/** Every threshold the engine uses. Listed in CLAUDE.md; no other magic numbers. */
export const INSIGHT = {
  /** A group needs this many trials before any claim (or chart dot filled). */
  MIN_TRIALS_PER_GROUP: 8,
  /** Smallest |mean signed error| (%) worth calling a bias. */
  MIN_BIAS_PCT: 3,
  /** "Well calibrated" needs the whole claim interval inside ±this (%). */
  ACCURATE_BAND_PCT: 5,
  /**
   * A trend is the least-squares slope of signed error over (at most) this many of
   * the most recent trials in scope. 200 = 20 rounds: gradual learning (−15% → −3%
   * over 200 trials, slope 0.06 pp/trial) is detectable only with a long baseline,
   * while a longer window would credit "improving" for progress made long ago.
   */
  TREND_MAX_TRIALS: 200,
  /** A scope needs this many trials before a trend is tested at all. */
  TREND_MIN_TRIALS: 40,
  /** Family-wise error rate, Bonferroni-split across EVERY claim tested in a pass. */
  FAMILY_ALPHA: 0.05,
  /** Confidence level of intervals shown to the player (Student-t). */
  CI_LEVEL: 0.95,
  /** Above this fraction of hitLimit trials, undershoot/accurate claims are withheld. */
  MAX_CENSORED_FRACTION: 0.1,
  /** At most this many "play more" prompts at once. */
  MAX_NEEDS_DATA_FINDINGS: 2,
  /** At most this many "no clear bias yet" progress lines at once (fewest trials first). */
  MAX_PROGRESS_FINDINGS: 3,
  /** Rounds in the trend chart's rolling average. */
  ROLLING_ROUNDS: 5,
} as const;

export type DimValue = number | string;

export interface DimensionRef {
  key: string;
  label: string;
  kind: "ordinal" | "category";
}

export interface Interval {
  low: number;
  high: number;
}

export interface GroupStats {
  value: DimValue;
  /** Value of the split dimension, when grouping by two dimensions. */
  series?: DimValue;
  /** All trials in the group, censored ones included (at their recorded value). */
  count: number;
  /** Trials with hitLimit: their real error was larger than recorded. */
  censored: number;
  meanSignedPct: number;
  meanAbsPct: number;
  /** Sample SD of signed error; NaN when count < 2. */
  sd: number;
  /** Student-t interval at CI_LEVEL; null when count < 2. */
  ci95: Interval | null;
}

export type Finding =
  | {
      kind: "bias" | "accurate";
      dimension: DimensionRef;
      /** One value (category) or a run of adjacent values (ordinal). */
      values: DimValue[];
      meanPct: number;
      ci95: Interval | null;
      count: number;
      censored: number;
    }
  | {
      kind: "trend";
      direction: "improving" | "worsening";
      /** null = all of this task's trials. */
      dimension: DimensionRef | null;
      values: DimValue[];
      /** Fitted trend line at the first and last trial of the trend span. */
      startPct: number;
      endPct: number;
      /** Trials the trend line was fitted to. */
      trials: number;
    }
  | {
      /**
       * A range with enough data to be tested but no claim yet. States the
       * sample size ONLY — never a direction: a lean from a few trials is the
       * same overclaim the thresholds exist to prevent.
       */
      kind: "progress";
      dimension: DimensionRef;
      values: DimValue[];
      count: number;
    }
  | {
      kind: "needsData";
      dimension: DimensionRef;
      value: DimValue;
      count: number;
      needed: number;
    };

export interface InsightReport {
  findings: Finding[];
  /** Number of claims tested in this pass (the Bonferroni family). */
  familySize: number;
  /** Per-claim alpha actually used. */
  claimAlpha: number;
}

export interface RoundPoint {
  index: number;
  finishedAt: number;
  meanSignedPct: number;
  count: number;
  censored: number;
}

// ---------------------------------------------------------------------------

function refOf(dim: InsightDimension<unknown>): DimensionRef {
  return { key: dim.key, label: dim.label, kind: dim.kind };
}

/** Reads a dimension value defensively: unreadable stored params → null. */
export function readDimension(dim: InsightDimension<unknown>, params: unknown): DimValue | null {
  let v: number | string;
  try {
    v = dim.extract(params);
  } catch {
    return null;
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return dim.kind === "category" ? v : null;
  return null;
}

function compareValues(a: DimValue, b: DimValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

interface Bucket {
  value: DimValue;
  series?: DimValue;
  trials: TrialResult[];
}

function bucket(
  trials: readonly TrialResult[],
  dim: InsightDimension<unknown>,
  splitBy?: InsightDimension<unknown>,
): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const t of trials) {
    const value = readDimension(dim, t.params);
    if (value === null) continue;
    let series: DimValue | undefined;
    if (splitBy) {
      const s = readDimension(splitBy, t.params);
      if (s === null) continue;
      series = s;
    }
    const id = `${typeof value}:${String(value)}|${series === undefined ? "" : `${typeof series}:${String(series)}`}`;
    let b = map.get(id);
    if (!b) {
      b = series === undefined ? { value, trials: [] } : { value, series, trials: [] };
      map.set(id, b);
    }
    b.trials.push(t);
  }
  return [...map.values()].sort(
    (a, b) =>
      compareValues(a.value, b.value) ||
      (a.series === undefined || b.series === undefined ? 0 : compareValues(a.series, b.series)),
  );
}

function interval(values: readonly number[], alpha: number): Interval | null {
  if (values.length < 2) return null;
  const m = mean(values);
  const half = (tCritical(alpha, values.length - 1) * sampleSd(values)) / Math.sqrt(values.length);
  return { low: m - half, high: m + half };
}

function summarizeTrials(trials: readonly TrialResult[]): Omit<GroupStats, "value" | "series"> {
  const signed = trials.map((t) => t.signedErrorPct);
  return {
    count: trials.length,
    censored: trials.filter((t) => t.hitLimit).length,
    meanSignedPct: mean(signed),
    meanAbsPct: mean(trials.map((t) => t.absErrorPct)),
    sd: sampleSd(signed),
    ci95: interval(signed, 1 - INSIGHT.CI_LEVEL),
  };
}

/** Per-group statistics for charts and tables. */
export function groupStats(
  trials: readonly TrialResult[],
  dim: InsightDimension<unknown>,
  splitBy?: InsightDimension<unknown>,
): GroupStats[] {
  return bucket(trials, dim, splitBy).map((b) => ({
    value: b.value,
    ...(b.series === undefined ? {} : { series: b.series }),
    ...summarizeTrials(b.trials),
  }));
}

// ---------------------------------------------------------------------------

type PointClass = "over" | "under" | "near";

function classify(meanPct: number): PointClass {
  if (meanPct >= INSIGHT.MIN_BIAS_PCT) return "over";
  if (meanPct <= -INSIGHT.MIN_BIAS_PCT) return "under";
  return "near";
}

interface LevelCandidate {
  kind: "bias" | "accurate";
  dimension: DimensionRef;
  values: DimValue[];
  trials: TrialResult[];
}

interface TrendCandidate {
  dimension: DimensionRef | null;
  values: DimValue[];
  trials: TrialResult[];
}

/**
 * Ordinal: sufficient groups are classed by point estimate (over / under /
 * near); adjacent groups of the same class merge into one range; a group with
 * too little data breaks a range. Category: each sufficient group stands alone
 * (and only when the dimension has 2+ observed values — otherwise the "group"
 * is just all trials again).
 */
function levelCandidates(trials: readonly TrialResult[], dim: InsightDimension<unknown>): LevelCandidate[] {
  const buckets = bucket(trials, dim);
  const dimension = refOf(dim);
  const out: LevelCandidate[] = [];
  const push = (cls: PointClass, bs: Bucket[]) =>
    out.push({
      kind: cls === "near" ? "accurate" : "bias",
      dimension,
      values: bs.map((b) => b.value),
      trials: bs.flatMap((b) => b.trials),
    });

  if (dim.kind === "category") {
    if (buckets.length < 2) return out;
    for (const b of buckets) {
      if (b.trials.length >= INSIGHT.MIN_TRIALS_PER_GROUP) push(classify(mean(b.trials.map((t) => t.signedErrorPct))), [b]);
    }
    return out;
  }

  let run: Bucket[] = [];
  let runClass: PointClass | null = null;
  const close = () => {
    if (runClass !== null && run.length > 0) push(runClass, run);
    run = [];
    runClass = null;
  };
  for (const b of buckets) {
    if (b.trials.length < INSIGHT.MIN_TRIALS_PER_GROUP) {
      close();
      continue;
    }
    const cls = classify(mean(b.trials.map((t) => t.signedErrorPct)));
    if (cls !== runClass) close();
    runClass = cls;
    run.push(b);
  }
  close();
  return out;
}

function byTime(trials: readonly TrialResult[]): TrialResult[] {
  return [...trials].sort((a, b) => a.timestamp - b.timestamp);
}

function censoredFraction(trials: readonly TrialResult[]): number {
  return trials.length === 0 ? 0 : trials.filter((t) => t.hitLimit).length / trials.length;
}

function evaluateLevel(c: LevelCandidate, alpha: number): Finding | null {
  const signed = c.trials.map((t) => t.signedErrorPct);
  const m = mean(signed);
  const claim = interval(signed, alpha);
  if (!claim || c.trials.length < INSIGHT.MIN_TRIALS_PER_GROUP) return null;
  const censoredTooMuch = censoredFraction(c.trials) > INSIGHT.MAX_CENSORED_FRACTION;

  if (c.kind === "bias") {
    const excludesZero = claim.low > 0 || claim.high < 0;
    if (!excludesZero || Math.abs(m) < INSIGHT.MIN_BIAS_PCT) return null;
    // Censored values are lower bounds: an undershoot could be an artifact.
    if (m < 0 && censoredTooMuch) return null;
  } else {
    const inside = claim.low >= -INSIGHT.ACCURATE_BAND_PCT && claim.high <= INSIGHT.ACCURATE_BAND_PCT;
    if (!inside || censoredTooMuch) return null;
  }
  const s = summarizeTrials(c.trials);
  return {
    kind: c.kind,
    dimension: c.dimension,
    values: c.values,
    meanPct: s.meanSignedPct,
    ci95: s.ci95,
    count: s.count,
    censored: s.censored,
  };
}

/**
 * Least-squares slope of signed error against trial order over the last
 * TREND_MAX_TRIALS trials, t-tested at the claim alpha. Claimed only when the
 * fitted line also moved |bias| by at least MIN_BIAS_PCT end to end.
 */
function evaluateTrend(c: TrendCandidate, alpha: number): Finding | null {
  const sorted = byTime(c.trials);
  if (sorted.length < INSIGHT.TREND_MIN_TRIALS) return null;
  const recent = sorted.slice(-INSIGHT.TREND_MAX_TRIALS);
  const fit = fitLine(recent.map((t) => t.signedErrorPct));
  if (!fit || !(fit.slopeSe > 0)) return null;
  if (Math.abs(fit.slope) <= tCritical(alpha, fit.df) * fit.slopeSe) return null;
  const startPct = fit.intercept;
  const endPct = fit.intercept + fit.slope * (recent.length - 1);
  const magnitudeChange = Math.abs(endPct) - Math.abs(startPct);
  if (Math.abs(magnitudeChange) < INSIGHT.MIN_BIAS_PCT) return null;
  return {
    kind: "trend",
    direction: magnitudeChange < 0 ? "improving" : "worsening",
    dimension: c.dimension,
    values: c.values,
    startPct,
    endPct,
    trials: recent.length,
  };
}

/**
 * The full pipeline. `trials` should be one task's trials; `dimensions` that
 * task's declared insight dimensions.
 */
export function findInsights(
  trials: readonly TrialResult[],
  dimensions: readonly InsightDimension<unknown>[],
): InsightReport {
  const levels: LevelCandidate[] = [];
  const trends: TrendCandidate[] = [];
  const thin: Array<{ dimension: DimensionRef; value: DimValue; count: number }> = [];

  if (trials.length >= INSIGHT.TREND_MIN_TRIALS) trends.push({ dimension: null, values: [], trials: [...trials] });

  for (const dim of dimensions) {
    const buckets = bucket(trials, dim);
    // A category with one observed value is just "all trials" — nothing to fill in.
    if (dim.kind === "ordinal" || buckets.length >= 2) {
      for (const b of buckets) {
        if (b.trials.length < INSIGHT.MIN_TRIALS_PER_GROUP) thin.push({ dimension: refOf(dim), value: b.value, count: b.trials.length });
      }
    }
    for (const c of levelCandidates(trials, dim)) {
      levels.push(c);
      if (c.trials.length >= INSIGHT.TREND_MIN_TRIALS) trends.push({ dimension: c.dimension, values: c.values, trials: c.trials });
    }
  }

  // Bonferroni over EVERY claim tested in this pass.
  const familySize = levels.length + trends.length;
  const claimAlpha = INSIGHT.FAMILY_ALPHA / Math.max(1, familySize);

  const evaluated = levels.map((c) => ({ c, f: evaluateLevel(c, claimAlpha) }));
  const findings: Finding[] = [];
  for (const { f } of evaluated) if (f?.kind === "bias") findings.push(f);
  for (const c of trends) {
    const f = evaluateTrend(c, claimAlpha);
    if (f) findings.push(f);
  }
  for (const { f } of evaluated) if (f?.kind === "accurate") findings.push(f);
  evaluated
    .filter(({ f }) => f === null)
    .map(({ c }) => ({ dimension: c.dimension, values: c.values, count: c.trials.length }))
    .sort((a, b) => a.count - b.count)
    .slice(0, INSIGHT.MAX_PROGRESS_FINDINGS)
    .forEach((g) => findings.push({ kind: "progress", ...g }));
  thin
    .sort((a, b) => a.count - b.count || compareValues(a.value, b.value))
    .slice(0, INSIGHT.MAX_NEEDS_DATA_FINDINGS)
    .forEach((g) =>
      findings.push({
        kind: "needsData",
        dimension: g.dimension,
        value: g.value,
        count: g.count,
        needed: INSIGHT.MIN_TRIALS_PER_GROUP - g.count,
      }),
    );

  return { findings, familySize, claimAlpha };
}

/** Mean signed error per round, oldest first (censored trials at recorded value). */
export function roundSeries(rounds: readonly RoundRecord[]): RoundPoint[] {
  return [...rounds]
    .filter((r) => r.trials.length > 0)
    .sort((a, b) => a.finishedAt - b.finishedAt)
    .map((r, index) => ({
      index,
      finishedAt: r.finishedAt,
      meanSignedPct: mean(r.trials.map((t) => t.signedErrorPct)),
      count: r.trials.length,
      censored: r.trials.filter((t) => t.hitLimit).length,
    }));
}
