/**
 * SmartTank — Firebase Cloud Functions
 *
 *  AI functions (Claude API, each with a rule-based fallback)
 *  ─────────────────────────────────────────────────────────
 *  1. Care recommendation   onLiveReading / requestRecommendation
 *                           A reading goes out of range → AI explains causes and basic actions.
 *  2. Chat assistant        askAssistant
 *                           Owner asks questions; AI answers using live data, trends and logs.
 *  3. Early warning         onLiveReading (trend prediction) + explained in chat/reports
 *                           Linear-regression forecast flags readings that will soon leave the range.
 *  4. Daily summary report  dailyReport (every day 8:00 PM PH time) / generateReportNow
 *  5. Feeding advice        feedingAdvice
 *                           Suggests a schedule and portion size; the owner decides whether to apply it.
 *
 *  Other
 *  ─────
 *  checkDeviceOffline       Every 5 minutes: alert if the device stopped sending data.
 */
import { onValueWritten } from "firebase-functions/v2/database";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import Anthropic from "@anthropic-ai/sdk";
import {
  evaluateReading, problemKey, ruleRecommendations, LEVEL, OFFLINE_AFTER_MS, DISCLAIMER,
  predictTrend, summarizeHistory, ruleDailyReport, ruleFeedingAdvice,
} from "./logic.js";

initializeApp();
const db = () => getDatabase();

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
// Check https://docs.claude.com/en/docs/about-claude/models for current model names.
const ANTHROPIC_MODEL = defineString("ANTHROPIC_MODEL", { default: "claude-haiku-4-5" });

const ROOT = "/aquarium";
const TIME_ZONE = "Asia/Manila";
const AI_MIN_INTERVAL_MS = 30 * 60 * 1000; // same problem → ask AI again at most every 30 min
const CHAT_LIMIT_PER_HOUR = 30;            // per user

// =====================================================================
//  Claude helpers
// =====================================================================
function client() {
  const apiKey = ANTHROPIC_API_KEY.value();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  return new Anthropic({ apiKey });
}

/** Calls Claude and returns plain text. `messages` = [{role:"user"|"assistant", content}] */
async function callClaude(system, messages, maxTokens = 700) {
  const msg = await client().messages.create({
    model: ANTHROPIC_MODEL.value(),
    max_tokens: maxTokens,
    system,
    messages,
  });
  return msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}

/** Calls Claude and parses the first JSON object in the reply. */
async function callClaudeJSON(system, userText, maxTokens = 900) {
  const text = await callClaude(system, [{ role: "user", content: userText }], maxTokens);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("AI reply was not JSON");
  return JSON.parse(text.slice(start, end + 1));
}

const strList = (v, max = 8) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, max) : []);

const SAFETY_RULES = `
- Give only BASIC, practical aquarium care guidance a hobbyist can safely do at home.
- Do not diagnose fish diseases or recommend medicines; suggest a veterinarian or aquatic specialist if fish look sick.
- Recommend gradual changes (temperature 1–2°C per hour, pH no more than 0.2–0.3 per day, water changes 10–25%).
- If a value looks like a sensor error (e.g. -127°C, pH below 0 or above 14), say so and suggest checking/calibrating the sensor.
- Use simple English and short sentences. Never invent readings that are not in the data.`;

// =====================================================================
//  Data loading
// =====================================================================
async function listSince(path, sinceMs, limit = 2000) {
  const snap = await db().ref(`${ROOT}/${path}`).orderByChild("ts").startAt(sinceMs).limitToLast(limit).get();
  const out = [];
  snap.forEach((c) => { out.push({ id: c.key, ...c.val() }); });
  return out;
}

/** Everything the AI functions need to know about the aquarium right now. */
async function loadContext({ historyHours = 24, feedDays = 7 } = {}) {
  const now = Date.now();
  const [settingsSnap, liveSnap, history, feedings, alerts] = await Promise.all([
    db().ref(`${ROOT}/settings`).get(),
    db().ref(`${ROOT}/live`).get(),
    listSince("history", now - historyHours * 3600e3),
    listSince("feedingLogs", now - feedDays * 24 * 3600e3, 200),
    listSince("alerts", now - 24 * 3600e3, 50),
  ]);
  const settings = settingsSnap.val() || {};
  const profile = settings.fishProfileId
    ? (await db().ref(`${ROOT}/profiles/${settings.fishProfileId}`).get()).val()
    : null;
  const reading = liveSnap.val();
  const evaluation = reading && profile ? evaluateReading(reading, profile) : null;
  const trend = profile ? predictTrend(history, profile) : { params: {}, risks: [] };
  const stats = summarizeHistory(history, profile);
  return { now, settings, profile, reading, evaluation, history, feedings, alerts, trend, stats };
}

const iso = (ts) => (ts ? new Date(ts).toLocaleString("en-PH", { timeZone: TIME_ZONE }) : null);

/** Compact, readable summary of the context for prompts. */
function contextForPrompt(ctx, { recentReadings = 12 } = {}) {
  const recent = ctx.history.slice(-recentReadings).map((r) => ({
    time: iso(r.ts), temperature: r.temperature, ph: r.ph, waterLevel: r.waterLevel,
  }));
  return {
    current_time: iso(ctx.now),
    fish_profile: ctx.profile,
    device_online: !!ctx.reading?.ts && ctx.now - ctx.reading.ts < OFFLINE_AFTER_MS,
    current_reading: ctx.reading && {
      time: iso(ctx.reading.ts), temperature_c: ctx.reading.temperature, ph: ctx.reading.ph, water_level_pct: ctx.reading.waterLevel,
    },
    status: ctx.evaluation && {
      overall: ctx.evaluation.overall,
      temperature: ctx.evaluation.params.temperature.reason,
      ph: ctx.evaluation.params.ph.reason,
      water_level: ctx.evaluation.params.waterLevel.reason,
    },
    trend_forecast_next_3h: Object.fromEntries(Object.entries(ctx.trend.params || {}).map(([k, v]) => [k, v.message])),
    last_24h_statistics: ctx.stats,
    recent_readings_oldest_first: recent,
    feeding_schedule: ctx.settings.feeding || null,
    feedings_last_7_days: ctx.feedings.slice(-20).map((f) => ({ time: iso(f.ts), type: f.type, portions: f.portions, success: f.success })),
    alerts_last_24h: ctx.alerts.map((a) => ({ time: iso(a.ts), level: a.level, message: a.message, resolved: !!a.resolved })),
  };
}

// =====================================================================
//  1. Care recommendation
// =====================================================================
const RECOMMENDATION_PROMPT = `You are an aquarium care assistant inside SmartTank, an IoT aquarium system for a single small to medium-sized home aquarium.
You receive the sensor readings (water temperature °C, pH, water level %), the selected fish profile with its acceptable ranges, a short-term forecast, recent readings, and feeding history.
Rules:${SAFETY_RULES}
- At most 6 actions, most important first.
Respond with ONLY a JSON object, no markdown:
{"condition": string, "possible_causes": string[], "recommended_actions": string[], "urgency": "low"|"medium"|"high"}`;

async function generateRecommendation(ctx, trigger) {
  let rec;
  try {
    const json = await callClaudeJSON(RECOMMENDATION_PROMPT, `Aquarium data:\n${JSON.stringify(contextForPrompt(ctx), null, 1)}`);
    rec = {
      condition: String(json.condition || ""),
      possible_causes: strList(json.possible_causes),
      recommended_actions: strList(json.recommended_actions, 6),
      urgency: ["low", "medium", "high"].includes(json.urgency) ? json.urgency : "medium",
      disclaimer: DISCLAIMER, source: "ai", model: ANTHROPIC_MODEL.value(),
    };
  } catch (err) {
    logger.warn("AI recommendation failed, using rules", { error: String(err) });
    rec = ruleRecommendations(ctx.evaluation, ctx.profile);
  }
  const entry = {
    ...rec, ts: Date.now(), trigger, overall: ctx.evaluation.overall, fishProfile: ctx.profile?.name || null,
    reading: { temperature: ctx.reading.temperature ?? null, ph: ctx.reading.ph ?? null, waterLevel: ctx.reading.waterLevel ?? null },
  };
  await db().ref(`${ROOT}/recommendations`).push(entry);
  await db().ref(`${ROOT}/latestRecommendation`).set(entry);
  return entry;
}

export const onLiveReading = onValueWritten(
  { ref: `${ROOT}/live`, secrets: [ANTHROPIC_API_KEY] },
  async (event) => {
    if (!event.data.after.exists()) return;
    const ctx = await loadContext({ historyHours: 3, feedDays: 1 });
    if (!ctx.profile || !ctx.reading) {
      logger.warn("No fish profile or reading; skipping evaluation");
      return;
    }
    const { evaluation } = ctx;
    const key = problemKey(evaluation);
    const now = Date.now();
    await db().ref(`${ROOT}/status`).set({ ...evaluation, problemKey: key, ts: now });

    const stateRef = db().ref(`${ROOT}/aiState`);
    const state = (await stateRef.get()).val() || {};

    // ---- condition alerts: open on a new problem, resolve when back to normal
    if (key !== (state.lastKey || "")) {
      if (state.openAlertId) await db().ref(`${ROOT}/alerts/${state.openAlertId}`).update({ resolved: true, resolvedAt: now });
      let openAlertId = null;
      if (key) {
        const problems = Object.values(evaluation.params).filter((p) => p.level !== LEVEL.NORMAL);
        const ref = await db().ref(`${ROOT}/alerts`).push({
          ts: now, type: "condition", level: evaluation.overall,
          message: problems.map((p) => p.reason).join(" "), resolved: false,
        });
        openAlertId = ref.key;
      }
      await stateRef.update({ lastKey: key, openAlertId });
    }

    // ---- 3. early warning: readings still OK but heading out of range
    await db().ref(`${ROOT}/prediction`).set({ ...ctx.trend, ts: now });
    // Only warn about parameters that are still normal right now (otherwise a condition alert already exists).
    const risks = ctx.trend.risks.filter((r) => evaluation.params[r.param]?.level === LEVEL.NORMAL);
    const predKey = risks.map((r) => `${r.param}:${r.trend}`).sort().join("|");
    if (predKey !== (state.predKey || "")) {
      if (state.predAlertId) await db().ref(`${ROOT}/alerts/${state.predAlertId}`).update({ resolved: true, resolvedAt: now });
      let predAlertId = null;
      if (predKey) {
        const ref = await db().ref(`${ROOT}/alerts`).push({
          ts: now, type: "prediction", level: "warning",
          message: `Early warning: ${risks.map((r) => r.message).join(" ")}`, resolved: false,
        });
        predAlertId = ref.key;
      }
      await stateRef.update({ predKey, predAlertId });
    }

    // ---- 1. AI recommendation for a new problem (or the same one after 30 min)
    if (!key) return;
    if (key === state.lastAiKey && now - (state.lastAiAt || 0) < AI_MIN_INTERVAL_MS) return;
    await stateRef.update({ lastAiKey: key, lastAiAt: now });
    await generateRecommendation(ctx, "auto");
  }
);

export const requestRecommendation = onCall({ secrets: [ANTHROPIC_API_KEY] }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Please log in.");
  const ctx = await loadContext({ historyHours: 3, feedDays: 1 });
  if (!ctx.profile || !ctx.reading) throw new HttpsError("failed-precondition", "No reading or fish profile yet.");
  return generateRecommendation(ctx, "manual");
});

// =====================================================================
//  2. Chat assistant
// =====================================================================
const ASSISTANT_PROMPT = `You are "AquaBuddy", the friendly assistant of SmartTank, an IoT aquarium system that monitors one home aquarium.
You can see the live sensor data, the selected fish profile and its acceptable ranges, a 3-hour trend forecast, 24-hour statistics, recent readings, the feeding schedule and log, and recent alerts. They are given to you as JSON with each question.
How to answer:
- Answer the owner's question directly in 2–6 short sentences or a short list. Use the actual numbers from the data when relevant.
- If asked "is my tank okay?" or similar, check temperature, pH, water level, the forecast, and the device status.
- If the data needed to answer is missing (e.g. no readings, device offline), say so plainly.
- You cannot control the device. For feeding or setting changes, tell the owner which dashboard page to use (Feeding or Settings).
- Only discuss aquarium and fish-keeping topics; politely redirect anything else.${SAFETY_RULES}`;

async function checkChatLimit(uid) {
  const hour = new Date().toISOString().slice(0, 13);
  const ref = db().ref(`${ROOT}/aiUsage/${uid}/${hour}`);
  const res = await ref.transaction((n) => (n || 0) + 1);
  return res.snapshot.val() <= CHAT_LIMIT_PER_HOUR;
}

function ruleAssistantAnswer(ctx) {
  if (!ctx.reading) return "I can't see any readings from the aquarium yet. Check that the device is powered on and connected to Wi-Fi.";
  const lines = [];
  if (ctx.evaluation) {
    const p = ctx.evaluation.params;
    lines.push(`Overall status: ${ctx.evaluation.overall.toUpperCase()}.`, p.temperature.reason, p.ph.reason, p.waterLevel.reason);
  }
  ctx.trend.risks.forEach((r) => lines.push(`Early warning: ${r.message}`));
  lines.push("(The AI assistant is unavailable right now, so this is an automatic status summary.)");
  return lines.join(" ");
}

export const askAssistant = onCall({ secrets: [ANTHROPIC_API_KEY] }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Please log in.");
  const question = String(req.data?.question || "").trim().slice(0, 500);
  if (!question) throw new HttpsError("invalid-argument", "Please type a question.");
  if (!(await checkChatLimit(req.auth.uid))) {
    throw new HttpsError("resource-exhausted", `You can ask up to ${CHAT_LIMIT_PER_HOUR} questions per hour. Please try again later.`);
  }

  // Previous turns from the page (kept short); must alternate user/assistant and start with user.
  const history = (Array.isArray(req.data?.history) ? req.data.history : [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));
  while (history.length && history[0].role !== "user") history.shift();
  const turns = [];
  for (const m of history) {
    if (turns.length && turns[turns.length - 1].role === m.role) turns[turns.length - 1] = m;
    else turns.push(m);
  }
  if (turns.length && turns[turns.length - 1].role === "user") turns.pop();

  const ctx = await loadContext();
  const data = JSON.stringify(contextForPrompt(ctx), null, 1);
  let answer, source = "ai";
  try {
    answer = await callClaude(ASSISTANT_PROMPT, [
      ...turns,
      { role: "user", content: `Current aquarium data:\n${data}\n\nOwner's question: ${question}` },
    ], 600);
  } catch (err) {
    logger.warn("Assistant AI failed, using rules", { error: String(err) });
    answer = ruleAssistantAnswer(ctx);
    source = "rules";
  }
  // Log the exchange (useful for evaluating the assistant in the study).
  await db().ref(`${ROOT}/chatLogs`).push({ ts: Date.now(), uid: req.auth.uid, question, answer, source });
  return { answer, source, disclaimer: DISCLAIMER };
});

// =====================================================================
//  4. Daily summary report
// =====================================================================
const REPORT_PROMPT = `You write the daily report of SmartTank, an IoT aquarium system for its owner.
You receive 24-hour statistics (min/max/average and % of time in the acceptable range for temperature, pH and water level), alerts, feedings, the feeding schedule, the trend forecast and the fish profile.
Rules:${SAFETY_RULES}
- Base every statement on the data. Mention specific numbers.
- highlights: what went well; concerns: anything out of range, missed feedings, alerts, sensor problems (empty list if none); tips: 2–4 practical tips for tomorrow.
Respond with ONLY a JSON object, no markdown:
{"headline": string (max 10 words), "summary": string (2-3 sentences), "highlights": string[], "concerns": string[], "tips": string[]}`;

const dateKey = (ts = Date.now()) => new Date(ts).toLocaleDateString("en-CA", { timeZone: TIME_ZONE }); // YYYY-MM-DD

async function buildDailyReport(trigger) {
  const ctx = await loadContext({ historyHours: 24, feedDays: 1 });
  const base = { stats: ctx.stats, alerts: ctx.alerts, feedings: ctx.feedings, profile: ctx.profile, schedule: ctx.settings.feeding };
  let report;
  try {
    const payload = {
      date: dateKey(), fish_profile: ctx.profile, last_24h_statistics: ctx.stats,
      alerts: ctx.alerts.map((a) => ({ time: iso(a.ts), level: a.level, type: a.type, message: a.message })),
      feedings: ctx.feedings.map((f) => ({ time: iso(f.ts), type: f.type, portions: f.portions, success: f.success })),
      feeding_schedule: ctx.settings.feeding || null,
      trend_forecast: Object.fromEntries(Object.entries(ctx.trend.params || {}).map(([k, v]) => [k, v.message])),
    };
    const json = await callClaudeJSON(REPORT_PROMPT, JSON.stringify(payload, null, 1));
    report = {
      headline: String(json.headline || "Daily aquarium report"),
      summary: String(json.summary || ""),
      highlights: strList(json.highlights), concerns: strList(json.concerns), tips: strList(json.tips, 4),
      stabilityScore: ctx.stats.stabilityScore, source: "ai", model: ANTHROPIC_MODEL.value(),
    };
  } catch (err) {
    logger.warn("AI report failed, using rules", { error: String(err) });
    report = ruleDailyReport(base);
  }
  const entry = {
    ...report, date: dateKey(), ts: Date.now(), trigger, fishProfile: ctx.profile?.name || null,
    stats: ctx.stats, alertCount: ctx.alerts.length, feedingCount: ctx.feedings.length, disclaimer: DISCLAIMER,
  };
  await db().ref(`${ROOT}/reports/${entry.date}`).set(entry);
  return entry;
}

export const dailyReport = onSchedule(
  { schedule: "every day 20:00", timeZone: TIME_ZONE, secrets: [ANTHROPIC_API_KEY] },
  async () => { await buildDailyReport("scheduled"); }
);

export const generateReportNow = onCall({ secrets: [ANTHROPIC_API_KEY] }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Please log in.");
  return buildDailyReport("manual");
});

// =====================================================================
//  5. Feeding advice
// =====================================================================
const FEEDING_PROMPT = `You advise the owner of a SmartTank IoT aquarium on the automatic feeder settings.
You receive the fish profile (including typical feeds per day), the current schedule (times "HH:MM" and portions per feeding, 1 portion = 1 turn of the feeder, max 5),
the feeding log for 7 days, water-quality statistics and the trend forecast.
Rules:${SAFETY_RULES}
- Prefer small, regular feedings; overfeeding pollutes water and lowers pH.
- Times must be between 06:00 and 21:00, at least 4 hours apart, 1–4 times per day, format "HH:MM".
- suggested_portions must be an integer 1–5. Keep the current settings if they are already suitable.
Respond with ONLY a JSON object, no markdown:
{"assessment": string, "suggested_times": string[], "suggested_portions": number, "reasons": string[], "cautions": string[]}`;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const feedingAdvice = onCall({ secrets: [ANTHROPIC_API_KEY] }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Please log in.");
  const ctx = await loadContext({ historyHours: 24 * 3, feedDays: 7 });
  if (!ctx.profile) throw new HttpsError("failed-precondition", "Select a fish profile first.");
  const base = { profile: ctx.profile, feeding: ctx.settings.feeding, feedings: ctx.feedings, stats: ctx.stats, trend: ctx.trend };
  let advice;
  try {
    const payload = {
      fish_profile: ctx.profile, current_schedule: ctx.settings.feeding || null,
      feeding_log_7_days: ctx.feedings.map((f) => ({ time: iso(f.ts), type: f.type, portions: f.portions, success: f.success })),
      water_quality_statistics: ctx.stats,
      trend_forecast: Object.fromEntries(Object.entries(ctx.trend.params || {}).map(([k, v]) => [k, v.message])),
    };
    const json = await callClaudeJSON(FEEDING_PROMPT, JSON.stringify(payload, null, 1));
    const times = [...new Set(strList(json.suggested_times, 4).map((t) => t.trim()).filter((t) => TIME_RE.test(t)))].sort();
    const portions = Math.round(Number(json.suggested_portions));
    if (!times.length || !(portions >= 1 && portions <= 5)) throw new Error("AI feeding advice out of bounds");
    advice = {
      assessment: String(json.assessment || ""), suggested_times: times, suggested_portions: portions,
      reasons: strList(json.reasons), cautions: strList(json.cautions), source: "ai", model: ANTHROPIC_MODEL.value(),
    };
  } catch (err) {
    logger.warn("AI feeding advice failed, using rules", { error: String(err) });
    advice = ruleFeedingAdvice(base);
  }
  const entry = { ...advice, ts: Date.now(), fishProfile: ctx.profile.name, disclaimer: DISCLAIMER };
  await db().ref(`${ROOT}/feedingAdvice`).set(entry);
  return entry;
});

// =====================================================================
//  Device offline check
// =====================================================================
export const checkDeviceOffline = onSchedule("every 5 minutes", async () => {
  const live = (await db().ref(`${ROOT}/live`).get()).val();
  const stateRef = db().ref(`${ROOT}/aiState`);
  const state = (await stateRef.get()).val() || {};
  const offline = !live || Date.now() - (live.ts || 0) > OFFLINE_AFTER_MS;

  if (offline && !state.offlineAlertId) {
    const ref = await db().ref(`${ROOT}/alerts`).push({
      ts: Date.now(), type: "offline", level: "warning",
      message: "The aquarium device has not sent data for more than 5 minutes. Check power and Wi-Fi.", resolved: false,
    });
    await stateRef.update({ offlineAlertId: ref.key });
  } else if (!offline && state.offlineAlertId) {
    await db().ref(`${ROOT}/alerts/${state.offlineAlertId}`).update({ resolved: true, resolvedAt: Date.now() });
    await stateRef.update({ offlineAlertId: null });
  }
});
