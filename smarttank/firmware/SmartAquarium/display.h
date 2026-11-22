#pragma once
#include <Arduino.h>
#include "sensors.h"

void displayBegin();
void displayShow(const Reading &r, const char *status, bool online);
void displayMessage(const char *line1, const char *line2);
void buzzerUpdate(bool critical);   // call often; beeps while critical
