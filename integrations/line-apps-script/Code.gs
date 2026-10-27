/**
 * Time4Med LINE: manual ONE-TIME pilot via Google Apps Script.
 * No Cloudflare, no public webhook, no time triggers, no Google Sheets writes.
 *
 * Project Settings -> Script Properties (do not paste values into source):
 *   LINE_CHANNEL_ACCESS_TOKEN = token of Time4Med Messaging API channel
 *   LINE_TEST_USER_ID         = your U[32 hex] user ID from LINE Developers Basic settings
 *   LINE_TEST_CONFIRM         = YES (only when ready to send one test)
 *
 * Run checkLineSetup() first. It only GETs bot info/quota, never sends.
 * Run sendLineTestOnce() once; sending is blocked if state already ATTEMPTED.
 */

var T4M_LINE_BASE = 'https://api.line.me/v2/bot';
var T4M_LINE_SOFT_CAP = 280; // conservative; fetches actual channel limit
var T4M_LINE_TEST_TEXT =
  '[Time4Med] ทดสอบระบบแจ้งเตือนผ่าน Google Apps Script สำเร็จขั้นตอนส่งข้อความ\n' +
  'ข้อความนี้เป็นการทดสอบเท่านั้น ยังไม่ได้เชื่อมตารางยา ESP32-S3 หรือข้อมูลผู้สูงอายุ';

function t4mProperties_() {
  return PropertiesService.getScriptProperties();
}
function t4mToken_() {
  var token = t4mProperties_().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (typeof token !== 'string' || token.trim().length < 24)
    throw new Error('LINE_TOKEN_MISSING');
  return token.trim();
}
function t4mLineFetch_(path, token, options) {
  var request = {
    method: options && options.method ? options.method : 'get',
    headers: {Authorization:'Bearer ' + token},
    muteHttpExceptions: true
  };
  if (options && options.body) {
    request.contentType = 'application/json';
    request.payload = JSON.stringify(options.body);
  }
  if (options && options.retryKey) request.headers['X-Line-Retry-Key'] = options.retryKey;
  var response = UrlFetchApp.fetch(T4M_LINE_BASE + path, request);
  var status = response.getResponseCode();
  // Never log response body or bearer token.
  if (status < 200 || status >= 300)
    throw new Error('LINE_HTTP_' + status);
  var body;
  try { body = JSON.parse(response.getContentText()); }
  catch (err) { throw new Error('LINE_RESPONSE_INVALID'); }
  return body;
}
function t4mQuota_(token) {
  var q = t4mLineFetch_('/message/quota', token);
  var u = t4mLineFetch_('/message/quota/consumption', token);
  if (!q || q.type !== 'limited' || !Number.isSafeInteger(q.value) ||
      q.value < 1 || !u || !Number.isSafeInteger(u.totalUsage) ||
      u.totalUsage < 0) throw new Error('LINE_QUOTA_UNVERIFIED');
  return {
    officialLimit:q.value,
    usageApprox:u.totalUsage,
    softCap:Math.min(T4M_LINE_SOFT_CAP,q.value)
  };
}

/** Safe to run repeatedly: GET requests ONLY; no LINE push. */
function checkLineSetup() {
  var props=t4mProperties_();
  var token=t4mToken_();
  var bot=t4mLineFetch_('/info', token);
  if (!bot || typeof bot.basicId !== 'string' || !bot.basicId)
    throw new Error('LINE_BOT_INFO_INVALID');
  var quota=t4mQuota_(token);
  var target=props.getProperty('LINE_TEST_USER_ID') || '';
  var result={
    channelReachable:true,
    // Do NOT output tokens or user IDs in logs.
    targetIdConfigured:/^U[0-9a-fA-F]{32}$/.test(target),
    sendEnabled:props.getProperty('LINE_TEST_CONFIRM')==='YES',
    alreadyAttempted:!!props.getProperty('LINE_TEST_STATE'),
    quota:quota
  };
  console.log(JSON.stringify(result));
  return result;
}

/** Explicit ONE-SHOT action. No time trigger calls this function. */
function sendLineTestOnce() {
  var lock=LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('LINE_TEST_BUSY');
  try {
    var props=t4mProperties_();
    if (props.getProperty('LINE_TEST_CONFIRM')!=='YES')
      throw new Error('LINE_TEST_NOT_CONFIRMED');
    if (props.getProperty('LINE_TEST_STATE'))
      throw new Error('LINE_TEST_ALREADY_ATTEMPTED');
    var target=props.getProperty('LINE_TEST_USER_ID') || '';
    if (!/^U[0-9a-fA-F]{32}$/.test(target))
      throw new Error('LINE_TEST_RECIPIENT_INVALID');
    var token=t4mToken_();
    var quota=t4mQuota_(token);
    if (quota.usageApprox >= quota.softCap)
      throw new Error('LINE_TEST_QUOTA_GUARD');

    // Fail closed on ambiguous network failure. A second manual run may
    // duplicate delivery, so ATTEMPTED stays set until the owner audits it.
    var retryKey=props.getProperty('LINE_TEST_RETRY_KEY');
    if (!retryKey) {
      retryKey=Utilities.getUuid();
      props.setProperty('LINE_TEST_RETRY_KEY',retryKey);
    }
    props.setProperty('LINE_TEST_STATE','ATTEMPTED');

    var response = UrlFetchApp.fetch(T4M_LINE_BASE + '/message/push', {
      method:'post',
      headers:{
        Authorization:'Bearer ' + token,
        'X-Line-Retry-Key':retryKey
      },
      contentType:'application/json',
      payload:JSON.stringify({
        to:target,
        messages:[{type:'text',text:T4M_LINE_TEST_TEXT}]
      }),
      muteHttpExceptions:true
    });
    var code=response.getResponseCode();
    if (code!==200)
      throw new Error('LINE_PUSH_HTTP_' + code + '_CHECK_BEFORE_RETRY');
    props.setProperty('LINE_TEST_STATE','API_ACCEPTED');
    var result={apiAccepted:true,deliveryConfirmed:false,oneTime:true};
    console.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}
