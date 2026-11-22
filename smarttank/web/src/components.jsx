import { LEVEL_LABEL, fmtTime } from "./utils";

export function Badge({ level }) {
  return <span className={`badge ${level || "unknown"}`}>{LEVEL_LABEL[level] || "No data"}</span>;
}

export function ReadingCard({ title, value, unit, range, result, icon }) {
  const level = result?.level;
  const shown = value === undefined || value === null || value < -100 || value < 0 ? "—" : value;
  return (
    <div className={`card reading ${level || ""}`}>
      <div className="reading-head">
        <span className="reading-title">
          <span aria-hidden>{icon}</span> {title}
        </span>
        <Badge level={level} />
      </div>
      <div className="reading-value">
        {shown}
        {shown !== "—" && <span className="unit">{unit}</span>}
      </div>
      <div className="muted small">Acceptable: {range}</div>
      {result && level !== "normal" && <div className="reading-reason small">{result.reason}</div>}
    </div>
  );
}

export function RecommendationCard({ rec, compact = false }) {
  if (!rec) return null;
  return (
    <div className={`card rec urgency-${rec.urgency}`}>
      <div className="rec-head">
        <strong>{rec.urgency === "high" ? "⚠️ Urgent" : rec.urgency === "medium" ? "Needs attention" : "All good"}</strong>
        <span className="muted small">
          {rec.source === "ai" ? "AI-assisted" : "Rule-based"} · {fmtTime(rec.ts)}
        </span>
      </div>
      <p>{rec.condition}</p>
      {!compact && rec.possible_causes?.length > 0 && (
        <>
          <h4>Possible causes</h4>
          <ul>{rec.possible_causes.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </>
      )}
      {rec.recommended_actions?.length > 0 && (
        <>
          <h4>Recommended actions</h4>
          <ol>{(compact ? rec.recommended_actions.slice(0, 3) : rec.recommended_actions).map((a, i) => <li key={i}>{a}</li>)}</ol>
        </>
      )}
      {!compact && rec.reading && (
        <p className="muted small">
          Readings at the time: {rec.reading.temperature}°C · pH {rec.reading.ph} · water {rec.reading.waterLevel}%
          {rec.fishProfile ? ` · ${rec.fishProfile}` : ""}
        </p>
      )}
      <p className="disclaimer small">{rec.disclaimer}</p>
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty muted">{children}</div>;
}
