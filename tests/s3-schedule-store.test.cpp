#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <Preferences.h>
#include "../firmware/time4med_schedule_store.h"
using namespace time4med;
int main(){
  Preferences::clear();
  Plan unchanged={}; unchanged.count=99;
  assert(!loadSavedPlan(unchanged));
  assert(unchanged.count==99);
  Plan one={}; one.count=1;
  one.doses[0]={0,2,510,0x7f,0,20261030};
  assert(savePlan(one));
  Plan loaded={}; assert(loadSavedPlan(loaded));
  assert(loaded.count==1&&loaded.doses[0].minuteOfDay==510);
  assert(loaded.doses[0].lastTriggeredDate==20261030);
  Plan two=one;
  two.doses[0].minuteOfDay=720;
  assert(savePlan(two));
  assert(loadSavedPlan(loaded)&&loaded.doses[0].minuteOfDay==720);
  // Corrupt the active bank; older verified bank is retained.
  const uint8_t active=Preferences::data["active"][0];
  Preferences::data[active==0?"bank0":"bank1"][10]^=0xFF;
  assert(loadSavedPlan(loaded)&&loaded.doses[0].minuteOfDay==510);
  Plan three=one; three.doses[0].minuteOfDay=900;
  Preferences::failWrite=true;
  assert(!savePlan(three));
  assert(loadSavedPlan(loaded)&&loaded.doses[0].minuteOfDay==510);
  Preferences::failWrite=false;
  assert(savePlan(three)); // repair corrupt bank without losing fallback
  assert(loadSavedPlan(loaded)&&loaded.doses[0].minuteOfDay==900);
  puts("PASS: NVS double-bank recovery, checksum validation, reboot persistence and failed write");
}
