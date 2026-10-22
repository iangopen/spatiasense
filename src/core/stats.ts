// Small, dependency-free statistics used by the insight engine.

export function mean(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Sample standard deviation (n − 1). NaN when fewer than 2 values. */
export function sampleSd(values: readonly number[]): number {
  if (values.length < 2) return NaN;
  const m = mean(values);
  let ss = 0;
  for (const v of values) ss += (v - m) ** 2;
  return Math.sqrt(ss / (values.length - 1));
}

// Lanczos approximation (g = 7, n = 9) of ln Γ(x).
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

function lnGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const z = x - 1;
  let a = LANCZOS[0] ?? 0;
  const t = z + 7.5;
  for (let i = 1; i < LANCZOS.length; i++) a += (LANCZOS[i] ?? 0) / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the incomplete beta function (Numerical Recipes betacf). */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const MAX_ITER = 300;
  const EPS = 1e-14;
  const TINY = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnFront = lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const front = Math.exp(lnFront);
  if (x < (a + 1) / (a + b + 2)) return (front * betaContinuedFraction(a, b, x)) / a;
  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Student-t CDF with `df` degrees of freedom. */
export function tCdf(t: number, df: number): number {
  const tail = 0.5 * incompleteBeta(df / (df + t * t), df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}

/** Student-t quantile: the t with P(T ≤ t) = p. Bisection on the CDF; p in (0, 1). */
export function tQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1) || !(df > 0)) return NaN;
  if (p === 0.5) return 0;
  if (p < 0.5) return -tQuantile(1 - p, df);
  let lo = 0;
  let hi = 1;
  while (tCdf(hi, df) < p) hi *= 2;
  for (let i = 0; i < 200 && hi - lo > 1e-12 * hi; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Two-sided critical value for a confidence interval at `alpha` (e.g. 0.05 → 95%). */
export function tCritical(alpha: number, df: number): number {
  return tQuantile(1 - alpha / 2, df);
}

export interface LineFit {
  /** Fitted value at index 0. */
  intercept: number;
  /** Change per index step. */
  slope: number;
  /** Standard error of the slope; NaN when it can't be estimated (n < 3). */
  slopeSe: number;
  /** Residual degrees of freedom (n − 2). */
  df: number;
}

/** Least-squares line through `y` against its own index 0..n−1. Needs n ≥ 2. */
export function fitLine(y: readonly number[]): LineFit | null {
  const n = y.length;
  if (n < 2) return null;
  const xBar = (n - 1) / 2;
  const yBar = mean(y);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - xBar;
    sxx += dx * dx;
    sxy += dx * ((y[i] ?? 0) - yBar);
  }
  const slope = sxy / sxx;
  const intercept = yBar - slope * xBar;
  let rss = 0;
  for (let i = 0; i < n; i++) rss += ((y[i] ?? 0) - (intercept + slope * i)) ** 2;
  const df = n - 2;
  return { intercept, slope, slopeSe: df > 0 ? Math.sqrt(rss / df / sxx) : NaN, df };
}
