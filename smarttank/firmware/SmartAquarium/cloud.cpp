#include "cloud.h"
#include "config.h"
#include "settings.h"
#include "timekeeping.h"
#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include "addons/TokenHelper.h"

static FirebaseData fbdo;
static FirebaseAuth fbAuth;
static FirebaseConfig fbConfig;

static String path(const char *sub) { return String(DB_ROOT) + sub; }

static void setTs(FirebaseJson &json) {
  double ms = epochMs();
  if (ms > 0) json.set("ts", ms);
  else json.set("ts/.sv", "timestamp");    // clock not set yet: let Firebase stamp it
}

void cloudBegin() {
  fbConfig.api_key = FIREBASE_API_KEY;
  fbConfig.database_url = FIREBASE_DB_URL;
  fbAuth.user.email = DEVICE_EMAIL;
  fbAuth.user.password = DEVICE_PASSWORD;
  fbConfig.token_status_callback = tokenStatusCallback;
  fbConfig.timeout.serverResponse = 10 * 1000;
  Firebase.reconnectNetwork(true);
  fbdo.setResponseSize(4096);
  Firebase.begin(&fbConfig, &fbAuth);
}

bool cloudReady() { return WiFi.status() == WL_CONNECTED && Firebase.ready(); }

static void fillReading(FirebaseJson &json, const Reading &r) {
  json.set("temperature", r.temperature);
  json.set("ph", r.ph);
  json.set("waterLevel", r.waterLevel);
  json.set("waterCm", roundf(r.waterCm * 10) / 10.0f);
  json.set("phVoltage", roundf(r.phVoltage * 1000) / 1000.0f);
}

bool cloudUploadLive(const Reading &r, const char *localStatus) {
  if (!cloudReady()) return false;
  FirebaseJson json;
  fillReading(json, r);
  json.set("localStatus", localStatus);
  json.set("rssi", WiFi.RSSI());
  json.set("ip", WiFi.localIP().toString());
  json.set("uptimeSec", (int)(millis() / 1000));
  json.set("firmware", FIRMWARE_VERSION);
  setTs(json);
  bool ok = Firebase.RTDB.setJSON(&fbdo, path("/live").c_str(), &json);
  if (!ok) Serial.printf("[Cloud] live failed: %s\n", fbdo.errorReason().c_str());
  return ok;
}

bool cloudPushHistory(const Reading &r) {
  if (!cloudReady()) return false;
  FirebaseJson json;
  fillReading(json, r);
  setTs(json);
  bool ok = Firebase.RTDB.pushJSON(&fbdo, path("/history").c_str(), &json);
  if (!ok) Serial.printf("[Cloud] history failed: %s\n", fbdo.errorReason().c_str());
  return ok;
}

static float jsonFloat(FirebaseJson &j, const char *key, float def) {
  FirebaseJsonData d;
  j.get(d, key);
  return d.success ? d.to<float>() : def;
}

bool cloudFetchSettings() {
  if (!cloudReady()) return false;
  if (!Firebase.RTDB.getJSON(&fbdo, path("/settings").c_str())) {
    Serial.printf("[Cloud] settings failed: %s\n", fbdo.errorReason().c_str());
    return false;
  }
  FirebaseJson &s = fbdo.jsonObject();
  FirebaseJsonData d;

  String profileId;
  s.get(d, "fishProfileId");
  if (d.success) profileId = d.to<String>();

  s.get(d, "feeding/enabled");
  if (d.success) settings.feedingEnabled = d.to<bool>();
  s.get(d, "feeding/portions");
  if (d.success) settings.portions = constrain(d.to<int>(), 1, MAX_PORTIONS);
  s.get(d, "feeding/times");
  if (d.success) parseFeedTimes(d.to<String>());

  float toBottom = jsonFloat(s, "tank/sensorToBottomCm", 0);
  float full = jsonFloat(s, "tank/fullWaterCm", 0);
  if (toBottom > 0 && full > 0) setTankGeometry(toBottom, full);

  if (profileId.length()) {
    String p = path("/profiles/") + profileId;
    if (Firebase.RTDB.getJSON(&fbdo, p.c_str())) {
      FirebaseJson &pj = fbdo.jsonObject();
      pj.get(d, "name");
      if (d.success) settings.fishName = d.to<String>();
      settings.tempMin = jsonFloat(pj, "tempMin", settings.tempMin);
      settings.tempMax = jsonFloat(pj, "tempMax", settings.tempMax);
      settings.phMin = jsonFloat(pj, "phMin", settings.phMin);
      settings.phMax = jsonFloat(pj, "phMax", settings.phMax);
      settings.levelMinPct = jsonFloat(pj, "levelMinPct", settings.levelMinPct);
      settings.levelCriticalPct = jsonFloat(pj, "levelCriticalPct", settings.levelCriticalPct);
    }
  }
  settingsSave();
  return true;
}

int cloudCheckFeedNow() {
  if (!cloudReady()) return 0;
  if (!Firebase.RTDB.getJSON(&fbdo, path("/commands/feedNow").c_str())) return 0;
  FirebaseJson &j = fbdo.jsonObject();
  FirebaseJsonData d;
  j.get(d, "requested");
  if (!d.success || !d.to<bool>()) return 0;
  j.get(d, "portions");
  return d.success ? constrain(d.to<int>(), 1, MAX_PORTIONS) : settings.portions;
}

void cloudClearFeedNow() {
  if (!cloudReady()) return;
  FirebaseJson json;
  json.set("requested", false);
  json.set("doneAt/.sv", "timestamp");
  Firebase.RTDB.updateNode(&fbdo, path("/commands/feedNow").c_str(), &json);
}

bool cloudLogFeeding(int portions, const char *type, bool success, const String &slot) {
  if (!cloudReady()) return false;
  FirebaseJson json;
  json.set("portions", portions);
  json.set("type", type);          // "scheduled" or "manual"
  json.set("success", success);
  if (slot.length()) json.set("slot", slot);
  setTs(json);
  return Firebase.RTDB.pushJSON(&fbdo, path("/feedingLogs").c_str(), &json);
}
