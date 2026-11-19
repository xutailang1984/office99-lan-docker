// In-memory synthetic worlds only. No production accounts, services or saves.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../config.mjs';
import {SurvivalWorld} from '../world.mjs';
import {updateNightContent,recordNightContentHit} from '../night-content.mjs';
import {prepareDirectedDamage} from '../director-combat.mjs';
import {REGION_PATTERNS,NIGHT_SEQUENCES,nightSegment} from '../encounter-variety.mjs';
import {nightEncounterBudget,dayEncounterBudget} from '../expedition-config.mjs';
const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
function fixture(id='boss_shredder',phase2=true){
 const w=new SurvivalWorld(config,null,{onlineRoster:true}),p=w.allocate('Synthetic variety','synthetic-variety-only');w.connect(p,p.name);w.setPhase('DAY');w.s.enemies={};w.s.destructibles={};
 Object.assign(p,{x:50,z:50,y:w.ground(50,50),joinProtectionUntil:0});Object.assign(w.s.buildings.core,{x:24,z:25,y:w.ground(24,25),hp:10000,maxHp:10000});
 const e=w.spawnEnemy(id,24,20,true);e.source='night';if(phase2)e.hp=e.maxHp*.49;w.drainEvents();return {w,e,p};
}
function tick(w,e,dt=.025){w.s.time+=dt;w.s.tick++;updateNightContent(w.director,e,dt);w.resolveDamage();}
function toWeak(w,e){const warnings=[];for(let i=0;i<1000;i++){tick(w,e);for(const event of w.drainEvents())if(event.eventType==='EnemyAttackWarning')warnings.push(event.payload);if(e.state==='WEAK')return warnings;}assert.fail('finite combo did not finish');}
function put(w,p,x,z){Object.assign(p,{x,z,y:w.ground(x,z),joinProtectionUntil:0});}
for(const [id,kinds]of [['boss_shredder',['shredder_advance','shredder_fan']],['boss_printer',['printer_wave','printer_shift','printer_wave']],['boss_coffee_boiler',['coffee_line','coffee_ring','coffee_boil']]])test(`${id}: half-health changes decisions with a bounded fully warned combo`,()=>{
 const {w,e}=fixture(id);const warnings=toWeak(w,e);assert.deepEqual(warnings.map(p=>p.attackKind),kinds);for(const v of warnings)assert(v.zone.endsAt>0);assert(e.phaseRemaining>=4);assert(e.attackActionSeq>=2);assert(Object.values(w.s.enemies).length===1);assert(w.s.director.deployables.length<=8);
 const normal=fixture(id,false);assert.equal(toWeak(normal.w,normal.e).length,1);
});
test('printer combo restores its locked warning and continuation without re-aiming',()=>{
 const {w,e}=fixture('boss_printer');tick(w,e);const next=new SurvivalWorld(w.c,w.serialize(),{onlineRoster:true}),copy=next.s.enemies[e.id];assert.deepEqual(copy.attackZone,e.attackZone);assert.equal(copy.comboNext,'printer_shift');
 w.drainEvents();next.drainEvents();const one=toWeak(w,e),two=toWeak(next,copy);assert.deepEqual(two.map(p=>p.attackKind),one.map(p=>p.attackKind));assert.equal(copy.state,'WEAK');assert.equal(copy.attackActionSeq,e.attackActionSeq);
});
test('half-health crossing cannot rewrite an already committed first-stage warning',()=>{
 const {w,e}=fixture('boss_printer',false);tick(w,e);const zone=structuredClone(e.attackZone);e.hp=e.maxHp*.49;tick(w,e);assert.deepEqual(e.attackZone,zone);assert.equal(e.comboNext,null);w.drainEvents();assert.equal(toWeak(w,e).length,0);
});
test('stamp final overtime strike checks both locked positions once per target',()=>{
 const {w,e,p}=fixture('boss_stamp_press');w.s.buildings.core.x=40;put(w,p,24,24);w.aggro.damage(e,p,30);
 tick(w,e);while(e.state==='WINDUP')tick(w,e);put(w,p,27,24);tick(w,e);while(e.state==='WINDUP')tick(w,e);put(w,p,24,24);tick(w,e);
 assert.equal(e.attackZone.points.length,2);const locked=structuredClone(e.attackZone);const copy=new SurvivalWorld(w.c,w.serialize(),{onlineRoster:true});assert.deepEqual(copy.s.enemies[e.id].attackZone,locked);
 const hp=p.hp;while(e.state==='WINDUP')tick(w,e);assert.equal(hp-p.hp,config.director.nightContent.stamp.damage);assert.equal(e.state,'WEAK');
});
test('coffee valve counter clears only its own finite spill and never refills or stuns boss',()=>{
 const {w,e}=fixture('boss_coffee_boiler');toWeak(w,e);const own=w.s.director.deployables.filter(q=>q.ownerId===e.id);assert.equal(own.length,2);assert(own.every(q=>q.expiresAt>w.s.time));
 const unrelated={...own[0],id:'other-owner-zone',ownerId:'other-enemy'};w.s.director.deployables.push(unrelated);const hp=e.hp;
 recordNightContentHit(w,e,{weak:false,actualDamage:100});assert(own.every(q=>q.expiresAt>w.s.time));recordNightContentHit(w,e,{weak:true,actualDamage:45});assert(own.every(q=>q.expiresAt===w.s.time));assert(unrelated.expiresAt>w.s.time);assert.equal(e.hp,hp);assert.equal(e.state,'WEAK');
});
test('boss and sequence histories prevent immediate repeats and survive save/load',()=>{
 const {w}=fixture();const seen=new Set(),bosses=[];let previousSequence=null;
 for(let i=0;i<16;i++){w.startNight();const plan=w.s.director.nightPlan,id=plan.bossDefinitionId??'boss_crab';if(i<12)assert(!seen.has(plan.id));seen.add(plan.id);if(bosses.length)assert.notEqual(id,bosses.at(-1));bosses.push(id);assert.notEqual(w.s.night.sequenceId,previousSequence);previousSequence=w.s.night.sequenceId;}
 assert.equal(new Set(bosses.slice(0,5)).size,5);const next=new SurvivalWorld(w.c,w.serialize(),{onlineRoster:true});assert.deepEqual(next.s.director.bossHistory,w.s.director.bossHistory);assert.deepEqual(next.s.night.pending,w.s.night.pending);
});
test('all temporal sequences preserve finite role slots, caps, and prevent premature dawn',()=>{
 for(const n of [1,2,4,8]){const {w,p}=fixture();for(let i=1;i<n;i++){const q=w.allocate('Synthetic teammate',`variety-${i}`);w.connect(q,q.name);}w.startNight();assert.equal(w.s.night.aliveCap,nightEncounterBudget(n).aliveCap);
  assert(w.s.night.pending.length>0);assert(w.s.night.pending.every(q=>q.at>=0&&q.at<120&&q.segment>=0&&q.segment<=2));assert.equal(w.s.night.segments.length,3);assert.deepEqual([...new Set(w.s.night.pending.map(q=>q.at))],w.s.night.segments.map(q=>q.at));
  assert.equal(nightSegment(w.s.night,0),0);assert.equal(nightSegment(w.s.night,119),2);const boss=w.s.enemies[w.s.night.bossId];w.killEnemy(boss,p.id);w.resolveNight();assert.equal(w.s.phase,'NIGHT');assert(!w.s.night.resolved);
 }
 assert.equal(NIGHT_SEQUENCES.length,3);
});
test('regions establish readable pairs and next-day variants without increasing stocks',()=>{
 const {w}=fixture();for(const n of [1,2,4,8]){w.s.lockedPlayerCount=n;w.s.dayIndex=1;w.generateDay();const patterns=structuredClone(w.s.director.regionPlans);assert.equal(Object.values(w.s.enemies).filter(e=>e.source==='wild').length,dayEncounterBudget(n).guards);assert.equal(Object.values(w.s.destructibles).length,36);
  for(const zone of w.dangerZones()){const enemies=Object.values(w.s.enemies).filter(e=>e.zoneId===zone.id);assert(enemies.length>=2);assert.deepEqual(enemies.slice(0,2).map(e=>e.definitionId),patterns[zone.id].roles);const event=w.s.exploration.events.find(e=>e.zoneId===zone.id);assert(event);}
  const snapshot=w.serialize(),next=new SurvivalWorld(w.c,snapshot,{onlineRoster:true});assert.deepEqual(next.s.director.regionPlans,patterns);w.s.dayIndex++;w.generateDay();for(const id of Object.keys(REGION_PATTERNS))assert.notEqual(w.s.director.regionPlans[id].id,patterns[id].id);
 }
});
for(const [id,shape]of [['clip_crab','cone'],['receipt_ray','line'],['staple_squid','marks'],['seal_puffer','ring']])test(`${id}: unique fish warning geometry and dodging match actual damage`,()=>{
 const {w,e,p}=fixture(id,false);e.night=false;e.source='fishing';put(w,p,24,21);w.aggro.damage(e,p,20);w.exploration.fishUpdate(e,.025);assert.equal(e.attackZone.shape,shape);const locked=structuredClone(e.attackZone),saved=new SurvivalWorld(w.c,w.serialize(),{onlineRoster:true});assert.deepEqual(saved.s.enemies[e.id].attackZone,locked);
 put(w,p,id==='seal_puffer'?24:26,id==='seal_puffer'?20.3:21);const hp=p.hp;for(let i=0;i<80&&e.state==='WINDUP';i++){w.s.time+=.025;w.exploration.fishUpdate(e,.025);w.resolveDamage();}assert.equal(p.hp,hp);assert.equal(e.state,'RECOVER');assert.equal(e.attackActionSeq,1);
});
test('clip guard is temporary and front-facing; flank hits preserve full damage',()=>{
 const {w,e,p}=fixture('clip_crab',false);e.state='WINDUP';e.yaw=0;put(w,p,24,18);w.damageQueue=[{target:e.id,actorId:p.id,damage:10}];prepareDirectedDamage(w.director);assert.equal(w.damageQueue[0].damage,4);put(w,p,26,20);w.damageQueue=[{target:e.id,actorId:p.id,damage:10}];prepareDirectedDamage(w.director);assert.equal(w.damageQueue[0].damage,10);
});
test('movement animation sequence starts at launch and cannot replay at arrival',()=>{
 const {w,e}=fixture('boss_shredder',false);tick(w,e);while(e.state==='WINDUP')tick(w,e);assert.equal(e.state,'CHARGE');assert.equal(e.attackActionSeq,1);const at=e.attackActionAt;while(e.state==='CHARGE')tick(w,e);assert.equal(e.attackActionSeq,1);assert.equal(e.attackActionAt,at);
});
test('legacy save imports previous boss identity without rerolling the current encounter',()=>{
 const {w}=fixture();w.startNight();const id=w.s.director.nightPlan.bossDefinitionId??'boss_crab',saved=w.serialize();delete saved.director.bossHistory;const next=new SurvivalWorld(w.c,saved,{onlineRoster:true});assert.deepEqual(next.s.night.pending,w.s.night.pending);assert.deepEqual(next.s.director.bossHistory,[id]);next.startNight();assert.notEqual(next.s.director.nightPlan.bossDefinitionId??'boss_crab',id);
});
