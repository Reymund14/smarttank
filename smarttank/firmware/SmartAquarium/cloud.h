#pragma once
#include <Arduino.h>
#include "sensors.h"

void cloudBegin();
bool cloudReady();

bool cloudUploadLive(const Reading &r, const char *localStatus);
bool cloudPushHistory(const Reading &r);
bool cloudFetchSettings();                 // updates `settings`, returns true if downloaded
int  cloudCheckFeedNow();                  // >0 = portions requested, 0 = none
void cloudClearFeedNow();
bool cloudLogFeeding(int portions, const char *type, bool success, const String &slot);
