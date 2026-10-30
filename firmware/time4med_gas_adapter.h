#pragma once
// ESP32-S3: Apps Script HTTPS / pullSchedule adapter. No MQTT and no GPIO.
// Requires ArduinoJson >= 6, ESP32 Arduino core, and a trusted Google CA bundle.
#include <Arduino.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include "time4med_schedule_core.h"

namespace time4med {
// staged is not modified if Wi-Fi, HTTPS, JSON or schedule validation fails.
// The caller must save an accepted Plan to NVS before activating it, and
// continue using its last good NVS snapshot when offline.
inline bool pullScheduleHttps(const char *webAppUrl, const char *deviceKey,
                              const char *caBundle, Plan &staged,
                              String &error) {
  error = "";
  if (!webAppUrl || !webAppUrl[0] || !deviceKey || !deviceKey[0] ||
      !caBundle || !caBundle[0]) { error="missing local configuration"; return false; }
  if (WiFi.status() != WL_CONNECTED) { error="WiFi offline"; return false; }
  WiFiClientSecure tls;
  tls.setCACert(caBundle); // Never use setInsecure() on the real device.
  HTTPClient http;
  http.setConnectTimeout(4000);
  http.setTimeout(9000);
  http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
  if (!http.begin(tls, webAppUrl)) { error="HTTPS begin failed"; return false; }
  http.addHeader("Content-Type", "text/plain;charset=utf-8");
  // Device key belongs only in the request body / local sketch config.
  // Do NOT put it in GitHub, URL queries, Serial logs or webpage JavaScript.
  String request = String("{\"action\":\"pullSchedule\",\"deviceKey\":\"") +
                   deviceKey + "\"}";
  int status = http.POST(request);
  if (status != HTTP_CODE_OK) {
    http.end(); error = "schedule HTTPS status="+String(status); return false;
  }
  if (http.getSize() > 60000) {
    http.end(); error = "response too large"; return false;
  }
  String body = http.getString();
  http.end();
  if (body.length() > 60000) { error="response too large"; return false; }
  DynamicJsonDocument doc(49152);
  const DeserializationError jsonError = deserializeJson(doc, body);
  if (jsonError) { error="invalid JSON"; return false; }
  if (doc["ok"].as<bool>() != true || !doc["schedules"].is<JsonArray>()) {
    error="server rejected pullSchedule"; return false;
  }
  JsonArray items = doc["schedules"].as<JsonArray>();
  if (items.size() > MAX_RAW_MEDICINES) {
    error="too many medicine records"; return false;
  }
  RawMedicine rows[MAX_RAW_MEDICINES];
  size_t n=0;
  for (JsonVariant item: items) {
    if (!item.is<JsonObject>()) { error="invalid schedule row"; return false; }
    rows[n++]={item["id"].as<const char*>(),item["patientId"].as<const char*>(),
      item["shelf"].as<unsigned>(),item["mealType"].as<unsigned>(),
      item["time"].as<const char*>(),item["days"].as<const char*>(),
      item["ledSlot"].as<unsigned>(),item["ledIndex"].as<unsigned>()};
  }
  char why[128] = {};
  Plan candidate = {};
  if (!buildPlan(rows,n,candidate,why,sizeof(why))) {
    error = String("schedule rejected: ")+why;
    return false;
  }
  staged = candidate;
  return true;
}
} // namespace time4med
