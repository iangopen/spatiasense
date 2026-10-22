import { useMemo, useState } from "react";
import { BiasChart } from "../components/charts/BiasChart";
import { TrendChart } from "../components/charts/TrendChart";
import { INSIGHT, findInsights, groupStats, roundSeries } from "../core/insight";
import { findingText } from "../core/insightText";
import { simulatePlayer } from "../core/sim";
import type { RoundRecord } from "../core/types";
import { loadRounds } from "../persistence";
import { tasks } from "../tasks/registry";
import { pct } from "./Results";

interface InsightProps {
  onBack: () => void;
}

/** Dev-only demo player: in memory only, never written to storage. */
function demoRounds(): RoundRecord[] {
  return simulatePlayer({
    seed: 42,
    trials: 150,
    noiseSd: 9,
    biasByN: { 2: 1, 3: -1, 4: -3, 5: -8, 6: -11, 7: -13, 8: -14 },
    layoutBiasPct: { detached: -4 },
    improvementPerTrial: 0.03,
  }).rounds;
}

export function Insight({ onBack }: InsightProps) {
  const stored = useMemo(() => loadRounds(), []);
  const [demo, setDemo] = useState<RoundRecord[] | null>(null);
  const rounds = demo ?? stored.rounds;

  const firstTask = tasks[0];
  const [taskId, setTaskId] = useState(firstTask?.core.id ?? "");
  const task = tasks.find((t) => t.core.id === taskId) ?? firstTask;
  const dims = task?.core.insightDimensions ?? [];

  const ordinal = dims.filter((d) => d.kind === "ordinal");
  const xChoices = ordinal.length > 0 ? ordinal : dims;
  const [xKey, setXKey] = useState(xChoices[0]?.key ?? "");
  const xDim = xChoices.find((d) => d.key === xKey) ?? xChoices[0];
  const seriesChoices = dims.filter((d) => d.kind === "category" && d.key !== xDim?.key);
  const [seriesKey, setSeriesKey] = useState("");
  const seriesDim = seriesChoices.find((d) => d.key === seriesKey);

  const taskRounds = useMemo(() => rounds.filter((r) => r.taskId === task?.core.id), [rounds, task]);
  const trials = useMemo(() => taskRounds.flatMap((r) => r.trials), [taskRounds]);
  const report = useMemo(() => findInsights(trials, dims), [trials, dims]);
  const groups = useMemo(() => (xDim ? groupStats(trials, xDim, seriesDim) : []), [trials, xDim, seriesDim]);
  const points = useMemo(() => roundSeries(taskRounds), [taskRounds]);

  const demoButton = import.meta.env.DEV && (
    <button className="quiet" onClick={() => setDemo(demo ? null : demoRounds())}>
      {demo ? "Back to my data" : "Load demo player (dev)"}
    </button>
  );

  return (
    <section className="screen insight">
      <h1>Your bias</h1>
      {demo && <p className="warning">Demo player: simulated data, shown in memory only and never saved.</p>}
      {!demo && stored.problems.map((p) => <p key={p} className="warning">{p}</p>)}

      {tasks.length > 1 && (
        <label className="field">
          <span>Task</span>
          <select value={task?.core.id} onChange={(e) => setTaskId(e.target.value)}>
            {tasks.map((t) => (
              <option key={t.core.id} value={t.core.id}>
                {t.core.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {trials.length === 0 ? (
        <div className="empty">
          <p className="lede">
            Play a round and come back. Once a group has {INSIGHT.MIN_TRIALS_PER_GROUP} trials, this page tells you whether
            you tend to overshoot or undershoot there — and says nothing until the data can back it up.
          </p>
          <div className="actions">
            <button className="primary" onClick={onBack}>
              Play a round
            </button>
            {demoButton}
          </div>
        </div>
      ) : (
        <>
          <ul className="findings">
            {report.findings.length === 0 && (
              <li className="finding quiet-finding">No trials with readable settings for this task yet.</li>
            )}
            {report.findings.map((f, i) => (
              <li key={i} className={`finding finding-${f.kind}`}>
                {findingText(f)}
              </li>
            ))}
          </ul>
          <p className="note">
            Based on {trials.length} trials. Claims need {INSIGHT.MIN_TRIALS_PER_GROUP}+ trials per group and must survive a
            test across all {report.familySize} claims checked.
          </p>

          {xDim && (
            <>
              <h2>Bias by {xDim.label}</h2>
              <div className="chart-controls">
                {xChoices.length > 1 && (
                  <label className="field inline">
                    <span>x axis</span>
                    <select value={xDim.key} onChange={(e) => setXKey(e.target.value)}>
                      {xChoices.map((d) => (
                        <option key={d.key} value={d.key}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {seriesChoices.length > 0 && (
                  <label className="field inline">
                    <span>split by</span>
                    <select value={seriesDim?.key ?? ""} onChange={(e) => setSeriesKey(e.target.value)}>
                      <option value="">none</option>
                      {seriesChoices.map((d) => (
                        <option key={d.key} value={d.key}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <BiasChart
                groups={groups}
                xLabel={xDim.label}
                {...(seriesDim ? { seriesLabel: seriesDim.label } : {})}
                minTrials={INSIGHT.MIN_TRIALS_PER_GROUP}
              />
            </>
          )}

          <h2>Bias per round</h2>
          <TrendChart points={points} rollingWindow={INSIGHT.ROLLING_ROUNDS} />

          <h2>Groups</h2>
          <div className="table-scroll">
            <table className="trials">
              <thead>
                <tr>
                  <th>{xDim?.label}</th>
                  {seriesDim && <th>{seriesDim.label}</th>}
                  <th>Trials</th>
                  <th>Bias</th>
                  <th>95% interval</th>
                  <th>Mean |error|</th>
                  <th>Hit edge</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={`${String(g.value)}|${String(g.series ?? "")}`} className={g.count < INSIGHT.MIN_TRIALS_PER_GROUP ? "thin" : undefined}>
                    <td>{String(g.value)}</td>
                    {seriesDim && <td>{String(g.series ?? "")}</td>}
                    <td>{g.count}</td>
                    <td>{pct(g.meanSignedPct)}</td>
                    <td>{g.ci95 ? `${pct(g.ci95.low)} to ${pct(g.ci95.high)}` : "—"}</td>
                    <td>{g.meanAbsPct.toFixed(1)}%</td>
                    <td>{g.censored}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="actions">
        <button onClick={onBack}>Home</button>
        {trials.length > 0 && demoButton}
      </div>
    </section>
  );
}
