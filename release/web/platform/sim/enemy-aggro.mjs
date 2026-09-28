// Target decisions use the authoritative game clock. Private, bounded memory is
// saved beside the world, never copied into public enemy snapshots.
import {practiceEnemyInside} from './mission-mode.mjs';
export const AGGRO_RULES=Object.freeze({scanSeconds:.2,holdSeconds:1,switchRatio:1.25,switchMargin:.1,damageScale:40,halfLife:6,memorySeconds:18,lastSeenSeconds:2,maxAttackers:10,nightRange:12,bossRange:8,nightSeconds:4,bossSeconds:3,nightTravel:8,bossTravel:6,routeSeconds:2});
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const finite=(n,f=0)=>Number.isFinite(n)?n:f;

export class EnemyAggro {
 constructor(w){
  this.w=w;
  this.pruneAt=0;
  if(!w.s.enemyAggro||typeof w.s.enemyAggro!=='object'||Array.isArray(w.s.enemyAggro))w.s.enemyAggro={};
  this.prune();
 }
 state(e){
  const all=this.w.s.enemyAggro;
  let r=all[e.id];
  if(!r||typeof r!=='object'||Array.isArray(r))r=all[e.id]={};
  if(!r.damage||typeof r.damage!=='object'||Array.isArray(r.damage))r.damage={};
  const now=this.w.s.time;
  r.switchAt=Math.min(now,finite(r.switchAt,-100));r.scanAt=Math.min(now+AGGRO_RULES.scanSeconds,finite(r.scanAt,0));
  r.routeUntil=Math.min(now+AGGRO_RULES.routeSeconds,finite(r.routeUntil,0));r.seenAt=Math.min(now,finite(r.seenAt,-100));
  if(typeof r.targetId!=='string')r.targetId=null;
  if(r.engagement&&(!Number.isFinite(r.engagement.x)||!Number.isFinite(r.engagement.z)||!Number.isFinite(r.engagement.until)||r.engagement.until>now+AGGRO_RULES.nightSeconds+.01))r.engagement=null;
  return r;
 }
 prune(){
  for(const id of Object.keys(this.w.s.enemyAggro))if(!this.w.s.enemies[id]||this.w.s.enemies[id].hp<=0)delete this.w.s.enemyAggro[id];
 }
 forget(id){delete this.w.s.enemyAggro[id];}
 stimulus(){for(const r of Object.values(this.w.s.enemyAggro))r.scanAt=0;}
 home(e){return{x:finite(e.homeX,e.x),z:finite(e.homeZ,e.z)};}
 leash(e){return e.source==='practice'?(e.practiceZone==='boss'?11:14):e.source==='rare_catch'?this.w.c.exploration.rareLeash:e.source==='fishing'?this.w.c.fishing.open_water.leash_range:this.w.c.encounters.guard_alert.leash_range;}
 inside(e,point){
  if(e.source==='practice')return practiceEnemyInside(e,point);
  return e.night||dist(this.home(e),point)<=this.leash(e)&&(['fishing','rare_catch'].includes(e.source)||Math.hypot(point.x,point.z)>=15);
 }
 actor(id){const w=this.w;return w.s.players[id]??w.s.turrets[id]??w.director?.s.deployables.find(d=>d.id===id);}
 living(target){
  if(!target||target.hp<=0)return false;
  if(target.lifeState)return target.lifeState==='ALIVE'&&this.w.inScene(target);
  if(target.kind==='decoy')return target.expiresAt>this.w.s.time;
  return !!this.w.s.turrets[target.id];
 }
 memory(r){
  const now=this.w.s.time;
  for(const [id,h]of Object.entries(r.damage)){
   if(!h||!Number.isFinite(h.value)||!Number.isFinite(h.at)||now-h.at>AGGRO_RULES.memorySeconds||h.at>now+.01||!this.actor(id))delete r.damage[id];
  }
  const keys=Object.keys(r.damage).sort((a,b)=>r.damage[b].at-r.damage[a].at||a.localeCompare(b));
  for(const id of keys.slice(AGGRO_RULES.maxAttackers))delete r.damage[id];
 }
 threat(e,id){const r=this.state(e),h=r.damage[id];return h?Math.max(0,h.value*Math.pow(.5,Math.max(0,this.w.s.time-h.at)/AGGRO_RULES.halfLife)):0;}
 damage(e,attacker,amount){
  if(!attacker||!this.living(attacker)||!(amount>0)||e.hp<=0||!Number.isFinite(amount))return;
  const r=this.state(e);this.memory(r);
  r.damage[attacker.id]={value:Math.min(AGGRO_RULES.damageScale*4,this.threat(e,attacker.id)+amount),at:this.w.s.time};
  this.memory(r);r.scanAt=0;
 }
 returnGate(e){
  if(e.night)return false;
  const r=this.state(e),home=this.home(e),limit=this.leash(e);
  const old=this.actor(r.targetId);
  if(!this.inside(e,e)||(old&&this.living(old)&&!this.inside(e,old))){r.returning=true;r.targetId=null;r.scanAt=0;}
  const reentry=e.source==='fishing'?Math.max(.5,limit*.55):Math.max(1,limit-8);
  if(r.returning&&this.inside(e,e)&&dist(e,home)<=reentry)r.returning=false;
  if(r.returning){e.alertState='returning';e.targetId=null;return true;}
  return false;
 }
 returnPoint(e){
  const r=this.state(e);
  if(r.returning)return this.home(e);
  if(!e.night&&this.w.s.time-r.seenAt<=AGGRO_RULES.lastSeenSeconds&&Number.isFinite(r.seenX)&&Number.isFinite(r.seenZ))return{x:r.seenX,z:r.seenZ};
  return null;
 }
 strategic(e){
  const w=this.w,core=w.s.buildings.core;
  if(e.role==='breaker'){
   const wall=Object.values(w.s.buildings).filter(b=>b.hp>0&&b.definitionId!=='core'&&dist(e,b)<12&&w.lineVisible(e,b)).sort((a,b)=>dist(e,a)-dist(e,b)||a.id.localeCompare(b.id))[0];
   if(wall)return wall;
  }
  // Turrets are fixed parts of the fortress, not roaming distractions.
  const turret=Object.values(w.s.turrets).filter(t=>t.hp>0&&dist(e,t)<8&&w.lineVisible(e,t)).sort((a,b)=>dist(e,a)-dist(e,b)||a.id.localeCompare(b.id))[0];
  if(turret)return turret;
  const direction={x:core.x-e.x,y:0,z:core.z-e.z},length=Math.hypot(direction.x,direction.z);direction.x/=length||1;direction.z/=length||1;
  const blocker=w.rayBlock({x:e.x,y:e.y+1,z:e.z},direction,length,e.id);
  return w.s.buildings[blocker?.id]??w.s.turrets[blocker?.id]??core;
 }
 inWindow(e,target,r){
  if(!e.night)return this.inside(e,target);
  if(!r.engagement)return true;
  const budget=e.definitionId==='boss_crab'?AGGRO_RULES.bossTravel:AGGRO_RULES.nightTravel;
  const targetRange=e.definitionId==='boss_crab'?AGGRO_RULES.bossRange:AGGRO_RULES.nightRange;
  return dist(target,r.engagement)<=targetRange&&dist(e,r.engagement)<=budget;
 }
 endEngagement(r){
  r.engagement=null;r.targetId=null;r.scanAt=0;r.routeUntil=this.w.s.time+AGGRO_RULES.routeSeconds;
 }
 select(e){
  const w=this.w,now=w.s.time,r=this.state(e),boss=e.definitionId==='boss_crab',definition=w.enemyDefinition(e);
  if(now>=this.pruneAt){this.prune();this.pruneAt=now+1;}
  this.memory(r);
  if(this.returnGate(e))return null;
  if(e.night&&r.engagement&&(now>=r.engagement.until||dist(e,r.engagement)>(boss?AGGRO_RULES.bossTravel:AGGRO_RULES.nightTravel)))this.endEngagement(r);
  if(e.night&&now<r.routeUntil){e.alertState='siege';return this.strategic(e);}
  const old=this.actor(r.targetId);
  const legal=target=>{
   if(!this.living(target)||!this.inside(e,target)||!this.inWindow(e,target,r))return false;
   const damage=this.threat(e,target.id),range=e.night?(boss?AGGRO_RULES.bossRange:AGGRO_RULES.nightRange):Math.min(this.leash(e),definition.aggro_range+(damage>0?6:0));
   if(dist(e,target)>range)return false;
   if(target.lifeState&&(target.joinProtectionUntil??0)>now&&damage<=0)return false;
   if(e.night&&target.lifeState&&dist(e,target)>w.c.encounters.nightly_boss.player_proximity&&damage<=0)return false;
   if(target.kind==='decoy'&&(boss||dist(e,target)>target.radius))return false;
   if(['fishing','rare_catch'].includes(e.source)&&!target.lifeState&&target.kind!=='decoy')return false;
   return true;
  };
  // Invalid/departed targets bypass the scan timer; ordinary scores run at 5 Hz.
  if(old&&legal(old)&&now<r.scanAt&&w.lineVisible(e,old))return old;
  const candidates=[];
  for(const target of [...w.scenePlayers(),...Object.values(w.s.turrets),...(w.director?.s.deployables??[]).filter(d=>d.kind==='decoy')]){
   if(!legal(target)||!w.lineVisible(e,target))continue;
   const range=e.night?(boss?AGGRO_RULES.bossRange:AGGRO_RULES.nightRange):Math.min(this.leash(e),definition.aggro_range+(this.threat(e,target.id)>0?6:0));
   const distanceScore=clamp(1-dist(e,target)/Math.max(.1,range),0,1),damageScore=clamp(this.threat(e,target.id)/AGGRO_RULES.damageScale,0,1);
   candidates.push({target,score:(e.night?.35:.4)*distanceScore+(e.night?.65:.6)*damageScore});
  }
  const closePlayer=candidates.some(c=>c.target.lifeState&&dist(e,c.target)<=3);
  for(const candidate of candidates)if(candidate.target.kind==='decoy')candidate.score=closePlayer?-1:1.1;
  candidates.sort((a,b)=>b.score-a.score||(a.target.id===r.targetId?-1:b.target.id===r.targetId?1:a.target.id.localeCompare(b.target.id)));
  let next=candidates.find(c=>c.score>=0),current=candidates.find(c=>c.target.id===r.targetId&&c.score>=0);
  if(next&&current&&next.target.kind!=='decoy'&&next.target.id!==current.target.id&&(now-r.switchAt<AGGRO_RULES.holdSeconds||next.score<=current.score*AGGRO_RULES.switchRatio||next.score<=current.score+AGGRO_RULES.switchMargin))next=current;
  r.scanAt=now+AGGRO_RULES.scanSeconds;
  if(!next){
   if(e.night){if(r.engagement)this.endEngagement(r);e.alertState='siege';return this.strategic(e);}
   if(now-r.seenAt>AGGRO_RULES.lastSeenSeconds)r.targetId=null;
   return null;
  }
  if(e.night&&!r.engagement)r.engagement={x:e.x,z:e.z,until:now+(boss?AGGRO_RULES.bossSeconds:AGGRO_RULES.nightSeconds)};
  if(r.targetId!==next.target.id){r.switchAt=now;r.targetId=next.target.id;}
  r.seenAt=now;r.seenX=next.target.x;r.seenZ=next.target.z;
  return next.target;
 }
}
