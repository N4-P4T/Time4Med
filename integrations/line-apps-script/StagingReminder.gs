/**
 * Time4Med — isolated STAGING ONE-SHOT automatic notification test.
 *
 * Google Sheets staging source is physically separate from Time4Med_DB.
 * The simulated medicine stays named TEST_P001 in the Sheet; it cannot be
 * treated as real by the production engine, which excludes TEST medicines.
 *
 * Dependencies: Code.gs, SheetPreview.gs, ReminderPreview.gs,
 * ReminderLink.gs, AutoReminder.gs.
 *
 * Existing properties: LINE_CHANNEL_ACCESS_TOKEN, LINE_TEST_USER_ID,
 * TIME4MED_SHEET_ID (production ID).
 * New properties:
 *   LINE_STAGING_SHEET_ID   = ID of separate Time4Med_LINE_STAGING_2026-10-28
 *   LINE_STAGING_ARM_CONFIRM = YES  (explicit user consent to ONE test message)
 *
 * Do not enable LINE_AUTO_ENABLED or LINE_AUTO_SEND_ENABLED for this test.
 * This module NEVER sends a real medicine reminder.
 */
var T4M_STAGE_TITLE='Time4Med_LINE_STAGING_2026-10-28';
var T4M_STAGE_HANDLER='runTime4MedStagingOnce';
var T4M_STAGE_MEDICINE_ID='STAGING_01';
var T4M_STAGE_MEDICINE_NAME='TEST_P001';
var T4M_STAGE_SOURCE='STAGING_ONLY';
var T4M_STAGE_USER_ID='STAGING_ADMIN_01';
var T4M_STAGE_LOOKBACK_MINUTES=7;

function t4mStageProperties_() {
  return PropertiesService.getScriptProperties();
}
function t4mStageRecipient_() {
  var target=String(t4mStageProperties_().getProperty('LINE_TEST_USER_ID')||'').trim();
  if(!/^U[0-9a-fA-F]{32}$/.test(target))
    throw new Error('LINE_STAGING_TEST_USER_ID_INVALID');
  return target;
}
function t4mStageRead_() {
  var props=t4mStageProperties_();
  var stageId=String(props.getProperty('LINE_STAGING_SHEET_ID')||'').trim();
  var prodId=String(props.getProperty('TIME4MED_SHEET_ID')||'').trim();
  if(!/^[a-zA-Z0-9_-]{25,}$/.test(stageId) || !prodId ||
     stageId===prodId)
    throw new Error('LINE_STAGING_SHEET_ID_NOT_ISOLATED');
  var ss=SpreadsheetApp.openById(stageId);
  if(ss.getName()!==T4M_STAGE_TITLE)
    throw new Error('LINE_STAGING_SPREADSHEET_TITLE_MISMATCH');

  var med=t4mPreviewReadTable_(ss,'MealMedicines',1,[
    'record_id','name','patient_id','kind','meal_type','box_number',
    'reminder_time','is_active','source','reminder_days'
  ]);
  var user=t4mPreviewReadTable_(ss,'Users',4,[
    'user_id','role','patient_id','line_user_id','notification_enabled','status'
  ]);
  if(med.rows.length!==1 || user.rows.length!==1)
    throw new Error('LINE_STAGING_EXACTLY_ONE_RECORD_REQUIRED');

  var mr=med.rows[0],ur=user.rows[0];
  if(t4mPreviewGet_(med,mr,'record_id')!==T4M_STAGE_MEDICINE_ID ||
     t4mPreviewGet_(med,mr,'name')!==T4M_STAGE_MEDICINE_NAME ||
     t4mPreviewGet_(med,mr,'source')!==T4M_STAGE_SOURCE ||
     t4mPreviewGet_(med,mr,'patient_id')!=='P001' ||
     t4mPreviewGet_(med,mr,'kind').toLowerCase()!=='scheduled' ||
     t4mPreviewGet_(med,mr,'meal_type')!=='2' ||
     t4mPreviewGet_(med,mr,'box_number')!=='1' ||
     !t4mPreviewIsTrue_(t4mPreviewGet_(med,mr,'is_active')) ||
     t4mPreviewGet_(user,ur,'user_id')!==T4M_STAGE_USER_ID ||
     t4mPreviewGet_(user,ur,'role').toUpperCase()!=='ADMIN' ||
     t4mPreviewGet_(user,ur,'patient_id').toUpperCase()!=='ALL' ||
     t4mPreviewGet_(user,ur,'line_user_id')!=='' ||
     !t4mPreviewIsTrue_(t4mPreviewGet_(user,ur,'notification_enabled')) ||
     t4mPreviewGet_(user,ur,'status').toUpperCase()!=='ACTIVE')
    throw new Error('LINE_STAGING_SENTINEL_MISMATCH');

  return {ss:ss,med:med,user:user};
}
function t4mStageBuildPlan_(src, recipient, now) {
  // Convert the synthetic TEST row in memory ONLY so that the regular
  // production parser/planner/authorization functions can be exercised.
  var med={
    col:src.med.col,
    rows:src.med.rows.map(function(row) {
      var copy=row.slice();
      copy[src.med.col.name]='STAGING_SYNTHETIC';
      return copy;
    })
  };
  var users={
    col:src.user.col,
    rows:src.user.rows.map(function(row){
      var copy=row.slice();
      copy[src.user.col.line_user_id]=recipient;
      return copy;
    })
  };
  var allowed={};
  allowed[recipient]=true;
  var medicines=t4mAutoSourceSlots_(med);
  var recipients=t4mAutoAuthorizedRecipients_(users,allowed);
  return t4mAutoPlan_(medicines,recipients,now,T4M_STAGE_LOOKBACK_MINUTES);
}
function t4mStageCleanTriggers_() {
  var count=0;
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction()===T4M_STAGE_HANDLER) {
      ScriptApp.deleteTrigger(t);
      count++;
    }
  });
  return count;
}
/** Read-only staging setup probe. Does NOT call LINE or modify Sheet. */
function checkTime4MedStaging() {
  var props=t4mStageProperties_();
  var src=t4mStageRead_();
  var recipient=t4mStageRecipient_();
  var result={
    mode:'READ_ONLY_NO_LINE_SEND',
    isolatedSheetValidated:!!src.ss,
    testRecipientConfigured:!!recipient,
    armConfirmed:props.getProperty('LINE_STAGING_ARM_CONFIRM')==='YES',
    currentState:props.getProperty('LINE_STAGING_STATE')||'NOT_ARMED',
    dueBangkokTime:props.getProperty('LINE_STAGING_TIME')||null,
    messageSent:false
  };
  console.log(JSON.stringify(result));
  return result;
}
/**
 * Human-triggered arming. Sets a test time around four minutes from now,
 * edits ONLY the staging test row H2 and Q2, and creates ONE time trigger.
 * Does not send a LINE message by itself.
 */
function armTime4MedStagingOnce() {
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(10000))throw new Error('LINE_STAGING_BUSY');
  try {
    var props=t4mStageProperties_();
    if(props.getProperty('LINE_STAGING_ARM_CONFIRM')!=='YES')
      throw new Error('LINE_STAGING_ARM_NOT_CONFIRMED');
    if(props.getProperty('LINE_STAGING_STATE'))
      throw new Error('LINE_STAGING_ALREADY_ARMED_OR_ATTEMPTED');
    var target=t4mStageRecipient_();
    var src=t4mStageRead_();
    var existing=ScriptApp.getProjectTriggers().filter(function(t){
      return t.getHandlerFunction()===T4M_STAGE_HANDLER;
    });
    if(existing.length)
      throw new Error('LINE_STAGING_EXISTING_TRIGGER');
    var quota=t4mQuota_(t4mToken_());
    if(quota.usageApprox>=Math.min(250,quota.softCap))
      throw new Error('LINE_STAGING_QUOTA_GUARD');

    var dueEpoch=Math.ceil((new Date().getTime()+4*60000)/60000)*60000;
    var slot=t4mAutoSlotAt_(new Date(dueEpoch));
    var medSheet=src.ss.getSheetByName('MealMedicines');
    medSheet.getRange(2,src.med.col.reminder_time+1).setValue(slot.time);
    medSheet.getRange(2,src.med.col.reminder_days+1).setValue(slot.day);
    SpreadsheetApp.flush();

    // Verify the actual persisted staging schedule before installing.
    var verified=t4mStageRead_();
    if(t4mPreviewGet_(verified.med,verified.med.rows[0],'reminder_time')!==slot.time ||
       t4mPreviewGet_(verified.med,verified.med.rows[0],'reminder_days')!==slot.day)
      throw new Error('LINE_STAGING_SCHEDULE_WRITE_UNVERIFIED');

    ScriptApp.newTrigger(T4M_STAGE_HANDLER).timeBased().everyMinutes(1).create();
    props.setProperties({
      LINE_STAGING_STATE:'ARMED',
      LINE_STAGING_DUE_TS:String(dueEpoch),
      LINE_STAGING_TIME:slot.time,
      LINE_STAGING_DAY:slot.day,
      LINE_STAGING_DATE:slot.date
    });
    var result={mode:'ARMED_ONE_SHOT',dueBangkokDate:slot.date,
      dueBangkokTime:slot.time,testOnly:true,triggerEveryMinutes:1,
      messageSent:false};
    console.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}
/**
 * Time trigger; stop after one request, including failed or ambiguous pushes.
 * Can run many times while WAITING without sending anything.
 */
function runTime4MedStagingOnce() {
  if(t4mStageProperties_().getProperty('LINE_STAGING_STATE')!=='ARMED')
    return {mode:'NOT_ARMED_NO_SEND'};
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(10000))throw new Error('LINE_STAGING_BUSY');
  try {
    var props=t4mStageProperties_();
    if(props.getProperty('LINE_STAGING_STATE')!=='ARMED')
      return {mode:'NOT_ARMED_NO_SEND'};
    var dueTs=Number(props.getProperty('LINE_STAGING_DUE_TS'));
    var now=new Date();
    if(!Number.isSafeInteger(dueTs) || dueTs<0) {
      props.setProperty('LINE_STAGING_STATE','REVIEW_REQUIRED');
      t4mStageCleanTriggers_();
      throw new Error('LINE_STAGING_DUE_INVALID');
    }
    if(now.getTime()<dueTs)
      return {mode:'WAITING',messageSent:false};
    if(now.getTime()>dueTs+T4M_STAGE_LOOKBACK_MINUTES*60000) {
      props.setProperty('LINE_STAGING_STATE','EXPIRED_NO_SEND');
      t4mStageCleanTriggers_();
      var expired={mode:'EXPIRED_NO_SEND',messageSent:false};
      console.log(JSON.stringify(expired));
      return expired;
    }

    var target=t4mStageRecipient_();
    var src=t4mStageRead_();
    var slot=t4mAutoSlotAt_(new Date(dueTs));
    if(props.getProperty('LINE_STAGING_TIME')!==slot.time ||
       props.getProperty('LINE_STAGING_DAY')!==slot.day ||
       props.getProperty('LINE_STAGING_DATE')!==slot.date ||
       t4mPreviewGet_(src.med,src.med.rows[0],'reminder_time')!==slot.time ||
       t4mPreviewGet_(src.med,src.med.rows[0],'reminder_days')!==slot.day)
      throw new Error('LINE_STAGING_SCHEDULE_TAMPERED');
    var deliveries=t4mStageBuildPlan_(src,target,now);
    if(deliveries.length!==1 || deliveries[0].lineId!==target ||
       deliveries[0].time!==slot.time ||
       deliveries[0].eventDate!==slot.date ||
       deliveries[0].patients.join(',')!=='P001')
      throw new Error('LINE_STAGING_PLAN_NOT_SINGLE_RECIPIENT');

    var token=t4mToken_();
    var quota=t4mQuota_(token);
    if(quota.usageApprox>=Math.min(250,quota.softCap)){
      props.setProperty('LINE_STAGING_STATE','QUOTA_BLOCKED_NO_SEND');
      t4mStageCleanTriggers_();
      return {mode:'QUOTA_BLOCKED_NO_SEND',messageSent:false};
    }
    var message=t4mLinkedReminderPayload_('P001',slot.time,true);
    var payload=JSON.stringify({to:target,messages:[message]});
    var retryKey=Utilities.getUuid();
    props.setProperty('LINE_STAGING_RETRY_KEY',retryKey);
    props.setProperty('LINE_STAGING_STATE','ATTEMPTED');

    var response;
    try {
      response=UrlFetchApp.fetch(T4M_LINE_BASE+'/message/push',{
        method:'post',
        contentType:'application/json',
        headers:{
          Authorization:'Bearer '+token,
          'X-Line-Retry-Key':retryKey
        },
        payload:payload,
        muteHttpExceptions:true
      });
    } catch(e) {
      props.setProperty('LINE_STAGING_STATE','REVIEW_REQUIRED');
      t4mStageCleanTriggers_();
      return {mode:'REVIEW_REQUIRED',apiAccepted:false,
        deliveryConfirmed:false};
    }
    var accepted=response.getResponseCode()===200;
    props.setProperty('LINE_STAGING_STATE',
      accepted?'API_ACCEPTED':'REVIEW_REQUIRED');
    t4mStageCleanTriggers_();
    var result={mode:accepted?'API_ACCEPTED':'REVIEW_REQUIRED',
      apiAccepted:accepted,deliveryConfirmed:false,testOnly:true,
      websiteIncluded:true,oneTime:true};
    console.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}
/**
 * Manual stop. Only changes staging state and removes staging triggers;
 * production LINE_AUTO_* and other Time4Med triggers remain unchanged.
 */
function stopTime4MedStaging() {
  t4mStageProperties_().setProperty('LINE_STAGING_STATE','PAUSED_NO_SEND');
  var removed=t4mStageCleanTriggers_();
  var result={disabled:true,stagingTriggersRemoved:removed};
  console.log(JSON.stringify(result));
  return result;
}
