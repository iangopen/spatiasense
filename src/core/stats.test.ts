import { describe, expect, it } from "vitest";
import { fitLine, mean, sampleSd, tCdf, tCritical, tQuantile } from "./stats";

describe("stats", () => {
  it("mean and sample sd", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(sampleSd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 5);
    expect(sampleSd([1])).toBeNaN();
  });

  it("t quantiles match published tables", () => {
    expect(tQuantile(0.975, 1)).toBeCloseTo(12.7062, 3);
    expect(tQuantile(0.975, 7)).toBeCloseTo(2.36462, 4);
    expect(tQuantile(0.975, 30)).toBeCloseTo(2.04227, 4);
    expect(tQuantile(0.995, 10)).toBeCloseTo(3.16927, 4);
    expect(tQuantile(0.975, 1e6)).toBeCloseTo(1.95996, 4);
    expect(tQuantile(0.025, 7)).toBeCloseTo(-2.36462, 4);
    expect(tCritical(0.05, 7)).toBeCloseTo(2.36462, 4);
  });

  it("t cdf is symmetric and monotone", () => {
    expect(tCdf(0, 5)).toBeCloseTo(0.5, 12);
    expect(tCdf(-1.5, 5) + tCdf(1.5, 5)).toBeCloseTo(1, 12);
    expect(tCdf(2, 5)).toBeGreaterThan(tCdf(1, 5));
  });

  it("fitLine recovers an exact line and a textbook slope SE", () => {
    const exact = fitLine([1, 3, 5, 7, 9]);
    expect(exact?.slope).toBeCloseTo(2, 12);
    expect(exact?.intercept).toBeCloseTo(1, 12);
    expect(exact?.slopeSe).toBeCloseTo(0, 9);
    // y = 2, 1, 4, 3 against 0..3: slope 0.6, RSS 3.2, Sxx 5 → SE = sqrt(3.2/2/5)
    const noisy = fitLine([2, 1, 4, 3]);
    expect(noisy?.slope).toBeCloseTo(0.6, 12);
    expect(noisy?.slopeSe).toBeCloseTo(Math.sqrt(3.2 / 2 / 5), 12);
    expect(noisy?.df).toBe(2);
    expect(fitLine([1])).toBeNull();
    expect(fitLine([1, 2])?.slopeSe).toBeNaN();
  });
});
