# SmartTank: An IoT and AI-Integrated System for Aquarium Water Quality Monitoring, Care Recommendation, and Scheduled Feeding

Capstone prototype · BS Information Technology · Our Lady of Fatima University

A single small-to-medium aquarium is monitored by an **ESP32** (water temperature, pH, water level).
Readings go to **Firebase Realtime Database**. **Cloud Functions** check them against the selected
**fish profile**, open alerts, and ask **Claude (AI)** for basic care recommendations, with a
**rule-based fallback** if the AI isn't available. A **servo feeder** dispenses controlled portions on a schedule.
Everything is viewed and controlled from a **React web dashboard**.

```
 DS18B20 ─┐                     ┌──────────── Firebase ────────────┐
 pH  ─────┼─► ESP32 ── Wi-Fi ──►│ Realtime DB  ◄──► Cloud Functions │──► Claude API
 JSN-SR04T┘   │  ▲              │  (live, history,   (evaluate,     │
 Servo feeder ◄┘  │ DS3231 RTC  │   logs, settings)   alerts, AI)   │
 LCD + buzzer ◄───┘             └──────────────▲───────────────────┘
                                               │
                                     React web dashboard (phone / laptop)
```

## Folder structure

| Folder | What it contains |
|---|---|
| `firmware/` | ESP32 code (PlatformIO **or** Arduino IDE — open `firmware/SmartAquarium/SmartAquarium.ino`) |
| `functions/` | Firebase Cloud Functions + shared evaluation/rules logic (`src/logic.js`) + unit tests |
| `web/` | React dashboard (Vite), also packaged as an Android app with Capacitor (see MOBILE.md) + device simulator (`scripts/simulator.mjs`) |
| `database/` | Security rules and seed data (fish profiles, default schedule) |

## Modules ↔ objectives

| Objective | Where it lives |
|---|---|
| Environmental monitoring (temp, pH, water level) | `firmware/SmartAquarium/sensors.cpp`, dashboard **Dashboard** page |
| Predefined acceptable ranges per fish type | `database/seed.json` profiles, `functions/src/logic.js` → `evaluateReading()`, **Settings** page |
| AI-assisted care recommendation | `functions/src/index.js` (`onLiveReading`, `requestRecommendation`), **AI Care** page |
| AI chat assistant, early warning, daily report, feeding advice | `functions/src/index.js`, `functions/src/logic.js`, **Assistant**, **Dashboard**, **Reports**, **Feeding** pages (see section 6) |
| Automated feeding | `firmware/.../feeder.cpp` + schedule in `SmartAquarium.ino`, **Feeding** page |
| Digital monitoring interface | `web/src/pages/*` |
| Recording & evaluation | `/history`, `/feedingLogs` in the database, **History** page with CSV export |

---

## 1. Bill of materials (estimated PHP prices, 2026 — check local shops/Shopee/Lazada)

| Qty | Component | Est. price |
|---|---|---|
| 1 | ESP32 DevKit V1 (30/38-pin) | ₱350–450 |
| 1 | DS18B20 waterproof temperature probe + 4.7 kΩ resistor | ₱120–180 |
| 1 | Analog pH sensor kit PH-4502C + E-201 probe | ₱650–900 |
| 1 | pH buffer powder/solution (4.00 and 6.86) | ₱100–200 |
| 1 | JSN-SR04T waterproof ultrasonic sensor | ₱250–350 |
| 1 | SG90 (light food) or MG996R (stronger) servo | ₱80–300 |
| 1 | DS3231 RTC module + CR2032 | ₱120–180 |
| 1 | 16×2 LCD with I2C backpack | ₱150–200 |
| 1 | Active buzzer 5V | ₱20–40 |
| 1 | 5V 2–3A power supply + DC jack / buck converter | ₱200–350 |
| — | Resistors (10 kΩ ×2, 20 kΩ ×2), breadboard/PCB, jumper wires, project box | ₱200–400 |
| — | Feeder container (PVC / 3D-printed drum / bottle cap rotor) | ₱100–300 |
| | **Estimated total** | **₱2,300–3,800** |

## 2. Wiring (ESP32 DevKit V1)

| Component pin | ESP32 pin | Notes |
|---|---|---|
| DS18B20 VCC / GND / DATA | 3V3 / GND / **GPIO4** | 4.7 kΩ between DATA and 3V3 |
| PH-4502C V+ / G / **Po** | 5V / GND / **GPIO34** | **Po through a divider**: Po → 10 kΩ → GPIO34 → 20 kΩ → GND (5 V → 3.3 V) |
| JSN-SR04T 5V / GND / TRIG | 5V / GND / **GPIO5** | |
| JSN-SR04T ECHO | **GPIO18** | **Divider**: ECHO → 10 kΩ → GPIO18 → 20 kΩ → GND |
| Servo signal / V+ / GND | **GPIO13** / 5V supply / GND | Power the servo from the 5V supply, **not** the ESP32 3V3 pin |
| Buzzer + / − | **GPIO25** / GND | Use an NPN transistor if the buzzer draws > 20 mA |
| LCD I2C SDA / SCL | **GPIO21 / GPIO22** | Address usually 0x27 (sometimes 0x3F — change `LCD_ADDRESS`) |
| DS3231 SDA / SCL | **GPIO21 / GPIO22** | Shares the I2C bus with the LCD |

Important:
- All grounds (ESP32, servo supply, sensors) must be connected together.
- Use only **ADC1 pins (GPIO32–39)** for the pH sensor; ADC2 doesn't work while Wi-Fi is on.
- The JSN-SR04T can't measure closer than about **20–25 cm**. Mount it at least 25 cm above the highest water line (e.g., on a bracket or the tank lid). For very small tanks, a non-contact capacitive sensor or float switch is an alternative.
- Keep the pH probe tip wet (storage solution) and never let it dry out.

## 3. Firebase setup (do this first)

1. Create a project at <https://console.firebase.google.com>.
2. **Build → Realtime Database → Create database** (choose Singapore `asia-southeast1`). Start in *locked mode*.
3. **Build → Authentication → Sign-in method → Email/Password → Enable.** Then **Users → Add user** twice:
   - owner account (e.g. `owner@yourmail.com`), used for the dashboard login
   - device account (e.g. `device@smartaquarium.local`), used by the ESP32 and the simulator
4. **Realtime Database → ⋮ → Import JSON →** `database/seed.json` (loads fish profiles, default schedule and settings).
5. **Project settings → General → Add app → Web** to get the web config values.
6. Install the CLI and deploy the rules:
   ```bash
   npm install -g firebase-tools
   firebase login
   cp .firebaserc.example .firebaserc      # put your project id inside
   firebase deploy --only database
   ```

### Cloud Functions (alerts + AI)
Cloud Functions require the **Blaze (pay-as-you-go)** plan. It needs a card, but a capstone easily stays inside the free monthly quota. Set a budget alert of ₱100 in Google Cloud Billing to be safe.
> Without Blaze, the system still works: the dashboard evaluates readings and shows **rule-based** recommendations by itself. You only lose server-side alerts and the Claude AI recommendations.

```bash
cd functions
npm install
npm test                                       # runs the evaluation/rules unit tests
firebase functions:secrets:set ANTHROPIC_API_KEY   # paste the key from console.anthropic.com
firebase deploy --only functions
```
The model can be changed with the `ANTHROPIC_MODEL` parameter (default `claude-haiku-4-5`, fast and cheap). Check the current model names at <https://docs.claude.com/en/docs/about-claude/models>.

## 4. Web dashboard

```bash
cd web
cp .env.example .env        # fill in the Firebase web config + device account for the simulator
npm install
npm run dev                 # open the shown http://localhost:5173 link
```
Deploy it online (optional): `npm run build` then `firebase deploy --only hosting` from the project root.

Pages: **Dashboard** (live cards, status, early warning forecast, alerts, latest recommendation, feeding summary) · **AI Care** (recommendation history + "Analyze current condition") · **Assistant** (AI chat) · **Feeding** (AI feeding advice, schedule, portions, Feed Now, log) · **History** (charts with range lines, tables, CSV export) · **Reports** (daily AI reports) · **Settings** (fish profile, ranges, feedings per day, tank size, notifications).

### Demo without hardware
```bash
cd web
npm run simulate            # normal readings
npm run simulate -- hot     # temperature climbs → warning → critical → AI recommendation
npm run simulate -- acid    # pH drops
npm run simulate -- low     # water level drops
npm run simulate -- drift   # slow temperature rise → early warning before the limit
```
The simulator also answers **Feed Now**, so the whole system can be tested before the sensors arrive.

### Android app (APK)
The dashboard is also packaged as an Android app with Capacitor. See **[MOBILE.md](MOBILE.md)**. The easiest route is the included GitHub Actions workflow (`.github/workflows/android-apk.yml`), which builds `SmartTank-debug.apk` in the cloud. The dashboard can also be installed from Chrome as a web app (PWA).

## 5. ESP32 firmware

**Arduino IDE:** Install the ESP32 board package (Boards Manager → "esp32 by Espressif"). Then install these libraries from Library Manager: *OneWire*, *DallasTemperature*, *ESP32Servo*, *Firebase Arduino Client Library for ESP8266 and ESP32* (by Mobizt), *LiquidCrystal I2C*, and *RTClib*. Open `firmware/SmartAquarium/SmartAquarium.ino`, select **ESP32 Dev Module**, and upload.

**PlatformIO (VS Code):** open the `firmware/` folder → Upload. The libraries install automatically.

Before uploading, edit `firmware/SmartAquarium/config.h`: Wi-Fi, Firebase API key, database URL, device email and password. You can also change the pins and tank defaults there.

### pH calibration (do this before testing)
1. Open Serial Monitor at 115200 baud with line ending set to **Newline**.
2. Rinse the probe, put it in the **pH 6.86/7.0** buffer, wait 1–2 min, and type `cal7`.
3. Rinse, put it in the **pH 4.0** buffer, wait, and type `cal4`.
4. Type `ph` to check. Calibration is saved in flash and survives restarts.
Other commands: `read`, `feed`, `times`.

### How the firmware behaves
- Sensors are read every 10 s, using the median/trimmed mean of multiple samples to reduce noise.
- `/live` is updated every 30 s, and a row is added to `/history` every 60 s.
- Settings, fish profile, and schedule are downloaded every 30 s and **cached in flash**. The DS3231 keeps time, so **scheduled feeding still works without Wi-Fi**.
- Each schedule slot feeds once (no double feeding). Feed Now is checked every 3 s. Every feeding is logged.
- The LCD alternates between readings and status, and the buzzer beeps on **CRITICAL**.

## 6. AI functions

All AI features use the **Claude API** from Cloud Functions, so the API key never reaches the device or the browser. Each one has a **rule-based fallback**, so the system keeps working when the API key isn't set, the internet is down, or the AI's reply can't be parsed. Every AI output is labeled *AI-assisted* or *Rule-based* and carries a disclaimer.

| # | Feature | Where the owner sees it | Cloud Function | How it works |
|---|---|---|---|---|
| 1 | **Care recommendation** | Dashboard, AI Care | `onLiveReading` (auto), `requestRecommendation` | When a reading turns Warning/Critical, Claude gets the readings, fish profile, forecast and recent history. It returns the condition, possible causes, actions and urgency as JSON. It runs at most once per 30 min for the same problem. |
| 2 | **Chat assistant ("AquaBuddy")** | Assistant page | `askAssistant` | The owner asks free-form questions. Each question is sent with the live data, 24 h statistics, forecast, feeding log and alerts. The last 8 chat turns are kept for follow-up questions. The limit is 30 questions per user per hour, and every exchange is logged in `chatLogs` for evaluation. |
| 3 | **Early warning (trend prediction)** | Dashboard "Early warning" card, alerts | `onLiveReading` + `predictTrend()` | Fits a least-squares line through the last 2 hours of readings and projects 3 hours ahead. If a value that is still normal is expected to cross its limit, it raises an "Early warning" alert. The forecast also goes into the AI prompts for features 1, 2, 4 and 5. |
| 4 | **Daily summary report** | Reports page | `dailyReport` (8:00 PM PH time), `generateReportNow` | 24 h min/max/average and % time in range, alerts, feedings and forecast → Claude writes a headline, summary, highlights, concerns and tips. The stability score is the average % of time in range. |
| 5 | **Feeding advice** | Feeding page | `feedingAdvice` | Fish profile (typical feedings per day), current schedule, 7-day feeding log, 3-day water quality → suggested times and portions with reasons. Times and portions are validated: HH:MM format, 1–5 portions. **Nothing changes until the owner presses "Use this suggestion" and then "Save schedule".** |

**Model:** `ANTHROPIC_MODEL` parameter (default `claude-haiku-4-5`).
**Prompts:** `RECOMMENDATION_PROMPT`, `ASSISTANT_PROMPT`, `REPORT_PROMPT` and `FEEDING_PROMPT` in `functions/src/index.js`. They all share `SAFETY_RULES`: basic care only, no disease diagnosis or medicine, gradual changes, flag sensor errors, and never invent readings.
**Fallbacks:** `ruleRecommendations`, `ruleDailyReport` and `ruleFeedingAdvice` in `functions/src/logic.js`. The assistant falls back to a status summary.
**Demo:** `npm run simulate -- drift` raises the temperature slowly (about 2.4 °C/hour), so the early warning appears before the reading goes out of range.

## 7. Database structure

```
aquarium/
  settings/         fishProfileId, feeding{enabled,times:"08:00,18:00",portions}, tank{sensorToBottomCm,fullWaterCm}, notifications
  profiles/{id}/    name, tempMin, tempMax, phMin, phMax, levelMinPct, levelCriticalPct, notes
  live/             temperature, ph, waterLevel, waterCm, phVoltage, ts, rssi, localStatus, firmware
  history/{push}/   temperature, ph, waterLevel, waterCm, phVoltage, ts
  status/           overall, params{temperature,ph,waterLevel}{level,reason}, ts       (written by functions)
  alerts/{push}/    ts, type(condition|offline), level, message, resolved
  recommendations/{push}/  condition, possible_causes[], recommended_actions[], urgency, disclaimer, source(ai|rules), reading, ts
  latestRecommendation/
  feedingLogs/{push}/ ts, type(scheduled|manual), portions, success, slot
  prediction/        params{temperature,ph,waterLevel}{trend,risk,slopePerHour,projected,hoursToLimit,message}, risks[], ts
  reports/{YYYY-MM-DD}/ headline, summary, highlights[], concerns[], tips[], stabilityScore, stats, source, ts
  feedingAdvice/     assessment, suggested_times[], suggested_portions, reasons[], cautions[], source, ts
  chatLogs/{push}/   ts, uid, question, answer, source      (for evaluating the assistant)
  aiUsage/{uid}/{hour}  chat question counter (rate limit)
  commands/feedNow/  requested, portions, requestedAt, doneAt
  aiState/           internal: lastKey, lastAiKey, lastAiAt, openAlertId, predKey, predAlertId, offlineAlertId
```

**Status rules** (`functions/src/logic.js`, used by both the backend and the dashboard):
- Inside the range → **Normal**
- Outside by ≤ 1.5 °C (temp) or ≤ 0.3 (pH) → **Warning**
- Further outside → **Critical**
- Water level below `levelMinPct` → **Warning**; below `levelCriticalPct` → **Critical**
- Invalid values, such as DS18B20 −127 → **Sensor error**

The AI is only called when a **new** problem appears, or at most every 30 min for the same problem, to keep the cost low.

## 8. Evaluation guide (functionality, accuracy, reliability, usability)

| Test | How | Metric |
|---|---|---|
| Functionality | One test case per feature (each page, each alert type, Feed Now, schedule, offline feeding, CSV export) | Pass/Fail per case |
| Temperature accuracy | Compare with a reference digital thermometer at 3+ temperatures, 10 readings each | Mean absolute error (MAE), % accuracy = 100 − (MAE/ref × 100) |
| pH accuracy | Measure buffers 4.00, 6.86, 9.18 (and tank water vs. test kit) | MAE in pH units |
| Water level accuracy | Compare with a ruler at 5 water depths | MAE in cm / % |
| Feeding consistency | Dispense 20 portions and weigh each on a 0.01 g scale | Mean, standard deviation, coefficient of variation |
| Schedule reliability | Run for 72 h and compare scheduled vs. logged feedings (also with Wi-Fi off) | % on-time feedings |
| Monitoring reliability | Run for 72 h and compare expected vs. received history rows | Uptime %, data completeness % |
| AI recommendation relevance | Simulate hot/acid/low cases and have an aquarist rate the recommendations | Likert mean |
| Early-warning accuracy | Run `simulate -- drift` and real heating/evaporation tests; compare predicted vs. actual time the limit was crossed | Lead time (min), mean error (min), false alarms |
| Chat assistant quality | Ask 20 standard questions; an aquarist rates each answer for correctness, relevance and safety (answers are in `chatLogs`) | Likert mean per criterion |
| Daily report accuracy | Compare report numbers with the exported CSV for the same day | % of statements matching the data |
| Feeding advice appropriateness | An aquarist rates suggestions for 3–5 fish profiles | Likert mean |
| Usability | ISO/IEC 25010 or SUS questionnaire with target users | Weighted mean / SUS score |

Export the readings and feeding log CSVs from the **History** page to compute these in Excel.

## Safety notes
- Keep electronics and the power supply away from water; use a drip loop on all cables.
- The AI only gives basic guidance and isn't a substitute for a veterinarian or aquatic specialist (shown on every recommendation).
- Never put the Anthropic API key in the firmware or the web app. It stays in Cloud Functions secrets only.
