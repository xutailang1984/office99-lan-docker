import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,command,advance,enemy,put,restored} from './director-helpers.mjs';
const day=n=>{const result=fixture(n);result.w.setPhase('DAY');result.w.s.director.objective=null;result.w.s.director.optionalObjective=null;return result;};
function hit(w,p,e,damage=5){w.damageQueue.push({actorId:p.id,target:e.id,damage,weaponId:'carbine',direction:{x:0,y:0,z:-1}});w.resolveDamage();}
test('courier publishes full windup then moves and damages once; a real hit interrupts dash',()=>{
  const {w,p}=day();const e=enemy(w,p,'courier',{x:0,z:-5});advance(w,.1);assert.equal(e.state,'WINDUP');assert.equal(e.attackKind,'dash');assert.equal(e.attackZone.shape,'line');assert.equal(p.hp,100);advance(w,.8);assert.equal(p.hp,100);advance(w,.7);assert.equal(p.hp,91);assert(e.z>20);const current=p.hp;advance(w,.25);assert.equal(p.hp,current);e.state='WINDUP';e.phaseRemaining=1;hit(w,p,e);assert.equal(e.state,'RECOVER');assert.equal(e.attackZone,null);assert(w.drainEvents().some(x=>x.eventType==='EnemyInterrupted'));
});
test('shield applies directional reduction, side/back take full damage and Hit identifies shield',()=>{
  const {w,p}=day();const e=enemy(w,p,'shield_bug',{x:0,z:3});e.yaw=0;hit(w,p,e,20);assert.equal(e.hp,74);assert(w.drainEvents().some(x=>x.eventType==='Hit'&&x.payload.shielded));put(p,w,e.x,e.z+2);hit(w,p,e,20);assert.equal(e.hp,54);
});
test('jammer real projectile damages and slows; a wall intercepts the projectile',()=>{
  for(const wall of [false,true]){const {w,p}=day();const e=enemy(w,p,'jammer',{x:0,z:-5});advance(w,.1);assert.equal(e.attackKind,'slow_bolt');assert.equal(e.attackZone.shape,'line');if(wall)w.s.buildings.fixture={id:'fixture',definitionId:'wall',x:p.x,y:p.y,z:p.z-2,yaw:0,hp:400,maxHp:400,level:1,revision:1};advance(w,1.9);if(wall){assert.equal(p.hp,100);assert.equal(p.slowUntil,undefined);assert(w.s.buildings.fixture.hp<400);}else{assert.equal(p.hp,94);assert(p.slowUntil>w.s.time);assert(w.director.moveFactor(p)<1);}assert.equal(Object.keys(w.s.projectiles).length,0);}
});
test('medic heals another ordinary enemy, clamps HP and is interruptible without self or boss healing',()=>{
  const {w,p}=day();put(p,w,40,40);const med=enemy(w,p,'medic_bug',{x:-10,z:0}),friend=enemy(w,p,'crab',{x:-10,z:2});friend.hp=friend.maxHp-3;friend.state='STUNNED';friend.phaseRemaining=100;advance(w,.1);assert.equal(med.attackKind,'heal');assert.equal(med.targetId,friend.id);advance(w,1.3);assert.equal(friend.hp,friend.maxHp);const event=w.drainEvents().find(x=>x.eventType==='EnemyHeal');assert.equal(event.payload.amount,3);friend.hp-=10;med.healAt=0;med.state='CHASE';advance(w,.1);hit(w,p,med);assert.equal(med.state,'RECOVER');advance(w,1.3);assert.equal(friend.hp,friend.maxHp-10);
});
test('breaker telegraphs then inflicts building-specific damage rather than boosted player damage',()=>{
  const {w,p}=day();put(p,w,50,50);const wall={id:'fixture',definitionId:'wall',x:24,y:w.ground(24,24),z:24,yaw:0,hp:400,maxHp:400,level:1,revision:1};w.s.buildings[wall.id]=wall;const e=w.spawnEnemy('breaker',24,22,true);advance(w,.1);assert.equal(e.attackKind,'breach');assert.equal(e.targetId,wall.id);advance(w,1.4);assert.equal(wall.hp,376);
  delete w.s.buildings.fixture;put(p,w,e.x,e.z+1);e.state='CHASE';advance(w,.1);advance(w,1.4);assert.equal(p.hp,92);
});
test('spore windup marks locked ground, applies damage and an expiring bounded slow zone',()=>{
  const {w,p}=day();const e=enemy(w,p,'spore_slug',{x:0,z:-3});advance(w,.1);assert.equal(e.attackKind,'puddle');assert.equal(e.attackZone.x,p.x);assert.equal(e.attackZone.z,p.z);assert.equal(p.hp,100);advance(w,1.2);assert.equal(p.hp,93);const zone=w.s.director.deployables[0];assert.equal(zone.kind,'slow');assert(p.slowUntil>w.s.time);for(let i=0;i<30;i++)w.director.addZone(e,p);assert.equal(w.s.director.deployables.length,8);delete w.s.enemies[e.id];advance(w,4.1);assert.equal(w.s.director.deployables.length,0);advance(w,.4);assert.equal(w.director.moveFactor(p),1);
});
test('fishing puffer pushes through authoritative collision and lantern applies small damaging pulse',()=>{
  for(const id of ['bubble_puffer','lantern_fish']){const {w,p}=day();const e=enemy(w,p,id,{x:0,z:-1.5});e.source='fishing';e.ownerId=p.id;const before=p.z;advance(w,.1);assert.equal(e.attackKind,id==='bubble_puffer'?'inflate':'pulse');advance(w,1.2);assert.equal(p.hp,97);if(id==='bubble_puffer')assert(p.z>before);else assert(p.slowUntil>w.s.time);}
});
test('auditor cone hits only the telegraphed sector, then grants weak window without spawning another boss',()=>{
  const {w,p,ps}=day(2);put(ps[1],w,31,19);const boss=enemy(w,p,'boss_crab',{x:0,z:-2.5});boss.night=true;boss.variantId='auditor';boss.lastChain='stamp_marks';advance(w,.1);assert.equal(boss.state,'WINDUP');assert.equal(boss.attackZone.shape,'cone');const yaw=boss.attackZone.yaw;assert(Number.isFinite(yaw));advance(w,1.5);assert.equal(p.hp,80);assert.equal(ps[1].hp,100);assert.equal(boss.state,'RECOVER');assert.equal(boss.weak,false,'light swipe alone must not open armour');assert.equal(boss.attackZone,null);assert.equal(Object.values(w.s.enemies).filter(e=>e.definitionId==='boss_crab').length,1);
});
test('overload ring preserves close safe pocket and a correctly timed real jump avoids outer shock',()=>{
  const {w,p,ps}=day(3);const boss=enemy(w,p,'boss_crab',{x:0,z:-1.5});boss.night=true;boss.variantId='overload';boss.lastChain='power_burst';put(ps[1],w,boss.x+4,boss.z);put(ps[2],w,boss.x-4,boss.z);advance(w,.1);assert.equal(boss.attackZone.shape,'ring');advance(w,boss.phaseRemaining);advance(w,.35,q=>({jump:q.id===ps[2].id}));assert.equal(p.hp,100);assert.equal(ps[1].hp,78);assert.equal(ps[2].hp,100);assert(ps[2].y>w.ground(ps[2].x,ps[2].z)+.45);assert.equal(boss.state,'ATTACK');
});
test('boss variants keep one ledger-backed reward and half-health adds retain pending cap semantics',()=>{
  const {w,p}=day(8);w.startNight();const boss=w.s.enemies[w.s.night.bossId];boss.variantId='overload';boss.hp=boss.maxHp*.5;boss.state='RECOVER';boss.phaseRemaining=0;const count=w.s.night.pending.length;w.updateBoss(boss,.1);assert.equal(w.s.night.pending.length,count+16);boss.state='RECOVER';boss.phaseRemaining=0;w.updateBoss(boss,.1);assert.equal(w.s.night.pending.length,count+16);w.killEnemy(boss,p.id);const box=w.s.night.rewardContainerId,items=Object.keys(w.s.items).length;w.killEnemy(boss,p.id);assert.equal(w.s.night.rewardContainerId,box);assert.equal(Object.keys(w.s.items).length,items);assert(w.s.night.rewardClaimed);assert(w.s.night.bossDefeated);const save=restored(w);assert(save.s.night.rewardClaimed);assert.equal(save.s.night.aliveCap,18);
});
