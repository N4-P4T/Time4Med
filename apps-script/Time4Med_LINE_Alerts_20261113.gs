/**
 * Time4Med LINE add-on, 2026-11-13.
 * Add as a NEW .gs file to the EXISTING Google Apps Script project.
 * Do NOT replace Code.gs / doPost / doGet or redeploy the Web App.
 *
 * Existing medicine-due alerts continue in scheduledLineReminders_().
 * This add-on monitors the already-written Sheets for newly reported
 * confirmations, door transitions (when firmware reports them), and
 * device heartbeat loss. Optional not-confirmed alerts use the due log.
 * No email or hardware actions. No public API methods.
 */
var T4ML = Object.freeze({
  spreadsheetId: '1pU1YnZUHrxTxxCDnoNx5Xmaosh-d4H92BUXQwQYQg8I',
  tz: 'Asia/Bangkok',
  website: 'https://n4-p4t.github.io/Time4Med/',
  defaultSoftLimit: 250,
  offlineMinutes: 5,
  unconfirmedMinutes: 2,
  scanRows: 700
});

function t4mlProps_(){ return PropertiesService.getScriptProperties(); }
function t4mlNow_(){ return new Date(); }
function t4mlStamp_(date){ return Utilities.formatDate(date || new Date(),T4ML.tz,'yyyy-MM-dd HH:mm:ss'); }
function t4mlTrim_(value){ return String(value==null?'':value).trim(); }
function t4mlUpper_(value){ return t4mlTrim_(value).toUpperCase(); }
function t4mlBool_(value){ return ['TRUE','YES','ACTIVE','1','ON'].includes(t4mlUpper_(value)); }
function t4mlParse_(value){
  var s=t4mlTrim_(value);
  if(!s)return NaN;
  if(/^\d{4}-\d\d-\d\d \d\d:\d\d(:\d\d)?$/.test(s))
    s=s.replace(' ','T')+(s.length===16?':00':'')+'+07:00';
  var t=Date.parse(s);return Number.isFinite(t)?t:NaN;
}
function t4mlSha_(s){
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(s))
    .map(function(b){return ('0'+(b&255).toString(16)).slice(-2);}).join('');
}
function t4mlTable_(name,headerRow,scanRows){
  var sh=SpreadsheetApp.openById(T4ML.spreadsheetId).getSheetByName(name);
  if(!sh)throw new Error('Missing Time4Med sheet: '+name);
  var lastCol=sh.getLastColumn(),lastRow=sh.getLastRow();
  var keys=sh.getRange(headerRow,1,1,lastCol).getDisplayValues()[0].map(t4mlTrim_);
  var start=Math.max(headerRow+1,lastRow-(scanRows||T4ML.scanRows)+1);
  var rows=lastRow>=start?sh.getRange(start,1,lastRow-start+1,lastCol).getDisplayValues():[];
  return {sheet:sh,keys:keys,rows:rows.map(function(cells,i){
    var data={};keys.forEach(function(k,j){if(k)data[k]=cells[j]||'';});
    return {index:start+i,data:data};
  }).filter(function(r){return Object.keys(r.data).some(function(k){return t4mlTrim_(r.data[k]);});})};
}
function t4mlUsers_(){
  var users=t4mlTable_('Users',4,1000).rows, seen={};
  return users.map(function(r){
    var d=r.data, id=t4mlTrim_(d.line_user_id);
    if(!id || seen[id] || !t4mlBool_(d.notification_enabled) ||
       t4mlUpper_(d.status)!=='ACTIVE')return null;
    var role=t4mlUpper_(d.role);
    if(role!=='ADMIN' && role!=='USER' && role!=='CAREGIVER')return null;
    var patients=role==='ADMIN'?['P001','P002','P003']:
      t4mlUpper_(d.patient_id).split(/[,;\s]+/).filter(Boolean);
    if(!patients.length)return null;
    seen[id]=true;
    return {id:t4mlTrim_(d.user_id),lineId:id,role:role,patients:patients};
  }).filter(Boolean);
}
function t4mlRecipients_(users,patientId){
  return users.filter(function(u){return patientId==='ALL'||u.role==='ADMIN'||
    u.patients.indexOf(patientId)!==-1;});
}
function t4mlSoftLimit_(){
  var rows=t4mlTable_('Settings',4,100).rows;
  var setting=rows.find(function(r){return r.data.setting_key==='LINE_MONTHLY_SOFT_LIMIT';});
  var limit=Number(setting && setting.data.setting_value);
  return Number.isInteger(limit)&&limit>=1&&limit<=300?limit:T4ML.defaultSoftLimit;
}
function t4mlSentThisMonth_(notificationRows,now){
  var month=Utilities.formatDate(now,T4ML.tz,'yyyy-MM');
  return notificationRows.filter(function(r){
    var d=r.data;
    return t4mlUpper_(d.channel)==='LINE' &&
      t4mlTrim_(d.sent_at).slice(0,7)===month &&
      ['ATTEMPTED','SENT','DELIVERED'].indexOf(t4mlUpper_(d.delivery_status))!==-1;
  }).length;
}
function t4mlLog_(sheet,record){
  var keys=sheet.getRange(4,1,1,sheet.getLastColumn()).getDisplayValues()[0];
  var row=keys.map(function(k){return Object.prototype.hasOwnProperty.call(record,k)?record[k]:'';});
  sheet.appendRow(row);
  return sheet.getLastRow();
}
function t4mlSetResult_(sheet,rowIndex,status,error){
  var headers=sheet.getRange(4,1,1,sheet.getLastColumn()).getDisplayValues()[0];
  var statusIndex=headers.indexOf('delivery_status')+1;
  var errorIndex=headers.indexOf('error_message')+1;
  if(statusIndex)sheet.getRange(rowIndex,statusIndex).setValue(status);
  if(errorIndex)sheet.getRange(rowIndex,errorIndex).setValue(String(error||'').slice(0,240));
}
/** Called only while holding ScriptLock, to avoid duplicate event IDs. */
function t4mlSendOnce_(ctx,key,patientId,user,kind,text){
  if(ctx.ids.has(key))return false;
  if(ctx.sent>=ctx.limit){
    console.warn('Time4Med LINE soft limit reached: '+ctx.sent+'/'+ctx.limit);
    return false;
  }
  var row=t4mlLog_(ctx.log.sheet,{
    notification_id:key,event_id:key,patient_id:patientId,
    recipient_user_id:user.id,channel:'LINE',message_type:kind,
    sent_at:t4mlStamp_(ctx.now),delivery_status:'ATTEMPTED'
  });
  ctx.ids.add(key);ctx.sent++;
  try{
    var token=t4mlProps_().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
    if(!token)throw new Error('LINE_CHANNEL_ACCESS_TOKEN missing');
    var result=UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push',{
      method:'post',contentType:'application/json',muteHttpExceptions:true,
      headers:{Authorization:'Bearer '+token},
      payload:JSON.stringify({to:user.lineId,messages:[{type:'text',text:text.slice(0,1000)}]})
    });
    if(result.getResponseCode()!==200)
      throw new Error('LINE HTTP '+result.getResponseCode());
    t4mlSetResult_(ctx.log.sheet,row,'SENT','');
    return true;
  }catch(e){
    t4mlSetResult_(ctx.log.sheet,row,'FAILED',String(e));
    console.error('Time4Med LINE event failed: '+kind+' '+String(e));
    return false;
  }
}
function t4mlSendPatient_(ctx,eventKey,patientId,kind,text){
  t4mlRecipients_(ctx.users,patientId).forEach(function(user){
    var key='T4ML-'+t4mlSha_(eventKey+':'+user.lineId).slice(0,28);
    t4mlSendOnce_(ctx,key,patientId,user,kind,text+'\n\n'+T4ML.website);
  });
}
function t4mlConfirmed_(ctx,startMs){
  var logs=t4mlTable_('IntakeLog',4,T4ML.scanRows).rows;
  logs.forEach(function(r){
    var d=r.data,patient=t4mlUpper_(d.patient_id);
    var at=t4mlParse_(d.confirmed_at);
    if(!['P001','P002','P003'].includes(patient)||
      t4mlUpper_(d.status)!=='CONFIRMED'||
      !Number.isFinite(at)||at<startMs||at>ctx.now.getTime())return;
    var event=t4mlTrim_(d.event_id)||t4mlTrim_(d.log_id);
    if(!event)return;
    t4mlSendPatient_(ctx,'INTAKE:'+event,patient,'MEDICINE_CONFIRMED',
      '✅ Time4Med: มีการกดปุ่มยืนยันรับยาที่ตู้ยาแล้ว\n'+
      'ผู้สูงอายุ '+patient+' เวลา '+t4mlStamp_(new Date(at))+
      '\n(ยืนยันการกดปุ่ม ไม่ใช่หลักฐานว่ากลืนยาแล้ว)');
  });
}
/**
 * Classify door opening by the actual scheduled meal time from MealMedicines.
 * The window is the due minute through 30 minutes afterward, inclusive.
 * Check the actual scheduled calendar day (including previous day at midnight).
 * This classification does NOT mean medication intake is confirmed.
 */
function t4mlDoorMealMatches_(atMs,medicineRows){
  var minutes=Math.floor(atMs/60000);
  var date0=Utilities.formatDate(new Date(atMs),T4ML.tz,'yyyy-MM-dd');
  var date1=Utilities.formatDate(new Date(atMs-24*60*60000),T4ML.tz,'yyyy-MM-dd');
  var dates=[date0,date1],dayNames=['SUN','MON','TUE','WED','THU','FRI','SAT'];
  var mealLabels={1:'ก่อนอาหารเช้า',2:'หลังอาหารเช้า',3:'ก่อนอาหารกลางวัน',
                  4:'หลังอาหารกลางวัน',5:'ก่อนอาหารเย็น',6:'หลังอาหารเย็น',7:'ก่อนนอน'};
  var found=[],seen={};
  medicineRows.forEach(function(row){
    var d=row.data,patient=t4mlUpper_(d.patient_id),name=t4mlTrim_(d.name);
    var id=t4mlTrim_(d.record_id),meal=Number(d.meal_type);
    if(!id||!['P001','P002','P003'].includes(patient)||
       !t4mlBool_(d.is_active)||t4mlUpper_(d.kind)==='PRN'||
       !Number.isInteger(meal)||meal<1||meal>7||
       /^(TEST|DEMO|LINECHECK)[_\s-]/i.test(name)||
       /^(TEST|DEMO|LINECHECK)[_\s-]/i.test(id))return;
    var time=t4mlTrim_(d.reminder_time);
    var match=/^(\d{1,2}):([0-5]\d)(?::00)?$/.exec(time);
    if(!match||Number(match[1])>23)return;
    time=('0'+Number(match[1])).slice(-2)+':'+match[2];
    var days=t4mlUpper_(d.reminder_days).replace(/\s/g,'');
    var allDays=!days||days==='ALL'||days==='EVERYDAY';
    var allowed=allDays?[]:days.split(',');
    if(!allDays&&(!allowed.length||allowed.some(function(x){
      return ['SUN','MON','TUE','WED','THU','FRI','SAT'].indexOf(x)===-1;
    })))return;
    dates.forEach(function(date){
      var dueMs=Date.parse(date+'T'+time+':00+07:00');
      if(!Number.isFinite(dueMs))return;
      var dueDay=dayNames[Number(Utilities.formatDate(new Date(dueMs),T4ML.tz,'u'))%7];
      if(!allDays&&allowed.indexOf(dueDay)===-1)return;
      var dueMinute=Math.floor(dueMs/60000);
      if(minutes<dueMinute||minutes>dueMinute+30)return;
      var unique=patient+':'+meal+':'+date+':'+time;
      if(seen[unique])return;
      seen[unique]=true;
      found.push({patient:patient,meal:mealLabels[meal],time:time});
    });
  });
  return found;
}
function t4mlDoorTimeLabel_(atMs){
  return Utilities.formatDate(new Date(atMs),T4ML.tz,'dd/MM/yyyy HH:mm')+' น.';
}
function t4mlDoor_(ctx,startMs){
  var logs=t4mlTable_('ActivityLog',4,T4ML.scanRows).rows;
  // Opening time, rather than closing time, classifies the entire door cycle.
  var medicines=null,lastOpen=null;
  logs.forEach(function(r){
    var d=r.data,kind=t4mlUpper_(d.event_type),at=t4mlParse_(d.occurred_at);
    if(!['DOOR_OPEN','DOOR_CLOSED'].includes(kind)||
       t4mlTrim_(d.device_id)!=='S3-001'||!Number.isFinite(at))return;
    var opened=kind==='DOOR_OPEN',matches=null;
    if(opened){
      if(medicines===null)medicines=t4mlTable_('MealMedicines',1,500).rows;
      matches=t4mlDoorMealMatches_(at,medicines);
      lastOpen={at:at,matches:matches};
    }else{
      if(lastOpen && at>=lastOpen.at && at-lastOpen.at<=12*60*60000)
        matches=lastOpen.matches;
      lastOpen=null;
    }
    if(at<startMs||at>ctx.now.getTime())return;
    var event=t4mlTrim_(d.event_id);
    if(!event)return;
    var message;
    if(opened && matches.length){
      var lines=matches.slice(0,5).map(function(x){
        return '• '+x.patient+' '+x.meal+' ('+x.time+' น.)';
      });
      if(matches.length>5)lines.push('และอีก '+(matches.length-5)+' มื้อยา');
      message='✅ Time4Med | เปิดประตูตู้ยาในช่วงเวลารับยา'+
        '\nเวลาเปิด: '+t4mlDoorTimeLabel_(at)+
        '\nมื้อยาที่ตรงช่วงเวลา:\n'+lines.join('\n')+
        '\n(เปิดประตูไม่ได้หมายความว่ายืนยันรับยาแล้ว)';
    }else if(opened){
      message='⚠️ Time4Med | เปิดประตูตู้ยานอกเวลารับยา'+
        '\nเวลาเปิด: '+t4mlDoorTimeLabel_(at)+
        '\nไม่มีมื้อยาที่กำหนดในช่วงเวลานี้'+
        '\n(เปิดประตูไม่ได้หมายความว่ายืนยันรับยาแล้ว)';
    }else{
      message='✅ Time4Med | ประตูตู้ยาปิดแล้ว'+
        '\nเวลาปิด: '+t4mlDoorTimeLabel_(at);
      if(matches!==null)
        message+='\nการเปิดครั้งนี้: '+
          (matches.length?'อยู่ในช่วงเวลารับยา':'นอกเวลารับยา');
    }
    t4mlSendPatient_(ctx,'DOOR:'+event,'ALL',kind,message);
  });
}
function t4mlUnconfirmed_(ctx,startMs){
  var localDay=Utilities.formatDate(ctx.now,T4ML.tz,'yyyy-MM-dd');
  var dayName=['SUN','MON','TUE','WED','THU','FRI','SAT'][Number(Utilities.formatDate(ctx.now,T4ML.tz,'u'))%7];
  var medicines=t4mlTable_('MealMedicines',1,500).rows;
  var intakes=t4mlTable_('IntakeLog',4,T4ML.scanRows).rows;
  var dueSent=new Set(ctx.log.rows.filter(function(r){
    return t4mlUpper_(r.data.channel)==='LINE' &&
      t4mlUpper_(r.data.message_type)==='MEDICINE_DUE' &&
      t4mlUpper_(r.data.delivery_status)==='SENT';
  }).map(function(r){return t4mlTrim_(r.data.notification_id);}));
  var groups=new Set();
  medicines.forEach(function(r){
    var d=r.data,id=t4mlTrim_(d.record_id),patient=t4mlUpper_(d.patient_id);
    if(!id||!['P001','P002','P003'].includes(patient)||
       !t4mlBool_(d.is_active)||t4mlUpper_(d.kind)==='PRN'||
       /^(TEST|DEMO|LINECHECK|QA)[_\s-]/i.test(t4mlTrim_(d.name))||
       /^(TEST|DEMO|LINECHECK|QA)[_\s-]/i.test(id))return;
    var time=t4mlTrim_(d.reminder_time);
    if(/^\d:\d\d$/.test(time))time='0'+time;
    if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))return;
    var days=t4mlUpper_(d.reminder_days).replace(/\s/g,'');
    if(days&&days!=='ALL'&&days!=='EVERYDAY'&&days.split(',').indexOf(dayName)===-1)return;
    var due=Date.parse(localDay+'T'+time+':00+07:00');
    if(due<startMs||ctx.now.getTime()<due+T4ML.unconfirmedMinutes*60000||
       ctx.now.getTime()>due+20*60000)return;
    var confirmed=intakes.some(function(ir){
      return t4mlUpper_(ir.data.patient_id)===patient &&
        t4mlUpper_(ir.data.status)==='CONFIRMED'&&
        t4mlParse_(ir.data.confirmed_at)>=due&&
        t4mlParse_(ir.data.confirmed_at)<=ctx.now.getTime();
    });
    if(confirmed)return;
    t4mlRecipients_(ctx.users,patient).forEach(function(user){
      // Older due sender hashes MEDICINE_ID:USER_ID, and logs the specific
      // recipient. Never send a no-confirmation alert for an unsent due reminder.
      var dueKey='T4M-'+localDay+'-'+t4mlSha_(id+':'+user.id).slice(0,14);
      if(!dueSent.has(dueKey))return;
      var groupKey='NOACK:'+localDay+':'+patient+':'+time+':'+user.lineId;
      if(groups.has(groupKey))return;
      groups.add(groupKey);
      var key='T4ML-'+t4mlSha_(groupKey).slice(0,28);
      t4mlSendOnce_(ctx,key,patient,user,'MEDICINE_UNCONFIRMED',
        '⏰ Time4Med: ยังไม่พบการกดยืนยันรับยาในระบบ\n'+
        'ผู้สูงอายุ '+patient+' มื้อเวลา '+time+
        '\nเกิน '+T4ML.unconfirmedMinutes+' นาทีแล้ว กรุณาตรวจสอบ\n\n'+T4ML.website);
    });
  });
}
function t4mlOffline_(ctx,startMs){
  var dev=t4mlTable_('Devices',4,100).rows;
  ['S3-001','CAM-001'].forEach(function(deviceId){
    var row=dev.find(function(r){return t4mlTrim_(r.data.device_id)===deviceId;});
    if(!row)return;
    var seen=t4mlParse_(row.data.last_seen);
    if(!Number.isFinite(seen))return;
    var key='T4ML_OFFLINE_LATCH_'+deviceId;
    if(ctx.now.getTime()-seen<T4ML.offlineMinutes*60000){
      t4mlProps_().deleteProperty(key);
      return;
    }
    if(ctx.now.getTime()-startMs<T4ML.offlineMinutes*60000||
       t4mlProps_().getProperty(key)==='1')return;
    var sent=false;
    t4mlRecipients_(ctx.users,'ALL').forEach(function(u){
      var event='OFFLINE:'+deviceId+':'+t4mlStamp_(new Date(Math.max(startMs,seen)));
      var msg='⚠️ Time4Med: อุปกรณ์ '+deviceId+
        ' ขาดการติดต่อเกิน '+T4ML.offlineMinutes+' นาที'+
        '\nอาจเกิดจากไฟเลี้ยงหรือเครือข่าย ไม่ใช่การยืนยันว่าอุปกรณ์ชำรุด';
      var k='T4ML-'+t4mlSha_(event+':'+u.lineId).slice(0,28);
      if(t4mlSendOnce_(ctx,k,'ALL',u,'DEVICE_OFFLINE',msg+'\n\n'+T4ML.website))sent=true;
    });
    if(sent)t4mlProps_().setProperty(key,'1');
  });
}
function time4medLineAlertsTick(){
  if(t4mlProps_().getProperty('T4ML_ENABLED')!=='TRUE')return {enabled:false};
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(5000))return {skipped:'LOCK_BUSY'};
  try{
    var started=Number(t4mlProps_().getProperty('T4ML_STARTED_AT')||0);
    if(!Number.isFinite(started)||started<=0)throw new Error('T4ML_STARTED_AT missing');
    var now=t4mlNow_(),log=t4mlTable_('NotificationLog',4,5000);
    var ctx={now:now,log:log,users:t4mlUsers_(),ids:new Set(log.rows.map(function(r){
      return t4mlTrim_(r.data.notification_id);
    })),sent:t4mlSentThisMonth_(log.rows,now),limit:t4mlSoftLimit_()};
    t4mlConfirmed_(ctx,started);
    t4mlDoor_(ctx,started);
    t4mlUnconfirmed_(ctx,started);
    // Offline notifications paused while the cabinet is powered off for assembly.
    // Leave t4mlOffline_ intact for future re-enablement.
    // t4mlOffline_(ctx,started);
    return {ok:true,recipients:ctx.users.length,loggedThisMonth:ctx.sent,
      softLimit:ctx.limit,checkedAt:t4mlStamp_(now)};
  }finally{lock.releaseLock();}
}
/** Run ONCE in Apps Script editor, as Time4Med project owner. Does not send LINE. */
function time4medLineAlertsStart(){
  var p=t4mlProps_();
  if(!p.getProperty('LINE_CHANNEL_ACCESS_TOKEN'))
    throw new Error('กรุณาตั้งค่า LINE_CHANNEL_ACCESS_TOKEN ใน Script Properties ก่อน');
  var jobs=ScriptApp.getProjectTriggers().filter(function(t){
    return t.getHandlerFunction()==='time4medLineAlertsTick';
  });
  jobs.slice(1).forEach(function(j){ScriptApp.deleteTrigger(j);});
  if(!jobs.length)ScriptApp.newTrigger('time4medLineAlertsTick').timeBased().everyMinutes(1).create();
  if(p.getProperty('T4ML_ENABLED')!=='TRUE'){
    p.setProperty('T4ML_STARTED_AT',String(Date.now())); // Never backfill older events on restart.
    p.deleteProperty('T4ML_OFFLINE_LATCH_S3-001');
    p.deleteProperty('T4ML_OFFLINE_LATCH_CAM-001');
  }
  p.setProperty('T4ML_ENABLED','TRUE');
  return {enabled:true,startedAt:p.getProperty('T4ML_STARTED_AT'),
    triggerCount:ScriptApp.getProjectTriggers().filter(function(t){
      return t.getHandlerFunction()==='time4medLineAlertsTick';
    }).length,notificationOnly:true};
}
/** Run in editor to disable add-on; existing medicine reminders stay untouched. */
function time4medLineAlertsStop(){
  t4mlProps_().setProperty('T4ML_ENABLED','FALSE');
  ScriptApp.getProjectTriggers().filter(function(t){
    return t.getHandlerFunction()==='time4medLineAlertsTick';
  }).forEach(function(t){ScriptApp.deleteTrigger(t);});
  return {enabled:false};
}
/** Read-only verification: safe to run before Start, does not send messages. */
function time4medLineAlertsCheck(){
  var now=t4mlNow_(),log=t4mlTable_('NotificationLog',4,5000);
  return {enabled:t4mlProps_().getProperty('T4ML_ENABLED')==='TRUE',
    hasToken:Boolean(t4mlProps_().getProperty('LINE_CHANNEL_ACCESS_TOKEN')),
    destinations:t4mlUsers_().length,
    loggedThisMonth:t4mlSentThisMonth_(log.rows,now),
    softLimit:t4mlSoftLimit_(),
    triggerCount:ScriptApp.getProjectTriggers().filter(function(t){
      return t.getHandlerFunction()==='time4medLineAlertsTick';
    }).length,
    note:'Quota reflects recorded sends only. LINE OA Manager is authoritative.'};
}
/** Manually send one unmistakable TEST message from Apps Script editor. */
function time4medLineAlertsTestOnce(){
  var props=t4mlProps_(),users=t4mlUsers_();
  var admin=users.find(function(u){return u.role==='ADMIN';});
  if(!admin)throw new Error('ไม่พบ ADMIN ที่เปิดใช้งาน LINE');
  var last=Number(props.getProperty('T4ML_LAST_TEST')||0);
  if(Date.now()-last<10*60000)throw new Error('ทดสอบซ้ำได้หลังจาก 10 นาที');
  var lock=LockService.getScriptLock();lock.waitLock(5000);
  try{
    var now=t4mlNow_(),log=t4mlTable_('NotificationLog',4,5000);
    var ctx={now:now,log:log,users:users,ids:new Set(log.rows.map(function(r){
      return t4mlTrim_(r.data.notification_id);
    })),sent:t4mlSentThisMonth_(log.rows,now),limit:t4mlSoftLimit_()};
    var key='T4ML-TEST-'+t4mlSha_(now.getTime()+':'+admin.id).slice(0,20);
    var sent=t4mlSendOnce_(ctx,key,'ALL',admin,'SYSTEM_TEST',
      '[Time4Med TEST] ทดสอบการแจ้งเตือน LINE เท่านั้น\nไม่มีเหตุฉุกเฉินและไม่มีการรับยาจริง\n\n'+T4ML.website);
    if(sent)props.setProperty('T4ML_LAST_TEST',String(Date.now()));
    return {sent:sent,logId:key,softLimit:ctx.limit,loggedThisMonth:ctx.sent};
  }finally{lock.releaseLock();}
}

/**
 * Optional integration point for NEW, authenticated S3 device action:
 *   action:'door', deviceId:'S3-001', door:'OPEN'|'CLOSED'.
 * In the *existing* Code.gs postDevice_, AFTER device-key verification,
 * add 'door' to the action whitelist and call this function for that action.
 * An unknown initial state establishes a baseline without an alert.
 * Existing Web App /exec deployment must be updated for a new device action.
 */
function time4medDoorChangeFromDevice_(p){
  if(t4mlTrim_(p.deviceId)!=='S3-001')
    throw new Error('DOOR_DEVICE_ID_INVALID');
  var door=t4mlUpper_(p.door);
  if(door!=='OPEN'&&door!=='CLOSED')throw new Error('DOOR_STATE_INVALID');
  var lock=LockService.getScriptLock();lock.waitLock(5000);
  try{
    var devices=t4mlTable_('Devices',4,100);
    var row=devices.rows.find(function(r){return t4mlTrim_(r.data.device_id)==='S3-001';});
    if(!row)throw new Error('DOOR_DEVICE_NOT_REGISTERED');
    var index=devices.keys.indexOf('door_status');
    if(index<0){
      index=devices.keys.length;
      devices.sheet.getRange(4,index+1).setValue('door_status');
    }
    var previous=t4mlUpper_(row.data.door_status);
    if(previous===door)return {ok:true,changed:false,door:door,receivedAt:t4mlStamp_(new Date())};
    if(previous==='OPEN'||previous==='CLOSED'){
      var event='DOOR_'+door;
      var act=t4mlTable_('ActivityLog',4,100);
      t4mlLog_(act.sheet,{
        event_id:Utilities.getUuid(),device_id:'S3-001',patient_id:'ALL',
        user_id:'SYSTEM',event_type:event,result:'SUCCESS',
        details:'ESP32-S3 reed-switch transition: '+previous+' -> '+door,
        occurred_at:t4mlStamp_(new Date())
      });
    }
    devices.sheet.getRange(row.index,index+1).setValue(door);
    return {ok:true,changed:previous==='OPEN'||previous==='CLOSED',
      door:door,receivedAt:t4mlStamp_(new Date())};
  }finally{lock.releaseLock();}
}
