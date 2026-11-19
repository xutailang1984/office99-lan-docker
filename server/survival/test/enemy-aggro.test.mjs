// Isolated in-memory tests. Imports only config/rules/helpers; no HTTP/WS/store.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,put,restored,command} from './director-helpers.mjs';
import {AGGRO_RULES} from '../enemy-aggro.mjs';

function setup(n=2,type='crab',night=false){
 const f=fixture(n);const {w,ps}=f;
 const e=w.spawnEnemy(type,24,20,night);e.source=night?'night':'wild';e.homeX=e.x;e.homeZ=e.z;
 ps.forEach((p,i)=>put(p,w,24+i*2,22));
 assert(w.lineVisible(e,ps[0]),'synthetic fixture must have clear actual LOS');
 return {...f,e};
}
function actualHit(w,p,e,damage,shotId=null){
 w.damageQueue.push({target:e.id,actorId:p.id,weaponId:'carbine',damage,...(shotId?{shotId}:{})});w.resolveDamage();
}
const record=(w,e)=>w.s.enemyAggro[e.id];
const close=(a,b)=>assert(Math.abs(a-b)<1e-7,`${a} != ${b}`);

test('night engagement expiry is fixed across new actual hits and target changes',()=>{
 const {w,ps,e}=setup(2,'crab',true);e.hp=e.maxHp=1000;put(ps[1],w,26,20);
 assert.equal(w.selectEnemyTarget(e).id,ps[0].id);const until=record(w,e).engagement.until;assert.equal(until,4);
 let switched=false;
 for(const [at,index,damage] of [[.5,0,1],[1.1,1,80],[1.9,0,80],[2.7,1,80],[3.99,0,1]]){
  w.s.time=at;actualHit(w,ps[index],e,damage);const t=w.selectEnemyTarget(e);
  switched ||= t?.id===ps[1].id;assert.equal(record(w,e).engagement.until,until);
 }
 assert(switched,'fixture exercised a real target switch');
 w.s.time=4;const target=w.selectEnemyTarget(e);assert(!target.lifeState);assert.equal(record(w,e).engagement,null);assert.equal(record(w,e).routeUntil,6);
});

test('fresh hits and nearby replacement players cannot bypass the full return-to-route interval',()=>{
 const {w,ps,e}=setup(2,'crab',true);e.hp=e.maxHp=1000;assert(w.selectEnemyTarget(e).lifeState);
 w.s.time=4;assert(!w.selectEnemyTarget(e).lifeState);const routeUntil=record(w,e).routeUntil;
 for(const at of [4.01,4.3,4.9,5.5,5.999]){
  w.s.time=at;for(const p of ps)actualHit(w,p,e,1);
  assert(!w.selectEnemyTarget(e).lifeState);assert.equal(record(w,e).routeUntil,routeUntil);assert.equal(record(w,e).engagement,null);
 }
 e.state='CHASE';e.hitStunRemaining=0;e.hitVelocity=null;const before=Math.hypot(e.x,e.z);w.updateEnemy(e,.1);assert(Math.hypot(e.x,e.z)<before,'actual collision-aware movement makes base progress');
 w.s.time=6.01;assert(w.selectEnemyTarget(e).lifeState);assert.equal(record(w,e).engagement.until,10.01);
});

test('night and Boss enforce both admitted target radius and their own smaller travel budget',()=>{
 for(const [type,travel,seconds,range] of [['crab',8,4,12],['boss_crab',6,3,8]]){
  const {w,p,e}=setup(1,type,true);assert.equal(w.selectEnemyTarget(e).id,p.id);assert.equal(record(w,e).engagement.until,seconds);
  put(p,w,e.x+range+.25,e.z);actualHit(w,p,e,1);w.s.time=.3;
  assert(!w.selectEnemyTarget(e).lifeState);assert.equal(record(w,e).engagement,null);assert.equal(record(w,e).routeUntil,2.3);
  const moved=setup(1,type,true);moved.w.selectEnemyTarget(moved.e);moved.e.x+=travel+.25;moved.e.y=moved.w.ground(moved.e.x,moved.e.z);put(moved.p,moved.w,moved.e.x+1,moved.e.z);
  moved.w.s.time=.3;assert(!moved.w.selectEnemyTarget(moved.e).lifeState);assert.equal(record(moved.w,moved.e).engagement,null);
 }
});

test('damage score uses real shield-reduced HP loss and aggregates one shotgun action correctly',()=>{
 const {w,p,e}=setup(1,'shield_bug');put(p,w,e.x,e.z-2);e.yaw=0;
 w.damageQueue.push(...Array.from({length:6},()=>({target:e.id,actorId:p.id,weaponId:'shotgun',damage:5,shotId:'synthetic-pellets'})));
 w.resolveDamage();assert.equal(e.hp,71);close(w.aggro.threat(e,p.id),9);
 const hits=w.drainEvents().filter(x=>x.eventType==='Hit'&&x.payload.targetId===e.id);assert.equal(hits.length,1);assert.equal(hits[0].payload.pelletHits,6);
 const before=w.aggro.threat(e,p.id);actualHit(w,p,e,0);assert.equal(w.aggro.threat(e,p.id),before);
});

test('damage decays with authority time, not repeated calls, and expires after 18 seconds',()=>{
 const {w,p,e}=setup(1);actualHit(w,p,e,20);close(w.aggro.threat(e,p.id),20);
 w.s.time=6;close(w.aggro.threat(e,p.id),10);for(let i=0;i<100;i++)w.selectEnemyTarget(e);close(w.aggro.threat(e,p.id),10);
 w.s.time=12;close(w.aggro.threat(e,p.id),5);w.s.time=18.01;w.selectEnemyTarget(e);assert.equal(record(w,e).damage[p.id],undefined);
});

test('large output takes aggro after hold time; equal-distance jitter does not thrash targets',()=>{
 const {w,p,ps,e}=setup();put(ps[1],w,28,20);assert.equal(w.selectEnemyTarget(e).id,p.id);
 actualHit(w,ps[1],e,30);w.s.time=.5;assert.equal(w.selectEnemyTarget(e).id,p.id);
 w.s.time=1.01;assert.equal(w.selectEnemyTarget(e).id,ps[1].id);
 for(let i=0;i<20;i++){w.s.time=1.2+i*.21;put(p,w,e.x,e.z+1.9+(i%2)*.2);assert.equal(w.selectEnemyTarget(e).id,ps[1].id);}
});

test('wild returning lock ignores further damage until inside re-entry radius',()=>{
 const {w,p,e}=setup(1);e.hp=e.maxHp=200;
 Object.assign(e,{x:e.homeX+30,y:w.ground(e.homeX+30,e.homeZ)});put(p,w,e.x+1,e.z);assert.equal(w.selectEnemyTarget(e).id,p.id);
 put(p,w,e.homeX+33,e.homeZ);assert.equal(w.selectEnemyTarget(e),null);assert.equal(record(w,e).returning,true);
 w.s.time=1;put(p,w,e.x-1,e.z);actualHit(w,p,e,10);assert.equal(w.selectEnemyTarget(e),null);assert.equal(record(w,e).returning,true);
 e.x=e.homeX+23.5;e.y=w.ground(e.x,e.z);put(p,w,e.x-1,e.z);w.s.time=2;assert.equal(w.selectEnemyTarget(e).id,p.id);assert.equal(record(w,e).returning,false);
});

test('fishing memory cannot pull a fish beyond six meters or make it select a fortress turret',()=>{
 const {w,p,e}=setup(1,'silverfish');e.source='fishing';e.ownerId=p.id;e.hp=e.maxHp=18;
 assert.equal(w.selectEnemyTarget(e).id,p.id);put(p,w,e.homeX+6.1,e.homeZ);actualHit(w,p,e,1);w.s.time=.3;assert.equal(w.selectEnemyTarget(e),null);
 const turret=w.s.turrets.T01;Object.assign(turret,{x:e.x+1,z:e.z,y:e.y,hp:250,maxHp:250,level:1});put(p,w,50,50);w.s.time=3;assert.equal(w.selectEnemyTarget(e),null);
});

test('lost line of sight investigates a fixed last-seen point rather than hidden coordinates',()=>{
 const {w,p,e}=setup(1);put(p,w,24,25);assert.equal(w.selectEnemyTarget(e).id,p.id);const last={x:p.x,z:p.z};
 w.s.buildings['synthetic-cover']={id:'synthetic-cover',definitionId:'wall',x:24,y:e.y,z:22,yaw:0,hp:400,maxHp:400,level:1,revision:1};
 assert(!w.lineVisible(e,p));w.s.time=.3;assert.equal(w.selectEnemyTarget(e),null);assert.deepEqual(w.aggro.returnPoint(e),last);
 put(p,w,24.5,25);w.s.time=1;assert.equal(w.selectEnemyTarget(e),null);assert.deepEqual(w.aggro.returnPoint(e),last);
 w.s.time=2.01;w.selectEnemyTarget(e);assert.equal(w.aggro.returnPoint(e),null);
});

test('all three Boss telegraphs retain yaw/locked zone when another player deals higher damage',()=>{
 for(const variantId of ['base','auditor','overload']){
  const {w,p,ps,e}=setup(2,'boss_crab',true);e.variantId=variantId;put(ps[1],w,26,20);
  w.updateBoss(e,.01);assert.equal(e.state,'WINDUP');const yaw=e.yaw,zone=structuredClone(e.attackZone??null),targetId=e.targetId;
  w.s.time=.8;actualHit(w,ps[1],e,60);put(p,w,23,22);w.updateBoss(e,.1);
  assert.equal(e.state,'WINDUP');assert.equal(e.yaw,yaw);assert.equal(e.targetId,targetId);assert.deepEqual(e.attackZone??null,zone);
 }
});

test('disconnect immediately invalidates target but recent damage survives same-identity reconnect',()=>{
 const {w,p,e}=setup(1);actualHit(w,p,e,20);assert.equal(w.selectEnemyTarget(e).id,p.id);w.disconnect(p);assert.equal(w.selectEnemyTarget(e),null);assert(record(w,e).damage[p.id]);
 const hp=e.hp;w.s.time=.5;w.connect(p,p.name);put(p,w,24,22);assert.equal(w.selectEnemyTarget(e).id,p.id);assert.equal(e.hp,hp);close(w.aggro.threat(e,p.id),20*Math.pow(.5,.5/6));
});

test('private aggro state resumes with save, never appears in full public dictionary, and pauses offline',()=>{
 const {w,p,e}=setup(1,'crab',true);actualHit(w,p,e,20);w.selectEnemyTarget(e);w.s.time=.5;
 const snapshot=w.serialize();assert(snapshot.enemyAggro[e.id]);assert(!Object.hasOwn(w.publicState(),'enemyAggro'));assert(!JSON.stringify(w.publicState().enemies).includes('damageScale'));
 const clone=restored(w),q=clone.s.players[p.id],other=clone.s.enemies[e.id];const before=structuredClone(clone.s.enemyAggro);clone.step(1);assert.equal(clone.s.time,.5);assert.deepEqual(clone.s.enemyAggro,before);
 clone.connect(q,q.name);put(q,clone,24,22);assert.equal(clone.selectEnemyTarget(other).id,q.id);assert.equal(record(clone,other).engagement.until,4);assert.equal(other.hp,e.hp);
 const full=clone.publicState();assert(!Object.hasOwn(full,'enemyAggro'));for(const enemy of full.enemies)for(const key of ['damage','engagement','routeUntil','seenAt'])assert(!Object.hasOwn(enemy,key));
});

test('historical attacker churn stays bounded, and death/phase replacement prune unused enemy state',()=>{
 const {w,e}=setup(1);e.hp=e.maxHp=1000;
 for(let i=0;i<30;i++){
  for(const q of w.scenePlayers())w.disconnect(q);
  const q=w.allocate(`Synthetic history ${i}`,`test-only-history-${i}`);w.connect(q,q.name);put(q,w,24,22);w.s.time=i*.1;actualHit(w,q,e,1);
  assert(Object.keys(record(w,e).damage).length<=AGGRO_RULES.maxAttackers);
 }
 assert.equal(Object.keys(record(w,e).damage).length,AGGRO_RULES.maxAttackers);
 w.killEnemy(e,w.scenePlayers()[0].id);assert(!w.s.enemyAggro[e.id]);
 const e2=w.spawnEnemy('crab',24,20,false);w.aggro.state(e2);delete w.s.enemies[e2.id];assert(!w.serialize().enemyAggro[e2.id]);
});

test('old saves without enemyAggro preserve enemy HP and phase, no public or economic reset',()=>{
 const {w,p,e}=setup(1);actualHit(w,p,e,5);const saved=w.serialize();delete saved.enemyAggro;
 const clone=new w.constructor(w.c,saved,{onlineRoster:true});
 assert.deepEqual(clone.s.enemyAggro,{});assert.equal(clone.s.enemies[e.id].hp,e.hp);assert.equal(clone.s.phase,w.s.phase);assert.deepEqual(clone.s.bank,saved.bank);assert.deepEqual(clone.s.items,saved.items);
});

test('a successfully deployed decoy outside home leash cannot pull a nearby wild enemy outside',()=>{
 const {w,p,e}=setup(1);e.x=e.homeX+30;e.y=w.ground(e.x,e.z);put(p,w,54,27);
 assert.equal(w.selectEnemyTarget(e).id,p.id);w.addItems(w.bag(p),'decoy_alarm',1);
 assert.equal(command(w,p,'UseTool',{definitionId:'decoy_alarm',x:57,z:20}).ok,true);
 const decoy=w.director.s.deployables.find(d=>d.kind==='decoy');assert(decoy);assert(!w.aggro.inside(e,decoy));
 assert.notEqual(w.selectEnemyTarget(e)?.id,decoy.id);
});

test('a legal new decoy cannot cancel an already latched wild return',()=>{
 const {w,p,e}=setup(1);e.x=e.homeX+30;e.y=w.ground(e.x,e.z);put(p,w,54,22);assert.equal(w.selectEnemyTarget(e).id,p.id);
 put(p,w,57,20);assert.equal(w.selectEnemyTarget(e),null);assert.equal(record(w,e).returning,true);
 put(p,w,52,25);w.addItems(w.bag(p),'decoy_alarm',1);assert.equal(command(w,p,'UseTool',{definitionId:'decoy_alarm',x:52,z:20}).ok,true);
 assert.equal(w.selectEnemyTarget(e),null);assert.equal(record(w,e).returning,true);
});

for(const type of ['crab','courier'])test(`returning ${type} retains the full successful flash-note stun`,()=>{
  const {w,p,e}=setup(1,type);e.x=e.homeX+33;e.y=w.ground(e.x,e.z);put(p,w,e.x,e.z+3);
  assert(w.aggro.returnGate(e));w.addItems(w.bag(p),'flash_note',1);
  assert.equal(command(w,p,'UseTool',{definitionId:'flash_note',x:e.x,z:e.z}).ok,true);
  assert.equal(e.state,'STUNNED');const before={x:e.x,z:e.z};w.s.time+=.1;w.updateEnemy(e,.1);
  assert.equal(e.state,'STUNNED',`${type}: returning must not erase a successful tool effect`);
  assert(e.phaseRemaining>=.89);assert.deepEqual({x:e.x,z:e.z},before);
});

test('saved return-to-route cooldown keeps its original deadline after reconnect',()=>{
 const {w,p,e}=setup(1,'crab',true);w.selectEnemyTarget(e);w.s.time=4;w.selectEnemyTarget(e);const until=record(w,e).routeUntil;
 w.s.time=4.5;const clone=restored(w),q=clone.s.players[p.id],other=clone.s.enemies[e.id];clone.connect(q,q.name);put(q,clone,24,22);actualHit(clone,q,other,1);
 assert(!clone.selectEnemyTarget(other).lifeState);assert.equal(record(clone,other).routeUntil,until);assert.equal(record(clone,other).engagement,null);
 clone.s.time=until+.01;assert(clone.selectEnemyTarget(other).lifeState);
});

for(const [type,gap] of [['crab',10],['boss_crab',7]])test(`${type} admitted retaliation target remains legal immediately after opening its window`,()=>{
 const {w,p,e}=setup(1,type,true);put(p,w,e.x+gap,e.z);assert(w.lineVisible(e,p));actualHit(w,p,e,1);
 assert.equal(w.selectEnemyTarget(e)?.id,p.id,'attacker is admitted by the configured retaliation distance');
 const deadline=record(w,e).engagement.until;w.s.time=.01;
 assert.equal(w.selectEnemyTarget(e)?.id,p.id,'same unchanged target must not invalidate the window created one tick earlier');
 assert.equal(record(w,e).engagement.until,deadline);
});
