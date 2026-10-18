#pragma once
/*
 * Time4Med v0.25 - READ-ONLY ESP32-S3 status -> Cloudflare HTTPS sender.
 *
 * No MQTT subscribe/publish, no GPIO and no actuator control.
 * Integrated in the Stage4 cabinet candidate only; hardware safety
 * and in-cabinet behavior are not yet verified.
 *
 * Compatible with backend/device-telemetry.mjs POST /api/device/telemetry.
 * The HTTPS URL, HMAC key and verified TLS root CA must come from local
 * untracked configuration on the user's computer, NEVER from GitHub Pages.
 */
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <esp_system.h>
#include <mbedtls/md.h>
#include <time.h>
#include <stdint.h>
#include <cstring>

namespace t4m_telemetry {
static constexpr const char* kStatusPath = "/api/device/telemetry";
static constexpr const char* kDeviceId = "ESP32S3-01";
static constexpr uint32_t kMinimumUnixTime = 1704067200UL; // 2024-01-01 UTC.

struct Status {
  bool lockIsUnlocked;
  bool doorIsClosed;
  bool emergency;
  bool rtcValid;
  const char* systemState;
  const char* reason;
};

inline int hexNibble(char c) {
  if(c>='0'&&c<='9')return c-'0';
  if(c>='a'&&c<='f')return c-'a'+10;
  if(c>='A'&&c<='F')return c-'A'+10;
  return -1;
}
inline bool decodeKey(const char* hex,uint8_t out[32]) {
  if(!hex)return false;
  for(size_t i=0;i<64;i++){
    if(hex[i]=='\0'||hexNibble(hex[i])<0)return false;
  }
  if(hex[64]!='\0')return false;
  for(size_t i=0;i<32;i++)
    out[i]=(uint8_t)((hexNibble(hex[i*2])<<4)|hexNibble(hex[i*2+1]));
  return true;
}
// Data is encoded into JSON without a JSON library; accept safe enum-like
// ASCII labels only, so event values never break quoting or inject fields.
inline bool safeLabel(const char* s, bool emptyAllowed) {
  if(!s)return emptyAllowed;
  size_t i=0;
  for(;i<48 && s[i]!='\0';i++){
    const char c=s[i];
    if(!((c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='_'||c=='-'))return false;
  }
  return (i<48) && (emptyAllowed||i>0);
}
inline String makeStatusJson(const Status& s) {
  String json;
  json.reserve(215);
  json+="{\"device_id\":\"ESP32S3-01\",\"online\":true";
  json+=",\"lock_status\":\"";
  json+=s.lockIsUnlocked?"UNLOCKED":"LOCKED";
  json+="\",\"door_status\":\"";
  json+=s.doorIsClosed?"CLOSED":"OPEN";
  json+="\",\"emergency\":";
  json+=s.emergency?"true":"false";
  json+=",\"rtc_valid\":";
  json+=s.rtcValid?"true":"false";
  json+=",\"system_state\":\"";
  json+=s.systemState;
  json+="\",\"reason\":\"";
  json+=s.reason?s.reason:"";
  json+="\"}";
  return json;
}
inline String makeNonce() {
  uint8_t randomBytes[16];
  esp_fill_random(randomBytes,sizeof(randomBytes));
  static constexpr char kHex[]="0123456789abcdef";
  char out[33];
  for(size_t i=0;i<16;i++) {
    out[i*2]=kHex[randomBytes[i]>>4];
    out[i*2+1]=kHex[randomBytes[i]&15];
  }
  out[32]='\0';
  return String(out);
}
inline String hmacSha256Hex(const uint8_t key[32],const String& message) {
  const auto* info=mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if(!info)return String();
  uint8_t digest[32]={};
  if(mbedtls_md_hmac(info,key,32,
     reinterpret_cast<const uint8_t*>(message.c_str()),
     message.length(),digest)!=0)return String();
  static constexpr char kHex[]="0123456789abcdef";
  char out[65];
  for(size_t i=0;i<32;i++){
    out[i*2]=kHex[digest[i]>>4];
    out[i*2+1]=kHex[digest[i]&15];
  }
  out[64]='\0';
  return String(out);
}
class Sender {
 public:
  // All pointers must remain valid for the lifetime of this Sender.
  Sender(const char* fullEndpoint,const char* hexKey,const char* rootCA)
    : endpoint_(fullEndpoint),keyHex_(hexKey),rootCa_(rootCA){}
  bool configured()const {
    if(!endpoint_||!rootCa_||!std::strstr(rootCa_,"-----BEGIN CERTIFICATE-----")||
       !std::strstr(rootCa_,"-----END CERTIFICATE-----"))return false;
    const String url(endpoint_);
    if(!url.startsWith("https://")||!url.endsWith(kStatusPath)||
       url.indexOf('@')>=0 || url.length()>240)return false;
    uint8_t key[32];
    return decodeKey(keyHex_,key);
  }
  // NEVER call this in an emergency, while a user is picking medicine or
  // while audio/reminders run: it can block for a bounded few seconds.
  // Return true ONLY for an HTTP 200 from a TLS-authenticated endpoint;
  // not evidence of medicine ingestion or remote lock confirmation.
  bool send(const Status& status) {
    if(WiFi.status()!=WL_CONNECTED||!configured())return false;
    // Backend requires a UTC unix timestamp within +/-90 seconds.
    const time_t rawTime=time(nullptr);
    if(rawTime<(time_t)kMinimumUnixTime||rawTime>(time_t)4102444800LL)return false;
    if(!safeLabel(status.systemState,false)||!safeLabel(status.reason,true))return false;
    uint8_t key[32];
    if(!decodeKey(keyHex_,key))return false;
    const String body=makeStatusJson(status);
    const String timestamp=String((uint32_t)rawTime);
    const String nonce=makeNonce();
    const String canonical=String("T4M-STATUS-V1\n")+kStatusPath+"\n"+
      timestamp+"\n"+nonce+"\n"+body;
    const String mac=hmacSha256Hex(key,canonical);
    memset(key,0,sizeof(key));
    if(mac.length()!=64)return false;

    WiFiClientSecure tls;
    tls.setCACert(rootCa_); // Mandatory verified TLS, never disable certificate checks.
    HTTPClient http;
    http.setConnectTimeout(1500);
    http.setTimeout(2500);
    http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
    if(!http.begin(tls,endpoint_))return false;
    http.addHeader("Content-Type","application/json");
    http.addHeader("X-T4M-Timestamp",timestamp);
    http.addHeader("X-T4M-Nonce",nonce);
    http.addHeader("X-T4M-Signature",mac);
    const int code=http.POST((uint8_t*)body.c_str(),body.length());
    http.end();
    return code==200;
  }
 private:
  const char* endpoint_;
  const char* keyHex_;
  const char* rootCa_;
};
} // namespace t4m_telemetry
