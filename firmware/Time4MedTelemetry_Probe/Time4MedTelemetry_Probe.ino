/*
 * Time4Med ESP32-S3 v0.25 - compile/check probe ONLY.
 * NO Wi-Fi connection, NO MQTT, NO GPIO, NO solenoid/relay and NO
 * HTTP POST; safe to compile in GitHub Actions without credentials.
 *
 * Do not flash this over the actual medicine cabinet firmware.
 */
#include <Arduino.h>
#include "Time4MedStatusSender.h"

const char kPublicTestKey[] =
 "000102030405060708090a0b0c0d0e0f"
 "101112131415161718191a1b1c1d1e1f";

void setup() {
  Serial.begin(115200);
  delay(300);
  const t4m_telemetry::Status sample{
    false, true, false, true, "IDLE", "HEARTBEAT"
  };
  const String json=t4m_telemetry::makeStatusJson(sample);
  uint8_t key[32]{};
  const bool decoded=t4m_telemetry::decodeKey(kPublicTestKey,key);
  const String testMessage=String("T4M-STATUS-V1\n/api/device/telemetry\n")
    +"1792240000\n0123456789abcdef0123456789abcdef\n"+json;
  const String mac=t4m_telemetry::hmacSha256Hex(key,testMessage);
  const bool matchesExpected = mac == "778596a98d6dcc0db19ce26692bbb2e2dcbe327fedeafd54a1300352958e2995";
  t4m_telemetry::Sender disabled("",kPublicTestKey,"");
  Serial.println("Time4Med telemetry v0.25 COMPILE PROBE only");
  Serial.printf("Test HMAC key accepted: %s\n",decoded?"YES":"NO");
  Serial.printf("Sample payload bytes: %u\n",(unsigned)json.length());
  Serial.printf("HMAC bytes (hex): %u\n",(unsigned)mac.length());
  Serial.printf("Backend golden vector: %s\n",matchesExpected?"PASS":"FAIL");
  Serial.printf("Can send with placeholder config: %s\n",disabled.configured()?"YES":"NO");
  Serial.println("NO HTTP, NO MQTT and NO cabinet actuation performed.");
}
void loop() { delay(1000); }
