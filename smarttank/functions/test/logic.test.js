import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateReading, ruleRecommendations, problemKey } from "../src/logic.js";

const betta = {
  name: "Betta",
  tempMin: 24, tempMax: 28, phMin: 6.5, phMax: 7.5, levelMinPct: 85, levelCriticalPct: 70,
};

test("all normal", () => {
  const e = evaluateReading({ temperature: 26, ph: 7, waterLevel: 95 }, betta);
  assert.equal(e.overall, "normal");
  assert.equal(problemKey(e), "");
  assert.equal(ruleRecommendations(e, betta).urgency, "low");
});

test("temperature slightly high is warning", () => {
  const e = evaluateReading({ temperature: 29, ph: 7, waterLevel: 95 }, betta);
  assert.equal(e.params.temperature.level, "warning");
  assert.equal(e.params.temperature.direction, "high");
  assert.equal(e.overall, "warning");
});

test("temperature far out of range is critical", () => {
  const e = evaluateReading({ temperature: 32, ph: 7, waterLevel: 95 }, betta);
  assert.equal(e.overall, "critical");
  const r = ruleRecommendations(e, betta);
  assert.equal(r.urgency, "high");
  assert.ok(r.recommended_actions.length > 0);
});

test("low pH and low water combine", () => {
  const e = evaluateReading({ temperature: 26, ph: 6.0, waterLevel: 60 }, betta);
  assert.equal(e.params.ph.level, "critical");
  assert.equal(e.params.waterLevel.level, "critical");
  assert.equal(problemKey(e), "ph:critical:low|waterLevel:critical:low");
});

test("disconnected DS18B20 (-127) is a sensor error", () => {
  const e = evaluateReading({ temperature: -127, ph: 7, waterLevel: 95 }, betta);
  assert.equal(e.params.temperature.level, "error");
  assert.equal(e.overall, "warning");
});

import { predictTrend, summarizeHistory, ruleDailyReport, ruleFeedingAdvice, spreadTimes } from "../src/logic.js";

const series = (n, fn) => Array.from({ length: n }, (_, i) => ({ ts: 1_700_000_000_000 + i * 60_000, ...fn(i) }));

test("predictTrend warns before temperature crosses the limit", () => {
  // 60 readings over 1 h, rising 1.2 °C per hour from 26.0 → ~27.2
  const h = series(60, (i) => ({ temperature: 26 + (i / 60) * 1.2, ph: 7, waterLevel: 95 }));
  const p = predictTrend(h, betta);
  assert.equal(p.params.temperature.trend, "rising");
  assert.equal(p.params.temperature.risk, true);
  assert.ok(p.params.temperature.hoursToLimit > 0.4 && p.params.temperature.hoursToLimit < 1);
  assert.equal(p.params.ph.trend, "stable");
  assert.equal(p.risks.length, 1);
});

test("predictTrend: falling water level is flagged, stable data is not", () => {
  const h = series(60, (i) => ({ temperature: 26, ph: 7, waterLevel: 90 - i * 0.05 }));
  const p = predictTrend(h, betta);
  assert.equal(p.params.waterLevel.trend, "falling");
  assert.equal(p.params.waterLevel.risk, true);
  const flat = predictTrend(series(60, () => ({ temperature: 26, ph: 7, waterLevel: 95 })), betta);
  assert.equal(flat.risks.length, 0);
});

test("predictTrend needs enough data", () => {
  const p = predictTrend(series(3, () => ({ temperature: 26, ph: 7, waterLevel: 95 })), betta);
  assert.equal(p.params.temperature.trend, "unknown");
});

test("summarizeHistory computes stats and stability", () => {
  const h = series(10, (i) => ({ temperature: i < 8 ? 26 : 30, ph: 7, waterLevel: 95 }));
  const s = summarizeHistory(h, betta);
  assert.equal(s.temperature.pctInRange, 80);
  assert.equal(s.ph.pctInRange, 100);
  assert.equal(s.stabilityScore, 93);
  const r = ruleDailyReport({ stats: s, alerts: [{}], feedings: [], profile: betta, schedule: { times: "08:00,18:00" } });
  assert.ok(r.concerns.length >= 2);
  assert.equal(r.source, "rules");
});

test("feeding advice suggests spread times and smaller portions when pH is low", () => {
  assert.deepEqual(spreadTimes(2), ["08:00", "18:00"]);
  assert.deepEqual(spreadTimes(3), ["08:00", "13:00", "18:00"]);
  const stats = summarizeHistory(series(10, () => ({ temperature: 26, ph: 6.6, waterLevel: 95 })), betta);
  const a = ruleFeedingAdvice({ profile: { ...betta, feedsPerDay: 2 }, feeding: { times: "08:00", portions: 3 }, feedings: [], stats });
  assert.deepEqual(a.suggested_times, ["08:00", "18:00"]);
  assert.equal(a.suggested_portions, 2);
});
