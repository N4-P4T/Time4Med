/**
 * Time4Med — read-only preflight for future scheduled LINE reminders.
 * Requires SheetPreview.gs and existing TIME4MED_SHEET_ID Script Property.
 *
 * Does NOT send LINE, create triggers/webhooks, change Sheets, or use Cloudflare.
 *
 * MealMedicines has time but no days_of_week; therefore this is only a
 * candidate/scope preview and cannot be treated as authorization to send.
 */
var T4M_REMINDER_TZ='Asia/Bangkok';

/** Parse an explicitly granted patient scope, fail closed on unknown tokens. */
function t4mScopeForUser_(role, raw) {
  var result={};
  var field=String(raw||'').trim().toUpperCase();
  if (role==='ADMIN' && field==='ALL') {
    Object.keys(T4M_PREVIEW_VALID_PATIENTS).forEach(function(pid){result[pid]=true;});
    return result;
  }
  if (!field || field==='ALL') return {};
  var ids=field.split(',').map(function(x){return x.trim();});
  if (ids.some(function(x){
    return !Object.prototype.hasOwnProperty.call(T4M_PREVIEW_VALID_PATIENTS,x);
  })) return {};
  ids.forEach(function(x){result[x]=true;});
  return result;
}
function t4mReminderEligibleUsers_(data) {
  var recipients={},out={
    activeAuthorizedRecords:0,
    disabledOrInvalidRecords:0,
    recipients:recipients
  };
  data.rows.forEach(function(row){
    if (!String(row[0]||'').trim()) return;
    var role=t4mPreviewGet_(data,row,'role').toUpperCase();
    var status=t4mPreviewGet_(data,row,'status').toUpperCase();
    var enabled=t4mPreviewIsTrue_(t4mPreviewGet_(data,row,'notification_enabled'));
    var line=t4mPreviewGet_(data,row,'line_user_id');
    var scope=t4mScopeForUser_(role,t4mPreviewGet_(data,row,'patient_id'));
    if (status!=='ACTIVE' || !enabled ||
        (role!=='ADMIN' && role!=='CAREGIVER') ||
        !/^U[0-9a-fA-F]{32}$/.test(line) ||
        Object.keys(scope).length===0) {
      out.disabledOrInvalidRecords++;
      return;
    }
    out.activeAuthorizedRecords++;
    if(!Object.prototype.hasOwnProperty.call(recipients,line))
      recipients[line]={};
    Object.keys(scope).forEach(function(pid){recipients[line][pid]=true;});
  });
  return out;
}
function t4mReminderMealCandidates_(data) {
  var seen={},list=[],stats={scanned:0,active:0,
    excludedDemo:0,excludedMalformed:0,groupedSlots:0,
    validMedicineRecords:0};
  data.rows.forEach(function(row){
    if (!String(row[0]||'').trim()) return;
    stats.scanned++;
    if(!t4mPreviewIsTrue_(t4mPreviewGet_(data,row,'is_active'))) return;
    stats.active++;
    var name=t4mPreviewGet_(data,row,'name');
    if(t4mPreviewIsDemo_(name)) {stats.excludedDemo++;return;}
    var patient=t4mPreviewGet_(data,row,'patient_id');
    var box=t4mPreviewGet_(data,row,'box_number');
    var time=t4mPreviewGet_(data,row,'reminder_time');
    var meal=t4mPreviewGet_(data,row,'meal_type');
    if(!Object.prototype.hasOwnProperty.call(T4M_PREVIEW_VALID_PATIENTS,patient) ||
       !/^\d{1,2}$/.test(box) || Number(box)!==T4M_PREVIEW_VALID_PATIENTS[patient] ||
       t4mPreviewGet_(data,row,'kind').toLowerCase()!=='scheduled' ||
       !t4mPreviewValidTime_(time) || !/^[1-7]$/.test(meal)) {
      stats.excludedMalformed++;return;
    }
    stats.validMedicineRecords++;
    var key=patient+'|'+time+'|'+meal;
    if(!Object.prototype.hasOwnProperty.call(seen,key)) {
      seen[key]=true;list.push({patient:patient,time:time,meal:meal});
    }
  });
  list.sort(function(a,b){
    return a.time.localeCompare(b.time) ||
      a.patient.localeCompare(b.patient) ||
      a.meal.localeCompare(b.meal);
  });
  stats.groupedSlots=list.length;
  return {list:list,stats:stats};
}
/** Pure preview: no personal identifiers are returned to the caller. */
function t4mPlanReminderPreview_(medicineData,userData,localTime) {
  if(!t4mPreviewValidTime_(localTime)) throw new Error('TIME4MED_TIME_INVALID');
  var meds=t4mReminderMealCandidates_(medicineData);
  var users=t4mReminderEligibleUsers_(userData);
  var due=meds.list.filter(function(x){return x.time===localTime;});
  var eligibleRecipients=Object.keys(users.recipients);
  var recipientDue={};
  due.forEach(function(item) {
    eligibleRecipients.forEach(function(lineId){
      if(!users.recipients[lineId][item.patient]) return;
      // Group by recipient and minute for potential one-message-per-recipient plan.
      // Do not emit LINE IDs or messages in logs/results.
      recipientDue[lineId]=true;
    });
  });
  return {
    mode:'PREVIEW_ONLY_NO_NOTIFICATIONS',
    selectedTime:localTime,
    source:'MealMedicines',
    timezone:T4M_REMINDER_TZ,
    medicineRecords:meds.stats,
    recipientAccounts:eligibleRecipients.length,
    candidateMealSlotsDueAtTime:due.length,
    recipientsWithDueCandidates:Object.keys(recipientDue).length,
    wouldSendNow:false,
    reason:'Real medicines, recurring days, caregiver authorization and dedup ledger are not yet verified'
  };
}
/** Run manually. Opens Time4Med_DB as read-only. Does not call LINE API. */
function previewTime4MedReminderPlan() {
  var id=PropertiesService.getScriptProperties().getProperty('TIME4MED_SHEET_ID');
  if(!id || !/^[a-zA-Z0-9_-]{25,}$/.test(id))
    throw new Error('TIME4MED_SHEET_ID_MISSING_OR_INVALID');
  var ss=SpreadsheetApp.openById(id);
  var meds=t4mPreviewReadTable_(ss,'MealMedicines',1,
    ['record_id','patient_id','name','kind','meal_type','box_number','reminder_time','is_active']);
  var users=t4mPreviewReadTable_(ss,'Users',4,
    ['user_id','role','patient_id','line_user_id','notification_enabled','status']);
  var localTime=Utilities.formatDate(new Date(),T4M_REMINDER_TZ,'HH:mm');
  var output=t4mPlanReminderPreview_(meds,users,localTime);
  console.log(JSON.stringify(output));
  return output;
}
