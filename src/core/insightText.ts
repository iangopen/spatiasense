// Renders insight findings as plain English. Pure; knows nothing about tasks —
// wording comes from the dimension's own label and values.
import type { DimValue, Finding } from "./insight";

/** "−12%", "+8%", "0%" — whole percent, true minus sign. */
export function formatWholePct(v: number): string {
  const r = Math.round(v);
  if (r === 0) return "0%";
  return `${r > 0 ? "+" : "−"}${Math.abs(r)}%`;
}

/** [5, 6, 7, 8] → "5–8"; [7] → "7"; ["detached"] → "detached". */
export function formatValues(values: readonly DimValue[]): string {
  const first = values[0];
  const last = values[values.length - 1];
  if (first === undefined || last === undefined) return "";
  return values.length === 1 ? String(first) : `${String(first)}–${String(last)}`;
}

function plural(count: number, word: string): string {
  return `${count} ${count === 1 ? word : `${word}s`}`;
}

export function findingText(f: Finding): string {
  switch (f.kind) {
    case "bias": {
      const verb = f.meanPct < 0 ? "undershoot" : "overshoot";
      return `You ${verb} by about ${Math.round(Math.abs(f.meanPct))}% when ${f.dimension.label} is ${formatValues(f.values)}.`;
    }
    case "accurate":
      return `You're well calibrated for ${f.dimension.label} = ${formatValues(f.values)}.`;
    case "trend": {
      const subject = f.dimension ? `Your bias at ${f.dimension.label} = ${formatValues(f.values)}` : "Your overall bias";
      const verb = f.direction === "improving" ? "shrunk" : "grown";
      return `${subject} has ${verb} from about ${formatWholePct(f.startPct)} to about ${formatWholePct(f.endPct)} over your last ${f.trials} trials.`;
    }
    case "progress":
      return `No clear bias at ${f.dimension.label} = ${formatValues(f.values)} yet (${plural(f.count, "trial")}).`;
    case "needsData":
      return `Play about ${plural(f.needed, "more trial")} at ${f.dimension.label} = ${String(f.value)} to see your bias there.`;
  }
}
