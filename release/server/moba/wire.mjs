// Stateless JSON compaction. Every frame carries its own schemas and string table.
// No numbers are rounded and no events or fields are discarded beyond normal JSON semantics.
const TYPE='state_wire',VERSION=1;
const LIMITS=Object.freeze({depth:24,nodes:100000,schemas:256,fields:128,strings:2048,stringLength:16384});
const forbidden=new Set(['__proto__','prototype','constructor']);
const bad=()=>{throw Error('Invalid MOBA wire packet');};
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x)&&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
function checkString(value){if(typeof value!=='string'||value.length>LIMITS.stringLength)bad();}

export function encodeState(state){
 if(!plain(state)||state.type!=='state')bad();
 const counts=new Map(),ancestors=new Set();let scanned=0;
 function scan(value,depth=0){
  if(++scanned>LIMITS.nodes||depth>LIMITS.depth)bad();
  if(typeof value==='string'){checkString(value);counts.set(value,(counts.get(value)??0)+1);return;}
  if(typeof value==='number'){if(!Number.isFinite(value))bad();return;}
  if(value===null||value===undefined||typeof value==='boolean')return;
  if(typeof value!=='object'||!Array.isArray(value)&&!plain(value)||ancestors.has(value))bad();
  ancestors.add(value);
  if(Array.isArray(value)){for(const v of value)scan(v,depth+1);}
  else{const keys=Object.keys(value);if(keys.length>LIMITS.fields)bad();for(const key of keys){checkString(key);if(forbidden.has(key))bad();scan(value[key],depth+1);}}
  ancestors.delete(value);
 }
 scan(state);
 const strings=[],stringIndex=new Map();
 for(const [text,count]of counts){
  const size=JSON.stringify(text).length,reference=5+String(strings.length).length;
  if(count>1&&(size-reference)*count>size+1&&strings.length<LIMITS.strings){stringIndex.set(text,strings.length);strings.push(text);}
 }
 const schemas=[],schemaIndex=new Map();
 function encode(value){
  if(value===undefined)return null;
  if(typeof value==='string'&&stringIndex.has(value))return[-2,stringIndex.get(value)];
  if(value===null||typeof value!=='object')return value;
  if(Array.isArray(value))return[-1,...value.map(encode)];
  const keys=Object.keys(value).filter(key=>value[key]!==undefined),signature=JSON.stringify(keys);
  let id=schemaIndex.get(signature);
  if(id===undefined){id=schemas.length;if(id>=LIMITS.schemas)bad();schemas.push(keys);schemaIndex.set(signature,id);}
  const values=keys.map(key=>encode(value[key]));
  const mask=values.map(v=>v===false?'f':v===true?'t':v===null?'n':v===0?'z':'v').join('');
  const saved=values.reduce((n,v)=>n+(v===false?6:v===true||v===null?5:v===0?2:0),0);
  // Optional per-field constants, chosen only when smaller than the full value row.
  if(saved>mask.length+6)return[-3,id,mask,...values.filter((_v,i)=>mask[i]==='v')];
  return[id,...values];
 }
 const data=encode(state);
 return{type:TYPE,version:VERSION,schemas,strings,data};
}

export function decodeState(packet){
 if(plain(packet)&&packet.type==='state_team'){
  if(typeof packet.selfId!=='string'||!plain(packet.self)||packet.frame?.type!==TYPE)bad();
  const state=decodeState(packet.frame);if(state?.type!=='state'||state.selfId!==null||state.self!==null)bad();
  state.selfId=packet.selfId;state.self=packet.self;return state;
 }
 if(!plain(packet)||packet.type!==TYPE)return packet;
 if(packet.version!==VERSION||!Array.isArray(packet.schemas)||packet.schemas.length>LIMITS.schemas||!Array.isArray(packet.strings)||packet.strings.length>LIMITS.strings)bad();
 for(const keys of packet.schemas){if(!Array.isArray(keys)||keys.length>LIMITS.fields||new Set(keys).size!==keys.length)bad();for(const key of keys){checkString(key);if(forbidden.has(key))bad();}}
 for(const text of packet.strings)checkString(text);
 let nodes=0;
 function decode(value,depth=0){
  if(++nodes>LIMITS.nodes||depth>LIMITS.depth)bad();
  if(!Array.isArray(value)){
   if(value===null||typeof value==='boolean')return value;
   if(typeof value==='number'&&Number.isFinite(value))return value;
   if(typeof value==='string'){checkString(value);return value;}
   bad();
  }
  const tag=value[0];if(!Number.isInteger(tag))bad();
  if(tag===-1)return value.slice(1).map(v=>decode(v,depth+1));
  if(tag===-2){if(value.length!==2||!Number.isInteger(value[1])||value[1]<0||value[1]>=packet.strings.length)bad();return packet.strings[value[1]];}
  if(tag===-3){
   const id=value[1],mask=value[2];if(!Number.isInteger(id)||id<0||id>=packet.schemas.length||typeof mask!=='string')bad();
   const keys=packet.schemas[id];if(mask.length!==keys.length||/[^vftnz]/.test(mask)||value.length!==3+[...mask].filter(c=>c==='v').length)bad();
   const result={};let cursor=3;
   for(let i=0;i<keys.length;i++){const code=mask[i];result[keys[i]]=decode(code==='v'?value[cursor++]:code==='f'?false:code==='t'?true:code==='n'?null:0,depth+1);}
   return result;
  }
  if(tag<0||tag>=packet.schemas.length)bad();
  const keys=packet.schemas[tag];if(value.length!==keys.length+1)bad();
  const result={};for(let i=0;i<keys.length;i++)result[keys[i]]=decode(value[i+1],depth+1);
  return result;
 }
 const state=decode(packet.data);if(!plain(state)||state.type!=='state')bad();return state;
}

export function stringifyPacket(message){return JSON.stringify(message?.type==='state'?encodeState(message):message);}
export function parsePacket(text){return decodeState(JSON.parse(text));}

// MobaWorld.snapshots shares one immutable world view per team. Encode that view
// once, then attach each seat's private HUD without repeating the expensive scan.
export function stringifySnapshots(frames){
 const teams=new Map();return frames.map(({seat,state})=>{
  if(!plain(state.self))return{seat,data:stringifyPacket(state)};
  let common=teams.get(state.team);if(common===undefined){common=JSON.stringify(encodeState({...state,selfId:null,self:null}));teams.set(state.team,common);}
  return{seat,data:'{"type":"state_team","frame":'+common+',"selfId":'+JSON.stringify(state.selfId)+',"self":'+JSON.stringify(state.self)+'}'};
 });
}

export const wireLimits=LIMITS;
