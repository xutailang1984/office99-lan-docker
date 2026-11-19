import test from 'node:test';
import assert from 'node:assert/strict';
import {SurvivalWorld} from '../world.mjs';
import {bossHitProfile} from '../night-content.mjs';
import {base,fixture,enemy,command,advance,put} from './director-helpers.mjs';
const tick=(w,e,seconds)=>{for(let t=0;t<seconds;t+=1/30){w.s.time+=1/30;w.updateEnemy(e,1/30);w.resolveDamage();}};

test('free park: walk to naturally spawned crab, take a real slam, shoot its exposed back, then weak window closes outside arena',()=>{
 const w=new SurvivalWorld(structuredClone(base),null,{onlineRoster:true,mode:'mission',missionStart:'free'}),p=w.allocate('Synthetic combat visitor','account:synthetic-combat-visitor');
 w.s.mission.park.bossCursor=4;assert(command(w,p,'MissionControl',{action:'boss'}).ok);p.joinProtectionUntil=0;advance(w,.1);
 const e=w.s.enemies[w.s.mission.park.bossId];assert(e&&e.definitionId==='boss_crab');assert.equal(e.night,false);
 for(let i=0;i<240&&e.state!=='WINDUP';i++){
  const dx=e.x-p.x,dz=e.z-p.z,d=Math.hypot(dx,dz);
  advance(w,1/30,{dx:d>2.5?dx/d:0,dz:d>2.5?dz/d:0,yaw:Math.atan2(-dx,-dz)});
 }
 assert.equal(e.state,'WINDUP','walk-up player must acquire aggro without firing');
 const hp=p.hp;for(let i=0;i<300&&e.state!=='WEAK';i++)advance(w,1/30);assert.equal(e.state,'WEAK');assert(p.hp<hp,'standing in the actual slam must take damage');
 const strike=w.drainEvents().find(event=>event.eventType==='EnemyAttackResolved'&&event.entityId===e.id&&event.payload.attackKind==='slam');
 assert.equal(strike?.payload.attackKind,'slam');assert(strike.payload.attackActionSeq>=1);assert.equal(strike.payload.zone.radius,w.defs.creatures.boss_crab.slam_radius);
 const v={x:-Math.sin(e.yaw),z:-Math.cos(e.yaw)};
 put(p,w,e.x+v.x*2.2,e.z+v.z*2.2);assert.equal(bossHitProfile(w,e,p).weak,false);
 put(p,w,e.x-v.x*2.2,e.z-v.z*2.2);assert.equal(bossHitProfile(w,e,p).weak,true);
 p.heldSlot='weapon';p.equipUntil=0;p.fireAt=0;
 const target={x:e.x,y:e.y+1,z:e.z},dy=target.y-(p.y+w.c.player.camera_height),d=Math.hypot(e.x-p.x,e.z-p.z);
 assert(command(w,p,'Fire',{yaw:Math.atan2(-(e.x-p.x),-(e.z-p.z)),pitch:Math.atan2(dy,d),ads:true}).ok);
 w.resolveDamage();assert(w.drainEvents().some(event=>event.eventType==='Hit'&&event.payload.targetId===e.id&&event.payload.weak),'back shot must receive weak damage');assert.equal(e.lastHitWeak,true,'snapshot must retain weak hit feedback');
 put(p,w,0,20);advance(w,7);assert.equal(e.weak,false);assert.notEqual(e.state,'WEAK');assert.equal(w.s.buildings.core.hp,w.s.buildings.core.maxHp);
 w.assertInvariants();
});

test('missing aggro radius falls back to a finite range for old crab definitions',()=>{
 const {w,p}=fixture();const e=enemy(w,p,'boss_crab');delete w.defs.creatures.boss_crab.aggro_range;
 assert.equal(w.selectEnemyTarget(e)?.id,p.id);assert(Number.isFinite(w.aggro.range(e,w.enemyDefinition(e))));
});

test('crab weak recovery survives returning home after a charge',()=>{
 const {w,p}=fixture();w.s.enemies={};const e=enemy(w,p,'boss_crab',{x:0,z:-2});
 e.state='WEAK';e.weak=true;e.phaseRemaining=.3;e.x+=6;
 put(p,w,60,0);tick(w,e,.5);
 assert.equal(e.weak,false);assert.notEqual(e.state,'WEAK');
});

for(const id of ['crab','courier','shield_bug','jammer','medic_bug','breaker','spore_slug','bubble_puffer','lantern_fish','paper_drone','stamp_bat','archive_guard','broadcast_cart','paper_lobber','eraser_cart','battery_mite'])test(`${id}: actual attack emits one sequenced cue with a locked zone`,()=>{
 const {w,p}=fixture();w.s.enemies={};const e=enemy(w,p,id,{x:0,z:-1.4});e.hp=e.maxHp=500;p.hp=1000;
 // Keep the target valid while the role performs its own decision, wind-up and strike.
 for(let i=0;i<300&&(e.attackActionSeq??0)===0;i++){w.s.time+=1/30;w.updateEnemy(e,1/30);w.resolveDamage();}
 const events=w.drainEvents().filter(event=>event.eventType==='EnemyAttackResolved'&&event.entityId===e.id);
 assert.equal(events.length,1,`${id} failed to produce one strike`);assert.equal(events[0].payload.attackActionSeq,1);
 assert.equal(events[0].payload.definitionId,id);assert(events[0].payload.zone);assert(Number.isFinite(events[0].payload.zone.x));
 assert.equal(e.attackActionKind,events[0].payload.attackKind);
 const saved=new SurvivalWorld(w.c,w.serialize(),{onlineRoster:true});assert.equal(saved.s.enemies[e.id].attackActionSeq,1);
});

test('light bullets cannot reset a charger forever; heavy impulses and low-risk catches retain stopping feedback',()=>{
 const {w,p}=fixture();w.s.enemies={};const e=enemy(w,p,'courier');e.state='WINDUP';e.phaseRemaining=.5;
 const hit={actorId:p.id,weaponId:'carbine',damage:1,actualDamage:1,shotId:'shot-a'};
 w.reactToHit(e,hit,{x:0,z:1});assert.equal(e.state,'RECOVER');assert(e.interruptResistUntil>w.s.time);
 e.state='WINDUP';e.hitVelocity={x:0,z:.2};w.s.time+=.1;
 w.reactToHit(e,{...hit,shotId:'shot-b'},{x:0,z:1});assert.equal(e.state,'WINDUP');assert.equal(e.hitVelocity.z,.2,'light bullet impulse was refreshed too soon');
 w.reactToHit(e,{...hit,weaponId:'shotgun',shotId:'shot-c'},{x:0,z:1});assert(e.hitVelocity.z>1,'shotgun retains its stop');
 e.source='fishing';w.reactToHit(e,{...hit,shotId:'shot-d'},{x:1,z:0});assert(e.hitVelocity.x>0,'catch keeps low-risk pushback');
});

test('close electric eel stops retreating and fires instead of backing away forever',()=>{
 const {w,p}=fixture();w.s.enemies={};const e=enemy(w,p,'eel',{x:0,z:-3});tick(w,e,4);
 assert((e.attackActionSeq??0)>0);assert(w.drainEvents().some(event=>event.eventType==='EnemyAttackResolved'&&event.payload.attackKind==='projectile'));
});

for(const id of ['shield_bug','bubble_puffer','lantern_fish','courier','spore_slug'])test(`${id}: strike zone follows actual resolution after knockback, locked landing stays put`,()=>{
 const {w,p}=fixture();w.s.enemies={};const e=enemy(w,p,id,{x:0,z:-1.4});e.hp=e.maxHp=500;p.hp=1000;
 for(let i=0;i<120&&e.state!=='WINDUP';i++){w.s.time+=1/30;w.updateEnemy(e,1/30);}
 assert.equal(e.state,'WINDUP');const locked=structuredClone(e.attackZone),kind=e.attackKind;
 e.x+=.4;e.phaseRemaining=0;e.hitStunRemaining=0;e.hitVelocity={x:0,z:0};
 w.updateEnemy(e,1/30);
 const cue=w.drainEvents().find(event=>event.eventType==='EnemyAttackResolved'&&event.entityId===e.id);
 assert(cue);assert.equal(cue.payload.zone.x,kind==='puddle'?locked.x:e.x);
 assert.equal(cue.payload.zone.z,kind==='puddle'?locked.z:e.z);
 assert.equal(locked.x,e.attackZone?.x??locked.x,'warning data is never mutated by presentation');
});
