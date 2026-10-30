#include "../firmware/time4med_schedule_core.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
using namespace time4med;
static RawMedicine med(const char *id, const char *person, unsigned shelf,
                       unsigned meal, const char *clock, const char *days) {
  return {id, person, shelf, meal, clock, days, mealLedSlot(meal),
          (shelf-1)*4 + mealLedSlot(meal)-1};
}
int main() {
  Plan current = {};
  char why[128] = {};
  RawMedicine input[] = {
    med("M1", "P001", 1, 2, "08:30", "MON,WED"),
    med("M2", "P001", 1, 2, "08:30", "FRI"),
    med("M3", "P002", 2, 2, "08:30", "MON"),
    med("M4", "P003", 3, 7, "21:00", "SAT,SUN")
  };
  assert(buildPlan(input, 4, current, why, sizeof(why)));
  assert(current.count == 3); // same person/meal/time -> one spoken reminder
  assert(current.doses[0].weekdays == ((1u<<0)|(1u<<2)|(1u<<4)));
  assert(dueLedMask(current, 20261030, 4, 510) == (1u<<0)); // Friday 08:30 P001
  assert(dueLedMask(current, 20261026, 0, 510) == ((1u<<0)|(1u<<4))); // Monday two shelves
  assert(dueLedMask(current, 20261030, 4, 525) == (1u<<0)); // grace 15min
  assert(dueLedMask(current, 20261030, 4, 526) == 0);
  current.doses[0].lastTriggeredDate = 20261030;
  Plan fresh = {};
  assert(buildPlan(input, 4, fresh, why, sizeof(why)));
  applyPlan(current, fresh);
  assert(current.doses[0].lastTriggeredDate == 20261030);
  assert(dueLedMask(current, 20261030, 4, 510) == 0); // no duplicate on re-sync
  assert(dueLedMask(current, 20261031, 5, 510) == 0); // Saturday not configured
  assert(dueLedMask(current, 20261102, 0, 510) == ((1u<<0)|(1u<<4)));

  Plan before = current;
  RawMedicine invalid = med("BAD", "P004", 4, 2, "08:30", "MON");
  assert(!buildPlan(&invalid, 1, current, why, sizeof(why)));
  assert(memcmp(&before, &current, sizeof(before)) == 0);
  invalid = med("BAD", "P003", 3, 2, "25:00", "MON");
  assert(!buildPlan(&invalid, 1, current, why, sizeof(why)));
  invalid = med("BAD", "P001", 1, 2, "08:30", "FUNDAY");
  assert(!buildPlan(&invalid, 1, current, why, sizeof(why)));
  invalid = med("BAD", "P001", 1, 2, "08:30", "MON,");
  assert(!buildPlan(&invalid, 1, current, why, sizeof(why)));
  invalid = med("BAD", "P001", 1, 2, "08:30", "MON");
  invalid.ledIndex = 9; // APP's index is metadata, not a GPIO pin
  assert(!buildPlan(&invalid, 1, current, why, sizeof(why)));
  assert(!buildPlan(nullptr, 0, current, why, sizeof(why)));
  assert(memcmp(&before, &current, sizeof(before)) == 0);
  assert(buildPlan(nullptr, 0, current, why, sizeof(why), true));
  assert(current.count == 0); // explicit maintenance-only clear

  RawMedicine capacity[MAX_SCHEDULES+1];
  char ids[MAX_SCHEDULES+1][12];
  for (size_t i=0;i<MAX_SCHEDULES+1;i++) {
    snprintf(ids[i],sizeof(ids[i]),"ID%zu", i);
    // Each record gets a distinct persistent clock below.
    capacity[i] = med(ids[i], "P001", 1, 2, "07:00", "MON");
  }
  char times[MAX_SCHEDULES+1][6];
  for (size_t i=0;i<MAX_SCHEDULES+1;i++) {
    snprintf(times[i],sizeof(times[i]),"%02u:%02u", (unsigned)(7+i/60), (unsigned)(i%60));
    capacity[i].time=times[i];
  }
  assert(!buildPlan(capacity, MAX_SCHEDULES+1, current, why, sizeof(why)));
  assert(current.count == 0);
  puts("PASS: P001-P003, 12 LED logical mapping, weekdays, grouping, no partial overwrite, offline dates");
}
