import assert from 'node:assert/strict';
export function restoreState(previous,message){
 if(message.type==='state')return message;
 assert(previous&&previous.snapshotId===message.baseSnapshotId,'DELTA_BASE_MISMATCH');
 const state={...previous,...message.changes,snapshotId:message.snapshotId};
 for(const key of message.removedKeys??[])delete state[key];
 for(const [key,d] of Object.entries(message.entities??{})){
  const rows=new Map((previous[key]??[]).map(e=>[e.id,e]));
  for(const id of d.remove??[])rows.delete(id);
  for(const patch of d.patch??[]){assert(rows.has(patch.id),'DELTA_ENTITY_MISSING');const row={...rows.get(patch.id),...patch.set};for(const k of patch.unset??[])delete row[k];rows.set(patch.id,row);}
  for(const row of d.upsert??[])rows.set(row.id,row);
  state[key]=[...rows.values()];
 }
 return state;
}
export class Observer {
 constructor(){this.started=performance.now();this.phases=[];this.results={};this.events={};this.intents={};this.samples=[];this.stuck=[];this.track=new Map();this.trace=[];this.lastSample=-10;this.lastState=null;this.numericChecks=0;this.snapshotChecks=0;this.maxima={enemies:0,items:0,containers:0,projectiles:0};this.distance=0;}
 result(bot,command,result,now){const key=command.command+':'+(result.ok?'OK':result.code);this.results[key]=(this.results[key]??0)+1;this.addTrace({time:Math.round(now*10)/10,bot,command:command.command,target:command.targetId,ok:result.ok,code:result.code});}
 addTrace(value){this.trace.push(value);if(this.trace.length>600)this.trace.shift();}
 event(event){this.events[event.eventType]=(this.events[event.eventType]??0)+1;}
 decision(bot,decision){this.intents[decision.intent]=(this.intents[decision.intent]??0)+1;}
 state(state,world){
  world?.assertInvariants();this.numericChecks++;
  assert(Number.isFinite(state.time)&&Number.isFinite(state.phaseElapsed),'NONFINITE_WORLD_CLOCK');
  if(this.lastState){assert(state.time+1e-6>=this.lastState.time,'WORLD_TIME_REVERSED');assert(state.dayIndex>=this.lastState.dayIndex,'WORLD_DAY_REVERSED');}
  const tag=state.dayIndex+':'+state.phase;
  if(this.phases.at(-1)?.tag!==tag){this.phases.push({tag,time:Math.round(state.time*10)/10,day:state.dayIndex,phase:state.phase,coreHp:state.buildings.find(b=>b.id==='core')?.hp,alive:state.players.filter(p=>p.lifeState==='ALIVE').length,statistics:state.statistics});}
  for(const key of Object.keys(this.maxima))this.maxima[key]=Math.max(this.maxima[key],state[key]?.length??0);
  for(const p of state.players){
   assert([p.x,p.y,p.z,p.hp,p.stamina,p.oxygen].every(Number.isFinite),'NONFINITE_PLAYER');
   assert(p.hp>=0&&p.hp<=100&&p.stamina>=0&&p.oxygen>=0,'PLAYER_LIMITS');
   const last=this.track.get(p.id);if(last&&state.time>last.time&&state.dayIndex===last.day&&p.lifeState===last.life){const d=Math.hypot(p.x-last.x,p.z-last.z);if(d<20)this.distance+=d;}
   this.track.set(p.id,{x:p.x,z:p.z,time:state.time,day:state.dayIndex,life:p.lifeState});
  }
  for(const i of state.items){assert(Number.isSafeInteger(i.quantity)&&i.quantity>0,'ITEM_QUANTITY');if(i.magazineAmmo!==undefined)assert(Number.isFinite(i.magazineAmmo)&&i.magazineAmmo>=0,'AMMO_NEGATIVE');}
  const ids=new Map(state.items.map(i=>[i.id,i]));
  for(const c of state.containers){assert(new Set(c.itemIds).size===c.itemIds.length,'DUPLICATE_OWNERSHIP');for(const id of c.itemIds)assert(ids.get(id)?.containerId===c.id,'ITEM_OWNER_MISMATCH');assert(c.hasContent===(c.itemIds.length>0||(c.recoverableC??0)>0||(c.recoverableM??0)>0),'EMPTY_CONTAINER_MARKER');}
  assert(state.bank.credits>=0&&state.bank.materials>=0&&state.bank.reservedCredits>=0&&state.bank.reservedMaterials>=0,'BANK_NEGATIVE');
  if(state.time-this.lastSample>=10){this.lastSample=state.time;this.samples.push({time:Math.round(state.time),day:state.dayIndex,phase:state.phase,coreHp:state.buildings.find(b=>b.id==='core')?.hp,alive:state.players.filter(p=>p.lifeState==='ALIVE').length,credits:state.bank.credits,materials:state.bank.materials,enemies:state.enemies.length,items:state.items.length,statistics:state.statistics});}
  this.lastState={time:state.time,dayIndex:state.dayIndex};
 }
 report(state){return {wallSeconds:(performance.now()-this.started)/1000,virtualSeconds:state.time,daysReached:state.dayIndex,phase:state.phase,statistics:state.statistics,phases:this.phases,successfulCommands:Object.fromEntries(Object.entries(this.results).filter(([key])=>key.endsWith(':OK'))),rejections:Object.fromEntries(Object.entries(this.results).filter(([key])=>!key.endsWith(':OK'))),events:this.events,intents:this.intents,numericChecks:this.numericChecks,snapshotChecks:this.snapshotChecks,walkedMeters:Math.round(this.distance),maxima:this.maxima,samples:this.samples};}
}
