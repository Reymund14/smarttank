#pragma once
#include <Arduino.h>

void feederBegin();
// Dispenses n portions (1 servo cycle each). Returns true when finished.
bool dispensePortions(int portions);
