/* Time4Med v0.16 — แผนผังจัดเก็บยาและสถานะที่ผู้ดูแลตรวจสอบเอง
   ไม่คำนวณเม็ด, ไม่รับ Confirm มาเปลี่ยนยอดยา, ไม่ส่งคำสั่งกลอน */
(function () {
  'use strict';
  const KEY = 'time4medCabinetHistoryV016';
  const OLD_LEDGER_KEY = 'time4medInventoryLedgerV015';
  const el = id => document.getElementById(id);
  if (!el('inventoryItems') || typeof medicines === 'undefined') return;
  const safe = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const groups = [
    {id:'morning',name:'ชั้น 1 — เช้า',desc:'ก่อนอาหาร / หลังอาหาร'},
    {id:'noon',name:'ชั้น 2 — กลางวัน',desc:'ก่อนอาหาร / หลังอาหาร'},
    {id:'evening',name:'ชั้น 3 — เย็น',desc:'ก่อนอาหาร / หลังอาหาร'},
    {id:'bedtime',name:'ชั้น 4 — ก่อนนอน',desc:'ก่อนนอน'},
    {id:'prn',name:'พื้นที่ยา PRN',desc:'ใช้เมื่อมีอาการ · ต้องออกแบบการเข้าถึงเมื่อจำเป็น'}
  ];
  let history = [];
  // Sensitive session log stays in memory only (no localStorage).
  const message = (s,error=false)=>{el('inventoryMessage').textContent=s;el('inventoryMessage').classList.toggle('error',error);};
  function storeHistory(m, before, after) {
    history.unshift({medicineId:m.id,name:m.name,patient:m.patient,boxNumber:m.boxNumber,shelf:mealDef(m).shelf,before,after,at:new Date().toISOString()});
    history=history.slice(0,500);
    // Audit of stock status is persisted by backend MealMedicineAudit.

  }
  const num = list => list.length.toLocaleString('th-TH');
  function render() {
    const valid = medicines.filter(m=>m && typeof m==='object');
    el('inventoryKnownCount').textContent=num(valid);
    el('inventoryTotalStock').textContent=num(valid.filter(m=>m.stockStatus==='unchecked'));
    el('inventoryLowCount').textContent=num(valid.filter(m=>m.stockStatus==='low'||m.stockStatus==='out'));
    const map=el('cabinetShelfMap');map.replaceChildren();
    for (const group of groups) {
      const rows=valid.filter(m=>mealDef(m).shelf===group.id);
      const boxes=[...new Set(rows.map(m=>m.boxNumber).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true}));
      const card=document.createElement('article');card.className='cabinet-map-shelf'+(group.id==='prn'?' prn':'');
      card.innerHTML=`<h3>${safe(group.name)} <small>(${rows.length} รายการ)</small></h3><p>${safe(group.desc)}</p>
        <div class="cabinet-map-boxes">${boxes.length ? boxes.map(n=>`<span class="cabinet-map-box">📦 ${safe(n)}</span>`).join('') : '<span class="cabinet-map-box empty">ยังไม่ระบุกล่อง</span>'}</div>`;
      map.appendChild(card);
    }
    const filter=el('inventorySlotFilter').value;
    const rows=valid.filter(m=>filter==='all'||mealDef(m).shelf===filter);
    const items=el('inventoryItems');items.replaceChildren();
    if(!rows.length){const empty=document.createElement('div');empty.className='inventory-empty';empty.textContent='ยังไม่มีรายการยาในตำแหน่งนี้ — เพิ่มรายการยาได้ที่เมนู “รายการยา”';items.appendChild(empty);}
    const ordered=[...rows].sort((a,b)=>groups.findIndex(g=>g.id===mealDef(a).shelf)-groups.findIndex(g=>g.id===mealDef(b).shelf)||String(a.boxNumber||'').localeCompare(String(b.boxNumber||''),undefined,{numeric:true}));
    for (const m of ordered) {
      const def=mealDef(m),status=m.stockStatus in TIME4MED_STATUS_LABELS?m.stockStatus:'unchecked';
      const card=document.createElement('article');card.className='inventory-item';
      card.innerHTML=`<div class="inventory-item-header"><div>
            <h3>${safe(m.name)}</h3>
            <p class="inventory-meta">${safe(m.patient||'ไม่ระบุผู้ป่วย')} · ${safe(def.shelfLabel)} · กล่อง ${safe(m.boxNumber||'รอระบุ')}</p>
            <p class="inventory-meta">${safe(def.label)}${m.kind==='prn'?' · ไม่มีเวลาแจ้งเตือนประจำ':` · ${safe(m.time||'ไม่ระบุ')} น.`}</p>
            ${m.instruction?`<p class="inventory-meta">ตามฉลาก: ${safe(m.instruction)}</p>`:''}
          </div><span class="inventory-status ${status==='unchecked'?'pending':status}">${safe(TIME4MED_STATUS_LABELS[status])}</span></div>
          ${m.boxNumber?'':'<p class="inventory-migration-note">รายการเดิมยังไม่ได้จับคู่กับกล่องใหม่ กรุณาแก้ไขรายการยาให้ตรงกับตู้จริงก่อนส่งตาราง</p>'}
          <div class="inventory-item-statusselect"><label for="inv-status-${safe(m.id)}">ผู้ดูแลตรวจสถานะ</label>
            <select id="inv-status-${safe(m.id)}" data-id="${safe(m.id)}">
              ${Object.entries(TIME4MED_STATUS_LABELS).map(([k,v])=>`<option value="${k}" ${k===status?'selected':''}>${safe(v)}</option>`).join('')}
            </select>
          </div>`;
      items.appendChild(card);
    }
    const log=el('inventoryHistory');log.replaceChildren();
    if(!history.length){const p=document.createElement('p');p.className='inventory-empty';p.textContent='ยังไม่มีประวัติการปรับสถานะ';log.appendChild(p);}
    else history.slice(0,20).forEach(rec=>{
      const item=document.createElement('div');item.className='inventory-history-item';
      const left=document.createElement('div'),title=document.createElement('strong'),meta=document.createElement('small'),right=document.createElement('span');
      title.textContent=`${rec.name||'ไม่ทราบชื่อยา'} · ${rec.patient||'ไม่ระบุผู้ป่วย'}`;
      const date=new Date(rec.at);meta.textContent=(Number.isNaN(date.getTime())?'ไม่ระบุเวลา':date.toLocaleString('th-TH'))+` · กล่อง ${rec.boxNumber||'ไม่ระบุ'}`;
      right.textContent=TIME4MED_STATUS_LABELS[rec.after]||'ไม่ทราบ';left.append(title,meta);item.append(left,right);log.appendChild(item);
    });
  }
  el('inventoryItems').addEventListener('change',e=>{
    const select=e.target.closest('select[data-id]');if(!select)return;
    const m=medicines.find(x=>x.id===select.dataset.id);if(!m)return;
    const val=select.value;
    if(!(val in TIME4MED_STATUS_LABELS))return;
    if(m.stockStatus===val)return;
    const before=m.stockStatus;
    m.stockStatus=val;m.statusUpdatedAt=new Date().toISOString();
    try {saveMedicines();storeHistory(m,before,val);render();message('บันทึกสถานะจากการตรวจสอบของผู้ดูแลเรียบร้อยแล้ว');}
    catch(err) {m.stockStatus=before;render();message('บันทึกสถานะไม่ได้ ตรวจสอบพื้นที่จัดเก็บในเบราว์เซอร์',true);}
  });
  el('inventorySlotFilter').addEventListener('change',render);
  window.addEventListener('time4med-medicines-changed',render);
  window.addEventListener('storage', e=>{
    if (window.TIME4MED_SECURE_MODE !== false) return;
    if(e.key==='time4medMedicines'){
      try {const data=JSON.parse(e.newValue||'[]');if(Array.isArray(data)){medicines=data;normalizeMedicineRecords();renderMedicines();render();}}catch(_){/* malformed data */}
    }
    if(e.key===KEY){try {const data=JSON.parse(e.newValue||'[]');history=Array.isArray(data)?data:[];render();}catch(_){/* ignore */}}
  });
  // รับ MQTT event ได้ แต่ไม่มีผลต่อสถานะหรือจำนวนยา
  window.addEventListener('time4med-mqtt-event',e=>{
    if(e.detail?.event==='MEDICINE_CONFIRMED') message('ได้รับเหตุการณ์ยืนยันการหยิบยาจาก MQTT — สถานะคลังยาไม่เปลี่ยนโดยอัตโนมัติ');
  });
  function download(name,content,mime) {
    const url=URL.createObjectURL(new Blob([content],{type:mime}));
    const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const csvField = v => {let s=String(v??'');if(/^[=+@\-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  el('inventoryCsvBtn').addEventListener('click',()=>{
    const hdr=['id','patient','medicine','shelf','meal','box','scheduled_time','instruction','caregiver_status'];
    const rows=medicines.map(m=>[m.id,m.patient,m.name,mealDef(m).shelf,mealDef(m).label,m.boxNumber,m.kind==='prn'?'':m.time,m.instruction,m.stockStatus]);
    const csv='\uFEFF'+[hdr,...rows].map(r=>r.map(csvField).join(',')).join('\r\n');
    download('time4med-cabinet-v016.csv',csv,'text/csv;charset=utf-8');message('ส่งออก CSV เรียบร้อยแล้ว');
  });
  el('inventoryBackupBtn').addEventListener('click',()=>{
    let oldLedger=[];try{oldLedger=JSON.parse(localStorage.getItem(OLD_LEDGER_KEY)||'[]');}catch(_){}
    const payload={type:'time4med-inventory',version:2,exportedAt:new Date().toISOString(),medicines,history,legacyStockHistory:Array.isArray(oldLedger)?oldLedger:[]};
    download('time4med-backup-v016.json',JSON.stringify(payload,null,2),'application/json');
    message('สำรอง JSON แล้ว เก็บข้อมูลผู้ป่วยในไฟล์นี้เป็นความลับ');
  });
  el('inventoryRestoreInput').addEventListener('change',async e=>{
    if (window.TIME4MED_SECURE_MODE !== false) {message('โปรดใช้ฟังก์ชันนำเข้าข้อมูลที่ตรวจสิทธิ์ของ ADMIN แทนการนำเข้าไฟล์รุ่นเก่า',true);return;}
    const file=e.target.files?.[0];e.target.value='';if(!file)return;
    if(file.size>4*1024*1024){message('ไฟล์ใหญ่เกิน 4 MB',true);return;}
    try{
      const data=JSON.parse(await file.text());
      if(data.type!=='time4med-inventory'||![1,2].includes(data.version)||!Array.isArray(data.medicines)||data.medicines.length>1000)throw Error('รูปแบบสำรองข้อมูลไม่ถูกต้อง');
      if(data.version===2&&(!Array.isArray(data.history)||data.history.length>500))throw Error('ประวัติข้อมูลไม่ถูกต้อง');
      if(data.version===1&&(!Array.isArray(data.ledger)||data.ledger.length>500))throw Error('ประวัติข้อมูลเดิมไม่ถูกต้อง');
      const ids=new Set();
      for(const m of data.medicines){
        if(!m||typeof m!=='object'||typeof m.name!=='string'||m.name.length>150||
          typeof m.time!=='string'||typeof m.id!=='string'||!m.id||m.id.length>150||ids.has(m.id)||
          (m.kind==='prn'?m.time!=='':!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(m.time))||
          (m.kind!=='prn' && m.mealType!==undefined && ![1,2,3,4,5,6,7].includes(Number(m.mealType)))||
          (m.patient!==undefined&&(typeof m.patient!=='string'||m.patient.length>60))||
          (m.boxNumber!==undefined&&(typeof m.boxNumber!=='string'||m.boxNumber.length>12))||
          (m.instruction!==undefined&&(typeof m.instruction!=='string'||m.instruction.length>300))||
          (m.stockStatus!==undefined&&!(m.stockStatus in TIME4MED_STATUS_LABELS)))throw Error('มีรายการยาไม่ถูกต้อง');
        ids.add(m.id);
      }
      if(!window.confirm('นำเข้าไฟล์สำรองแทนรายการยาและประวัติเดิมในเบราว์เซอร์นี้? กรุณาสำรองข้อมูลปัจจุบันก่อน'))return;
      medicines=data.medicines;
      normalizeMedicineRecords();
      history=data.version===2?data.history:[];
      if(data.version===1)localStorage.setItem(OLD_LEDGER_KEY,JSON.stringify(data.ledger));
      if(data.version===2&&Array.isArray(data.legacyStockHistory))localStorage.setItem(OLD_LEDGER_KEY,JSON.stringify(data.legacyStockHistory.slice(0,500)));
      // Audit of stock status is persisted by backend MealMedicineAudit.

      saveMedicines();renderMedicines();render();message('นำเข้าข้อมูลแล้ว กรุณาตรวจชั้น/หมายเลขกล่องเดิมก่อนใช้งาน');
    }catch(err){message('นำเข้าไม่สำเร็จ: '+err.message,true);}
  });
  render();
})();
