// Expected-behavior audit probes for the current monster iteration.
// Isolated in-memory synthetic worlds only. No production data or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,enemy,put,restored,base,command} from './director-helpers.mjs';
import {compileState,diffState} from '../state-wire.mjs';
import {ZONE_RISKS} from '../expedition-config.mjs';

const fresh=n=>{const f=fixture(n);f.w.setPhase('DAY');f.w.s.enemies={};f.w.s.projectiles={};f.w.s.director.objective=null;f.w.s.director.optionalObjective=null;return f;};
const strike=(w,p,e,damage=1,extra={})=>{w.damageQueue.push({actorId:p.id,target:e.id,damage,weaponId:'carbine',direction:{x:0,y:0,z:0},...extra});w.resolveDamage();};
const tickEnemy=(w,e,dt)=>{w.s.time+=dt;w.updateEnemy(e,dt);};
const settleBoss=(w,e,seconds)=>{for(let t=0;t<seconds-1e-9;t+=.025){const dt=Math.min(.025,seconds-t);w.s.time+=dt;w.updateBoss(e,dt);w.resolveDamage();}};
const makeStamp=()=>{
 const f=fresh(3),{w,p,ps}=f;put(p,w,24,24);put(ps[1],w,26.7,24);put(ps[2],w,20,24);
 const e=enemy(w,p,'boss_crab',{x:0,z:-4});e.night=true;e.variantId='auditor';e.attackIndex=1;e.combatPreset='complete';e.lastChain='audit_cone/stamp_marks';
 const wall={id:'synthetic-stamp-target',definitionId:'wall',x:22,y:w.ground(22,18),z:18,yaw:0,hp:400,maxHp:400,level:1,revision:1};w.s.buildings[wall.id]=wall;
 assert.equal(w.aggro.strategic(e).id,wall.id,'fixture strategic wall');w.aggro.damage(e,p,5);w.updateBoss(e,.01);
 assert.equal(e.attackKind,'stamp_marks');assert.equal(e.attackZone.shape,'marks');return {...f,e,wall};
};

test('audit: new species add hierarchy and movement metadata without deleting existing species',()=>{
 const definitions=Object.fromEntries(base.creatures.map(e=>[e.id,e]));
 for(const id of ['silverfish','crab','eel','boss_crab','courier','shield_bug','jammer','medic_bug','breaker','spore_slug','bubble_puffer','lantern_fish','paper_drone','stamp_bat','archive_guard'])assert(definitions[id],id);
 for(const e of Object.values(definitions))for(const key of ['tier','locomotion','rangeClass'])assert.equal(typeof e[key],'string',`${e.id}.${key}`);
 assert.equal(definitions.paper_drone.tier,definitions.crab.tier);
 assert.equal(definitions.stamp_bat.tier,definitions.crab.tier);
 assert.equal(definitions.archive_guard.tier,definitions.shield_bug.tier);
 assert.notEqual(definitions.archive_guard.tier,definitions.crab.tier);
 assert.notEqual(definitions.boss_crab.tier,definitions.archive_guard.tier);
 for(const id of ['paper_drone','stamp_bat'])assert.equal(definitions[id].locomotion,'air');
 assert.equal(definitions.archive_guard.locomotion,'ground');
 assert.equal(definitions.paper_drone.rangeClass,'ranged');
 assert.equal(definitions.stamp_bat.rangeClass,'melee');
 assert.equal(definitions.archive_guard.rangeClass,'ranged');
});

test('audit: one two four eight player counts use finite day budgets and locked night pressure',()=>{
 for(const [n,hp,cap,guards]of [[1,600,5,6],[2,990,8,10],[4,1740,12,16],[8,3120,18,24]]){
  const {w}=fresh(n);w.s.lockedPlayerCount=n;w.generateDay();assert.equal(Object.keys(w.s.enemies).length,guards);
  w.startNight();assert.equal(w.s.night.aliveCap,cap);const boss=w.s.enemies[w.s.night.bossId];assert.equal(boss.maxHp,hp);assert.equal(Object.values(w.s.enemies).filter(e=>e.tier==='boss').length,1);
  if(n<8){const p=w.allocate('Synthetic late join',`monster-audit-late-${n}`);w.connect(p,p.name);assert.equal(boss.maxHp,hp);assert.equal(w.s.night.playerCount,n);assert.equal(w.s.night.aliveCap,cap);}
 }
});

test('audit: every regional role including all three new species participates in bounded day population',()=>{
 const {w}=fresh(8),seen=new Map(ZONE_RISKS.map(z=>[z.id,new Set()]));w.s.lockedPlayerCount=8;
 for(let run=0;run<8;run++){w.s.dayIndex=run+1;w.generateDay();assert.equal(Object.keys(w.s.enemies).length,24);for(const e of Object.values(w.s.enemies))seen.get(e.zoneId).add(e.definitionId);}
 for(const zone of ZONE_RISKS){for(const id of zone.roles)assert(seen.get(zone.id).has(id),`${id} never entered ${zone.id} day pool`);for(const id of seen.get(zone.id))assert(zone.roles.includes(id),`${id} escaped its regional pool`);}
 for(const id of ['paper_drone','stamp_bat','archive_guard','medic_bug'])assert([...seen.values()].some(ids=>ids.has(id)),`${id} never entered day pool`);
});

test('audit: low flyers retain authoritative altitude during hit reaction and drop loot on ground',()=>{
 for(const id of ['paper_drone','stamp_bat']){
  const {w,p}=fresh(),e=enemy(w,p,id);const altitude=e.y-w.ground(e.x,e.z);assert(altitude>.8&&altitude<1.6,`${id} altitude ${altitude}`);
  e.state='STUNNED';e.phaseRemaining=10;strike(w,p,e,1);tickEnemy(w,e,.1);
  assert(Math.abs((e.y-w.ground(e.x,e.z))-altitude)<.05,`${id} hit fell to ground`);
  w.killEnemy(e,p.id);const bag=Object.values(w.s.containers).find(c=>c.source==='wild');assert(bag,'wild drop');assert(Math.abs(bag.y-w.ground(bag.x,bag.z))<.03,'hovering loot');
 }
});

test('audit: every new species restores HP and current attack metadata without economic changes',()=>{
 for(const id of ['paper_drone','stamp_bat','archive_guard']){
  const {w,p}=fresh(),e=enemy(w,p,id);e.hp-=3;w.updateEnemy(e,.01);const expected={hp:e.hp,maxHp:e.maxHp,state:e.state,phaseRemaining:e.phaseRemaining,attackKind:e.attackKind,attackZone:structuredClone(e.attackZone)};
  const bank=structuredClone(w.s.bank),next=restored(w),saved=next.s.enemies[e.id];assert(saved);for(const[key,value]of Object.entries(expected))assert.deepEqual(saved[key],value,`${id}.${key}`);assert.deepEqual(next.s.bank,bank);
 }
});

test('audit: all boss forms preserve an in-progress windup and its target through save',()=>{
 for(const variantId of ['base','auditor','overload']){
  const {w,p}=fresh(),e=enemy(w,p,'boss_crab',{x:0,z:-2.5});e.night=true;e.variantId=variantId;w.updateBoss(e,.01);assert.equal(e.state,'WINDUP');
  const expected=structuredClone(e),next=restored(w),saved=next.s.enemies[e.id];for(const key of ['hp','state','phaseRemaining','attackKind','attackZone','yaw','targetId','attackIndex'])assert.deepEqual(saved[key],expected[key],`${variantId}.${key}`);
 }
});

test('audit: full and incremental snapshots retain flight positions and tier changes',()=>{
 const {w,p}=fresh(),e=enemy(w,p,'paper_drone');const before=compileState(w.publicState());e.x+=.25;e.hp-=1;e.revision++;const after=compileState(w.publicState()),delta=diffState(before,after).delta;
 const change=delta.entities.enemies.patch.find(x=>x.id===e.id);assert(change);assert.equal(change.set.x,Math.round(e.x*1000)/1000);assert.equal(change.set.hp,e.hp);
 const view=after.state.enemies.find(x=>x.id===e.id);assert.equal(view.y,Math.round(e.y*1000)/1000);for(const key of ['tier','locomotion','rangeClass'])assert.equal(view[key],e[key]);
});

test('audit: base boss slam respects a blocking wall',()=>{
 const {w,p}=fresh(),e=enemy(w,p,'boss_crab',{x:0,z:-3});e.night=true;e.variantId='base';e.state='WINDUP';e.attackKind='slam';e.phaseRemaining=0;
 w.s.buildings['synthetic-cover']={id:'synthetic-cover',definitionId:'wall',x:p.x,y:p.y,z:p.z-1.5,yaw:0,hp:400,maxHp:400,level:1,revision:1};assert.equal(w.lineVisible(e,p),false);
 w.updateBoss(e,.01);w.resolveDamage();assert.equal(p.hp,100,'slam penetrated intact wall');
});

test('audit: base boss does not start an ineffective four-meter slam at seven meters',()=>{
 const {w,p}=fresh(),e=enemy(w,p,'boss_crab',{x:0,z:-7});e.night=true;e.variantId='base';w.aggro.damage(e,p,1);w.updateBoss(e,.01);
 assert(!(e.state==='WINDUP'&&e.attackKind==='slam'),'empty slam started beyond its effective reach');
});

test('audit: windup warning and authoritative hit timing remain consistent after flinch',()=>{
 const {w,p}=fresh(),e=enemy(w,p,'jammer',{x:0,z:-5});w.updateEnemy(e,.01);assert.equal(e.state,'WINDUP');assert(e.attackZone);strike(w,p,e,1);tickEnemy(w,e,.1);
 if(e.state==='WINDUP')assert(Math.abs(e.attackZone.endsAt-w.s.time-e.phaseRemaining)<.04,'warning clock expires before actual attack');
});

test('audit: new ranged attacks never transiently exceed sixty-four projectile slots',()=>{
 for(const [id,variantId]of [['archive_guard',null],['paper_drone',null],['boss_crab','overload']]){
  const {w,p}=fresh(),e=enemy(w,p,id,{x:0,z:-5});if(variantId){e.night=true;e.variantId=variantId;}
  for(let i=0;i<63;i++){const id=`synthetic-limit-${i}`;w.s.projectiles[id]={id,x:90,y:30,z:90,vx:0,vy:0,vz:1,radius:.1,damage:1,actorId:e.id,life:5};}
  for(let i=0;i<14;i++){tickEnemy(w,e,.5);assert(Object.keys(w.s.projectiles).length<=64,`${id} exceeded the cap at attack creation`);}
 }
});

test('audit: elite stagger requires damage accumulation, then grants four seconds resistance',()=>{
 const {w,p}=fresh(),e=enemy(w,p,'archive_guard',{x:0,z:-5});w.updateEnemy(e,.01);assert.equal(e.state,'WINDUP');
 strike(w,p,e,5);assert.equal(e.state,'WINDUP','small hit prematurely cancelled elite');
 strike(w,p,e,18);assert.notEqual(e.state,'WINDUP','23 actual damage failed to break 110HP elite');
 e.state='WINDUP';e.phaseRemaining=1.3;w.s.time+=1;strike(w,p,e,23);assert.equal(e.state,'WINDUP','elite can be stun locked during resistance');
});

test('audit: a boss hit produces feedback while retaining the already committed attack',()=>{
 for(const variantId of ['base','auditor','overload']){
  const {w,p}=fresh(),e=enemy(w,p,'boss_crab',{x:0,z:-3});e.night=true;e.variantId=variantId;w.updateBoss(e,.01);const old={state:e.state,phase:e.phaseRemaining,yaw:e.yaw,attackKind:e.attackKind};strike(w,p,e,50);
  assert.equal(e.state,old.state);assert.equal(e.phaseRemaining,old.phase);assert.equal(e.yaw,old.yaw);assert.equal(e.attackKind,old.attackKind);assert(e.hitSeq>0);assert.equal(e.hitStunRemaining??0,0);
 }
});

test('audit: auditor marks the strategic fortress blocker despite player damage aggro',()=>{
 const {w,p,ps,e,wall}=makeStamp();assert.equal(e.targetId,p.id,'fixture must first admit player retaliation');
 assert.deepEqual(e.attackZone.points[0],{x:wall.x,y:w.ground(wall.x,wall.z),z:wall.z},'first mark omitted fortress target');
 assert.equal(e.attackZone.points.length,3);const points=structuredClone(e.attackZone.points),yaw=e.yaw;
 put(ps[1],w,35,30);strike(w,ps[2],e,50);settleBoss(w,e,.25);
 assert.equal(e.yaw,yaw);assert.deepEqual(e.attackZone.points,points,'committed marks chased a moving/new aggro player');
 settleBoss(w,e,e.phaseRemaining+.05);assert.equal(wall.hp,352);assert.equal(p.hp,82);assert.equal(ps[1].hp,100);assert.equal(ps[2].hp,100);assert.equal(e.state,'ATTACK');
});

test('audit: intersecting locked auditor marks damage one player only once',()=>{
 const {w,p,ps,e}=makeStamp();assert(e.attackZone.points.some(at=>at.x===24&&at.z===24));assert(e.attackZone.points.some(at=>at.x===26.7&&at.z===24));
 put(p,w,25.35,24);put(ps[1],w,35,30);settleBoss(w,e,e.phaseRemaining+.05);assert.equal(p.hp,82,'two overlapping circles doubled damage');
 const hits=w.drainEvents().filter(event=>event.eventType==='Hit'&&event.payload.targetId===p.id&&event.payload.actorId===e.id);assert.equal(hits.length,1);
});

test('audit: auditor committed marks still respect a newly intervening wall',()=>{
 const {w,p,e}=makeStamp();w.s.buildings['synthetic-new-cover']={id:'synthetic-new-cover',definitionId:'wall',x:24,y:w.ground(24,22),z:22,yaw:0,hp:400,maxHp:400,level:1,revision:1};assert(!w.lineVisible(e,p));
 settleBoss(w,e,e.phaseRemaining+.01);assert.equal(p.hp,100);
});

test('audit: overload second attack emits exactly eight finite equally spaced slow projectiles',()=>{
 const {w,p}=fresh(),e=enemy(w,p,'boss_crab',{x:0,z:-4});e.night=true;e.variantId='overload';e.attackIndex=1;e.lastChain='overload_ring';w.aggro.damage(e,p,1);w.updateBoss(e,.01);
 assert.equal(e.attackKind,'power_burst');assert.equal(e.attackZone.presentation,'body');settleBoss(w,e,e.phaseRemaining+.01);
 const bolts=Object.values(w.s.projectiles);assert.equal(bolts.length,8);const angles=bolts.map(b=>Math.atan2(b.vx,b.vz)).sort((a,b)=>a-b);
 for(const b of bolts){assert.equal(b.definitionId,'power_bolt');assert.equal(b.damage,8);assert(Math.abs(Math.hypot(b.vx,b.vy,b.vz)-7)<1e-6);assert.equal(b.vy,0);}
 for(let i=0;i<8;i++){const gap=((angles[(i+1)%8]-angles[i]+Math.PI*2)%(Math.PI*2));assert(Math.abs(gap-Math.PI/4)<1e-6);}
 assert.equal(e.state,'ATTACK');assert(!e.weak);
});

test('audit: overload projectile spokes hit a direct lane while leaving a visible gap safe',()=>{
 const {w,p,ps}=fresh(2),e=enemy(w,p,'boss_crab',{x:0,z:-4});e.night=true;e.variantId='overload';e.attackIndex=1;e.lastChain='overload_ring';w.aggro.damage(e,p,1);
 put(ps[1],w,e.x+Math.sin(Math.PI/8)*4,e.z+Math.cos(Math.PI/8)*4);w.updateBoss(e,.01);settleBoss(w,e,e.phaseRemaining+.01);
 for(let i=0;i<40;i++){w.s.time+=.025;w.updateProjectiles(.025);w.resolveDamage();}
 assert.equal(p.hp,92);assert.equal(ps[1].hp,100);assert(w.drainEvents().some(event=>event.eventType==='EnemyProjectileImpact'&&event.payload.surface==='player'));
});

test('audit: second-phase changes affect the next pattern and preserve a committed warning',()=>{
 for(const variantId of ['base','auditor','overload']){
  const {w,p}=fresh(),e=enemy(w,p,'boss_crab',{x:0,z:-3});e.night=true;e.variantId=variantId;w.updateBoss(e,.01);const before={attackKind:e.attackKind,remaining:e.phaseRemaining,zone:structuredClone(e.attackZone),yaw:e.yaw};
  e.hp=e.maxHp*.49;settleBoss(w,e,.2);assert.equal(e.attackKind,before.attackKind);assert.equal(e.yaw,before.yaw);assert.equal(e.attackZone.endsAt,before.zone.endsAt);assert(Math.abs(e.phaseRemaining-(before.remaining-.2))<1e-6);
  for(let i=0;i<600&&e.combatPhase!==2;i++)settleBoss(w,e,.025);assert.equal(e.combatPhase,2,'next completed pattern must enter the second phase');
 }
});

test('audit: old snapshots missing new combat metadata recover without changing committed HP or timers',()=>{
 for(const id of ['crab','shield_bug','boss_crab']){
  const {w,p}=fresh(),e=enemy(w,p,id,{x:0,z:-3});if(id==='boss_crab'){e.variantId='auditor';e.night=true;}w.updateEnemy(e,.01);e.hp-=4;
  const saved=w.serialize(),expected=structuredClone(saved.enemies[e.id]);for(const key of ['tier','locomotion','rangeClass','combatPhase','poiseDamage','poiseAt','poiseResistUntil'])delete saved.enemies[e.id][key];
  const next=new w.constructor(w.c,saved,{onlineRoster:true}),other=next.s.enemies[e.id];for(const key of ['hp','maxHp','state','phaseRemaining','attackKind','attackZone','yaw'])assert.deepEqual(other[key],expected[key],`${id}.${key}`);
  assert.equal(other.tier,w.defs.creatures[id].tier);assert.equal(other.locomotion,w.defs.creatures[id].locomotion);assert.equal(other.rangeClass,w.defs.creatures[id].rangeClass);
 }
});

test('audit: shield-reduced actual damage controls elite poise, including grouped shotgun pellets',()=>{
 const {w,p}=fresh(),e=enemy(w,p,'shield_bug',{x:0,z:2});e.yaw=0;e.state='WINDUP';e.phaseRemaining=1;
 for(let i=0;i<8;i++)w.damageQueue.push({actorId:p.id,target:e.id,damage:3,weaponId:'shotgun',shotId:'synthetic-one-shot',direction:{x:0,y:0,z:0}});w.resolveDamage();
 assert(Math.abs(e.hp-72.8)<1e-6);assert.equal(e.hitSeq,1,'one shotgun shot was not grouped');assert.equal(e.state,'WINDUP','raw rather than shielded damage broke poise');assert(Math.abs(e.poiseDamage-7.2)<1e-6);
 strike(w,p,e,30);assert.equal(e.state,'WINDUP');strike(w,p,e,6);assert.equal(e.state,'STUNNED');assert.equal(e.phaseRemaining,.55);
});

test('audit: elite poise damage decays after two idle seconds and becomes breakable after resistance',()=>{
 const {w,p}=fresh(),e=enemy(w,p,'archive_guard');e.hp=e.maxHp=200;e.state='WINDUP';e.phaseRemaining=1.3;
 strike(w,p,e,35);assert.equal(e.state,'WINDUP');w.s.time+=2.1;strike(w,p,e,6);assert.equal(e.state,'WINDUP');assert.equal(e.poiseDamage,6);
 strike(w,p,e,35);assert.equal(e.state,'STUNNED');w.s.time+=4.01;e.state='WINDUP';e.phaseRemaining=1.3;strike(w,p,e,40);assert.equal(e.state,'STUNNED');assert.equal(e.phaseRemaining,.55);
});

test('audit: a full projectile budget cannot turn an eel shot into invisible long-range melee',()=>{
 const {w,p}=fresh(),e=enemy(w,p,'eel',{x:0,z:-9});w.updateEnemy(e,.01);assert.equal(e.state,'WINDUP');
 for(let i=0;i<64;i++){const id=`synthetic-full-${i}`;w.s.projectiles[id]={id,x:80,y:30,z:80,vx:1,vy:0,vz:0,radius:.1,damage:1,actorId:e.id,life:4};}
 tickEnemy(w,e,1);w.resolveDamage();assert.equal(Object.keys(w.s.projectiles).length,64);assert.equal(p.hp,100);assert.equal(e.state,'RECOVER');
});

test('audit: new species still give the fortress a route window under uninterrupted incoming damage',()=>{
 for(const id of ['paper_drone','stamp_bat','archive_guard','boss_crab']){
  const {w,p}=fresh(),e=enemy(w,p,id,{x:0,z:-2});e.night=true;e.hp=e.maxHp=10000;let strategicTicks=0;
  for(let i=0;i<48;i++){w.s.time=i*.25;w.aggro.damage(e,p,1);const target=w.selectEnemyTarget(e);if(target&&!target.lifeState){strategicTicks++;assert(w.s.buildings[target.id]||w.s.turrets[target.id]);}}
  assert(strategicTicks>=8,`${id}: continuous fire reset every fortress route window`);
 }
});

test('audit: stamp bat dash stops at a wall and never damages the protected player through it',()=>{
 const {w,p}=fresh(),e=enemy(w,p,'stamp_bat',{x:0,z:-3});w.updateEnemy(e,.01);assert.equal(e.attackKind,'dash');
 const wallZ=e.z+1.5;w.s.buildings['synthetic-dash-cover']={id:'synthetic-dash-cover',definitionId:'wall',x:e.x,y:w.ground(e.x,wallZ),z:wallZ,yaw:0,hp:400,maxHp:400,level:1,revision:1};
 for(let i=0;i<75;i++){tickEnemy(w,e,.025);w.resolveDamage();}
 assert(e.z<wallZ,'flyer crossed a solid wall');assert.equal(p.hp,100);assert.equal(e.state,'RECOVER');
});

test('audit: a freshly landed eel is immediately classified as a low-risk ground melee fish',()=>{
 const {w,p}=fresh();put(p,w,0,99);p.heldSlot='rod';assert(command(w,p,'Cast',{x:0,z:106,power:.7}).ok);p.fishing.creature='eel';p.fishing.state='LAND';p.fishing.remaining=0;
 w.updateFishing(p,.01);const e=Object.values(w.s.enemies).find(e=>e.source==='fishing');assert(e);assert.equal(e.definitionId,'eel');assert.equal(e.hp,32);assert.equal(e.tier,'minion');assert.equal(e.locomotion,'ground');assert.equal(e.rangeClass,'melee');assert.equal(e.y,w.ground(e.x,e.z));assert.equal(w.enemyDefinition(e).damage,3);
 const view=w.publicState().enemies.find(x=>x.id===e.id);assert.equal(view.rangeClass,'melee');
});

test('audit: courier and stamp bat can damage the actual core collider through charge contact',()=>{
 for(const id of ['courier','stamp_bat']){
  const {w,p}=fresh();put(p,w,50,50);for(const b of Object.values(w.s.buildings))if(b.id!=='core')b.hp=0;
  const e=w.spawnEnemy(id,0,-5,true),before=w.s.buildings.core.hp;
  const perAttack=new Map();for(let i=0;i<400;i++){tickEnemy(w,e,.025);w.resolveDamage();for(const event of w.drainEvents())if(event.eventType==='Hit'&&event.payload.actorId===e.id&&event.payload.targetId==='core')perAttack.set(e.attackActionSeq,(perAttack.get(e.attackActionSeq)??0)+1);}
  assert(w.s.buildings.core.hp<before,`${id}: 10 seconds of core charge cycles caused zero damage`);assert(perAttack.size>0);assert([...perAttack.values()].every(n=>n===1),`${id}: same charge repeatedly damaged core`);
 }
});
