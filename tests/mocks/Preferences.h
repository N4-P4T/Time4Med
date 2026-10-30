#pragma once
#include <map>
#include <string>
#include <vector>
#include <cstring>
#include <stdint.h>
class Preferences {
public:
 static std::map<std::string,std::vector<uint8_t>> data;
 static bool failWrite;
 static void clear(){data.clear();failWrite=false;}
 bool begin(const char*,bool readOnly=false){readonly=readOnly;return true;}
 void end(){}
 size_t putBytes(const char* key,const void *src,size_t len){
  if(readonly||failWrite)return 0;
  data[key]=std::vector<uint8_t>((const uint8_t*)src,(const uint8_t*)src+len);return len;
 }
 size_t getBytesLength(const char *key){return data.count(key)?data[key].size():0;}
 size_t getBytes(const char *key,void *dst,size_t len){
  if(!data.count(key)||data[key].size()!=len)return 0;
  memcpy(dst,data[key].data(),len);return len;
 }
 uint8_t getUChar(const char* key,uint8_t fallback=0){
  return data.count(key)&&data[key].size()==1?data[key][0]:fallback;
 }
 size_t putUChar(const char* key,uint8_t value){return putBytes(key,&value,1);}
private:
 bool readonly=false;
};
std::map<std::string,std::vector<uint8_t>> Preferences::data;
bool Preferences::failWrite=false;
