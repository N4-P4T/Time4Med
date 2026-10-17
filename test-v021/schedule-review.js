/* Time4Med schedule review: no MQTT write, no remote actions. */
(function(){
 'use strict';
 const core=window.Time4MedScheduleContract, host=document.getElementById('medicineList');
 if(!core||!host)return;
 const panel=document.createElement('section');
 panel.className='t22-schedule-review';
 panel.setAttribute('aria-label','ตรวจความพร้อมตารางยาก่อนส่งเข้าเครื่อง');
 panel.innerHTML='<div class="t22-head"><div><small>TIME4MED · SCHEDULE REVIEW</small><h3>ตรวจความพร้อมตารางยาก่อนส่งเข้า ESP32-S3</h3></div><span>อ่านอย่างเดียว · ไม่ส่งคำสั่ง</span></div>'+
 '<p>ตรวจมื้อยา รายชื่อผู้สูงอายุ หมายเลขกล่องและความจุ 18 รอบ ตามเฟิร์มแวร์ที่ตรวจพบ</p>'+
 '<p id="t22ReviewState" role="status" aria-live="polite">รอข้อมูล...</p>'+
 '<div class="t22-review-metrics"><div><small>รายการยา</small><strong id="t22TotalRows">—</strong></div><div><small>รอบยา</small><strong id="t22ScheduledSlots">—</strong></div><div><small>ความจุ</small><strong>18</strong></div><div><small>ข้อผิดพลาด</small><strong id="t22ErrorCount">—</strong></div></div>'+
 '<p class="t22-boxes">ช่องยาที่เฟิร์มแวร์อ้างอิงกำหนด: P001→U001/กล่อง 1 · P002→U002/กล่อง 2 · P003→U003/กล่อง 3</p>'+
 '<div class="t22-review-columns"><div><h4>รายการตามเวลาที่ตรวจผ่าน</h4><ul id="t22Slots" class="t22-review-list"><li>รอข้อมูล</li></ul></div><div><h4>สิ่งที่ควรตรวจสอบ</h4><ul id="t22Issues" class="t22-review-list"><li>รอข้อมูล</li></ul></div></div>'+
 '<p class="t22-warning"><strong>ยังไม่เปิดซิงก์ตารางยา:</strong> ESP32-S3 รุ่นที่ตรวจพบใช้คำสั่งทีละรายการโดยไม่มี ACK ครบทั้งชุด จึงไม่ส่ง SET/DELETE/CLEAR จากเว็บไซต์ จนกว่า Backend Gateway และระบบยืนยันผลพร้อม</p>'+
 '<div class="t22-actions"><button type="button" id="t22ReviewAgain">ตรวจรูปแบบอีกครั้ง (ไม่ส่ง)</button><span id="t22SnapshotState">สถานะในเครื่อง: รอข้อมูล Snapshot ที่ยืนยันได้</span></div>';
 host.before(panel);
 const $=id=>document.getElementById(id);
 const slots=$('t22Slots'),issues=$('t22Issues'),state=$('t22ReviewState');
 const item=(message,type)=>{const el=document.createElement('li');el.className='t22-list-item '+(type||'');el.textContent=message;return el;};
 let patientIds=null,haveMedicines=false,generation=0,fetchError='';
 function render(){
   const loggedIn=!!window.Time4MedAuth?.user;
   const rows=loggedIn&&haveMedicines&&typeof medicines!=='undefined'&&Array.isArray(medicines)?medicines:null;
   const report=core.evaluate(rows,patientIds);
   const errors=report.issues.filter(x=>x.kind==='error');
   $('t22TotalRows').textContent=rows===null?'—':rows.length;
   $('t22ScheduledSlots').textContent=rows===null?'—':report.slots.length;
   $('t22ErrorCount').textContent=rows===null?'—':errors.length;
   state.textContent=!loggedIn?'กรุณาลงชื่อ Google เพื่อดูข้อมูลที่ได้รับสิทธิ์':
     fetchError?'รายชื่อผู้สูงอายุโหลดไม่ได้: '+fetchError:
     rows===null||patientIds===null?'กำลังโหลดข้อมูลจาก Backend และ Google Sheets…':
     errors.length?'พบข้อผิดพลาด '+errors.length+' รายการ ต้องแก้ก่อนส่งเข้าเครื่อง':
     report.slots.length===0?'ไม่พบรอบยาตามเวลาที่พร้อมตรวจ — ไม่ยกเลิกตารางในเครื่อง':
     'รูปแบบรายการยาเข้ากับเฟิร์มแวร์อ้างอิง ✓ แต่ยังไม่ได้ส่งไป ESP32-S3';
   slots.replaceChildren();issues.replaceChildren();
   if(rows===null||patientIds===null) {
     slots.append(item('ยังไม่มีข้อมูลยาที่ตรวจสอบได้'));
     issues.append(item(fetchError?'โปรดตรวจสิทธิ์ Backend':'รอข้อมูลผู้สูงอายุ'));
   } else {
     for(const slot of report.slots.slice(0,18))
       slots.append(item(slot.patientId+' · กล่อง '+slot.compartment+' · '+slot.time+' น. · '+slot.meal,'valid'));
     if(!report.slots.length)slots.append(item('ไม่มีรอบยาตามเวลาที่ใช้ได้'));
     for(const issue of report.issues)issues.append(item(issue.message,issue.kind));
   }
   $('t22SnapshotState').textContent='สถานะในเครื่อง: ยังไม่มี Snapshot ครบรายการที่ยืนยันได้';
 }
 async function onAuth(event){
   const myGen=++generation;
   patientIds=null;haveMedicines=false;fetchError='';render();
   if(!event.detail?.user)return;
   try{
     const response=await window.Time4MedAuth.api('/api/patients');
     if(myGen!==generation)return;
     if(!Array.isArray(response.patients))throw Error('API ไม่ส่ง patients array');
     patientIds=response.patients.map(p=>String(p.id||'')).filter(Boolean);
   }catch(e){if(myGen!==generation)return;fetchError=String(e.message||'API error');}
   if(myGen===generation)render();
 }
 window.addEventListener('time4med-auth-changed',onAuth);
 window.addEventListener('time4med-medicines-changed',()=>{if(!window.Time4MedAuth?.user)return;haveMedicines=true;render();});
 $('t22ReviewAgain').addEventListener('click',render);
 render();
})();
