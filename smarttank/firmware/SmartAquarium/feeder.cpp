#include "feeder.h"
#include "config.h"
#include <ESP32Servo.h>

static Servo feederServo;

void feederBegin() {
  feederServo.setPeriodHertz(50);
  feederServo.attach(PIN_SERVO, 500, 2400);
  feederServo.write(SERVO_REST_ANGLE);
  delay(300);
  feederServo.detach();   // detach between feedings: no jitter, less power
}

bool dispensePortions(int portions) {
  portions = constrain(portions, 1, MAX_PORTIONS);
  feederServo.attach(PIN_SERVO, 500, 2400);
  for (int i = 0; i < portions; i++) {
    feederServo.write(SERVO_DROP_ANGLE);
    delay(SERVO_MOVE_MS);
    feederServo.write(SERVO_REST_ANGLE);
    delay(SERVO_MOVE_MS);
  }
  feederServo.detach();
  Serial.printf("[Feeder] Dispensed %d portion(s)\n", portions);
  return true;
}
