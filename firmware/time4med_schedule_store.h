#pragma once
// ESP32 Preferences double-bank store for a fully verified Time4Med Plan.
// Never replaces the active bank until the new bank has been read back.
#include <Arduino.h>
#include <Preferences.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include "time4med_schedule_core.h"

namespace time4med {
static const uint32_t STORE_MAGIC = 0x54344D31u; // T4M1
static const uint32_t STORE_VERSION = 1;
static const char *const STORE_NAMESPACE = "t4m-gas"; // distinct from old MQTT NVS
struct StoredPlan {
  uint32_t magic;
  uint32_t version;
  uint32_t count;
  Dose doses[MAX_SCHEDULES];
  uint32_t checksum;
};
inline uint32_t storeHash(const StoredPlan &s) {
  const uint8_t *bytes=reinterpret_cast<const uint8_t*>(&s);
  uint32_t hash=2166136261u;
  for (size_t i=0;i<offsetof(StoredPlan,checksum);++i) {
    hash ^= bytes[i]; hash *= 16777619u;
  }
  return hash;
}
inline bool decodeStoredPlan(const StoredPlan &s, Plan &result) {
  if (s.magic!=STORE_MAGIC || s.version!=STORE_VERSION ||
      s.count>MAX_SCHEDULES || s.checksum!=storeHash(s)) return false;
  Plan check = {};
  check.count=s.count;
  for (size_t i=0;i<check.count;++i) {
    const Dose &d=s.doses[i];
    if (d.person>2 || d.mealType<1 || d.mealType>7 || d.minuteOfDay>=1440 ||
        !d.weekdays || (d.weekdays & ~DAY_ALL) ||
        d.ledIndex!=(unsigned)(d.person*4+mealLedSlot(d.mealType)-1)) return false;
    check.doses[i]=d;
  }
  result=check;
  return true;
}
inline bool readBank(Preferences &prefs, const char *name, Plan &result) {
  if (prefs.getBytesLength(name)!=sizeof(StoredPlan)) return false;
  StoredPlan wire={};
  if (prefs.getBytes(name,&wire,sizeof(wire))!=sizeof(wire)) return false;
  return decodeStoredPlan(wire,result);
}
inline bool loadSavedPlan(Plan &result) {
  Preferences prefs;
  if (!prefs.begin(STORE_NAMESPACE,true)) return false;
  const uint8_t active=prefs.getUChar("active",255);
  Plan staged={};
  bool ok=false;
  if (active==0 || active==1)
    ok=readBank(prefs,active==0?"bank0":"bank1",staged) ||
       readBank(prefs,active==0?"bank1":"bank0",staged);
  else
    ok=readBank(prefs,"bank0",staged) || readBank(prefs,"bank1",staged);
  prefs.end();
  if (ok) result=staged;
  return ok;
}
inline bool savePlan(Plan &plan) {
  if (plan.count>MAX_SCHEDULES) return false;
  StoredPlan next={};
  next.magic=STORE_MAGIC;
  next.version=STORE_VERSION;
  next.count=plan.count;
  for (size_t i=0;i<plan.count;++i)next.doses[i]=plan.doses[i];
  next.checksum=storeHash(next);
  Preferences prefs;
  if (!prefs.begin(STORE_NAMESPACE,false)) return false;
  const uint8_t active=prefs.getUChar("active",255);
  Plan existing={};
  const bool activeGood=(active<=1) &&
      readBank(prefs,active==0?"bank0":"bank1",existing);
  // If active bank became corrupt, overwrite THAT bank, not the only valid
  // fallback. This protects offline schedules across interrupted writes.
  const uint8_t target=activeGood?(active==0?1:0):(active<=1?active:0);
  const char *name=target==0?"bank0":"bank1";
  bool ok=prefs.putBytes(name,&next,sizeof(next))==sizeof(next);
  Plan check={};
  if(ok)ok=readBank(prefs,name,check);
  if(ok)ok=prefs.putUChar("active",target)==1;
  prefs.end();
  return ok;
}
} // namespace time4med
