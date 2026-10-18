/*
 * Standalone compile-only ESP32-S3 transaction probe. NOT cabinet firmware.
 * No GPIO output, Wi-Fi, MQTT, lock, SD, or persistent NVS writes.
 */
#include <Arduino.h>
#include "Time4MedScheduleEngine.h"
#include "ScheduleNvsStorage.h"
#include "ScheduleMqttAuth.h"
#include "NvsReplayCounter.h"

struct ReadOnlyStorage : public t4m::Storage {
  bool load(t4m::Snapshot& result) override {result=t4m::Snapshot{};return true;}
  bool commit(const t4m::Snapshot&) override {return false;}
};
ReadOnlyStorage fakeStorage;
void setup(){
  Serial.begin(115200);
  delay(300);
  static t4m::Engine engine(fakeStorage);
  Serial.println("TIME4MED v0.23 ESP32-S3 compiler smoke test only");
  Serial.println(engine.handle("INFO|probeonly123",true,false,millis()).c_str());
  Serial.println("No network, actuator, or NVS write is active.");
}
void loop(){delay(1000);}
