// Offline history stays in saves; only current participants enter the active scene.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../config.mjs';
import {RoomRuntime} from '../room-runtime.mjs';
import {SurvivalWorld} from '../world.mjs';
const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
const member=n=>({peerId:'synthetic-peer-'+n,accountId:'synthetic-account-'+n,name:'合成队员'+n,ready:true});
function runtime(state=null,members=[member(0)]) {
  const room={id:'isolated-v073',ownerId:member(0).accountId,hostPeerId:member(0).peerId,status:'running',members};
  const saves=[],packets=[];
  const r=new RoomRuntime({config:structuredClone(config),state,room,now:()=>0,send:(peerId,json)=>packets.push({peerId,value:JSON.parse(json)}),save:async state=>{saves.push(structuredClone(state));return{revision:saves.length};}});
  const join=m=>{r.receive(m.peerId,{type:'hello'});const session=r.sessions.get(m.peerId);assert(session,'trusted synthetic member joins');return r.world.s.players[session.playerId];};
  return {r,room,saves,packets,join};
}
function fixture(count=2,{onlineRoster=true}={}) {
  const c=structuredClone(config);for(const gun of c.weapons){gun.hip_spread_deg=0;gun.ads_spread_deg=0;}
  const w=new SurvivalWorld(c,null,{onlineRoster}),ps=Array.from({length:count},(_,i)=>w.allocate('合成队员'+i,'synthetic-only-'+i));
  for(const p of ps)p.joinProtectionUntil=0;
  w.setPhase('DAY');w.s.phaseElapsed=0;w.s.enemies={};w.s.destructibles={};w.s.paused=false;return {w,ps,p:ps[0],q:ps[1]};
}
function at(w,p,x,z){Object.assign(p,{x,z,y:w.ground(x,z),vy:0,swimming:false});}
function advance(w,seconds){for(let i=0;i<Math.ceil(seconds*30);i++)w.step(1/30);}
function owned(w,p){const ids=[w.bag(p),...Object.values(p.equipment).map(id=>w.s.containers[id])].flatMap(c=>c.itemIds);return ids.map(id=>structuredClone(w.s.items[id])).sort((a,b)=>a.id.localeCompare(b.id));}
function snapshotIds(r){return r.state().players.map(p=>p.id).sort();}

test('three-person save -> owner only -> distinct newcomer -> old peer restores the same upgraded gear and exactly one new grant',async()=>{
  const initial=runtime(null,[member(0),member(1),member(2)]),players=[0,1,2].map(i=>initial.join(member(i))),old=players[1];
  const gun=initial.r.world.equipped(old,'weapon');gun.level=2;gun.magazineAmmo=7;gun.revision++;old.hp=63;
  const oldGear=owned(initial.r.world,old),bank=structuredClone(initial.r.world.s.bank);
  await initial.r.freezeAndSave();const restored=runtime(initial.saves.at(-1));const host=restored.join(member(0));
  const firstVisible=snapshotIds(restored.r),newcomer=member(3);
  restored.r.setRoom({...restored.room,members:[member(0),newcomer]});const newcomerPlayer=restored.join(newcomer);const secondVisible=snapshotIds(restored.r);
  const returning={...member(1),peerId:'synthetic-returning-peer'};
  restored.r.setRoom({...restored.room,members:[member(0),newcomer,returning]});const rejoined=restored.join(returning);
  assert.equal(rejoined.id,old.id);assert.notEqual(newcomerPlayer.id,old.id);assert.deepEqual(owned(restored.r.world,rejoined),oldGear);assert.equal(rejoined.hp,63);
  assert.equal(restored.r.world.s.bank.credits,bank.credits+config.economy.start_c_per_player);
  assert.equal(restored.r.world.s.bank.materials,bank.materials+config.economy.start_m_per_player);
  assert.equal(Object.keys(restored.r.world.serialize().players).length,4,'all historical identities remain in the save');
  assert.deepEqual(firstVisible,[host.id],'cold load must not publish absent historical bodies');
  assert.deepEqual(secondVisible,[host.id,newcomerPlayer.id].sort());
  assert.deepEqual(snapshotIds(restored.r),[host.id,newcomerPlayer.id,rejoined.id].sort());
  assert(restored.r.state().players.every(p=>p.connected));restored.r.world.assertInvariants();
});

test('online mode disconnect immediately hides player and freezes them beyond old grace; cold restart never drops old equipment',()=>{
  const {w,p,q}=fixture();at(w,p,20,20);at(w,q,0,-30);q.hp=61;const equipment=owned(w,q);w.disconnect(q);
  advance(w,65);assert.equal(q.lifeState,'ALIVE');assert.equal(q.hp,61);assert.deepEqual(owned(w,q),equipment);assert(!w.publicState().players.some(x=>x.id===q.id));
  const restored=new SurvivalWorld(config,w.serialize(),{onlineRoster:true});restored.connect(restored.s.players[p.id],'合成房主');advance(restored,1);assert.deepEqual(owned(restored,restored.s.players[q.id]),equipment);assert.equal(restored.s.statistics.deaths,0);
});

test('legacy dedicated mode retains its explicitly tested 60-second disconnection drop contract',()=>{
  const {w,q}=fixture(2,{onlineRoster:false});w.disconnect(q);advance(w,config.session.reconnect_seconds+1);assert.equal(q.lifeState,'DEAD_WAIT');assert.equal(owned(w,q).length,0);assert.equal(w.s.statistics.deaths,1);
});

test('disconnect cancels pending reload/melee/work/fishing without refunding fired ammo or consuming reserve ammo',()=>{
  const {w,p,q}=fixture();at(w,p,20,20);at(w,q,0,-30);const gun=w.equipped(q,'weapon');gun.magazineAmmo=7;const reserve=w.count(q,'ammo_light');
  w.reload(q);q.meleePending={at:w.s.time+.16,yaw:0,pitch:0};q.jumpQueued=true;q.velocity={x:3,y:1,z:0};q.moveSpeed=3;
  w.disconnect(q);assert.equal(q.reload,null);assert.equal(q.meleePending,null);assert(!q.jumpQueued);assert.equal(q.moveSpeed,0);assert.deepEqual(q.input,{});
  advance(w,4);assert.equal(gun.magazineAmmo,7);assert.equal(w.count(q,'ammo_light'),reserve);
  w.connect(q,'合成返回');w.beginWork(q,{kind:'Upgrade',targetId:gun.id,duration:90,costC:20,costM:2});const bank=structuredClone(w.s.bank);w.disconnect(q);
  assert.equal(q.work,null);assert.equal(gun.lockedBy,undefined);assert.equal(w.s.bank.reservedCredits,0);assert.equal(w.s.bank.reservedMaterials,0);assert.equal(w.s.bank.credits,bank.credits);assert.equal(w.s.bank.materials,bank.materials);
  w.connect(q,'合成返回');q.fishing={id:'synthetic-line',state:'WAIT',x:0,z:-105};w.disconnect(q);assert.equal(q.fishing,null);w.assertInvariants();
});

test('already-dead and downed historical players are not granted equipment; offline downed clock resumes only on rejoin',()=>{
  const {w,p,q,ps}=fixture(3);at(w,p,20,20);const dead=ps[2];w.setPhase('NIGHT');w.s.night.resolved=true;w.die(dead);w.disconnect(dead);w.enterDowned(q);q.downedHp=23*q.downedBleedRate;q.downedRemaining=23;w.disconnect(q);const gear=owned(w,q);
  advance(w,10);assert.equal(q.lifeState,'DOWNED');assert.equal(q.downedRemaining,23);assert.deepEqual(owned(w,q),gear);
  w.connect(q,'合成返回');assert.equal(q.lifeState,'DOWNED');assert.equal(q.downedRemaining,23);advance(w,.1);assert(q.downedRemaining<23);assert.deepEqual(owned(w,q),gear);
  w.connect(dead,'合成已死亡返回');assert.equal(dead.lifeState,'DEAD_WAIT');assert.equal(owned(w,dead).length,0);
});

test('absent players cannot attract wild enemies or consume a projectile collision and queued damage',()=>{
  const {w,p,q}=fixture();at(w,p,20,20);at(w,q,0,-31);w.disconnect(q);const e=w.spawnEnemy('crab',0,-30);
  assert.equal(w.selectEnemyTarget(e)?.id??null,null,'a nearby offline player is not an aggro target');
});

test('already queued damage and projectile paths skip offline bodies even after an earlier target lock',()=>{
  const {w,p,q}=fixture();at(w,p,20,20);at(w,q,0,-31);w.disconnect(q);const e=w.spawnEnemy('crab',0,-30);
  w.damageQueue.push({target:q.id,actorId:e.id,damage:25});w.resolveDamage();assert.equal(q.hp,100,'damage queued before disconnect is discarded for absent target');
  const id='synthetic-projectile';w.s.projectiles[id]={id,x:0,y:q.y+1,z:-29,vx:0,vy:0,vz:-10,radius:.1,damage:25,actorId:e.id,life:4};w.updateProjectiles(.3);w.resolveDamage();assert(w.s.projectiles[id],'projectile passes through absent position');assert.equal(q.hp,100);
});

test('enabled friendly fire and knife selection skip an absent body in front of a living enemy',()=>{
  const {w,p,q}=fixture();at(w,p,0,-25);at(w,q,0,-25.8);w.disconnect(q);w.s.friendlyFire=true;const e=w.spawnEnemy('crab',0,-26.7);e.hp=e.maxHp=100;
  const pitch=Math.atan2(e.y+.65-(p.y+w.c.player.camera_height),1.7);
  w.fire(p,0,pitch);w.resolveDamage();assert(e.hp<100,'bullet hits real enemy behind an absent body');assert.equal(q.hp,100);
  e.hp=100;at(w,e,0,-26.7);p.heldSlot='melee';p.equipUntil=0;w.melee(p,0,0);const pending=p.meleePending;p.meleePending=null;w.resolveMelee(p,pending);w.resolveDamage();assert.equal(e.hp,75);assert.equal(q.hp,100);
});

test('an offline downed target cannot be revived and disconnect cancels a rescue already underway',()=>{
  const {w,p,q}=fixture();w.setPhase('NIGHT');w.s.night.resolved=true;at(w,p,0,-25);at(w,q,0,-26);w.enterDowned(q);w.disconnect(q);
  assert.equal(w.command(p,{requestId:1,command:'Revive',targetId:q.id}).ok,false);
  w.connect(q,'合成返回');assert(w.command(p,{requestId:2,command:'Revive',targetId:q.id}).ok);w.disconnect(q);
  advance(w,.2);assert.equal(p.work,null);assert.equal(q.lifeState,'DOWNED');assert.equal(q.revivesUsed,0);assert.equal(q.lockedBy,undefined);
});

test('a stale pre-disconnect melee windup cannot execute after reconnect',()=>{
  const {w,p,q}=fixture();at(w,p,20,20);at(w,q,0,-25);q.heldSlot='melee';const e=w.spawnEnemy('crab',0,-26.5);e.hp=e.maxHp=100;e.state='STUNNED';e.phaseRemaining=100;
  w.melee(q,0,0);w.disconnect(q);w.connect(q,'合成返回');advance(w,.3);assert.equal(e.hp,100);assert(!w.drainEvents().some(e=>e.eventType==='Shot'&&e.payload.actorId===q.id));
});

test('boss slam and charge do not damage or register an absent historical body',()=>{
  const {w,p,q}=fixture();at(w,p,20,20);at(w,q,0,-31);w.disconnect(q);const boss=w.spawnEnemy('boss_crab',0,-30,true);
  boss.state='WINDUP';boss.attackKind='slam';boss.phaseRemaining=0;w.updateBoss(boss,.01);w.resolveDamage();assert.equal(q.hp,100);
  boss.state='CHARGE';boss.yaw=0;boss.chargeHit=[];boss.chargeRemaining=4;w.updateBoss(boss,.1);w.resolveDamage();assert.equal(q.hp,100);assert(!boss.chargeHit.includes(q.id));
});

test('an offline body no longer blocks a turret firing lane; its living replacement still blocks it',()=>{
  const {w,p,q}=fixture();at(w,p,20,20);const t=w.s.turrets.T01;Object.assign(t,{level:1,hp:250,maxHp:250,ammo:3,capacity:60,fireAt:0});
  const e=w.spawnEnemy('crab',t.x,t.z-12);e.hp=e.maxHp=100;at(w,q,t.x,t.z-9);w.disconnect(q);
  w.updateTurrets();w.resolveDamage();assert.equal(t.ammo,2,'absent historical body cannot block turret');assert(e.hp<100);
  w.connect(q,'合成返回');at(w,q,t.x,t.z-9);t.fireAt=0;w.updateTurrets();assert.equal(t.ammo,2,'connected body still blocks firing lane');
});

test('cold historical player inside destroyed core does not move or prevent restoration; connect safely clears their capsule',()=>{
  const {w,p,q}=fixture();w.s.buildings.core.hp=0;w.setPhase('RECOVERY');w.s.recovery={coreReady:false,duration:420,destroyedSockets:[],debris:[]};at(w,p,0,2.2);at(w,q,0,0);w.disconnect(q);const gear=owned(w,q);
  assert(w.command(p,{requestId:1,command:'RecoveryWork',targetId:'core'}).ok);p.input={interact:true};w.updateWork(p,config.recovery.core_rebuild_seconds+.1);
  assert.equal(w.s.buildings.core.hp,w.s.buildings.core.maxHp);assert.equal(q.x,0);assert.equal(q.z,0);assert.deepEqual(owned(w,q),gear);
  w.connect(q,'合成返回');assert.equal(w.blocked(q.x,q.y,q.z,w.c.player.capsule_radius),undefined);assert.deepEqual(owned(w,q),gear);w.assertInvariants();
});

test('night locks actual online team, mid-night return leaves health/count unchanged, defeat drops only online equipment',()=>{
  const {w,p,q,ps}=fixture(3);w.disconnect(q);w.disconnect(ps[2]);const oldGear=owned(w,q),otherGear=owned(w,ps[2]);w.startNight();assert.equal(w.s.night.playerCount,1);assert.equal(w.s.night.bossHp,600);
  const boss=w.s.enemies[w.s.night.bossId];boss.hp=321;const pending=w.s.night.pending.length;w.connect(q,'合成返回');assert.equal(w.s.night.playerCount,1);assert.equal(boss.hp,321);assert.equal(w.s.night.pending.length,pending);w.disconnect(q);
  w.enterDowned(p);w.resolveNight();assert.equal(w.s.phase,'NIGHT');w.die(p);w.resolveNight();assert.equal(w.s.phase,'RECOVERY');assert.equal(w.s.statistics.breaches,1);assert.equal(w.s.statistics.deaths,1);assert.deepEqual(owned(w,q),oldGear);assert.deepEqual(owned(w,ps[2]),otherGear);
  const corpses=Object.values(w.s.containers).filter(c=>c.type==='corpse');assert.equal(corpses.length,1);assert.equal(corpses[0].ownerSlotId,p.slotId);w.assertInvariants();
});

test('success transition does not respawn or mutate absent personal status and reconnect does not renew supplies',()=>{
  const {w,p,q}=fixture();at(w,p,20,20);at(w,q,0,-30);q.hp=37;w.disconnect(q);const gear=owned(w,q);w.startNight();w.s.phaseElapsed=config.cycle.night_survival_seconds;w.resolveNight();
  assert.equal(w.s.phase,'PREP');assert.equal(q.hp,37);assert.equal(q.x,0);assert.equal(q.z,-30);assert.deepEqual(owned(w,q),gear);const funds=structuredClone(w.s.bank);w.connect(q,'合成返回');assert.equal(q.hp,37);assert.deepEqual(owned(w,q),gear);assert.deepEqual(w.s.bank,funds);
});

test('offline DOWNED returning during daytime preserves blood and gear; dead return preserves respawn wait',()=>{
  const {w,q,ps}=fixture(3);w.enterDowned(q);q.downedHp=21*q.downedBleedRate;q.downedRemaining=21;q.revivesUsed=1;w.disconnect(q);const gear=owned(w,q);const dead=ps[2];w.die(dead);w.disconnect(dead);
  const funds=structuredClone(w.s.bank);w.startNight();assert.equal(q.revivesUsed,0,'per-night allowance resets for the new night');
  w.setPhase('DAY');w.connect(q,'合成倒地返回');w.connect(dead,'合成死亡返回');assert.equal(q.lifeState,'DOWNED');assert.equal(q.hp,0);assert.equal(q.downedRemaining,21);assert.equal(dead.lifeState,'ALIVE');assert.equal(owned(w,dead).length,0);assert.deepEqual(owned(w,q),gear);assert.deepEqual(w.s.bank,funds);
});

test('private inventory and identity remain inaccessible despite retaining historical records in the save',()=>{
  const {w,p,q}=fixture();w.disconnect(q);const gun=w.equipped(q,'weapon');
  const transfer=w.command(p,{requestId:1,command:'Transfer',payload:{itemId:gun.id,toContainerId:p.backpackId}});assert.equal(transfer.ok,false);
  const pickup=w.command(p,{requestId:2,command:'Pickup',targetId:q.equipment.weapon});assert.equal(pickup.ok,false);
  assert(!JSON.stringify(w.publicState()).includes('synthetic-only-'),'private synthetic identity hashes never appear in state');assert.equal(w.equipped(q,'weapon').id,gun.id);w.assertInvariants();
});
