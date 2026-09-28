const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const direction=yaw=>({x:-Math.sin(yaw),z:-Math.cos(yaw)});
const living=p=>p?.lifeState==='ALIVE';
const vulnerable=p=>p&&p.lifeState!=='DEAD_WAIT';
const pos=e=>({x:e.x,y:e.y,z:e.z});
const targetList=(w,e)=>e.source==='practice'?w.scenePlayers().filter(p=>vulnerable(p)&&w.aggro.inside(e,p)):[...w.scenePlayers().filter(vulnerable),...Object.values(w.s.buildings).filter(b=>b.hp>0),...Object.values(w.s.turrets).filter(b=>b.hp>0)];
const face=(e,t)=>{e.yaw=Math.atan2(-(t.x-e.x),-(t.z-e.z));};
function zone(w,e,shape,fields={}) {e.attackZone={shape,...pos(e),y:w.ground(e.x,e.z),yaw:e.yaw,...fields,endsAt:w.s.time+e.phaseRemaining};}
function recover(e,seconds) {e.state='RECOVER';e.phaseRemaining=seconds;e.attackZone=null;e.chargeHit=[];}
function hurt(w,e,target,damage,extra={}) {if(target?.kind==='decoy')return;w.damageQueue.push({target:target.id,damage:Math.max(1,Math.ceil(damage*(e.damageMultiplier??1))),actorId:e.id,...extra});}
function bolt(d,e,point,{angle=0,speed,damage,radius=.16,kind='paper_bolt'}={}) {
  const w=d.w;if(Object.keys(w.s.projectiles).length>=d.c.budgets.maxProjectiles)return;
  const from={x:e.x,y:e.y+.65,z:e.z},dx=point.x-from.x,dz=point.z-from.z,dy=point.y-from.y,len=Math.hypot(dx,dy,dz)||1,c=Math.cos(angle),s=Math.sin(angle),id=w.id('projectile');
  w.s.projectiles[id]={id,...from,vx:(dx*c-dz*s)/len*speed,vy:dy/len*speed,vz:(dx*s+dz*c)/len*speed,radius,damage:damage*(e.damageMultiplier??1),actorId:e.id,definitionId:kind,life:4,practiceZone:e.practiceZone??null};
}

export function updateDirectedEnemy(d,e,dt) {
  const w=d.w,base=w.defs.creatures[e.definitionId];if(!base.role)return false;
  const def={...w.enemyDefinition(e)};
  if(e.source==='practice'&&['WINDUP','CHARGE'].includes(e.state)&&e.attackKind!=='heal'&&(!d.target(e)||!w.aggro.inside(e,d.target(e)))){recover(e,.25);return true;}
  if(e.source==='fishing'){def.attack_range=base.attack_range;def.attack_windup=base.attack_windup;def.attack_cooldown=base.attack_cooldown;}
  if(w.updateHitReaction(e,dt))return true;
  if(e.state==='burrow_windup'){
    e.phaseRemaining=Math.max(0,e.phaseRemaining-dt);
    if(e.phaseRemaining<=0){delete e.rescuePosition;e.state='CHASE';e.attackZone=null;e.stuckTime=0;}
    return true;
  }
  if(w.aggro.returnGate(e)){
    if(['STUNNED','RECOVER'].includes(e.state)){e.phaseRemaining=Math.max(0,e.phaseRemaining-dt);if(e.phaseRemaining<=0)e.state='CHASE';return true;}
    e.state='CHASE';e.phaseRemaining=0;e.attackZone=null;w.patrolEnemy(e,def,dt);return true;
  }
  e.phaseRemaining=Math.max(0,e.phaseRemaining-dt);
  if(['STUNNED','RECOVER'].includes(e.state)){if(e.phaseRemaining<=0)e.state='CHASE';return true;}
  if(e.state==='CHARGE'){
    const v=direction(e.yaw),amount=Math.min(def.dash_speed*dt,e.chargeRemaining),before=pos(e);
    if(e.source==='practice'&&!w.aggro.inside(e,{x:e.x+v.x*amount,z:e.z+v.z*amount})){recover(e,def.attack_cooldown);return true;}
    const blocker=w.enemyRouteBlock(e,{x:e.x+v.x*amount,z:e.z+v.z*amount},amount),building=w.s.buildings[blocker?.id]??w.s.turrets[blocker?.id]??w.s.destructibles?.[blocker?.id];
    const travel=blocker?Math.max(0,blocker.distance-.01):amount;
    w.move(e,v.x*travel/dt,v.z*travel/dt,dt,e.radius);e.y=w.enemyGroundHeight(e);e.chargeRemaining-=travel;
    for(const target of targetList(w,e))if(!e.chargeHit.includes(target.id)&&dist(e,target)<(target.lifeState?1.1:2.0)&&w.lineVisible(e,target)){e.chargeHit.push(target.id);hurt(w,e,target,def.damage);}
    if(e.source!=='practice'&&building?.hp>0&&!e.chargeHit.includes(building.id)){e.chargeHit.push(building.id);hurt(w,e,building,def.damage);}
    if(blocker||e.chargeRemaining<=0||dist(before,e)<.005)recover(e,def.attack_cooldown);
    return true;
  }
  if(w.routeAttack(e,null,def))return true;
  if(e.state==='WINDUP'){
    if(e.phaseRemaining>0)return true;
    const target=d.target(e);
    if(e.attackKind==='dash') {e.state='CHARGE';e.chargeRemaining=def.dash_distance;e.chargeHit=[];e.attackZone=null;return true;}
    if(e.attackKind==='heal') {
      if(target?.hp>0&&target.definitionId!=='boss_crab'&&dist(e,target)<=def.heal_range&&w.lineVisible(e,target)){const amount=Math.min(def.heal_amount,target.maxHp-target.hp);target.hp+=amount;target.revision++;w.event('EnemyHeal',{actorId:e.id,targetId:target.id,amount,position:pos(target)},e.id);}
      e.healAt=w.s.time+def.heal_cooldown;
    }else if(e.attackKind==='slow_bolt'){
      if(Object.keys(w.s.projectiles).length<d.c.budgets.maxProjectiles){const from={x:e.x,y:e.y+.85,z:e.z},delta={x:e.lockX-from.x,y:e.lockY-from.y,z:e.lockZ-from.z},length=Math.hypot(delta.x,delta.y,delta.z)||1,id=w.id('projectile');w.s.projectiles[id]={id,...from,vx:delta.x/length*def.projectile_speed,vy:delta.y/length*def.projectile_speed,vz:delta.z/length*def.projectile_speed,radius:def.projectile_radius,damage:def.damage*(e.damageMultiplier??1),actorId:e.id,definitionId:'slow_bolt',slowSeconds:def.slow_seconds,life:4,practiceZone:e.practiceZone??null};}
    }else if(['paper_bolt','archive_spread'].includes(e.attackKind)){
      const point={x:e.lockX,y:e.lockY,z:e.lockZ};
      for(const angle of e.attackKind==='archive_spread'?[-.18,0,.18]:[0])bolt(d,e,point,{angle,speed:def.projectile_speed,damage:def.damage,radius:def.projectile_radius,kind:e.attackKind});
    }else if(e.attackKind==='puddle'){
      const point={x:e.lockX,y:w.ground(e.lockX,e.lockZ),z:e.lockZ};d.addZone(e,point);
      for(const p of w.scenePlayers())if(vulnerable(p)&&(e.source!=='practice'||w.aggro.inside(e,p))&&dist(p,point)<=def.zone_radius&&p.y<=point.y+.5&&w.lineVisible(e,p))hurt(w,e,p,def.damage);
    }
    else if(['inflate','pulse'].includes(e.attackKind)){
      for(const p of w.scenePlayers())if(vulnerable(p)&&(e.source!=='practice'||w.aggro.inside(e,p))&&dist(e,p)<=def.attack_range&&w.lineVisible(e,p)){
        hurt(w,e,p,def.damage);
        if(e.attackKind==='inflate'){const distance=dist(e,p)||1;w.move(p,(p.x-e.x)/distance*4,(p.z-e.z)/distance*4,.1,w.c.player.capsule_radius);}
        else if((p.joinProtectionUntil??0)<=w.s.time)p.slowUntil=Math.max(p.slowUntil??0,w.s.time+.7);
      }
    }else if(target&&target.hp>0&&dist(e,target)<=def.attack_range+(target.lifeState?.6:1.5)&&w.lineVisible(e,target)){
      const v=direction(e.yaw),distance=dist(e,target)||1;
      if(((target.x-e.x)*v.x+(target.z-e.z)*v.z)/distance>=.5)hurt(w,e,target,e.role==='breaker'&&!target.lifeState?(def.building_damage??def.damage):def.damage);
    }
    recover(e,def.attack_cooldown);return true;
  }
  let target=w.enemyRouteTarget(e,w.selectEnemyTarget(e));
  if(e.role==='medic'&&w.s.time>=(e.healAt??0)&&w.s.time>=(e.healScanAt??0)){
    e.healScanAt=w.s.time+.5;
    const friend=Object.values(w.s.enemies).filter(other=>other.id!==e.id&&other.definitionId!=='boss_crab'&&other.source===e.source&&other.hp>0&&other.hp<other.maxHp&&w.aggro.inside(e,other)&&dist(e,other)<=def.heal_range&&w.lineVisible(e,other)).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp)[0];
    if(friend){e.targetId=friend.id;e.state='WINDUP';e.phaseRemaining=def.heal_windup;e.attackKind='heal';e.attackRadius=def.heal_range;zone(w,e,'circle',{radius:def.heal_range});return true;}
  }
  if(!target){w.patrolEnemy(e,def,dt);return true;}
  e.targetId=target.id;e.alertState='chase';face(e,target);
  if(w.routeAttack(e,target,def))return true;
  if(['drone','artillery','jammer'].includes(e.role)&&target.lifeState&&dist(e,target)<(e.role==='drone'?5:4)&&w.s.time>=(e.retreatAt??0)){
    const v=direction(e.yaw),moved=w.navigateEnemy(e,{id:`retreat:${target.id}`,x:e.x-v.x*2,z:e.z-v.z*2},def.speed,dt);
    e.retreatRemaining=(e.retreatRemaining??.45)-dt;
    if(e.retreatRemaining<=0){e.retreatAt=w.s.time+2;e.retreatRemaining=.45;}
    if(moved)return true;
  }
  const reach=def.attack_range+(target.definitionId==='core'?1.5:0);
  if(dist(e,target)<=reach&&w.lineVisible(e,target)){
    e.state='WINDUP';e.phaseRemaining=def.attack_windup;e.lockX=target.x;e.lockY=target.y+1;e.lockZ=target.z;e.attackRadius=def.attack_range;
    e.attackKind={courier:'dash',swooper:'dash',drone:'paper_bolt',artillery:'archive_spread',jammer:'slow_bolt',breaker:'breach',spore:'puddle',puffer:'inflate',lantern:'pulse'}[e.role]??'melee';
    if(e.attackKind==='dash'){e.attackRadius=.8;zone(w,e,'line',{length:def.dash_distance,width:1.6});}
    else if(e.attackKind==='puddle')zone(w,e,'circle',{x:e.lockX,y:w.ground(e.lockX,e.lockZ),z:e.lockZ,radius:def.zone_radius});
    else if(['slow_bolt','paper_bolt'].includes(e.attackKind))zone(w,e,'line',{length:def.attack_range,width:.4});
    else if(e.attackKind==='archive_spread')zone(w,e,'cone',{radius:def.attack_range,halfAngle:.24});
    else zone(w,e,'circle',{radius:def.attack_range});
    return true;
  }
  w.navigateEnemy(e,target,def.speed,dt);
  return true;
}

export function updateDirectedBoss(d,boss,dt) {
  const w=d.w,def=d.c.bosses[boss.variantId];
  // Finish a committed warning first. Half-health changes the NEXT pattern,
  // never shortens a warning the players have already started reading.
  if(boss.state==='CHASE'||boss.state==='RECOVER')boss.combatPhase=boss.hp<=boss.maxHp*.5?2:1;
  boss.phaseRemaining=Math.max(0,boss.phaseRemaining-dt);
  if(boss.state==='WEAK'){boss.weak=true;if(boss.phaseRemaining<=0){boss.weak=false;recover(boss,2);}return;}
  if(boss.state==='RECOVER'){
    if(boss.phaseRemaining<=0){
      if(boss.hp<=boss.maxHp*.5&&!w.s.night.addsSpawned){w.s.night.addsSpawned=true;for(let i=0;i<w.c.waves[3].adds_crab_per_player*w.s.night.playerCount;i++)w.s.night.pending.push({definitionId:'crab',at:w.s.phaseElapsed+i*w.s.night.spawnInterval,entry:i%3});}
      boss.state='CHASE';
    }
    return;
  }
  if(boss.state==='WINDUP'){
    if(boss.phaseRemaining>0)return;
    const attackZone=boss.attackZone??{yaw:boss.yaw},v=direction(attackZone.yaw);
    if(boss.attackKind==='power_burst'){
      for(let i=0;i<8;i++){const angle=boss.yaw+i*Math.PI/4,point={x:boss.x-Math.sin(angle)*12,y:boss.y+.65,z:boss.z-Math.cos(angle)*12};bolt(d,boss,point,{speed:def.burstSpeed,damage:def.burstDamage,radius:.20,kind:'power_bolt'});}
    }
    for(const target of [...w.scenePlayers().filter(vulnerable),...w.bossAttackObjects(boss).filter(b=>b.hp>0)]){
      const distance=dist(boss,target);let inside=false;
      if(boss.attackKind==='power_burst')continue;
      if(boss.attackKind==='stamp_marks')inside=(attackZone.points??[]).some(point=>dist(point,target)<=def.stampRadius+(target.lifeState?0:.8)&&(!target.lifeState||target.y<=w.ground(target.x,target.z)+.6));
      else if(boss.variantId==='auditor'){const dot=((target.x-boss.x)*v.x+(target.z-boss.z)*v.z)/(distance||1);inside=distance<=def.range+(target.lifeState?0:1.5)&&dot>=Math.cos(def.halfAngle);}
      else inside=distance<=def.outerRadius+(target.lifeState?0:1.5)&&(!target.lifeState||distance>=def.innerRadius&&target.y<=w.ground(target.x,target.z)+.45);
      if(inside&&w.lineVisible(boss,target))hurt(w,boss,target,boss.attackKind==='stamp_marks'?(target.lifeState?def.stampDamage:def.stampBuildingDamage):(target.lifeState?def.damage:def.buildingDamage));
    }
    w.event('EnemyAttackResolved',{enemyId:boss.id,attackKind:boss.attackKind,zone:boss.attackZone,position:pos(boss)},boss.id);
    boss.state='WEAK';boss.weak=true;boss.phaseRemaining=def.weakSeconds;boss.attackZone=null;return;
  }
  const target=w.bossRouteTarget(boss,w.selectEnemyTarget(boss)??w.s.buildings.core);boss.targetId=target.id;face(boss,target);
  if(dist(boss,target)<=9&&w.lineVisible(boss,target)){
    const index=boss.attackIndex++,secondPhase=boss.combatPhase===2;
    boss.state='WINDUP';boss.phaseRemaining=def.windup;boss.attackKind=boss.variantId==='auditor'?'audit_cone':'overload_ring';
    if(boss.variantId==='auditor'){
      if(index%(secondPhase?3:2)!==0){
        const fortress=w.aggro.strategic(boss),primary=fortress?.hp>0&&dist(fortress,boss)<=def.stampRange&&w.lineVisible(boss,fortress)?fortress:target;
        const candidates=[primary,...w.scenePlayers().filter(p=>living(p)&&p.id!==primary.id&&dist(p,boss)<=def.stampRange&&w.lineVisible(boss,p)).sort((a,b)=>dist(a,boss)-dist(b,boss)||a.id.localeCompare(b.id))];
        const points=[];for(const p of candidates){if(points.length>=3)break;if(points.some(at=>dist(at,p)<def.stampRadius*1.5))continue;points.push({x:p.x,y:w.ground(p.x,p.z),z:p.z});}
        boss.attackKind='stamp_marks';boss.phaseRemaining=def.stampWindup;boss.attackRadius=def.stampRadius;zone(w,boss,'marks',{radius:def.stampRadius,points});
      }else{boss.attackRadius=def.range;zone(w,boss,'cone',{radius:def.range,halfAngle:def.halfAngle});}
    }else if(index%(secondPhase?3:2)!==0){boss.attackKind='power_burst';boss.phaseRemaining=def.burstWindup;boss.attackRadius=8;zone(w,boss,'spokes',{radius:10,width:.6,count:8});}
    else {boss.attackRadius=def.outerRadius;zone(w,boss,'ring',{radius:def.outerRadius,innerRadius:def.innerRadius});}
    return;
  }
  w.moveBoss(boss,target,dt);
}

export function prepareDirectedDamage(d) {
  const w=d.w;
  for(const hit of w.damageQueue){
    const p=w.s.players[hit.actorId],target=w.s.enemies[hit.target],playerTarget=w.s.players[hit.target];
    if(p){if(d.has(p,'precision')&&hit.weak)hit.damage*=d.effect(p,'precision');if(d.has(p,'brawler')&&['knife','fist'].includes(hit.weaponId))hit.damage*=d.effect(p,'brawler');}
    if(target?.role==='shield'){
      const actor=p??w.s.turrets[hit.actorId];if(actor){const v=direction(target.yaw),distance=dist(actor,target)||1;if(((actor.x-target.x)*v.x+(actor.z-target.z)*v.z)/distance>.35){hit.damage*=w.defs.creatures[target.definitionId].front_multiplier;hit.shielded=true;}}
    }
    if(playerTarget&&w.inScene(playerTarget)&&living(playerTarget)&&(playerTarget.joinProtectionUntil??0)<=w.s.time&&Number.isFinite(hit.slowSeconds))playerTarget.slowUntil=Math.max(playerTarget.slowUntil??0,w.s.time+Math.min(2,hit.slowSeconds));
    hit.damage=Math.max(0,hit.damage);
  }
}

export function updateDeployables(d,dt) {
  const w=d.w;d.s.deployables=d.s.deployables.filter(x=>x.expiresAt>w.s.time);
  for(const zone of d.s.deployables)if(zone.kind==='slow')for(const p of w.scenePlayers())if(living(p)&&(!zone.practiceZone||w.aggro.inside({source:'practice',practiceZone:zone.practiceZone},p))&&dist(p,zone)<=zone.radius&&p.y<=zone.y+.5&&(p.joinProtectionUntil??0)<=w.s.time&&w.lineVisible(zone,p))p.slowUntil=Math.max(p.slowUntil??0,w.s.time+.3);
}
