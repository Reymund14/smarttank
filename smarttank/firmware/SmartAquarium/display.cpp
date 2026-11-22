#include "display.h"
#include "config.h"
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

static LiquidCrystal_I2C lcd(LCD_ADDRESS, 16, 2);
static bool showPage2 = false;

void displayBegin() {
  Wire.begin(21, 22);
  lcd.init();
  lcd.backlight();
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);
  displayMessage("SmartTank", "Starting...");
}

void displayMessage(const char *line1, const char *line2) {
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print(line1);
  lcd.setCursor(0, 1); lcd.print(line2);
}

void displayShow(const Reading &r, const char *status, bool online) {
  String l1, l2;
  if (!showPage2) {
    // Page 1:  "T:26.5C pH:7.02"  /  "Lvl:92% WiFi"
    l1 = "T:" + (r.temperature > -100 ? String(r.temperature, 1) + "C" : String("ERR")) +
         " pH:" + (r.ph >= 0 ? String(r.ph, 2) : String("ERR"));
    l2 = "Lvl:" + (r.waterLevel >= 0 ? String((int)r.waterLevel) + "%" : String("ERR")) +
         (online ? " WiFi" : " OFFLINE");
  } else {
    // Page 2:  "Status:"  /  "WARNING"
    l1 = "Status:";
    l2 = status;
  }
  showPage2 = !showPage2;
  displayMessage(l1.substring(0, 16).c_str(), l2.substring(0, 16).c_str());
}

void buzzerUpdate(bool critical) {
  if (!critical) { digitalWrite(PIN_BUZZER, LOW); return; }
  // beep 200 ms every 2 s
  digitalWrite(PIN_BUZZER, (millis() % 2000) < 200 ? HIGH : LOW);
}
