/**
 * Time4Med automatic LINE reminders: Google Sheets -> Google Apps Script -> LINE.
 * Standalone opt-in engine; intentionally DISABLED until manually configured.
 *
 * Requires Code.gs, SheetPreview.gs, ReminderPreview.gs and ReminderLink.gs.
 *
 * Existing Script properties:
 *   TIME4MED_SHEET_ID, LINE_CHANNEL_ACCESS_TOKEN
 * New properties (do NOT configure until production data/recipients verified):
 *   LINE_AUTO_ENABLED=YES
 *   LINE_AUTO_SEND_ENABLED=YES
 *   LINE_AUTO_ALLOWED_USER_IDS=U...  (explicit comma-separated recipient IDs)
 *   LINE_AUTO_INSTALL_CONFIRM=YES    (only for installing 5-min trigger)
 *
 * Data source:
 *   MealMedicines header row 1 + NEW COLUMN "reminder_days"
 *   Users header row 4
 *
 * No Cloudflare, no public webhook, no write to Google Sheets.
 * Never treats TEST_, DEMO or sample medicines as a real reminder.
 * No automatic network retries: mark ATTEMPTED before LINE push.
 */
var T4M_AUTO_HANDLER = 'runTime4MedReminders';
var T4M_AUTO_MAX_CATCHUP_MINUTES = 7;
var T4M_AUTO_SOFT_QUOTA = 250;

function t4mAutoProperty_(name) {
  return String(PropertiesService.getScriptProperties().getProperty(name)||'').trim();
}
function t4mAutoAllowedRecipients_() {
  var raw=t4mAutoProperty_('LINE_AUTO_ALLOWED_USER_IDS');
  if (!raw) return {};
  var result={};
  raw.split(',').forEach(function(s){
    var id=s.trim();
    if(!/^U[0-9a-fA-F]{32}$/.test(id))
      throw new Error('LINE_AUTO_ALLOWLIST_INVALID');
    result[id]=true;
  });
  return result;
}
/** No implicit every-day schedule. Must be explicitly configured per row. */
function t4mAutoParseDays_(value) {
  var raw=String(value||'').trim().toUpperCase();
  if(raw==='DAILY') return ['MON','TUE','WED','THU','FRI','SAT','SUN'];
  if(!raw) return null;
  var days=raw.split(',').map(function(d){return d.trim();});
  if(days.some(function(day) {
    return ['MON','TUE','WED','THU','FRI','SAT','SUN'].indexOf(day)===-1;
  }))return null;
  var uniq={};
  days.forEach(function(d){uniq[d]=true;});
  return Object.keys(uniq);
}
/** Private planner uses LINE IDs internally; never log or return them publicly. */
function t4mAutoSourceSlots_(medData) {
  var slots={},stats={
    records:0,active:0,excludedDemo:0,invalidRecords:0,
    missingOrInvalidDays:0,validRecords:0,uniqueMealSlots:0
  };
  if(!Object.prototype.hasOwnProperty.call(medData.col,'reminder_days'))
    return {slots:[],stats:stats,daysColumnPresent:false};
  medData.rows.forEach(function(row) {
    if(!String(row[0]||'').trim())return;
    stats.records++;
    if(!t4mPreviewIsTrue_(t4mPreviewGet_(medData,row,'is_active')))return;
    stats.active++;
    var name=t4mPreviewGet_(medData,row,'name');
    if(t4mPreviewIsDemo_(name)){stats.excludedDemo++;return;}
    var id=t4mPreviewGet_(medData,row,'patient_id');
    var box=t4mPreviewGet_(medData,row,'box_number');
    var meal=t4mPreviewGet_(medData,row,'meal_type');
    var time=t4mPreviewGet_(medData,row,'reminder_time');
    if(!Object.prototype.hasOwnProperty.call(T4M_PREVIEW_VALID_PATIENTS,id) ||
       !/^\d{1,2}$/.test(box) ||
       Number(box)!==T4M_PREVIEW_VALID_PATIENTS[id] ||
       !/^[1-7]$/.test(meal) ||
       !t4mPreviewValidTime_(time) ||
       t4mPreviewGet_(medData,row,'kind').toLowerCase()!=='scheduled'){
      stats.invalidRecords++;return;
    }
    var days=t4mAutoParseDays_(t4mPreviewGet_(medData,row,'reminder_days'));
    if(!days || !days.length) {stats.missingOrInvalidDays++;return;}
    stats.validRecords++;
    days.forEach(function(day){
      // Patients may have many medicines in the same meal.
      var key=day+'|'+time+'|'+id+'|'+meal;
      if(!Object.prototype.hasOwnProperty.call(slots,key))
        slots[key]={day:day,time:time,patient:id,meal:meal};
    });
  });
  var result=Object.keys(slots).map(function(k){return slots[k];});
  stats.uniqueMealSlots=result.length;
  return {slots:result,stats:stats,daysColumnPresent:true};
}
function t4mAutoAuthorizedRecipients_(usersData,allowed) {
  var byLineId={},duplicates={},stats={candidateRows:0,validRows:0,
    duplicateRecipientIds:0,allowedRecipients:0};
  usersData.rows.forEach(function(row) {
    if(!String(row[0]||'').trim())return;
    stats.candidateRows++;
    var role=t4mPreviewGet_(usersData,row,'role').toUpperCase();
    var line=t4mPreviewGet_(usersData,row,'line_user_id');
    if(!allowed[line])return;
    var scope=t4mScopeForUser_(role,t4mPreviewGet_(usersData,row,'patient_id'));
    if((role!=='ADMIN' && role!=='CAREGIVER') ||
       t4mPreviewGet_(usersData,row,'status').toUpperCase()!=='ACTIVE' ||
       !t4mPreviewIsTrue_(t4mPreviewGet_(usersData,row,'notification_enabled')) ||
       !/^U[0-9a-fA-F]{32}$/.test(line) ||
       !Object.keys(scope).length)return;
    stats.validRows++;
    if(Object.prototype.hasOwnProperty.call(byLineId,line))
      duplicates[line]=true;
    else byLineId[line]=scope;
  });
  Object.keys(duplicates).forEach(function(id){delete byLineId[id];});
  stats.duplicateRecipientIds=Object.keys(duplicates).length;
  stats.allowedRecipients=Object.keys(byLineId).length;
  return {recipients:byLineId,stats:stats};
}
function t4mAutoSlotAt_(date) {
  var formatted=Utilities.formatDate(date,T4M_REMINDER_TZ,'yyyyMMdd|HH:mm|EEE');
  var fields=formatted.split('|');
  if(fields.length!==3 || !/^\d{8}$/.test(fields[0]) ||
     !t4mPreviewValidTime_(fields[1]) ||
     ['MON','TUE','WED','THU','FRI','SAT','SUN'].indexOf(fields[2].toUpperCase())<0)
    throw new Error('LINE_AUTO_TIME_FORMAT_INVALID');
  return {date:fields[0],time:fields[1],day:fields[2].toUpperCase()};
}
/** Build one delivery per authorized LINE recipient, date and minute. */
function t4mAutoPlan_(slots,recipients,now,maxLookback) {
  if(maxLookback<0 || maxLookback>T4M_AUTO_MAX_CATCHUP_MINUTES)
    throw new Error('LINE_AUTO_LOOKBACK_INVALID');
  var plan={},all=slots.slots;
  for(var minutes=0;minutes<=maxLookback;minutes++){
    var time=t4mAutoSlotAt_(new Date(now.getTime()-minutes*60000));
    var due=all.filter(function(s){return s.day===time.day && s.time===time.time;});
    if(!due.length)continue;
    Object.keys(recipients.recipients).forEach(function(lineId){
      var owned=recipients.recipients[lineId];
      var patients={};
      due.forEach(function(item) {
        if(owned[item.patient])patients[item.patient]=true;
      });
      if(!Object.keys(patients).length)return;
      var key=time.date+'|'+time.time+'|'+lineId;
      plan[key]={eventDate:time.date,time:time.time,lineId:lineId,
        patients:Object.keys(patients).sort()};
    });
  }
  // A single minute/recipient is one LINE message, even for multiple patients/medicines.
  return Object.keys(plan).sort().map(function(k){return plan[k];});
}
function t4mAutoHashKey_(delivery) {
  var raw=delivery.eventDate+'|'+delivery.time+'|'+delivery.lineId;
  var digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,raw);
  var encoded=Utilities.base64EncodeWebSafe(digest).replace(/=+$/,'');
  return 'T4M_AUTO_V1_'+delivery.eventDate+'_'+encoded.substring(0,24);
}
function t4mAutoMessage_(delivery) {
  if(!delivery.patients.length || delivery.patients.some(function(pid){
    return !Object.prototype.hasOwnProperty.call(T4M_PREVIEW_VALID_PATIENTS,pid);
  }))throw new Error('LINE_AUTO_PATIENT_INVALID');
  if(!t4mPreviewValidTime_(delivery.time))throw new Error('LINE_AUTO_TIME_INVALID');

  return {
    type:'text',
    text:[
      '🔔 [Time4Med] แจ้งเตือนมื้อยา',
      'ผู้สูงอายุ: '+delivery.patients.join(', '),
      'เวลาตามตาราง: '+delivery.time+' น.',
      '',
      'กรุณาเข้าเว็บไซต์เพื่อตรวจสอบรายการยาและติดตามสถานะการรับประทานยา',
      '👉 '+T4M_OFFICIAL_WEBSITE_URL,
      'กรุณาเข้าสู่ระบบก่อนเข้าถึงข้อมูล'
    ].join('\n'),
    quickReply:{
      items:[{type:'action',action:{
        type:'uri',label:'เปิดเว็บไซต์',uri:T4M_OFFICIAL_WEBSITE_URL
      }}]
    }
  };
}
function t4mAutoReadSource_() {
  var id=t4mAutoProperty_('TIME4MED_SHEET_ID');
  if(!/^[a-zA-Z0-9_-]{25,}$/.test(id))
    throw new Error('LINE_AUTO_SHEET_ID_MISSING');
  var ss=SpreadsheetApp.openById(id);
  var meds=t4mPreviewReadTable_(ss,'MealMedicines',1,
    ['record_id','patient_id','name','kind','meal_type','box_number','reminder_time','is_active']);
  var users=t4mPreviewReadTable_(ss,'Users',4,
    ['user_id','role','patient_id','line_user_id','notification_enabled','status']);
  return {meds:meds,users:users};
}
/**
 * Does not send or modify anything. Useful before any activation.
 * No user IDs, email, medicine names, or tokens printed.
 */
function checkTime4MedAutoReadiness() {
  var data=t4mAutoReadSource_();
  var allowed=t4mAutoAllowedRecipients_();
  var m=t4mAutoSourceSlots_(data.meds);
  var u=t4mAutoAuthorizedRecipients_(data.users,allowed);
  var hasPotentialMatch=m.slots.some(function(s){
    return Object.keys(u.recipients).some(function(id){
      return !!u.recipients[id][s.patient];
    });
  });
  var result={
    mode:'READ_ONLY_NO_NOTIFICATIONS',
    enabled:t4mAutoProperty_('LINE_AUTO_ENABLED')==='YES',
    sendEnabled:t4mAutoProperty_('LINE_AUTO_SEND_ENABLED')==='YES',
    daysColumnPresent:m.daysColumnPresent,
    medicineStats:m.stats,
    recipientStats:u.stats,
    hasAuthorizedScheduleMatch:hasPotentialMatch,
    readyToInstall:m.daysColumnPresent && m.stats.validRecords>0 &&
      hasPotentialMatch && u.stats.allowedRecipients>0
  };
  console.log(JSON.stringify(result));
  return result;
}
/** Manually execute to inspect next possible events without sending. */
function previewTime4MedAutoReminders() {
  var data=t4mAutoReadSource_();
  var allowed=t4mAutoAllowedRecipients_();
  var m=t4mAutoSourceSlots_(data.meds);
  var u=t4mAutoAuthorizedRecipients_(data.users,allowed);
  var deliveries=t4mAutoPlan_(m,u,new Date(),T4M_AUTO_MAX_CATCHUP_MINUTES);
  var result={mode:'PREVIEW_ONLY',daysColumnPresent:m.daysColumnPresent,
    matchingDeliveryCount:deliveries.length,notificationsSent:0};
  console.log(JSON.stringify(result));
  return result;
}
/**
 * Real scheduled entrypoint. Defaults to OFF.
 * All return values/logs are de-identified.
 */
function runTime4MedReminders() {
  if(t4mAutoProperty_('LINE_AUTO_ENABLED')!=='YES' ||
     t4mAutoProperty_('LINE_AUTO_SEND_ENABLED')!=='YES'){
    var idle={mode:'DISABLED_NO_SEND',notificationsSent:0};
    console.log(JSON.stringify(idle));
    return idle;
  }

  var lock=LockService.getScriptLock();
  if(!lock.tryLock(10000))throw new Error('LINE_AUTO_BUSY');
  try {
    var data=t4mAutoReadSource_();
    var allowed=t4mAutoAllowedRecipients_();
    if(!Object.keys(allowed).length)
      throw new Error('LINE_AUTO_ALLOWLIST_REQUIRED');
    var m=t4mAutoSourceSlots_(data.meds);
    if(!m.daysColumnPresent)
      throw new Error('LINE_AUTO_REMINDER_DAYS_COLUMN_MISSING');
    var u=t4mAutoAuthorizedRecipients_(data.users,allowed);
    var deliveries=t4mAutoPlan_(m,u,new Date(),T4M_AUTO_MAX_CATCHUP_MINUTES);
    var props=PropertiesService.getScriptProperties();
    var unsent=deliveries.filter(function(d){
      return !props.getProperty(t4mAutoHashKey_(d));
    });
    if(!unsent.length){
      var none={mode:'RUN_NO_DUE_OR_ALREADY_ATTEMPTED',notificationsSent:0};
      console.log(JSON.stringify(none));
      return none;
    }

    var token=t4mToken_();
    var quota=t4mQuota_(token);
    var cap=Math.min(T4M_AUTO_SOFT_QUOTA,quota.softCap);
    var remaining=Math.max(0,cap-quota.usageApprox);
    var sent=0,failed=0,quotaBlocked=0;
    unsent.forEach(function(item){
      // Quota usage is approximate; cap guards both channel quota and pilot traffic.
      if(remaining<=0){quotaBlocked++;return;}
      var key=t4mAutoHashKey_(item);
      // Defense-in-depth when a caller retries manually while lock active.
      if(props.getProperty(key))return;
      var retryKey=Utilities.getUuid();
      props.setProperty(key,'ATTEMPTED');
      remaining--;
      var payload=JSON.stringify({to:item.lineId,messages:[t4mAutoMessage_(item)]});
      var response;
      try {
        response=UrlFetchApp.fetch(T4M_LINE_BASE+'/message/push',{
          method:'post',
          contentType:'application/json',
          headers:{Authorization:'Bearer '+token,'X-Line-Retry-Key':retryKey},
          payload:payload,
          muteHttpExceptions:true
        });
      } catch(e) {
        // A timeout could still have delivered. Do not auto retry or expose error.
        props.setProperty(key,'REVIEW_REQUIRED');
        failed++;
        return;
      }
      if(response.getResponseCode()===200){
        props.setProperty(key,'API_ACCEPTED');
        sent++;
      } else {
        props.setProperty(key,'REVIEW_REQUIRED');
        failed++;
      }
    });
    var result={mode:'LIVE_API_ATTEMPTS',apiAccepted:sent,
      deliveryConfirmed:false,reviewRequired:failed,quotaBlocked:quotaBlocked};
    console.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}
/**
 * Only a human-admin can call this manually. Idempotent trigger installation.
 * Checks real sheet configuration and explicit recipient list before arming.
 */
function installTime4MedReminderTrigger() {
  if(t4mAutoProperty_('LINE_AUTO_ENABLED')!=='YES' ||
     t4mAutoProperty_('LINE_AUTO_SEND_ENABLED')!=='YES' ||
     t4mAutoProperty_('LINE_AUTO_INSTALL_CONFIRM')!=='YES')
    throw new Error('LINE_AUTO_INSTALL_NOT_CONFIRMED');
  var ready=checkTime4MedAutoReadiness();
  if(!ready.readyToInstall)
    throw new Error('LINE_AUTO_DATA_NOT_READY');
  var existing=ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction()===T4M_AUTO_HANDLER;
  });
  if(existing.length>1)throw new Error('LINE_AUTO_MULTIPLE_TRIGGERS');
  if(existing.length===1)return {alreadyInstalled:true};
  ScriptApp.newTrigger(T4M_AUTO_HANDLER).timeBased().everyMinutes(5).create();
  return {installed:true,everyMinutes:5};
}
/**
 * Manual emergency stop: first DISABLE sends, then delete only this engine's triggers.
 * Does not remove ledger entries or any other Time4Med triggers.
 */
function pauseTime4MedReminders() {
  PropertiesService.getScriptProperties().setProperty('LINE_AUTO_ENABLED','NO');
  var count=0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if(t.getHandlerFunction()===T4M_AUTO_HANDLER){
      ScriptApp.deleteTrigger(t);count++;
    }
  });
  return {disabled:true,triggersRemoved:count};
}
