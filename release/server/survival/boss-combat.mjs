import {BOSS_MOVES,combatPreset,bossChains,bossApproachRange} from './combat-moves.mjs';
import {resolveEnemyAttack} from './combat-feedback.mjs';
import {isBoss} from './night-content-config.mjs';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const pos=e=>({x:e.x,y:e.y,z:e.z});
const forward=yaw=>({x:-Math.sin(yaw),z:-Math.cos(yaw)});
const angleDelta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const living=p=>p.lifeState!=='DEAD_WAIT';
const targets=(w,e)=>[...w.scenePlayers().filter(p=>living(p)&&(e.source!=='practice'||w.aggro.inside(e,p))),...w.bossAttackObjects(e).filter(b=>b.hp>0)];
function hit(w,e,t,m){if(t.kind==='decoy'||e.source==='practice'&&!t.lifeState)return;e.moveHits??=[];if(e.moveHits.includes(t.id))return;e.moveHits.push(t.id);const damage=t.lifeState?m.damage:m.buildingDamage;if(damage>0)w.damageQueue.push({target:t.id,actorId:e.id,damage:Math.max(1,Math.ceil(damage*(e.damageMultiplier??1)))});}
function targetFor(w,e){return w.bossRouteTarget(e,w.selectEnemyTarget(e)??(e.night?w.s.buildings.core:null));}
function begin(w,e,key,preset,follow=false){
 const m=BOSS_MOVES[key],target=targetFor(w,e);if(!target){finish(w,e,preset,1);return false;}
 const yaw=Math.atan2(-(target.x-e.x),-(target.z-e.z));
 e.targetId=target.id;e.yaw=yaw+(m.sideways?(e.attackIndex%2?1:-1)*Math.PI/2:0)+(m.yawOffset??0);
 const windup=m.windup*preset.windup*(follow?.8:1);
 e.state='WINDUP';e.attackKind=key;e.phaseRemaining=windup;e.weak=false;e.moveHits=[];
 e.attackTimeline={startedAt:w.s.time,windup,active:m.active,recovery:m.recovery*preset.recovery,trackUntil:w.s.time+Math.max(0,windup-m.lock),presentation:m.shape==='marks'?'projection':'body',comboIndex:e.comboCursor??0};
 const z={...pos(e),yaw:e.yaw,shape:m.shape==='burst'?'circle':m.shape,radius:m.radius,length:m.length,width:m.width,halfAngle:m.halfAngle,innerRadius:m.innerRadius,endsAt:w.s.time+windup,presentation:e.attackTimeline.presentation};
 if(m.shape==='marks'){
  z.footprint='square';
  const fortress=key==='stamp_marks'&&e.source!=='practice'?w.aggro.strategic(e):null;
  const primary=fortress?.hp>0&&distance(e,fortress)<=m.range&&w.lineVisible(e,fortress)?fortress:target;
  z.points=[{x:primary.x,y:w.ground(primary.x,primary.z),z:primary.z}];
  if(key==='stamp_marks'&&preset.rank>1){for(const p of w.scenePlayers().filter(living).sort((a,b)=>distance(e,a)-distance(e,b)||a.id.localeCompare(b.id)))if(z.points.length<preset.rank&&distance(e,p)<m.range&&w.lineVisible(e,p)&&(e.source!=='practice'||w.aggro.inside(e,p))&&z.points.every(q=>distance(q,p)>m.radius*1.5))z.points.push({x:p.x,y:w.ground(p.x,p.z),z:p.z});}
  if(key==='stamp_press'&&e.comboCursor===2&&e.stampPrevious&&distance(z.points[0],e.stampPrevious)>m.radius)z.points.push({...e.stampPrevious});
 }
 e.attackZone=z;e.attackRadius=m.radius??m.length??2;
 w.event('EnemyAttackWarning',{enemyId:e.id,definitionId:e.definitionId,attackKind:key,position:pos(e),zone:structuredClone(z),timeline:{...e.attackTimeline}},e.id);return true;
}
function finish(w,e,preset,weakSeconds=0){
 e.attackZone=null;e.attackTimeline=null;e.activeAttack=null;e.comboQueue=null;e.chargeRemaining=0;e.weak=weakSeconds>0;
 e.state=e.weak?'WEAK':'RECOVER';e.phaseRemaining=e.weak?weakSeconds*preset.weak:.45*preset.recovery;
 if(e.weak){e.motorDamage=0;e.valveDamage=0;e.valveCleared=false;w.event('EnemyWeakPoint',{enemyId:e.id,definitionId:e.definitionId,duration:e.phaseRemaining,position:pos(e)},e.id);}
}
function next(w,e,preset){
 const m=BOSS_MOVES[e.attackKind];
 if(e.attackKind==='stamp_press')e.stampPrevious={...e.activeAttack.zone.points[0]};
 e.activeAttack=null;e.attackZone=null;
 if(e.comboQueue&&e.comboCursor+1<e.comboQueue.length){e.comboCursor++;begin(w,e,e.comboQueue[e.comboCursor],preset,true);return;}
 // Light attacks do not automatically expose armour; completed heavy sequences do.
 finish(w,e,preset,m.weak||(e.comboCursor>0?1.6:0));
}
function spill(w,e,z,preset){
 if(!w.s.director)return;
 const v=forward(z.yaw),list=w.s.director.deployables,b=w.c.director.budgets;
 for(const fraction of [.35,.7]){if(list.filter(q=>q.kind==='slow').length>=b.maxEnemyZones||list.length>=b.maxDeployables)break;
 const x=z.x+v.x*z.length*fraction,zp=z.z+v.z*z.length*fraction;
 if(e.source==='practice'&&!w.aggro.inside(e,{x,z:zp}))continue;
 list.push({id:w.id('zone'),definitionId:'coffee_spill',kind:'slow',faction:'enemy',ownerId:e.id,x,y:w.ground(x,zp),z:zp,radius:1.1,expiresAt:w.s.time+(preset.rank===3?6:3),practiceZone:e.practiceZone??null});}
}
function burst(w,e){const m=BOSS_MOVES.power_burst,limit=w.c.director.budgets.maxProjectiles;
 for(let i=0;i<8&&Object.keys(w.s.projectiles).length<limit;i++){const v=forward(e.yaw+i*Math.PI/4),id=w.id('projectile');w.s.projectiles[id]={id,x:e.x,y:e.y+.8,z:e.z,vx:v.x*m.speed,vy:0,vz:v.z*m.speed,radius:.18,damage:m.damage*(e.damageMultiplier??1),actorId:e.id,definitionId:'power_bolt',life:3,practiceZone:e.practiceZone??null};}}
function strike(w,e,m){
 const z=structuredClone(e.attackZone);z.duration=m.active;z.travel=m.travel===true;z.style=e.attackKind;z.speed=m.speed??0;
 e.activeAttack={zone:z,elapsed:0};e.moveHits=[];e.state=m.speed&&m.shape==='line'?'CHARGE':'ATTACK';e.phaseRemaining=m.active;e.attackZone=null;
 e.chargeRemaining=m.length??0;resolveEnemyAttack(w,e,z);
 if(e.attackKind==='power_burst')burst(w,e);
}
function active(w,e,dt,preset){
 const a=e.activeAttack,m=BOSS_MOVES[e.attackKind],z=a.zone,before=a.elapsed;a.elapsed=Math.min(m.active,a.elapsed+dt);e.phaseRemaining=Math.max(0,m.active-a.elapsed);
 const v=forward(z.yaw),p0=before/m.active,p1=a.elapsed/m.active;
 if(m.speed&&m.shape==='line'){
  const step=Math.min(m.speed*dt,e.chargeRemaining),point={x:e.x+v.x*step,z:e.z+v.z*step};
  if(e.source==='practice'&&!w.aggro.inside(e,point)){finish(w,e,preset,m.weak||1.2);return;}
  const block=w.enemyRouteBlock(e,point,step),travel=block?Math.max(0,block.distance-.01):step;
  if(travel>0){w.move(e,v.x*travel/dt,v.z*travel/dt,dt,e.radius);e.y=w.enemyGroundHeight(e);}e.chargeRemaining-=travel;
  if(!m.sideways){for(const t of targets(w,e))if(distance(e,t)<e.radius+(t.lifeState?.65:1)&&w.lineVisible(e,t))hit(w,e,t,m);
   const obstacle=w.attackObject(block?.id);if(obstacle?.hp>0)hit(w,e,obstacle,m);}
  if(block||e.chargeRemaining<=0)e.phaseRemaining=0;
 }else if(e.attackKind!=='power_burst'){
  for(const t of targets(w,e)){
   const dx=t.x-z.x,dz=t.z-z.z,r=Math.hypot(dx,dz),along=dx*v.x+dz*v.z,side=Math.abs(dx*v.z-dz*v.x),margin=t.lifeState?.3:.6;
   let inside=false;
   // Stamp head, projected footprint and damage all use the same square.
   if(z.shape==='marks')inside=z.points.some(q=>Math.max(Math.abs(t.x-q.x),Math.abs(t.z-q.z))<=m.radius*.72+margin&&(!t.lifeState||t.y<=q.y+.7));
   else if(z.shape==='cone')inside=r<=m.radius+margin&&along/(r||1)>=Math.cos(m.halfAngle);
   else if(z.shape==='line')inside=along>=Math.max(0,m.length*p0-.45)-margin&&along<=m.length*p1+.45+margin&&side<=m.width/2+margin;
   else if(z.shape==='ring'){const lo=m.innerRadius+(m.radius-m.innerRadius)*p0,hi=m.innerRadius+(m.radius-m.innerRadius)*p1;inside=r>=lo-.2-margin&&r<=hi+.2+margin&&(!t.lifeState||(r>=m.innerRadius&&t.y<=z.y+.6));}
   else inside=r<=m.radius+margin&&(!t.lifeState||t.y<=z.y+.7);
   if(inside&&w.lineVisible(e,t))hit(w,e,t,m);
  }
 }
 if(e.phaseRemaining<=0){if(e.attackKind==='coffee_line')spill(w,e,z,preset);e.state='FOLLOW_THROUGH';e.phaseRemaining=m.recovery*preset.recovery;}
}
export function updateBossCombat(d,e,dt){
 if(!isBoss(e))return false;
 const w=d.w,preset=combatPreset(w,e);e.combatPreset=preset.id;
 if(['CHASE','RECOVER'].includes(e.state))e.combatPhase=preset.rank===3?2:e.hp<=e.maxHp*.5?2:1;
 if(e.combatPhase===2)preset.comboLimit=Math.min(3,preset.comboLimit+1);
 if(w.updateHitReaction(e,dt))return true;
 if(e.hp<=0)return true;
 // Room exit and legacy cancellation can clear just the old attack fields.
 // An incomplete commitment must not resolve a missing hit area.
 if(['WINDUP','ATTACK','CHARGE','FOLLOW_THROUGH'].includes(e.state)&&(!e.attackTimeline||(e.state==='WINDUP'?!e.attackZone:!e.activeAttack)||!BOSS_MOVES[e.attackKind])){finish(w,e,preset,0);return true;}
 if(e.state==='WEAK'||e.state==='RECOVER'||e.state==='STUNNED'){
  e.activeAttack=null;e.attackZone=null;e.attackTimeline=null;e.comboQueue=null;e.chargeRemaining=0;
  e.phaseRemaining=Math.max(0,e.phaseRemaining-dt);if(e.phaseRemaining<=0){
   if(e.night&&e.source!=='practice'&&e.hp<=e.maxHp*.5&&!w.s.night.addsSpawned){
    w.s.night.addsSpawned=true;
    for(let i=0;i<w.c.waves[3].adds_crab_per_player*w.s.night.playerCount;i++)w.s.night.pending.push({definitionId:'crab',at:w.s.phaseElapsed+i*w.s.night.spawnInterval,entry:i%3});
   }
   e.weak=false;e.state='CHASE';
  }return true;
 }
 if(e.state==='WINDUP'){
  const m=BOSS_MOVES[e.attackKind];e.phaseRemaining=Math.max(0,e.phaseRemaining-dt);
  // Only visible, body-directed attacks track during their initial preparation.
  if(w.s.time<e.attackTimeline.trackUntil&&m.shape!=='marks'&&!m.sideways){const target=w.s.players[e.targetId]??w.attackObject(e.targetId);if(target&&(!target.lifeState||w.inScene(target))){const goal=Math.atan2(-(target.x-e.x),-(target.z-e.z))+(m.yawOffset??0);e.yaw+=Math.max(-dt*2,Math.min(dt*2,angleDelta(goal,e.yaw)));e.attackZone.yaw=e.yaw;}}
  if(e.phaseRemaining<=0)strike(w,e,m);return true;
 }
 if(e.state==='ATTACK'||e.state==='CHARGE'){if(e.activeAttack)active(w,e,dt,preset);else finish(w,e,preset,0);return true;}
 if(e.state==='FOLLOW_THROUGH'){e.phaseRemaining=Math.max(0,e.phaseRemaining-dt);if(e.phaseRemaining<=0)next(w,e,preset);return true;}
 if(w.aggro.returnGate(e)){e.weak=false;w.patrolEnemy(e,w.enemyDefinition(e),dt);return true;}
 const target=targetFor(w,e);if(!target){w.patrolEnemy(e,w.enemyDefinition(e),dt);return true;}
 e.targetId=target.id;const range=distance(e,target),reach=bossApproachRange(e);
 if(range>reach||!w.lineVisible(e,target)){w.navigateEnemy(e,target,w.enemyDefinition(e).speed,dt);return true;}
 let chains=bossChains(e,range,preset);if(chains.length>1){const fresh=chains.filter(chain=>chain.join('/')!==e.lastChain);if(fresh.length)chains=fresh;}
 const chosen=chains[Math.floor(w.rng('boss_moves')*chains.length)];if(!chosen)return false;
 e.lastChain=chosen.join('/');e.comboQueue=[...chosen];e.comboCursor=0;e.attackIndex=(e.attackIndex??0)+1;e.cancelNextAdvance=false;
 begin(w,e,chosen[0],preset);return true;
}
