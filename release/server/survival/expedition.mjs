import {ZONE_RISKS,expeditionContract,publicRiskZones} from './expedition-config.mjs';

const phases=new Set(['DAY','RETURN','RECOVERY']);
export function attachExpedition(world,need){
 if(world.mode==='mission')return null;
 const e=new Expedition(world,need);world.expedition=e;e.install();return e;
}
export class Expedition {
 constructor(world,need){
  this.w=world;this.need=need;
  world.s.expedition??={version:1,day:world.s.dayIndex,records:[]};this.s=world.s.expedition;
  need(this.s.version===1&&Number.isSafeInteger(this.s.day)&&Array.isArray(this.s.records),'INVALID_TARGET','外勤记录无法读取');
  const keys=new Set();
  for(const row of this.s.records){need(typeof row.accountKey==='string'&&!keys.has(row.accountKey)&&Array.isArray(row.seen)&&row.seen.length<=512&&row.progress&&Array.isArray(row.claimed),'INVALID_TARGET','外勤记录无法读取');keys.add(row.accountKey);
   for(const id of row.claimed)need(ZONE_RISKS.some(z=>z.id===id),'INVALID_TARGET');
   for(const value of Object.values(row.progress))need(Number.isSafeInteger(value.search)&&value.search>=0&&Number.isSafeInteger(value.kills)&&value.kills>=0,'INVALID_TARGET');
  }
  this.ensureDay();
 }
 ensureDay(){if(this.s.day!==this.w.s.dayIndex){this.s.day=this.w.s.dayIndex;this.s.records=[];this.w.requestSave=true;}}
 key(p){return p.tokenHash||'local-slot:'+p.slotId;}
 row(p,create=true){this.ensureDay();let row=this.s.records.find(r=>r.accountKey===this.key(p));if(!row&&create){row={accountKey:this.key(p),seen:[],progress:{},claimed:[]};this.s.records.push(row);}return row;}
 contracts(p){const row=this.row(p,false);return ZONE_RISKS.map(z=>{const def=expeditionContract(z.id,this.s.day),progress=row?.progress[z.id]??{search:0,kills:0},claimed=row?.claimed.includes(z.id)??false;return {...def,...progress,claimed,ready:!claimed&&progress.search>=def.searchGoal&&progress.kills>=def.killGoal};});}
 contributors(enemy,actorId){
  if(enemy.source!=='wild')return [];
  const damage=this.w.s.enemyAggro?.[enemy.id]?.damage??{};
  return this.w.scenePlayers().filter(p=>p.lifeState==='ALIVE'&&this.w.nearestZone(p)?.id===enemy.zoneId&&
   (Math.hypot(p.x-enemy.x,p.z-enemy.z)<=12||(p.id===actorId||damage[p.id])&&Math.hypot(p.x-enemy.x,p.z-enemy.z)<=24)).map(p=>p.id);
 }
 record(type,{id,actorId,zoneId,source}={}){
  if(!phases.has(this.w.s.phase)||!ZONE_RISKS.some(z=>z.id===zoneId)||!['search','kill'].includes(type)||type==='kill'&&source!=='wild')return;
  const p=this.w.s.players[actorId];if(!p||!this.w.inScene(p)||p.lifeState!=='ALIVE')return;
  const row=this.row(p),key=type+':'+id;if(row.seen.includes(key)||row.claimed.includes(zoneId)||row.seen.length>=512)return;
  row.seen.push(key);const progress=row.progress[zoneId]??={search:0,kills:0},goal=expeditionContract(zoneId,this.s.day);
  const field=type==='search'?'search':'kills',limit=type==='search'?goal.searchGoal:goal.killGoal;progress[field]=Math.min(limit,progress[field]+1);this.w.requestSave=true;
 }
 died(p){const row=this.row(p,false);if(row){for(const id of Object.keys(row.progress))if(!row.claimed.includes(id))row.progress[id]={search:0,kills:0};this.w.requestSave=true;}}
 claim(p,{stationId,zoneId}={}){
  const w=this.w;w.requireAction(p);
  this.need(phases.has(w.s.phase)||w.s.phase==='PREP','WRONG_PHASE','夜里先守住办公室');
  this.need(w.terminal(p,'storage',stationId),'OUT_OF_RANGE','回仓库交外勤');
  this.need(!p.work&&!p.fishing&&!p.reload&&!p.meleePending&&!p.carryingId&&!p.swimming&&w.s.time-(p.damageAt??-100)>=5,'BUSY','先放下箱子，脱离战斗');
  this.need(zoneId===undefined||ZONE_RISKS.some(z=>z.id===zoneId),'INVALID_TARGET');
  const claims=this.contracts(p).filter(c=>c.ready&&(zoneId===undefined||c.zoneId===zoneId));this.need(claims.length,'INVALID_TARGET','完成区域目标，再回仓库领取');
  const amounts=new Map();for(const c of claims)for(const item of c.reward)amounts.set(item.definitionId,(amounts.get(item.definitionId)??0)+item.quantity);
  const bag=w.bag(p);let slots=0;
  for(const [id,quantity]of amounts){const stack=w.defs.items[id].stack,available=bag.itemIds.map(key=>w.s.items[key]).filter(item=>item.definitionId===id&&!item.lockedBy&&!item.loanOwnerSlotId).reduce((n,item)=>n+stack-item.quantity,0);slots+=Math.max(0,Math.ceil((quantity-available)/stack));}
  this.need(slots<=bag.slotLimit-bag.itemIds.length,'NO_CAPACITY','背包满了，先存一些物品');
  for(const [id,quantity]of amounts)w.addItems(bag,id,quantity);
  const row=this.row(p);for(const c of claims)row.claimed.push(c.zoneId);w.requestSave=true;
  const result={zones:claims.map(c=>c.zoneId),items:[...amounts].map(([definitionId,quantity])=>({definitionId,quantity}))};
  w.event('ExpeditionReturned',{actorId:p.id,...result},p.id);return result;
 }
 publicState(){this.ensureDay();return {version:1,day:this.s.day,zones:publicRiskZones(),players:this.w.scenePlayers().map(p=>({playerId:p.id,contracts:this.contracts(p)}))};}
 install(){
  const w=this.w,e=this,wrap=(name,fn)=>{const original=w[name].bind(w);w[name]=(...args)=>fn(original,...args);};
  wrap('publicState',(original,...args)=>({...original(...args),expedition:e.publicState()}));
  wrap('catalog',original=>({...original(),expedition:{zones:publicRiskZones(),returnCommand:'ReturnExpedition'}}));
  wrap('dispatch',(original,p,message)=>message.command==='ReturnExpedition'?e.claim(p,message.payload??{}):original(p,message));
  wrap('die',(original,p,...args)=>{const alive=p.lifeState!=='DEAD_WAIT';const result=original(p,...args);if(alive&&p.lifeState==='DEAD_WAIT')e.died(p);return result;});
  wrap('generateDay',(original,...args)=>{const result=original(...args);e.ensureDay();return result;});
 }
}
