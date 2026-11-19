import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../config.mjs';
import { SurvivalWorld } from '../world.mjs';
const source=new URL('../../../client/survival/balance.json',import.meta.url);
const base=await loadConfig(source);
function fixture(count=1,modify=()=>{}) { const config=structuredClone(base);modify(config);for(const row of config.director.phaseRows)for(const [phase,key]of Object.entries({PREP:"prep_seconds",DAY:"day_seconds",RETURN:"return_seconds",NIGHT:"night_survival_seconds"}))if(config.cycle[key]!==base.cycle[key])row[phase]=config.cycle[key];const w=new SurvivalWorld(config),ps=Array.from({length:count},(_,i)=>w.allocate(`渔民${i+1}`,`private-test-${i}`));for(const p of ps)p.joinProtectionUntil=0;w.s.destructibles={};return {w,p:ps[0],ps}; }
function input(w,p,values={}) { w.input(p,{seq:p.inputAck+1,dx:0,dz:0,yaw:p.yaw,pitch:p.pitch,...values}); }
function advance(w,seconds,values={}) { const dt=1/w.c.session.server_hz;for(let time=0;time<seconds-1e-8;time+=dt){for(const p of Object.values(w.s.players))if(p.connected)input(w,p,typeof values==='function'?values(p):values);w.step(Math.min(dt,seconds-time));} }
function command(w,p,command,targetId,payload={},extra={}) { return w.command(p,{type:'command',requestId:p.requestHighWater+1,command,targetId,payload,...extra}); }
function position(w,p,x,z) { Object.assign(p,{x,y:w.ground(x,z),z,vy:0}); }
function day(w) { w.beginDayBarrier();w.finishDayBarrier();w.s.destructibles={}; }

test('4 persistent slots, exact first grant, no reset on reconnect, account hashes excluded from state',()=>{
  const {w,p,ps}=fixture(4,c=>{c.baseline.max_players=4;});assert.equal(w.s.bank.credits,240);assert.equal(w.s.bank.materials,160);assert.equal(w.count(p,'ammo_light'),40);assert.equal(w.equipped(p,'weapon').magazineAmmo,20);assert.equal(w.count(p,'bandage'),2);
  assert.throws(()=>w.allocate('第五人','unused'),/槽/);const ids=Object.keys(w.s.items);p.hp=42;w.disconnect(p);w.connect(p,'改名');assert.equal(p.hp,42);assert.deepEqual(Object.keys(w.s.items),ids);assert.equal(w.s.hostId,ps[1].id);
  const state=JSON.stringify(w.publicState());assert(!state.includes('private-test'));assert(!state.includes('tokenHash'));w.assertInvariants();
});
test('movement authority, wall/gate collision, pause, swimming/oxygen and stamina',()=>{
  const {w,p}=fixture();position(w,p,1.5,4.8);w.s.buildings.G01.gateOpen=false;advance(w,1,{dz:1});assert(p.z<5.6);w.s.buildings.G01.gateOpen=true;advance(w,1,{dz:1});assert(p.z>6.5);
  position(w,p,20,0);advance(w,1,{dx:100,sprint:true});assert(p.x<=26.51);assert(p.stamina<100);w.disconnect(p);const time=w.s.time;advance(w,2);assert.equal(w.s.time,time);w.connect(p,'渔民');day(w);position(w,p,105,0);advance(w,16);assert(p.swimming);assert(p.hp<100);
});
test('transactions debit once, reject stale/no funds/full capacity, preserve unique equipment on swap',()=>{
  const {w,p}=fixture();position(w,p,-3.5,-.5);const message={type:'command',command:'Buy',requestId:1,payload:{definitionId:'ammo_light'}};
  assert(w.command(p,message).ok);const credits=w.s.bank.credits;assert(w.command(p,message).ok);assert.equal(w.s.bank.credits,credits);assert.equal(w.count(p,'ammo_light'),60);
  w.s.bank.credits=0;assert.equal(command(w,p,'Buy',null,{definitionId:'carbine'}).code,'NO_FUNDS');w.s.bank.credits=1000;w.s.bank.materials=100;
  const beforeCraftOnly=structuredClone({items:w.s.items,containers:w.s.containers,bank:w.s.bank});assert.equal(command(w,p,'Buy',null,{definitionId:'rod_pro',replace:true}).code,'CRAFT_ONLY');assert.deepEqual({items:w.s.items,containers:w.s.containers,bank:w.s.bank},beforeCraftOnly);
  const replacement=w.createItem('rod_light',1,w.bag(p));assert(command(w,p,'SwitchEquip',null,{itemId:replacement.id}).ok);assert.equal(w.equipped(p,'rod').id,replacement.id);assert(w.bag(p).itemIds.some(id=>w.s.items[id].definitionId==='rod_basic'));
  const item=w.s.items[w.bag(p).itemIds[0]];assert.equal(command(w,p,'Transfer',null,{itemId:item.id,toContainerId:'storage'},{expectedRevision:999}).code,'STALE_REVISION');w.assertInvariants();
});
test('reserve budget and target lock, interrupt upgrade, complete repair/upgrade and destroyed rebuild',()=>{
  const {w,p,ps}=fixture(2);w.s.bank.credits=500;position(w,p,-4.5,-4.1);position(w,ps[1],-4.5,-4);
  const wall=w.s.buildings.W01;assert(command(w,p,'Upgrade',wall.id).ok);assert.equal(w.s.bank.reservedCredits,40);assert.equal(command(w,ps[1],'Upgrade',wall.id).code,'BUSY');
  advance(w,.4,{dx:1,interact:true});assert.equal(p.work,null);assert.equal(w.s.bank.reservedCredits,0);position(w,p,-4.5,-4.1);assert(command(w,p,'Upgrade',wall.id).ok);advance(w,4.05,{interact:true});assert.equal(wall.level,2);assert.equal(wall.hp,700);assert.equal(w.s.bank.credits,460);
  wall.hp=650;assert(command(w,p,'Repair',wall.id).ok);advance(w,2.05,{interact:true});assert.equal(wall.hp,700);
  wall.hp=0;assert(command(w,p,'Rebuild',wall.id).ok);advance(w,6.05,{interact:true});assert.equal(wall.hp,175);w.assertInvariants();
});
test('bandage completion consumes once; damage and menu cancel reload/work',()=>{
  const {w,p}=fixture();p.hp=40;assert(command(w,p,'UseBandage').ok);advance(w,1);w.damageQueue.push({target:p.id,actorId:'test_enemy',damage:1});w.resolveDamage();assert.equal(p.work,null);assert.equal(w.count(p,'bandage'),2);
  assert(command(w,p,'UseBandage').ok);advance(w,3.05);assert.equal(p.hp,74);assert.equal(w.count(p,'bandage'),1);w.equipped(p,'weapon').magazineAmmo=0;assert(command(w,p,'Reload').ok);assert(command(w,p,'CancelWork').ok);assert.equal(p.reload,null);
});
test('finite bullets, ownership, reload, aimed range/cover, fake damage ignored and single-target friendly fire',()=>{
  const {w,p,ps}=fixture(2);day(w);w.s.enemies={};position(w,p,20,10);position(w,ps[1],22,10);p.pitch=-.1;const enemy=w.spawnEnemy('crab',20,0);enemy.state='STUNNED';enemy.phaseRemaining=100;
  const hp=enemy.hp;assert(command(w,p,'Fire',null,{yaw:Math.PI,pitch:0,damage:999,targetId:enemy.id}).ok);w.resolveDamage();assert.equal(enemy.hp,hp);advance(w,.21);assert(command(w,p,'Fire',null,{yaw:0,pitch:-.1,damage:999}).ok);w.resolveDamage();assert.equal(enemy.hp,40);assert.equal(w.equipped(p).magazineAmmo,18);
  w.equipped(p).magazineAmmo=0;const reserve=w.count(p,'ammo_light');assert(command(w,p,'Reload').ok);advance(w,2.05);assert.equal(w.equipped(p).magazineAmmo,20);assert.equal(w.count(p,'ammo_light'),reserve-20);
  position(w,ps[1],20,6);advance(w,.3);assert(command(w,p,'Fire',null,{yaw:0,pitch:-.1}).ok);w.resolveDamage();assert.equal(ps[1].hp,100);
  assert.equal(command(w,ps[1],'Settings',null,{friendlyFire:true}).code,'HOST_ONLY');assert(command(w,p,'Settings',null,{friendlyFire:true}).ok);advance(w,.21);const enemyBefore=w.s.enemies[enemy.id]?.hp;assert(command(w,p,'Fire',null,{yaw:0,pitch:-.1}).ok);w.resolveDamage();assert(ps[1].hp<100);assert.equal(w.s.enemies[enemy.id]?.hp,enemyBefore);
  position(w,p,0,8);const covered=w.spawnEnemy('crab',0,0);covered.state='STUNNED';covered.phaseRemaining=100;advance(w,.21);assert(command(w,p,'Fire',null,{yaw:0,pitch:-.15}).ok);w.resolveDamage();assert.equal(covered.hp,60);w.assertInvariants();
});
test('shotgun incremental reload survives cancel and rifle fire cooldown survives switch',()=>{
  const {w,p}=fixture();const gun=w.equipped(p);w.removeItem(gun);const shotgun=w.createItem('shotgun',1,w.s.containers[p.equipment.weapon]);w.addItems(w.bag(p),'ammo_shell',8);w.reload(p);advance(w,1.01);assert.equal(shotgun.magazineAmmo,1);assert.equal(w.count(p,'ammo_shell'),7);command(w,p,'CancelWork');advance(w,2);assert.equal(shotgun.magazineAmmo,1);
  w.removeItem(shotgun);const rifle=w.createItem('rifle',1,w.s.containers[p.equipment.weapon],{magazineAmmo:5});assert(command(w,p,'Fire',null,{yaw:0,pitch:.5}).ok);command(w,p,'SwitchEquip',null,{slot:'rod'});command(w,p,'SwitchEquip',null,{slot:'weapon'});advance(w,.4);assert.equal(command(w,p,'Fire',null,{yaw:0,pitch:.5}).code,'BUSY');assert.equal(rifle.magazineAmmo,4);
});
test('tension fishing lands a living fish without quota use, defeat enables pickup, breakage creates no fish',()=>{
  const {w,p}=fixture(1,c=>{c.fishing.open_water.weights=[{creature:'silverfish',weight:1}];c.fishing.bite_wait_min=.1;c.fishing.bite_wait_max=.1;});day(w);w.s.enemies={};position(w,p,-34,0);p.heldSlot='rod';const quota=w.s.pools.near.quota;p.pendingSeaCatch={creature:'silverfish',rare:false,day:w.s.dayIndex};
  assert(command(w,p,'Cast','near').ok);advance(w,.95);assert.equal(p.fishing.state,'BITE');assert(command(w,p,'Hook').ok);
  for(let i=0;i<800&&p.fishing;i++)advance(w,1/30,{reel:(p.fishing?.tension??0)<55});assert.equal(p.fishing,null);assert.equal(w.s.pools.near.quota,quota);const landed=Object.values(w.s.enemies).find(e=>e.definitionId==='silverfish');assert(landed);assert.equal(w.count(p,'catch_shore'),0);assert.equal(command(w,p,'Pickup',landed.id).code,'INVALID_TARGET');w.damageQueue.push({target:landed.id,actorId:p.id,damage:100,weaponId:'knife'});w.resolveDamage();const box=Object.values(w.s.containers).find(c=>c.source==='fishing');assert(command(w,p,'Pickup',box.id).ok);assert.equal(w.count(p,'catch_shore'),1);
  assert(command(w,p,'Cast','near').ok);advance(w,.95);command(w,p,'Hook');advance(w,8,{reel:true});assert.equal(p.fishing,null);assert.equal(w.s.pools.near.quota,quota);assert.equal(Object.keys(w.s.enemies).length,0);
});
test('shared water has no two-line quota, damage cancels and world transition clears old lines',()=>{
  const {w,ps}=fixture(3);day(w);w.s.enemies={};for(const p of ps){position(w,p,-34,0);p.heldSlot='rod';}assert.equal(w.s.pools.near.quota,36);for(const p of ps)assert(command(w,p,'Cast','near').ok);assert.equal(w.publicState().pools[0].activeLines,3);w.damageQueue.push({target:ps[0].id,actorId:'enemy',damage:1});w.resolveDamage();assert.equal(ps[0].fishing,null);w.startNight();assert.equal(ps[1].fishing,null);
});
test('finite generated search nodes, held search, partial pickup and one-source inventory ledger',()=>{
  const {w,p}=fixture();day(w);assert.equal(Object.keys(w.s.nodes).length,10);assert.equal(Object.keys(w.s.enemies).length,6);w.s.enemies={};const node=Object.values(w.s.nodes).find(n=>n.kind==='treasure'&&n.zoneId==='hunt');position(w,p,node.x+1,node.z);assert(command(w,p,'Search',node.id).ok);advance(w,1.05,{interact:true});assert.equal(node.state,'depleted');assert.equal(w.count(p,'scrap'),6);assert.equal(w.count(p,'spring_parts'),3);assert.equal(w.count(p,'sealed_cell'),2);assert.equal(w.count(p,'treasure'),1);assert.equal(command(w,p,'Search',node.id).code,'NOT_FOUND');
  const box=w.createContainer('loot',1,{x:p.x,y:p.y,z:p.z});w.createItem('scrap',50,box);while(w.bag(p).itemIds.length<12)w.createItem('knife',1,w.bag(p));assert(command(w,p,'Pickup',box.id).ok);assert.equal(w.count(p,'scrap'),50);assert.equal(w.s.items[box.itemIds[0]].quantity,6);w.assertInvariants();
});
test('death moves every instance and loaded magazine once, day empty respawn, loan invalidation anywhere',()=>{
  const {w,p}=fixture();day(w);w.s.enemies={};const ids=[...w.bag(p).itemIds,...Object.values(p.equipment).flatMap(id=>w.s.containers[id].itemIds)],gunId=w.equipped(p).id;w.equipped(p).magazineAmmo=7;w.die(p);w.die(p);const corpses=Object.values(w.s.containers).filter(c=>c.type==='corpse');assert.equal(corpses.length,1);assert.deepEqual(new Set(corpses[0].itemIds),new Set(ids));assert.equal(w.s.items[gunId].magazineAmmo,7);advance(w,15.05);assert.equal(p.lifeState,'ALIVE');assert.equal(w.bag(p).itemIds.length,0);assert.equal(w.equipped(p),undefined);
  w.toPrep();position(w,p,-3.5,-.5);assert(command(w,p,'ClaimTool',null,{definitionId:'rod_basic'}).ok);const loan=w.equipped(p,'rod');w.die(p);advance(w,15.05);position(w,p,-3.5,-.5);assert(command(w,p,'ClaimTool',null,{definitionId:'rod_basic'}).ok);assert.equal(w.s.items[loan.id],undefined);assert.equal(Object.values(w.s.items).filter(i=>i.loanOwnerSlotId===p.slotId&&i.definitionId==='rod_basic').length,1);w.assertInvariants();
});
test('night aid interruption is free, repeat downs retain gear until blood is depleted, all dead triggers defeat',()=>{
  const {w,p,ps}=fixture(2);w.startNight();w.s.enemies={};w.s.night.pending=[];position(w,p,10,10);position(w,ps[1],11,10);w.damageQueue.push({target:p.id,actorId:'enemy',damage:100});w.resolveDamage();assert.equal(p.lifeState,'DOWNED');assert(command(w,ps[1],'Revive',p.id).ok);advance(w,1,{interact:true});command(w,ps[1],'CancelWork');assert.equal(p.revivesUsed,0);assert(command(w,ps[1],'Revive',p.id).ok);advance(w,6.05,{interact:true});assert.equal(p.hp,30);assert.equal(p.revivesUsed,1);w.damageQueue.push({target:p.id,actorId:'enemy',damage:100});w.resolveDamage();assert.equal(p.lifeState,'DOWNED');assert.equal(p.downedRemaining,45);w.damageQueue.push({target:ps[1].id,actorId:'enemy',damage:100});w.resolveDamage();w.resolveNight();assert.equal(w.s.phase,'NIGHT');for(const q of ps){q.downedGraceRemaining=0;w.damageQueue.push({target:q.id,actorId:'enemy',damage:40});}w.resolveDamage();assert(ps.every(q=>q.lifeState==='DEAD_WAIT'));w.resolveNight();assert.equal(w.s.phase,'RECOVERY');
});
test('disconnect grace, host migration, saved restart does not create corpses or advance offline time',()=>{
  const {w,p,ps}=fixture(2);day(w);w.s.enemies={};w.disconnect(p);assert.equal(w.s.hostId,ps[1].id);advance(w,59);assert.equal(p.lifeState,'ALIVE');const saved=w.serialize(),restored=new SurvivalWorld(base,saved);assert.equal(restored.s.time,w.s.time);assert.equal(restored.s.players[p.id].hp,p.hp);restored.connect(restored.s.players[ps[1].id],'返回');advance(restored,5);assert.equal(restored.s.players[p.id].lifeState,'ALIVE');assert.equal(Object.values(restored.s.containers).filter(c=>c.type==='corpse').length,0);
  advance(w,1.1);assert.equal(p.lifeState,'DEAD_WAIT');assert.equal(w.s.lockedPlayerCount,2);
});
test('waves scale by locked count, queue respects cap and emits all scheduled creatures',()=>{
  const {w}=fixture(4);w.s.lockedPlayerCount=4;w.startNight();assert.equal(w.s.night.pending.length,Math.ceil(5*2.95)+Math.ceil(1*2.95));w.s.phaseElapsed=100;w.s.time=100;
  for(let i=0;i<30;i++){w.updateNightQueue();w.s.time+=1.6;}const expectedAlive=Math.min(w.s.night.aliveCap,19);assert.equal(Object.values(w.s.enemies).length,expectedAlive);assert.equal(w.s.night.pending.length,19-expectedAlive);assert(w.s.enemies[w.s.night.bossId]);
  for(const e of Object.values(w.s.enemies))delete w.s.enemies[e.id];while(w.s.night.pending.length){w.s.time+=w.s.night.spawnInterval;w.updateNightQueue();}assert.equal(w.s.night.pending.length,0);assert.equal(w.s.night.spawned,19);
});
test('four-stage loop continues, boss telegraph/adds and same-tick core failure precedence',()=>{
  const {w,p}=fixture(1,c=>{c.cycle.prep_seconds=.1;c.cycle.day_seconds=.1;c.cycle.return_seconds=.1;c.cycle.night_survival_seconds=.1;});
  for(let stage=1;stage<=3;stage++){advance(w,.11);assert(w.needsBarrier);w.finishDayBarrier();advance(w,.22);assert.equal(w.s.phase,'NIGHT');assert.equal(w.s.threatStage,stage);w.s.night.pending=[];w.s.enemies={};advance(w,.11);assert.equal(w.s.phase,'PREP');}
  advance(w,.11);w.finishDayBarrier();advance(w,.22);const boss=w.s.enemies[w.s.night.bossId];boss.variantId='base';assert.equal(boss.hp,744);position(w,p,0,-20);boss.x=0;boss.z=-22;boss.y=w.ground(0,-22);w.updateBoss(boss,.01);assert.equal(boss.state,'WINDUP');assert(['claw_left','slam','charge'].includes(boss.attackKind));assert.equal(boss.phaseRemaining,boss.attackTimeline.windup);assert(boss.phaseRemaining>0&&boss.phaseRemaining<1.1);boss.hp=300;boss.state='RECOVER';boss.phaseRemaining=0;w.s.night.pending=[];w.updateBoss(boss,.01);assert.equal(w.s.night.addsSpawned,true);assert.equal(w.s.night.pending.length,2);
  w.damageQueue.push({target:boss.id,actorId:p.id,damage:9999});w.resolveDamage();w.s.phaseElapsed=.1;w.resolveNight();assert.equal(w.s.phase,'PREP');assert.equal(w.s.dayIndex,5);assert.equal(w.s.threatStage,4);assert(w.s.statistics.stage4BossDefeated);
  const other=fixture().w;other.s.threatStage=4;other.startNight();other.damageQueue.push({target:other.s.night.bossId,actorId:'player-1',damage:99999},{target:'core',actorId:'boss',damage:99999});other.resolveDamage();other.resolveNight();assert.equal(other.s.phase,'RECOVERY');
});
test('defeat loss ledger once, half stored stacks move, 8 ruined sockets, free labor rebuild and retained boxes',()=>{
  const {w,p}=fixture();w.s.bank.credits=101;w.s.bank.materials=81;for(let i=0;i<5;i++)w.createItem('knife',1,w.s.containers.storage);w.startNight();w.defeat();const dayIndex=w.s.dayIndex,credits=w.s.bank.credits,boxes=Object.values(w.s.containers).filter(c=>c.type==='recovery');assert.equal(credits,75);assert.equal(w.s.bank.materials,60);assert.equal(boxes[0].recoverableC,13);assert.equal(boxes[0].itemIds.length,3);assert.equal(w.s.recovery.destroyedSockets.length,8);w.defeat();assert.equal(w.s.bank.credits,credits);assert.equal(w.s.dayIndex,dayIndex);assert.equal(command(w,p,'Buy',null,{definitionId:'ammo_light'}).code,'OUT_OF_RANGE');position(w,p,-3.5,-.5);assert(command(w,p,'Buy',null,{definitionId:'ammo_light'}).ok);
  for(const debris of w.s.recovery.debris){position(w,p,debris.x,debris.z);assert(command(w,p,'RecoveryWork',debris.id).ok);advance(w,5.05,{interact:true});assert(debris.done);}
  position(w,p,0,2.2);assert(command(w,p,'RecoveryWork','core').ok);advance(w,8.05,{interact:true});assert.equal(w.s.phase,'RECOVERY');assert(w.s.phaseElapsed>0);assert.equal(w.s.buildings.core.hp,1500);assert(w.s.recovery.destroyedSockets.every(id=>w.s.buildings[id].hp===200));assert(w.s.containers[boxes[0].id]);w.assertInvariants();
});
test('actual crab AI attacks blocking wall, eel telegraph launches colliding projectiles, no night loot',()=>{
  const {w,p}=fixture();w.startNight();w.s.night.pending=[];w.s.enemies={};position(w,p,0,3);const crab=w.spawnEnemy('crab',0,-8,true);const before=w.s.buildings.W02.hp+w.s.buildings.W03.hp;advance(w,12);assert(w.s.buildings.W02.hp+w.s.buildings.W03.hp<before);assert(crab.z<=-5.5);
  w.toPrep();day(w);w.s.enemies={};position(w,p,20,30);const eel=w.spawnEnemy('eel',20,20);w.updateEnemy(eel,.01);assert.equal(eel.state,'WINDUP');assert.equal(eel.phaseRemaining,.55);advance(w,2.2);assert(p.hp<100);
  const nightCrab=w.spawnEnemy('crab',25,25,true);const count=Object.keys(w.s.containers).length;w.killEnemy(nightCrab,p.id);assert.equal(Object.keys(w.s.containers).length,count);
});
test('Boss closed armor and exposed back multipliers, body stays armored and surviving time wins',()=>{
  const {w,p}=fixture();day(w);w.s.enemies={};position(w,p,20,10);const boss=w.spawnEnemy('boss_crab',20,0,true);boss.yaw=0;boss.state='STUNNED';boss.phaseRemaining=100;
  assert(command(w,p,'Fire',null,{yaw:0,pitch:-.065}).ok);w.resolveDamage();assert.equal(boss.hp,1195);w.s.time+=.21;boss.weak=true;
  assert(command(w,p,'Fire',null,{yaw:0,pitch:-.065}).ok);w.resolveDamage();assert.equal(boss.hp,1155);w.s.time+=.21;position(w,p,20,-10);
  assert(command(w,p,'Fire',null,{yaw:Math.PI,pitch:-.065}).ok);w.resolveDamage();assert.equal(boss.hp,1150);
  w.s.threatStage=4;w.startNight();w.s.phaseElapsed=120;w.resolveNight();assert.equal(w.s.phase,'PREP');assert.equal(w.s.night.rewardClaimed,false);
});
test('ordinary night cannot end early after clear, deadline retreats without awards, bags expire only PREP day+2',()=>{
  const {w,p}=fixture();const box=w.createContainer('loot',1,{x:0,y:5,z:3,createdDay:1,expiresAfterDay:3});w.createItem('treasure',1,box);w.startNight();w.s.night.pending=[];w.s.enemies={};w.s.night.remaining=0;w.s.phaseElapsed=119.9;w.resolveNight();assert.equal(w.s.phase,'NIGHT');w.s.phaseElapsed=120;w.resolveNight();assert.equal(w.s.phase,'PREP');assert.equal(w.s.dayIndex,2);w.beginDayBarrier();assert(w.s.containers[box.id]);w.finishDayBarrier();w.startNight();w.s.phaseElapsed=120;const nightCrab=w.spawnEnemy('crab',0,-30,true);w.resolveNight();assert.equal(w.s.phase,'PREP');assert.equal(w.s.dayIndex,3);assert.equal(w.s.enemies[nightCrab.id],undefined);assert.equal(w.count(p,'catch_crab'),0);w.beginDayBarrier();assert.equal(w.s.containers[box.id],undefined);
});
test('concurrent purchase and unique pickup serialize; deposit excludes equipment; gun upgrade keeps instance ID',()=>{
  const {w,p,ps}=fixture(2);position(w,p,-3.5,-.5);position(w,ps[1],-3.5,-.5);w.s.bank.credits=20;const a=command(w,p,'Buy',null,{definitionId:'ammo_light'}),b=command(w,ps[1],'Buy',null,{definitionId:'ammo_light'});assert(a.ok);assert.equal(b.code,'NO_FUNDS');assert.equal(w.s.bank.credits,0);
  const box=w.createContainer('loot',1,{x:p.x,y:p.y,z:p.z}),rifle=w.createItem('rifle',1,box,{magazineAmmo:4});assert(command(w,p,'Pickup',box.id).ok);assert.equal(command(w,ps[1],'Pickup',box.id).code,'NOT_FOUND');assert.equal(rifle.containerId,p.backpackId);
  w.addItems(w.bag(p),'catch_silver',6);w.addItems(w.bag(p),'scrap',10);const gun=w.equipped(p),reserve=w.count(p,'ammo_light');position(w,p,3.5,3.9);assert(command(w,p,'Deposit').ok);assert.equal(w.s.bank.credits,120);assert.equal(w.count(p,'ammo_light'),reserve);assert.equal(w.equipped(p).id,gun.id);
  w.addItems(w.bag(p),'field_core',1);w.s.bank.credits=200;w.s.bank.materials=100;position(w,p,-3.5,3.9);assert(command(w,p,'Upgrade',gun.id).ok);advance(w,4.05,{interact:true});assert.equal(gun.level,2);assert.equal(w.equipped(p).id,gun.id);assert.equal(w.s.bank.credits,60);assert.equal(w.s.bank.materials,85);w.assertInvariants();
});
test('submerged nodes refuse search, recovery tools available after empty day respawn, no free gear while equipped',()=>{
  const {w,p}=fixture();assert.equal(command(w,p,'ClaimTool',null,{definitionId:'rod_basic'}).ok,false);day(w);w.s.enemies={};w.die(p);advance(w,15.05);position(w,p,-3.5,-.5);assert(command(w,p,'ClaimTool',null,{definitionId:'rod_basic'}).ok);assert(command(w,p,'ClaimTool',null,{definitionId:'knife'}).ok);
  w.setPhase('RETURN');w.s.waterY=3;const node={id:'submerged',kind:'scrap',x:45,y:1,z:0,state:'available',revision:1};w.s.nodes[node.id]=node;position(w,p,45,1);p.swimming=false;assert.equal(command(w,p,'Search',node.id).code,'INVALID_TARGET');
});
test('building damage does not cancel a repair until destruction; destruction releases reserved budget without resurrection',()=>{
  const {w,p}=fixture();position(w,p,-4.5,-4.1);const b=w.s.buildings.W01;b.hp=300;const materials=w.s.bank.materials;assert(command(w,p,'Repair',b.id).ok);w.damageQueue.push({target:b.id,actorId:'enemy',damage:10});w.resolveDamage();assert(p.work);advance(w,1,{interact:true});assert(p.work);w.damageQueue.push({target:b.id,actorId:'enemy',damage:1000});w.resolveDamage();advance(w,.1,{interact:true});assert.equal(p.work,null);assert.equal(b.hp,0);assert.equal(w.s.bank.materials,materials);assert.equal(w.s.bank.reservedMaterials,0);
});
test('four-player finite day generation has 8m creature spacing, standable backup points, independent deterministic streams',()=>{
  const a=fixture(4).w,b=fixture(4).w;for(let i=0;i<20;i++)b.rng('fish');day(a);day(b);const enemies=Object.values(a.s.enemies);assert.equal(enemies.length,16);assert.equal(Object.keys(a.s.nodes).length,32);
  for(let i=0;i<enemies.length;i++){const e=enemies[i];assert(Math.hypot(e.x,e.z)>=38);assert(!a.blocked(e.x,e.y,e.z,.6));for(let j=i+1;j<enemies.length;j++)assert(Math.hypot(e.x-enemies[j].x,e.z-enemies[j].z)>=8-1e-8);}
  assert.deepEqual(enemies.map(e=>[e.definitionId,e.x,e.z]),Object.values(b.s.enemies).map(e=>[e.definitionId,e.x,e.z]));assert.deepEqual(Object.values(a.s.nodes).map(n=>[n.kind,n.x,n.z]),Object.values(b.s.nodes).map(n=>[n.kind,n.x,n.z]));
});
test('all 1/2/4-player total ordinary counts stay fixed while the selected plan replaces roles and routes',()=>{
  const expected={1:[[5,1],[6,3],[8,4]],2:[[9,2],[10,5],[14,7]],4:[[15,3],[18,9],[24,12]]};
  for(const n of [1,2,4])for(const stage of [1,2,3]){const {w}=fixture(n);w.s.lockedPlayerCount=n;w.s.threatStage=stage;w.startNight();const queue=w.s.night.pending;assert.equal(queue.length,expected[n][stage-1][0]+expected[n][stage-1][1]);const plan=w.s.director.nightPlan;assert.deepEqual(queue.map(e=>e.definitionId).sort(),queue.map((_,i)=>plan.roles[i%plan.roles.length]).sort());assert(queue.every(e=>plan.entries.includes(e.entry)));assert.equal(w.s.night.segments.length,3);for(const segment of w.s.night.segments)assert(queue.some(e=>e.at===segment.at));assert(queue.every(e=>e.at>=0&&e.at<w.phaseDuration("NIGHT")));}
});
test('PREP deadline cancels unfinished work and releases budget before requiring save barrier',()=>{
  const {w,p}=fixture();position(w,p,-4.5,-4.1);w.s.phaseElapsed=w.phaseDuration()-.1;assert(command(w,p,'Upgrade','W01').ok);const credits=w.s.bank.credits;advance(w,.2,{interact:true});assert.equal(w.s.phase,'PREP');assert.equal(w.needsBarrier,true);assert.equal(p.work,null);assert.equal(w.s.bank.reservedCredits,0);assert.equal(w.s.bank.credits,credits);assert.equal(w.s.buildings.W01.lockedBy,undefined);w.finishDayBarrier();assert.equal(w.s.phase,'DAY');
});

