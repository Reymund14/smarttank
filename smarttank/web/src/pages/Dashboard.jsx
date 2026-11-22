import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ref, update } from "firebase/database";
import { evaluateReading, ruleRecommendations, predictTrend, OFFLINE_AFTER_MS } from "@logic";
import { db, ROOT } from "../firebase";
import { useList, useNow, useValue } from "../hooks";
import { Badge, ReadingCard, RecommendationCard, Empty } from "../components";
import { fmtTime, timeAgo } from "../utils";

function nextFeeding(times, now) {
  if (!times) return null;
  const d = new Date(now);
  const mins = d.getHours() * 60 + d.getMinutes();
  const list = times.split(",").map((t) => t.trim()).filter(Boolean).sort();
  if (!list.length) return null;
  const toMin = (t) => Number(t.split(":")[0]) * 60 + Number(t.split(":")[1]);
  const upcoming = list.find((t) => toMin(t) > mins);
  return upcoming ? `Today ${upcoming}` : `Tomorrow ${list[0]}`;
}

const TREND_ICON = { rising: "↗", falling: "↘", stable: "→", unknown: "·" };
const PARAM_LABEL = { temperature: "Temperature", ph: "pH", waterLevel: "Water level" };

/** AI early warning: forecasts the next 3 hours from the last 2 hours of readings. */
function EarlyWarning({ profile, now }) {
  const bucket = Math.floor(now / 600000); // refresh the query window every 10 minutes
  const since = useMemo(() => Date.now() - 2 * 3600e3, [bucket]);
  const history = useList("history", { since });
  if (!profile || !history) return null;
  const trend = predictTrend(history, profile);
  const entries = Object.entries(trend.params);
  return (
    <section className={`card forecast ${trend.risks.length ? "risk" : ""}`}>
      <div className="rec-head">
        <h2>Early warning · next 3 hours</h2>
        <span className="muted small">Trend forecast from the last 2 hours ({trend.basedOn || 0} readings)</span>
      </div>
      {trend.risks.length > 0 ? (
        <p><strong>⚠️ {trend.risks.length === 1 ? "One reading is" : "Some readings are"} heading out of range.</strong> Act now to prevent a problem.</p>
      ) : (
        <p className="muted">No reading is expected to leave the acceptable range soon.</p>
      )}
      <ul className="forecast-list">
        {entries.map(([k, p]) => (
          <li key={k} className={p.risk ? "risk" : ""}>
            <span className="trend-icon" aria-hidden>{TREND_ICON[p.trend]}</span>
            <span><strong>{PARAM_LABEL[k]}</strong> — {p.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Dashboard() {
  const now = useNow();
  const live = useValue("live");
  const settings = useValue("settings");
  const profiles = useValue("profiles");
  const latestRec = useValue("latestRecommendation");
  const alerts = useList("alerts", { limit: 10 });
  const feeds = useList("feedingLogs", { limit: 1 });

  if (live === undefined || settings === undefined) return <div className="muted">Loading…</div>;

  const profile = profiles?.[settings?.fishProfileId];
  const evaluation = live && profile ? evaluateReading(live, profile) : null;
  const online = live?.ts && now - live.ts < OFFLINE_AFTER_MS;
  const openAlerts = (alerts || []).filter((a) => !a.resolved);
  // If the cloud AI has not produced anything yet, show local rule-based guidance.
  const rec =
    evaluation && evaluation.overall !== "normal"
      ? latestRec && now - latestRec.ts < 60 * 60 * 1000
        ? latestRec
        : { ...ruleRecommendations(evaluation, profile), ts: live.ts }
      : null;
  const lastFeed = feeds?.[0];

  const dismiss = (id) => update(ref(db, `${ROOT}/alerts/${id}`), { resolved: true, resolvedAt: Date.now() });

  return (
    <div className="stack">
      <section className="page-head">
        <div>
          <h1>Aquarium overview</h1>
          <p className="muted">
            Fish profile: <strong>{profile?.name || "not selected"}</strong>
            {!profile && <> — <Link to="/settings">choose one in Settings</Link></>}
          </p>
        </div>
        <div className="head-status">
          <span className={`dot ${online ? "on" : "off"}`} /> Device {online ? "online" : "offline"}
          <span className="muted small"> · updated {timeAgo(live?.ts, now)}</span>
          {evaluation && <div><Badge level={evaluation.overall} /></div>}
        </div>
      </section>

      {!live && <Empty>No readings yet. Turn on the ESP32 or run the simulator (npm run simulate).</Empty>}

      {live && (
        <section className="grid3">
          <ReadingCard
            title="Water temperature" icon="🌡️" unit="°C"
            value={live.temperature}
            range={profile ? `${profile.tempMin}–${profile.tempMax}°C` : "—"}
            result={evaluation?.params.temperature}
          />
          <ReadingCard
            title="pH level" icon="🧪" unit=""
            value={live.ph}
            range={profile ? `${profile.phMin}–${profile.phMax}` : "—"}
            result={evaluation?.params.ph}
          />
          <ReadingCard
            title="Water level" icon="💧" unit="%"
            value={live.waterLevel}
            range={profile ? `≥ ${profile.levelMinPct}%` : "—"}
            result={evaluation?.params.waterLevel}
          />
        </section>
      )}

      {live && <EarlyWarning profile={profile} now={now} />}

      {openAlerts.length > 0 && (
        <section className="card">
          <h2>Active alerts</h2>
          <ul className="alerts">
            {openAlerts.map((a) => (
              <li key={a.id} className={a.level}>
                <div>
                  <Badge level={a.level} /> <span>{a.message}</span>
                  <div className="muted small">{fmtTime(a.ts)}</div>
                </div>
                <button className="ghost small" onClick={() => dismiss(a.id)}>Dismiss</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid2">
        <div>
          <h2>Care recommendation</h2>
          {rec ? (
            <>
              <RecommendationCard rec={rec} compact />
              <Link to="/recommendations" className="small">See full recommendation →</Link>
            </>
          ) : (
            <div className="card ok">
              <p>✅ All monitored conditions are within the acceptable range{profile ? ` for ${profile.name}` : ""}.</p>
              <p className="muted small">Keep up regular monitoring and weekly partial water changes.</p>
            </div>
          )}
        </div>
        <div>
          <h2>Feeding</h2>
          <div className="card">
            <p>
              Status:{" "}
              <strong>{settings?.feeding?.enabled === false ? "Automatic feeding OFF" : "Automatic feeding ON"}</strong>
            </p>
            <p>Schedule: {settings?.feeding?.times?.split(",").join(", ") || "none"} · {settings?.feeding?.portions || 1} portion(s)</p>
            <p>Next feeding: <strong>{settings?.feeding?.enabled === false ? "—" : nextFeeding(settings?.feeding?.times, now) || "—"}</strong></p>
            <p>
              Last feeding:{" "}
              {lastFeed ? `${fmtTime(lastFeed.ts)} (${lastFeed.type}, ${lastFeed.portions} portion/s)` : "no record yet"}
            </p>
            <Link to="/feeding" className="small">Manage feeding →</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
