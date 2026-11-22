#include "sensors.h"
#include "config.h"
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Preferences.h>

static OneWire oneWire(PIN_DS18B20);
static DallasTemperature ds18b20(&oneWire);
static Preferences prefs;

static float phV7 = 2.50f;   // module voltage at pH 7 (default, replace by calibration)
static float phV4 = 3.05f;   // module voltage at pH 4
static float sensorToBottomCm = DEFAULT_SENSOR_TO_BOTTOM_CM;
static float fullWaterCm = DEFAULT_FULL_WATER_CM;

// ------------------------------------------------------------ helpers
static void sortFloats(float *a, int n) {
  for (int i = 1; i < n; i++) {
    float k = a[i]; int j = i - 1;
    while (j >= 0 && a[j] > k) { a[j + 1] = a[j]; j--; }
    a[j + 1] = k;
  }
}

// Median of several samples removes spikes; average of the middle values smooths noise.
static float trimmedMean(float *a, int n) {
  sortFloats(a, n);
  int drop = n / 5;
  float sum = 0; int cnt = 0;
  for (int i = drop; i < n - drop; i++) { sum += a[i]; cnt++; }
  return cnt ? sum / cnt : NAN;
}

// ------------------------------------------------------------ temperature
static float readTemperature() {
  ds18b20.requestTemperatures();
  float t = ds18b20.getTempCByIndex(0);
  if (t == DEVICE_DISCONNECTED_C || t < -50 || t > 85) return -127.0f;
  return roundf(t * 10) / 10.0f;
}

// ------------------------------------------------------------ pH
static float readPHVoltage() {
  const int N = 20;
  float s[N];
  for (int i = 0; i < N; i++) {
    s[i] = analogReadMilliVolts(PIN_PH) / 1000.0f * PH_DIVIDER_RATIO;
    delay(10);
  }
  return trimmedMean(s, N);
}

static float voltageToPH(float v) {
  if (fabsf(phV7 - phV4) < 0.01f) return -1;
  // two-point linear calibration: pH = 7 + (v - V7) * (7 - 4) / (V7 - V4)
  return 7.0f + (v - phV7) * 3.0f / (phV7 - phV4);
}

void calibratePH7() {
  phV7 = readPHVoltage();
  prefs.putFloat("phV7", phV7);
  Serial.printf("[pH] Saved pH 7.0 voltage: %.3f V\n", phV7);
}

void calibratePH4() {
  phV4 = readPHVoltage();
  prefs.putFloat("phV4", phV4);
  Serial.printf("[pH] Saved pH 4.0 voltage: %.3f V\n", phV4);
}

void printPHCalibration() {
  float v = readPHVoltage();
  Serial.printf("[pH] V7=%.3f V4=%.3f | now %.3f V -> pH %.2f\n", phV7, phV4, v, voltageToPH(v));
}

// ------------------------------------------------------------ water level
static float readDistanceCm() {
  const int N = 7;
  float s[N]; int ok = 0;
  for (int i = 0; i < N; i++) {
    digitalWrite(PIN_US_TRIG, LOW);  delayMicroseconds(5);
    digitalWrite(PIN_US_TRIG, HIGH); delayMicroseconds(20);   // JSN-SR04T needs >10 µs
    digitalWrite(PIN_US_TRIG, LOW);
    unsigned long us = pulseIn(PIN_US_ECHO, HIGH, 30000UL);
    if (us > 0) s[ok++] = us * 0.0343f / 2.0f;
    delay(60);                                                // let echoes die out
  }
  if (ok < 3) return -1;
  return trimmedMean(s, ok);
}

void setTankGeometry(float toBottom, float full) {
  if (toBottom > 5 && full > 1 && full < toBottom) {
    sensorToBottomCm = toBottom;
    fullWaterCm = full;
    prefs.putFloat("toBottom", toBottom);
    prefs.putFloat("fullCm", full);
  }
}

// ------------------------------------------------------------ public
void sensorsBegin() {
  prefs.begin("aquarium", false);
  phV7 = prefs.getFloat("phV7", phV7);
  phV4 = prefs.getFloat("phV4", phV4);
  sensorToBottomCm = prefs.getFloat("toBottom", sensorToBottomCm);
  fullWaterCm = prefs.getFloat("fullCm", fullWaterCm);

  ds18b20.begin();
  ds18b20.setResolution(12);
  pinMode(PIN_US_TRIG, OUTPUT);
  pinMode(PIN_US_ECHO, INPUT);
  analogSetPinAttenuation(PIN_PH, ADC_11db);   // full 0–3.3 V range
}

Reading readAllSensors() {
  Reading r;
  r.temperature = readTemperature();

  r.phVoltage = readPHVoltage();
  float ph = voltageToPH(r.phVoltage);
  r.ph = (ph < 0 || ph > 14 || r.phVoltage < 0.1f) ? -1 : roundf(ph * 100) / 100.0f;

  float d = readDistanceCm();
  if (d < 0) {
    r.waterCm = -1; r.waterLevel = -1;
  } else {
    r.waterCm = sensorToBottomCm - d;
    float pct = r.waterCm / fullWaterCm * 100.0f;
    r.waterLevel = roundf(constrain(pct, 0.0f, 120.0f));
  }
  return r;
}
