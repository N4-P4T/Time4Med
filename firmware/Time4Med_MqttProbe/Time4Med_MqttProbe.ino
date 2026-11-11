/*
 * Time4Med ESP32-S3 HiveMQ connectivity probe (READ ONLY)
 * This is NOT the production medicine-cabinet firmware.
 * It intentionally does not touch relay, emergency button, or any GPIO.
 * Disconnect 12V lock/relay power before uploading/testing.
 *
 * MQTT: HiveMQ TLS 8883 (browser website uses WSS 8884/mqtt).
 * Broker subscription: device status/events only.
 * No MQTT publish and no LOCK/UNLOCK/schedule modification.
 */
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <MQTT.h>
#include <time.h>
#include <cstring>

#include "secrets.h"
#include "mqtt_certs.h"

namespace {
constexpr unsigned long WIFI_TIMEOUT_MS = 20000UL;
constexpr unsigned long NTP_TIMEOUT_MS = 18000UL;
constexpr unsigned long RETRY_INTERVAL_MS = 15000UL;
constexpr unsigned long STATUS_INTERVAL_MS = 10000UL;
constexpr char TOPIC_STATUS[] = "time4med/v1/cabinet/cabinet-01/status";
constexpr char TOPIC_EVENT[] = "time4med/v1/cabinet/cabinet-01/event";

WiFiClientSecure tls;
MQTTClient client(1024);
unsigned long lastAttemptMs = 0;
unsigned long lastReportMs = 0;
bool ntpReady = false;

bool configured() {
  if (!strlen(WIFI_SSID) || !strlen(MQTT_HOST) ||
      !strlen(MQTT_USERNAME) || !strlen(MQTT_PASSWORD)) return false;
  if (!strcmp(WIFI_SSID, "YOUR_WIFI_SSID") ||
      !strcmp(MQTT_USERNAME, "YOUR_DEVICE_MQTT_USERNAME") ||
      !strcmp(MQTT_PASSWORD, "YOUR_DEVICE_MQTT_PASSWORD")) return false;
  return true;
}

void onMessage(String &topic, String &payload) {
  Serial.print("[RX] Topic: ");
  Serial.println(topic);
  // Keep response concise; status/event may contain sensitive patient data.
  Serial.print("[RX] Payload bytes: ");
  Serial.println(payload.length());
  if (topic == TOPIC_STATUS) {
    Serial.println("[RX] Device status received (may be retained / stale)");
  } else if (topic == TOPIC_EVENT) {
    Serial.println("[RX] Device event received");
  }
}

bool connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  Serial.println("[WIFI] Connecting...");
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  const unsigned long started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < WIFI_TIMEOUT_MS) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() != WL_CONNECTED) {
    Serial.print("[WIFI] ERROR: status=");
    Serial.println(static_cast<int>(WiFi.status()));
    return false;
  }
  Serial.print("[WIFI] Connected. IP: ");
  Serial.println(WiFi.localIP());
  return true;
}

bool waitForNetworkClock() {
  if (ntpReady && time(nullptr) > 1700000000) return true;
  Serial.println("[NTP] Syncing UTC before TLS certificate validation...");
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  const unsigned long started = millis();
  while (millis() - started < NTP_TIMEOUT_MS) {
    if (time(nullptr) > 1700000000) {
      ntpReady = true;
      Serial.println("[NTP] Time valid");
      return true;
    }
    delay(300);
  }
  Serial.println("[NTP] ERROR: clock unavailable. No insecure TLS fallback.");
  return false;
}

void tryConnect() {
  if (!configured()) {
    Serial.println("[CONFIG] ERROR: fill secrets.h LOCALLY. Never commit it.");
    return;
  }
  if (!connectWifi()) return;
  if (!waitForNetworkClock()) return;

  tls.setCACert(HIVEMQ_ROOT_CA_BUNDLE);
  client.begin(MQTT_HOST, MQTT_PORT, tls);
  client.onMessage(onMessage);
  client.setOptions(30, true, 5000);

  const uint64_t mac = ESP.getEfuseMac();
  char id[40];
  snprintf(id, sizeof(id), "time4med-probe-%04X%08X",
           static_cast<unsigned>(mac >> 32),
           static_cast<unsigned>(mac & 0xffffffffULL));
  Serial.print("[MQTT] Connecting via TLS on port ");
  Serial.println(MQTT_PORT);
  Serial.print("[MQTT] Client ID: ");
  Serial.println(id);
  if (!client.connect(id, MQTT_USERNAME, MQTT_PASSWORD)) {
    Serial.print("[MQTT] CONNECT FAILED: lastError=");
    Serial.print(static_cast<int>(client.lastError()));
    Serial.print(" returnCode=");
    Serial.println(client.returnCode());
    Serial.println("[MQTT] Check broker host, username, password, permissions and TLS cert.");
    return;
  }

  Serial.println("[MQTT] CONNECTED");
  const bool subStatus = client.subscribe(TOPIC_STATUS, 1);
  const bool subEvents = client.subscribe(TOPIC_EVENT, 1);
  Serial.print("[MQTT] SUB status=");
  Serial.print(subStatus ? "OK" : "FAILED");
  Serial.print(" events=");
  Serial.println(subEvents ? "OK" : "FAILED");
  if (!subStatus || !subEvents) {
    Serial.println("[MQTT] Check ACL/read permissions for these topics.");
  }
}
} // namespace

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println();
  Serial.println("=== Time4Med ESP32-S3 MQTT probe / NOT production firmware ===");
  Serial.println("[SAFETY] Disconnect the 12V lock power before using this sketch.");
  Serial.println("[SAFETY] This probe does NOT configure or control GPIO4/relay.");
  if (!configured()) Serial.println("[CONFIG] Fill secrets.h on your own device.");
  lastAttemptMs = millis() - RETRY_INTERVAL_MS;
}

void loop() {
  if (!configured()) {
    delay(1000);
    return;
  }

  if (WiFi.status() != WL_CONNECTED && client.connected()) {
    client.disconnect();
    Serial.println("[MQTT] Disconnected: Wi-Fi lost");
  }
  if (client.connected()) {
    client.loop();
    if (millis() - lastReportMs >= STATUS_INTERVAL_MS) {
      lastReportMs = millis();
      Serial.println("[MQTT] Broker connection OK (NOT proof the cabinet is online)");
    }
  } else if (millis() - lastAttemptMs >= RETRY_INTERVAL_MS) {
    lastAttemptMs = millis();
    tryConnect();
  }
  delay(10);
}
