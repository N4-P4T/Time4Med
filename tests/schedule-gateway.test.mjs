import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import worker from "../backend/worker-v020-preview.mjs";
import {preparePreview,buildFullCabinetSchedule, SchedulePlanError,transportFingerprint,MAP,MAX_SLOTS} from "../backend/schedule-plan.mjs";
const people=[{id:"P001",status:"ACTIVE"},{id:"P002",status:"ACTIVE"},{id:"P003",status:"ACTIVE"}];
const admin={id:"test-admin",role:"ADMIN",patients:["ALL"]};
const caregiver={id:"test-caregiver",role:"CAREGIVER",patients:["P001"]};
const med=(id,patientId,time,mealType,boxNumber,kind="scheduled")=>
 ({id,patientId,time,mealType,boxNumber,kind,active:true});
const meds=[
 med("a","P001","08:30",2,"1"),
 med("b","P001","08:30",2,"1"),
 med("c","P002","18:30",6,"2"),
 med("d","P003","20:00",7,"3"),
 med("e","P001","",2,"1","prn")
];
const plan=await preparePreview({user:admin,patients:people,medicines:meds});
assert.equal(plan.protocol,2);
assert.equal(plan.slots.length,3,"Same person, time and meal dedupe");
assert.equal(plan.sourceCount,5);
assert.deepEqual(plan.slots.map(s=>s.userId),["U001","U002","U003"]);
assert.deepEqual(plan.slots.map(s=>s.compartment),[1,2,3]);
assert.equal(plan.applied,false);
assert.equal(plan.acknowledged,false);
assert.equal(plan.deviceOnline,null);
assert.match(plan.sha256,/^[a-f0-9]{64}$/);
assert.equal(plan.revision16,plan.sha256.slice(0,16));
assert.equal(plan.transportFingerprint,transportFingerprint(plan.slots));
assert.match(plan.transportFingerprint,/^[a-f0-9]{16}$/);
const second=await preparePreview({user:admin,patients:people,medicines:[...meds].reverse()});
assert.equal(second.sha256,plan.sha256,"Reordered Sheet rows must not change digest");

const mustFail=(code,body)=>{
 assert.throws(body,e=>e instanceof SchedulePlanError&&e.code===code,code);
};
mustFail("ADMIN_REQUIRED",()=>buildFullCabinetSchedule({user:caregiver,patients:people,medicines:meds}));
mustFail("WRONG_COMPARTMENT",()=>buildFullCabinetSchedule({user:admin,patients:people,medicines:[med("1","P001","08:30",2,"2")]}));
mustFail("UNMAPPED_PATIENT",()=>buildFullCabinetSchedule({user:admin,patients:[...people,{id:"P004",status:"ACTIVE"}],medicines:[med("1","P004","08:30",2,"4")]}));
mustFail("PATIENT_INACTIVE",()=>buildFullCabinetSchedule({user:admin,patients:people,medicines:[med("1","P004","08:30",2,"4")]}));
mustFail("INVALID_TIME",()=>buildFullCabinetSchedule({user:admin,patients:people,medicines:[med("1","P001","24:00",2,"1")]}));
mustFail("INVALID_MEAL",()=>buildFullCabinetSchedule({user:admin,patients:people,medicines:[med("1","P001","08:30",99,"1")]}));
mustFail("EMPTY_REPLACEMENT",()=>buildFullCabinetSchedule({user:admin,patients:people,medicines:[med("1","P001","",2,"1","prn")]}));
mustFail("DUPLICATE_MEDICINE_ID",()=>buildFullCabinetSchedule({user:admin,patients:people,medicines:[med("1","P001","08:30",2,"1"),med("1","P001","12:30",4,"1")]}));
const large=Array.from({length:19},(_,i)=>med(String(i),"P001",String(i).padStart(2,"0")+":00",2,"1"));
mustFail("CAPACITY_EXCEEDED",()=>buildFullCabinetSchedule({user:admin,patients:people,medicines:large}));
assert.equal(MAX_SLOTS,18);
assert.equal(MAP.P002.compartment,2);
const workerSource=readFileSync("backend/worker-v020-preview.mjs","utf8");
assert.match(workerSource,/if\(pathname==='\/api\/cabinets\/'\+CABINET_ID\+'\/schedule\/preview'/);
assert.match(workerSource,/adminOnly\(user\)/);
assert.match(workerSource,/SCHEDULE_GATEWAY_DISABLED/);
assert.doesNotMatch(workerSource,/mqtt\.connect\s*\(|mqtt\.publish\s*\(|client\.publish\s*\(/);
const res=await worker.fetch(new Request("https://worker.example.invalid/api/cabinets/cabinet-01/schedule/commit",{method:"POST"}),{ALLOWED_ORIGIN:"https://n4-p4t.github.io"});
assert.equal(res.status,401,"Unauthenticated POST must be rejected before any backend work");
console.log("PASS: admin-only server source, fixed compartment mapping, PRN, dedupe, digest, empty/oversize rejection, disabled commit.");
