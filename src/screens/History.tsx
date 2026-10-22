import { useMemo, useState } from "react";
import { summarize } from "../core/scoring";
import { copyText, exportJson, loadRounds } from "../persistence";
import { findTask } from "../tasks/registry";
import { pct } from "./Results";

interface HistoryProps {
  onBack: () => void;
  onInsight: () => void;
}

export function History({ onBack, onInsight }: HistoryProps) {
  const { rounds, problems } = useMemo(() => loadRounds(), []);
  const newestFirst = [...rounds].sort((a, b) => b.finishedAt - a.finishedAt);
  // "copied", or the JSON itself when the clipboard is unavailable so it can be copied by hand.
  const [copied, setCopied] = useState<"copied" | string | null>(null);
  const copyData = async () => {
    const json = exportJson();
    setCopied((await copyText(json)) ? "copied" : json);
  };

  return (
    <section className="screen history">
      <h1>History</h1>
      {problems.map((p) => (
        <p key={p} className="warning">
          {p}
        </p>
      ))}
      {newestFirst.length === 0 && <p className="lede">No rounds yet.</p>}
      {newestFirst.length > 0 && (
        <table className="trials">
          <thead>
            <tr>
              <th>When</th>
              <th>Task</th>
              <th>Trials</th>
              <th>Mean |error|</th>
              <th>Mean bias</th>
            </tr>
          </thead>
          <tbody>
            {newestFirst.map((r) => {
              const s = summarize(r.trials);
              return (
                <tr key={r.id}>
                  <td>{new Date(r.finishedAt).toLocaleString()}</td>
                  <td>{findTask(r.taskId)?.core.label ?? r.taskId}</td>
                  <td>{s.count}</td>
                  <td>{s.meanAbsErrorPct.toFixed(1)}%</td>
                  <td>{pct(s.meanSignedErrorPct)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="actions">
        <button onClick={onBack}>Back</button>
        <button onClick={onInsight}>Your bias</button>
        {newestFirst.length > 0 && <button onClick={() => void copyData()}>Copy my data</button>}
      </div>
      {copied === "copied" && (
        <p className="note" role="status">
          Copied {newestFirst.length} round(s) as JSON.
        </p>
      )}
      {copied !== null && copied !== "copied" && (
        <label className="field">
          <span>Couldn't reach the clipboard. Select all and copy:</span>
          <textarea readOnly rows={6} value={copied} onFocus={(e) => e.currentTarget.select()} />
        </label>
      )}
    </section>
  );
}
