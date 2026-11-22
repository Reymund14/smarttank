#pragma once
#include <Arduino.h>

struct Reading {
  float temperature;   // °C, -127 = sensor error
  float ph;            // 0-14, -1 = sensor error
  float waterLevel;    // percent, -1 = sensor error
  float waterCm;       // water depth in cm
  float phVoltage;     // module voltage (for calibration/debug)
};

void  sensorsBegin();
Reading readAllSensors();

// Tank geometry (saved in flash, updated from the dashboard)
void  setTankGeometry(float sensorToBottomCm, float fullWaterCm);

// pH calibration (call while the probe is in the buffer solution)
void  calibratePH7();
void  calibratePH4();
void  printPHCalibration();
