#pragma once
// ESP32 adapter — do not include in production until confirmed firmware migration.
// Uses separate namespace, never touches the legacy time4med-sch table.
#include <Preferences.h>
#include <cstring>
#include "Time4MedScheduleEngine.h"
namespace t4m {
class NvsScheduleStorage final : public Storage {
public:
 bool begin(){return prefs_.begin("t4m-sched-v2",false);}
 void end(){prefs_.end();}
 bool load(Snapshot& out) override {
   if(prefs_.getBytesLength("active")!=sizeof(Snapshot))return false;
   Snapshot temp{};
   if(prefs_.getBytes("active",&temp,sizeof(temp))!=sizeof(temp)||!validSnapshot(temp))return false;
   out=temp;return true;
 }
 bool commit(const Snapshot& snapshot) override {
   if(!validSnapshot(snapshot))return false;
   if(prefs_.putBytes("active",&snapshot,sizeof(snapshot))!=sizeof(snapshot))return false;
   Snapshot readback{};
   return load(readback)&&std::memcmp(&readback,&snapshot,sizeof(snapshot))==0;
 }
private:
 Preferences prefs_;
};
}
