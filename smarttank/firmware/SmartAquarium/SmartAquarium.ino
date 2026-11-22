/*
 * =====================================================================
 *  SmartTank: An IoT and AI-Integrated System for Aquarium Water Quality
 *  Monitoring, Care Recommendation, and Scheduled Feeding — ESP32 firmware
 * =====================================================================
 *  What this firmware does
 *   - Reads water temperature (DS18B20), pH (analog module), water level (JSN-SR04T)
 *   - Uploads live readings and history to Firebase Realtime Database
 *   - Downloads the selected fish profile, tank size and feeding schedule
 *   - Feeds on schedule (works offline using the cached schedule + RTC)
 *   - Responds to "Feed Now" from the dashboard and logs every feeding
 *   - Shows readings on a 16x2 LCD and beeps on critical conditions
 *
 *  Everything runs non-blocking with millis() timers.
 *
 *  Serial Monitor commands (115200 baud, "Newline"):
 *     cal7   - probe in pH 6.86/7.0 buffer, save calibration point
 *     cal4   - probe in pH 4.0 buffer, save calibration point
 *     ph     - show pH calibration and current voltage
 *     read   - print one full reading
 *     feed   - dispense one portion now
 *     times  - show the feeding schedule
 * =====================================================================
 */
#include <WiFi.h>
#include "config.h"
#include "sensors.h"
#include "feeder.h"
#include "settings.h"
#include "timekeeping.h"
#include "cloud.h"
#include "display.h"

static Reading lastReading = { -127, -1, -1, -1, 0 };
static bool haveReading = false;
static const char *localStatus = "NORMAL";

static unsigned long tSensor = 0, tUpload = 0, tHistory = 0, tSettings = 0,
                     tCommand = 0, tSchedule = 0, tLcd = 0, tWifiRetry = 0;
static String lastFedSlot = "";     // prevents feeding twice in the same minute/slot

// ------------------------------------------------------------------ Wi-Fi
static void wifiBegin() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WiFi] Connecting");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) { delay(500); Serial.print('.'); }
  if (WiFi.status() == WL_CONNECTED) Serial.println(" connected: " + WiFi.localIP().toString());
  else Serial.println(" failed (will keep retrying, feeding still works)");
}

// ------------------------------------------------------------------ local status (for buzzer/LCD)
static const char *evaluateLocal(const Reading &r) {
  bool critical = false, warning = false;
  auto check = [&](float v, float lo, float hi, float margin) {
    if (v < lo - margin || v > hi + margin) critical = true;
    else if (v < lo || v > hi) warning = true;
  };
  if (r.temperature <= -100) warning = true; else check(r.temperature, settings.tempMin, settings.tempMax, TEMP_MARGIN);
  if (r.ph < 0) warning = true;             else check(r.ph, settings.phMin, settings.phMax, PH_MARGIN);
  if (r.waterLevel < 0) warning = true;
  else if (r.waterLevel < settings.levelCriticalPct) critical = true;
  else if (r.waterLevel < settings.levelMinPct) warning = true;
  return critical ? "CRITICAL" : (warning ? "WARNING" : "NORMAL");
}

// ------------------------------------------------------------------ feeding
static void doFeeding(int portions, const char *type, const String &slot) {
  displayMessage("Feeding...", (String(portions) + " portion(s)").c_str());
  bool ok = dispensePortions(portions);
  if (!cloudLogFeeding(portions, type, ok, slot)) {
    Serial.println("[Feeder] Could not log to cloud (offline)");
  }
  tLcd = 0;   // refresh LCD right away
}

static void checkSchedule() {
  if (!settings.feedingEnabled || settings.feedCount == 0) return;
  struct tm now;
  if (!getLocalNow(now)) return;     // no valid time yet
  int minutes = now.tm_hour * 60 + now.tm_min;
  for (int i = 0; i < settings.feedCount; i++) {
    if (settings.feedMinutes[i] != minutes) continue;
    char slot[20];
    snprintf(slot, sizeof slot, "%04d%02d%02d-%02d%02d", now.tm_year + 1900, now.tm_mon + 1,
             now.tm_mday, now.tm_hour, now.tm_min);
    if (lastFedSlot == slot) return;  // already fed for this slot
    lastFedSlot = slot;
    Serial.printf("[Feeder] Scheduled feeding at %02d:%02d\n", now.tm_hour, now.tm_min);
    doFeeding(settings.portions, "scheduled", slot);
    return;
  }
}

// ------------------------------------------------------------------ serial commands
static void printReading(const Reading &r) {
  Serial.printf("[Read] Temp %.1f C | pH %.2f (%.3f V) | Level %.0f%% (%.1f cm) | %s\n",
                r.temperature, r.ph, r.phVoltage, r.waterLevel, r.waterCm, localStatus);
}

static void handleSerial() {
  if (!Serial.available()) return;
  String cmd = Serial.readStringUntil('\n');
  cmd.trim(); cmd.toLowerCase();
  if (cmd == "cal7") calibratePH7();
  else if (cmd == "cal4") calibratePH4();
  else if (cmd == "ph") printPHCalibration();
  else if (cmd == "read") { lastReading = readAllSensors(); printReading(lastReading); }
  else if (cmd == "feed") doFeeding(1, "manual", "");
  else if (cmd == "times") Serial.printf("[Feeder] enabled=%d times=%s portions=%d\n",
                                         settings.feedingEnabled, settings.feedTimesText.c_str(), settings.portions);
  else Serial.println("Commands: cal7, cal4, ph, read, feed, times");
}

// ------------------------------------------------------------------ setup / loop
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== SmartTank v" FIRMWARE_VERSION " ===");
  pinMode(PIN_LED_STATUS, OUTPUT);

  displayBegin();
  sensorsBegin();
  feederBegin();
  settingsLoad();       // cached settings → feeding works even without Wi-Fi
  timeBegin();          // RTC first, NTP when Wi-Fi is up
  wifiBegin();
  cloudBegin();
}

void loop() {
  unsigned long now = millis();
  bool wifiUp = WiFi.status() == WL_CONNECTED;
  digitalWrite(PIN_LED_STATUS, wifiUp ? HIGH : LOW);

  if (!wifiUp && now - tWifiRetry > 30000) { tWifiRetry = now; WiFi.reconnect(); }
  timeMaintain();
  handleSerial();

  if (!haveReading || now - tSensor >= SENSOR_INTERVAL_MS) {
    tSensor = now;
    lastReading = readAllSensors();
    haveReading = true;
    localStatus = evaluateLocal(lastReading);
    printReading(lastReading);
  }

  if (now - tSchedule >= SCHEDULE_CHECK_MS) { tSchedule = now; checkSchedule(); }

  if (cloudReady()) {
    if (tSettings == 0 || now - tSettings >= SETTINGS_INTERVAL_MS) {
      tSettings = now;
      if (cloudFetchSettings()) localStatus = evaluateLocal(lastReading);
    }
    if (tUpload == 0 || now - tUpload >= UPLOAD_INTERVAL_MS) {
      tUpload = now;
      cloudUploadLive(lastReading, localStatus);
    }
    if (tHistory == 0 || now - tHistory >= HISTORY_INTERVAL_MS) {
      tHistory = now;
      cloudPushHistory(lastReading);
    }
    if (now - tCommand >= COMMAND_INTERVAL_MS) {
      tCommand = now;
      int portions = cloudCheckFeedNow();
      if (portions > 0) {
        cloudClearFeedNow();               // clear first so it never repeats
        Serial.printf("[Feeder] Feed Now: %d portion(s)\n", portions);
        doFeeding(portions, "manual", "");
      }
    }
  }

  if (now - tLcd >= LCD_INTERVAL_MS) { tLcd = now; displayShow(lastReading, localStatus, cloudReady()); }
  buzzerUpdate(strcmp(localStatus, "CRITICAL") == 0);
}
