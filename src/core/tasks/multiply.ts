import { MARGIN, VIEW_H, VIEW_W, clamp } from "../geometry";
import { randInt, randRange, type Rng } from "../rng";
import { scoreFromErrorPct, signedErrorPct } from "../scoring";
import type { TaskType } from "../types";

export const N_MIN = 2;
export const N_MAX = 8;
export const MIN_REF_LENGTH = 30;
/** Bar thickness in viewBox units; geometry checks include it. */
export const BAR_H = 16;
/** Right-most allowed x for anything on the track, including the answer marker. */
export const TRACK_MAX_X = VIEW_W - MARGIN;
/** A confirmed marker within this distance of TRACK_MAX_X counts as hitting the limit. */
export const HIT_LIMIT_TOLERANCE = 0.5;

export type Layout = "anchored" | "detached";

export interface MultiplyParams {
  n: number | "random";
  layout: Layout;
}

export interface MultiplyTrial {
  n: number;
  layout: Layout;
  refLength: number;
  /** Track origin x: where copy 1 starts and answers are measured from. */
  origin: number;
  trackY: number;
  /** Reference bar position. Equals (origin, trackY) when anchored. */
  refX: number;
  refY: number;
}

/** Response: the marker's x in viewBox units. */
export type MultiplyResponse = number;

export function resolveN(n: MultiplyParams["n"], rng: Rng): number {
  if (n === "random") return randInt(rng, N_MIN, N_MAX);
  return clamp(Math.round(n), N_MIN, N_MAX);
}

export function clampMarker(trial: MultiplyTrial, x: number): number {
  return clamp(x, trial.origin, TRACK_MAX_X);
}

export function trueEndX(trial: MultiplyTrial): number {
  return trial.origin + trial.n * trial.refLength;
}

/** The track sits at the vertical center in both layouts: only x placement varies. */
export const TRACK_Y = VIEW_H / 2;
/** A detached reference bar is at least this far above or below the track. */
export const MIN_DETACHED_DY = 120;
// Reference-bar centers stay clear of the margin by half a bar plus a little air.
const REF_Y_ABOVE: readonly [number, number] = [MARGIN + BAR_H, TRACK_Y - MIN_DETACHED_DY];
const REF_Y_BELOW: readonly [number, number] = [TRACK_Y + MIN_DETACHED_DY, VIEW_H - MARGIN - BAR_H];
/** Fraction of the true length always left free to the right of the true endpoint. */
export const OVERSHOOT_ROOM = 0.3;
/** Minimum horizontal offset between a detached reference and the track origin. */
const MIN_DETACHED_DX = 60;

function generate(params: MultiplyParams, rng: Rng): MultiplyTrial {
  const n = resolveN(params.n, rng);
  const layout = params.layout;
  const span = TRACK_MAX_X - MARGIN;

  // Total length first, then the endpoint. The endpoint always leaves room to
  // overshoot by OVERSHOOT_ROOM, so the marker clamp never censors overshoots
  // (which would bias stored errors toward undershoot), and the right limit
  // moves with the length, so the screen edge is not a landmark.
  const total = randRange(rng, n * MIN_REF_LENGTH, span / (1 + OVERSHOOT_ROOM));
  const end = randRange(rng, MARGIN + total, TRACK_MAX_X - OVERSHOOT_ROOM * total);
  const refLength = total / n;
  const origin = end - total;

  const trackY = TRACK_Y;
  if (layout === "anchored") return { n, layout, refLength, origin, trackY, refX: origin, refY: trackY };

  const refBand = rng() < 0.5 ? REF_Y_ABOVE : REF_Y_BELOW;
  const refY = randRange(rng, refBand[0], refBand[1]);

  // Reference must fit the viewBox with margin and not line up with the origin.
  const refMaxX = TRACK_MAX_X - refLength;
  let refX = randRange(rng, MARGIN, refMaxX);
  if (Math.abs(refX - origin) < MIN_DETACHED_DX) {
    // Move it away deterministically, staying inside the allowed range.
    const right = origin + MIN_DETACHED_DX;
    const left = origin - MIN_DETACHED_DX;
    if (right <= refMaxX) refX = randRange(rng, right, refMaxX);
    else if (left >= MARGIN) refX = randRange(rng, MARGIN, left);
  }
  return { n, layout, refLength, origin, trackY, refX, refY };
}

function score(trial: MultiplyTrial, response: MultiplyResponse) {
  const trueLength = trial.n * trial.refLength;
  const markerX = clampMarker(trial, response);
  const answerLength = markerX - trial.origin;
  const signed = signedErrorPct(answerLength, trueLength);
  return {
    params: { n: trial.n, layout: trial.layout },
    trueValue: trueLength,
    response: answerLength,
    signedErrorPct: signed,
    absErrorPct: Math.abs(signed),
    score: scoreFromErrorPct(signed),
    hitLimit: markerX >= TRACK_MAX_X - HIT_LIMIT_TOLERANCE,
  };
}

export const multiply: TaskType<MultiplyParams, MultiplyTrial, MultiplyResponse> = {
  id: "multiply",
  label: "Extrapolate: N bars end to end",
  defaultParams: { n: 6, layout: "anchored" },
  generate,
  score,
  insightDimensions: [
    { key: "n", label: "n", kind: "ordinal", extract: (p) => p.n },
    { key: "layout", label: "layout", kind: "category", extract: (p) => p.layout },
  ],
};
