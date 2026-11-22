// =====================================================================
//  SmartTank — configuration
//  Edit the values marked  <-- CHANGE  before uploading.
// =====================================================================
#pragma once

// ---------- Wi-Fi ----------
#define WIFI_SSID        "YOUR_WIFI_NAME"        // <-- CHANGE
#define WIFI_PASSWORD    "YOUR_WIFI_PASSWORD"    // <-- CHANGE

// ---------- Firebase ----------
// Firebase console > Project settings > General > Web API Key
#define FIREBASE_API_KEY "YOUR_FIREBASE_WEB_API_KEY"                                  // <-- CHANGE
// Realtime Database URL, e.g. https://your-project-default-rtdb.asia-southeast1.firebasedatabase.app
#define FIREBASE_DB_URL  "https://YOUR-PROJECT-default-rtdb.asia-southeast1.firebasedatabase.app" // <-- CHANGE
// A Firebase Auth user created only for the device (Authentication > Users > Add user)
#define DEVICE_EMAIL     "device@smartaquarium.local"   // <-- CHANGE
#define DEVICE_PASSWORD  "CHANGE_THIS_PASSWORD"         // <-- CHANGE

#define DB_ROOT "/aquarium"
#define FIRMWARE_VERSION "1.0.0"

// ---------- Time (Philippines = UTC+8) ----------
#define GMT_OFFSET_SEC   (8 * 3600)
#define NTP_SERVER       "pool.ntp.org"
#define USE_RTC          1      // 1 = DS3231 RTC installed (keeps feeding on time without Wi-Fi)

// ---------- Pins (ESP32 DevKit V1) ----------
#define PIN_DS18B20      4      // DS18B20 data (4.7kΩ pull-up to 3.3V)
#define PIN_PH           34     // pH module "Po" via voltage divider (ADC1 only — ADC2 does not work with Wi-Fi)
#define PIN_US_TRIG      5      // JSN-SR04T TRIG
#define PIN_US_ECHO      18     // JSN-SR04T ECHO via voltage divider (5V -> 3.3V)
#define PIN_SERVO        13     // Feeder servo signal
#define PIN_BUZZER       25     // Active buzzer (+) through a transistor if it draws > 20 mA
#define PIN_LED_STATUS   2      // On-board LED: ON = Wi-Fi connected
// I2C (LCD 16x2 @0x27 and DS3231 @0x68): SDA = 21, SCL = 22
#define LCD_ADDRESS      0x27

// ---------- pH voltage divider ----------
// PH-4502C outputs up to 5V. Use R1 = 10kΩ (top) and R2 = 20kΩ (bottom):
// ESP32 sees Vout * 20/(10+20). We multiply back to get the module voltage.
#define PH_DIVIDER_RATIO (30.0f / 20.0f)

// ---------- Tank geometry defaults (can be changed from the dashboard) ----------
#define DEFAULT_SENSOR_TO_BOTTOM_CM 45.0f   // distance from ultrasonic sensor face to tank bottom
#define DEFAULT_FULL_WATER_CM       30.0f   // water depth that counts as 100%

// ---------- Feeder ----------
#define SERVO_REST_ANGLE   0
#define SERVO_DROP_ANGLE   180   // one rest->drop->rest cycle = 1 portion
#define SERVO_MOVE_MS      600
#define MAX_PORTIONS       5     // safety limit per feeding

// ---------- Timing (ms) ----------
#define SENSOR_INTERVAL_MS     10000UL   // read sensors
#define UPLOAD_INTERVAL_MS     30000UL   // update /live
#define HISTORY_INTERVAL_MS    60000UL   // add a row to /history
#define SETTINGS_INTERVAL_MS   30000UL   // download settings/profile/schedule
#define COMMAND_INTERVAL_MS     3000UL   // check "Feed Now"
#define SCHEDULE_CHECK_MS       5000UL   // check feeding schedule
#define LCD_INTERVAL_MS         3000UL

// ---------- Local alarm margins (same as functions/src/logic.js) ----------
#define TEMP_MARGIN 1.5f
#define PH_MARGIN   0.3f
