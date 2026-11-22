/**
 * Shared aquarium logic — used by BOTH the Cloud Functions and the web dashboard
 * (the web app imports this file through the "@logic" alias in vite.config.js).
 *
 * 1. evaluateReading()      → Normal / Warning / Critical per parameter
 * 2. ruleRecommendations()  → rule-based care advice (fallback when the AI is unavailable)
 */

export const LEVEL = { NORMAL: "normal", WARNING: "warning", CRITICAL: "critical", ERROR: "error" };

// How far outside the acceptable range a reading can go before it becomes "critical".
export const MARGINS = { temperature: 1.5, ph: 0.3 };

// A reading older than this (ms) means the device is considered offline.
export const OFFLINE_AFTER_MS = 5 * 60 * 1000;

const RANK = { normal: 0, warning: 1, error: 1, critical: 2 };

function evalRange(value, min, max, margin, unit, label) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return { level: LEVEL.ERROR, reason: `${label} sensor has no valid reading.` };
  }
  const v = Number(value);
  if (v >= min && v <= max) {
    return { level: LEVEL.NORMAL, reason: `${label} is within ${min}–${max}${unit}.` };
  }
  const low = v < min;
  const diff = low ? min - v : v - max;
  const level = diff <= margin ? LEVEL.WARNING : LEVEL.CRITICAL;
  return {
    level,
    direction: low ? "low" : "high",
    reason: `${label} is too ${low ? "low" : "high"} (${v}${unit}); acceptable range is ${min}–${max}${unit}.`,
  };
}

/**
 * @param {{temperature:number, ph:number, waterLevel:number}} reading  waterLevel is in percent
 * @param {object} profile  fish profile (tempMin, tempMax, phMin, phMax, levelMinPct, levelCriticalPct, name)
 */
export function evaluateReading(reading, profile) {
  if (!reading || !profile) return null;

  // DS18B20 returns -127 when disconnected; treat impossible values as sensor errors.
  const temp = reading.temperature;
  const tempBad = temp === undefined || temp === null || temp <= -100 || temp > 60;
  const ph = reading.ph;
  const phBad = ph === undefined || ph === null || ph < 0 || ph > 14;

  const temperature = tempBad
    ? { level: LEVEL.ERROR, reason: "Temperature sensor is disconnected or giving invalid values." }
    : evalRange(temp, profile.tempMin, profile.tempMax, MARGINS.temperature, "°C", "Water temperature");

  const phResult = phBad
    ? { level: LEVEL.ERROR, reason: "pH sensor is disconnected or needs calibration." }
    : evalRange(ph, profile.phMin, profile.phMax, MARGINS.ph, "", "pH level");

  let waterLevel;
  const lvl = reading.waterLevel;
  if (lvl === undefined || lvl === null || lvl < 0) {
    waterLevel = { level: LEVEL.ERROR, reason: "Water level sensor has no valid reading." };
  } else if (lvl >= profile.levelMinPct) {
    waterLevel = { level: LEVEL.NORMAL, reason: `Water level is ${lvl}% (minimum ${profile.levelMinPct}%).` };
  } else {
    waterLevel = {
      level: lvl < profile.levelCriticalPct ? LEVEL.CRITICAL : LEVEL.WARNING,
      direction: "low",
      reason: `Water level is low (${lvl}%); keep it at least ${profile.levelMinPct}%.`,
    };
  }

  const params = { temperature, ph: phResult, waterLevel };
  const overall = Object.values(params).reduce(
    (worst, p) => (RANK[p.level] > RANK[worst] ? p.level : worst),
    LEVEL.NORMAL
  );
  // "error" counts as a warning for the overall badge
  return { overall: overall === LEVEL.ERROR ? LEVEL.WARNING : overall, params };
}

/** Key that identifies the current problem set; used to avoid repeated AI calls for the same issue. */
export function problemKey(evaluation) {
  if (!evaluation) return "";
  return Object.entries(evaluation.params)
    .filter(([, p]) => p.level !== LEVEL.NORMAL)
    .map(([k, p]) => `${k}:${p.level}:${p.direction || ""}`)
    .sort()
    .join("|");
}

const DISCLAIMER =
  "These are basic aquarium care suggestions only and do not replace advice from a veterinarian or aquatic specialist.";

const RULES = {
  temperature: {
    high: {
      causes: ["Heater set too high or stuck on", "Hot room or direct sunlight on the tank", "Lights left on for too long"],
      actions: [
        "Check the heater setting and unplug it if it is stuck on.",
        "Move the tank away from direct sunlight and improve room ventilation.",
        "Float a sealed bag of cool (not ice-cold) water or do a 10–20% water change with slightly cooler, conditioned water.",
        "Lower the temperature gradually — no more than 1–2°C per hour.",
        "Increase aeration because warm water holds less oxygen.",
      ],
    },
    low: {
      causes: ["Heater off, broken, or too small for the tank", "Cold room temperature", "Large water change with cold water"],
      actions: [
        "Check that the heater is plugged in and working; set it to the fish's ideal temperature.",
        "Cover the tank to reduce heat loss.",
        "Raise the temperature gradually — no more than 1–2°C per hour.",
        "Use water at the same temperature as the tank for water changes.",
      ],
    },
  },
  ph: {
    high: {
      causes: ["Alkaline tap water", "Limestone, coral, or shells in the tank", "Low carbon dioxide"],
      actions: [
        "Re-check pH with a test kit to confirm the reading.",
        "Do a 10–20% water change with conditioned water of the correct pH.",
        "Remove rocks or decorations that may raise pH (limestone, coral, shells).",
        "Adjust pH slowly — no more than 0.2–0.3 per day; avoid large chemical doses.",
      ],
    },
    low: {
      causes: ["Build-up of waste and organic matter", "Overfeeding", "Old water that has not been changed", "Driftwood releasing tannins"],
      actions: [
        "Re-check pH with a test kit to confirm the reading.",
        "Do a 10–25% water change and vacuum the gravel to remove waste.",
        "Reduce feeding and remove uneaten food.",
        "Clean or check the filter, and adjust pH slowly over several days.",
      ],
    },
  },
  waterLevel: {
    low: {
      causes: ["Evaporation", "Leak in the tank or filter tubing", "Water removed and not refilled"],
      actions: [
        "Top up with dechlorinated water at the same temperature as the tank.",
        "Check the tank, seals, and filter hoses for leaks.",
        "Make sure the filter intake and heater stay fully under water.",
      ],
    },
  },
  error: {
    causes: ["Loose or disconnected sensor wire", "Sensor not calibrated", "Sensor damaged"],
    actions: [
      "Check the sensor wiring and connections to the ESP32.",
      "Re-calibrate the sensor (pH: use pH 4.0 and 6.86/7.0 buffer solutions).",
      "Measure manually with a thermometer or test kit until the sensor is fixed.",
    ],
  },
};

const NAMES = { temperature: "Water temperature", ph: "pH level", waterLevel: "Water level" };

/**
 * Rule-based recommendation in the same structure the AI returns.
 */
export function ruleRecommendations(evaluation, profile) {
  if (!evaluation) return null;
  const problems = Object.entries(evaluation.params).filter(([, p]) => p.level !== LEVEL.NORMAL);
  if (problems.length === 0) {
    return {
      condition: `All monitored conditions are suitable for ${profile?.name || "your fish"}.`,
      possible_causes: [],
      recommended_actions: ["Continue regular monitoring, feeding, and weekly partial water changes."],
      urgency: "low",
      disclaimer: DISCLAIMER,
      source: "rules",
    };
  }
  const causes = [];
  const actions = [];
  for (const [key, p] of problems) {
    const rule = p.level === LEVEL.ERROR ? RULES.error : RULES[key]?.[p.direction];
    if (!rule) continue;
    rule.causes.forEach((c) => causes.push(`${NAMES[key]}: ${c}`));
    rule.actions.forEach((a) => !actions.includes(a) && actions.push(a));
  }
  return {
    condition: problems.map(([, p]) => p.reason).join(" "),
    possible_causes: causes,
    recommended_actions: actions,
    urgency: evaluation.overall === LEVEL.CRITICAL ? "high" : "medium",
    disclaimer: DISCLAIMER,
    source: "rules",
  };
}

export { DISCLAIMER };

// =====================================================================
//  AI support helpers (trend prediction, statistics, rule-based fallbacks)
// =====================================================================

const PARAMS = {
  temperature: { label: "Water temperature", unit: "°C", minKey: "tempMin", maxKey: "tempMax", noise: 0.1, digits: 1 },
  ph: { label: "pH level", unit: "", minKey: "phMin", maxKey: "phMax", noise: 0.02, digits: 2 },
  waterLevel: { label: "Water level", unit: "%", minKey: "levelMinPct", maxKey: null, noise: 0.5, digits: 0 },
};

const isValid = (key, v) =>
  typeof v === "number" && !Number.isNaN(v) &&
  (key === "temperature" ? v > -100 && v < 60 : key === "ph" ? v >= 0 && v <= 14 : v >= 0);

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * Early warning: fits a straight line (least squares) through recent readings and
 * projects it forward. Flags a parameter when it is still in range now but is
 * expected to cross its limit within `horizonHours`.
 * @param {Array<{ts:number, temperature:number, ph:number, waterLevel:number}>} history any order
 */
export function predictTrend(history, profile, { horizonHours = 3, windowHours = 2 } = {}) {
  if (!Array.isArray(history) || !profile) return { params: {}, risks: [] };
  const rows = [...history].filter((r) => r && r.ts).sort((a, b) => a.ts - b.ts);
  if (!rows.length) return { params: {}, risks: [] };
  const lastTs = rows[rows.length - 1].ts;
  const recent = rows.filter((r) => r.ts >= lastTs - windowHours * 3600e3);

  const params = {};
  const risks = [];
  for (const [key, cfg] of Object.entries(PARAMS)) {
    const pts = recent.filter((r) => isValid(key, r[key])).map((r) => ({ x: (r.ts - lastTs) / 3600e3, y: r[key] }));
    const span = pts.length ? pts[pts.length - 1].x - pts[0].x : 0;
    if (pts.length < 6 || span < 1 / 3) {
      params[key] = { trend: "unknown", risk: false, message: `Not enough recent ${cfg.label.toLowerCase()} data to predict.` };
      continue;
    }
    const n = pts.length;
    const mx = pts.reduce((s, p) => s + p.x, 0) / n;
    const my = pts.reduce((s, p) => s + p.y, 0) / n;
    const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
    const slope = sxx ? pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx : 0; // units per hour
    const now = my + slope * (0 - mx); // fitted value at the latest reading
    const projected = now + slope * horizonHours;
    const trend = Math.abs(slope) < cfg.noise ? "stable" : slope > 0 ? "rising" : "falling";

    const min = profile[cfg.minKey];
    const max = cfg.maxKey ? profile[cfg.maxKey] : undefined;
    const inRange = now >= min && (max === undefined || now <= max);
    let hoursToLimit = null;
    let limit = null;
    if (inRange && trend === "rising" && max !== undefined) { hoursToLimit = (max - now) / slope; limit = max; }
    if (inRange && trend === "falling") { hoursToLimit = (min - now) / slope; limit = min; }
    const risk = hoursToLimit !== null && hoursToLimit >= 0 && hoursToLimit <= horizonHours;

    const rate = `${round(Math.abs(slope), cfg.digits === 0 ? 1 : cfg.digits)}${cfg.unit}/hour`;
    let message;
    if (!inRange) message = `${cfg.label} is already outside the acceptable range.`;
    else if (risk) {
      const when = hoursToLimit < 1 ? `${Math.max(5, Math.round(hoursToLimit * 60))} minutes` : `${round(hoursToLimit, 1)} hours`;
      message = `${cfg.label} is ${trend} about ${rate} and may reach the ${trend === "rising" ? "upper" : "lower"} limit (${limit}${cfg.unit}) in about ${when}.`;
    } else if (trend === "stable") message = `${cfg.label} is stable.`;
    else message = `${cfg.label} is ${trend} slowly (${rate}) but should stay in range for the next ${horizonHours} hours.`;

    params[key] = {
      trend, risk, alreadyOut: !inRange,
      slopePerHour: round(slope, 3), current: round(now, cfg.digits), projected: round(projected, cfg.digits),
      hoursToLimit: hoursToLimit === null ? null : round(hoursToLimit, 2), limit, message,
    };
    if (risk) risks.push({ param: key, ...params[key] });
  }
  return { params, risks, horizonHours, basedOn: recent.length };
}

/** Min / max / average and % of time in range for each parameter. */
export function summarizeHistory(history, profile) {
  const out = { count: history?.length || 0 };
  for (const [key, cfg] of Object.entries(PARAMS)) {
    const vals = (history || []).map((r) => r[key]).filter((v) => isValid(key, v));
    if (!vals.length) { out[key] = null; continue; }
    const min = Math.min(...vals), max = Math.max(...vals);
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    let inRange = null;
    if (profile) {
      const lo = profile[cfg.minKey], hi = cfg.maxKey ? profile[cfg.maxKey] : Infinity;
      inRange = Math.round((vals.filter((v) => v >= lo && v <= hi).length / vals.length) * 100);
    }
    out[key] = { min: round(min, cfg.digits), max: round(max, cfg.digits), avg: round(avg, cfg.digits), pctInRange: inRange, samples: vals.length };
  }
  const pcts = ["temperature", "ph", "waterLevel"].map((k) => out[k]?.pctInRange).filter((v) => v !== null && v !== undefined);
  out.stabilityScore = pcts.length ? Math.round(pcts.reduce((s, v) => s + v, 0) / pcts.length) : null;
  return out;
}

/** Rule-based daily report (fallback when the AI is unavailable). */
export function ruleDailyReport({ stats, alerts = [], feedings = [], profile, schedule }) {
  const name = profile?.name || "your fish";
  const score = stats?.stabilityScore;
  const highlights = [];
  const concerns = [];
  for (const [key, cfg] of Object.entries(PARAMS)) {
    const s = stats?.[key];
    if (!s) { concerns.push(`No valid ${cfg.label.toLowerCase()} readings were recorded.`); continue; }
    const txt = `${cfg.label}: ${s.min}–${s.max}${cfg.unit} (average ${s.avg}${cfg.unit}), within range ${s.pctInRange}% of the time.`;
    (s.pctInRange >= 95 ? highlights : concerns).push(txt);
  }
  const scheduled = (schedule?.times || "").split(",").filter(Boolean).length;
  const done = feedings.filter((f) => f.success !== false).length;
  highlights.push(`${done} feeding(s) recorded${scheduled ? ` (${scheduled} scheduled per day)` : ""}.`);
  if (scheduled && feedings.filter((f) => f.type === "scheduled").length < scheduled) {
    concerns.push("Fewer scheduled feedings were logged than planned. Check the feeder and device power.");
  }
  if (alerts.length) concerns.push(`${alerts.length} alert(s) were raised today.`);
  const tips = ["Do a 10–25% partial water change each week.", "Test water with a liquid kit weekly to confirm sensor accuracy."];
  if (concerns.some((c) => c.startsWith("pH"))) tips.unshift("Remove uneaten food and vacuum the gravel to help keep pH stable.");
  if (concerns.some((c) => c.startsWith("Water temperature"))) tips.unshift("Check the heater and keep the tank out of direct sunlight.");
  if (concerns.some((c) => c.startsWith("Water level"))) tips.unshift("Top up evaporated water with dechlorinated water.");
  return {
    headline: score === null ? "Not enough data today" : score >= 95 ? `Stable day for ${name}` : score >= 80 ? `Mostly stable day for ${name}` : `Unstable conditions for ${name}`,
    summary: score === null
      ? "The device sent too few readings today to assess the aquarium."
      : `Conditions were within the acceptable range ${score}% of the time on average across temperature, pH, and water level.`,
    highlights, concerns, tips: tips.slice(0, 4), stabilityScore: score, source: "rules",
  };
}

/** Evenly spaced feeding times between 08:00 and 18:00. */
export function spreadTimes(count) {
  const n = Math.max(1, Math.min(4, count));
  if (n === 1) return ["08:00"];
  return Array.from({ length: n }, (_, i) => {
    const m = 8 * 60 + Math.round((i * 10 * 60) / (n - 1));
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  });
}

/** Rule-based feeding advice (fallback when the AI is unavailable). */
export function ruleFeedingAdvice({ profile, feeding, feedings = [], stats, trend }) {
  const perDay = profile?.feedsPerDay || 2;
  const current = (feeding?.times || "").split(",").map((t) => t.trim()).filter(Boolean);
  const portions = Number(feeding?.portions || 1);
  const reasons = [];
  const cautions = [];
  let suggestedPortions = portions;
  let suggestedTimes = current.length === perDay ? current : spreadTimes(perDay);

  if (current.length !== perDay) reasons.push(`${profile?.name || "This fish"} usually does well with ${perDay} small feedings per day.`);
  else reasons.push(`The current ${perDay} feedings per day suit ${profile?.name || "this fish"}.`);

  const phLow = stats?.ph && profile && stats.ph.avg < profile.phMin + 0.2;
  const phFalling = trend?.params?.ph?.trend === "falling";
  if ((phLow || phFalling) && portions > 1) {
    suggestedPortions = portions - 1;
    reasons.push("pH is low or falling, which can be caused by leftover food, so a smaller portion is suggested.");
  }
  const manual = feedings.filter((f) => f.type === "manual").length;
  if (manual > feedings.length / 2 && feedings.length >= 4) cautions.push("Many manual feedings were logged. Avoid feeding in addition to the schedule to prevent overfeeding.");
  cautions.push("Feed only what the fish finish in about 2 minutes and remove uneaten food.");
  if (suggestedPortions > (profile?.portionsPerFeed || 2)) cautions.push("Portions look large for this fish; watch for leftover food.");

  return {
    assessment: suggestedTimes.join(",") === current.join(",") && suggestedPortions === portions
      ? "The current feeding schedule looks suitable."
      : "A small adjustment to the feeding schedule is suggested.",
    suggested_times: suggestedTimes,
    suggested_portions: suggestedPortions,
    reasons, cautions, source: "rules",
  };
}
