/**
 * Time4Med LINE Messaging API helpers (Cloudflare Worker / server only).
 * Not connected to production routing or schedules by this module.
 * No user IDs, tokens, or patient medical details are embedded.
 */
export const LINE_API = 'https://api.line.me/v2/bot';
export const MONTHLY_SOFT_CAP = 280; // buffer below Thailand OA Free 300; API usage is approximate
const LINE_USER_ID = /^U[0-9a-fA-F]{32}$/;
const RETRY_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MEALS = Object.freeze({
  1:'ก่อนอาหารเช้า', 2:'หลังอาหารเช้า',
  3:'ก่อนอาหารกลางวัน', 4:'หลังอาหารกลางวัน',
  5:'ก่อนอาหารเย็น', 6:'หลังอาหารเย็น', 7:'ก่อนนอน'
});
const PATIENTS = new Set(['P001', 'P002', 'P003']);

export function buildReminderText({patientIds, time, mealType}) {
  if (!Array.isArray(patientIds) || !patientIds.length ||
      patientIds.some(id => !PATIENTS.has(id)) ||
      !TIME.test(String(time)) || !MEALS[mealType]) throw Error('INVALID_REMINDER');
  const ids = [...new Set(patientIds)].sort();
  // No medicine names, diagnoses or personal names in LINE push.
  return '[Time4Med] แจ้งเตือนถึงเวลาตรวจสอบมื้อยา\n' +
    'ผู้สูงอายุ: ' + ids.join(', ') + '\n' +
    'มื้อ: ' + MEALS[mealType] + ' เวลา ' + time + ' น.\n' +
    'เปิดเว็บไซต์ผู้ดูแล: https://n4-p4t.github.io/Time4Med/\n' +
    'หมายเหตุ: การแจ้งเตือนนี้ไม่ใช่หลักฐานว่าได้รับประทานยาแล้ว';
}

async function readLineJson(response) {
  try { return await response.json(); } catch { throw Error('LINE_INVALID_RESPONSE'); }
}
function authHeaders(token) { return {'Authorization':'Bearer ' + token}; }
async function readLineUsage(token, fetchImpl) {
  // LINE states totalUsage is approximate. A persistent sending ledger/lock must
  // be added by the caller before enabling recurring automatic dispatch.
  const [limitResponse, usageResponse] = await Promise.all([
    fetchImpl(LINE_API + '/message/quota', {headers:authHeaders(token)}),
    fetchImpl(LINE_API + '/message/quota/consumption', {headers:authHeaders(token)})
  ]);
  if (!limitResponse.ok || !usageResponse.ok) throw Error('LINE_QUOTA_UNVERIFIED');
  const [limit, used] = await Promise.all([readLineJson(limitResponse),readLineJson(usageResponse)]);
  if (limit?.type !== 'limited' ||
      !Number.isSafeInteger(limit.value) || limit.value < 0 ||
      !Number.isSafeInteger(used?.totalUsage) || used.totalUsage < 0)
    throw Error('LINE_QUOTA_UNVERIFIED');
  return {officialLimit:limit.value,usage:used.totalUsage,
    softCap:Math.min(MONTHLY_SOFT_CAP,limit.value)};
}

/**
 * Caller must authenticate user, check ADMIN/caregiver permission, look up
 * LINE userId from a trusted server-side verified caregiver mapping, and
 * provide a persistent unique retryKey per event. NEVER expose this function
 * directly to an unauthenticated HTTP endpoint.
 */
export async function sendLineReminder({env, lineUserId, reminder, retryKey, fetchImpl=fetch}) {
  if (env?.LINE_PUSH_ENABLED !== 'true') throw Error('LINE_DISABLED');
  const token = env?.LINE_CHANNEL_ACCESS_TOKEN;
  if (typeof token !== 'string' || token.length < 24) throw Error('LINE_NOT_CONFIGURED');
  if (!LINE_USER_ID.test(lineUserId||'')) throw Error('INVALID_LINE_RECIPIENT');
  if (!RETRY_KEY.test(retryKey||'')) throw Error('INVALID_RETRY_KEY');
  const message = buildReminderText(reminder);
  const quota = await readLineUsage(token,fetchImpl);
  if (quota.usage >= quota.softCap) throw Error('LINE_QUOTA_GUARD');
  const response = await fetchImpl(LINE_API + '/message/push', {
    method:'POST',
    headers:{...authHeaders(token),'Content-Type':'application/json','X-Line-Retry-Key':retryKey},
    body:JSON.stringify({to:lineUserId,messages:[{type:'text',text:message}]})
  });
  // 409 with accepted request ID means LINE already accepted this retry key.
  if (response.status === 409 && response.headers?.get('x-line-accepted-request-id'))
    return {accepted:true,duplicate:true,delivered:false};
  if (!response.ok) throw Error('LINE_SEND_HTTP_' + response.status);
  return {accepted:true,duplicate:false,delivered:false};
}

/** Verify LINE's signature over the EXACT raw request body, before JSON.parse(). */
export async function verifyLineWebhookSignature({rawBody, signature, channelSecret}) {
  if (typeof rawBody !== 'string' || typeof signature !== 'string' ||
      typeof channelSecret !== 'string' || channelSecret.length < 8) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) return false;
  const encoder=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',encoder.encode(channelSecret),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(rawBody)));
  let provided;
  try { provided = Uint8Array.from(atob(signature),c=>c.charCodeAt(0)); }
  catch { return false; }
  let diff=expected.length ^ provided.length;
  for (let i=0;i<expected.length;i++) diff |= expected[i] ^ (provided[i] ?? 0);
  return diff===0;
}
