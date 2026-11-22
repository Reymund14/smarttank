export const fmtTime = (ts) =>
  ts ? new Date(ts).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "—";

export function timeAgo(ts, now = Date.now()) {
  if (!ts) return "never";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export const LEVEL_LABEL = {
  normal: "Normal",
  warning: "Warning",
  critical: "Critical",
  error: "Sensor error",
};

export function downloadCsv(filename, rows, columns) {
  const esc = (v) => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => c.label).join(",")];
  rows.forEach((r) => lines.push(columns.map((c) => esc(c.get(r))).join(",")));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
