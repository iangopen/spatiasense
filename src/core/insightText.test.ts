import { describe, expect, it } from "vitest";
import type { DimensionRef } from "./insight";
import { findingText, formatValues, formatWholePct } from "./insightText";

const n: DimensionRef = { key: "n", label: "n", kind: "ordinal" };
const layout: DimensionRef = { key: "layout", label: "layout", kind: "category" };
const base = { ci95: null, count: 40, censored: 0 };

describe("insightText", () => {
  it("formats values and percents", () => {
    expect(formatValues([5, 6, 7, 8])).toBe("5–8");
    expect(formatValues([7])).toBe("7");
    expect(formatValues(["detached"])).toBe("detached");
    expect(formatWholePct(-11.6)).toBe("−12%");
    expect(formatWholePct(4.4)).toBe("+4%");
    expect(formatWholePct(0.2)).toBe("0%");
  });

  it("bias", () => {
    expect(findingText({ kind: "bias", dimension: n, values: [5, 6, 7, 8], meanPct: -12.2, ...base })).toBe(
      "You undershoot by about 12% when n is 5–8.",
    );
    expect(findingText({ kind: "bias", dimension: layout, values: ["detached"], meanPct: 7.5, ...base })).toBe(
      "You overshoot by about 8% when layout is detached.",
    );
  });

  it("accurate", () => {
    expect(findingText({ kind: "accurate", dimension: n, values: [2, 3, 4], meanPct: 0.4, ...base })).toBe(
      "You're well calibrated for n = 2–4.",
    );
  });

  it("trends, improving and (neutrally) worsening", () => {
    expect(
      findingText({ kind: "trend", direction: "worsening", dimension: n, values: [6, 7, 8], startPct: -5, endPct: -11, trials: 40 }),
    ).toBe("Your bias at n = 6–8 has grown from about −5% to about −11% over your last 40 trials.");
    expect(
      findingText({ kind: "trend", direction: "improving", dimension: null, values: [], startPct: -14, endPct: -4, trials: 40 }),
    ).toBe("Your overall bias has shrunk from about −14% to about −4% over your last 40 trials.");
  });

  it("progress states the sample size and nothing else", () => {
    expect(findingText({ kind: "progress", dimension: n, values: [5, 6, 7, 8], count: 14 })).toBe(
      "No clear bias at n = 5–8 yet (14 trials).",
    );
    expect(findingText({ kind: "progress", dimension: layout, values: ["detached"], count: 1 })).toBe(
      "No clear bias at layout = detached yet (1 trial).",
    );
  });

  it("needsData", () => {
    expect(findingText({ kind: "needsData", dimension: n, value: 7, count: 2, needed: 6 })).toBe(
      "Play about 6 more trials at n = 7 to see your bias there.",
    );
    expect(findingText({ kind: "needsData", dimension: n, value: 3, count: 7, needed: 1 })).toBe(
      "Play about 1 more trial at n = 3 to see your bias there.",
    );
  });
});
