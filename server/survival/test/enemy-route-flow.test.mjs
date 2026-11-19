// Isolated authoritative in-memory tests. No service, browser, GPU or disk store.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../config.mjs';
import {SurvivalWorld} from '../world.mjs';
import {RoomRuntime} from '../room-runtime.mjs';
const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
const dt=1/30,dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
function at(w,e,x,z){Object.assign(e,{x,z,y:w.ground(x,z),joinProtectionUntil:0});}
function fixture(n=1){
 const w=new SurvivalWorld(structuredClone(config),null,{onlineRoster:true});
 const ps=Array.from({length:n},(_,i)=>{const p=w.allocate(`Synthetic ${i+1}`,`isolated-nav-${i}`);w.connect(p,p.name);at(w,p,50+i*.8,50);return p;});
 w.setPhase('DAY');w.s.enemies={};w.s.destructibles={};w.s.projectiles={};w.s.director.objective=null;w.s.director.optionalObjective=null;w.drainEvents();
 return {w,ps,p:ps[0]};
}
function prop(w,kind,x,z,yaw=0){
 const [hp,size]={crate:[45,{x:1.2,y:1.2,z:1.2}],barrel:[60,{x:1.05,y:1.5,z:1.05}],barricade:[80,{x:2.4,y:1.25,z:.4}]}[kind];
 const q={id:`synthetic-${kind}`,kind,x,z,y:w.ground(x,z),yaw,hp,maxHp:hp,size,radius:Math.hypot(size.x,size.z)/2,revision:1,broken:false,seed:11};w.s.destructibles[q.id]=q;return q;
}
function gate(w,x=0,z=22){
 const def=w.defs.buildings.gate,q={id:'synthetic-gate',definitionId:'gate',x,z,y:w.ground(x,z),yaw:0,hp:def.hp,maxHp:def.hp,level:1,gateOpen:false,revision:1};w.s.buildings[q.id]=q;return q;
}
function tick(w,es,update=true){
 w.s.tick++;w.s.time+=dt;
 for(const e of es){
  if(!w.s.enemies[e.id])continue;
  const before={...e},def=w.enemyDefinition(e),maxSpeed=e.state==='CHARGE'?(e.definitionId==='boss_crab'?10:def.dash_speed):def.speed;
  if(update)w.updateEnemy(e,dt);
  assert(dist(before,e)<=maxSpeed*dt+1e-6,`${e.definitionId}: unbudgeted displacement ${dist(before,e)}`);
  assert(!w.blocked(e.x,e.y,e.z,e.radius,e.id),`${e.definitionId}: entered collider`);
  assert.notEqual(e.state,'burrow_windup','route failure must not teleport');
 }
 w.updateProjectiles(dt);w.resolveDamage();
}
function type(role){const d=config.creatures.find(d=>d.role===role);assert(d,`missing role ${role}`);return d.id;}

for(const [kind,id] of [['crate','crab'],['barrel',type('breaker')],['barricade',type('courier')],['crate',type('drone')],['barrel',type('artillery')]])test(`route obstruction ${id}/${kind}: real windup, one destruction and real passage`,()=>{
 const {w}=fixture(),q=prop(w,kind,0,22,kind==='barricade'?Math.PI/2:0),e=w.spawnEnemy(id,0,26,true);
 e.z=w.propBox(q).z1+e.radius+.25;e.y=w.enemyGroundHeight(e);let warned=false,passed=false;
 assert(!w.blocked(e.x,e.y,e.z,e.radius,e.id));
 // The archive guard deals 4 normal damage every 1.3s windup + 3s cooldown;
 // a 60HP barrel legitimately exceeds the original arbitrary 60s test window.
 // Bound by unchanged damage/cadence plus passage time, not a relaxed outcome.
 const def=w.enemyDefinition(e),damage=Math.ceil((e.role==='breaker'?(def.building_damage??def.damage):def.damage)*(e.damageMultiplier??1));
 const maxTicks=Math.ceil((Math.ceil(q.maxHp/damage)*(Math.max(.35,def.attack_windup)+def.attack_cooldown+dt*2)+8)/dt);
 for(let i=0;i<maxTicks;i++){tick(w,[e]);warned ||= e.state==='WINDUP'&&e.targetId===q.id;if(q.broken&&e.z<20){passed=true;break;}}
 assert(warned,'no real obstacle windup');assert(q.broken,'blocking prop not destroyed');assert(passed,'failed to pass the actual cleared route');
 const events=w.drainEvents();assert.equal(events.filter(v=>v.eventType==='Destroyed'&&v.payload.targetId===q.id).length,1);
 assert(events.some(v=>v.eventType==='Hit'&&v.payload.targetId===q.id&&v.payload.actorId===e.id));assert(w.s.containers[q.lootContainerId]);w.assertInvariants();
});

for(const variant of ['base','auditor','overload'])test(`Boss ${variant} still resolves an immediate real barrel obstruction`,()=>{
 const {w}=fixture(),q=prop(w,'barrel',0,22),e=w.spawnEnemy('boss_crab',0,27,true);e.variantId=variant;e.z=w.propBox(q).z1+e.radius+.25;e.y=w.enemyGroundHeight(e);
 let passed=false;for(let i=0;i<1200;i++){tick(w,[e]);if(q.broken&&e.z<20){passed=true;break;}}assert(q.broken);assert(passed);assert.equal(w.drainEvents().filter(v=>v.eventType==='Destroyed'&&v.payload.targetId===q.id).length,1);
});

for(const shape of ['rock','terminal','u'])test(`actual World movement navigates ${shape} without crossing its boxes`,()=>{
 const {w}=fixture(),e=w.spawnEnemy('crab',24,20,true);Object.assign(w.s.buildings.core,{x:24,z:shape==='u'?14:26,y:w.ground(24,26)});w.boxes();
 const shapes=shape==='u'?[[21,27,17,18],[21,22,18,23],[26,27,18,23]]:[[23,25,22,24]];
 const obstacles=shapes.map((b,i)=>({id:`${shape}-synthetic-${i}`,x0:b[0],x1:b[1],z0:b[2],z1:b[3],y0:5,y1:8}));w.staticBoxes.push(...obstacles);
 let attacked=false,side=0;for(let i=0;i<1500;i++){tick(w,[e]);side=Math.max(side,Math.abs(e.x-24));if(e.state==='WINDUP'&&e.targetId==='core'){assert(w.lineVisible(e,w.s.buildings.core));attacked=true;break;}}
 assert(attacked,'did not find a real attack position within 50 seconds');assert(side>.6,'never left blocked centre line');assert(obstacles.every(b=>w.staticBoxes.includes(b)),'non-destructible geometry changed');
});

test('a closing gate is attacked, opening it after windup does not damage the now traversable door',()=>{
 // First commit to the gate. A nearby unprotected operator would legitimately
 // win proximity aggro and turn this into a player-melee fixture instead.
 const {w,p}=fixture(),g=gate(w),e=w.spawnEnemy('crab',.4,23.2,true);
 for(let i=0;i<30&&e.state!=='WINDUP';i++)tick(w,[e]);assert.equal(e.attackKind,'clear_route');assert.equal(e.targetId,g.id);const oldHp=g.hp;
 at(w,p,1,23.5);
 const result=w.command(p,{requestId:p.requestHighWater+1,command:'ToggleGate',targetId:g.id,payload:{open:true}});assert(result.ok,JSON.stringify(result));assert(g.gateOpen);
 // The next genuine simulation tick, not a test-only invalidation, sees the change.
 at(w,p,50,50);for(let i=0;i<150;i++)tick(w,[e]);assert.equal(g.hp,oldHp,'old clear_route windup damaged an opened passable gate');assert(e.z<21,'failed to move through open gate');
});

test('closing a gate after a cached open route prevents passage on the next movement tick',()=>{
 const {w,p}=fixture(),g=gate(w),e=w.spawnEnemy('crab',0,25,true),goal={id:'synthetic-beyond-gate',x:0,z:19};g.gateOpen=true;
 w.s.tick++;w.navigateEnemy(e,goal,w.enemyDefinition(e).speed,dt);at(w,p,1,23);
 const result=w.command(p,{requestId:p.requestHighWater+1,command:'ToggleGate',targetId:g.id,payload:{open:false}});assert(result.ok,JSON.stringify(result));assert(!g.gateOpen);at(w,p,50,50);
 for(let i=0;i<120;i++){w.s.tick++;w.s.time+=dt;const before={...e};w.navigateEnemy(e,goal,w.enemyDefinition(e).speed,dt);assert(dist(before,e)<=w.enemyDefinition(e).speed*dt+1e-6);assert(!w.blocked(e.x,e.y,e.z,e.radius,e.id));}
 assert.equal(g.hp,g.maxHp,'pure navigation inflicted damage');
});

test('a night crab approaches the real open G01 diagonally and finds its opening without demolishing posts',()=>{
 const {w}=fixture(),g=w.s.buildings.G01,e=w.spawnEnemy('crab',3.2,8,true);assert(g.gateOpen);const hp=g.hp;
 let passed=false;for(let i=0;i<900;i++){tick(w,[e]);if(e.z<4.8){passed=true;break;}}
 assert(passed,'real open G01 post trapped a diagonally approaching crab');assert.equal(g.hp,hp,'open gate was demolished instead of navigated');
});

test('the normal Boss body follows the real open G01 opening without cutting a post',()=>{
 const {w}=fixture(),g=w.s.buildings.G01,e=w.spawnEnemy('boss_crab',3.2,8,true);assert(g.gateOpen);assert.equal(e.radius,config.creatures.find(d=>d.id==='boss_crab').collision_radius);const hp=g.hp;
 // Normal radius is 1m, and the real opening is 2.4m: it can physically fit.
 // Exercise movement alone; a real Boss area attack may legitimately hit doors.
 // The goal is explicitly a point beyond the door: a solid core target may
 // legitimately stop this movement helper at a ranged attack position.
 let passed=false;for(let i=0;i<900;i++){w.s.tick++;w.s.time+=dt;const before={...e};w.navigateEnemy(e,{id:'synthetic-door-interior',x:1.5,z:4},w.enemyDefinition(e).speed,dt);assert(dist(before,e)<=w.enemyDefinition(e).speed*dt+1e-6);assert(!w.blocked(e.x,e.y,e.z,e.radius,e.id));if(e.z<4.8){passed=true;break;}}
 assert(passed,'normal Boss failed to use its physically wide-enough opening');assert.equal(g.hp,hp);
});

test('synthetic wider-than-opening body cannot hard-cross G01 during navigation',()=>{
 const {w}=fixture(),g=w.s.buildings.G01,e=w.spawnEnemy('boss_crab',1.5,9,true);e.radius=1.21;
 // Explicit geometry parameter boundary, NOT the current normal Boss size.
 // The configuration and every HP/damage value remain unchanged.
 const hp=g.hp;for(let i=0;i<180;i++){w.s.tick++;w.s.time+=dt;const before={...e};w.navigateEnemy(e,w.s.buildings.core,w.enemyDefinition(e).speed,dt);assert(dist(before,e)<=w.enemyDefinition(e).speed*dt+1e-6);assert(!w.blocked(e.x,e.y,e.z,e.radius,e.id));assert(!(Math.abs(e.x)<6-e.radius&&Math.abs(e.z)<6-e.radius),'oversized body entered the intact fortress');}
 assert.equal(g.hp,hp);
});

test('navigation can leave an exact legal collider boundary instead of treating t=0 as penetration',()=>{
 const {w}=fixture(),q=prop(w,'crate',24,22),e=w.spawnEnemy('crab',24,24,true);e.z=w.propBox(q).z1+e.radius;e.y=w.enemyGroundHeight(e);
 assert(!w.blocked(e.x,e.y,e.z,e.radius,e.id),'fixture must be legal at strict boundary');const target={x:e.x,z:e.z+2,y:e.y};
 assert(w.navigationTraverse(e,target,e.radius,e),'legal movement away from a tangent surface was rejected');
});

test('airborne navigation retains actual body height above a low prop',()=>{
 const {w}=fixture(),e=w.spawnEnemy(type('drone'),24,20,true),q=prop(w,'crate',24,22);
 // Synthetic low scenery verifies the existing vertical capsule contract,
 // without changing any creature's normal hover height or speed.
 q.size.y=.2;e.y=w.enemyGroundHeight(e);assert(e.y>w.propBox(q).y1);
 const target={x:24,z:24,y:e.y};assert(!w.blocked(24,e.y,22,e.radius,e.id));assert(w.navigationTraverse(e,target,e.radius,e),'navigation dropped the airborne body to ground height');
});

for(const role of ['courier','swooper'])test(`${role} normal 30Hz dash cannot clip the corner of a solid crate between legal endpoints`,()=>{
 const {w}=fixture(),q=prop(w,'crate',24,22),e=w.spawnEnemy(type(role),24,24,true),box=w.propBox(q);
 // Both endpoints are outside the expanded box. The short diagonal crosses
 // its corner, so an endpoint-only collision check misses it even at 30 Hz.
 e.x=box.x1+e.radius-.08;e.z=box.z1+e.radius+.02;e.y=w.enemyGroundHeight(e);e.yaw=-Math.PI/4;
 e.state='CHARGE';e.attackKind='dash';e.chargeRemaining=w.enemyDefinition(e).dash_distance;e.chargeHit=[];const before={...e};
 assert(!w.blocked(e.x,e.y,e.z,e.radius,e.id));tick(w,[e]);
  for(let i=1;i<=100;i++){const t=i/100,x=before.x+(e.x-before.x)*t,z=before.z+(e.z-before.z)*t;assert(!w.blocked(x,before.y,z,e.radius,e.id),'dash segment crossed the crate corner');}
 assert.equal(e.state,'RECOVER','blocked committed charge did not end');assert(w.s.destructibles[q.id]);
});

test('a wild monster outside its original leash returns around an obstruction without teleporting',()=>{
 const {w}=fixture(),e=w.spawnEnemy('crab',24,20,false);e.homeX=24;e.homeZ=20;e.x=58;e.z=20;e.y=w.enemyGroundHeight(e);w.boxes();w.staticBoxes.push({id:'rock-returning-synthetic',x0:54,x1:56,z0:19,z1:21,y0:0,y1:10});
 assert(w.aggro.returnGate(e));const oldDistance=dist(e,{x:24,z:20});let returned=false;
 for(let i=0;i<1500;i++){tick(w,[e]);if(dist(e,{x:24,z:20})<oldDistance-8){returned=true;break;}}assert(returned,'returning monster remained outside home behind a rock');
});

test('24 blocked World actors share navigator budgets, retain their identities and never teleport',()=>{
 const {w}=fixture(8);w.boxes();w.staticBoxes.push({id:'rock-budget-synthetic',x0:20,x1:28,z0:23,z1:25,y0:5,y1:9});
 const es=Array.from({length:24},(_,i)=>w.spawnEnemy('crab',23+(i%3),19-Math.floor(i/3)*.05,true)),ids=es.map(e=>e.id);
 for(let tick=0;tick<90;tick++){w.s.tick++;w.s.time+=dt;for(const e of es){const before={...e};w.navigateEnemy(e,{id:'beyond',x:24,z:29},w.enemyDefinition(e).speed,dt);assert(dist(before,e)<=w.enemyDefinition(e).speed*dt+1e-6);assert(!w.blocked(e.x,e.y,e.z,e.radius,e.id));}const s=w.navigation.stats;assert(s.searches<=1);assert(s.expanded<=192);assert(s.traversals<=768);assert(s.immediateChecks<=64);assert(w.navigation.records.size<=128);}
 assert.deepEqual(Object.keys(w.s.enemies),ids);assert.equal(w.s.statistics.kills,0);assert.equal(w.publicState().enemyNavigation,undefined);assert.equal(w.serialize().enemyNavigation,undefined);
});

function kill(w,p,enemies){for(const e of enemies)if(w.s.enemies[e.id])w.damageQueue.push({target:e.id,actorId:p.id,damage:e.hp,weaponId:'knife'});w.resolveDamage();}
function drainNormalWaves(w,p){
 const n=w.s.night;w.s.phaseElapsed=80;let guard=0;
 while(n.pending.length){assert(++guard<200,'unbounded synthetic queue');w.s.tick++;w.s.time+=n.spawnInterval;w.updateNightQueue();kill(w,p,Object.values(w.s.enemies).filter(e=>e.night&&e.id!==n.bossId));}
 kill(w,p,Object.values(w.s.enemies).filter(e=>e.night&&e.id!==n.bossId));
}
function ledger(w){return structuredClone({day:w.s.dayIndex,stats:w.s.statistics,ledger:w.s.resultLedger,items:w.s.items,bank:w.s.bank,rewardOffers:Object.fromEntries(Object.values(w.s.players).map(p=>[p.id,p.rewardOffers]))});}

test('empty initial gap or merely deleting the planned Boss cannot cause early dawn',()=>{
 const {w}=fixture();w.startNight();w.s.enemies={};w.s.night.pending=[];w.s.night.remaining=0;w.s.phaseElapsed=1;w.resolveNight();assert.equal(w.s.phase,'NIGHT');assert.equal(w.s.statistics.daysSurvived,0);
 w.s.phaseElapsed=w.phaseDuration('NIGHT');w.resolveNight();assert.equal(w.s.phase,'PREP');assert.equal(w.s.statistics.daysSurvived,1);assert.equal(w.s.night.rewardClaimed,false);
});

test('a genuinely defeated planned Boss waits for pending waves, then the last real kill starts dawn once',()=>{
 const {w,p}=fixture();w.startNight();const total=w.s.night.pending.length,boss=w.s.enemies[w.s.night.bossId];kill(w,p,[boss]);assert(w.s.night.bossDefeated);assert(w.s.night.pending.length>0);w.resolveNight();assert.equal(w.s.phase,'NIGHT');
 drainNormalWaves(w,p);assert.equal(w.s.night.spawned,total+1);w.resolveNight();assert.equal(w.s.phase,'PREP');assert.equal(w.s.dayIndex,2);assert.equal(w.s.statistics.daysSurvived,1);assert(w.s.night.resolved);assert.equal(w.s.resultLedger.filter(id=>id===w.s.night.id).length,1);assert.equal(Object.values(w.s.containers).filter(c=>c.source==='boss').length,1);
 const before=ledger(w);w.resolveNight();assert.deepEqual(ledger(w),before);
});

test('early dawn ignores and retains a voluntary fishing monster and its ownership',()=>{
 const {w,p}=fixture(),fish=w.spawnEnemy('crab',24,20,false);Object.assign(fish,{source:'fishing',night:false,ownerId:p.id,hp:7});w.startNight();const before=structuredClone(w.s.enemies[fish.id]);drainNormalWaves(w,p);kill(w,p,[w.s.enemies[w.s.night.bossId]]);w.resolveNight();assert.equal(w.s.phase,'PREP');assert.deepEqual(w.s.enemies[fish.id],before);assert.equal(w.activeFishingCount(p),1);
});

for(const failure of ['core','last-downed'])for(const reversed of [false,true])test(`same-tick final kill with ${failure}, reversed=${reversed}: only failure settles`,()=>{
 const {w,p}=fixture();w.startNight();drainNormalWaves(w,p);const boss=w.s.enemies[w.s.night.bossId];if(failure==='last-downed'){w.enterDowned(p);p.downedGraceRemaining=0;}const hits=[{target:boss.id,actorId:p.id,damage:boss.hp},{target:failure==='core'?'core':p.id,actorId:boss.id,damage:failure==='core'?w.s.buildings.core.hp:p.downedHp}];
 w.damageQueue.push(...(reversed?hits.reverse():hits));w.resolveDamage();w.resolveNight();assert.equal(w.s.phase,'RECOVERY');assert.equal(w.s.statistics.breaches,1);assert.equal(w.s.statistics.daysSurvived,0);assert.equal(w.s.dayIndex,2);const before=ledger(w);w.resolveNight();assert.deepEqual(ledger(w),before);
});

for(const reversed of [false,true])test(`same-tick final kill and last player newly downed still succeeds, reversed=${reversed}`,()=>{
 const {w,p}=fixture();w.startNight();drainNormalWaves(w,p);const boss=w.s.enemies[w.s.night.bossId],hits=[{target:boss.id,actorId:p.id,damage:boss.hp},{target:p.id,actorId:boss.id,damage:p.hp}];
 w.damageQueue.push(...(reversed?hits.reverse():hits));w.resolveDamage();assert.equal(p.lifeState,'DOWNED');assert.equal(p.downedHp,40);w.resolveNight();assert.equal(w.s.phase,'PREP');assert.equal(p.lifeState,'ALIVE');assert.equal(w.s.statistics.daysSurvived,1);assert.equal(w.s.statistics.breaches,0);assert.equal(w.s.statistics.deaths,0);w.assertInvariants();
});

test('read-back before and after final kill never duplicates a night reward or settlement',()=>{
 const f=fixture(),{w,p}=f;w.startNight();drainNormalWaves(w,p);const snapshot=w.serialize(),next=new SurvivalWorld(w.c,snapshot,{onlineRoster:true}),q=next.s.players[p.id];next.connect(q,q.name);
 kill(next,q,[next.s.enemies[next.s.night.bossId]]);next.resolveNight();assert.equal(next.s.phase,'PREP');const before=ledger(next),again=new SurvivalWorld(next.c,next.serialize(),{onlineRoster:true});again.connect(again.s.players[q.id],q.name);again.resolveNight();assert.deepEqual(ledger(again),before);assert.equal(Object.values(again.s.containers).filter(c=>c.source==='boss').length,1);
});

test('Runtime save may settle the final kill; failed persistence retries that same complete transaction',async()=>{
 let fail=true;const persisted=[],member={peerId:'synthetic-owner',accountId:'synthetic-account',name:'Synthetic Owner',ready:true},room={id:'synthetic-room',ownerId:member.accountId,hostPeerId:member.peerId,status:'running',members:[member]},r=new RoomRuntime({config:structuredClone(config),room,now:()=>0,send:()=>{},save:async state=>{if(fail)throw Error('SYNTHETIC_SAVE_FAULT');persisted.push(structuredClone(state));return {revision:persisted.length};}});
 r.receive(member.peerId,{type:'hello'});const w=r.world,p=w.s.players[r.sessions.get(member.peerId).playerId];p.joinProtectionUntil=0;w.startNight();drainNormalWaves(w,p);kill(w,p,[w.s.enemies[w.s.night.bossId]]);
 await assert.rejects(r.save(),/SYNTHETIC_SAVE_FAULT/);assert.equal(w.s.phase,'PREP');assert(r.saveFault);const before=ledger(w);fail=false;await r.save();assert.deepEqual(ledger(w),before);assert.equal(persisted.length,1);assert.equal(persisted[0].statistics.daysSurvived,1);
 const restored=new SurvivalWorld(w.c,persisted[0],{onlineRoster:true});restored.resolveNight();assert.deepEqual(ledger(restored),before);
});

test('already recorded night result is a second idempotency guard even with a stale unresolved flag',()=>{
 const {w,p}=fixture();w.startNight();drainNormalWaves(w,p);kill(w,p,[w.s.enemies[w.s.night.bossId]]);w.s.resultLedger.push(w.s.night.id);const before=ledger(w);w.resolveNight();assert.deepEqual(ledger(w),before);
});
