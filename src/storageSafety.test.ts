import { describe, expect, it } from "vitest";
import * as storage from "./core/storage";

// Every GitHub Pages project on this account shares ONE origin
// (iangopen.github.io) and therefore ONE localStorage.
// Spatiasense must only ever touch its own "spatiasense:" keys.

const sources = Object.entries(
  import.meta.glob<string>(["./**/*.ts", "./**/*.tsx", "!./**/*.test.ts"], {
    query: "?raw",
    import: "default",
    eager: true,
  }),
);

const CLEAR_CALL = /\.\s*clear\s*\(/;
const OTHER_STORES = /\b(sessionStorage|indexedDB)\b/;
/** Any localStorage method call; the key argument is checked separately. */
const LOCAL_STORAGE_CALL = /\blocalStorage\s*\.\s*(\w+)\s*\(\s*([^,)]*)/g;
const ALLOWED_METHODS = new Set(["getItem", "setItem"]);
const ALLOWED_KEY_ARGS = new Set(["ROUNDS_KEY"]);

describe("shared-origin storage safety", () => {
  it("guard patterns actually fire (self-test)", () => {
    expect(CLEAR_CALL.test("localStorage.clear()")).toBe(true);
    expect(CLEAR_CALL.test("window.localStorage . clear ( )")).toBe(true);
    expect(CLEAR_CALL.test("storage.clear ()")).toBe(true);
    expect(OTHER_STORES.test("sessionStorage.setItem")).toBe(true);
    const calls = [...'localStorage.removeItem("x"); localStorage.getItem(ROUNDS_KEY)'.matchAll(LOCAL_STORAGE_CALL)];
    expect(calls.map((m) => [m[1], m[2]])).toEqual([
      ["removeItem", '"x"'],
      ["getItem", "ROUNDS_KEY"],
    ]);
  });

  it("scans the app sources", () => {
    expect(sources.length).toBeGreaterThan(20);
    expect(sources.some(([f]) => f === "./persistence.ts")).toBe(true);
  });

  it.each(sources)("%s never calls clear()", (_file, src) => {
    expect(src).not.toMatch(CLEAR_CALL);
  });

  it.each(sources)("%s uses no sessionStorage or IndexedDB", (_file, src) => {
    expect(src).not.toMatch(OTHER_STORES);
  });

  it.each(sources)("%s only reads/writes approved spatiasense keys", (_file, src) => {
    for (const m of src.matchAll(LOCAL_STORAGE_CALL)) {
      expect(ALLOWED_METHODS.has(m[1] ?? "")).toBe(true);
      expect(ALLOWED_KEY_ARGS.has((m[2] ?? "").trim())).toBe(true);
    }
  });

  it("every exported storage key is prefixed spatiasense:", () => {
    const keys = Object.entries(storage).filter(([name]) => name.endsWith("_KEY"));
    expect(keys.length).toBeGreaterThan(0);
    for (const [, value] of keys) expect(String(value)).toMatch(/^spatiasense:/);
  });
});
