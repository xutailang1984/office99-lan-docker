// Synthetic, in-memory P4 fixtures. No services, ports, real identities or saves.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../config.mjs';
import {SurvivalWorld} from '../world.mjs';
import {extendNightContentConfig,validateNightContentConfig,NIGHT_CONTENT_PLANS,isBoss} from '../night-content-config.mjs';
import {updateNightContent,bossHitProfile,recordNightContentHit,nightContentSpeed} from '../night-content.mjs';
import {nightEncounterBudget} from '../expedition-config.mjs';
import {moduleHit} from '../crafting.mjs';
import {gearAfterHit,gearPiercingHit} from '../gear-growth.mjs';
const base=extendNightContentConfig(await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url)));
function fixture(id='boss_shredder',n=1){
 const c=structuredClone(base),w=new SurvivalWorld(c,null,{onlineRoster:true}),ps=Array.from({length:n},(_,i)=>w.allocate(`Synthetic P4 ${i+1}`,`p4-only-${i+1}`));for(const p of ps){w.connect(p,p.name);Object.assign(p,{x:50+p.slotId,z:50,y:w.ground(50+p.slotId,50),joinProtectionUntil:0});}
 w.setPhase('DAY');w.s.enemies={};w.s.destructibles={};w.s.director.objective=null;w.s.director.optionalObjective=null;Object.assign(w.s.buildings.core,{x:24,z:25,y:w.ground(24,25)});
 const e=w.spawnEnemy(id,24,20,true);e.radius=w.defs.creatures[id].collision_radius;e.tier=w.defs.creatures[id].tier;e.source='night';e.variantId='base';w.drainEvents();return {w,e,p:ps[0],ps};
}
function put(w,p,x,z){Object.assign(p,{x,z,y:w.ground(x,z),joinProtectionUntil:0});}
function tick(w,e,dt=.025){w.s.time+=dt;w.s.tick++;assert(updateNightContent(w.director,e,dt));w.resolveDamage();assert(Number.isFinite(e.x)&&Number.isFinite(e.z));}
function advance(w,e,seconds){for(let t=0;t<seconds-1e-8;t+=.025)tick(w,e,Math.min(.025,seconds-t));}
function complete(w,e){for(let i=0;i<400&&e.state!=='WEAK';i++)tick(w,e);assert.equal(e.state,'WEAK','attack never reached its weak window');}
function prop(w,x,z,hp=1000){const q={id:'p4-cover',kind:'barrel',x,z,y:w.ground(x,z),yaw:0,hp,maxHp:hp,size:{x:1.05,y:1.5,z:1.05},radius:.75,revision:1,broken:false,seed:11};w.s.destructibles[q.id]=q;return q;}

test('P4: four independent registered silhouettes and twelve bounded night plans',()=>{
 assert.equal(base.director.nightPlans.length,16);assert.equal(new Set(base.director.nightPlans.map(p=>p.id)).size,16);assert.equal(NIGHT_CONTENT_PLANS.length,10);
 for(const id of ['boss_crab','boss_shredder','boss_printer'])assert(isBoss(base.creatures.find(d=>d.id===id)));for(const id of ['broadcast_cart','paper_lobber'])assert(!isBoss(base.creatures.find(d=>d.id===id)));
 assert.deepEqual([1,2,4,8].map(n=>nightEncounterBudget(n).aliveCap),[5,8,12,18]);assert.deepEqual([3,5,6,7].map(n=>nightEncounterBudget(n).aliveCap),[10,14,15,17]);
 assert.equal(base.director.budgets.maxEnemyZones,8);assert.equal(base.director.budgets.maxDeployables,16);assert.equal(base.director.budgets.maxProjectiles,64);assert(base.director.phaseRows.every(row=>row.DAY===420&&row.NIGHT===120));
});
test('P4: configuration rejects unbounded assistance and oppressive combinations',()=>{
 for(const mutate of [c=>c.director.nightContent.rally.speedMultiplier=2,c=>c.director.nightContent.rally.maxAllies=8,c=>c.director.nightContent.printer.shiftRange=20,c=>c.director.nightContent.shredder.fanHalfAngle=NaN,c=>c.director.nightPlans[0].roles=['shield_bug','medic_bug'],c=>c.director.nightPlans[0].roles=['jammer','courier','stamp_bat'],c=>c.director.nightPlans[0].bossDefinitionId='paper_lobber']){const c=structuredClone(base);mutate(c);assert.throws(()=>validateNightContentConfig(c),/Invalid night/);}
});
test('P4: shredder side motors and printer rear jam differ from armored front and closed windows',()=>{
 for(const id of ['boss_shredder','boss_printer']){const {w,e}=fixture(id);e.yaw=0;e.weak=true;e.state='WEAK';assert.deepEqual(bossHitProfile(w,e,{x:e.x,z:e.z-3}),{weak:false,multiplier:.35});assert.equal(bossHitProfile(w,e,{x:e.x+3,z:e.z}).weak,id==='boss_shredder');assert.equal(bossHitProfile(w,e,{x:e.x,z:e.z+3}).weak,id==='boss_printer');e.weak=false;assert.equal(bossHitProfile(w,e,{x:e.x+3,z:e.z}).weak,false);}
});
test('P4: shredder fan has a readable locked warning, dodge edge and one hit per target',()=>{
 const {w,e,p,ps}=fixture('boss_shredder',2);put(w,p,24,23);put(w,ps[1],28,21);e.attackIndex=1;tick(w,e);assert.equal(e.attackKind,'shredder_fan');assert.equal(e.attackZone.shape,'cone');const initial=structuredClone(e.attackZone);e.hp=e.maxHp*.49;advance(w,e,.25);assert.equal(e.attackZone.yaw,initial.yaw);assert.equal(e.attackZone.endsAt,initial.endsAt);assert.equal(p.hp,100);complete(w,e);assert.equal(p.hp,78);assert.equal(ps[1].hp,100);assert.equal(w.drainEvents().filter(v=>v.eventType==='Hit'&&v.payload.targetId===p.id).length,1);assert(e.weak);
});
test('P4: motor output cancels the next advance once without cutting an existing warning',()=>{
 const {w,e}=fixture();e.state='WEAK';e.weak=true;e.phaseRemaining=4;e.attackIndex=2;recordNightContentHit(w,e,{weak:false,damage:500});assert.equal(e.cancelNextAdvance,undefined);recordNightContentHit(w,e,{weak:true,actualDamage:30});assert.equal(e.cancelNextAdvance,undefined);recordNightContentHit(w,e,{weak:true,actualDamage:15});assert(e.cancelNextAdvance);assert.equal(e.phaseRemaining,4);
 e.state='CHASE';e.weak=false;tick(w,e);assert.equal(e.attackKind,'shredder_fan');assert.equal(e.cancelNextAdvance,false);const zone=structuredClone(e.attackZone),remaining=e.phaseRemaining;recordNightContentHit(w,e,{weak:true,actualDamage:999});assert.deepEqual(e.attackZone,zone);assert.equal(e.phaseRemaining,remaining);
});
for(const id of ['boss_shredder','boss_printer'])test(`P4: ${id} preserves committed warning and weak state through real serialization`,()=>{
 const {w,e}=fixture(id);tick(w,e);advance(w,e,.3);const next=new SurvivalWorld(w.c,w.serialize(),{onlineRoster:true}),copy=next.s.enemies[e.id];for(const key of ['state','phaseRemaining','yaw','attackKind','attackIndex'])assert.equal(copy[key],e[key]);assert.deepEqual(copy.attackZone,e.attackZone);complete(next,copy);assert(copy.weak);const again=new SurvivalWorld(next.c,next.serialize(),{onlineRoster:true}),saved=again.s.enemies[e.id];assert.equal(saved.state,'WEAK');assert.equal(saved.phaseRemaining,copy.phaseRemaining);assert.equal(saved.weak,true);
});
test('P4: printer paper wave uses rectangular footprint and shifting remains a short separate action',()=>{
 const {w,e,p,ps}=fixture('boss_printer',2);Object.assign(w.s.buildings.core,{z:29,y:w.ground(24,29)});put(w,p,24,24);put(w,ps[1],27,24);tick(w,e);assert.equal(e.attackKind,'printer_wave');assert.equal(e.attackZone.shape,'line');assert.equal(e.attackZone.width,3.4);complete(w,e);assert.equal(p.hp,77);assert.equal(ps[1].hp,100);put(w,p,50,50);e.state='CHASE';e.weak=false;const start={x:e.x,z:e.z};tick(w,e);assert.equal(e.attackKind,'printer_shift');complete(w,e);assert(Math.hypot(e.x-start.x,e.z-start.z)<=2.6+1e-8);assert.equal(e.attackIndex,2);assert.equal(e.state,'WEAK');
});
for(const id of ['boss_shredder','boss_printer'])test(`P4: ${id} respects intact cover and bounded collision movement`,()=>{
 const {w,e,p}=fixture(id);put(w,p,24,24);const cover=prop(w,24,22,1000);if(id==='boss_shredder')e.attackIndex=1;assert(!w.lineVisible(e,p));tick(w,e);complete(w,e);assert(cover.hp<1000);assert.equal(p.hp,100);assert(!w.blocked(e.x,e.y,e.z,e.radius,e.id));
});
test('P4: shredder advance swept collision damages its blocker once and opens a motor window',()=>{
 const {w,e}=fixture();const cover=prop(w,24,23,1000);tick(w,e);assert.equal(e.attackKind,'shredder_advance');const start={x:e.x,z:e.z};complete(w,e);assert.equal(cover.hp,930);assert(Math.hypot(e.x-start.x,e.z-start.z)<=6+1e-8);assert(!w.blocked(e.x,e.y,e.z,e.radius,e.id));assert.equal(w.drainEvents().filter(v=>v.eventType==='Hit'&&v.payload.targetId===cover.id).length,1);
});
test('P4: broadcast buffs at most two ordinary allies, expires and cannot buff the boss',()=>{
 const {w,e}=fixture('broadcast_cart');const allies=Array.from({length:4},(_,i)=>w.spawnEnemy(i===3?'boss_printer':'crab',24+i*.7,21,true));tick(w,e);assert.equal(e.attackKind,'rally');advance(w,e,1.2);assert.equal(allies.filter(a=>(a.rallyUntil??0)>w.s.time).length,2);assert.equal(allies[3].rallyUntil,undefined);const buffed=allies.find(a=>a.rallyUntil);assert.equal(nightContentSpeed(buffed,w.s.time),1.2);assert.equal(nightContentSpeed(buffed,buffed.rallyUntil),1);assert.equal(w.drainEvents().filter(v=>v.eventType==='EnemyRally').length,1);
});
test('P4: lobber locks one landing marker; walking away prevents damage and creates no slow field',()=>{
 const {w,e,p}=fixture('paper_lobber');Object.assign(w.s.buildings.core,{z:29,y:w.ground(24,29)});put(w,p,24,24);w.aggro.damage(e,p,10);tick(w,e);assert.equal(e.attackKind,'paper_lob');assert.equal(e.attackZone.points.length,1);const marker=structuredClone(e.attackZone.points[0]);put(w,p,28,24);advance(w,e,1.5);assert.equal(p.hp,100);assert.equal(Object.keys(w.s.projectiles).length,0);assert.equal(w.s.director.deployables.length,0);assert(w.drainEvents().some(v=>v.eventType==='EnemyAttackResolved'&&v.payload.zone.points[0].x===marker.x));
});
test('P4: lobber damages a player who stays within its warned landing point',()=>{
 const {w,e,p}=fixture('paper_lobber');Object.assign(w.s.buildings.core,{z:29,y:w.ground(24,29)});put(w,p,24,24);w.aggro.damage(e,p,10);tick(w,e);advance(w,e,1.5);assert.equal(p.hp,91);assert.equal(p.slowUntil??0,0);
});
test('P4: ordinary content falls through to existing enemy handling',()=>{const {w}=fixture();assert.equal(updateNightContent(w.director,{definitionId:'crab'},.01),false);});
test('P4: each entered warning emits exactly one sound event with its committed shape',()=>{
 for(const id of ['boss_shredder','boss_printer','broadcast_cart','paper_lobber']){const {w,e}=fixture(id);if(id==='broadcast_cart')w.spawnEnemy('crab',24,21,true);tick(w,e);assert.equal(e.state,'WINDUP');const warning=structuredClone(e.attackZone);advance(w,e,.20);const events=w.drainEvents().filter(event=>event.eventType==='EnemyAttackWarning'&&event.payload.enemyId===e.id);assert.equal(events.length,1,id+' repeated the warning event');assert.equal(events[0].payload.definitionId,id);assert.equal(events[0].payload.attackKind,e.attackKind);assert.deepEqual(events[0].payload.zone,warning);assert.deepEqual(events[0].payload.position,{x:e.x,y:e.y,z:e.z});}
});
test('P4 integration: new bosses retain immunity to shotgun stop, LMG suppression and focus follow-through',()=>{
 for(const id of ['boss_shredder','boss_printer']){const {w,e,p}=fixture(id);tick(w,e);const warning=structuredClone(e.attackZone),remaining=e.phaseRemaining;moduleHit(w,e,{moduleId:'shotgun_stop',weaponId:'shotgun',closePelletHits:5});assert.equal(e.state,'WINDUP');assert.equal(e.phaseRemaining,remaining);assert.deepEqual(e.attackZone,warning);
  const slot=w.s.containers[p.equipment.weapon];for(const iid of [...slot.itemIds])w.removeItem(w.s.items[iid]);const item=w.createItem('lmg',1,slot,{moduleId:'lmg_suppress',magazineAmmo:3});const hit={actorId:p.id,itemId:item.id,moduleId:item.moduleId,weaponId:item.definitionId};for(let i=0;i<6;i++)gearAfterHit(w,e,hit);assert.equal(e.gearSuppressedUntil,undefined);assert.equal(p.gearSuppress,null);
  p.gearFocusSeconds=1;assert.equal(gearPiercingHit(w,p,{definitionId:'rifle',moduleId:'rifle_focus'},{target:e}),null);
 }
});
for(const id of ['boss_shredder','boss_printer'])test(`P4 navigation: ${id} detours around a close immutable collider before warning`,()=>{
 const {w,e}=fixture(id);w.boxes();const rock={id:'rock-p4-detour',x0:23,x1:25,z0:22,z1:23,y0:e.y,y1:e.y+3};w.staticBoxes.push(rock);assert(!w.lineVisible(e,w.s.buildings.core));let warned=false,side=0;
 for(let i=0;i<1000;i++){const before={x:e.x,z:e.z},speed=w.defs.creatures[id].speed;tick(w,e);side=Math.max(side,Math.abs(e.x-24));assert(!w.blocked(e.x,e.y,e.z,e.radius,e.id),'boss entered an immutable collider');assert(Math.hypot(e.x-before.x,e.z-before.z)<=speed*.025+1e-7,'boss jumped across navigation route');if(e.state==='WINDUP'){assert(w.lineVisible(e,w.s.buildings.core));warned=true;break;}assert.equal(e.attackIndex,0);}
 assert(warned,'no legal attack reached within 25 seconds');assert(side>1);assert(w.staticBoxes.includes(rock));
});
for(const id of ['boss_shredder','boss_printer'])test(`P4 navigation: ${id} destroys an actual route prop and resumes attack`,()=>{
 const {w,e}=fixture(id);const cover=prop(w,24,22.7,55);for(let i=0;i<1200&&!cover.broken;i++)tick(w,e);assert(cover.broken,'route blocker was never destroyed');assert(w.s.containers[cover.lootContainerId]);const index=e.attackIndex;for(let i=0;i<800&&e.attackIndex===index;i++)tick(w,e);assert(e.attackIndex>index,'boss stayed inactive after opening the route');assert(!w.blocked(e.x,e.y,e.z,e.radius,e.id));assert.equal(w.drainEvents().filter(v=>v.eventType==='Destroyed'&&v.payload.targetId===cover.id).length,1);
});
test('P4: broadcast and lobber warning state restore with locked markers and pause during hit reaction',()=>{
 for(const id of ['broadcast_cart','paper_lobber']){const {w,e,p}=fixture(id);if(id==='broadcast_cart')w.spawnEnemy('crab',24,21,true);else {Object.assign(w.s.buildings.core,{z:29,y:w.ground(24,29)});put(w,p,24,24);w.aggro.damage(e,p,20);}tick(w,e);assert.equal(e.state,'WINDUP');const zone=structuredClone(e.attackZone);e.hitStunRemaining=.1;const remaining=e.phaseRemaining,endsAt=e.attackZone.endsAt;tick(w,e,.05);assert.equal(e.phaseRemaining,remaining);assert(Math.abs(e.attackZone.endsAt-(endsAt+.05))<1e-8);const next=new SurvivalWorld(w.c,w.serialize(),{onlineRoster:true}),copy=next.s.enemies[e.id];assert.equal(copy.state,'WINDUP');assert.equal(copy.phaseRemaining,e.phaseRemaining);assert.deepEqual(copy.attackZone,e.attackZone);assert.equal(copy.attackZone.points?.[0]?.x,zone.points?.[0]?.x);}
});

for(const id of ['boss_shredder','boss_printer'])test(`P4 integration: ${id} gets one real reward, early dawn and fail-first settlement`,()=>{
 for(const fail of [false,true]){const {w,p}=fixture(id);w.c.director.nightPlans=[structuredClone(NIGHT_CONTENT_PLANS.find(plan=>plan.bossDefinitionId===id))];w.startNight();const boss=w.s.enemies[w.s.night.bossId];assert.equal(boss.definitionId,id,'night did not register the independent species');w.s.night.pending=[];const nightId=w.s.night.id;w.damageQueue.push({target:boss.id,damage:boss.hp,actorId:p.id});if(fail)w.damageQueue.push({target:'core',damage:w.s.buildings.core.hp,actorId:boss.id});w.resolveDamage();w.resolveNight();assert.equal(w.drainEvents().filter(v=>v.eventType==='BossReward').length,1);assert.equal(w.s.resultLedger.filter(v=>v===`boss-reward:${nightId}`).length,1);assert.equal(w.s.statistics.daysSurvived,fail?0:1);assert.equal(w.s.statistics.breaches,fail?1:0);w.killEnemy(boss,p.id);assert.equal(w.drainEvents().filter(v=>v.eventType==='BossReward').length,0);w.assertInvariants();}
});
test('P4 integration: twelve plans rotate without duplicates, late joins preserve the locked P2 budget',()=>{
 for(const n of [1,2,3,4,5,6,7,8]){const {w}=fixture('boss_shredder',n);const seen=new Set();for(let i=0;i<12;i++){w.startNight();assert(!seen.has(w.s.director.nightPlan.id));seen.add(w.s.director.nightPlan.id);assert.equal(w.s.night.aliveCap,nightEncounterBudget(n).aliveCap);assert.equal(Object.values(w.s.enemies).filter(isBoss).length,1);assert.equal(w.phaseDuration('NIGHT'),120);}if(n<8){const boss=w.s.enemies[w.s.night.bossId],hp=boss.hp,cap=w.s.night.aliveCap;const p=w.allocate('Synthetic P4 late',`p4-late-${n}`);w.connect(p,p.name);assert.equal(boss.hp,hp);assert.equal(w.s.night.aliveCap,cap);assert.equal(w.s.night.playerCount,n);}w.assertInvariants();}
});
