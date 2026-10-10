import {isBoss} from './night-content-config.mjs';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
export function useTacticalTool(d,p,id,at,def,need){
 const w=d.w;if(id==='scan_note'){w.consume(p,id,1);const enemyIds=[];for(const e of Object.values(w.s.enemies))if(e.hp>0&&distance(e,at)<=def.radius&&w.lineVisible(at,e)){e.markedUntil=Math.max(e.markedUntil??0,w.s.time+def.duration);enemyIds.push(e.id);}w.event('ToolUsed',{actorId:p.id,definitionId:id,position:at,enemyIds,duration:def.duration,radius:def.radius},p.id);return true;}
 if(!['folding_cover','tape_trap'].includes(id))return false;
 need(d.s.deployables.length<d.c.budgets.maxDeployables&&!d.s.deployables.some(q=>q.ownerId===p.id&&q.definitionId===id),'BUSY');
 if(id==='folding_cover'){
  for(const dx of [-1,0,1])for(const dz of [-.14,0,.14])need(!w.blocked(at.x+dx,at.y,at.z+dz,.15),'INVALID_TARGET','挡板放不下，换个空地');
  need(![...w.scenePlayers().filter(q=>q.lifeState!=='DEAD_WAIT'),...Object.values(w.s.enemies).filter(q=>q.hp>0)].some(q=>Math.abs(q.x-at.x)<1+(q.radius??.55)&&Math.abs(q.z-at.z)<.14+(q.radius??.55)),'INVALID_TARGET','挡板不能压住队友');
 }
 w.consume(p,id,1);const q={id:w.id('deployable'),definitionId:id,kind:id==='folding_cover'?'cover':'trap',ownerId:p.id,faction:'camp',...at,radius:def.radius,hp:id==='folding_cover'?def.hp:1,maxHp:id==='folding_cover'?def.hp:1,revision:1,expiresAt:w.s.time+def.duration};d.s.deployables.push(q);if(w.navGeometry)w.navGeometry.tick=-1;
 w.event('ToolUsed',{actorId:p.id,definitionId:id,deployableId:q.id,position:at,duration:def.duration},p.id);return true;
}
export function updateTacticalDeployables(d){const w=d.w;for(const q of d.s.deployables)if(q.kind==='trap'){
 const e=Object.values(w.s.enemies).find(e=>e.hp>0&&!isBoss(e)&&e.locomotion!=='air'&&e.y<=q.y+.6&&distance(e,q)<=q.radius&&(e.trapImmuneUntil??0)<=w.s.time&&w.lineVisible(q,e));
 if(e){e.state='STUNNED';e.phaseRemaining=d.c.tools.tape_trap.hold;e.attackZone=null;e.chargeRemaining=0;e.trapImmuneUntil=w.s.time+5;q.expiresAt=w.s.time;w.event('EnemyInterrupted',{enemyId:e.id,definitionId:e.definitionId,duration:e.phaseRemaining,position:{x:e.x,y:e.y,z:e.z}},e.id);}
}}
function telegraph(w,e,kind,seconds,zone){e.state='WINDUP';e.attackKind=kind;e.phaseRemaining=seconds;e.attackZone={...zone,endsAt:w.s.time+seconds};w.event('EnemyAttackWarning',{enemyId:e.id,definitionId:e.definitionId,attackKind:kind,zone:structuredClone(e.attackZone),position:{x:e.x,y:e.y,z:e.z}},e.id);}
const attackables=(w,e)=>[...w.scenePlayers().filter(p=>p.lifeState!=='DEAD_WAIT'&&(e.source!=='practice'||w.aggro.inside(e,p))),...w.bossAttackObjects(e)];
function expose(w,e,seconds){e.state='WEAK';e.weak=true;e.phaseRemaining=seconds;e.attackZone=null;e.valveDamage=0;e.valveCleared=false;e.comboNext=null;w.event('EnemyWeakPoint',{enemyId:e.id,definitionId:e.definitionId,duration:seconds,weakPart:'valve',position:{x:e.x,y:e.y,z:e.z}},e.id);}
export function updateTacticalEnemy(d,e,dt){const w=d.w,stamp=e.definitionId==='boss_stamp_press',coffee=e.definitionId==='boss_coffee_boiler',eraser=e.definitionId==='eraser_cart',battery=e.definitionId==='battery_mite';if(!stamp&&!coffee&&!eraser&&!battery)return false;
 if(eraser||battery)return updateUtilityEnemy(d,e,dt,eraser);
 const def=d.c.nightContent[stamp?'stamp':'coffee'];if(['CHASE','RECOVER'].includes(e.state))e.combatPhase=e.hp<=e.maxHp*.5?2:1;e.phaseRemaining=Math.max(0,e.phaseRemaining-dt);
 if(e.state==='WEAK'){if(e.phaseRemaining<=0){e.weak=false;e.state='RECOVER';e.phaseRemaining=def.recoverSeconds*(e.hp<=e.maxHp*.5?.8:1);}return true;}
 if(e.state==='RECOVER'){if(e.phaseRemaining<=0)e.state='CHASE';return true;}
 if(e.state==='WINDUP'){
  if(e.phaseRemaining>0)return true;const z=e.attackZone,v={x:-Math.sin(z.yaw??0),z:-Math.cos(z.yaw??0)};
  for(const t of attackables(w,e)){const dx=t.x-z.x,dz=t.z-z.z,r=Math.hypot(dx,dz),along=dx*v.x+dz*v.z,side=Math.abs(dx*v.z-dz*v.x),margin=t.lifeState?0:.5;
   const inside=z.shape==='marks'?z.points.some(point=>distance(t,point)<=z.radius+margin):z.shape==='circle'?r<=z.radius+margin:z.shape==='ring'?r>=z.innerRadius&&r<=z.radius+margin:along>=0&&along<=z.length+margin&&side<=z.width/2+margin;
   if(t.hp>0&&inside&&w.lineVisible(e,t))w.damageQueue.push({target:t.id,actorId:e.id,damage:Math.ceil((t.lifeState?def.damage:def.buildingDamage)*(e.damageMultiplier??1))});
  }
  e.attackActionSeq=(e.attackActionSeq??0)+1;e.attackActionAt=w.s.time;w.event('EnemyAttackResolved',{enemyId:e.id,definitionId:e.definitionId,attackKind:e.attackKind,attackActionSeq:e.attackActionSeq,zone:z,position:{x:e.x,y:e.y,z:e.z}},e.id);
  if(stamp&&(e.stampRemaining??1)>1){e.stampPrevious=z.points[0];e.stampRemaining--;e.state='CHASE';e.continueStamp=true;}
  else{
   if(coffee&&z.shape==='line')for(const fraction of [.35,.7]){const count=d.s.deployables.filter(q=>q.kind==='slow').length;if(count>=d.c.budgets.maxEnemyZones||d.s.deployables.length>=d.c.budgets.maxDeployables)break;d.s.deployables.push({id:w.id('zone'),definitionId:'coffee_spill',kind:'slow',faction:'enemy',ownerId:e.id,x:z.x+v.x*z.length*fraction,y:w.ground(z.x+v.x*z.length*fraction,z.z+v.z*z.length*fraction),z:z.z+v.z*z.length*fraction,radius:1.1,expiresAt:w.s.time+(e.combatPhase===2?8:3),practiceZone:e.practiceZone??null});}
   if(coffee&&e.comboNext==='ring'){e.comboNext='boil';telegraph(w,e,'coffee_ring',def.windup,{shape:'ring',x:e.x,y:e.y,z:e.z,radius:def.radius,innerRadius:def.innerRadius});return true;}
   if(coffee&&e.comboNext==='boil'){e.comboNext=null;telegraph(w,e,'coffee_boil',def.windup,{shape:'circle',x:e.x,y:e.y,z:e.z,radius:def.innerRadius});return true;}
   expose(w,e,def.weakSeconds);
  }return true;
 }
 const target=w.bossRouteTarget(e,w.selectEnemyTarget(e)??(e.source!=='practice'?w.s.buildings.core:null));if(!target){w.patrolEnemy(e,w.defs.creatures[e.definitionId],dt);return true;}e.targetId=target.id;e.yaw=Math.atan2(-(target.x-e.x),-(target.z-e.z));
 if(distance(e,target)>(stamp?def.range:def.length)||!w.lineVisible(e,target)){w.navigateEnemy(e,target,w.defs.creatures[e.definitionId].speed,dt);return true;}
 if(stamp){if(!e.continueStamp){e.stampRemaining=3;e.stampPrevious=null;}e.continueStamp=false;const points=[{x:target.x,y:w.ground(target.x,target.z),z:target.z}];if(e.combatPhase===2&&e.stampRemaining===1&&e.stampPrevious&&distance(points[0],e.stampPrevious)>def.radius*.5)points.push({...e.stampPrevious});telegraph(w,e,'stamp_press',def.windup,{shape:'marks',x:e.x,y:e.y,z:e.z,radius:def.radius,points});}
 else{const ring=e.attackIndex++%2===1;e.comboNext=e.combatPhase===2?(ring?'boil':'ring'):null;telegraph(w,e,ring?'coffee_ring':'coffee_line',def.windup,ring?{shape:'ring',x:e.x,y:e.y,z:e.z,radius:def.radius,innerRadius:def.innerRadius}:{shape:'line',x:e.x,y:e.y,z:e.z,yaw:e.yaw,length:def.length,width:def.width});}return true;
}
function updateUtilityEnemy(d,e,dt,eraser){const w=d.w,def=w.enemyDefinition(e);if(w.updateHitReaction(e,dt))return true;e.phaseRemaining=Math.max(0,e.phaseRemaining-dt);if(['STUNNED','RECOVER'].includes(e.state)){if(e.phaseRemaining<=0)e.state='CHASE';return true;}if(w.aggro.returnGate(e)){e.state='CHASE';e.attackZone=null;w.patrolEnemy(e,def,dt);return true;}
 if(e.state==='WINDUP'){if(w.routeAttack(e,null,def))return true;if(e.phaseRemaining>0)return true;const t=d.target(e);if(t?.hp>0&&distance(e,t)<=2.3&&w.lineVisible(e,t)){if(e.attackKind==='erase'){if(t.kind==='cover')w.damageQueue.push({target:t.id,actorId:e.id,damage:28});else t.expiresAt=w.s.time;}else if(e.attackKind==='eat_cell'){t.ammo=Math.max(0,t.ammo-4);t.revision++;}else w.damageQueue.push({target:t.id,actorId:e.id,damage:def.damage});}e.specialAt=w.s.time+(eraser?5:4);e.state='RECOVER';e.phaseRemaining=def.attack_cooldown;e.attackZone=null;return true;}
 const toolTargets=eraser?d.s.deployables.filter(q=>['cover','trap','decoy'].includes(q.kind)&&q.hp>0):Object.values(w.s.turrets).filter(q=>q.hp>0&&q.ammo>0);
 const special=w.s.time>=(e.specialAt??0)?toolTargets.filter(q=>distance(e,q)<8&&w.lineVisible(e,q)).sort((a,b)=>distance(e,a)-distance(e,b))[0]:null;
 const t=w.enemyRouteTarget(e,special??w.selectEnemyTarget(e));if(!t){w.patrolEnemy(e,def,dt);return true;}e.targetId=t.id;e.yaw=Math.atan2(-(t.x-e.x),-(t.z-e.z));if(!special&&w.routeAttack(e,t,def))return true;
 if(distance(e,t)<=2.2&&w.lineVisible(e,t))telegraph(w,e,special?.id===t.id?(eraser?'erase':'eat_cell'):'melee',1.4,{shape:'circle',x:e.x,y:e.y,z:e.z,radius:1.6});else w.navigateEnemy(e,t,def.speed,dt);return true;
}
