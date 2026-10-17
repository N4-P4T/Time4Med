/* Time4Med read-only MQTT live status v0.24 (no publish).
 * SECURITY: Use a dedicated HiveMQ subscribe-ONLY account.
 * Password exists solely in page memory until disconnect/close;
 * never write it to git, localStorage, sessionStorage or URLs.
 * Disregard retained status, only accept live post-subscription traffic.
 */
(function(){
  'use strict';
  const host=document.getElementById('t24MqttPanel');
  if(!host)return;
  const $=id=>document.getElementById(id);
  const clientFactory=()=>window.mqtt;
  const topic='time4med/v1/cabinet/cabinet-01/status';
  const MAX_STALE_MS=150000;
  let client=null,connectedAt=0,lastLiveAt=0,snapshot=null,loggedIn=false,unsubscribeRequested=false;
  const broker='wss://730b8f62b55c4753803b4302a8cf6bf4.s1.eu.hivemq.cloud:8884/mqtt';
  // Only setup information. Host URL is public by design; MQTT secrets are not.
  const message=idText=>{ $('t24MqttResult').textContent=idText; };
  const state=(value)=>{ $('t24MqttState').textContent=value; };
  const shorten=(value)=>String(value??'').slice(0,80);
  function clearSnapshot(){
    snapshot=null;lastLiveAt=0;
    $('t24LastSeen').textContent='—';
    $('t24Door').textContent='ยังไม่มีข้อมูลสด';
    $('t24Lock').textContent='ยังไม่มีข้อมูลสด';
    $('t24Emergency').textContent='ยังไม่มีข้อมูลสด';
    $('t24Device').textContent='ESP32-S3: รอข้อมูล';
  }
  function stop(){
    unsubscribeRequested=true;
    const prev=client;
    client=null;connectedAt=0;
    try{if(prev)prev.end(true);}catch(_){}
    $('t24Password').value='';
    clearSnapshot();state('ยังไม่เชื่อมต่อ');
    $('t24Start').disabled=!loggedIn;
    $('t24Stop').disabled=true;
  }
  function render(){
    if(!snapshot||!client?.connected||!loggedIn)return;
    if(Date.now()-lastLiveAt>MAX_STALE_MS){
      clearSnapshot();
      state('ขาดข้อมูลสดเกิน 150 วินาที');
      return;
    }
    const s=snapshot;
    $('t24LastSeen').textContent=new Date(lastLiveAt).toLocaleTimeString('th-TH');
    $('t24Door').textContent=s.door_status==='CLOSED'?'ปิด':(s.door_status==='OPEN'?'เปิด':'ไม่ทราบ');
    $('t24Lock').textContent=s.lock_status==='LOCKED'?'ล็อก':(s.lock_status==='UNLOCKED'?'ปลดล็อก':'ไม่ทราบ');
    $('t24Emergency').textContent=s.emergency===true?'มีสัญญาณฉุกเฉิน':s.emergency===false?'ไม่มีสัญญาณ':'ไม่ทราบ';
    $('t24Device').textContent='ESP32-S3 · '+shorten(s.system_state||'สถานะไม่ระบุ');
    state('ได้รับข้อมูลสดจาก ESP32-S3');
  }
  function connect(){
    if(!loggedIn) return message('กรุณาเข้าสู่ระบบ Google ก่อน');
    if(client){return message('กรุณาตัดการเชื่อมต่อก่อนเริ่มใหม่');}
    const username=$('t24Username').value.trim();
    const password=$('t24Password').value;
    if(!username||!password)return message('กรอกบัญชี HiveMQ ที่ตั้งสิทธิ์ SUBSCRIBE อย่างเดียว');
    if(!clientFactory()?.connect)return message('ยังโหลดไลบรารี MQTT ไม่สำเร็จ');
    // Browser credentials must NOT be a device account. ACL must enforce read-only.
    if(username==='time4med-esp32s')return message('ห้ามใช้บัญชี time4med-esp32s ของตัวเครื่อง กรุณาสร้างบัญชีอ่านอย่างเดียว');
    const arr=new Uint8Array(8);
    crypto.getRandomValues(arr);
    const clientId='time4med-view-'+Array.from(arr,v=>v.toString(16).padStart(2,'0')).join('');
    unsubscribeRequested=false;
    $('t24Start').disabled=true;
    $('t24Stop').disabled=false;
    clearSnapshot();state('กำลังเชื่อมต่อ HiveMQ…');
    try{
      const mqttClient=clientFactory().connect(broker,{
        username,password,clientId,
        clean:true,protocolVersion:4,
        connectTimeout:12000,reconnectPeriod:0,
        rejectUnauthorized:true,keepalive:30
      });
      // Remove plaintext password from the form as soon as handed to mqtt.js.
      $('t24Password').value='';
      client=mqttClient;
      mqttClient.on('connect',()=>{
        if(mqttClient!==client||unsubscribeRequested)return;
        connectedAt=Date.now();
        state('เชื่อม Broker แล้ว · รอข้อมูลสด (ไม่ใช้ retained)');
        message('เชื่อมต่อ HiveMQ สำเร็จ แต่ยังไม่ยืนยันว่า ESP32-S3 ออนไลน์');
        mqttClient.subscribe(topic,{qos:1},error=>{
          if(error) {
            message('บัญชีนี้ Subscribe ไม่สำเร็จ: ตรวจ ACL และสิทธิ์');
            stop();
          }
        });
      });
      mqttClient.on('message',(name,payload,packet)=>{
        if(client!==mqttClient||!loggedIn||name!==topic||!connectedAt)return;
        // MQTT retained messages are stale; never call them live status.
        if(packet?.retain===true)return;
        if(Date.now()<connectedAt)return;
        if(!payload||payload.length>1200)return;
        let data;
        try{data=JSON.parse(payload.toString());}catch(_){return;}
        if(!data||data.device_id!=='ESP32S3-01'||typeof data.online!=='boolean')return;
        if(!['LOCKED','UNLOCKED'].includes(data.lock_status)||
           !['CLOSED','OPEN'].includes(data.door_status)||
           typeof data.emergency!=='boolean')return;
        if(data.online!==true){clearSnapshot();state('อุปกรณ์แจ้งออฟไลน์');return;}
        lastLiveAt=Date.now();snapshot=data;render();
      });
      mqttClient.on('error',err=>{
        message('เชื่อมต่อไม่สำเร็จ ตรวจบัญชี HiveMQ, Broker และเครือข่าย');
        state('การเชื่อมต่อผิดพลาด');
        if(mqttClient===client)stop();
      });
      mqttClient.on('close',()=>{
        if(mqttClient!==client||unsubscribeRequested)return;
        clearSnapshot();
        state('การเชื่อมต่อขาด');
        client=null;connectedAt=0;
        $('t24Start').disabled=!loggedIn;
        $('t24Stop').disabled=true;
      });
    }catch(_){
      $('t24Password').value='';
      stop();
      message('ไม่สามารถเริ่มเชื่อมต่อ MQTT ได้');
    }
  }
  $('t24Start').addEventListener('click',connect);
  $('t24Stop').addEventListener('click',()=>{stop();message('ยกเลิกการติดตามสถานะสดแล้ว');});
  window.addEventListener('time4med-auth-changed',e=>{
    loggedIn=!!e.detail?.user;
    stop();
    message(loggedIn?'กรอกบัญชี HiveMQ แบบ SUBSCRIBE-ONLY เพื่ออ่านสถานะเครื่อง':'ลงชื่อเข้าใช้ Google ก่อนดูสถานะสด');
    host.hidden=!loggedIn;
  });
  window.setInterval(render,15000);
  clearSnapshot();
  host.hidden=true;
  $('t24Start').disabled=true;
  $('t24Stop').disabled=true;
})();
