import { useId, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { VIEW_H, VIEW_W, clientToViewBox } from "../../core/geometry";
import { BAR_H, TRACK_MAX_X, clampMarker, markerForKey, markerValueText, trueEndX, type MultiplyResponse, type MultiplyTrial } from "../../core/tasks/multiply";
import type { ViewProps } from "../props";

const MARKER_REACH = 34;

export function MultiplyView({ trial, response, phase, onResponse }: ViewProps<MultiplyTrial, MultiplyResponse>) {
  const svgRef = useRef<SVGSVGElement>(null);
  const promptId = useId();
  const locked = phase === "feedback";

  const place = (e: PointerEvent<SVGSVGElement>) => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return;
    const { x } = clientToViewBox(ctm.inverse(), e.clientX, e.clientY);
    onResponse(clampMarker(trial, x));
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (locked || !e.isPrimary) return;
    e.preventDefault();
    // Capture so the marker keeps tracking when the pointer leaves the bar or the SVG.
    e.currentTarget.setPointerCapture(e.pointerId);
    place(e);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (locked || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    place(e);
  };
  const onPointerEnd = (e: PointerEvent<SVGSVGElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const next = markerForKey(trial, response, e.key, e.shiftKey, locked);
    if (next === null) return;
    e.preventDefault();
    onResponse(next);
  };

  const { origin, trackY, refX, refY, refLength, n } = trial;
  const barTop = (y: number) => y - BAR_H / 2;
  const end = trueEndX(trial);

  return (
    <div className="task-view">
      <p className="prompt" id={promptId}>
        Where would <strong>{n}</strong> of these bars end, laid end to end?
        {trial.layout === "detached" && " Start from the marked origin."}
      </p>
      <svg
        ref={svgRef}
        className="stage"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="slider"
        aria-label={`Place the end of ${n} bars`}
        aria-describedby={promptId}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={Math.round(TRACK_MAX_X - origin)}
        aria-valuenow={response === null ? 0 : Math.round(response - origin)}
        aria-valuetext={markerValueText(response)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onKeyDown={onKeyDown}
      >
        {/* Answer track: a faint line from the origin; no ticks, no landmarks. */}
        <line className="track" x1={origin} y1={trackY} x2={TRACK_MAX_X} y2={trackY} />
        {trial.layout === "detached" && (
          <line className="origin-mark" x1={origin} y1={trackY - 22} x2={origin} y2={trackY + 22} />
        )}

        {response !== null && (
          <rect className="answer-fill" x={origin} y={barTop(trackY)} width={Math.max(0, response - origin)} height={BAR_H} />
        )}

        {locked &&
          Array.from({ length: n }, (_, i) => (
            <rect
              key={i}
              className="ghost"
              x={origin + i * refLength}
              y={barTop(trackY)}
              width={refLength}
              height={BAR_H}
            />
          ))}

        <rect className="ref-bar" x={refX} y={barTop(refY)} width={refLength} height={BAR_H} />

        {locked && (
          <line className="true-end" x1={end} y1={trackY - MARKER_REACH - 8} x2={end} y2={trackY + MARKER_REACH + 8} />
        )}

        {response !== null && (
          <g className="marker">
            <line x1={response} y1={trackY - MARKER_REACH} x2={response} y2={trackY + MARKER_REACH} />
            <path d={`M ${response} ${trackY + MARKER_REACH} l -9 14 h 18 z`} />
          </g>
        )}
      </svg>
    </div>
  );
}
