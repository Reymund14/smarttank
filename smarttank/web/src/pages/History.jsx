import { useMemo, useState } from "react";
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { useList, useValue } from "../hooks";
import { Empty } from "../components";
import { downloadCsv, fmtTime } from "../utils";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

const RANGES = { "6h": 6 * 3600e3, "24h": 24 * 3600e3, "7d": 7 * 24 * 3600e3, "30d": 30 * 24 * 3600e3 };

function downsample(rows, max = 300) {
  if (rows.length <= max) return rows;
  const step = rows.length / max;
  return Array.from({ length: max }, (_, i) => rows[Math.floor(i * step)]);
}

function ParamChart({ rows, field, label, color, min, max }) {
  const valid = rows.filter((r) => typeof r[field] === "number" && r[field] > -100 && r[field] >= 0);
  const pts = downsample(valid);
  const labels = pts.map((r) =>
    new Date(r.ts).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
  );
  const datasets = [
    { label, data: pts.map((r) => r[field]), borderColor: color, backgroundColor: color + "22", fill: true, pointRadius: 0, borderWidth: 2, tension: 0.25 },
  ];
  if (min !== undefined) datasets.push({ label: "Min", data: pts.map(() => min), borderColor: "#9ca3af", borderDash: [5, 5], pointRadius: 0, borderWidth: 1 });
  if (max !== undefined) datasets.push({ label: "Max", data: pts.map(() => max), borderColor: "#9ca3af", borderDash: [5, 5], pointRadius: 0, borderWidth: 1 });
  return (
    <div className="card chart">
      <h3>{label}</h3>
      {pts.length === 0 ? (
        <Empty>No data in this period.</Empty>
      ) : (
        <div className="chart-box">
          <Line
            data={{ labels, datasets }}
            options={{
              responsive: true, maintainAspectRatio: false, animation: false,
              interaction: { mode: "index", intersect: false },
              plugins: { legend: { display: false } },
              scales: { x: { ticks: { maxTicksLimit: 6, autoSkip: true } } },
            }}
          />
        </div>
      )}
    </div>
  );
}

export default function History() {
  const [range, setRange] = useState("24h");
  // Computed only when the range changes so the database query is not re-created every render.
  const since = useMemo(() => Date.now() - RANGES[range], [range]);
  const rowsDesc = useList("history", { since });
  const feeds = useList("feedingLogs", { since });
  const settings = useValue("settings");
  const profiles = useValue("profiles");
  const profile = profiles?.[settings?.fishProfileId];

  const rows = useMemo(() => (rowsDesc ? [...rowsDesc].reverse() : []), [rowsDesc]);

  const exportReadings = () =>
    downloadCsv(`aquarium-readings-${range}.csv`, rows, [
      { label: "Date & time", get: (r) => fmtTime(r.ts) },
      { label: "Timestamp (ms)", get: (r) => r.ts },
      { label: "Temperature (C)", get: (r) => r.temperature },
      { label: "pH", get: (r) => r.ph },
      { label: "Water level (%)", get: (r) => r.waterLevel },
      { label: "Water depth (cm)", get: (r) => r.waterCm },
      { label: "pH voltage (V)", get: (r) => r.phVoltage },
    ]);

  const exportFeeds = () =>
    downloadCsv(`aquarium-feeding-${range}.csv`, feeds || [], [
      { label: "Date & time", get: (r) => fmtTime(r.ts) },
      { label: "Type", get: (r) => r.type },
      { label: "Portions", get: (r) => r.portions },
      { label: "Success", get: (r) => (r.success ? "yes" : "no") },
    ]);

  return (
    <div className="stack">
      <section className="page-head">
        <div>
          <h1>History & reports</h1>
          <p className="muted">{rows.length} readings and {feeds?.length || 0} feedings in the selected period.</p>
        </div>
        <div className="row">
          <div className="segmented">
            {Object.keys(RANGES).map((r) => (
              <button key={r} className={r === range ? "active" : ""} onClick={() => setRange(r)}>{r}</button>
            ))}
          </div>
        </div>
      </section>
      <div className="row">
        <button className="ghost" onClick={exportReadings} disabled={!rows.length}>Export readings (CSV)</button>
        <button className="ghost" onClick={exportFeeds} disabled={!feeds?.length}>Export feeding log (CSV)</button>
      </div>

      {rowsDesc === undefined ? (
        <div className="muted">Loading…</div>
      ) : (
        <section className="grid3 charts">
          <ParamChart rows={rows} field="temperature" label="Temperature (°C)" color="#ef4444" min={profile?.tempMin} max={profile?.tempMax} />
          <ParamChart rows={rows} field="ph" label="pH level" color="#8b5cf6" min={profile?.phMin} max={profile?.phMax} />
          <ParamChart rows={rows} field="waterLevel" label="Water level (%)" color="#0ea5e9" min={profile?.levelMinPct} />
        </section>
      )}

      <section className="card">
        <h2>Recorded readings (latest 200)</h2>
        {rowsDesc?.length === 0 && <Empty>No readings in this period.</Empty>}
        {rowsDesc?.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Date & time</th><th>Temp (°C)</th><th>pH</th><th>Water (%)</th></tr>
              </thead>
              <tbody>
                {rowsDesc.slice(0, 200).map((r) => (
                  <tr key={r.id}>
                    <td>{fmtTime(r.ts)}</td>
                    <td>{r.temperature > -100 ? r.temperature : "ERR"}</td>
                    <td>{r.ph >= 0 ? r.ph : "ERR"}</td>
                    <td>{r.waterLevel >= 0 ? r.waterLevel : "ERR"}</td>
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
