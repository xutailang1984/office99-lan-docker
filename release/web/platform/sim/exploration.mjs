import {EXPLORATION_EVENTS,EXPLORATION_CREATURES} from './exploration-config.mjs';
import {need} from './director.mjs';
import {initializeFishing} from './fishing-experience.mjs';
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z),pos=a=>({x:a.x,y:a.y,z:a.z});
const fishIds=new Set(EXPLORATION_CREATURES.map(x=>x.id));
const seaFishIds=new Set(['silverfish','crab','eel','bubble_puffer','lantern_fish',...fishIds]);
const practiceFishIds=[...seaFishIds];
const practicePond=(w,f)=>w.mode==='mission'&&w.s.mission?.freePlay&&Math.hypot(f.x,f.z-29)<=6.1;
const outside=phase=>['DAY','RETURN','RECOVERY'].includes(phase);

export function attachExploration(w,{saved=false}={}) {
 const x=new Exploration(w,saved);w.exploration=x;x.install();return x;
}
export class Exploration {
 constructor(w,saved) {
  this.w=w;this.c=w.c.exploration;
  w.s.exploration??={version:1,events:[],history:[],catches:0,rareDay:0,generatedDay:0};
  this.s=w.s.exploration;need(this.s.version===1&&Array.isArray(this.s.events)&&this.s.events.length<=3&&Array.isArray(this.s.history),'INVALID_TARGET','探索进度格式无效');
  const ids=new Set(),eventIds=new Set(),validPoint=p=>p&&['x','y','z'].every(k=>Number.isFinite(p[k]));
  need(['catches','rareDay','generatedDay'].every(k=>Number.isSafeInteger(this.s[k])&&this.s[k]>=0)&&this.s.history.length<=18,'INVALID_TARGET');
  for(const e of this.s.events){
   const def=EXPLORATION_EVENTS.find(d=>d.id===e.type);
   need(!eventIds.has(e.id)&&['done','started','rewarded'].every(k=>typeof e[k]==='boolean')&&Number.isSafeInteger(e.revision)&&e.revision>0,'INVALID_TARGET');eventIds.add(e.id);
   need(def&&e.zoneId===def.zone&&typeof e.id==='string'&&Number.isSafeInteger(e.day)&&Number.isSafeInteger(e.stage)&&e.stage>=0&&e.stage<=3&&Number.isSafeInteger(e.answer)&&e.answer>=0&&e.answer<3&&Number.isFinite(e.until)&&Array.isArray(e.parts)&&e.parts.length===def.parts&&(!e.rewarded||e.done)&&(!e.receiver||validPoint(e.receiver)),'INVALID_TARGET','探索进度格式无效');
   for(const p of e.parts){need(typeof p.id==='string'&&!ids.has(p.id)&&validPoint(p)&&Number.isSafeInteger(p.index)&&p.index>=0&&p.index<def.parts&&Number.isSafeInteger(p.revision)&&p.revision>0&&(!p.safePosition||validPoint(p.safePosition)),'INVALID_TARGET');ids.add(p.id);delete p.lockedBy;if(p.carrierId){p.carrierId=null;try{Object.assign(p,this.safeDrop(p));}catch{Object.assign(p,p.safePosition??pos(p));}}}
  }
  for(const p of Object.values(w.s.players)){p.carryingId=null;if(p.pendingSeaCatch)need(seaFishIds.has(p.pendingSeaCatch.creature)&&Number.isSafeInteger(p.pendingSeaCatch.day)&&p.pendingSeaCatch.day>0&&(p.pendingSeaCatch.rare===true)===(p.pendingSeaCatch.creature==='manager_koi'),'INVALID_TARGET','钓获进度格式无效');}
  // Loading a pre-S2 save does not regenerate its current day or rewards.
  this.pendingMigration=saved&&this.s.generatedDay===0;
 }
 target(id){for(const e of this.s.events){const part=e.parts.find(p=>p.id===id);if(part)return{event:e,part};}return null;}
 carry(p){if(!p)return null;const found=this.target(p.carryingId);return found?.part.carrierId===p.id?found:null;}
 active(e){return outside(this.w.s.phase)&&e.day===this.w.s.dayIndex&&!e.done;}
 safeDrop(p){const w=this.w;for(const r of [0,1.4,2.8,4.2])for(let i=0;i<8;i++){const x=p.x+Math.sin(i*Math.PI/4)*r,z=p.z+Math.cos(i*Math.PI/4)*r,y=w.ground(x,z);if(w.s.waterY-y<=.6&&!w.blocked(x,y,z,.7))return{x,y,z};}return w.choosePoint(p,8,[],0,0,'exploration_drop',w.s.waterY);}
 drop(p){if(!p)return;const held=this.carry(p);if(!held){p.carryingId=null;return;}const q=held.part;let point;try{point=this.safeDrop(p);}catch{point=q.safePosition??pos(q);}Object.assign(q,{carrierId:null,...point});p.carryingId=null;q.revision++;this.w.requestSave=true;}
 generate(){
  const w=this.w;for(const p of Object.values(w.s.players))this.drop(p);
  this.s.events=[];this.s.generatedDay=w.s.dayIndex;this.pendingMigration=false;
  const used=[...w.scenePlayers(),...Object.values(w.s.enemies),...Object.values(w.s.destructibles),...Object.values(w.s.nodes)];
  for(const zone of w.dangerZones()){
   const list=EXPLORATION_EVENTS.filter(d=>d.zone===zone.id),last=this.s.history.filter(h=>h.zone===zone.id).at(-1);
   const def=list.find(d=>d.id!==last?.type)??list[0];
   // The first day varies by world seed; subsequent days alternate within each district.
   const chosen=last?def:list[Math.floor(w.rng('exploration')*list.length)];
   const direction={x:-zone.x/(Math.hypot(zone.x,zone.z)||1),z:-zone.z/(Math.hypot(zone.x,zone.z)||1)};
   const center={x:zone.x+direction.x*7,z:zone.z+direction.z*7};
   const e={id:w.id('outing'),type:chosen.id,zoneId:zone.id,day:w.s.dayIndex,stage:0,started:false,done:false,rewarded:false,revision:1,parts:[],answer:Math.floor(w.rng('exploration')*3),until:0};
   for(let i=0;i<chosen.parts;i++){
    const point=w.choosePoint(center,chosen.parts>1?5:3,used,2.8,20,'exploration',w.c.cycle.low_water_y);used.push(point);
    const q={id:w.id('outing-part'),...point,safePosition:{...point},index:i,opened:false,carrierId:null,revision:1};e.parts.push(q);
    if(['supply_seal','parcel_intact','parcel_rush'].includes(e.type)){
     // Replace an existing scenery slot; event boxes do not increase the 36-prop budget.
     const old=Object.values(w.s.destructibles).filter(p=>p.kind==='crate'&&!p.explorationId).sort((a,b)=>dist(a,point)-dist(b,point))[0];
     if(old)delete w.s.destructibles[old.id];
     const hp=e.type==='parcel_intact'?180:45;
     w.s.destructibles[q.id]={id:q.id,...point,kind:'crate',yaw:0,hp,maxHp:hp,size:{x:1.2,y:1.2,z:1.2},radius:.85,revision:1,broken:false,seed:Math.floor(w.rng('exploration')*2147483647),explorationId:e.id};
    }
   }
   if(e.type==='supply_carry'){
    const first=e.parts[0],center2={x:first.x+direction.x*14,z:first.z+direction.z*14};
    e.receiver=w.choosePoint(center2,2,used,2,16,'exploration',w.c.cycle.low_water_y);used.push(e.receiver);
   }
   this.s.events.push(e);this.s.history.push({zone:zone.id,type:e.type,day:e.day});
  }
  this.s.history=this.s.history.slice(-18);w.requestSave=true;
 }
 reward(e,items,at=e.parts[0]){
  if(e.rewarded)return null;
  const w=this.w;e.rewarded=true;e.done=true;e.revision++;
  const box=w.createContainer('loot',Math.max(4,items.length),{...pos(at),source:'exploration',eventId:e.id,createdDay:w.s.dayIndex,expiresAfterDay:w.s.dayIndex+w.c.recovery.bag_retention_days});
  for(const [id,n]of items)if(n>0)w.addItems(box,id,n);
  w.containerContent(box);e.lootContainerId=box.id;w.requestSave=true;
  for(const q of e.parts){if(q.lockedBy&&w.s.players[q.lockedBy])w.cancelWork(w.s.players[q.lockedBy]);delete q.lockedBy;const p=w.s.destructibles[q.id];if(p&&!p.broken){p.broken=true;p.hp=0;p.revision++;w.event('Destroyed',{targetId:p.id,kind:p.kind,position:pos(p),seed:p.seed,reason:'unpacked'},p.id);}q.opened=true;if(q.carrierId)this.drop(w.s.players[q.carrierId]);q.carrierId=null;}
  if(w.navGeometry)w.navGeometry.tick=-1;
  w.event('ExplorationCompleted',{eventId:e.id,lootContainerId:box.id,position:pos(at)},e.id);return box;
 }
 alarm(p,e){this.w.alertNoise(p,'shot');e.noisy=true;}
 start(p,message){
  const w=this.w,held=this.carry(p);
  if(held){const e=held.event;if(e.receiver&&dist(p,e.receiver)<=2.8)this.reward(e,[['sealed_cell',1],['spring_parts',5],['coffee_coupon',1]],e.receiver);else this.drop(p);return;}
  const found=this.target(message.targetId);need(found&&this.active(found.event),'NOT_FOUND','这件事已结束');
  const {event:e,part:q}=found;need(!q.opened&&!q.carrierId,'BUSY');need(dist(p,q)<=w.c.player.interact_distance&&Math.abs(p.y-q.y)<1.4&&w.lineVisible(p,q),'OUT_OF_RANGE');
  need(w.s.waterY-q.y<=.6,'INVALID_TARGET','涨潮了，先回办公室');
  need(!p.work&&!p.fishing&&!p.reload,'BUSY');w.checkTargetRevision(q,message.expectedRevision);
  const alt=message.payload?.alternate===true;
  if(e.type==='supply_carry'){need(!q.lockedBy,'BUSY');p.carryingId=q.id;q.carrierId=p.id;q.revision++;p.meleePending=null;p.jumpQueued=false;w.setAction(p,'carry',.5);return;}
  if(e.type==='parcel_rush'){
   if(!e.started){e.started=true;e.until=w.s.time+this.c.rushSeconds;e.revision++;this.alarm(p,e);w.event('Notice',{actorId:p.id,message:'快拆！25秒内打碎三件快递'});}
   return;
  }
  if(e.type==='parcel_intact'&&alt){need(e.stage>0,'BUSY','先装好一段');this.reward(e,[['spring_parts',2+e.stage],['coffee_coupon',1]],q);return;}
  let action='open',duration=4;
  if(e.type==='desk_alarm'){
   if(alt&&e.stage===0){need(!q.lockedBy,'BUSY');e.stage=2;e.revision++;q.revision++;this.alarm(p,e);return;}
   action=e.stage===0?'disarm':'open';duration=e.noisy?2:4;
  }
  if(e.type==='desk_sort'){action='sort';duration=1.3;}
  if(e.type==='supply_seal'){action='unseal';duration=3;}
  if(e.type==='parcel_intact'){
   action='pack';duration=4;
   if(!e.started){e.started=true;for(const guard of Object.values(w.s.enemies).filter(g=>g.source==='wild'&&g.zoneId===e.zoneId&&w.aggro.inside(g,q)).sort((a,b)=>dist(a,q)-dist(b,q)).slice(0,2))guard.explorationTarget=q.id;}
  }
  w.beginWork(p,{kind:'Explore',targetId:q.id,duration,explorationAction:action});
 }
 work(p,dt){
  const w=this.w,task=p.work,found=this.target(task.targetId),q=found?.part,e=found?.event;
  const held=p.input.interact===true&&w.s.time-p.inputAt<=.5;
  if(!q||!this.active(e)||q.opened||q.lockedBy!==p.id||!w.inScene(p)||p.lifeState!=='ALIVE'||p.swimming||dist(p,q)>w.c.player.interact_distance+.1||dist(p,{x:task.startX,z:task.startZ})>.25||p.damageAt!==task.startDamageAt||(!held&&w.s.time-task.startedAt>.3)||w.s.waterY-q.y>.6){w.cancelWork(p);return;}
  task.progress+=dt;if(task.progress+1e-8<task.duration)return;
  w.cancelWork(p);q.revision++;e.revision++;const action=task.explorationAction;
  if(e.type==='desk_alarm'){
   if(action==='disarm'){e.stage=1;return;}
   if(action==='loud')this.alarm(p,e);
   this.reward(e,[['spring_parts',4],['coffee_coupon',e.noisy?2:1]],q);
  }else if(e.type==='desk_sort'){
   q.opened=true;if(q.index===e.answer)this.reward(e,[['sealed_cell',1],['coffee_coupon',1]],q);else this.alarm(p,e);
  }else if(e.type==='supply_seal'){
   e.stage++;if(e.stage>=3)this.reward(e,[['sealed_cell',2],['coffee_coupon',1]],q);
  }else if(e.type==='parcel_intact'){
   e.stage++;if(e.stage>=3){const hp=w.s.destructibles[q.id]?.hp??0;this.reward(e,hp>=90?[['team_medal',1],['spring_parts',3]]:[['spring_parts',5],['coffee_coupon',1]],q);}
  }
 }
 propBroken(prop,hit){
  const found=this.target(prop.id);if(!found||prop.broken)return;
  const {event:e,part:q}=found,w=this.w;prop.broken=true;prop.hp=0;prop.revision++;q.opened=true;q.revision++;if(q.lockedBy&&w.s.players[q.lockedBy])w.cancelWork(w.s.players[q.lockedBy]);delete q.lockedBy;if(w.navGeometry)w.navGeometry.tick=-1;
  w.event('Destroyed',{targetId:prop.id,kind:prop.kind,position:pos(prop),seed:prop.seed,actorId:hit.actorId,weaponId:hit.weaponId??null},prop.id);
  if(e.done)return;
  if(e.type==='parcel_rush'){
   if(e.started&&w.s.time<=e.until){e.stage++;const box=w.createContainer('loot',1,{...pos(q),source:'exploration',createdDay:w.s.dayIndex,expiresAfterDay:w.s.dayIndex+w.c.recovery.bag_retention_days});w.addItems(box,'spring_parts',2);w.containerContent(box);}
   if(e.parts.every(p=>p.opened)){if(e.stage===3)this.reward(e,[['sealed_cell',1],['coffee_coupon',1]],q);else{e.done=true;e.revision++;}}
  }else this.reward(e,[['scrap',e.type==='supply_seal'?3:1]],q);
  w.requestSave=true;
 }
 tick(){
  const w=this.w;
  for(const p of Object.values(w.s.players)){
   const held=this.carry(p);if(!held)continue;
   if(!w.inScene(p)||!p.connected||p.lifeState!=='ALIVE'||p.swimming||!this.active(held.event)){this.drop(p);continue;}
   Object.assign(held.part,pos(p));if(!w.blocked(p.x,w.ground(p.x,p.z),p.z,.7)&&w.s.waterY-w.ground(p.x,p.z)<=.6)held.part.safePosition={x:p.x,y:w.ground(p.x,p.z),z:p.z};
  }
  for(const e of this.s.events){
   for(const q of e.parts){if(q.carrierId&&w.s.players[q.carrierId]?.carryingId!==q.id){let point;try{point=this.safeDrop(q);}catch{point=q.safePosition??pos(q);}Object.assign(q,{...point,carrierId:null});q.revision++;}if(q.lockedBy&&!w.s.players[q.lockedBy])delete q.lockedBy;}
   if(e.done)continue;if(!outside(w.s.phase)||e.day!==w.s.dayIndex||(e.type==='parcel_rush'&&e.started&&w.s.time>e.until)){e.done=true;e.revision++;for(const q of e.parts){if(q.lockedBy&&w.s.players[q.lockedBy])w.cancelWork(w.s.players[q.lockedBy]);delete q.lockedBy;}}
  }
 }
 prepareCast(p){
  const w=this.w,f=p.fishing;if(!f||f.catch_kind==='salvage')return;
  if(practicePond(w,f)){
   const creature=practiceFishIds[(p.practiceFishIndex??0)%practiceFishIds.length];
   p.pendingSeaCatch={creature,rare:creature==='manager_koi',day:w.s.dayIndex};
   f.creature=creature;f.special=creature==='manager_koi';f.catch_resistance=w.defs.creatures[creature].resistance;
   initializeFishing(f,p,w.defs.rods[w.s.items[f.rodId].definitionId]);return;
  }
  let pending=p.pendingSeaCatch;
  if(!pending||pending.day!==w.s.dayIndex||!seaFishIds.has(pending.creature)){
   const roll=w.rng('exploration_fish');let creature=roll<.16?'spring_shrimp':roll<.32?'ink_cuttle':f.creature;
   const rare=outside(w.s.phase)&&this.s.catches>=this.c.rareAfterCatches&&roll>.84&&this.s.rareDay!==w.s.dayIndex&&!Object.values(w.s.enemies).some(e=>e.source==='rare_catch');
   if(rare){creature='manager_koi';this.s.rareDay=w.s.dayIndex;}
   pending={creature,rare,day:w.s.dayIndex};p.pendingSeaCatch=pending;
  }
  f.creature=pending.creature;f.special=pending.rare===true;f.catch_resistance=w.defs.creatures[f.creature].resistance;initializeFishing(f,p,w.defs.rods[w.s.items[f.rodId].definitionId]);
 }
 landed(enemy,p,f){
  this.s.catches++;p.pendingSeaCatch=null;
  if(practicePond(this.w,f))p.practiceFishIndex=(p.practiceFishIndex??0)+1;
  if(f.special){enemy.source='rare_catch';enemy.hp=enemy.maxHp=Math.round(220*(1+.3*(Math.min(4,Math.max(1,this.w.scenePlayers().length))-1)));enemy.radius=.9;enemy.rareLastActive=this.w.s.time;enemy.lockedPlayerCount=Math.min(4,this.w.scenePlayers().length);}
  this.w.requestSave=true;
 }
 fishUpdate(e,dt){
  const w=this.w,rare=e.source==='rare_catch',def=w.defs.creatures[e.definitionId],home={x:e.homeX,z:e.homeZ},leash=rare?this.c.rareLeash:6;
  if(rare&&(!outside(w.s.phase)||w.s.time-(e.rareLastActive??w.s.time)>this.c.rareIdleSeconds)){delete w.s.enemies[e.id];w.aggro.forget(e.id);w.event('Removed',{kind:'enemy',reason:'left'},e.id);return;}
  if(w.updateHitReaction(e,dt))return;
  if(w.aggro.returnGate(e)){e.state='CHASE';e.attackZone=null;e.attackKind=null;w.navigateEnemy(e,home,def.speed,dt);return;}
  const target=w.selectEnemyTarget(e);
  if(target&&rare)e.rareLastActive=w.s.time;
  e.phaseRemaining=Math.max(0,(e.phaseRemaining??0)-dt);
  if(['STUNNED','RECOVER'].includes(e.state)){e.attackZone=null;if(e.phaseRemaining<=0)e.state='CHASE';return;}
  if(e.state==='CHARGE'){
   const dest={x:e.lockX,z:e.lockZ},length=dist(e,dest),travel=Math.min(length,(rare?5:4)*dt),next={x:e.x+(dest.x-e.x)/Math.max(.001,length)*travel,z:e.z+(dest.z-e.z)/Math.max(.001,length)*travel};if(w.aggro.inside(e,next)){w.move(e,(next.x-e.x)/dt,(next.z-e.z)/dt,dt,e.radius);e.y=w.ground(e.x,e.z);}
   for(const p of w.scenePlayers().filter(p=>p.lifeState==='ALIVE'&&dist(p,home)<=leash&&Math.abs(p.y-e.y)<1.5&&dist(p,e)<=e.radius+.65&&!(e.chargeHits??[]).includes(p.id)))if(w.lineVisible(e,p)){w.damageQueue.push({target:p.id,damage:def.damage,actorId:e.id});(e.chargeHits??=[]).push(p.id);}
   if(e.phaseRemaining<=0||dist(e,dest)<.15){e.state='RECOVER';e.phaseRemaining=def.attack_cooldown;e.attackZone=null;}return;
  }
  if(w.routeAttack(e,null,def))return;
  if(e.state==='WINDUP'){
   if(e.phaseRemaining>0)return;
   if(e.definitionId==='spring_shrimp'||rare){e.state='CHARGE';e.phaseRemaining=.45;e.chargeHits=[];w.event('EnemyAttackResolved',{enemyId:e.id,position:pos(e),zone:e.attackZone},e.id);return;}
   const reach=def.attack_range;
   for(const p of w.scenePlayers().filter(p=>p.lifeState==='ALIVE'&&dist(p,home)<=leash&&dist(p,e)<=reach+.3)){
    const forward={x:-Math.sin(e.yaw),z:-Math.cos(e.yaw)};
    if(((p.x-e.x)*forward.x+(p.z-e.z)*forward.z)/Math.max(.01,dist(p,e))>=Math.cos(1.15)&&Math.abs(p.y-e.y)<1.5&&w.lineVisible(e,p))w.damageQueue.push({target:p.id,damage:def.damage,actorId:e.id});
   }
   w.event('EnemyAttackResolved',{enemyId:e.id,definitionId:e.definitionId,position:pos(e),zone:e.attackZone},e.id);e.state='RECOVER';e.phaseRemaining=def.attack_cooldown;e.attackZone=null;return;
  }
  if(!target){e.targetId=null;e.attackZone=null;if(dist(e,home)>.4)w.navigateEnemy(e,home,def.speed*.7,dt);return;}
  e.targetId=target.id;e.yaw=Math.atan2(-(target.x-e.x),-(target.z-e.z));
  const obstacle=w.enemyRouteTarget(e,target);
  if(w.s.destructibles[obstacle?.id]&&w.routeAttack(e,obstacle,def))return;
  if(dist(e,target)<=def.attack_range&&w.lineVisible(e,target)){e.state='WINDUP';e.attackKind='fish';e.lockX=e.x-Math.sin(e.yaw)*2;e.lockZ=e.z-Math.cos(e.yaw)*2;e.phaseRemaining=def.attack_windup;e.attackZone={shape:'cone',...pos(e),yaw:e.yaw,radius:e.definitionId==='ink_cuttle'?def.attack_range:3.6,halfAngle:1.15,endsAt:w.s.time+def.attack_windup};return;}
  w.navigateEnemy(e,target,def.speed,dt);
 }
 guardUpdate(e,dt){
  const w=this.w,found=this.target(e.explorationTarget);if(!found||!this.active(found.event)||!found.event.started)return false;
  const parcel=w.s.destructibles[e.explorationTarget];if(!parcel||parcel.broken)return false;
  const memory=w.s.enemyAggro[e.id]?.damage??{};if(Object.values(memory).some(d=>w.s.time-d.at<6))return false;
  if(w.updateHitReaction(e,dt))return true;
  if(['STUNNED','RECOVER'].includes(e.state)){e.phaseRemaining=Math.max(0,(e.phaseRemaining??0)-dt);e.attackZone=null;if(e.phaseRemaining<=0)e.state='CHASE';return true;}
  if(['WINDUP','CHARGE'].includes(e.state)&&!['clear_route','parcel'].includes(e.attackKind)){e.state='RECOVER';e.phaseRemaining=.4;e.attackZone=null;return true;}
  if(!w.aggro.inside(e,parcel)||w.aggro.returnGate(e))return false;
  if(e.attackKind==='clear_route'){e.phaseRemaining=Math.max(0,e.phaseRemaining-dt);if(w.routeAttack(e,null,w.enemyDefinition(e)))return true;e.attackKind=null;}
  e.targetId=parcel.id;e.yaw=Math.atan2(-(parcel.x-e.x),-(parcel.z-e.z));
  if(dist(e,parcel)>1.8||!w.lineVisible(e,parcel)){const block=w.enemyRouteTarget(e,parcel);if(block!==parcel&&w.s.destructibles[block?.id]&&w.routeAttack(e,block,w.enemyDefinition(e)))return true;e.state='CHASE';w.navigateEnemy(e,parcel,w.enemyDefinition(e).speed,dt);return true;}
  if(e.state!=='WINDUP'){if((e.explorationAttackAt??0)>w.s.time)return true;e.state='WINDUP';e.attackKind='parcel';e.phaseRemaining=.9;e.attackZone={shape:'circle',...pos(e),radius:1.7,endsAt:w.s.time+.9};return true;}
  e.phaseRemaining-=dt;if(e.phaseRemaining<=0){w.damageQueue.push({target:parcel.id,damage:9,actorId:e.id});e.state='RECOVER';e.phaseRemaining=1.6;e.attackZone=null;e.explorationAttackAt=w.s.time+1.6;}return true;
 }
 redeem(p,message){
  const w=this.w,id=message.payload?.definitionId;
  need(!p.work&&!p.reload&&!p.fishing&&!this.carry(p),'BUSY');
  if(id==='coffee_coupon'){
   need(w.terminal(p,'shop',message.payload?.stationId),'OUT_OF_RANGE');need(w.count(p,id)>0,'NO_AMMO');const bag=w.bag(p),coupons=bag.itemIds.map(key=>w.s.items[key]).filter(item=>item.definitionId===id&&!item.lockedBy).sort((a,b)=>a.quantity-b.quantity),coupon=coupons[0];need(coupon&&(w.canFit(bag,'coffee_flask',1)||coupon.quantity===1),'NO_CAPACITY');
   if(coupon.quantity===1)w.removeItem(coupon);else{coupon.quantity--;coupon.revision++;bag.revision++;}w.addItems(bag,'coffee_flask',1);
  }else if(id==='sealed_cell'){
   const t=w.s.turrets[message.targetId];need(t&&t.hp>0&&t.level>0&&dist(p,t)<=w.c.player.interact_distance&&Math.abs(p.y-t.y)<1.4&&w.lineVisible(p,t),'OUT_OF_RANGE');need(w.s.buildings.core.hp>0&&!t.lockedBy&&t.ammo<t.capacity,'BUSY','炮台暂不能补充');need(w.count(p,id)>0,'NO_AMMO');w.consume(p,id,1);t.ammo=Math.min(t.capacity,t.ammo+20);t.revision++;
  }else need(false,'INVALID_TARGET');
  w.event('TransactionResult',{kind:'Redeem',definitionId:id,actorId:p.id});
 }
 public(){
  const w=this.w;return {version:1,events:this.s.events.map(e=>{
   const def=EXPLORATION_EVENTS.find(d=>d.id===e.type);
   return {id:e.id,type:e.type,name:def.name,icon:def.icon,goal:def.goal,zoneId:e.zoneId,stage:e.stage,started:e.started,done:e.done,remaining:e.until?Math.max(0,e.until-w.s.time):0,revision:e.revision,receiver:e.receiver??null,clue:e.type==='desk_sort'?e.answer:null,parts:e.parts.map(q=>({...pos(q),id:q.id,index:q.index,opened:q.opened,carrierId:q.carrierId,revision:q.revision,hp:w.s.destructibles[q.id]?.hp??null,maxHp:w.s.destructibles[q.id]?.maxHp??null}))};})};
 }
 install(){
  const w=this.w,x=this,wrap=(name,fn)=>{const original=w[name].bind(w);w[name]=(...args)=>fn(original,...args);};
  wrap('generateDay',original=>{const r=original();x.generate();return r;});
  wrap('boxes',(original,...args)=>{const boxes=original(...args);for(const e of x.s.events)if(x.active(e)&&['desk_alarm','desk_sort'].includes(e.type))for(const q of e.parts)if(!q.opened)boxes.push({id:q.id,x0:q.x-.51,x1:q.x+.51,y0:q.y,y1:q.y+1.06,z0:q.z-.39,z1:q.z+.39});return boxes;});
  wrap('publicState',(original,...args)=>{const r=original(...args);r.exploration=x.public();for(const p of r.players){p.carryingId=w.s.players[p.id].carryingId??null;if(p.fishing)p.fishing.special=w.s.players[p.id].fishing?.special===true;}return r;});
  wrap('catalog',original=>({...original(),exploration:{events:EXPLORATION_EVENTS,items:['spring_parts','sealed_cell','coffee_coupon','team_medal']}}));
  wrap('workTarget',(original,work)=>work.kind==='Explore'?x.target(work.targetId)?.part:original(work));
  wrap('updateWork',(original,p,dt)=>p.work?.kind==='Explore'?x.work(p,dt):original(p,dt));
  wrap('dispatch',(original,p,message)=>{
   if(x.carry(p)&&['Fire','Melee','Cast','UseQuick','UseTool','Reload'].includes(message.command))need(false,'BUSY','先按 E 放下箱子');
   if(!['Explore','Redeem'].includes(message.command))return original(p,message);
   w.requireAction(p);return message.command==='Explore'?x.start(p,message):x.redeem(p,message);
  });
  for(const method of ['disconnect','die','enterDowned'])wrap(method,(original,p,...args)=>{x.drop(p);return original(p,...args);});
  wrap('step',(original,dt)=>{const before=w.s.tick;const r=original(dt);if(w.s.tick!==before)x.tick();return r;});
  wrap('cast',(original,p,...args)=>{const r=original(p,...args);x.prepareCast(p);return r;});
  wrap('cancelFishing',(original,p,...args)=>{if(p.fishing?.special)p.pendingSeaCatch=null;return original(p,...args);});
  wrap('activeFishingCount',(original,p)=>original(p)+Object.values(w.s.enemies).filter(e=>e.source==='rare_catch'&&e.ownerId===p.id&&e.hp>0).length);
  wrap('updateEnemy',(original,e,dt)=>fishIds.has(e.definitionId)?x.fishUpdate(e,dt):e.explorationTarget&&x.guardUpdate(e,dt)?undefined:original(e,dt));
  wrap('breakProp',(original,p,hit)=>p.explorationId?x.propBroken(p,hit):original(p,hit));
  wrap('killEnemy',(original,e,...args)=>{
   const existed=!!w.s.enemies[e.id],source=e.source;
   // The normal low-risk fish override uses one shared loot. These two kinds
   // deliberately carry their own reward without changing combat difficulty.
   if(existed&&e.definitionId==='spring_shrimp')e.source='exploration_fish';
   const r=original(e,...args);e.source=source;
   if(existed&&!w.s.enemies[e.id]&&e.definitionId==='ink_cuttle'&&w.rng('exploration_loot')<.25){const b=w.createContainer('loot',1,{...pos(e),source:'exploration_fish',createdDay:w.s.dayIndex,expiresAfterDay:w.s.dayIndex+w.c.recovery.bag_retention_days});w.addItems(b,'coffee_coupon',1);w.containerContent(b);}return r;
  });
 }
}
