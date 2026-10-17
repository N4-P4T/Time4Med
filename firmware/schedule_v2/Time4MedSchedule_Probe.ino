/*
 * Time4Med v0.23 READ-ONLY compilation probe (NOT production).
 * NO Wi-Fi, MQTT, GPIO, relay, camera, lock, or NVS writes.
 * Do not replace the cabinet firmware with this probe.
 */
#include <Arduino.h>
#include "Time4MedScheduleEngine.h"
struct MemoryStore: public t4m::Storage {
 bool load(t4m::Snapshot& value)override {value=t4m::Snapshot{};return true;}
 bool commit(const t4m::Snapshot&)override {return false;}
};
MemoryStore store;
void setup(){
 Serial.begin(115200);
 delay(500);
 static t4m::Engine engine(store);
 Serial.println("Time4Med 0.23 schedule staging probe, READ ONLY.");
 Serial.println(engine.handle("INFO|probeonly123",true,false,millis()).c_str());
 Serial.println("No MQTT commands are accepted or sent. No hardware pins touched.");
}
void loop(){delay(1000);}
