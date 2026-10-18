#pragma once
// Time4Med transaction engine v2. Portable C++17; no GPIO, network or MQTT.
// Caller MUST authenticate every message (HMAC and broker ACL) before handle().
// FNV-1a verifies byte-level consistency ONLY; it is NOT authentication.
#include <array>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>
#include <algorithm>
#include <cstdio>

namespace t4m {
constexpr std::size_t kCapacity = 18;
constexpr std::uint32_t kMagic = 0x54344D32u;
struct Slot {
  char user[5] = {};      // U001..U003
  char time[6] = {};      // HH:MM
  char meal[24] = {};     // BEFORE_BREAKFAST etc
};
struct Snapshot {
  std::uint32_t magic = kMagic;
  std::uint8_t version = 2;
  std::uint8_t count = 0;
  char revision[17] = "0000000000000000";
  Slot slots[kCapacity] = {};
};
struct Storage {
  virtual ~Storage() = default;
  virtual bool load(Snapshot& out) = 0;
  virtual bool commit(const Snapshot& data) = 0; // atomic write and verify
};

inline bool validRev(const std::string& s) {
  if(s.size()!=16)return false;
  for(char c:s)if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;
  return true;
}
inline bool validId(const std::string& s) {
  if(s.size()<8||s.size()>32)return false;
  for(char c:s)if(!((c>='0'&&c<='9')||(c>='a'&&c<='z')||(c>='A'&&c<='Z')||c=='_'||c=='-'))return false;
  return true;
}
inline bool validTime(const std::string& t) {
  if(t.size()!=5||t[2]!=':')return false;
  for(int i:{0,1,3,4})if(t[i]<'0'||t[i]>'9')return false;
  return (t[0]-'0')*10+t[1]-'0'<24 && (t[3]-'0')*10+t[4]-'0'<60;
}
inline bool validMeal(const std::string& s) {
  static const char* types[]={"BEFORE_BREAKFAST","AFTER_BREAKFAST","BEFORE_LUNCH",
  "AFTER_LUNCH","BEFORE_DINNER","AFTER_DINNER","BEDTIME"};
  for(const auto* v:types)if(s==v)return true;
  return false;
}
inline bool validSlot(const Slot& slot) {
  const std::string user(slot.user, strnlen(slot.user,sizeof(slot.user)));
  const std::string time(slot.time, strnlen(slot.time,sizeof(slot.time)));
  const std::string meal(slot.meal,strnlen(slot.meal,sizeof(slot.meal)));
  if(user!="U001"&&user!="U002"&&user!="U003")return false;
  return validTime(time) && validMeal(meal);
}
inline bool validSnapshot(const Snapshot& value) {
  if(value.magic!=kMagic||value.version!=2||value.count>kCapacity)return false;
  if(!validRev(std::string(value.revision,strnlen(value.revision,17))))return false;
  for(std::size_t i=0;i<value.count;i++)if(!validSlot(value.slots[i]))return false;
  return true;
}
inline std::vector<std::string> split(const std::string& s) {
  std::vector<std::string> out;std::size_t at=0;
  for(;;){
    std::size_t next=s.find('|',at);
    if(next==std::string::npos){out.push_back(s.substr(at));return out;}
    out.push_back(s.substr(at,next-at));at=next+1;
    if(out.size()>9)return {};
  }
}
inline std::string fingerprint(const Snapshot& snap) {
  std::uint64_t acc=14695981039346656037ULL;
  const auto add=[&acc](char c){acc^=(std::uint8_t)c;acc*=1099511628211ULL;};
  for(std::size_t i=0;i<snap.count;i++){
    const auto& s=snap.slots[i];
    for(const char* p=s.user;*p;++p)add(*p);
    add('|');
    for(const char* p=s.time;*p;++p)add(*p);
    add('|');
    for(const char* p=s.meal;*p;++p)add(*p);
    add('\n');
  }
  char out[17];std::snprintf(out,sizeof(out),"%016llx",(unsigned long long)acc);
  return out;
}

class Engine {
 public:
  explicit Engine(Storage& storage):store_(storage){
    ready_=store_.load(active_)&&validSnapshot(active_);
  }
  bool ready()const{return ready_;}
  const Snapshot& active()const{return active_;}
  // authenticated = verified END-TO-END MAC over topic+payload+nonce by caller.
  // retained is prohibited, since old broker messages must never mutate schedules.
  std::string handle(const std::string& line,bool authenticated,bool retained,std::uint32_t nowMs) {
    if(!authenticated)return "NACK|UNAUTHENTICATED";
    if(retained)return "NACK|RETAINED_FORBIDDEN";
    if(!ready_)return "NACK|STORAGE_UNAVAILABLE";
    if(line.size()>128)return "NACK|OVERSIZE";
    auto p=split(line);
    if(p.empty())return "NACK|SYNTAX";
    if(p[0]=="INFO" && p.size()==2 && validId(p[1]))
      return "INFO|"+p[1]+"|"+std::string(active_.revision)+"|"+fingerprint(active_);
    if(p[0]=="BEGIN"){
      // BEGIN|requestId|baseRev|nextRev|count|fnv64
      if(p.size()!=6||!validId(p[1])||!validRev(p[2])||!validRev(p[3])||
        p[2]==p[3]||!validRev(p[5]))return "NACK|BEGIN_SYNTAX";
      const auto& count=p[4];
      if(count.empty()||count.size()>2||!std::all_of(count.begin(),count.end(),[](char c){return c>='0'&&c<='9';}))
        return "NACK|BAD_COUNT";
      const auto n=std::stoi(count);
      if(n<1||n>(int)kCapacity)return "NACK|BAD_COUNT";
      if(p[2]!=active_.revision)return "NACK|REVISION_CONFLICT";
      staged_=Snapshot{};
      std::strncpy(staged_.revision,p[3].c_str(),16);
      staged_.count=(std::uint8_t)n;
      pendingId_=p[1];expectedHash_=p[5];received_.fill(false);started_=nowMs;
      return "STAGED|"+pendingId_+"|"+std::to_string(n);
    }
    if(p.size()<2||!validId(p[1]))return "NACK|SYNTAX";
    if(pendingId_!=p[1])return "NACK|NO_MATCHING_TRANSACTION";
    if((std::uint32_t)(nowMs-started_)>120000){reset();return "NACK|TRANSACTION_EXPIRED";}
    if(p[0]=="ABORT"&&p.size()==2){reset();return "ABORTED|"+p[1];}
    if(p[0]=="ENTRY"){
      // ENTRY|requestId|slotIndex|U001|HH:MM|MEAL
      if(p.size()!=6)return "NACK|ENTRY_SYNTAX";
      if(p[2].empty()||p[2].size()>2||!std::all_of(p[2].begin(),p[2].end(),[](char c){return c>='0'&&c<='9';}))
        return "NACK|BAD_SLOT";
      auto i=std::stoi(p[2]);
      if(i<0||i>=staged_.count)return "NACK|BAD_SLOT";
      Slot entry{};
      if(p[3].size()!=4||p[4].size()!=5||p[5].size()>=sizeof(entry.meal))
        return "NACK|ENTRY_LENGTH";
      std::strncpy(entry.user,p[3].c_str(),4);
      std::strncpy(entry.time,p[4].c_str(),5);
      std::strncpy(entry.meal,p[5].c_str(),sizeof(entry.meal)-1);
      if(!validSlot(entry))return "NACK|INVALID_ENTRY";
      if(received_[i] && (std::strcmp(staged_.slots[i].user,entry.user)||
          std::strcmp(staged_.slots[i].time,entry.time)||
          std::strcmp(staged_.slots[i].meal,entry.meal)))return "NACK|ENTRY_CONFLICT";
      staged_.slots[i]=entry;received_[i]=true;
      return "ENTRY_OK|"+p[1]+"|"+p[2];
    }
    if(p[0]=="COMMIT" && p.size()==2){
      for(int i=0;i<staged_.count;i++)if(!received_[i])return "NACK|INCOMPLETE";
      std::string previous;
      for(int i=0;i<staged_.count;i++){
        const Slot& s=staged_.slots[i];
        const std::string cur=std::string(s.user)+"|"+s.time+"|"+s.meal;
        if(!previous.empty()&&previous>=cur)return "NACK|DUPLICATE_OR_OUT_OF_ORDER";
        previous=cur;
      }
      if(fingerprint(staged_)!=expectedHash_)return "NACK|HASH_MISMATCH";
      if(!store_.commit(staged_))return "NACK|PERSIST_FAILED";
      Snapshot verified{};
      if(!store_.load(verified)||!validSnapshot(verified)||
         std::strcmp(verified.revision,staged_.revision)||fingerprint(verified)!=expectedHash_)
        return "NACK|READBACK_FAILED"; // reboot or maintenance needed, never claim applied
      active_=verified;
      const std::string ack="APPLIED|"+p[1]+"|"+active_.revision+"|"+expectedHash_;
      reset();
      return ack;
    }
    return "NACK|UNKNOWN_OPERATION";
  }
 private:
  void reset(){pendingId_.clear();expectedHash_.clear();received_.fill(false);staged_=Snapshot{};}
  Storage& store_; bool ready_=false;
  Snapshot active_{};Snapshot staged_{};
  std::array<bool,kCapacity> received_{};
  std::string pendingId_,expectedHash_;
  std::uint32_t started_=0;
};
} // namespace t4m
