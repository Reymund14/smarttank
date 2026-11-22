#include "timekeeping.h"
#include "config.h"
#include <sys/time.h>
#if USE_RTC
#include <RTClib.h>
static RTC_DS3231 rtc;
static bool rtcOk = false;
#endif

static bool ntpSynced = false;
static unsigned long lastRtcSync = 0;

void timeBegin() {
  configTime(GMT_OFFSET_SEC, 0, NTP_SERVER);
#if USE_RTC
  rtcOk = rtc.begin();
  if (rtcOk && !rtc.lostPower()) {
    // Start the ESP32 system clock from the RTC so schedules work before Wi-Fi connects.
    // The RTC stores LOCAL time; convert to UTC for the system clock.
    DateTime now = rtc.now();
    struct timeval tv = { (time_t)(now.unixtime() - GMT_OFFSET_SEC), 0 };
    settimeofday(&tv, nullptr);
    Serial.println("[Time] System clock set from DS3231");
  } else {
    Serial.println("[Time] RTC not found or lost power — waiting for NTP");
  }
#endif
}

static bool clockValid() {
  return time(nullptr) > 1700000000;   // after Nov 2023 = clock has been set
}

bool getLocalNow(struct tm &out) {
  if (!clockValid()) return false;
  time_t now = time(nullptr);
  localtime_r(&now, &out);
  return true;
}

double epochMs() {
  if (!clockValid()) return 0;
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  return (double)tv.tv_sec * 1000.0 + tv.tv_usec / 1000;
}

void timeMaintain() {
  struct tm t;
  if (!ntpSynced && getLocalTime(&t, 10)) {
    ntpSynced = true;
    Serial.println("[Time] NTP synced");
  }
#if USE_RTC
  // Copy NTP time to the RTC once, then every 6 hours.
  if (ntpSynced && rtcOk && (lastRtcSync == 0 || millis() - lastRtcSync > 6UL * 3600UL * 1000UL)) {
    time_t now = time(nullptr);
    rtc.adjust(DateTime((uint32_t)(now + GMT_OFFSET_SEC)));
    lastRtcSync = millis();
    Serial.println("[Time] RTC updated from NTP");
  }
#endif
}
