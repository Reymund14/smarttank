#pragma once
#include <Arduino.h>
#include <time.h>

void timeBegin();
// Fills tm with the local time. Uses NTP when synced, otherwise the DS3231 RTC.
bool getLocalNow(struct tm &out);
// Unix time in milliseconds (UTC), or 0 if the clock is not set.
double epochMs();
// Call regularly: copies NTP time into the RTC once Wi-Fi time is available.
void timeMaintain();
