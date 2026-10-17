/* Time4Med v0.21 — authorized, read-only caregiver dashboard.
   Dashboard displays schedule records, NOT evidence of medication ingestion.
   Never call an actuator or publish MQTT commands here. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!$('t21PatientCards')) return;

  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const dateFormat = new Intl.DateTimeFormat('th-TH', {
    timeZone:'Asia/Bangkok', weekday:'long', day:'numeric', month:'long', year:'numeric'
  });
  const clockFormat = new Intl.DateTimeFormat('en-GB', {
    timeZone:'Asia/Bangkok', hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  });
  const mealLabels = {
    1:'ก่อนอาหารเช้า',2:'หลังอาหารเช้า',
    3:'ก่อนอาหารกลางวัน',4:'หลังอาหารกลางวัน',
    5:'ก่อนอาหารเย็น',6:'หลังอาหารเย็น',7:'ก่อนนอน'
  };
  let authorizedPatients = null; // null means unknown, [] means no assigned patients
  let medicationsReady = false;
  let fetching = false;
  let errorMessage = '';
  let generation = 0;
  let filter = '';
  let personSnapshot = null;

  const todayMinutes = () => {
    const parts = clockFormat.formatToParts(new Date());
    const hour = Number(parts.find(p=>p.type==='hour')?.value || '0') % 24;
    const minute = Number(parts.find(p=>p.type==='minute')?.value || '0');
    return hour*60+minute;
  };
  const minutes = t => {
    if (!timePattern.test(String(t||''))) return null;
    const [h,m] = t.split(':').map(Number);
    return h*60+m;
  };
  const known = () => !!window.Time4MedAuth?.user;
  const asText = (id,val) => {const el=$(id);if(el)el.textContent=String(val);};
  const make = (tag,cls,label) => {
    const node=document.createElement(tag);
    if(cls)node.className=cls;
    if(label!==undefined)node.textContent=String(label);
    return node;
  };
  const labelFor = row => {
    return mealLabels[Number(row.mealType)] ||
      String(row.name || 'ไม่ระบุช่วงมื้อยา');
  };
  const infoFor = row => {
    return String(row.name || 'ยาไม่ระบุชื่อ')+' · '+labelFor(row);
  };
  const usableRows = () => {
    if (!known() || !medicationsReady || !Array.isArray(authorizedPatients)) return null;
    const permitted = new Set(authorizedPatients.map(p=>p.id));
    const all = typeof medicines !== 'undefined' && Array.isArray(medicines) ? medicines : [];
    return all.filter(r=>r && permitted.has(String(r.patientId||'')));
  };
  const pendingItems = rows => {
    const found=[];
    for (const row of rows) {
      const issues=[];
      if (!String(row.boxNumber||'').trim()) issues.push('ยังไม่ระบุหมายเลขกล่อง');
      if(row.kind!=='prn' && minutes(row.time)===null) issues.push('เวลาแจ้งเตือนไม่ถูกต้อง');
      if(row.stockStatus==='low')issues.push('แจ้งสถานะยาใกล้หมด');
      if(row.stockStatus==='out')issues.push('แจ้งสถานะยาหมด');
      if(issues.length)found.push({row,issues});
    }
    return found;
  };
  const timed = rows => rows.filter(r=>r.kind!=='prn' && minutes(r.time)!==null)
      .sort((a,b)=>minutes(a.time)-minutes(b.time));
  const scope = (rows) => filter ? rows.filter(r=>String(r.patientId||'')===filter) : rows;

  function empty(node,message) {
    node.replaceChildren(make('div','t21-empty',message));
  }
  function addFilter() {
    const host=$('t21PatientFilter');
    host.replaceChildren();
    if (!known() || !Array.isArray(authorizedPatients)) {
      host.append(make('span','t21-empty-text',known()?'รอรายชื่อผู้สูงอายุ':'ลงชื่อเข้าใช้ก่อน'));
      return;
    }
    function chip(id,title) {
      const button=make('button','t21-chip'+(filter===id?' selected':''),title);
      button.type='button';
      button.dataset.patientId=id;
      button.setAttribute('aria-pressed',String(filter===id));
      return button;
    }
    host.append(chip('','ทั้งหมด'));
    for(const person of authorizedPatients){
      host.append(chip(person.id,person.name || person.id));
    }
  }

  function renderPatientCards(rows) {
    const host=$('t21PatientCards');host.replaceChildren();
    if(!known()) return empty(host,'ลงชื่อเข้าใช้ด้วย Google เพื่อดูผู้สูงอายุที่ได้รับอนุญาต');
    if(!Array.isArray(authorizedPatients))return empty(host,'กำลังโหลดรายชื่อผู้สูงอายุผ่าน Backend...');
    const patients=filter?authorizedPatients.filter(p=>p.id===filter):authorizedPatients;
    if(!patients.length) return empty(host,'บัญชีนี้ยังไม่มีผู้สูงอายุที่ได้รับสิทธิ์');
    for(const person of patients){
      const allFor=rows===null?null:rows.filter(r=>String(r.patientId||'')===person.id);
      const schedules=allFor===null?null:timed(allFor);
      const next=schedules?.find(r=>minutes(r.time)>=todayMinutes());
      const boxes=allFor===null?[]:[...new Set(allFor.map(r=>String(r.boxNumber||'').trim()).filter(Boolean))];
      const card=make('article','t21-patient-card');
      const head=make('div','t21-person-head');
      const avatar=make('span','t21-person-avatar','👤');
      const identity=make('div','t21-person-title');
      identity.append(make('strong','',String(person.name||'ยังไม่ระบุชื่อ')));
      identity.append(make('small','',person.id));
      head.append(avatar,identity,make('span','t21-person-state','รอสถานะจากเครื่อง'));
      card.append(head);
      const facts=make('div','t21-person-facts');
      function fact(k,v){const item=make('div','t21-person-fact');item.append(make('span','',k),make('strong','',v));facts.append(item);}
      fact('กล่องยา', allFor===null?'—':(boxes.length?boxes.join(', '):'ยังไม่ระบุ'));
      fact('รายการยาตามเวลา',schedules===null?'—':schedules.length+' รายการ');
      fact('รอบถัดไปวันนี้',schedules===null?'—':(next?next.time+' น.':'ไม่มีรอบถัดไป'));
      card.append(facts);
      const note=make('p','t21-person-note',
          next ? labelFor(next)+' · '+String(next.name||'รายการยา') :
          (schedules===null?'กำลังโหลดรายการยาจาก Google Sheets':
           'ยังไม่มีรายการที่มาถึงในช่วงเวลาที่เหลือ'));
      card.append(note);
      const bottom=make('div','t21-person-bottom');
      bottom.append(make('span','t21-evidence-note','ยังไม่ยืนยันการรับยา'));
      const link=make('a','t21-inline-link','ตรวจรายการยา ↗');link.href='#medication';bottom.append(link);
      card.append(bottom);
      host.append(card);
    }
  }

  function renderSchedule(rows) {
    const host=$('t21ScheduleList');host.replaceChildren();
    if (rows===null) return empty(host,'กำลังโหลดตารางยาของบัญชีที่เข้าสู่ระบบ');
    const times=timed(scope(rows));
    if(!times.length)return empty(host,'ไม่มีรายการยาตามเวลาสำหรับตัวกรองนี้');
    const names=new Map((authorizedPatients||[]).map(p=>[p.id,p.name||p.id]));
    const now=todayMinutes();
    for(const row of times.slice(0,8)){
      const el=make('li','t21-row');
      const dot=make('span','t21-row-dot'+(minutes(row.time)<now?' muted':''));
      const at=make('time','t21-row-time',row.time+' น.');
      const content=make('div','t21-row-content');
      content.append(make('strong','',infoFor(row)));
      content.append(make('small','',String(names.get(String(row.patientId||''))||'ผู้สูงอายุ')+
       ' · กล่อง '+(String(row.boxNumber||'').trim()||'ยังไม่ระบุ')));
      const flag=make('span','t21-row-flag',minutes(row.time)<now?'ผ่านเวลาที่กำหนด':'ยังไม่ถึงเวลา');
      el.append(dot,at,content,flag);host.append(el);
    }
    if(times.length>8) host.append(make('li','t21-more','อีก '+(times.length-8)+' รายการ — เปิดดูทั้งหมดได้ที่เมนูรายการยา'));
  }

  function renderAttention(rows) {
    const host=$('t21AttentionList');host.replaceChildren();
    if(rows===null)return empty(host,'รอข้อมูลยาเพื่อประเมินรายการที่ต้องตรวจ');
    const attention=pendingItems(scope(rows));
    if(!attention.length)return empty(host,'ยังไม่พบข้อมูลยาที่ต้องแก้ไขตามเงื่อนไขพื้นฐาน (ไม่ได้ยืนยันว่ารับยาครบแล้ว)');
    for(const entry of attention.slice(0,6)){
      const el=make('li','t21-row');
      const dot=make('span','t21-attention-icon','!');
      const summary=make('div','t21-row-content');
      summary.append(make('strong','',String(entry.row.name||'รายการยาไม่ระบุชื่อ')));
      summary.append(make('small','',entry.issues.join(' · ')));
      el.append(dot,summary);host.append(el);
    }
    if(attention.length>6)host.append(make('li','t21-more','อีก '+(attention.length-6)+' รายการที่ต้องตรวจ'));
  }

  function refresh() {
    asText('homeTodayDate',dateFormat.format(new Date()));
    const all=usableRows();
    const rows=all===null?null:scope(all);
    const now=todayMinutes();
    const current=rows===null?null:timed(rows);
    const next=current?.find(r=>minutes(r.time)>=now);
    const issues=rows===null?null:pendingItems(rows);
    asText('t21PatientCount',authorizedPatients===null?'—':authorizedPatients.length);
    asText('t21ScheduledCount',current===null?'—':current.length);
    asText('t21NextTime',current===null?'—':(next?next.time+' น.':'—'));
    asText('t21NextCaption',
      current===null?'รอข้อมูลตารางยา':
      (next?labelFor(next):'ไม่พบรอบยาในช่วงเวลาที่เหลือ'));
    asText('t21NeedsCheckCount',issues===null?'—':issues.length);
    asText('t21DataStatus',
      !known()?'โปรดลงชื่อเข้าใช้ Google ก่อนดูข้อมูลการดูแล':
      errorMessage?'โหลดข้อมูลไม่ได้: '+errorMessage:
      fetching || authorizedPatients===null || all===null ?
      'กำลังโหลดผู้สูงอายุและรายการยาที่ได้รับสิทธิ์ผ่าน Backend…':
      'ข้อมูลรายการยาจากระบบบัญชีผู้ดูแล • ยังไม่ยืนยันว่าตารางถึง ESP32-S3 หรือรับยาแล้ว');
    addFilter();
    renderPatientCards(all);
    renderSchedule(all);
    renderAttention(all);
  }

  async function onAuthChange(event) {
    const n=++generation;
    authorizedPatients=null;
    personSnapshot=null;
    medicationsReady=false;
    fetching=!!event.detail?.user;
    errorMessage='';
    filter='';
    refresh();
    if(!event.detail?.user)return;
    try {
      const response=await window.Time4MedAuth.api('/api/patients');
      if(generation!==n || !known())return;
      const fetched=Array.isArray(response.patients)?response.patients:[];
      const seen=new Set();
      authorizedPatients=fetched.filter(p=>{
        if(!p || !String(p.id||'').trim()||seen.has(String(p.id)))return false;
        seen.add(String(p.id));return true;
      }).map(p=>({id:String(p.id),name:String(p.name||p.id)}));
      personSnapshot=authorizedPatients;
    }catch(err){
      if(generation!==n)return;
      authorizedPatients=null;
      errorMessage='รายชื่อผู้สูงอายุไม่พร้อม — '+String(err.message||'API error');
    }finally{
      if(generation===n){fetching=false;refresh();}
    }
  }

  $('t21PatientFilter').addEventListener('click',event=>{
    const btn=event.target.closest('button[data-patient-id]');
    if(!btn || !Array.isArray(authorizedPatients))return;
    const id=btn.dataset.patientId;
    if(id && !authorizedPatients.some(p=>p.id===id))return;
    filter=id;
    refresh();
  });
  window.addEventListener('time4med-auth-changed',onAuthChange);
  window.addEventListener('time4med-medicines-changed',()=>{
    if(!known())return;
    medicationsReady=true;
    refresh();
  });
  window.time4medRefreshHome=refresh; // existing navigation contract
  window.setInterval(refresh,60000);
  refresh();
})();