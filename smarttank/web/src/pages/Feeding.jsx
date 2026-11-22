import { useEffect, useState } from "react";
import { ref, set, update } from "firebase/database";
import { httpsCallable } from "firebase/functions";
import { evaluateReading, ruleFeedingAdvice, summarizeHistory } from "@logic";
import { db, functions, ROOT } from "../firebase";
import { useList, useValue } from "../hooks";
import { Empty } from "../components";
import { fmtTime } from "../utils";

export default function Feeding() {
  const settings = useValue("settings");
  const feedNow = useValue("commands/feedNow");
  const logs = useList("feedingLogs", { limit: 50 });
  const savedAdvice = useValue("feedingAdvice");
  const profiles = useValue("profiles");
  const recent = useList("history", { limit: 240 });
  const [advice, setAdvice] = useState(null);
  const [adviceBusy, setAdviceBusy] = useState(false);
  const shownAdvice = advice || savedAdvice;

  const [enabled, setEnabled] = useState(true);
  const [times, setTimes] = useState([]);
  const [portions, setPortions] = useState(1);
  const [newTime, setNewTime] = useState("08:00");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.feeding?.enabled !== false);
    setTimes((settings.feeding?.times || "").split(",").map((t) => t.trim()).filter(Boolean));
    setPortions(settings.feeding?.portions || 1);
  }, [settings]);

  const addTime = () => {
    if (!newTime || times.includes(newTime)) return;
    if (times.length >= 8) return setMsg("Maximum of 8 feeding times.");
    setTimes([...times, newTime].sort());
  };

  const save = async () => {
    await update(ref(db, `${ROOT}/settings/feeding`), {
      enabled,
      times: times.join(","),
      portions: Number(portions),
    });
    setMsg("Feeding schedule saved. The device picks it up within 30 seconds.");
  };

  const feedNowClick = async () => {
    await set(ref(db, `${ROOT}/commands/feedNow`), {
      requested: true,
      portions: Number(portions),
      requestedAt: Date.now(),
    });
    setMsg("Feed command sent.");
  };

  const getAdvice = async () => {
    setAdviceBusy(true);
    try {
      const res = await httpsCallable(functions, "feedingAdvice")();
      setAdvice(res.data);
    } catch {
      // Cloud Functions not available: use the built-in rules in the browser.
      const profile = profiles?.[settings?.fishProfileId];
      if (!profile) { setMsg("Select a fish profile in Settings first."); return; }
      const stats = summarizeHistory(recent || [], profile);
      setAdvice({ ...ruleFeedingAdvice({ profile, feeding: settings?.feeding, feedings: logs || [], stats }), ts: Date.now() });
    } finally {
      setAdviceBusy(false);
    }
  };

  const applyAdvice = () => {
    setTimes([...shownAdvice.suggested_times].sort());
    setPortions(shownAdvice.suggested_portions);
    setMsg("Suggestion copied into the schedule below. Review it, then press Save schedule.");
  };

  const pending = feedNow?.requested;

  return (
    <div className="stack">
      <section className="page-head">
        <div>
          <h1>Automated feeding</h1>
          <p className="muted">Set the daily schedule and portion size. The device keeps feeding on schedule even without Wi-Fi.</p>
        </div>
        <button onClick={feedNowClick} disabled={pending}>
          {pending ? "Waiting for device…" : `Feed now (${portions})`}
        </button>
      </section>
      {msg && <p className="note">{msg}</p>}

      <section className="card">
        <div className="rec-head">
          <h2>AI feeding advice</h2>
          <button className="ghost small" onClick={getAdvice} disabled={adviceBusy}>
            {adviceBusy ? "Analyzing…" : shownAdvice ? "Analyze again" : "Get feeding advice"}
          </button>
        </div>
        {!shownAdvice && (
          <p className="muted">The AI reviews your fish type, feeding log and water quality and suggests a schedule. Nothing changes until you save it.</p>
        )}
        {shownAdvice && (
          <div className="stack-sm">
            <p><strong>{shownAdvice.assessment}</strong></p>
            <p>
              Suggested: <strong>{shownAdvice.suggested_times.join(", ")}</strong> · {shownAdvice.suggested_portions} portion(s) per feeding
            </p>
            {shownAdvice.reasons?.length > 0 && <ul>{shownAdvice.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
            {shownAdvice.cautions?.length > 0 && (
              <><h4>Cautions</h4><ul>{shownAdvice.cautions.map((r, i) => <li key={i}>{r}</li>)}</ul></>
            )}
            <div className="row">
              <button onClick={applyAdvice}>Use this suggestion</button>
              <span className="muted small">{shownAdvice.source === "ai" ? "AI-assisted" : "Rule-based"}{shownAdvice.ts ? ` · ${fmtTime(shownAdvice.ts)}` : ""}</span>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Schedule</h2>
        <label className="row">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Automatic feeding enabled
        </label>
        <div className="chips">
          {times.length === 0 && <span className="muted">No feeding times yet.</span>}
          {times.map((t) => (
            <span key={t} className="chip">
              {t}
              <button aria-label={`Remove ${t}`} onClick={() => setTimes(times.filter((x) => x !== t))}>×</button>
            </span>
          ))}
        </div>
        <div className="row">
          <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
          <button className="ghost" onClick={addTime}>Add time</button>
        </div>
        <label>
          Portions per feeding (1 portion = 1 turn of the feeder)
          <select value={portions} onChange={(e) => setPortions(e.target.value)}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button onClick={save}>Save schedule</button>
      </section>

      <section className="card">
        <h2>Feeding log</h2>
        {logs?.length === 0 && <Empty>No feedings recorded yet.</Empty>}
        {logs?.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Date & time</th><th>Type</th><th>Portions</th><th>Result</th></tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td>{fmtTime(l.ts)}</td>
                    <td>{l.type === "scheduled" ? "Scheduled" : "Manual"}</td>
                    <td>{l.portions}</td>
                    <td>{l.success ? "✅ Dispensed" : "❌ Failed"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
