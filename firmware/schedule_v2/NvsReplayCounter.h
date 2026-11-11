#pragma once
// Fail-closed anti-replay sequence storage; ESP32 only.
// Requires explicit out-of-band provisioning; absent NVS means NO MQTT commands.
#include <Preferences.h>
#include <cstdint>
#include "Time4MedScheduleEngine.h"
namespace t4m {
class NvsReplayCounter final {
public:
 bool begin(){return prefs_.begin("t4m-replay-v2",false);}
 void end(){prefs_.end();}
 bool load(std::uint64_t& out) {
   if(prefs_.getBytesLength("lastseq")!=sizeof(std::uint64_t))return false;
   return prefs_.getBytes("lastseq",&out,sizeof(out))==sizeof(out);
 }
 // Persist BEFORE dispatching any authenticated command. An ACK lost after
 // increment requires the server to read status and retry with a NEW counter.
 bool accept(std::uint64_t next){
   std::uint64_t prev=0;
   if(!load(prev)||next<=prev)return false;
   if(prefs_.putBytes("lastseq",&next,sizeof(next))!=sizeof(next))return false;
   std::uint64_t verify=0;
   return load(verify)&&verify==next;
 }
private:
 Preferences prefs_;
};
}
