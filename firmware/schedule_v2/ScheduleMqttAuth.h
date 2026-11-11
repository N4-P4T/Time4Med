#pragma once
/*
 * Time4Med MQTT v2 HMAC-SHA256 verifier — ESP32 Arduino only.
 * Authentication MUST pass before handing command to Engine::handle().
 * NO key included. NO broker or production MQTT callback integrated.
 * Persist last accepted sequence monotonically before executing commands.
 */
#include <Arduino.h>
#include <mbedtls/md.h>
#include <mbedtls/base64.h>
#include <cstdint>
#include <cstring>
#include <string>
#include "Time4MedScheduleEngine.h"
namespace t4m {
constexpr const char* kV2Topic="time4med/v2/cabinet/cabinet-01/schedule/command";
constexpr const char* kV2Device="ESP32S3-01";
struct VerifiedFrame {
 std::uint64_t sequence=0;
 std::string command;
 bool verified=false;
};
inline int hexNibble(char c){
 if(c>='0'&&c<='9')return c-'0';
 if(c>='a'&&c<='f')return c-'a'+10;
 return -1;
}
inline bool parseCounter(const std::string& s,std::uint64_t& value){
 if(s.empty()||s.size()>20||s[0]=='0')return false;
 std::uint64_t n=0;
 for(char c:s){
  if(c<'0'||c>'9')return false;
  std::uint64_t digit=std::uint64_t(c-'0');
  if(n>(UINT64_MAX-digit)/10)return false;
  n=n*10+digit;
 }
 if(!n)return false;
 value=n;return true;
}
inline VerifiedFrame verifyScheduleFrame(
 const std::string& topic,const std::string& envelope,
 const std::uint8_t* hmacKey,std::size_t keyLen,
 std::uint64_t lastAcceptedSequence,bool retained){
 VerifiedFrame rejected{};
 if(retained||topic!=kV2Topic||!hmacKey||keyLen<32||envelope.size()>330)return rejected;
 const auto p=split(envelope);
 if(p.size()!=4||p[0]!="V2"||p[3].size()!=64||p[2].size()>175||p[2].empty())
   return rejected;
 std::uint64_t counter=0;
 if(!parseCounter(p[1],counter)||counter<=lastAcceptedSequence)return rejected;
 for(char c:p[3])if(hexNibble(c)<0)return rejected;
 const std::string canonical=std::string("T4M-V2\n")+kV2Device+"\n"+topic+"\n"+p[1]+"\n"+p[2];
 const mbedtls_md_info_t* sha=mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
 if(!sha)return rejected;
 std::uint8_t mac[32]={};
 if(mbedtls_md_hmac(sha,hmacKey,keyLen,
     reinterpret_cast<const unsigned char*>(canonical.data()),canonical.size(),mac)!=0)
   return rejected;
 unsigned diff=0;
 for(std::size_t i=0;i<32;i++){
   auto expected=(std::uint8_t)((hexNibble(p[3][i*2])<<4)|hexNibble(p[3][i*2+1]));
   diff|=mac[i]^expected;
 }
 if(diff)return rejected; // Constant-time MAC comparison.
 unsigned char decoded[129]={};std::size_t decodedLength=0;
 if(mbedtls_base64_decode(decoded,sizeof(decoded)-1,&decodedLength,
    reinterpret_cast<const unsigned char*>(p[2].data()),p[2].size())!=0
    ||decodedLength==0||decodedLength>128)return rejected;
 for(std::size_t i=0;i<decodedLength;i++){
   const char c=char(decoded[i]);
   if(!((c>='a'&&c<='z')||(c>='A'&&c<='Z')||
        (c>='0'&&c<='9')||c=='_'||c=='-'||c=='|'||c==':'))return rejected;
 }
 VerifiedFrame valid{};
 valid.verified=true;valid.sequence=counter;
 valid.command=std::string(reinterpret_cast<char*>(decoded),decodedLength);
 return valid;
}
} // namespace t4m
