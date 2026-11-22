#pragma once
#include <Arduino.h>

#define MAX_FEED_TIMES 8

// Settings downloaded from Firebase and cached in flash so the device works offline.
struct AquaSettings {
  String fishName = "";
  float tempMin = 24, tempMax = 28;
  float phMin = 6.5, phMax = 7.5;
  float levelMinPct = 85, levelCriticalPct = 70;

  bool feedingEnabled = true;
  int portions = 1;
  int feedCount = 0;
  int feedMinutes[MAX_FEED_TIMES];   // minutes after midnight, e.g. 08:30 -> 510
  String feedTimesText = "";         // "08:00,18:00"

  float sensorToBottomCm = 0, fullWaterCm = 0;
};

extern AquaSettings settings;

void settingsLoad();   // from flash
void settingsSave();   // to flash
void parseFeedTimes(const String &text);   // "08:00,18:00" -> feedMinutes[]
