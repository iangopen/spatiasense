import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../core/rng";
import { KEY_STEP, KEY_STEP_SHIFT, TRACK_MAX_X, markerForKey, multiply } from "../../core/tasks/multiply";
import type { TrialPhase } from "../props";
import { MultiplyView } from "./View";

const trial = multiply.generate({ n: 6, layout: "anchored" }, mulberry32(5));

function render(response: number | null, phase: TrialPhase = "answering"): string {
  return renderToStaticMarkup(createElement(MultiplyView, { trial, response, phase, onResponse: () => undefined }));
}
const attr = (html: string, name: string) => new RegExp(`<svg[^>]* ${name}="([^"]*)"`).exec(html)?.[1];

describe("MultiplyView slider semantics", () => {
  it("is a focusable horizontal slider named for the task", () => {
    const html = render(null);
    expect(attr(html, "role")).toBe("slider");
    expect(attr(html, "aria-label")).toBe("Place the end of 6 bars");
    expect(attr(html, "aria-orientation")).toBe("horizontal");
    expect(attr(html, "tabindex")).toBe("0");
    expect(html).not.toContain('role="application"');
  });

  it("aria-valuemin/max/now are lengths in viewBox units from the origin", () => {
    expect(attr(render(null), "aria-valuemin")).toBe("0");
    expect(attr(render(null), "aria-valuemax")).toBe(String(Math.round(TRACK_MAX_X - trial.origin)));
    expect(attr(render(null), "aria-valuenow")).toBe("0");
    expect(attr(render(trial.origin + 123.4), "aria-valuenow")).toBe("123");
  });

  it("valuetext is words only and never contains a digit", () => {
    for (const html of [render(null), render(trial.origin + 217), render(TRACK_MAX_X, "feedback")]) {
      expect(attr(html, "aria-valuetext")).toMatch(/^[A-Za-z ]+$/);
    }
    expect(attr(render(null), "aria-valuetext")).toBe("No marker yet");
    expect(attr(render(trial.origin + 50), "aria-valuetext")).toBe("Marker placed");
  });
});

describe("markerForKey", () => {
  const at = trial.origin + 200;

  it("Home jumps to the origin and End to the track maximum", () => {
    expect(markerForKey(trial, at, "Home", false, false)).toBe(trial.origin);
    expect(markerForKey(trial, at, "End", false, false)).toBe(TRACK_MAX_X);
    expect(markerForKey(trial, null, "End", false, false)).toBe(TRACK_MAX_X);
  });

  it("arrows nudge by 1, Shift+arrow by 10, clamped to the track", () => {
    expect(markerForKey(trial, at, "ArrowRight", false, false)).toBe(at + KEY_STEP);
    expect(markerForKey(trial, at, "ArrowLeft", true, false)).toBe(at - KEY_STEP_SHIFT);
    expect(markerForKey(trial, trial.origin, "ArrowLeft", false, false)).toBe(trial.origin);
    expect(markerForKey(trial, TRACK_MAX_X, "ArrowRight", true, false)).toBe(TRACK_MAX_X);
    expect(markerForKey(trial, null, "ArrowRight", false, false)).toBe(trial.origin + KEY_STEP);
  });

  it("does nothing once the trial is locked, for every handled key", () => {
    for (const key of ["Home", "End", "ArrowLeft", "ArrowRight"]) {
      expect(markerForKey(trial, at, key, false, true)).toBeNull();
      expect(markerForKey(trial, at, key, true, true)).toBeNull();
    }
  });

  it("ignores unrelated keys", () => {
    expect(markerForKey(trial, at, "a", false, false)).toBeNull();
    expect(markerForKey(trial, at, "Enter", false, false)).toBeNull();
  });
});
