/* Time4Med v0.18: Google ID token -> role-enforced API.
 * Never infer role from browser state; backend is authoritative.
 * No Google OAuth Client Secret, MQTT credentials or service account here.
 */
(function(){
  'use strict';
  const cfg=window.TIME4MED_AUTH_CONFIG||{};
  const ui=(id)=>document.getElementById(id);
  let token=''; let user=null;
  const auth={get user(){return user;},get tokenPresent(){return !!token;},api,signOut};
  window.Time4MedAuth=auth;
  function status(message,bad=false){const el=ui('t4mAuthMessage');if(el){el.textContent=message;el.dataset.bad=bad?'true':'false';}}
  function configured(){return cfg.apiBase&&/^https:\/\/[\w.-]+(?:\/[^\s]*)?$/.test(cfg.apiBase)&&!cfg.apiBase.includes('REPLACE-')&&cfg.clientId?.endsWith('.apps.googleusercontent.com');}
  async function api(path,opts={}){
    if(!token)throw Error('กรุณาเข้าสู่ระบบ');
    if(!configured())throw Error('ยังไม่ได้ตั้งค่า Cloudflare Worker ใน auth-config.js');
    const method=opts.method||'GET';
    const r=await fetch(cfg.apiBase.replace(/\/$/,'')+path,{
      method,mode:'cors',cache:'no-store',headers:{Authorization:'Bearer '+token,...(opts.body?{'Content-Type':'application/json'}:{})},body:opts.body?JSON.stringify(opts.body):undefined
    });
    const data=await r.json().catch(()=>({}));
    if(!r.ok){if(r.status===401)signOut('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');throw Error(data.error||'API error '+r.status);}
    return data;
  }
  function signOut(message='ออกจากระบบแล้ว'){
    token='';user=null;
    if(window.google?.accounts?.id?.disableAutoSelect)google.accounts.id.disableAutoSelect();
    if(typeof medicines!=='undefined'){medicines=[];if(typeof renderMedicines==='function')renderMedicines();}
    document.body.classList.add('t4m-auth-locked');
    ui('t4mUserbar').hidden=true;
    ui('t4mAdminSection').hidden=true;
    window.dispatchEvent(new CustomEvent('time4med-auth-changed',{detail:{user:null}}));
    status(message);
  }
  async function credentialReceived(response){
    if(!response?.credential)return status('Google ไม่ส่ง ID token กรุณาลองใหม่',true);
    token=response.credential;status('กำลังตรวจสอบบัญชีในฐานข้อมูล Time4Med…');
    try{
      const me=await api('/api/me');
      user=me.user;
      ui('t4mSignedInUser').textContent=user.name+' · '+user.role;
      ui('t4mUserbar').hidden=false;
      document.body.classList.remove('t4m-auth-locked');
      ui('t4mAdminSection').hidden=user.role!=='ADMIN';
      window.dispatchEvent(new CustomEvent('time4med-auth-changed',{detail:{user}}));
      status('เข้าสู่ระบบสำเร็จ');
    }catch(err){token='';user=null;status('เข้าใช้งานไม่ได้: '+err.message,true);}
  }
  function renderSignIn(){
    if(!configured()){status('ต้องตั้งค่า apiBase ของ backend ใน auth-config.js ก่อนจึงจะเข้าสู่ระบบได้',true);return true;}
    if(!window.google?.accounts?.id)return false;
    google.accounts.id.initialize({client_id:cfg.clientId,callback:credentialReceived,auto_select:false,ux_mode:'popup',cancel_on_tap_outside:true});
    google.accounts.id.renderButton(ui('t4mGoogleButton'),{theme:'outline',size:'large',text:'signin_with',shape:'rectangular',locale:'th',width:280});
    status('โปรดเลือกบัญชี Google ที่เพิ่มไว้ใน Users ของ Time4Med');
    return true;
  }
  ui('t4mSignOut').addEventListener('click',()=>signOut());
  window.addEventListener('load',()=>{
    if(renderSignIn())return;
    let tries=0;
    const loop=setInterval(()=>{tries++;if(renderSignIn()||tries>=25){clearInterval(loop);if(tries>=25)status('โหลด Google Sign-In ไม่สำเร็จ ตรวจการเชื่อมต่ออินเทอร์เน็ต',true);}},400);
  });
})();
