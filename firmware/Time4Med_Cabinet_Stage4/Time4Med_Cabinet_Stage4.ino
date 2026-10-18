#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <MQTT.h>
#include <time.h>
#include <Wire.h>
#include <RTClib.h>
#include <U8g2lib.h>
#include <HardwareSerial.h>
#include <DFRobotDFPlayerMini.h>
#include <cstring>
#include <Preferences.h>

#include "secrets.h"
#include "mqtt_certs.h"
#include "google_certs.h"
#include "network_config.h"

// Stage 4 — HTTPS status telemetry only; no change to actuators or schedules.
#include "Time4MedStatusSender.h"
#include "telemetry_config.h"
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>

// ESP32-CAM needs to be reachable on the SAME local Wi-Fi network.
const char *CAMERA_CAPTURE_BASE_URL = "http://172.20.10.6/capture";

// Apps Script URL lives in secrets.h; never publish it in a public repository.

constexpr char DEVICE_ID[] = "ESP32S3-01";
constexpr char FIRMWARE_VERSION[] = "0.11.0-safe-schedules";

constexpr char MQTT_TOPIC_STATUS[] =
    "time4med/v1/cabinet/cabinet-01/status";
constexpr char MQTT_TOPIC_EVENT[] =
    "time4med/v1/cabinet/cabinet-01/event";
constexpr char MQTT_TOPIC_LOCK_COMMAND[] =
    "time4med/v1/cabinet/cabinet-01/command/lock";
constexpr char MQTT_TOPIC_SCHEDULE_COMMAND[] =
    "time4med/v1/cabinet/cabinet-01/command/schedule";
constexpr char MQTT_TOPIC_SCHEDULE_STATUS[] =
    "time4med/v1/cabinet/cabinet-01/schedule";

constexpr bool MQTT_ALLOW_INSECURE_TEST_ONLY = false;
constexpr bool START_REMINDER_ON_BOOT_FOR_TEST = false;
constexpr bool DEMO_MODE = false;

constexpr long GMT_OFFSET_SECONDS = 7L * 60L * 60L;
constexpr int DAYLIGHT_OFFSET_SECONDS = 0;

constexpr uint8_t RELAY_PIN = 4;
constexpr uint8_t CONFIRM_BUTTON_PIN = 5;
constexpr uint8_t REED_SWITCH_PIN = 6;
constexpr uint8_t EMERGENCY_BUTTON_PIN = 7;
constexpr uint8_t I2C_SDA_PIN = 8;
constexpr uint8_t I2C_SCL_PIN = 9;
constexpr uint8_t STATUS_LED_PIN = 10;
constexpr uint8_t DF_TX_PIN = 17;
constexpr uint8_t DF_RX_PIN = 18;

constexpr uint8_t RELAY_LOCK_LEVEL = LOW;
constexpr uint8_t RELAY_UNLOCK_LEVEL = HIGH;
constexpr uint8_t REED_CLOSED_LEVEL = LOW;
constexpr uint8_t EMERGENCY_ACTIVE_LEVEL = HIGH;
constexpr uint8_t LED_ON_LEVEL = HIGH;
constexpr uint8_t LED_OFF_LEVEL = LOW;

// /mp3/0001-0007 = meal voices; 0008-0010 = compartment voices.
// /mp3/0011 = ask to take medication / confirm; 0012 = confirmed;
// /mp3/0013 = not confirmed; 0014 / 0015 = door voice prompts.
constexpr uint16_t TRACK_GENERAL_BEEP = 101;
constexpr uint16_t TRACK_CONFIRM_INSTRUCTION = 11;
constexpr uint16_t TRACK_CONFIRMED = 12;
constexpr uint16_t TRACK_NOT_CONFIRMED = 13;
constexpr uint16_t TRACK_DOOR_CLOSE_VOICE = 14;
constexpr uint16_t TRACK_DOOR_CLOSED_VOICE = 15;
constexpr uint16_t TRACK_DOOR_WARNING = 102;
constexpr uint16_t TRACK_EMERGENCY = 103;

constexpr uint8_t VOLUME_MEDICINE = 25;
constexpr uint8_t VOLUME_DOOR_WARNING = 30;
constexpr uint8_t VOLUME_EMERGENCY = 25;

constexpr unsigned long DOOR_ALERT_REPEAT_MS = 2000;
constexpr unsigned long EMERGENCY_ALERT_REPEAT_MS = 5000;

constexpr uint8_t SCREEN_WIDTH = 128;
constexpr uint8_t SCREEN_HEIGHT = 64;
constexpr uint8_t OLED_ADDRESS = 0x3C;

// OLED 0.96 inch 128x64 SSD1306 (not SSD1309).
U8G2_SSD1306_128X64_NONAME_F_HW_I2C display(
    U8G2_R0,
    U8X8_PIN_NONE);

RTC_DS3231 rtc;
HardwareSerial dfSerial(1);
DFRobotDFPlayerMini player;
WiFiClientSecure mqttTlsClient;
MQTTClient mqttClient(768);
Time4MedNetworkConfig networkConfig;

bool oledReady = false;
bool dfPlayerReady = false;
bool mqttConfigured = false;
bool lockIsUnlocked = false;
bool rtcTimeValid = false;
unsigned long lastNtpAttemptMs = 0;
unsigned long lastNtpSyncMs = 0;
bool lastCameraCaptureSucceeded = false;
uint8_t currentDfVolume = 255;

enum class SystemState : uint8_t {
  IDLE,
  WAITING_FOR_CONFIRMATION,
  WAITING_FOR_DOOR_CLOSE,
  CONFIRMED,
  NO_CONFIRMATION,
  GENERAL_ACCESS
};

SystemState systemState = SystemState::IDLE;

enum class PendingLockReason : uint8_t {
  NONE,
  BOOT,
  MEDICINE_CONFIRMED,
  MEDICINE_NO_CONFIRMATION,
  GENERAL_ACCESS,
  REMOTE_LOCK
};

PendingLockReason pendingLockReason = PendingLockReason::NONE;

enum class RemoteLockCommand : uint8_t {
  NONE,
  LOCK,
  UNLOCK
};

RemoteLockCommand pendingRemoteLockCommand = RemoteLockCommand::NONE;

// One shared cabinet: the user number indicates a FIXED compartment.
// This firmware does not independently lock each compartment.
struct CabinetUser {
  const char *id;
  const char *patientId;
  uint8_t compartment;
  uint16_t voiceTrack;
};
constexpr CabinetUser USERS[] = {
    {"U001", "P001", 1, 8},
    {"U002", "P002", 2, 9},
    {"U003", "P003", 3, 10},
};
constexpr size_t USER_COUNT = sizeof(USERS) / sizeof(USERS[0]);

struct MealType {
  const char *id;
  const char *label;
  uint16_t voiceTrack;
};
constexpr MealType MEALS[] = {
    {"BEFORE_BREAKFAST", "BEFORE BREAKFAST", 1},
    {"AFTER_BREAKFAST", "AFTER BREAKFAST", 2},
    {"BEFORE_LUNCH", "BEFORE LUNCH", 3},
    {"AFTER_LUNCH", "AFTER LUNCH", 4},
    {"BEFORE_DINNER", "BEFORE DINNER", 5},
    {"AFTER_DINNER", "AFTER DINNER", 6},
    {"BEDTIME", "BEFORE BED", 7},
};
constexpr size_t MEAL_COUNT = sizeof(MEALS) / sizeof(MEALS[0]);

// Struct is NVS-persisted. Increment version if the layout changes.
struct MedicineSchedule {
  bool enabled;
  uint8_t userIndex;
  uint8_t mealIndex;
  uint8_t hour;
  uint8_t minute;
  int32_t lastTriggeredDate;
};
constexpr size_t SCHEDULE_COUNT = 18;
MedicineSchedule schedules[SCHEDULE_COUNT] = {};
Preferences schedulePreferences;
constexpr uint8_t SCHEDULE_STORAGE_VERSION = 2;
constexpr uint8_t SCHEDULE_MISSED_GRACE_MINUTES = 15;
bool queuedDueSchedules[SCHEDULE_COUNT] = {};
int32_t queuedDueDate = 0;

// MQTT actions are buffered so that the callback does not write flash.
String pendingScheduleCommand;

struct AudioItem {
  uint16_t track;
  uint8_t volume;
  const char *label;
};
AudioItem audioQueue[8];
uint8_t audioHead = 0;
uint8_t audioCount = 0;
bool audioPlaying = false;
unsigned long audioStartedMs = 0;
constexpr unsigned long AUDIO_TRACK_TIMEOUT_MS = 8000UL;

struct CloudEvent {
  String userId;
  String patientId;
  String eventType;
  String result;
  String details;
};
CloudEvent cloudQueue[12];
uint8_t cloudHead = 0;
uint8_t cloudCount = 0;
unsigned long lastCloudAttemptMs = 0;
constexpr unsigned long CLOUD_RETRY_MS = 20000UL;

int activeScheduleIndex = -1;

constexpr unsigned long DISPLAY_REFRESH_MS = 250;
constexpr unsigned long BUTTON_DEBOUNCE_MS = 40;
constexpr unsigned long SENSOR_DEBOUNCE_MS = 150;
constexpr unsigned long GENERAL_ACCESS_HOLD_MS = 3000;
constexpr unsigned long GENERAL_ACCESS_AUTO_LOCK_MS = 60000;

constexpr uint8_t REMINDER_MAX_PLAYS = 3;

constexpr unsigned long REMINDER_REPEAT_MS =
    DEMO_MODE ? 10UL * 1000UL : 5UL * 60UL * 1000UL;

constexpr unsigned long NO_CONFIRM_AFTER_LAST_REMINDER_MS =
    DEMO_MODE ? 10UL * 1000UL : 5UL * 60UL * 1000UL;

constexpr unsigned long CONFIRMED_SCREEN_MS = 3000;
constexpr unsigned long NO_CONFIRM_SCREEN_MS = 4000;
constexpr unsigned long MQTT_RECONNECT_MS = 10000;
constexpr unsigned long MQTT_HEARTBEAT_MS = 60000;
constexpr unsigned long NTP_TIMEOUT_MS = 15000;
constexpr unsigned long NTP_RETRY_MS = 60000UL;
constexpr unsigned long NTP_RESYNC_MS = 12UL * 60UL * 60UL * 1000UL;
constexpr unsigned long CAMERA_CONNECT_TIMEOUT_MS = 5000;
constexpr unsigned long CAMERA_HTTP_TIMEOUT_MS = 10000;
constexpr uint8_t CAMERA_CAPTURE_ATTEMPTS = 3;

unsigned long lastDisplayRefreshMs = 0;
unsigned long lastReminderMs = 0;
unsigned long finalReminderPlayedAtMs = 0;
unsigned long confirmedAtMs = 0;
unsigned long noConfirmationAtMs = 0;
unsigned long generalAccessStartedAtMs = 0;
unsigned long lastMqttReconnectMs = 0;
unsigned long lastMqttHeartbeatMs = 0;
unsigned long lastDoorAlertMs = 0;
unsigned long lastEmergencyAlertMs = 0;

uint8_t reminderPlayCount = 0;
bool doorAlertImmediate = false;

bool rawButtonState = HIGH;
bool stableButtonState = HIGH;
unsigned long buttonChangedAtMs = 0;
unsigned long buttonPressedAtMs = 0;
bool generalAccessBlockedUntilRelease = false;

bool rawReedState = HIGH;
bool stableReedState = HIGH;
unsigned long reedChangedAtMs = 0;

bool rawEmergencyState = LOW;
bool stableEmergencyState = LOW;
unsigned long emergencyChangedAtMs = 0;

void publishDeviceStatus(const char *reason);
void enqueueCloudEvent(const char *eventType, const char *result, const String &details);
void publishScheduleStatus();
void updateAudioQueue();
void queueAudio(uint16_t track, uint8_t volume, const char *label);
void stopDfPlayerAudio();
const CabinetUser &activeUser();
const MealType &activeMeal();
void publishEvent(const char *eventName, const char *detail);
void startGeneralAccess();
void closeGeneralAccess(const char *reason);
void completePendingSafeLock();
void confirmMedicineTaken();
void handleNoMedicineConfirmation();
void issueMedicineReminderCue();
void startMedicineReminder(size_t scheduleIndex, const DateTime &now);
bool requestCameraCapture();
const char *systemStateName();

bool doorIsClosed() {
  return stableReedState == REED_CLOSED_LEVEL;
}

bool emergencyIsActive() {
  return stableEmergencyState == EMERGENCY_ACTIVE_LEVEL;
}

void writeLed(bool on) {
  digitalWrite(
      STATUS_LED_PIN,
      on ? LED_ON_LEVEL : LED_OFF_LEVEL);
}

void setDfPlayerVolume(uint8_t volume) {
  if (!dfPlayerReady) return;
  if (volume > 30) volume = 30;
  if (currentDfVolume == volume) return;

  player.volume(volume);
  currentDfVolume = volume;
  delay(50);
}

void playDfTrack(
    uint16_t track,
    uint8_t volume,
    const char *label) {

  if (!dfPlayerReady) return;

  setDfPlayerVolume(volume);
  player.playMp3Folder(track);

  Serial.print("AUDIO: ");
  Serial.print(label);
  Serial.print(" / Track ");
  Serial.print(track);
  Serial.print(" / Volume ");
  Serial.println(volume);
}

void stopDfPlayerAudio() {
  audioHead = audioCount = 0;
  audioPlaying = false;
  if (dfPlayerReady) player.stop();
}

void queueAudio(uint16_t track, uint8_t volume, const char *label) {
  if (!dfPlayerReady || audioCount >= 8) return;
  uint8_t at = (audioHead + audioCount) % 8;
  audioQueue[at] = {track, volume, label};
  ++audioCount;
}

void updateAudioQueue() {
  if (!dfPlayerReady || emergencyIsActive()) return;
  if (audioPlaying && millis() - audioStartedMs >= AUDIO_TRACK_TIMEOUT_MS) {
    Serial.println("AUDIO: track completion timed out; advancing queue");
    audioPlaying = false;
  }
  if (audioPlaying || audioCount == 0) return;
  AudioItem item = audioQueue[audioHead];
  audioHead = (audioHead + 1) % 8;
  --audioCount;
  playDfTrack(item.track, item.volume, item.label);
  audioPlaying = true;
  audioStartedMs = millis();
}

const CabinetUser &activeUser() {
  if (activeScheduleIndex >= 0 && activeScheduleIndex < (int)SCHEDULE_COUNT) {
    return USERS[schedules[activeScheduleIndex].userIndex];
  }
  return USERS[0];
}

const MealType &activeMeal() {
  if (activeScheduleIndex >= 0 && activeScheduleIndex < (int)SCHEDULE_COUNT) {
    return MEALS[schedules[activeScheduleIndex].mealIndex];
  }
  return MEALS[1];
}

String escapeJsonText(const String &input) {
  String output;
  output.reserve(input.length() + 16);

  for (size_t i = 0; i < input.length(); ++i) {
    const char c = input.charAt(i);

    if (c == '\\') output += "\\\\";
    else if (c == '"') output += "\\\"";
    else if (c == '\n') output += "\\n";
    else if (c == '\r') output += "\\r";
    else if (c == '\t') output += "\\t";
    else if ((uint8_t)c >= 0x20) output += c;
  }

  return output;
}

void updateStatusLed() {
  const unsigned long nowMs = millis();
  bool ledOn = false;

  if (emergencyIsActive()) {
    ledOn = ((nowMs / 150UL) % 2UL) == 0;
  } else {
    switch (systemState) {
      case SystemState::IDLE:
        ledOn = false;
        break;
      case SystemState::WAITING_FOR_CONFIRMATION:
        ledOn = ((nowMs / 500UL) % 2UL) == 0;
        break;
      case SystemState::WAITING_FOR_DOOR_CLOSE:
        ledOn = ((nowMs / 200UL) % 2UL) == 0;
        break;
      case SystemState::CONFIRMED:
        ledOn = true;
        break;
      case SystemState::NO_CONFIRMATION:
        ledOn = false;
        break;
      case SystemState::GENERAL_ACCESS:
        ledOn = true;
        break;
    }
  }

  writeLed(ledOn);
}

void updateSystemAudioAlerts() {
  const unsigned long nowMs = millis();

  if (emergencyIsActive()) {
    if (lastEmergencyAlertMs == 0 ||
        nowMs - lastEmergencyAlertMs >= EMERGENCY_ALERT_REPEAT_MS) {
      playDfTrack(TRACK_EMERGENCY, VOLUME_EMERGENCY, "EMERGENCY BEEP");
      lastEmergencyAlertMs = nowMs;
    }
    return;
  }
  lastEmergencyAlertMs = 0;

  if (systemState == SystemState::WAITING_FOR_DOOR_CLOSE && !doorIsClosed()) {
    if (!audioPlaying && audioCount == 0 &&
        (doorAlertImmediate || lastDoorAlertMs == 0 ||
         nowMs - lastDoorAlertMs >= 6000UL)) {
      doorAlertImmediate = false;
      queueAudio(TRACK_DOOR_WARNING, VOLUME_DOOR_WARNING, "DOOR BEEP");
      lastDoorAlertMs = nowMs;
    }
    return;
  }
  lastDoorAlertMs = 0;
  doorAlertImmediate = false;
}

void scanI2CBus() {
  Serial.println("Scanning I2C...");

  uint8_t count = 0;

  for (uint8_t address = 1; address < 127; ++address) {
    Wire.beginTransmission(address);

    if (Wire.endTransmission() == 0) {
      Serial.print("I2C device: 0x");

      if (address < 0x10) Serial.print('0');

      Serial.println(address, HEX);
      ++count;
    }
  }

  if (count == 0) Serial.println("No I2C devices");
}

void drawCenteredText(
    const char *text,
    int16_t y,
    uint8_t textSize) {

  display.setFont(
      textSize >= 2
          ? u8g2_font_helvB18_tf
          : u8g2_font_6x12_tf);

  int16_t width = display.getStrWidth(text);
  int16_t x = (SCREEN_WIDTH - width) / 2;

  if (x < 0) x = 0;

  display.drawStr(x, y, text);
}

void showStartupStatus(
    const char *line1,
    const char *line2 = nullptr) {

  if (!oledReady) return;

  display.clearBuffer();

  if (line2 == nullptr) {
    drawCenteredText(line1, 36, 2);
  } else {
    drawCenteredText(line1, 27, 1);
    drawCenteredText(line2, 45, 1);
  }

  display.sendBuffer();
}

int32_t makeDateKey(const DateTime &now) {
  return
      static_cast<int32_t>(now.year()) * 10000L +
      static_cast<int32_t>(now.month()) * 100L +
      now.day();
}

void setLock(bool unlock) {
  const bool changed = lockIsUnlocked != unlock;

  digitalWrite(
      RELAY_PIN,
      unlock
          ? RELAY_UNLOCK_LEVEL
          : RELAY_LOCK_LEVEL);

  lockIsUnlocked = unlock;

  Serial.print("LOCK = ");
  Serial.println(unlock ? "UNLOCKED" : "LOCKED");

  if (changed) publishDeviceStatus("LOCK_CHANGED");
}

bool syncRTCFromNTP() {
  if (WiFi.status() != WL_CONNECTED) return false;

  configTime(
      GMT_OFFSET_SECONDS,
      DAYLIGHT_OFFSET_SECONDS,
      "pool.ntp.org",
      "time.nist.gov");

  struct tm timeInfo;
  const unsigned long start = millis();

  while (millis() - start < NTP_TIMEOUT_MS) {
    if (getLocalTime(&timeInfo, 500)) {
      rtc.adjust(
          DateTime(
              timeInfo.tm_year + 1900,
              timeInfo.tm_mon + 1,
              timeInfo.tm_mday,
              timeInfo.tm_hour,
              timeInfo.tm_min,
              timeInfo.tm_sec));

      rtcTimeValid = true;
      lastNtpSyncMs = millis();
      Serial.println("RTC synchronized");
      return true;
    }
  }

  Serial.println("NTP timeout");
  return false;
}

bool connectWiFi(unsigned long timeoutMs) {
  return networkConfig.begin(timeoutMs);
}

void maintainWiFi() {
  networkConfig.loop();
}

bool logActivityToCloud(
    const char *eventType,
    const char *result,
    const String &details,
    const char *eventUserId,
    const char *eventPatientId) {

  if (WiFi.status() != WL_CONNECTED) return false;

  if (!TIME4MED_CLOUD_API_URL[0]) return false;
  WiFiClientSecure cloudClient;
  cloudClient.setCACert(GOOGLE_ROOT_CA_BUNDLE);

  HTTPClient http;
  http.setConnectTimeout(3000);
  http.setTimeout(6000);
  http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);

  if (!http.begin(cloudClient, TIME4MED_CLOUD_API_URL)) {
    return false;
  }

  http.addHeader("Content-Type", "application/json");

  String payload;
  payload.reserve(600);

  payload += "{\"type\":\"event\"";
  payload += ",\"device_id\":\"";
  payload += DEVICE_ID;
  payload += "\"";
  payload += ",\"patient_id\":\"";
  payload += eventPatientId;
  payload += "\"";
  payload += ",\"user_id\":\"";
  payload += eventUserId;
  payload += "\"";
  payload += ",\"event_type\":\"";
  payload += eventType;
  payload += "\"";
  payload += ",\"result\":\"";
  payload += result;
  payload += "\"";
  payload += ",\"details\":\"";
  payload += escapeJsonText(details);
  payload += "\"}";

  const int code = http.POST(
      (uint8_t *)payload.c_str(),
      payload.length());

  if (code > 0) {
    String response = http.getString();
  }

  http.end();

  Serial.print("ActivityLog HTTP: ");
  Serial.println(code);

  return code >= 200 && code < 300;
}

void enqueueCloudEvent(const char *eventType, const char *result, const String &details) {
  if (cloudCount >= 12) {
    Serial.println("WARNING: cloud event queue full (RAM-only); oldest event dropped");
    cloudHead = (cloudHead + 1) % 12;
    --cloudCount;
  }
  uint8_t at = (cloudHead + cloudCount) % 12;
  // Cabinet-level events (e.g. Emergency) are not attributed to U001.
  cloudQueue[at].userId = activeScheduleIndex >= 0 ? activeUser().id : "";
  cloudQueue[at].patientId = activeScheduleIndex >= 0 ? activeUser().patientId : "";
  cloudQueue[at].eventType = eventType;
  cloudQueue[at].result = result;
  cloudQueue[at].details = details;
  ++cloudCount;
}

void maintainCloudQueue() {
  if (cloudCount == 0 || WiFi.status() != WL_CONNECTED ||
      !rtcTimeValid || systemState == SystemState::WAITING_FOR_CONFIRMATION ||
      systemState == SystemState::WAITING_FOR_DOOR_CLOSE ||
      emergencyIsActive()) return;
  if (lastCloudAttemptMs != 0 &&
      millis() - lastCloudAttemptMs < CLOUD_RETRY_MS) return;
  lastCloudAttemptMs = millis();
  CloudEvent &item = cloudQueue[cloudHead];
  if (logActivityToCloud(item.eventType.c_str(), item.result.c_str(), item.details,
                         item.userId.c_str(), item.patientId.c_str())) {
    item = CloudEvent{};
    cloudHead = (cloudHead + 1) % 12;
    --cloudCount;
  }
}

const char *systemStateName() {
  switch (systemState) {
    case SystemState::IDLE: return "IDLE";
    case SystemState::WAITING_FOR_CONFIRMATION: return "WAITING_FOR_CONFIRMATION";
    case SystemState::WAITING_FOR_DOOR_CLOSE: return "WAITING_FOR_DOOR_CLOSE";
    case SystemState::CONFIRMED: return "CONFIRMED";
    case SystemState::NO_CONFIRMATION: return "NO_CONFIRMATION";
    case SystemState::GENERAL_ACCESS: return "GENERAL_ACCESS";
  }
  return "UNKNOWN";
}


// ================================================================
// Time4Med v0.25 status bridge. Source: confirmed 0.11.0 cabinet.
// All relay/audio/RTC/medication logic remains in the main loop.
// Network sends run in a separate low-priority FreeRTOS task;
// this module NEVER changes GPIO, medicine schedules, or MQTT.
// TLS CA and HMAC secret MUST be set in local telemetry_private.h
// and are empty/disabled by default.
// ================================================================
struct T4MStatusSnapshot {
  bool lockUnlocked;
  bool doorClosed;
  bool emergency;
  bool rtcValid;
  char systemState[48];
  char reason[48];
};

static QueueHandle_t t4mStatusQueue = nullptr;
static bool t4mStatusEnabled = false;
static unsigned long t4mStatusLastQueuedMs = 0;
static T4MStatusSnapshot t4mPreviousStatus{};
static bool t4mHasPreviousStatus = false;

static t4m_telemetry::Sender t4mStatusSender(
    TIME4MED_STATUS_ENDPOINT,
    TIME4MED_STATUS_HMAC_KEY,
    TIME4MED_STATUS_ROOT_CA_PEM);

void t4mStatusSenderTask(void *parameter) {
  (void)parameter;
  T4MStatusSnapshot packet{};
  for (;;) {
    if (xQueueReceive(t4mStatusQueue, &packet, portMAX_DELAY) != pdTRUE) continue;
    const t4m_telemetry::Status status{
        packet.lockUnlocked, packet.doorClosed, packet.emergency,
        packet.rtcValid, packet.systemState, packet.reason};
    const bool success = t4mStatusSender.send(status);
    Serial.println(success ? "[T4M HTTPS] STATUS_OK" : "[T4M HTTPS] RETRY_ON_NEXT_TICK");
  }
}

void beginT4MStatusTelemetry() {
  if (!t4mStatusSender.configured()) {
    Serial.println("[T4M HTTPS] DISABLED (local key/verified CA not configured)");
    return;
  }
  t4mStatusQueue = xQueueCreate(1, sizeof(T4MStatusSnapshot));
  if (!t4mStatusQueue) {
    Serial.println("[T4M HTTPS] DISABLED (queue allocation failed)");
    return;
  }
  // Core 0, low priority: network work must not block cabinet loop.
  if (xTaskCreatePinnedToCore(t4mStatusSenderTask, "t4m_https",
                              12288, nullptr, 1, nullptr, 0) != pdPASS) {
    vQueueDelete(t4mStatusQueue);
    t4mStatusQueue = nullptr;
    Serial.println("[T4M HTTPS] DISABLED (task allocation failed)");
    return;
  }
  t4mStatusEnabled = true;
  Serial.println("[T4M HTTPS] Background sender ready (STAGING)");
}

void maintainT4MStatusTelemetry() {
  if (!t4mStatusEnabled || WiFi.status() != WL_CONNECTED) return;

  T4MStatusSnapshot current{};
  current.lockUnlocked = lockIsUnlocked;
  current.doorClosed = doorIsClosed();
  current.emergency = emergencyIsActive();
  current.rtcValid = rtcTimeValid;
  snprintf(current.systemState, sizeof(current.systemState),
           "%s", systemStateName());

  const unsigned long nowMs = millis();
  // Event changes can be queued after 2 s, otherwise heartbeat every 60 s.
  // Only a short RAM queue operation happens on the medicine-control loop.
  const bool changed = !t4mHasPreviousStatus ||
      memcmp(&current.lockUnlocked, &t4mPreviousStatus.lockUnlocked,
             sizeof(current.lockUnlocked)) != 0 ||
      current.doorClosed != t4mPreviousStatus.doorClosed ||
      current.emergency != t4mPreviousStatus.emergency ||
      current.rtcValid != t4mPreviousStatus.rtcValid ||
      strcmp(current.systemState, t4mPreviousStatus.systemState) != 0;
  if (t4mHasPreviousStatus &&
      (nowMs - t4mStatusLastQueuedMs <
       (changed ? 2000UL : 60000UL))) return;

  snprintf(current.reason, sizeof(current.reason), "%s",
           changed ? "STATE_CHANGE" : "HEARTBEAT");
  if (xQueueOverwrite(t4mStatusQueue, &current) != pdPASS) return;
  t4mPreviousStatus = current;
  t4mHasPreviousStatus = true;
  t4mStatusLastQueuedMs = nowMs;
}

bool mqttSettingsAreFilledIn() {
  return
      strlen(MQTT_HOST) > 0 &&
      strlen(MQTT_USERNAME) > 0 &&
      strlen(MQTT_PASSWORD) > 0 &&
      strcmp(MQTT_PASSWORD, "YOUR_MQTT_PASSWORD") != 0;
}

String buildMqttClientId() {
  const uint64_t chip = ESP.getEfuseMac();
  char id[40];

  snprintf(
      id,
      sizeof(id),
      "time4med-s3-%04X%08X",
      static_cast<uint16_t>(chip >> 32),
      static_cast<uint32_t>(chip));

  return String(id);
}

bool scheduleValid(const MedicineSchedule &item) {
  return (!item.enabled) || (item.userIndex < USER_COUNT &&
      item.mealIndex < MEAL_COUNT && item.hour < 24 && item.minute < 60);
}

void saveSchedules() {
  schedulePreferences.putBytes("sch", schedules, sizeof(schedules));
}

void loadSchedules() {
  schedulePreferences.begin("time4med-sch", false);
  if (schedulePreferences.getUChar("ver", 0) == SCHEDULE_STORAGE_VERSION &&
      schedulePreferences.getBytesLength("sch") == sizeof(schedules)) {
    schedulePreferences.getBytes("sch", schedules, sizeof(schedules));
    bool okay = true;
    for (size_t i = 0; i < SCHEDULE_COUNT; ++i) {
      if (!scheduleValid(schedules[i])) okay = false;
    }
    if (okay) return;
  }
  memset(schedules, 0, sizeof(schedules));
  // Only the two known original times are preloaded. More meals via MQTT.
  schedules[0] = {true, 0, 1, 8, 30, -1};  // U001 AFTER_BREAKFAST
  schedules[1] = {true, 0, 3, 12, 30, -1}; // U001 AFTER_LUNCH
  schedulePreferences.putUChar("ver", SCHEDULE_STORAGE_VERSION);
  saveSchedules();
}

int findUserIndex(const String &id) {
  for (size_t i = 0; i < USER_COUNT; ++i) if (id == USERS[i].id) return i;
  return -1;
}
int findMealIndex(const String &id) {
  for (size_t i = 0; i < MEAL_COUNT; ++i) if (id == MEALS[i].id) return i;
  return -1;
}

// A simple, strict protocol avoids a new JSON dependency.
// SET|U001|18:30|AFTER_DINNER
// DELETE|U001|18:30|AFTER_DINNER
// CLEAR|U002       (remove all schedules belonging to one user)
// LIST             (request current schedule publication)
void processScheduleCommand() {
  if (pendingScheduleCommand.isEmpty()) return;
  String payload = pendingScheduleCommand;
  pendingScheduleCommand = "";
  payload.trim();
  payload.toUpperCase();

  if (payload == "LIST") { publishScheduleStatus(); return; }
  if (systemState != SystemState::IDLE || emergencyIsActive()) {
    publishEvent("SCHEDULE_REJECTED", "cabinet busy or emergency active");
    return;
  }

  if (payload.startsWith("CLEAR|")) {
    const int index = findUserIndex(payload.substring(6));
    if (index < 0) { publishEvent("SCHEDULE_REJECTED", "unknown user"); return; }
    for (size_t i = 0; i < SCHEDULE_COUNT; ++i) {
      if (schedules[i].enabled && schedules[i].userIndex == index)
        schedules[i] = MedicineSchedule{};
    }
    memset(queuedDueSchedules, 0, sizeof(queuedDueSchedules));
    saveSchedules();
    publishEvent("SCHEDULE_UPDATED", "user cleared");
    publishScheduleStatus();
    return;
  }

  int a = payload.indexOf('|'), b = payload.indexOf('|', a + 1);
  int c = payload.indexOf('|', b + 1);
  if (a < 0 || b < 0 || c < 0 || payload.indexOf('|', c + 1) != -1) {
    publishEvent("SCHEDULE_REJECTED", "expected SET|USER|HH:MM|MEAL");
    return;
  }
  String action = payload.substring(0, a);
  String user = payload.substring(a + 1, b);
  String timePart = payload.substring(b + 1, c);
  String meal = payload.substring(c + 1);
  const int userIndex = findUserIndex(user);
  const int mealIndex = findMealIndex(meal);
  if ((action != "SET" && action != "DELETE") || userIndex < 0 || mealIndex < 0 ||
      timePart.length() != 5 || timePart.charAt(2) != ':' ||
      !isDigit(timePart.charAt(0)) || !isDigit(timePart.charAt(1)) ||
      !isDigit(timePart.charAt(3)) || !isDigit(timePart.charAt(4))) {
    publishEvent("SCHEDULE_REJECTED", "invalid action, user, meal or time");
    return;
  }
  int hour = timePart.substring(0, 2).toInt();
  int minute = timePart.substring(3, 5).toInt();
  if (hour >= 24 || minute >= 60) {
    publishEvent("SCHEDULE_REJECTED", "invalid clock time"); return;
  }
  int found = -1, emptySlot = -1;
  for (size_t i = 0; i < SCHEDULE_COUNT; ++i) {
    if (!schedules[i].enabled) { if (emptySlot < 0) emptySlot = i; continue; }
    if (schedules[i].userIndex == userIndex && schedules[i].mealIndex == mealIndex &&
        schedules[i].hour == hour && schedules[i].minute == minute) found = i;
  }
  if (action == "DELETE") {
    if (found < 0) {publishEvent("SCHEDULE_REJECTED", "schedule not found");return;}
    schedules[found] = MedicineSchedule{};
  } else {
    if (found < 0 && emptySlot < 0) {
      publishEvent("SCHEDULE_REJECTED", "schedule capacity reached (18)"); return;
    }
    int slot = found >= 0 ? found : emptySlot;
    if (found < 0) schedules[slot] = {true, (uint8_t)userIndex,
                              (uint8_t)mealIndex, (uint8_t)hour, (uint8_t)minute, -1};
  }
  memset(queuedDueSchedules, 0, sizeof(queuedDueSchedules));
  saveSchedules();
  publishEvent("SCHEDULE_UPDATED", action.c_str());
  publishScheduleStatus();
}

void publishScheduleStatus() {
  if (!mqttClient.connected()) return;
  // One entry per MQTT message keeps the packet under ESP32 buffer limits.
  for (size_t i = 0; i < SCHEDULE_COUNT; ++i) {
    if (!schedules[i].enabled) continue;
    const MedicineSchedule &e = schedules[i];
    char timePart[6];
    snprintf(timePart, sizeof(timePart), "%02u:%02u", e.hour, e.minute);
    String data = "{\"slot\":" + String(i) + ",\"user_id\":\"" +
      USERS[e.userIndex].id + "\",\"compartment\":" +
      String(USERS[e.userIndex].compartment) + ",\"time\":\"" + timePart +
      "\",\"meal\":\"" + MEALS[e.mealIndex].id + "\"}";
    mqttClient.publish(MQTT_TOPIC_SCHEDULE_STATUS, data, false, 1);
  }
}

void onMqttMessage(
    String &topic,
    String &payload) {

  if (topic == MQTT_TOPIC_SCHEDULE_COMMAND) {
    if (payload.length() <= 128 && pendingScheduleCommand.isEmpty())
      pendingScheduleCommand = payload;
    return;
  }
  if (topic != MQTT_TOPIC_LOCK_COMMAND) return;

  String command = payload;
  command.trim();
  command.replace(" ", "");
  command.replace("\n", "");
  command.replace("\r", "");
  command.toUpperCase();

  if (
      command == "LOCK" ||
      command.indexOf("\"ACTION\":\"LOCK\"") >= 0) {

    pendingRemoteLockCommand =
        RemoteLockCommand::LOCK;
  } else if (
      command == "UNLOCK" ||
      command.indexOf("\"ACTION\":\"UNLOCK\"") >= 0) {

    pendingRemoteLockCommand =
        RemoteLockCommand::UNLOCK;
  }
}

void configureMqtt() {
  if (mqttConfigured) return;

  if (MQTT_ALLOW_INSECURE_TEST_ONLY) {
    mqttTlsClient.setInsecure();
  } else {
    mqttTlsClient.setCACert(HIVEMQ_ROOT_CA_BUNDLE);
  }

  mqttClient.begin(
      MQTT_HOST,
      MQTT_PORT,
      mqttTlsClient);

  mqttClient.onMessage(onMqttMessage);
  mqttClient.setOptions(30, true, 5000);
  mqttClient.setWill(MQTT_TOPIC_STATUS,
      "{\"device_id\":\"ESP32S3-01\",\"online\":false}", true, 1);

  mqttConfigured = true;
}

void publishDeviceStatus(const char *reason) {
  if (!mqttClient.connected()) return;

  String payload;
  payload.reserve(400);

  payload += "{\"device_id\":\"";
  payload += DEVICE_ID;
  payload += "\",\"online\":true,\"lock_status\":\"";
  payload += lockIsUnlocked ? "UNLOCKED" : "LOCKED";
  payload += "\",\"door_status\":\"";
  payload += doorIsClosed() ? "CLOSED" : "OPEN";
  payload += "\",\"emergency\":";
  payload += emergencyIsActive() ? "true" : "false";
  payload += ",\"rtc_valid\":";
  payload += rtcTimeValid ? "true" : "false";
  payload += ",\"current_user\":\"";
  payload += activeScheduleIndex >= 0 ? activeUser().id : "";
  payload += "\",\"compartment\":";
  payload += activeScheduleIndex >= 0 ? String(activeUser().compartment) : String(0);
  payload += ",\"system_state\":\"";
  payload += systemStateName();
  payload += "\",\"reason\":\"";
  payload += reason;
  payload += "\"}";

  mqttClient.publish(
      MQTT_TOPIC_STATUS,
      payload,
      true,
      1);
}

void publishEvent(
    const char *eventName,
    const char *detail) {

  if (!mqttClient.connected()) return;

  String payload;
  payload.reserve(400);

  payload += "{\"device_id\":\"";
  payload += DEVICE_ID;
  payload += "\",\"event\":\"";
  payload += eventName;
  payload += "\",\"detail\":\"";
  payload += escapeJsonText(detail);
  payload += "\"}";

  mqttClient.publish(
      MQTT_TOPIC_EVENT,
      payload,
      false,
      1);
}

bool connectMqtt() {
  if (
      WiFi.status() != WL_CONNECTED ||
      !mqttSettingsAreFilledIn()) {

    return false;
  }

  const String id = buildMqttClientId();

  if (!mqttClient.connect(
          id.c_str(),
          MQTT_USERNAME,
          MQTT_PASSWORD)) {

    return false;
  }

  mqttClient.subscribe(MQTT_TOPIC_LOCK_COMMAND, 1);
  mqttClient.subscribe(MQTT_TOPIC_SCHEDULE_COMMAND, 1);

  lastMqttHeartbeatMs = millis();

  publishDeviceStatus("MQTT_CONNECTED");
  publishScheduleStatus();

  return true;
}

void maintainMqtt() {
  if (WiFi.status() != WL_CONNECTED) return;

  configureMqtt();

  if (mqttClient.connected()) {
    mqttClient.loop();

    const unsigned long nowMs = millis();

    if (
        nowMs - lastMqttHeartbeatMs >=
        MQTT_HEARTBEAT_MS) {

      lastMqttHeartbeatMs = nowMs;
      publishDeviceStatus("HEARTBEAT");
    }

    return;
  }

  const unsigned long nowMs = millis();

  if (
      nowMs - lastMqttReconnectMs >=
      MQTT_RECONNECT_MS) {

    lastMqttReconnectMs = nowMs;
    connectMqtt();
  }
}

void completePendingSafeLock() {
  PendingLockReason reason = pendingLockReason;

  if (reason == PendingLockReason::NONE) return;
  if (!doorIsClosed()) return;

  pendingLockReason = PendingLockReason::NONE;

  if (!emergencyIsActive()) stopDfPlayerAudio();

  lastDoorAlertMs = 0;
  doorAlertImmediate = false;

  setLock(false);
  if (!emergencyIsActive() && reason != PendingLockReason::BOOT) {
    if (reason == PendingLockReason::MEDICINE_CONFIRMED) {
      queueAudio(TRACK_CONFIRMED, VOLUME_MEDICINE, "CONFIRMED VOICE");
    } else if (reason == PendingLockReason::MEDICINE_NO_CONFIRMATION) {
      queueAudio(TRACK_NOT_CONFIRMED, VOLUME_MEDICINE, "NO CONFIRM VOICE");
    }
    queueAudio(TRACK_DOOR_CLOSED_VOICE, VOLUME_MEDICINE, "DOOR CLOSED VOICE");
  }

  switch (reason) {
    case PendingLockReason::MEDICINE_CONFIRMED:
      systemState = SystemState::CONFIRMED;
      confirmedAtMs = millis();
      publishEvent(
          "MEDICINE_CABINET_LOCKED",
          "door closed and lock completed");
      break;

    case PendingLockReason::MEDICINE_NO_CONFIRMATION:
      systemState = SystemState::NO_CONFIRMATION;
      noConfirmationAtMs = millis();
      publishEvent(
          "MEDICINE_NO_CONFIRMATION",
          "no confirmation and cabinet locked");
      break;

    case PendingLockReason::GENERAL_ACCESS:
      systemState = SystemState::IDLE;
      generalAccessStartedAtMs = 0;
      publishEvent(
          "GENERAL_ACCESS_LOCKED",
          "cabinet locked");
      break;

    case PendingLockReason::REMOTE_LOCK:
      systemState = SystemState::IDLE;
      publishEvent(
          "REMOTE_LOCK",
          "remote lock completed");
      break;

    case PendingLockReason::BOOT:
      systemState = SystemState::IDLE;
      break;

    case PendingLockReason::NONE:
      break;
  }

  publishDeviceStatus("SAFE_LOCK_COMPLETE");
}

void requestSafeLock(
    PendingLockReason reason,
    const char *detail) {

  // A remote command must never overwrite an ongoing medicine lock cycle.
  if (reason == PendingLockReason::REMOTE_LOCK &&
      (pendingLockReason == PendingLockReason::MEDICINE_CONFIRMED ||
       pendingLockReason == PendingLockReason::MEDICINE_NO_CONFIRMATION)) return;
  pendingLockReason = reason;

  if (doorIsClosed()) {
    completePendingSafeLock();
    return;
  }

  setLock(true);
  systemState = SystemState::WAITING_FOR_DOOR_CLOSE;
  stopDfPlayerAudio();
  queueAudio(TRACK_DOOR_CLOSE_VOICE, VOLUME_DOOR_WARNING, "PLEASE CLOSE DOOR");
  doorAlertImmediate = false;
  lastDoorAlertMs = millis();

  Serial.println("DOOR OPEN -> WAITING FOR CLOSE");

  publishEvent(
      "LOCK_WAITING_FOR_DOOR_CLOSE",
      detail);

  enqueueCloudEvent(
      "LOCK_WAITING_FOR_DOOR_CLOSE",
      "WAITING",
      detail);
}

void updateReedSwitch() {
  const bool reading =
      digitalRead(REED_SWITCH_PIN);

  const unsigned long nowMs = millis();

  if (reading != rawReedState) {
    rawReedState = reading;
    reedChangedAtMs = nowMs;
  }

  if (
      nowMs - reedChangedAtMs >=
          SENSOR_DEBOUNCE_MS &&
      stableReedState != rawReedState) {

    stableReedState = rawReedState;

    if (doorIsClosed()) {
      Serial.println("REED = CLOSED");

      publishEvent(
          "DOOR_CLOSED",
          "MC-38 closed");

      if (
          pendingLockReason !=
          PendingLockReason::NONE) {

        completePendingSafeLock();
      }
    } else {
      Serial.println("REED = OPEN");

      publishEvent(
          "DOOR_OPEN",
          "MC-38 open");
    }

    publishDeviceStatus("DOOR_CHANGED");
  }
}

void updateEmergencyButton() {
  const bool reading =
      digitalRead(EMERGENCY_BUTTON_PIN);

  const unsigned long nowMs = millis();

  if (reading != rawEmergencyState) {
    rawEmergencyState = reading;
    emergencyChangedAtMs = nowMs;
  }

  if (
      nowMs - emergencyChangedAtMs >=
          SENSOR_DEBOUNCE_MS &&
      stableEmergencyState != rawEmergencyState) {

    stableEmergencyState = rawEmergencyState;

    if (emergencyIsActive()) {
      Serial.println("EMERGENCY ACTIVE");

      stopDfPlayerAudio();

      playDfTrack(
          TRACK_EMERGENCY,
          VOLUME_EMERGENCY,
          "EMERGENCY");

      lastEmergencyAlertMs = millis();

      publishEvent(
          "EMERGENCY_BUTTON_PRESSED",
          "Emergency input active");

      enqueueCloudEvent(
          "EMERGENCY_BUTTON_PRESSED",
          "ALERT",
          "Emergency button pressed or NC circuit opened");
    } else {
      Serial.println("EMERGENCY CLEARED");

      stopDfPlayerAudio();
      lastEmergencyAlertMs = 0;

      if (
          systemState ==
              SystemState::WAITING_FOR_DOOR_CLOSE &&
          !doorIsClosed()) {

        doorAlertImmediate = true;
      }

      publishEvent(
          "EMERGENCY_CLEARED",
          "Emergency restored");
    }

    publishDeviceStatus("EMERGENCY_CHANGED");
  }
}

void processPendingMqttCommand() {
  const RemoteLockCommand command = pendingRemoteLockCommand;
  pendingRemoteLockCommand = RemoteLockCommand::NONE;
  if (command == RemoteLockCommand::NONE) return;

  // Only IDLE/GENERAL_ACCESS permit manual override. The user must not
  // bypass a due medicine dose or alter an in-progress door-close cycle.
  const bool medicineBusy = systemState == SystemState::WAITING_FOR_CONFIRMATION ||
      systemState == SystemState::WAITING_FOR_DOOR_CLOSE ||
      systemState == SystemState::CONFIRMED ||
      systemState == SystemState::NO_CONFIRMATION;
  if (medicineBusy || emergencyIsActive()) {
    publishEvent(command == RemoteLockCommand::LOCK ? "REMOTE_LOCK_BLOCKED" :
                 "REMOTE_UNLOCK_BLOCKED", "medicine cycle busy or emergency active");
    return;
  }

  if (command == RemoteLockCommand::LOCK) {
    requestSafeLock(PendingLockReason::REMOTE_LOCK, "remote lock request");
    return;
  }
  if (command == RemoteLockCommand::UNLOCK) {
    if (systemState == SystemState::IDLE) {
      systemState = SystemState::GENERAL_ACCESS;
      generalAccessStartedAtMs = millis();
    } else if (systemState == SystemState::GENERAL_ACCESS) {
      generalAccessStartedAtMs = millis();
    }
    pendingLockReason = PendingLockReason::NONE;
    setLock(true);
    publishEvent("REMOTE_UNLOCK", "remote general access; auto-lock after 60s");
    publishDeviceStatus("REMOTE_UNLOCK");
  }
}

bool requestCameraCapture() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Camera skipped: no WiFi");
    return false;
  }

  String meal = "UNKNOWN_MEAL";

  if (
      activeScheduleIndex >= 0 &&
      static_cast<size_t>(activeScheduleIndex) <
          SCHEDULE_COUNT) {

    meal = activeMeal().id;
  }

  meal.replace(" ", "_");

  String url = String(CAMERA_CAPTURE_BASE_URL);
  url += "?user=";
  url += activeUser().id;
  url += "&meal=";
  url += meal;
  url += "&compartment=";
  url += String(activeUser().compartment);

  for (
      uint8_t attempt = 1;
      attempt <= CAMERA_CAPTURE_ATTEMPTS;
      ++attempt) {

    WiFiClient client;
    HTTPClient http;

    http.setConnectTimeout(
        CAMERA_CONNECT_TIMEOUT_MS);

    http.setTimeout(
        CAMERA_HTTP_TIMEOUT_MS);

    http.useHTTP10(true);

    if (!http.begin(client, url)) {
      continue;
    }

    const int code = http.GET();

    Serial.print("Camera HTTP: ");
    Serial.println(code);

    if (code == HTTP_CODE_OK) {
      String contentType =
          http.header("Content-Type");

      const bool jpeg =
          contentType.length() == 0 ||
          contentType.startsWith("image/jpeg");

      http.end();

      if (jpeg) {
        Serial.println("CAMERA SUCCESS");
        return true;
      }
    } else {
      http.end();
    }

    delay(1000);
  }

  Serial.println("CAMERA FAILED");
  return false;
}

void startGeneralAccess() {
  if (systemState != SystemState::IDLE) return;

  systemState = SystemState::GENERAL_ACCESS;
  generalAccessStartedAtMs = millis();

  setLock(true);

  publishEvent(
      "GENERAL_ACCESS_UNLOCKED",
      "confirm held 3 seconds");
}

void closeGeneralAccess(const char *reason) {
  requestSafeLock(
      PendingLockReason::GENERAL_ACCESS,
      reason);
}

void issueMedicineReminderCue() {
  if (activeScheduleIndex < 0 || (size_t)activeScheduleIndex >= SCHEDULE_COUNT) return;
  if (reminderPlayCount >= REMINDER_MAX_PLAYS) return;
  ++reminderPlayCount;
  lastReminderMs = millis();
  if (!emergencyIsActive()) {
    stopDfPlayerAudio();
    queueAudio(TRACK_GENERAL_BEEP, VOLUME_MEDICINE, "GENERAL BEEP");
    queueAudio(activeMeal().voiceTrack, VOLUME_MEDICINE, "MEAL VOICE");
    queueAudio(activeUser().voiceTrack, VOLUME_MEDICINE, "COMPARTMENT VOICE");
    queueAudio(TRACK_CONFIRM_INSTRUCTION, VOLUME_MEDICINE, "CONFIRM INSTRUCTION");
  }
  if (reminderPlayCount == REMINDER_MAX_PLAYS) finalReminderPlayedAtMs = millis();
  if (reminderPlayCount > 1) publishEvent("MEDICINE_REMINDER_REPEAT", activeMeal().id);
}

void startMedicineReminder(
    size_t scheduleIndex,
    const DateTime &now) {

  if (scheduleIndex >= SCHEDULE_COUNT) return;

  activeScheduleIndex =
      static_cast<int>(scheduleIndex);

  schedules[scheduleIndex].lastTriggeredDate = makeDateKey(now);
  // Persist once at cycle start to avoid duplicate alerts on unexpected reset.
  saveSchedules();

  systemState =
      SystemState::WAITING_FOR_CONFIRMATION;

  pendingLockReason =
      PendingLockReason::NONE;

  reminderPlayCount = 0;
  finalReminderPlayedAtMs = 0;

  Serial.println("============================");
  Serial.println("MEDICINE TIME");
  Serial.print("Schedule: ");
  Serial.println(MEALS[schedules[scheduleIndex].mealIndex].label);
  Serial.print("User: ");
  Serial.println(activeUser().id);
  Serial.print("Compartment: ");
  Serial.println(activeUser().compartment);

  setLock(true);
  issueMedicineReminderCue();

  publishEvent(
      "MEDICINE_REMINDER",
      activeMeal().id);

  String detail = "Medicine reminder: ";
  detail += activeMeal().id;
  detail += " | User: ";
  detail += activeUser().id;
  detail += " | Compartment: ";
  detail += String(activeUser().compartment);

  enqueueCloudEvent(
      "MEDICINE_REMINDER",
      "SUCCESS",
      detail);
}

void confirmMedicineTaken() {
  if (
      systemState !=
      SystemState::WAITING_FOR_CONFIRMATION) {

    return;
  }

  Serial.println("============================");
  Serial.println("CONFIRM PRESSED");

  stopDfPlayerAudio();

  lastCameraCaptureSucceeded =
      requestCameraCapture();

  String detail =
      "Confirm pressed | Camera: ";

  detail +=
      lastCameraCaptureSucceeded
          ? "SUCCESS"
          : "FAILED";

  detail += " | Door: ";
  detail +=
      doorIsClosed()
          ? "CLOSED"
          : "OPEN";

  enqueueCloudEvent(
      "MEDICINE_CONFIRMED",
      lastCameraCaptureSucceeded
          ? "SUCCESS"
          : "PARTIAL",
      detail);

  publishEvent(
      "MEDICINE_CONFIRMED",
      lastCameraCaptureSucceeded
          ? "camera success"
          : "camera failed");

  requestSafeLock(
      PendingLockReason::MEDICINE_CONFIRMED,
      "medicine confirmed; checking door");
}

void handleNoMedicineConfirmation() {
  if (
      systemState !=
      SystemState::WAITING_FOR_CONFIRMATION) {

    return;
  }

  stopDfPlayerAudio();

  Serial.println("NO CONFIRMATION");

  publishEvent(
      "MEDICINE_NO_CONFIRMATION",
      "no confirmation after reminder cycle");

  enqueueCloudEvent(
      "MEDICINE_NO_CONFIRMATION",
      "NO_CONFIRMATION",
      "System received no confirmation");

  requestSafeLock(
      PendingLockReason::MEDICINE_NO_CONFIRMATION,
      "no confirmation; safe lock");
}

void checkMedicineSchedule(const DateTime &now) {
  if (!rtcTimeValid) return;
  const int32_t today = makeDateKey(now);
  if (queuedDueDate != today) {
    queuedDueDate = today;
    memset(queuedDueSchedules, 0, sizeof(queuedDueSchedules));
  }
  const int minuteOfDay = now.hour() * 60 + now.minute();
  // Collect scheduled doses even while another person's reminder is active.
  for (size_t i = 0; i < SCHEDULE_COUNT; ++i) {
    const MedicineSchedule &e = schedules[i];
    if (!e.enabled || e.lastTriggeredDate == today) continue;
    const int scheduledMinute = e.hour * 60 + e.minute;
    if (minuteOfDay >= scheduledMinute &&
        minuteOfDay - scheduledMinute <= SCHEDULE_MISSED_GRACE_MINUTES) {
      queuedDueSchedules[i] = true;
    }
  }
  if (systemState != SystemState::IDLE || emergencyIsActive()) return;
  // Serve queued doses in chronological order; preserve additional users
  // even if the first user takes longer than the 15-minute grace window.
  int candidate = -1, bestMinute = 24 * 60 + 1;
  for (size_t i = 0; i < SCHEDULE_COUNT; ++i) {
    if (!queuedDueSchedules[i] || !schedules[i].enabled ||
        schedules[i].lastTriggeredDate == today) continue;
    int dueMinute = schedules[i].hour * 60 + schedules[i].minute;
    if (dueMinute < bestMinute) { candidate = i; bestMinute = dueMinute; }
  }
  if (candidate >= 0) {
    queuedDueSchedules[candidate] = false;
    startMedicineReminder(candidate, now);
  }
}

void updateMedicineState() {
  const unsigned long nowMs = millis();

  if (
      systemState ==
          SystemState::WAITING_FOR_CONFIRMATION &&
      !lockIsUnlocked) {

    setLock(true);
  }

  if (
      systemState ==
          SystemState::WAITING_FOR_CONFIRMATION &&
      activeScheduleIndex >= 0) {

    if (
        reminderPlayCount < REMINDER_MAX_PLAYS &&
        nowMs - lastReminderMs >=
            REMINDER_REPEAT_MS) {

      issueMedicineReminderCue();
    } else if (
        reminderPlayCount >= REMINDER_MAX_PLAYS &&
        finalReminderPlayedAtMs > 0 &&
        nowMs - finalReminderPlayedAtMs >=
            NO_CONFIRM_AFTER_LAST_REMINDER_MS) {

      handleNoMedicineConfirmation();
    }
  }

  if (
      systemState == SystemState::GENERAL_ACCESS &&
      nowMs - generalAccessStartedAtMs >=
          GENERAL_ACCESS_AUTO_LOCK_MS) {

    closeGeneralAccess(
        "general access timeout");
  }

  if (
      systemState == SystemState::CONFIRMED &&
      nowMs - confirmedAtMs >=
          CONFIRMED_SCREEN_MS) {

    activeScheduleIndex = -1;
    systemState = SystemState::IDLE;

    publishDeviceStatus("IDLE");
  }

  if (
      systemState == SystemState::NO_CONFIRMATION &&
      nowMs - noConfirmationAtMs >=
          NO_CONFIRM_SCREEN_MS) {

    activeScheduleIndex = -1;
    systemState = SystemState::IDLE;
  }
}

void updateConfirmButton() {
  const bool reading =
      digitalRead(CONFIRM_BUTTON_PIN);

  const unsigned long nowMs = millis();

  if (reading != rawButtonState) {
    rawButtonState = reading;
    buttonChangedAtMs = nowMs;
  }

  if (
      nowMs - buttonChangedAtMs >=
          BUTTON_DEBOUNCE_MS &&
      stableButtonState != rawButtonState) {

    stableButtonState = rawButtonState;

    if (stableButtonState == LOW) {
      buttonPressedAtMs = nowMs;

      if (
          systemState ==
          SystemState::WAITING_FOR_CONFIRMATION) {

        generalAccessBlockedUntilRelease = true;
        confirmMedicineTaken();
        return;
      }

      if (
          systemState ==
          SystemState::GENERAL_ACCESS) {

        if (!generalAccessBlockedUntilRelease) {
          closeGeneralAccess("confirm pressed");
        }

        return;
      }
    } else {
      buttonPressedAtMs = 0;
      generalAccessBlockedUntilRelease = false;
    }
  }

  if (
      systemState == SystemState::IDLE &&
      stableButtonState == LOW &&
      !generalAccessBlockedUntilRelease &&
      buttonPressedAtMs != 0 &&
      nowMs - buttonPressedAtMs >=
          GENERAL_ACCESS_HOLD_MS) {

    generalAccessBlockedUntilRelease = true;
    startGeneralAccess();
  }
}

void drawClockScreen(const DateTime &now) {
  char timeText[9];
  char dateText[11];

  snprintf(
      timeText,
      sizeof(timeText),
      "%02d:%02d:%02d",
      now.hour(),
      now.minute(),
      now.second());

  snprintf(
      dateText,
      sizeof(dateText),
      "%02d/%02d/%04d",
      now.day(),
      now.month(),
      now.year());

  display.setFont(u8g2_font_6x10_tf);
  display.drawStr(0, 9, "Time4Med");

  display.setFont(u8g2_font_helvB18_tf);

  const int16_t timeWidth =
      display.getStrWidth(timeText);

  display.drawStr(
      (SCREEN_WIDTH - timeWidth) / 2,
      31,
      timeText);

  display.setFont(u8g2_font_6x10_tf);
  display.drawStr(0, 43, dateText);

  char status1[24];

  snprintf(
      status1,
      sizeof(status1),
      "Door:%s Lock:%s",
      doorIsClosed() ? "C" : "O",
      lockIsUnlocked ? "OPEN" : "LOCK");

  display.drawStr(0, 53, status1);

  char status2[24];

  snprintf(
      status2,
      sizeof(status2),
      "WiFi:%s MQTT:%s",
      WiFi.status() == WL_CONNECTED ? "OK" : "NO",
      mqttClient.connected() ? "OK" : "NO");

  display.drawStr(0, 63, status2);
}

void updateDisplay(const DateTime &now) {
  if (!oledReady) return;

  const unsigned long nowMs = millis();

  if (
      nowMs - lastDisplayRefreshMs <
      DISPLAY_REFRESH_MS) {

    return;
  }

  lastDisplayRefreshMs = nowMs;

  display.clearBuffer();

  if (emergencyIsActive()) {
    drawCenteredText("EMERGENCY", 27, 2);
    drawCenteredText("ALERT ACTIVE", 49, 1);
    display.sendBuffer();
    return;
  }

  switch (systemState) {
    case SystemState::IDLE:
      drawClockScreen(now);
      break;

    case SystemState::WAITING_FOR_CONFIRMATION:
      drawCenteredText("TAKE MEDICINE", 24, 1);

      if (
          activeScheduleIndex >= 0 &&
          static_cast<size_t>(activeScheduleIndex) <
              SCHEDULE_COUNT) {

        drawCenteredText(
            activeMeal().label,
            40,
            1);
      }

      char prompt[28];
      snprintf(prompt, sizeof(prompt), "%s / BOX %u", activeUser().id,
               activeUser().compartment);
      drawCenteredText(prompt, 52, 1);
      drawCenteredText("PRESS CONFIRM", 64, 1);
      break;

    case SystemState::WAITING_FOR_DOOR_CLOSE:
      drawCenteredText("CLOSE DOOR", 28, 2);
      drawCenteredText("WARNING 0102", 50, 1);
      break;

    case SystemState::CONFIRMED:
      drawCenteredText("CONFIRMED", 28, 2);
      drawCenteredText("CABINET LOCKED", 50, 1);
      break;

    case SystemState::NO_CONFIRMATION:
      drawCenteredText("NO CONFIRM", 28, 2);
      drawCenteredText("CYCLE COMPLETE", 50, 1);
      break;

    case SystemState::GENERAL_ACCESS:
      drawCenteredText("GENERAL ACCESS", 27, 1);
      drawCenteredText("CABINET OPEN", 45, 1);
      drawCenteredText("PRESS TO LOCK", 60, 1);
      break;
  }

  display.sendBuffer();
}

void printDFPlayerMessages() {
  if (!dfPlayerReady) return;

  if (player.available()) {
    const uint8_t type = player.readType();
    const int value = player.read();
    if (type == DFPlayerPlayFinished) audioPlaying = false;

    Serial.print("DFPlayer type: ");
    Serial.print(type);
    Serial.print(" value: ");
    Serial.println(value);
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("================================");
  Serial.println(" Time4Med DFPlayer Alert");
  Serial.println("================================");

  pinMode(STATUS_LED_PIN, OUTPUT);
  writeLed(false);

  pinMode(REED_SWITCH_PIN, INPUT_PULLUP);
  rawReedState = digitalRead(REED_SWITCH_PIN);
  stableReedState = rawReedState;

  pinMode(EMERGENCY_BUTTON_PIN, INPUT_PULLUP);
  rawEmergencyState = digitalRead(EMERGENCY_BUTTON_PIN);
  stableEmergencyState = rawEmergencyState;

  // Preload LOW before enabling the pin, limiting unintended relay pulses.
  digitalWrite(RELAY_PIN, RELAY_LOCK_LEVEL);
  pinMode(RELAY_PIN, OUTPUT);
  lockIsUnlocked = false;

  pinMode(CONFIRM_BUTTON_PIN, INPUT_PULLUP);
  rawButtonState = digitalRead(CONFIRM_BUTTON_PIN);
  stableButtonState = rawButtonState;

  loadSchedules();

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setClock(100000);
  scanI2CBus();

  display.setI2CAddress(OLED_ADDRESS << 1);
  display.begin();
  oledReady = true;

  showStartupStatus(
      "TIME4MED",
      "STARTING");

  if (!rtc.begin()) {
    Serial.println("RTC ERROR");
    showStartupStatus("RTC ERROR");

    while (true) delay(1000);
  }

  if (rtc.lostPower()) {
    // Compile timestamp is for display only, not trusted for dosing.
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
    rtcTimeValid = false;
  } else {
    rtcTimeValid = true;
  }

  dfSerial.begin(
      9600,
      SERIAL_8N1,
      DF_RX_PIN,
      DF_TX_PIN);

  delay(800);

  if (player.begin(dfSerial)) {
    dfPlayerReady = true;
    currentDfVolume = 255;

    setDfPlayerVolume(
        VOLUME_MEDICINE);

    player.EQ(
        DFPLAYER_EQ_NORMAL);

    Serial.println("DFPlayer READY");
    Serial.println("0001-0007 = Meal voices; 0008-0010 = Compartment voices");
    Serial.println("0101 = General beep");
    Serial.println("0102 = Door Warning / Vol 30");
    Serial.println("0103 = Emergency / Vol 25 / 5 sec");
  } else {
    dfPlayerReady = false;
    Serial.println("DFPlayer FAILED");
  }

  showStartupStatus(
      dfPlayerReady
          ? "DFPLAYER OK"
          : "DFPLAYER FAILED",
      "CONNECT WIFI");

  if (connectWiFi(15000)) {
    showStartupStatus(
        "WIFI CONNECTED",
        "SYNC RTC");

    syncRTCFromNTP();
  } else {
    showStartupStatus(
        "WIFI CONFIG",
        "192.168.4.1");
  }

  configureMqtt();

  if (WiFi.status() == WL_CONNECTED) {
    connectMqtt();
  }

  Serial.print("DOOR = ");
  Serial.println(
      doorIsClosed()
          ? "CLOSED"
          : "OPEN");

  Serial.print("EMERGENCY = ");
  Serial.println(
      emergencyIsActive()
          ? "ACTIVE"
          : "NORMAL");

  if (START_REMINDER_ON_BOOT_FOR_TEST && rtcTimeValid) {
    startMedicineReminder(
        0,
        rtc.now());
  } else {
    requestSafeLock(
        PendingLockReason::BOOT,
        "boot safety");
  }

  lastDisplayRefreshMs = 0;
  beginT4MStatusTelemetry();
}

void loop() {
  maintainWiFi();
  maintainMqtt();

  updateReedSwitch();
  updateEmergencyButton();
  updateConfirmButton();

  processPendingMqttCommand();
  processScheduleCommand();

  if (WiFi.status() == WL_CONNECTED && systemState == SystemState::IDLE &&
      !emergencyIsActive() &&
      (!rtcTimeValid || lastNtpSyncMs == 0 ||
       millis() - lastNtpSyncMs >= NTP_RESYNC_MS) &&
      (lastNtpAttemptMs == 0 || millis() - lastNtpAttemptMs >= NTP_RETRY_MS)) {
    lastNtpAttemptMs = millis();
    syncRTCFromNTP();
  }

  const DateTime now = rtc.now();
  checkMedicineSchedule(now);
  updateMedicineState();

  updateStatusLed();
  updateSystemAudioAlerts();
  updateDisplay(now);
  printDFPlayerMessages();
  updateAudioQueue();
  maintainCloudQueue();
  maintainT4MStatusTelemetry();

  delay(5);
}