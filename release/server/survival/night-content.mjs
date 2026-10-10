import {isBoss} from './night-content-config.mjs';
import {updateTacticalEnemy} from './tactical-content.mjs';
export {isBoss} from './night-content-config.mjs';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const forward=yaw=>({x:-Math.sin(yaw),z:-Math.cos(yaw)});
const position=e=>({x:e.x,y:e.y,z:e.z});
const newBoss=e=>['boss_shredder','boss_printer'].includes(e.definitionId);
const vulnerable=p=>p.lifeState!=='DEAD_WAIT';
const targets=(w,e)=>[...w.scenePlayers().filter(p=>vulnerable(p)&&(e.source!=='practice'||w.aggro.inside(e,p))),...w.bossAttackObjects(e).filter(b=>b.hp>0)];
function hit(w,e,target,damage){if(target.kind==='decoy')return;w.damageQueue.push({target:target.id,damage:Math.max(1,Math.ceil(damage*(e.damageMultiplier??1))),actorId:e.id});}
function warning(w,e,kind,seconds,shape,fields){
 e.attackKind=kind;e.state='WINDUP';e.phaseRemaining=seconds;e.attackZone={shape,...position(e),y:w.ground(e.x,e.z),yaw:e.yaw,...fields,endsAt:w.s.time+seconds};
 w.event('EnemyAttackWarning',{enemyId:e.id,definitionId:e.definitionId,attackKind:kind,position:position(e),zone:structuredClone(e.attackZone)},e.id);
}
function weak(w,e,seconds){e.state='WEAK';e.weak=true;e.phaseRemaining=seconds;e.attackZone=null;e.chargeRemaining=0;e.motorDamage=0;w.event('EnemyWeakPoint',{enemyId:e.id,definitionId:e.definitionId,weakPart:e.definitionId==='boss_shredder'?'motor':'paper_jam',duration:seconds,position:position(e)},e.id);}
function attackAction(w,e){e.attackActionSeq=(e.attackActionSeq??0)+1;e.attackActionAt=w.s.time;}
function resolved(w,e,zone,animate=true){if(animate)attackAction(w,e);w.event('EnemyAttackResolved',{enemyId:e.id,definitionId:e.definitionId,attackKind:e.attackKind,attackActionSeq:e.attackActionSeq,zone,position:position(e)},e.id);}
export function bossHitProfile(w,e,attacker){
 if(!isBoss(e))return {weak:false,multiplier:1};
 const def=w.defs.creatures[e.definitionId],v=forward(e.yaw),length=distance(e,attacker)||1,dot=((attacker.x-e.x)*v.x+(attacker.z-e.z)*v.z)/length;
 const exposed=e.weak===true&&(def.weak_side==='side'?Math.abs(dot)<.55:def.weak_side==='front'?dot>0:dot<0);
 return {weak:exposed,multiplier:exposed?def.weak_multiplier:def.armor_multiplier};
}
export function bossAttackRange(w,e,target){
 if(e.definitionId==='boss_shredder')return w.c.director.nightContent.shredder.fanRadius+(target?.lifeState?0:1.5);
 if(e.definitionId==='boss_printer')return w.c.director.nightContent.printer.waveLength+(target?.lifeState?0:1);
 if(e.definitionId==='boss_stamp_press')return w.c.director.nightContent.stamp.range;
 if(e.definitionId==='boss_coffee_boiler')return w.c.director.nightContent.coffee.length;
 const def=w.defs.creatures[e.definitionId];if(e.variantId&&e.variantId!=='base')return 9;
 const slam=e.hp<=e.maxHp*.5?e.attackIndex%3===0:e.attackIndex%2===0;return slam?def.slam_radius+(target?.lifeState?0:1.5):8;
}
export function recordNightContentHit(w,e,hitData){
 if(e.definitionId==='boss_coffee_boiler'&&e.state==='WEAK'&&hitData.weak===true){
  e.valveDamage=(e.valveDamage??0)+Math.max(0,hitData.actualDamage??hitData.damage??0);
  if(!e.valveCleared&&e.valveDamage>=45){e.valveCleared=true;for(const q of w.s.director.deployables)if(q.ownerId===e.id&&q.definitionId==='coffee_spill')q.expiresAt=w.s.time;w.event('EnemyInterrupted',{enemyId:e.id,definitionId:e.definitionId,role:'boss',duration:.6,position:position(e)},e.id);}return;
 }
 if(e.definitionId!=='boss_shredder'||e.state!=='WEAK'||hitData.weak!==true)return;
 e.motorDamage=(e.motorDamage??0)+Math.max(0,hitData.actualDamage??hitData.damage??0);
 if(!e.cancelNextAdvance&&e.motorDamage>=w.c.director.nightContent.shredder.motorThreshold){e.cancelNextAdvance=true;w.event('EnemyInterrupted',{enemyId:e.id,definitionId:e.definitionId,role:'boss',hitSeq:e.hitSeq,duration:.6,position:position(e)},e.id);}
}
function moveCommitted(w,e,dt,def,shift){
 const v=forward(e.yaw),step=Math.min((shift?def.shiftSpeed:def.advanceSpeed)*dt,e.chargeRemaining??0),next={x:e.x+v.x*step,z:e.z+v.z*step};
 if(e.source==='practice'&&!w.aggro.inside(e,next)){e.comboNext=null;weak(w,e,def.weakSeconds);return;}
 const block=w.enemyRouteBlock(e,next,step),travel=block?Math.max(0,block.distance-.01):step,before=position(e);
 if(travel>0){w.move(e,v.x*travel/dt,v.z*travel/dt,dt,e.radius);e.y=w.enemyGroundHeight(e);}e.chargeRemaining=Math.max(0,(e.chargeRemaining??0)-travel);
 if(!shift){
  for(const target of targets(w,e))if(!e.chargeHit.includes(target.id)&&distance(e,target)<(target.lifeState?e.radius+.65:2)&&w.lineVisible(e,target)){e.chargeHit.push(target.id);hit(w,e,target,target.lifeState?def.advanceDamage:def.advanceBuildingDamage);}
  const obstacle=w.attackObject(block?.id);if(obstacle?.hp>0&&!e.chargeHit.includes(obstacle.id)){e.chargeHit.push(obstacle.id);hit(w,e,obstacle,def.advanceBuildingDamage);}
 }
 if(block||e.chargeRemaining<=0||distance(before,e)<.0001){
  resolved(w,e,e.committedZone,false);delete e.committedZone;
  const combo=e.comboNext;e.comboNext=null;
  if(combo==='shredder_fan'){warning(w,e,'shredder_fan',def.fanWindup,'cone',{radius:def.fanRadius,halfAngle:def.fanHalfAngle});return;}
  if(combo==='printer_wave'){const target=w.bossRouteTarget(e,w.selectEnemyTarget(e)??(e.source!=='practice'?w.s.buildings.core:null));if(target&&w.lineVisible(e,target)){e.yaw=Math.atan2(-(target.x-e.x),-(target.z-e.z));warning(w,e,'printer_wave',def.waveWindup,'line',{length:def.waveLength,width:def.waveWidth});return;}}
  weak(w,e,def.weakSeconds);
 }
}
function updateBoss(d,e,dt){
 const w=d.w,shredder=e.definitionId==='boss_shredder',def=d.c.nightContent[shredder?'shredder':'printer'],practice=e.source==='practice';
 if(practice&&['CHASE','RECOVER'].includes(e.state)&&!w.selectEnemyTarget(e)){e.comboNext=null;e.state='CHASE';e.phaseRemaining=0;e.attackZone=null;w.patrolEnemy(e,w.defs.creatures[e.definitionId],dt);return;}
 if(e.state==='CHASE'||e.state==='RECOVER')e.combatPhase=e.hp<=e.maxHp*.5?2:1;
 if(!practice&&e.hp<=e.maxHp*.5&&!w.s.night.addsSpawned)e.addsPending=true;
 e.phaseRemaining=Math.max(0,e.phaseRemaining-dt);
 if(e.state==='WEAK'){e.weak=true;if(e.phaseRemaining<=0){e.weak=false;e.state='RECOVER';e.phaseRemaining=def.recoverSeconds;}return;}
 if(e.state==='RECOVER'){
  if(e.phaseRemaining<=0){
   if(!practice&&e.addsPending&&!w.s.night.addsSpawned){w.s.night.addsSpawned=true;const count=(w.c.waves[3].adds_crab_per_player??0)*w.s.night.playerCount;for(let i=0;i<count;i++)w.s.night.pending.push({definitionId:'crab',at:w.s.phaseElapsed+i*w.s.night.spawnInterval,entry:i%3});}
   e.state='CHASE';
  }return;
 }
 if(e.state==='CHARGE'){moveCommitted(w,e,dt,def,!shredder);return;}
 if(e.state==='WINDUP'){
  if(e.phaseRemaining>0)return;
  const zone=e.attackZone,v=forward(zone?.yaw??e.yaw);
  if(['shredder_advance','printer_shift'].includes(e.attackKind)){attackAction(w,e);e.state='CHARGE';e.chargeRemaining=shredder?def.advanceRange:def.shiftRange;e.chargeHit=[];e.committedZone=structuredClone(zone);e.attackZone=null;return;}
  for(const target of targets(w,e)){
   const dx=target.x-e.x,dz=target.z-e.z,range=Math.hypot(dx,dz)||1,along=dx*v.x+dz*v.z,side=Math.abs(dx*v.z-dz*v.x),margin=target.lifeState?0:(shredder?1.5:1);
   const inside=shredder?range<=def.fanRadius+margin&&along/range>=Math.cos(def.fanHalfAngle):along>=-margin&&along<=def.waveLength+margin&&side<=def.waveWidth/2+margin;
   if(inside&&w.lineVisible(e,target))hit(w,e,target,shredder?(target.lifeState?def.fanDamage:def.fanBuildingDamage):(target.lifeState?def.waveDamage:def.waveBuildingDamage));
  }resolved(w,e,zone);
  if(!shredder&&e.comboNext==='printer_shift'){e.comboNext='printer_wave';e.yaw+=Math.PI/2;warning(w,e,'printer_shift',def.shiftWindup,'line',{length:def.shiftRange,width:e.radius*2});return;}
  weak(w,e,def.weakSeconds);return;
 }
 const target=w.bossRouteTarget(e,w.selectEnemyTarget(e)??(!practice?w.s.buildings.core:null));if(!target)return;
 e.targetId=target.id;e.yaw=Math.atan2(-(target.x-e.x),-(target.z-e.z));
 if(distance(e,target)<=bossAttackRange(w,e,target)&&w.lineVisible(e,target)){
  const index=e.attackIndex++;
  if(shredder){
   const advance=index%2===0&&!e.cancelNextAdvance;if(index%2===0&&e.cancelNextAdvance)e.cancelNextAdvance=false;
   if(advance){e.comboNext=e.combatPhase===2?'shredder_fan':null;e.attackRadius=def.advanceRange;warning(w,e,'shredder_advance',def.advanceWindup,'line',{length:def.advanceRange,width:e.radius*2+1.3});}
   else {e.attackRadius=def.fanRadius;warning(w,e,'shredder_fan',def.fanWindup,'cone',{radius:def.fanRadius,halfAngle:def.fanHalfAngle});}
  }else if(index%2===0){e.comboNext=e.combatPhase===2?'printer_shift':null;e.attackRadius=def.waveLength;warning(w,e,'printer_wave',def.waveWindup,'line',{length:def.waveLength,width:def.waveWidth});}
  else {e.yaw+=(index%4===1?1:-1)*Math.PI/2;e.attackRadius=def.shiftRange;warning(w,e,'printer_shift',def.shiftWindup,'line',{length:def.shiftRange,width:e.radius*2});}
 }else w.navigateEnemy(e,target,w.defs.creatures[e.definitionId].speed,dt);
}
function eligibleAllies(w,e,def){return Object.values(w.s.enemies).filter(other=>other.id!==e.id&&!isBoss(other)&&other.role!=='rally'&&other.source===e.source&&other.hp>0&&distance(e,other)<=def.radius&&w.lineVisible(e,other)).sort((a,b)=>distance(e,a)-distance(e,b)||a.id.localeCompare(b.id)).slice(0,def.maxAllies);}
function updateRole(d,e,dt){
 const w=d.w,def=w.enemyDefinition(e),rally=e.definitionId==='broadcast_cart',special=d.c.nightContent[rally?'rally':'lobber'];
 if(w.updateHitReaction(e,dt))return;
 e.phaseRemaining=Math.max(0,e.phaseRemaining-dt);
 if(['STUNNED','RECOVER'].includes(e.state)){if(e.phaseRemaining<=0)e.state='CHASE';return;}
 if(w.aggro.returnGate(e)){e.state='CHASE';e.attackZone=null;w.patrolEnemy(e,def,dt);return;}
 if(e.state==='WINDUP'){
  if(w.routeAttack(e,null,def))return;
  if(e.phaseRemaining>0)return;
  if(e.attackKind==='rally'){
   const allies=eligibleAllies(w,e,special);for(const ally of allies){ally.rallyUntil=w.s.time+special.duration;ally.rallySpeed=special.speedMultiplier;ally.revision++;}
   w.event('EnemyRally',{enemyId:e.id,definitionId:e.definitionId,allyIds:allies.map(a=>a.id),duration:special.duration,position:position(e)},e.id);e.rallyAt=w.s.time+special.cooldown;
  }else if(e.attackKind==='paper_lob'){
   const point={x:e.lockX,y:w.ground(e.lockX,e.lockZ),z:e.lockZ};
   for(const target of targets(w,e))if(distance(point,target)<=special.radius+(target.lifeState?0:.8)&&(!target.lifeState||target.y<=point.y+.6)&&w.lineVisible(e,target))hit(w,e,target,target.lifeState?def.damage:special.buildingDamage);
   resolved(w,e,e.attackZone);
  }else {const target=d.target(e);if(target?.hp>0&&distance(e,target)<=def.attack_range+(target.lifeState?.6:1.5)&&w.lineVisible(e,target))hit(w,e,target,def.damage);}
  e.state='RECOVER';e.phaseRemaining=def.attack_cooldown;e.attackZone=null;return;
 }
 if(rally&&w.s.time>=(e.rallyAt??0)&&eligibleAllies(w,e,special).length){warning(w,e,'rally',special.windup,'circle',{radius:special.radius});return;}
 const target=w.enemyRouteTarget(e,w.selectEnemyTarget(e));if(!target){w.patrolEnemy(e,def,dt);return;}e.targetId=target.id;e.yaw=Math.atan2(-(target.x-e.x),-(target.z-e.z));
 if(w.routeAttack(e,target,def))return;
 if(distance(e,target)<=def.attack_range+(target.lifeState?0:1.5)&&w.lineVisible(e,target)){
  e.lockX=target.x;e.lockZ=target.z;e.attackRadius=rally?def.attack_range:special.radius;
  if(rally)warning(w,e,'melee',def.attack_windup,'circle',{radius:def.attack_range});
  else warning(w,e,'paper_lob',def.attack_windup,'marks',{radius:special.radius,points:[{x:e.lockX,y:w.ground(e.lockX,e.lockZ),z:e.lockZ}]});
 }else w.navigateEnemy(e,target,def.speed,dt);
}
export function nightContentSpeed(e,now){return ((e.rallyUntil??0)>now?Math.min(1.25,e.rallySpeed??1.2):1)*((e.fortressSlowUntil??0)>now?.65:1);}
export function updateNightContent(d,e,dt){if(updateTacticalEnemy(d,e,dt))return true;if(newBoss(e)){updateBoss(d,e,dt);return true;}if(['broadcast_cart','paper_lobber'].includes(e.definitionId)){updateRole(d,e,dt);return true;}return false;}
