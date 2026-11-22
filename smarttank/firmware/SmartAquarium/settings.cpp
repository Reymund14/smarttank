#include "settings.h"
#include <Preferences.h>

AquaSettings settings;
static Preferences sp;

void parseFeedTimes(const String &text) {
  settings.feedTimesText = text;
  settings.feedCount = 0;
  int start = 0;
  while (start < (int)text.length() && settings.feedCount < MAX_FEED_TIMES) {
    int comma = text.indexOf(',', start);
    if (comma < 0) comma = text.length();
    String item = text.substring(start, comma);
    item.trim();
    int colon = item.indexOf(':');
    if (colon > 0) {
      int h = item.substring(0, colon).toInt();
      int m = item.substring(colon + 1).toInt();
      if (h >= 0 && h < 24 && m >= 0 && m < 60) settings.feedMinutes[settings.feedCount++] = h * 60 + m;
    }
    start = comma + 1;
  }
}

void settingsLoad() {
  sp.begin("settings", true);
  settings.fishName = sp.getString("fish", "");
  settings.tempMin = sp.getFloat("tMin", settings.tempMin);
  settings.tempMax = sp.getFloat("tMax", settings.tempMax);
  settings.phMin = sp.getFloat("pMin", settings.phMin);
  settings.phMax = sp.getFloat("pMax", settings.phMax);
  settings.levelMinPct = sp.getFloat("lMin", settings.levelMinPct);
  settings.levelCriticalPct = sp.getFloat("lCrit", settings.levelCriticalPct);
  settings.feedingEnabled = sp.getBool("feedOn", true);
  settings.portions = sp.getInt("portions", 1);
  String times = sp.getString("times", "08:00,18:00");
  sp.end();
  parseFeedTimes(times);
  Serial.printf("[Settings] Loaded from flash: fish=%s feed=%s x%d\n",
                settings.fishName.c_str(), times.c_str(), settings.portions);
}

void settingsSave() {
  sp.begin("settings", false);
  sp.putString("fish", settings.fishName);
  sp.putFloat("tMin", settings.tempMin);
  sp.putFloat("tMax", settings.tempMax);
  sp.putFloat("pMin", settings.phMin);
  sp.putFloat("pMax", settings.phMax);
  sp.putFloat("lMin", settings.levelMinPct);
  sp.putFloat("lCrit", settings.levelCriticalPct);
  sp.putBool("feedOn", settings.feedingEnabled);
  sp.putInt("portions", settings.portions);
  sp.putString("times", settings.feedTimesText);
  sp.end();
}
