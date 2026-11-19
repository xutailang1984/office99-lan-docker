// Synthetic authoritative navigation/combat probes. No product writes, server or GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,put,restored} from './director-helpers.mjs';
import {BOSS_MOVES} from '../combat-moves.mjs';
const variants=['base','auditor','overload'];
function make(variant,x=0,z=34){
 const f=fixture();f.w.setPhase('DAY');f.w.s.enemies={};f.w.s.destructibles={};f.w.s.director.objective=null;f.w.s.director.optionalObjective=null;put(f.p,f.w,50,50);
 const boss=f.w.spawnEnemy('boss_crab',x,z,true);boss.variantId=variant;f.w.drainEvents();return {...f,boss};
}
function prop(w,id,x,z,hp=60){const q={id,kind:'barrel',x,y:w.ground(x,z),z,yaw:0,hp,maxHp:hp,size:{x:1.05,y:1.5,z:1.05},radius:Math.hypot(1.05,1.05)/2,revision:1,broken:false,seed:11};w.s.destructibles[id]=q;return q;}
function tick(w,e,dt=.025){const before={x:e.x,z:e.z},speed=e.state==='CHARGE'?10:w.defs.creatures.boss_crab.speed;w.s.tick++;w.s.time+=dt;w.updateBoss(e,dt);w.updateProjectiles(dt);w.resolveDamage();assert(Number.isFinite(e.x)&&Number.isFinite(e.y)&&Number.isFinite(e.z));const moved=Math.hypot(e.x-before.x,e.z-before.z);assert(moved<=speed*dt+1e-7,'boss exceeded one tick of its current movement speed');return moved;}

for(const variant of variants)test(`boss obstacle: ${variant} breaks the real blocking prop and proceeds toward the fortress`,()=>{
 const {w,boss}=make(variant),barrel=prop(w,'synthetic-path-barrel',0,22);assert(!w.blocked(boss.x,boss.y,boss.z,boss.radius,boss.id));
 let brokenAt=null,passed=false;
 for(let i=0;i<1200;i++){
  tick(w,boss);
  assert(!w.blocked(boss.x,boss.y,boss.z,boss.radius,boss.id),'boss entered a collider');
  if(barrel.broken&&brokenAt===null)brokenAt=w.s.time;
  if(barrel.broken&&boss.z<20){passed=true;break;}
 }
 assert(barrel.broken,`${variant} never damaged/destroyed the blocking barrel`);assert(passed,`${variant} did not pass the cleared obstacle`);
 const events=w.drainEvents(),destroyed=events.filter(e=>e.eventType==='Destroyed'&&e.payload.targetId===barrel.id);assert.equal(destroyed.length,1);assert.equal(destroyed[0].payload.actorId,boss.id);assert(w.s.containers[barrel.lootContainerId]);
 assert(events.some(e=>e.eventType==='Hit'&&e.payload.actorId===boss.id&&e.payload.targetId===barrel.id));assert(brokenAt<30);
});

for(const variant of variants)test(`boss obstacle: ${variant} damages the cover wall while preserving the player and prop behind it`,()=>{
 const {w,p,boss}=make(variant,0,10);put(p,w,0,6.5);const barrel=prop(w,'synthetic-protected-barrel',0,5.5);
 const wall={id:'synthetic-boss-cover',definitionId:'wall',x:0,y:w.ground(0,8),z:8,yaw:0,hp:1000,maxHp:1000,level:1,revision:1};w.s.buildings[wall.id]=wall;
 assert(!w.lineVisible(boss,p));assert(!w.lineVisible(boss,barrel));
 for(let i=0;i<100;i++){tick(w,boss);if(boss.state==='WEAK')break;}
 assert.equal(boss.state,'WEAK','first normal attack did not finish');assert(wall.hp<1000,'fixture needs a real attack against the visible wall');assert.equal(p.hp,100);assert.equal(barrel.hp,60);assert.equal(barrel.broken,false);
});

for(const variant of variants)test(`boss obstacle: ${variant} steers around an indestructible rock without entering or jumping across it`,()=>{
 const {w,boss}=make(variant);w.boxes();const rock={id:'rock_synthetic_boss_route',x0:-1,x1:1,z0:21,z1:23,y0:5,y1:8};w.staticBoxes.push(rock);
 let maxSide=0,passed=false;
 for(let i=0;i<1200;i++){
  tick(w,boss);maxSide=Math.max(maxSide,Math.abs(boss.x));
  assert(!w.blocked(boss.x,boss.y,boss.z,boss.radius,boss.id),'boss crossed the rock');
  if(boss.z<20){passed=true;break;}
 }
 assert(passed,`${variant} stayed trapped on the indestructible rock`);assert(maxSide>=2,'did not go around full rock plus body radius');assert(w.staticBoxes.includes(rock),'rock was removed instead of navigated');
});

function nearRock(variant){
 const f=make(variant,24,20),{w,boss}=f;Object.assign(w.s.buildings.core,{x:24,y:w.ground(24,25),z:25});w.boxes();
 const rock={id:'rock_synthetic_near_boss',x0:23,x1:25,z0:22,z1:23,y0:5,y1:8};w.staticBoxes.push(rock);
 assert(Math.hypot(boss.x-24,boss.z-25)<9);assert(!w.lineVisible(boss,w.s.buildings.core));return {...f,rock};
}
for(const variant of variants)test(`boss obstacle: ${variant} detours before attacking a close target hidden by an indestructible rock`,()=>{
 const {w,boss,rock}=nearRock(variant);let attacked=false,maxSide=0;
 for(let i=0;i<800;i++){
  tick(w,boss);maxSide=Math.max(maxSide,Math.abs(boss.x-24));assert(!w.blocked(boss.x,boss.y,boss.z,boss.radius,boss.id));
  if(boss.state==='WINDUP'){assert(w.lineVisible(boss,w.s.buildings.core),'started a warning at a target hidden by the rock');attacked=true;break;}
  assert.equal(boss.attackIndex,0,'spent an attack without a visible target');
 }
 assert(attacked,'did not navigate to a legal attack position within 20 seconds');assert(maxSide>1,'did not visibly go around the close rock');assert(w.staticBoxes.includes(rock));
});

test('boss obstacle: saving a real detour preserves combat state and restores bounded navigation',()=>{
 for(const variant of variants){
  const {w,boss,rock}=nearRock(variant),origin={x:boss.x,z:boss.z};
  for(let i=0;i<300&&Math.abs(boss.x-origin.x)<.3;i++)tick(w,boss);
  assert(Math.abs(boss.x-origin.x)>=.3,'fixture did not actually steer around the rock');
  assert.equal(boss.state,'CHASE');assert.equal(boss.attackIndex,0);
  assert(!w.blocked(boss.x,boss.y,boss.z,boss.radius,boss.id));
  const saved=w.serialize(),next=restored(w),copy=next.s.enemies[boss.id];next.boxes();next.staticBoxes.push({...rock});
  for(const key of ['x','y','z','hp','state','attackIndex','phaseRemaining','targetId'])assert.equal(copy[key],boss[key],`${variant}.${key} changed on restore`);
  assert.equal(saved.navigation,undefined,'private route cache became save data');
  let attacked=false;
  for(let i=0;i<800;i++){
   tick(next,copy);assert(!next.blocked(copy.x,copy.y,copy.z,copy.radius,copy.id));
   if(copy.state==='WINDUP'){assert(next.lineVisible(copy,next.s.buildings.core));assert.equal(copy.attackIndex,1);attacked=true;break;}
   assert.equal(copy.attackIndex,0,'a restore replayed or consumed an attack before a legal warning');
  }
  assert(attacked,'restored Boss did not navigate to a legal attack position');
 }
});

test('boss obstacle: a real power burst still damages a route prop after its caster dies',()=>{
 const {w,p,boss}=make('overload',24,20);Object.assign(w.s.buildings.core,{x:24,y:w.ground(24,24),z:24});boss.attackIndex=1;boss.lastChain='overload_ring';
 tick(w,boss);assert.equal(boss.attackKind,'power_burst');for(let i=0;i<100&&boss.state==='WINDUP';i++)tick(w,boss);
 const bolts=Object.values(w.s.projectiles);assert.equal(bolts.length,8);assert(bolts.every(b=>b.definitionId==='power_bolt'&&b.damage===8));
 const barrel=prop(w,'synthetic-after-caster-death',24,22);w.damageQueue.push({target:boss.id,damage:boss.hp,actorId:p.id});w.resolveDamage();assert(!w.s.enemies[boss.id]);assert.equal(Object.keys(w.s.projectiles).length,8);
 for(let i=0;i<40;i++){w.s.time+=.025;w.updateProjectiles(.025);w.resolveDamage();}
 assert.equal(barrel.hp,52);assert.equal(w.drainEvents().filter(e=>e.eventType==='Hit'&&e.payload.targetId===barrel.id&&e.payload.actorId===boss.id).length,1);
});

test('boss obstacle: ordinary ranged projectiles stop at a prop without changing its health',()=>{
 for(const definitionId of ['electric_bolt','paper_bolt','archive_spread','slow_bolt']){
  const {w}=make('base',24,20),barrel=prop(w,'synthetic-ordinary-cover',24,22),id=`synthetic-${definitionId}`;
  w.s.projectiles[id]={id,x:24,y:w.ground(24,20)+.65,z:20,vx:0,vy:0,vz:6,radius:.2,damage:8,actorId:'synthetic-ordinary-enemy',definitionId,life:4};
  for(let i=0;i<40;i++){w.s.time+=.025;w.updateProjectiles(.025);w.resolveDamage();}
  assert.equal(barrel.hp,60,`${definitionId} gained unintended prop damage`);assert(!w.s.projectiles[id]);assert(w.drainEvents().some(e=>e.eventType==='EnemyProjectileImpact'&&e.payload.projectileId===id));
 }
});

for(const variant of variants)test(`boss obstacle: ${variant} retains its unobstructed warning, weak window and next attack rhythm`,()=>{
 const {w,boss}=make(variant,24,20);Object.assign(w.s.buildings.core,{x:24,y:w.ground(24,24),z:24});boss.lastChain={base:'charge',auditor:'audit_cone',overload:'power_burst'}[variant];tick(w,boss);
 const firstStart=w.s.time,firstKind=boss.attackKind,m=BOSS_MOVES[firstKind],warning=boss.attackTimeline.windup,weak=m.weak*1.25,active=m.active,recovery=m.recovery*1.25;
 assert.equal(boss.state,'WINDUP');assert.equal(boss.attackKind,{base:'slam',auditor:'stamp_marks',overload:'overload_ring'}[variant]);assert.equal(boss.phaseRemaining,warning);
 let firstWeak=null,nextWindup=null;
 for(let i=0;i<600;i++){
  tick(w,boss);
  if(boss.state==='WEAK'&&firstWeak===null){firstWeak=w.s.time;assert.equal(boss.phaseRemaining,weak);}
  if(boss.state==='WINDUP'&&boss.attackIndex===2){nextWindup=w.s.time;break;}
 }
 assert(firstWeak!==null);assert(Math.abs(firstWeak-firstStart-warning-active-recovery)<=.076,'committed preparation, attack or recovery duration changed');assert(nextWindup!==null);assert(Math.abs(nextWindup-firstWeak-weak)<=.076,'weak window was skipped or artificially prolonged');
 assert.notEqual(boss.attackKind,firstKind,'next chain repeated the same opener');
});
