// This module only prepares disposable network views. It never changes simulation or save state.
export const ENTITY_COLLECTIONS=['players','items','containers','buildings','turrets','enemies','destructibles','projectiles','nodes','pools'];
const collections=new Set(ENTITY_COLLECTIONS);
export function quantizeWire(value) {
  if(typeof value==='number')return !Number.isFinite(value)?null:Number.isInteger(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER/1000?value:Math.round(value*1000)/1000;
  if(Array.isArray(value))return value.map(entry=>entry===undefined?null:quantizeWire(entry));
  if(value&&typeof value==='object'){const result={};for(const [key,entry] of Object.entries(value))if(entry!==undefined)result[key]=quantizeWire(entry);return result;}
  return value;
}
const encodeFields=value=>new Map(Object.entries(value).map(([key,entry])=>[key,JSON.stringify(entry)]));
export function compileState(state) {
  const wire=quantizeWire(state);delete wire.snapshotId;
  const entities=new Map(),top={};
  for(const [key,value] of Object.entries(wire)){
    if(collections.has(key)){const index=new Map();for(const entity of value){if(entity.id===undefined||index.has(entity.id))throw Error('Invalid public entity IDs');index.set(entity.id,{value:entity,encoded:JSON.stringify(entity),fields:encodeFields(entity)});}entities.set(key,index);}
    else if(key!=='type')top[key]=value;
  }
  return {worldId:wire.worldId,state:wire,top,topFields:encodeFields(top),entities,fullBody:JSON.stringify(wire),diffs:new WeakMap()};
}
function fieldsChanged(previous,next,previousFields,nextFields,excludeId=false) {
  const set={},unset=[];
  for(const [key,encoded] of nextFields)if(!(excludeId&&key==='id')&&previousFields.get(key)!==encoded)set[key]=next[key];
  for(const key of previousFields.keys())if(!(excludeId&&key==='id')&&!nextFields.has(key))unset.push(key);
  return {set,unset};
}
export function diffState(baseline,current) {
  const cached=current.diffs.get(baseline);if(cached)return cached;
  const {set:changes,unset:removedKeys}=fieldsChanged(baseline.top,current.top,baseline.topFields,current.topFields),entities={};
  for(const collection of ENTITY_COLLECTIONS){
    const previous=baseline.entities.get(collection)??new Map(),next=current.entities.get(collection)??new Map(),upsert=[],patch=[],remove=[];
    for(const [id,entry] of next){const before=previous.get(id);if(!before)upsert.push(entry.value);else if(before.encoded!==entry.encoded){const changed=fieldsChanged(before.value,entry.value,before.fields,entry.fields,true);if(Object.keys(changed.set).length||changed.unset.length)patch.push({id,...changed});}}
    for(const id of previous.keys())if(!next.has(id))remove.push(id);
    if(upsert.length||patch.length||remove.length)entities[collection]={upsert,patch,remove};
  }
  const delta={type:'state_delta',changes,removedKeys,entities},body=JSON.stringify(delta),value={delta,body};current.diffs.set(baseline,value);return value;
}
// Envelopes differ per connection; the expensive body is shared by all sessions on the same baseline.
export function fullEnvelope(frame,snapshotId) { return '{"snapshotId":'+snapshotId+','+frame.fullBody.slice(1); }
export function deltaEnvelope(body,snapshotId,baseSnapshotId) { return '{"snapshotId":'+snapshotId+',"baseSnapshotId":'+baseSnapshotId+','+body.slice(1); }
