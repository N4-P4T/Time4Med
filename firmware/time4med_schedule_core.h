#pragma once
// Time4Med schedule core (C++11, no Arduino/MQTT dependency).
// Pure validation and scheduling only: this file NEVER drives the relay or GPIO.
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>

namespace time4med {
static const size_t MAX_RAW_MEDICINES = 128;
static const size_t MAX_SCHEDULES = 64;
static const uint8_t DAY_ALL = 0x7F;

struct RawMedicine {
  const char *id;          // nonempty real record id
  const char *patientId;   // P001/P002/P003
  unsigned shelf;          // 1..3
  unsigned mealType;       // 1..7
  const char *time;        // HH:mm
  const char *days;        // MON,TUE...SUN, or empty = everyday
  unsigned ledSlot;        // 1..4 (metadata, NOT GPIO)
  unsigned ledIndex;       // 0..11 (metadata, NOT GPIO)
};
struct Dose {
  uint8_t person;          // 0 P001, 1 P002, 2 P003
  uint8_t mealType;        // 1..7 (before/after meal distinction)
  uint16_t minuteOfDay;    // 0..1439
  uint8_t weekdays;       // bit0 MON ... bit6 SUN
  uint8_t ledIndex;       // 0..11; NOT GPIO
  int32_t lastTriggeredDate; // YYYYMMDD, -1 = not fired
};
struct Plan { Dose doses[MAX_SCHEDULES]; size_t count; };

inline bool fail(char *reason, size_t length, const char *message) {
  if (reason && length) snprintf(reason, length, "%s", message);
  return false;
}
inline int personIndex(const char *p) {
  if (!p) return -1;
  if (strcmp(p, "P001") == 0) return 0;
  if (strcmp(p, "P002") == 0) return 1;
  if (strcmp(p, "P003") == 0) return 2;
  return -1;
}
inline uint8_t mealLedSlot(unsigned meal) {
  return meal >= 1 && meal <= 2 ? 1 :
         meal >= 3 && meal <= 4 ? 2 :
         meal >= 5 && meal <= 6 ? 3 :
         meal == 7 ? 4 : 0;
}
inline bool parseClock(const char *text, uint16_t &minute) {
  if (!text || strlen(text) != 5 || text[2] != ':') return false;
  for (int n = 0; n < 5; ++n) {
    if (n != 2 && (text[n] < '0' || text[n] > '9')) return false;
  }
  const int hour = (text[0]-'0')*10+(text[1]-'0');
  const int min = (text[3]-'0')*10+(text[4]-'0');
  if (hour > 23 || min > 59) return false;
  minute = (uint16_t)(hour*60+min);
  return true;
}
inline bool parseDays(const char *text, uint8_t &mask) {
  if (!text || !*text) { mask = DAY_ALL; return true; }
  mask = 0;
  static const char* names[] = {"MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"};
  const char *cur = text;
  while (*cur) {
    const char *end = strchr(cur, ',');
    const size_t length = end ? (size_t)(end-cur) : strlen(cur);
    if (length != 3) return false;
    int index=-1;
    for (int i=0; i<7; ++i) if (strncmp(cur, names[i], 3)==0) {index=i;break;}
    if (index < 0) return false;
    mask |= (uint8_t)(1u<<index);
    if (!end) break;
    cur = end+1;
    if (!*cur) return false;
  }
  return mask != 0;
}
inline bool sameDose(const Dose &a, const Dose &b) {
  return a.person == b.person && a.mealType == b.mealType &&
         a.minuteOfDay == b.minuteOfDay && a.ledIndex == b.ledIndex;
}
// Stage the WHOLE server response in a temporary Plan. On failure, "output"
// is unchanged, so a malformed or truncated transfer cannot wipe offline doses.
// Duplicate medicines at the same person/meal/time coalesce into one audio cue;
// their weekday sets are combined.
inline bool buildPlan(const RawMedicine *raw, size_t count,
                      Plan &output, char *reason, size_t reasonLength,
                      bool allowEmpty = false) {
  if (count > MAX_RAW_MEDICINES || (count && !raw))
    return fail(reason, reasonLength, "too many or missing raw items");
  if (!count && !allowEmpty)
    return fail(reason, reasonLength, "empty snapshot rejected");
  Plan staged = {};
  for (size_t i = 0; i < count; ++i) {
    const RawMedicine &m = raw[i];
    const int person = personIndex(m.patientId);
    const uint8_t slot = mealLedSlot(m.mealType);
    uint16_t minute = 0;
    uint8_t weekdays = 0;
    if (!m.id || !m.id[0] || person < 0 || m.shelf != (unsigned)(person+1) ||
        !slot || m.ledSlot != slot || m.ledIndex != (unsigned)(person*4+slot-1) ||
        !parseClock(m.time, minute) || !parseDays(m.days, weekdays))
      return fail(reason, reasonLength, "invalid record: patient, meal, clock, days or LED mapping");
    Dose next = {(uint8_t)person, (uint8_t)m.mealType, minute,
                 weekdays, (uint8_t)m.ledIndex, -1};
    bool duplicate = false;
    for (size_t j = 0; j < staged.count; ++j) {
      if (sameDose(staged.doses[j], next)) {
        staged.doses[j].weekdays |= weekdays;
        duplicate = true;
        break;
      }
    }
    if (duplicate) continue;
    if (staged.count >= MAX_SCHEDULES)
      return fail(reason, reasonLength, "schedule capacity exceeded");
    staged.doses[staged.count++] = next;
  }
  output = staged;
  if (reason && reasonLength) reason[0] = '\0';
  return true;
}
// RAM-only atomic replacement after a fully validated snapshot. Preserve
// last-triggered dates for identical doses to avoid duplicate audio on sync.
inline void applyPlan(Plan &current, const Plan &verified) {
  Plan updated = verified;
  for (size_t i = 0; i < updated.count; ++i)
    for (size_t j = 0; j < current.count; ++j)
      if (sameDose(updated.doses[i], current.doses[j])) {
        updated.doses[i].lastTriggeredDate = current.doses[j].lastTriggeredDate;
        break;
      }
  current = updated;
}
inline bool due(const Dose &dose, int32_t localDateKey,
                uint8_t mondayBasedDay, uint16_t localMinute, uint8_t graceMinutes = 15) {
  if (localDateKey <= 0 || mondayBasedDay > 6 || localMinute >= 1440) return false;
  if (dose.lastTriggeredDate == localDateKey) return false;
  if (!(dose.weekdays & (1u << mondayBasedDay))) return false;
  return localMinute >= dose.minuteOfDay &&
         localMinute - dose.minuteOfDay <= graceMinutes;
}
inline uint16_t dueLedMask(const Plan &plan, int32_t localDateKey,
                           uint8_t mondayBasedDay, uint16_t localMinute) {
  uint16_t mask = 0;
  for (size_t i = 0; i < plan.count; ++i)
    if (due(plan.doses[i], localDateKey, mondayBasedDay, localMinute))
      mask |= (uint16_t)(1u << plan.doses[i].ledIndex);
  return mask;
}
} // namespace time4med
