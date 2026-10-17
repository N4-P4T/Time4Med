/**
 * Time4Med schedule gateway contract v0.23 (pure, secret-free, no MQTT).
 * Reads server-side Sheets medication records; NEVER trusts client schedule.
 * Global cabinet replacement requires ADMIN and full visibility of all slots.
 * This module prepares a candidate for a future ACKed device transaction.
 */
export const DEVICE_ID = "ESP32S3-01";
export const CABINET_ID = "cabinet-01";
export const MAX_SLOTS = 18;
export const PROTOCOL = 2;
export const MAP = Object.freeze({
  P001: Object.freeze({userId:"U001",compartment:1}),
  P002: Object.freeze({userId:"U002",compartment:2}),
  P003: Object.freeze({userId:"U003",compartment:3})
});
export const MEALS = Object.freeze({
  1:"BEFORE_BREAKFAST",2:"AFTER_BREAKFAST",3:"BEFORE_LUNCH",
  4:"AFTER_LUNCH",5:"BEFORE_DINNER",6:"AFTER_DINNER",7:"BEDTIME"
});
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export class SchedulePlanError extends Error {
  constructor(code,message,status=422){super(message);this.code=code;this.status=status;}
}
const reject=(code,message,status)=>{throw new SchedulePlanError(code,message,status);};
const safe = v=>String(v??"").trim();
export function buildFullCabinetSchedule({user,medicines,patients,cabinetId=CABINET_ID}){
  if(cabinetId!==CABINET_ID)reject("UNKNOWN_CABINET","Unknown cabinet",404);
  if(!user || user.role!=="ADMIN")reject("ADMIN_REQUIRED","Only an authorized administrator can replace the complete cabinet schedule",403);
  if(!Array.isArray(medicines)||!Array.isArray(patients))reject("SOURCE_UNAVAILABLE","Server source data unavailable",503);
  const active=new Set(patients.filter(p=>safe(p.status).toUpperCase()==="ACTIVE").map(p=>safe(p.id)));
  const keys=new Set(), slots=[], rowIds=new Set();
  for(const row of medicines){
    if(!row || row.active===false)continue;
    if(!safe(row.id) || rowIds.has(safe(row.id)))reject("DUPLICATE_MEDICINE_ID","Source medicine IDs are missing or duplicated");
    rowIds.add(safe(row.id));
    const patientId=safe(row.patientId);
    if(!active.has(patientId))reject("PATIENT_INACTIVE","Medicine refers to missing or inactive patient");
    const person=MAP[patientId];
    if(!person)reject("UNMAPPED_PATIENT","Cabinet supports only mapped P001/P002/P003 patients");
    if(row.kind==="prn")continue;
    if(row.kind!=="scheduled")reject("INVALID_KIND","Medicine kind is not recognized");
    const meal=MEALS[Number(row.mealType)];
    if(!meal)reject("INVALID_MEAL","Unsupported medication meal type");
    const time=safe(row.time);
    if(!TIME.test(time))reject("INVALID_TIME","Medication time must be HH:MM in Asia/Bangkok");
    const box=safe(row.boxNumber);
    if(!/^[0-9]+$/.test(box)||Number(box)!==person.compartment)
      reject("WRONG_COMPARTMENT","Medication compartment does not match the fixed patient mapping");
    const key=person.userId+"|"+time+"|"+meal;
    if(keys.has(key))continue;
    keys.add(key);
    slots.push({userId:person.userId,patientId,compartment:person.compartment,time,meal});
  }
  slots.sort((a,b)=>a.userId.localeCompare(b.userId)||a.time.localeCompare(b.time)||a.meal.localeCompare(b.meal));
  if(slots.length>MAX_SLOTS)reject("CAPACITY_EXCEEDED","Cabinet supports at most 18 scheduled reminders");
  if(!slots.length)reject("EMPTY_REPLACEMENT","An empty cabinet schedule requires a separate, explicit maintenance workflow",409);
  return {protocol:PROTOCOL,cabinetId:CABINET_ID,deviceId:DEVICE_ID,timezone:"Asia/Bangkok",slots,sourceCount:rowIds.size};
}
export async function digestPlan(plan){
  // Canonicalize fixed-order arrays; no secret included in digest.
  const serial=JSON.stringify({
    protocol:PROTOCOL,cabinetId:plan.cabinetId,deviceId:plan.deviceId,
    timezone:"Asia/Bangkok",slots:plan.slots.map(s=>[s.userId,s.time,s.meal])
  });
  const sum=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(serial));
  return Array.from(new Uint8Array(sum),v=>v.toString(16).padStart(2,"0")).join("");
}

/** FNV-1a-64 over 'USER|HH:MM|MEAL\n' sorted by USER, time, meal.
 * Transport corruption check only (not MAC/authentication).
 */
export function transportFingerprint(slots){
  const mask=(1n<<64n)-1n;
  let acc=14695981039346656037n;
  const encode=new TextEncoder();
  for(const slot of slots){
    for(const byte of encode.encode(slot.userId+"|"+slot.time+"|"+slot.meal+"\n")){
      acc=((acc^BigInt(byte))*1099511628211n)&mask;
    }
  }
  return acc.toString(16).padStart(16,"0");
}

export async function preparePreview(input){
  const plan=buildFullCabinetSchedule(input);
  const sha256=await digestPlan(plan);
  return {...plan,sha256,revision16:sha256.slice(0,16),transportFingerprint:transportFingerprint(plan.slots),state:"PREVIEW_ONLY",
    acknowledged:false,applied:false,deviceOnline:null,
    notice:"Preview from server-side Google Sheets, not confirmed by ESP32-S3"};
}
