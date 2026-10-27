/**
 * Time4Med LINE message with an official dashboard link.
 *
 * Requires existing Code.gs, SheetPreview.gs and SheetLineDemo.gs.
 * Tests may use TEST_ rows only; no auto-reminder, webhook, trigger or
 * modification to Production Sheets is implemented here.
 *
 * The stable site root redirects to the current caregiver frontend.
 * Never place Google auth tokens, LINE IDs, names or other personal data in URL.
 */
var T4M_OFFICIAL_WEBSITE_URL = 'https://n4-p4t.github.io/Time4Med/';

function t4mLinkedReminderPayload_(patientCode, reminderTime, demo) {
  if (!Object.prototype.hasOwnProperty.call(T4M_PREVIEW_VALID_PATIENTS, patientCode))
    throw new Error('LINE_LINK_PATIENT_INVALID');
  if (!t4mPreviewValidTime_(reminderTime))
    throw new Error('LINE_LINK_TIME_INVALID');
  if (typeof demo !== 'boolean')
    throw new Error('LINE_LINK_MODE_INVALID');

  var title=demo
    ? '🔔 [Time4Med] ทดสอบการแจ้งเตือนมื้อยา'
    : '🔔 [Time4Med] แจ้งเตือนมื้อยา';
  var lines=[
    title,
    'ผู้สูงอายุ: '+patientCode,
    'เวลาในตาราง: '+reminderTime+' น.',
    '',
    'กรุณาเปิดเว็บไซต์เพื่อตรวจสอบรายการยาและสถานะการรับประทานยา',
    '👉 '+T4M_OFFICIAL_WEBSITE_URL,
    'เข้าสู่ระบบก่อนดูข้อมูลผู้สูงอายุ'
  ];
  if(demo) {
    lines.push('');
    lines.push('⚠️ นี่เป็นข้อมูล TEST เท่านั้น ไม่ใช่การแจ้งให้รับประทานยาจริง');
  }
  // URL in text for ordinary tapping/copying; Quick Reply adds a labeled URL action.
  return {
    type:'text',
    text:lines.join('\n'),
    quickReply:{
      items:[{
        type:'action',
        action:{
          type:'uri',
          label:'เปิดเว็บไซต์',
          uri:T4M_OFFICIAL_WEBSITE_URL
        }
      }]
    }
  };
}

/** Read-only sample to inspect copy/paste text before any outbound message. */
function previewLinkedReminderDemo() {
  var demos=t4mSheetDemoCandidates_();
  if(!demos.length) throw new Error('LINE_LINK_NO_ELIGIBLE_DEMO');
  var sample=t4mLinkedReminderPayload_(demos[0].patient,demos[0].time,true);
  var result={
    mode:'PREVIEW_ONLY',
    recipient:'LINE_TEST_USER_ID',
    patient:demos[0].patient,
    reminderTime:demos[0].time,
    website:T4M_OFFICIAL_WEBSITE_URL,
    // No personal health info, real medication names or LINE user IDs.
    message:sample.text,
    uriButtonLabel:sample.quickReply.items[0].action.label,
    messageSent:false
  };
  console.log(JSON.stringify(result));
  return result;
}

/**
 * Send ONE link-bearing TEST message to the developer's tested LINE user ID.
 * Requires Script Property LINE_LINK_TEST_CONFIRM=YES.
 * Retains LINE_LINK_TEST_STATE even if request fails; NEVER auto retries.
 */
function sendLinkedReminderDemoOnce() {
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(10000)) throw new Error('LINE_LINK_TEST_BUSY');
  try {
    var props=PropertiesService.getScriptProperties();
    if(props.getProperty('LINE_LINK_TEST_CONFIRM')!=='YES')
      throw new Error('LINE_LINK_TEST_NOT_CONFIRMED');
    if(props.getProperty('LINE_LINK_TEST_STATE'))
      throw new Error('LINE_LINK_TEST_ALREADY_ATTEMPTED');

    var target=props.getProperty('LINE_TEST_USER_ID')||'';
    if(!/^U[0-9a-fA-F]{32}$/.test(target))
      throw new Error('LINE_LINK_TARGET_INVALID');

    var candidates=t4mSheetDemoCandidates_();
    if(!candidates.length) throw new Error('LINE_LINK_NO_ELIGIBLE_DEMO');
    var sample=candidates[0];
    var message=t4mLinkedReminderPayload_(sample.patient,sample.time,true);

    var token=t4mToken_();
    var quota=t4mQuota_(token);
    if(quota.usageApprox >= Math.min(250,quota.softCap))
      throw new Error('LINE_LINK_QUOTA_GUARD');

    var retryKey=props.getProperty('LINE_LINK_TEST_RETRY_KEY');
    if(!retryKey) {
      retryKey=Utilities.getUuid();
      props.setProperty('LINE_LINK_TEST_RETRY_KEY',retryKey);
    }
    props.setProperty('LINE_LINK_TEST_STATE','ATTEMPTED');

    var response=UrlFetchApp.fetch(T4M_LINE_BASE+'/message/push',{
      method:'post',
      contentType:'application/json',
      headers:{
        Authorization:'Bearer '+token,
        'X-Line-Retry-Key':retryKey
      },
      payload:JSON.stringify({to:target,messages:[message]}),
      muteHttpExceptions:true
    });
    var status=response.getResponseCode();
    if(status!==200)
      throw new Error('LINE_LINK_PUSH_HTTP_'+status+'_CHECK_BEFORE_RETRY');

    props.setProperty('LINE_LINK_TEST_STATE','API_ACCEPTED');
    var result={
      apiAccepted:true,
      deliveryConfirmed:false,
      oneTime:true,
      testMode:true,
      websiteIncluded:true,
      uriButtonIncluded:true
    };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}
