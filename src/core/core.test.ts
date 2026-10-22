import { describe, expect, it } from "vitest";
import { clientToViewBox } from "./geometry";
import { hashSeeds, mulberry32, randInt, trialSeed } from "./rng";
import { formatSignedError, formatTrialError, scoreFromErrorPct, signedErrorPct, summarize } from "./scoring";
import { simulatePlayer } from "./sim";
import { ROUNDS_KEY, appendRound, parseRounds, serializeRounds } from "./storage";
import type { RoundRecord, TrialResult } from "./types";

describe("rng", () => {
  it("mulberry32 is deterministic and in [0, 1)", () => {
    const a = mulberry32(1);
    const b = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("trial seeds differ by index and by round", () => {
    const seeds = new Set<number>();
    for (let r = 0; r < 20; r++) for (let i = 0; i < 20; i++) seeds.add(trialSeed(r, i));
    expect(seeds.size).toBe(400);
    expect(hashSeeds(5, 6)).toBe(hashSeeds(5, 6));
  });

  it("randInt covers the inclusive range", () => {
    const rng = mulberry32(9);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(randInt(rng, 2, 4));
    expect([...seen].sort()).toEqual([2, 3, 4]);
  });
});

describe("geometry", () => {
  // Inverse CTMs for a 1000-wide viewBox drawn at 390px and 1440px wide.
  const phone = { a: 1000 / 390, b: 0, c: 0, d: 1000 / 390, e: -10 * (1000 / 390), f: 0 };
  const desktop = { a: 1000 / 1440, b: 0, c: 0, d: 1000 / 1440, e: -200 * (1000 / 1440), f: 0 };

  it("maps the same relative position to the same viewBox x at any size", () => {
    const onPhone = clientToViewBox(phone, 10 + 390 * 0.37, 50);
    const onDesktop = clientToViewBox(desktop, 200 + 1440 * 0.37, 50);
    expect(onPhone.x).toBeCloseTo(370, 9);
    expect(onDesktop.x).toBeCloseTo(370, 9);
  });

  it("applies the full affine transform", () => {
    expect(clientToViewBox({ a: 2, b: 1, c: 3, d: 4, e: 5, f: 6 }, 1, 1)).toEqual({ x: 10, y: 11 });
  });
});

describe("scoring", () => {
  it("signed error and score", () => {
    expect(signedErrorPct(110, 100)).toBeCloseTo(10, 9);
    expect(signedErrorPct(90, 100)).toBeCloseTo(-10, 9);
    expect(scoreFromErrorPct(10)).toBe(80);
    expect(scoreFromErrorPct(-60)).toBe(0);
  });

  it("formats signed error", () => {
    expect(formatSignedError(8.26)).toBe("+8.3% — overshot");
    expect(formatSignedError(-4)).toBe("−4.0% — undershot");
    expect(formatSignedError(0.01)).toBe("0.0% — exact");
    expect(formatTrialError({ signedErrorPct: 31.24, hitLimit: true })).toBe("≥ +31.2% — hit the edge");
    expect(formatTrialError({ signedErrorPct: -4, hitLimit: false })).toBe("−4.0% — undershot");
  });

  it("summarizes a round", () => {
    const t = (signed: number): TrialResult => ({
      taskId: "multiply",
      params: {},
      seed: 0,
      trueValue: 100,
      response: 100 + signed,
      signedErrorPct: signed,
      absErrorPct: Math.abs(signed),
      score: scoreFromErrorPct(signed),
      hitLimit: false,
      responseMs: 0,
      timestamp: 0,
    });
    const s = summarize([t(10), t(-2), t(-20)]);
    expect(s.meanSignedErrorPct).toBeCloseTo(-4, 9);
    expect(s.meanAbsErrorPct).toBeCloseTo(32 / 3, 9);
    expect(s.bestIndex).toBe(1);
    expect(summarize([]).bestIndex).toBe(-1);
  });
});

describe("storage", () => {
  const trial: TrialResult = {
    taskId: "multiply",
    params: { n: 4, layout: "anchored" },
    seed: 1,
    trueValue: 200,
    response: 210,
    signedErrorPct: 5,
    absErrorPct: 5,
    score: 90,
    hitLimit: false,
    responseMs: 1200,
    timestamp: 5000,
  };
  const round: RoundRecord = {
    id: "r1",
    taskId: "multiply",
    roundSeed: 42,
    params: { n: "random", layout: "anchored" },
    startedAt: 1000,
    finishedAt: 9000,
    trials: [trial],
  };

  it("uses a versioned key", () => {
    expect(ROUNDS_KEY).toBe("spatiasense:v1:rounds");
  });

  it("exported JSON of many real-shaped rounds (incl. hitLimit) parses back unchanged", () => {
    const { rounds } = simulatePlayer({ seed: 4, noiseSd: 15, trials: 120, biasByN: { 5: 25, 6: 25, 7: 25, 8: 25 } });
    expect(rounds.some((r) => r.trials.some((t) => t.hitLimit))).toBe(true);
    expect(parseRounds(serializeRounds(rounds))).toEqual({ rounds, problems: [] });
  });

  it("round-trips", () => {
    expect(parseRounds(serializeRounds([round]))).toEqual({ rounds: [round], problems: [] });
  });

  it("treats missing data as empty without problems", () => {
    expect(parseRounds(null)).toEqual({ rounds: [], problems: [] });
  });

  it("never throws on corrupt or unknown data, and reports it", () => {
    for (const raw of ["{nope", "42", "null", '{"version":99,"rounds":[]}', '{"rounds":"x"}']) {
      const out = parseRounds(raw);
      expect(out.rounds).toEqual([]);
      expect(out.problems.length).toBe(1);
    }
  });

  it("drops only the bad rounds", () => {
    const raw = JSON.stringify({ version: 1, rounds: [round, { id: 5 }, { ...round, id: "r2", trials: [{ bad: true }] }] });
    const out = parseRounds(raw);
    expect(out.rounds).toEqual([round]);
    expect(out.problems).toHaveLength(1);
  });

  it("session-1 rounds (no hitLimit field) load as hitLimit: false", () => {
    const { hitLimit: _omit, ...oldTrial } = trial;
    const raw = JSON.stringify({ version: 1, rounds: [{ ...round, trials: [oldTrial] }] });
    const out = parseRounds(raw);
    expect(out.problems).toEqual([]);
    expect(out.rounds[0]?.trials[0]?.hitLimit).toBe(false);
  });

  it("drops a round whose hitLimit is not a boolean", () => {
    const raw = JSON.stringify({ version: 1, rounds: [{ ...round, trials: [{ ...trial, hitLimit: "yes" }] }] });
    expect(parseRounds(raw).rounds).toEqual([]);
  });

  it("appendRound is idempotent by id", () => {
    expect(appendRound(appendRound([], round), round)).toEqual([round]);
  });
});

describe("core purity", () => {
  const sources = import.meta.glob<string>(["./**/*.ts", "!./**/*.test.ts"], {
    query: "?raw",
    import: "default",
    eager: true,
  });
  const files = Object.entries(sources);

  it("finds core files", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  const BANNED = [/Math\.random|Date\.now|new Date\(/, /from ["']react|from ["']react-dom/, /\b(window|document|localStorage)\./];
  const TASK_IMPORT = /from\s+["'][^"']*tasks\//;

  it("guard patterns actually fire (self-test)", () => {
    const samples = ["Math.random()", 'import x from "react";', "window.addEventListener", "localStorage.getItem"];
    for (const sample of samples) expect(BANNED.some((re) => re.test(sample))).toBe(true);
    expect(TASK_IMPORT.test('import { multiply } from "./tasks/multiply";')).toBe(true);
    expect(BANNED.some((re) => re.test("const windowSize = 3;"))).toBe(false);
  });

  it.each(files)("%s uses no Math.random, Date.now, React, or DOM access", (_file, src) => {
    for (const re of BANNED) expect(src).not.toMatch(re);
  });

  // The engine only ever sees task-declared dimensions, never a task module.
  const engine = files.filter(([file]) => /\/(insight|insightText|stats)\.ts$/.test(file));

  it("finds the insight engine files", () => {
    expect(engine.map(([f]) => f).sort()).toEqual(["./insight.ts", "./insightText.ts", "./stats.ts"]);
  });

  it.each(engine)("%s imports nothing from core/tasks", (_file, src) => {
    expect(src).not.toMatch(TASK_IMPORT);
    expect(src).not.toMatch(/multiply/);
  });
});
