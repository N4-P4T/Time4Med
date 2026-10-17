#include "../firmware/schedule_v2/Time4MedScheduleEngine.h"
#include <iostream>
#include <cstdlib>
#define CHECK(x) do {if(!(x)){std::cerr<<"FAIL line "<<__LINE__<<" "<<#x<<"\n";return 1;}}while(0)
class MemStore : public t4m::Storage{
public:
 t4m::Snapshot memory{};bool failNext=false;bool readbackCorrupt=false;
 bool load(t4m::Snapshot& out)override{out=memory;if(readbackCorrupt)out.magic=0;return true;}
 bool commit(const t4m::Snapshot& value)override{
  if(failNext){failNext=false;return false;}
  memory=value;return true;
 }
};
int main(){
 MemStore disk;t4m::Engine e(disk);
 CHECK(e.ready());
 CHECK(e.handle("INFO|testnonce123",false,false,1)=="NACK|UNAUTHENTICATED");
 CHECK(e.handle("INFO|testnonce123",true,true,1)=="NACK|RETAINED_FORBIDDEN");
 CHECK(e.active().count==0);
 const char* rev="1234567890abcdef",*id="request123";
 t4m::Snapshot expected{};expected.count=2;
 std::strcpy(expected.slots[0].user,"U001");std::strcpy(expected.slots[0].time,"08:30");
 std::strcpy(expected.slots[0].meal,"AFTER_BREAKFAST");
 std::strcpy(expected.slots[1].user,"U002");std::strcpy(expected.slots[1].time,"18:30");
 std::strcpy(expected.slots[1].meal,"AFTER_DINNER");
 auto hash=t4m::fingerprint(expected);
 std::string begin=std::string("BEGIN|")+id+"|0000000000000000|"+rev+"|2|"+hash;
 CHECK(e.handle(begin,true,false,100)=="STAGED|request123|2");
 CHECK(e.handle("ENTRY|request123|0|U001|08:30|AFTER_BREAKFAST",false,false,101)=="NACK|UNAUTHENTICATED");
 CHECK(e.active().count==0);
 CHECK(e.handle("ENTRY|request123|0|U001|08:30|AFTER_BREAKFAST",true,false,102)=="ENTRY_OK|request123|0");
 CHECK(e.handle("COMMIT|request123",true,false,103)=="NACK|INCOMPLETE");
 CHECK(e.active().count==0);
 CHECK(e.handle("ENTRY|request123|1|U002|18:30|AFTER_DINNER",true,false,104)=="ENTRY_OK|request123|1");
 disk.failNext=true;
 CHECK(e.handle("COMMIT|request123",true,false,105)=="NACK|PERSIST_FAILED");
 CHECK(e.active().count==0);
 auto success=e.handle("COMMIT|request123",true,false,106);
 CHECK(success==std::string("APPLIED|request123|")+rev+"|"+hash);
 CHECK(e.active().count==2);
 CHECK(std::string(e.active().revision)==rev);
 CHECK(e.handle(begin,true,false,120)=="NACK|REVISION_CONFLICT");
 CHECK(e.handle("INFO|freshrequest",true,false,121)==std::string("INFO|freshrequest|")+rev+"|"+hash);
 t4m::Engine reboot(disk);
 CHECK(reboot.ready());
 CHECK(reboot.active().count==2);
 CHECK(reboot.active().revision==std::string(rev));
 CHECK(reboot.handle("BEGIN|request456|1234567890abcdef|abcdef1234567890|1|0000000000000000",true,false,300)=="STAGED|request456|1");
 CHECK(reboot.handle("ENTRY|request456|0|U009|11:30|BEDTIME",true,false,301)=="NACK|INVALID_ENTRY");
 CHECK(reboot.handle("ENTRY|request456|0|U001|11:30|BEDTIME",true,false,302)=="ENTRY_OK|request456|0");
 CHECK(reboot.handle("COMMIT|request456",true,false,303)=="NACK|HASH_MISMATCH");
 CHECK(reboot.handle("ABORT|request456",true,false,304)=="ABORTED|request456");
 CHECK(reboot.handle("BEGIN|request789|1234567890abcdef|abcdef1234567890|1|0000000000000000",true,false,500)=="STAGED|request789|1");
 CHECK(reboot.handle("COMMIT|request789",true,false,130502)=="NACK|TRANSACTION_EXPIRED");
 CHECK(reboot.active().count==2);
 CHECK(reboot.handle("BEGIN|request789|0000000000000000|abcdef1234567890|1|0000000000000000",true,false,140000)=="NACK|REVISION_CONFLICT");
 CHECK(reboot.handle("BEGIN|request789|1234567890abcdef|abcdef1234567890|0|0000000000000000",true,false,140100)=="NACK|BAD_COUNT");
 CHECK(reboot.handle("BEGIN|request789|1234567890abcdef|abcdef1234567890|19|0000000000000000",true,false,140100)=="NACK|BAD_COUNT");
 MemStore missing;missing.memory.magic=0;t4m::Engine inaccessible(missing);
 CHECK(!inaccessible.ready());
 CHECK(inaccessible.handle("INFO|testnonce123",true,false,1)=="NACK|STORAGE_UNAVAILABLE");
 std::cout<<"PASS: transaction atomicity, auth flag, no retained commands, integrity, readback, reboot, capacity\n";
}
