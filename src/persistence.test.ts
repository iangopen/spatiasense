import { afterEach, describe, expect, it, vi } from "vitest";
import { ROUNDS_KEY, parseRounds } from "./core/storage";
import { simulatePlayer } from "./core/sim";
import { exportJson, saveRound } from "./persistence";

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Copy my data (exportJson)", () => {
  it("holds what storage holds, and round-trips through parse unchanged", () => {
    const store = fakeStorage();
    vi.stubGlobal("localStorage", store);
    const { rounds } = simulatePlayer({ seed: 11, noiseSd: 10, trials: 40 });
    for (const r of rounds) expect(saveRound(r)).toBe(true);

    const json = exportJson();
    // Same content as storage (byte order of keys can differ: saves re-serialize older rounds).
    expect(parseRounds(json)).toEqual(parseRounds(store.data.get(ROUNDS_KEY) ?? null));
    expect(parseRounds(json)).toEqual({ rounds, problems: [] });
  });

  it("with nothing stored, exports an empty but valid document", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    expect(parseRounds(exportJson())).toEqual({ rounds: [], problems: [] });
  });
});
