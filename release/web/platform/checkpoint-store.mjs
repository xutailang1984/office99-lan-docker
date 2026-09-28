// IndexedDB is available on the existing HTTP LAN origin. The checksum detects
// accidental local corruption; it is deliberately not an identity/GM proof.
export const CHECKPOINT_SCHEMA=1;
const DATABASE='office99-host-checkpoints',TABLE='adventures',MAX_BYTES=4*1024*1024;
export function checksum(text){let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619)>>>0;return text.length+':'+hash.toString(16);}
function validState(state){return typeof state?.worldId==='string'&&state.worldId.length>0&&Number.isFinite(state.time)&&state.time>=0&&Number.isSafeInteger(state.tick)&&state.tick>=0;}
export function pack(state,sequence){if(!validState(state)||!Number.isSafeInteger(sequence)||sequence<1)throw Error('本机存档内容无效');const json=JSON.stringify(state);if(new TextEncoder().encode(json).length>MAX_BYTES)throw Error('本机存档太大，游戏已暂停');return {schema:CHECKPOINT_SCHEMA,sequence,json,checksum:checksum(json)};}
export function unpack(value){if(!value||value.schema!==CHECKPOINT_SCHEMA||!Number.isSafeInteger(value.sequence)||value.sequence<1||typeof value.json!=='string'||checksum(value.json)!==value.checksum)throw Error('本机存档校验失败');const state=JSON.parse(value.json);if(!validState(state))throw Error('本机存档内容无效');return state;}
export function latest(record){for(const slot of (Array.isArray(record?.slots)?record.slots:[]).filter(s=>s&&Number.isSafeInteger(s.sequence)).sort((a,b)=>b.sequence-a.sequence)){try{return {slot,state:unpack(slot)};}catch{}}return null;}
export function checkpointKey(ownerId,adventureId){return JSON.stringify([ownerId,adventureId]);}
function storageError(error){const e=Error(error?.name==='QuotaExceededError'?'本机空间不足，游戏已暂停。请清理空间后重试保存。':'本机保存未完成，游戏已暂停。请允许浏览器保存网站数据后重试。');e.code='LOCAL_STORAGE_FAILED';return e;}
export class BrowserCheckpointStore {
  constructor({indexedDB=globalThis.indexedDB,name=DATABASE}={}){this.indexedDB=indexedDB;this.name=name;this.connection=null;}
  async open(){
    if(this.connection)return this.connection;
    this.connection=new Promise((resolve,reject)=>{
      if(!this.indexedDB){reject(storageError());return;}
      const request=this.indexedDB.open(this.name,1);
      request.onupgradeneeded=()=>request.result.createObjectStore(TABLE);
      request.onerror=()=>reject(storageError(request.error));
      request.onblocked=()=>reject(storageError());
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};
    });
    try{return await this.connection;}catch(error){this.connection=null;throw error;}
  }
  async update(key,change){
    const db=await this.open();return new Promise((resolve,reject)=>{
      let result,failure;const tx=db.transaction(TABLE,'readwrite'),store=tx.objectStore(TABLE),request=store.get(key);
      request.onsuccess=()=>{try{result=change(request.result??null);if(result===null)store.delete(key);else store.put(result,key);}catch(error){failure=error;tx.abort();}};
      tx.oncomplete=()=>resolve(structuredClone(result));
      tx.onabort=()=>reject(failure??storageError(tx.error));tx.onerror=()=>{};
    });
  }
  async read(key){const db=await this.open();return new Promise((resolve,reject)=>{const tx=db.transaction(TABLE,'readonly'),request=tx.objectStore(TABLE).get(key);tx.oncomplete=()=>resolve(request.result??null);tx.onabort=()=>reject(storageError(tx.error));tx.onerror=()=>{};});}
  async remove(ownerId,adventureId){return this.update(checkpointKey(ownerId,adventureId),()=>null);}
  async prune(ownerId,authorizedIds,isCurrent=()=>true){
    const db=await this.open(),allowed=new Set(authorizedIds);if(!isCurrent())return;
    return new Promise((resolve,reject)=>{const tx=db.transaction(TABLE,'readwrite'),request=tx.objectStore(TABLE).openCursor();request.onsuccess=()=>{if(!isCurrent()){tx.abort();return;}const c=request.result;if(!c)return;const row=c.value;if(row.ownerId===ownerId&&!allowed.has(row.adventureId))c.delete();c.continue();};tx.oncomplete=resolve;tx.onabort=()=>reject(storageError(tx.error));tx.onerror=()=>{};});
  }
}
