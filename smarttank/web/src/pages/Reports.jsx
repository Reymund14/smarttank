import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { useValue } from "../hooks";
import { Empty } from "../components";
import { fmtTime } from "../utils";

function scoreLevel(s) {
  if (s === null || s === undefined) return "";
  return s >= 95 ? "normal" : s >= 80 ? "warning" : "critical";
}

function Stat({ label, s, unit }) {
  if (!s) return <div className="stat"><span className="muted small">{label}</span><strong>—</strong></div>;
  return (
    <div className="stat">
      <span className="muted small">{label}</span>
      <strong>{s.min}–{s.max}{unit}</strong>
      <span className="small">avg {s.avg}{unit} · {s.pctInRange}% in range</span>
    </div>
  );
}

export function ReportCard({ r }) {
  return (
    <article className="card report">
      <div className="report-head">
        <div>
          <span className="muted small">{new Date(r.date + "T00:00:00").toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
          <h2>{r.headline}</h2>
        </div>
        {r.stabilityScore !== null && r.stabilityScore !== undefined && (
          <div className={`score ${scoreLevel(r.stabilityScore)}`} title="Average % of time within the acceptable range">
            <strong>{r.stabilityScore}</strong><span>stability</span>
          </div>
        )}
      </div>
      <p>{r.summary}</p>
      <div className="stats3">
        <Stat label="Temperature" s={r.stats?.temperature} unit="°C" />
        <Stat label="pH" s={r.stats?.ph} unit="" />
        <Stat label="Water level" s={r.stats?.waterLevel} unit="%" />
      </div>
      <div className="grid2 tight">
        {r.highlights?.length > 0 && (<div><h4>What went well</h4><ul>{r.highlights.map((x, i) => <li key={i}>{x}</li>)}</ul></div>)}
        {r.concerns?.length > 0 && (<div><h4>Needs attention</h4><ul>{r.concerns.map((x, i) => <li key={i}>{x}</li>)}</ul></div>)}
      </div>
      {r.tips?.length > 0 && (<><h4>Tips for tomorrow</h4><ul>{r.tips.map((x, i) => <li key={i}>{x}</li>)}</ul></>)}
      <p className="muted small">
        {r.alertCount ?? 0} alert(s) · {r.feedingCount ?? 0} feeding(s) · {r.source === "ai" ? "AI-generated" : "Rule-based"} · {fmtTime(r.ts)}
      </p>
      <p className="disclaimer small">{r.disclaimer}</p>
    </article>
  );
}

export default function Reports() {
  const reports = useValue("reports");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const generate = async () => {
    setBusy(true);
    setMsg("");
    try {
      await httpsCallable(functions, "generateReportNow")();
      setMsg("Today's report was generated.");
    } catch (err) {
      setMsg(`Could not generate the report: ${err.message}. Make sure the Cloud Functions are deployed.`);
    } finally {
      setBusy(false);
    }
  };

  const list = reports ? Object.values(reports).sort((a, b) => b.date.localeCompare(a.date)) : [];

  return (
    <div className="stack">
      <section className="page-head">
        <div>
          <h1>Daily AI reports</h1>
          <p className="muted">A summary of the last 24 hours is written automatically every day at 8:00 PM.</p>
        </div>
        <button onClick={generate} disabled={busy}>{busy ? "Writing report…" : "Generate today's report"}</button>
      </section>
      {msg && <p className="note">{msg}</p>}
      {reports === undefined && <div className="muted">Loading…</div>}
      {reports !== undefined && list.length === 0 && <Empty>No reports yet. The first one appears tonight at 8:00 PM, or generate one now.</Empty>}
      {list.map((r) => <ReportCard key={r.date} r={r} />)}
    </div>
  );
}
