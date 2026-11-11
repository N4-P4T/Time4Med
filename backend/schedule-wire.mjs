/**
 * Wire-level HMAC-SHA256 envelope builder for a future authenticated MQTT bridge.
 * This module does NOT connect to a broker, publish or store counters.
 * Only server-side code may load the per-device 32+ byte shared secret.
 */
export const V2_COMMAND_TOPIC="time4med/v2/cabinet/cabinet-01/schedule/command";
export const V2_DEVICE="ESP32S3-01";
const HEX=/^[a-f0-9]{64}$/;
const VALID_COMMAND=/^[A-Za-z0-9_|:-]{1,128}$/;
export async function signScheduleCommand({deviceId=V2_DEVICE,topic=V2_COMMAND_TOPIC,sequence,command,key}){
 if(deviceId!==V2_DEVICE||topic!==V2_COMMAND_TOPIC)throw Error("WRONG_DEVICE_OR_TOPIC");
 if(!(key instanceof Uint8Array)||key.byteLength<32)throw Error("HMAC_KEY_REQUIRED");
 if(!Number.isSafeInteger(sequence)||sequence<=0)throw Error("INVALID_SEQUENCE");
 if(typeof command!=="string"||!VALID_COMMAND.test(command))throw Error("INVALID_COMMAND");
 const source=new TextEncoder().encode(command);
 const b64=btoa(String.fromCharCode(...source));
 const canonical="T4M-V2\n"+deviceId+"\n"+topic+"\n"+sequence+"\n"+b64;
 const cryptoKey=await crypto.subtle.importKey("raw",key,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const digest=await crypto.subtle.sign("HMAC",cryptoKey,new TextEncoder().encode(canonical));
 const mac=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
 if(!HEX.test(mac))throw Error("INVALID_MAC");
 return "V2|"+sequence+"|"+b64+"|"+mac;
}
