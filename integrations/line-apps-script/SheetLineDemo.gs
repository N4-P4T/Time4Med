/**
 * Time4Med: manually verify Google Sheets -> Apps Script -> LINE, ONE test only.
 *
 * Requires Code.gs and SheetPreview.gs in same Apps Script project.
 * Additional Script Property:
 *    LINE_SHEET_TEST_CONFIRM = YES  (set only just before manual run)
 *
 * Uses existing LINE_CHANNEL_ACCESS_TOKEN, LINE_TEST_USER_ID,
 * and TIME4MED_SHEET_ID. Sends to the TEST user only.
 *
 * Never reads medicine names into outgoing messages; chooses a TEST_ record
 * only. Doesn't create triggers, webhooks or update Google Sheets.
 */

function t4mSheetDemoCandidates_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('TIME4MED_SHEET_ID');
  if (!id || !/^[a-zA-Z0-9_-]{25,}$/.test(id))
    throw new Error('LINE_SHEET_TEST_ID_INVALID');

  var ss = SpreadsheetApp.openById(id);
  var data = t4mPreviewReadTable_(ss, 'MealMedicines', 1,
    ['record_id','patient_id','name','kind','meal_type',
      'box_number','reminder_time','is_active']);
  var matches = [];
  data.rows.forEach(function(row) {
    var name=t4mPreviewGet_(data,row,'name');
    // Only hardcoded demo-prefix rows can be used here.
    if (!/^TEST[_\s-]/i.test(name)) return;
    if (!t4mPreviewIsTrue_(t4mPreviewGet_(data,row,'is_active'))) return;
    var id=t4mPreviewGet_(data,row,'record_id');
    var pid=t4mPreviewGet_(data,row,'patient_id');
    var meal=t4mPreviewGet_(data,row,'meal_type');
    var time=t4mPreviewGet_(data,row,'reminder_time');
    var box=t4mPreviewGet_(data,row,'box_number');
    var kind=t4mPreviewGet_(data,row,'kind').toLowerCase();
    var expected=T4M_PREVIEW_VALID_PATIENTS[pid];
    if (!id || !Object.prototype.hasOwnProperty.call(T4M_PREVIEW_VALID_PATIENTS,pid) ||
        !/^[1-7]$/.test(meal) || !t4mPreviewValidTime_(time) ||
        !/^\d{1,2}$/.test(box) || Number(box)!==expected || kind!=='scheduled')
      return;
    matches.push({patient:pid,meal:meal,time:time});
  });
  matches.sort(function(a,b) {
    return a.patient.localeCompare(b.patient) ||
      a.time.localeCompare(b.time) || a.meal.localeCompare(b.meal);
  });
  return matches;
}

/** Read-only preview for this specific manual test. Does NOT send. */
function previewSheetLineDemo() {
  var candidates=t4mSheetDemoCandidates_();
  var result={
    mode:'READ_ONLY_TEST_ONLY',
    availableDemoRecords:candidates.length,
    selected:candidates.length ? candidates[0] : null,
    messageSent:false
  };
  console.log(JSON.stringify(result));
  return result;
}

/** Single explicit run only: sends one generic demo message to LINE_TEST_USER_ID. */
function sendSheetLineDemoOnce() {
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(10000)) throw new Error('LINE_SHEET_TEST_BUSY');
  try {
    var props=PropertiesService.getScriptProperties();
    if(props.getProperty('LINE_SHEET_TEST_CONFIRM')!=='YES')
      throw new Error('LINE_SHEET_TEST_NOT_CONFIRMED');
    if(props.getProperty('LINE_SHEET_TEST_STATE'))
      throw new Error('LINE_SHEET_TEST_ALREADY_ATTEMPTED');

    var recipient=props.getProperty('LINE_TEST_USER_ID')||'';
    if(!/^U[0-9a-fA-F]{32}$/.test(recipient))
      throw new Error('LINE_SHEET_TEST_USER_ID_INVALID');

    // Verify the record is still an active TEST_ demo row.
    var candidates=t4mSheetDemoCandidates_();
    if(!candidates.length) throw new Error('LINE_SHEET_NO_ELIGIBLE_DEMO');
    var selected=candidates[0];

    var token=t4mToken_();
    var quota=t4mQuota_(token);
    // Conservative cap matching Settings!LINE_MONTHLY_SOFT_LIMIT (250).
    if(quota.usageApprox>=Math.min(250,quota.softCap))
      throw new Error('LINE_SHEET_QUOTA_GUARD');

    var retryKey=props.getProperty('LINE_SHEET_TEST_RETRY_KEY');
    if(!retryKey) {
      retryKey=Utilities.getUuid();
      props.setProperty('LINE_SHEET_TEST_RETRY_KEY',retryKey);
    }

    var message='[Time4Med] ทดลองเชื่อมข้อมูล Google Sheets กับ LINE\n'
      +'รายการข้อมูลทดสอบ '+selected.patient+'\n'
      +'เวลาในตาราง: '+selected.time+' น. | รหัสมื้อ: '+selected.meal+'\n'
      +'นี่คือข้อความทดสอบเท่านั้น ไม่ใช่การแจ้งให้รับประทานยาจริง';

    // Mark before network activity: no automatic retry/accidental double send.
    props.setProperty('LINE_SHEET_TEST_STATE','ATTEMPTED');
    var response=UrlFetchApp.fetch(T4M_LINE_BASE+'/message/push',{
      method:'post',
      contentType:'application/json',
      headers:{
        Authorization:'Bearer '+token,
        'X-Line-Retry-Key':retryKey
      },
      payload:JSON.stringify({
        to:recipient,messages:[{type:'text',text:message}]
      }),
      muteHttpExceptions:true
    });
    var status=response.getResponseCode();
    if(status!==200)
      throw new Error('LINE_SHEET_TEST_HTTP_'+status+'_CHECK_BEFORE_RETRY');
    props.setProperty('LINE_SHEET_TEST_STATE','API_ACCEPTED');
    var result={
      apiAccepted:true,deliveryConfirmed:false,oneTime:true,
      testPatientCode:selected.patient,testTime:selected.time
    };
    console.log(JSON.stringify(result)); // no LINE id/token/medicine name
    return result;
  } finally {
    lock.releaseLock();
  }
}
