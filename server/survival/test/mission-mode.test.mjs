import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SurvivalWorld} from '../world.mjs';
import {missionWork} from '../mission-mode.mjs';

const config=JSON.parse(readFileSync(new URL('../../../client/survival/balance.json',import.meta.url),'utf8'));
const create=(start='tutorial')=>{const world=new SurvivalWorld(structuredClone(config),null,{onlineRoster:true,mode:'mission',missionStart:start});const player=world.allocate('合成实习生','account:test');return {world,player};};
const command=(world,player,requestId,action,extra={})=>world.command(player,{requestId,command:'MissionControl',payload:{action,...extra}});

test('mission is a daylight-only temporary world and the existing adventure rules remain unchanged',()=>{
  const {world,player}=create();
  assert.equal(world.publicState().mode,'mission');assert.equal(world.s.phase,'DAY');assert.equal(world.publicState().mission.stageId,'move');
  assert.equal(world.s.enemies&&Object.keys(world.s.enemies).length,0);
  const clock=world.publicClock();for(let n=0;n<1000;n++)world.step(1/30);
  assert.equal(world.s.phase,'DAY');assert.deepEqual(world.publicClock(),clock);
  world.die(player);assert.equal(player.lifeState,'DEAD_WAIT');assert.equal(player.respawnRemaining,5);
  assert.equal(Object.values(world.s.containers).filter(container=>container.type==='corpse').length,0);
  for(let n=0;n<160;n++)world.step(1/30);assert.equal(player.lifeState,'ALIVE');
  const adventure=new SurvivalWorld(structuredClone(config));const ordinary=adventure.allocate('合成队员','ordinary');
  assert.equal(adventure.publicState().mode,'adventure');assert.equal(adventure.s.phase,'PREP');
  assert.equal(command(adventure,ordinary,1,'refill').code,'WRONG_PHASE');
});

test('mission tasks require actual checks; loaned equipment and refill stay inside the temporary world',()=>{
  const {world,player}=create();
  assert.equal(command(world,player,1,'select',{stageId:'base'}).ok,true);
  assert.equal(world.publicState().mission.completed,false,'jumping to the last stage is not graduation');
  assert.equal(command(world,player,2,'equip',{definitionId:'rifle'}).ok,true);
  assert.equal(world.equipped(player,'weapon').definitionId,'rifle');
  assert.equal(world.equipped(player,'weapon').loanOwnerSlotId,player.slotId);
  assert.equal(command(world,player,3,'equip',{definitionId:'rod_magnet'}).ok,true);
  assert.equal(world.equipped(player,'rod').definitionId,'rod_magnet');
  assert.equal(command(world,player,4,'equip',{definitionId:'flash_note'}).ok,true);
  assert.equal(world.quickItem(player).definitionId,'flash_note');
  assert.equal(command(world,player,5,'equip',{definitionId:'boss_trophy'}).code,'INVALID_TARGET');
  player.hp=1;assert.equal(command(world,player,6,'refill').ok,true);assert.equal(player.hp,world.c.player.max_hp);
  assert.equal(command(world,player,7,'wave').code,'INVALID_TARGET','players cannot generate monsters from a menu');
  assert.equal(command(world,player,8,'free_play').ok,true);assert.equal(world.publicState().mission.freePlay,true);
  assert.equal(command(world,player,9,'combat').ok,true);
  world.assertInvariants();
});

test('free trial automatically visits the complete creature roster and caps active enemies',()=>{
  const {world,player}=create('free'),seen=new Set();
  assert.equal(command(world,player,1,'combat').ok,true);
  player.x=0;player.z=-32;player.y=world.ground(0,-32);
  for(let n=0;n<world.c.creatures.filter(def=>def.tier!=='boss'&&def.id!=='boss_crab').length;n++){
    world.s.mission.park.nextCreatureAt=world.s.time;
    world.step(1/30);
    const active=world.s.mission.park.activeEnemyIds.map(id=>world.s.enemies[id]).filter(Boolean);
    assert.equal(active.length,1);
    assert.ok(active.every(enemy=>enemy.source==='practice'&&enemy.practiceZone==='patrol'));
    seen.add(active[0].definitionId);
    world.killEnemy(active[0],player.id);
    world.step(1/30);
    assert.ok(Object.values(world.s.enemies).filter(enemy=>enemy.source==='practice').length<=1);
  }
  assert.equal(seen.size,world.c.creatures.filter(def=>def.tier!=='boss'&&def.id!=='boss_crab').length);
  assert.equal(world.publicState().mission.park.creatureSeen,world.c.creatures.filter(def=>def.tier!=='boss'&&def.id!=='boss_crab').length);
  assert.ok(Object.values(world.s.containers).filter(box=>box.source==='practice').length<=12);
});

test('practice boss stays away from the core, while water and equipment remain safe',()=>{
  const {world,player}=create('free'),core=world.s.buildings.core,hp=core.hp;
  player.x=-22;player.z=-35;player.y=world.ground(player.x,player.z);
  for(let n=0;n<10;n++)world.step(1/30);
  const boss=Object.values(world.s.enemies).find(enemy=>enemy.practiceZone==='boss');
  assert.ok(boss);
  assert.equal(world.publicState().mission.park.bossId,'boss_coffee_boiler');
  assert.equal(world.s.night.pending.length,0);
  player.x=0;player.z=21.5;player.y=world.ground(player.x,player.z);
  const before=player.hp;
  for(let n=0;n<330;n++)world.step(1/30);
  assert.equal(player.hp,before);
  assert.equal(core.hp,hp);
  assert.equal(world.s.night.pending.length,0);
  assert.ok(!world.s.enemies[boss.id]||world.s.enemies[boss.id].z<=-24);
});

test('practice pond cycles every fish without changing the adventure catch pool',()=>{
  const {world,player}=create('free'),seen=new Set();
  player.x=0;player.z=21.5;player.y=world.ground(0,21.5);player.heldSlot='rod';
  world.cast(player,null,{x:0,z:29,power:1});
  const first=player.fishing.creature;
  world.cancelFishing(player,'练习重抛');
  world.cast(player,null,{x:0,z:29,power:1});
  assert.equal(player.fishing.creature,first,'cancelling a cast does not skip a species');
  for(let i=0;i<8;i++){
    if(i>0)world.cast(player,null,{x:0,z:29,power:1});
    const fishing=player.fishing;seen.add(fishing.creature);
    world.exploration.landed({source:'fishing'},player,fishing);
    world.cancelFishing(player,'练习换鱼');
  }
  assert.equal(seen.size,8);
  assert.equal(player.practiceFishIndex,8);
  assert.equal(world.mode,'mission');
});

test('a shared free-trial room cannot switch the whole team into an account tutorial',()=>{
  const {world,player}=create('free'),teammate=world.allocate('合成队友','account:teammate');
  assert.equal(command(world,player,1,'restart').code,'WRONG_PHASE');
  assert.equal(command(world,player,2,'select',{stageId:'base'}).code,'WRONG_PHASE');
  assert.equal(command(world,teammate,1,'combat').ok,true);
  assert.equal(world.publicState().mission.freePlay,true);
  assert.equal(world.publicState().mission.completed,false);
});

test('ten destructible types rotate at bounded fixtures and temporary loot is reclaimed',()=>{
  const {world,player}=create('free'),seen=new Set();
  world.step(1/30);
  for(let n=0;n<14;n++){
    const active=world.s.mission.park.activePropIds.map(id=>world.s.destructibles[id]).filter(Boolean);
    assert.ok(active.length>=1&&active.length<=2);
    const prop=active[0];seen.add(prop.kind);
    world.breakProp(prop,{actorId:player.id,weaponId:'carbine'});
    assert.equal(world.s.containers[prop.lootContainerId]?.source,'practice');
    for(let i=0;i<185;i++)world.step(1/30);
    assert.equal(world.s.destructibles[prop.id],undefined);
  }
  assert.equal(seen.size,10);
  assert.ok(Object.values(world.s.destructibles).filter(prop=>prop.practiceFixture).length<=2);
  assert.ok(Object.values(world.s.containers).filter(box=>box.source==='practice').length<=12);
  world.assertInvariants();
});

test('directed attacks and projectiles cannot follow a player into the safe half of the park',()=>{
  const {world,player}=create('free'),hp=player.hp;
  player.x=0;player.z=21.5;player.y=world.ground(0,21.5);
  for(const [id,attackKind] of [['courier','dash'],['spore_slug','puddle'],['jammer','slow_bolt'],['paper_drone','paper_bolt'],['archive_guard','archive_spread']]){
    const enemy=world.spawnEnemy(id,0,-38);
    Object.assign(enemy,{source:'practice',missionWave:true,practiceZone:'patrol',targetId:player.id,state:'WINDUP',phaseRemaining:0,attackKind,lockX:player.x,lockY:player.y+1,lockZ:player.z});
    world.updateEnemy(enemy,1/30);world.resolveDamage();
    assert.equal(player.hp,hp,id);
    assert.equal(Object.values(world.s.projectiles).filter(projectile=>projectile.actorId===enemy.id).length,0,id);
    delete world.s.enemies[enemy.id];world.aggro.forget(enemy.id);
  }
  const projectile={id:'synthetic-practice-bolt',x:0,y:world.ground(0,-25)+1,z:-25,vx:0,vy:0,vz:20,radius:.2,damage:99,actorId:'synthetic',life:2,practiceZone:'patrol'};
  world.s.projectiles[projectile.id]=projectile;
  world.updateProjectiles(1);world.resolveDamage();
  assert.equal(player.hp,hp);
  assert.equal(world.s.projectiles[projectile.id],undefined);
});

test('eight players can share a trial room with a strict cap on automatic practice enemies',()=>{
  const {world,player}=create('free'),players=[player];
  for(let i=1;i<8;i++)players.push(world.allocate(`合成队友${i}`,`account:test${i}`));
  for(let i=0;i<6;i++)Object.assign(players[i],{x:i%2?2:-2,z:-31,y:world.ground(i%2?2:-2,-31)});
  Object.assign(players[6],{x:-22,z:-35,y:world.ground(-22,-35)});
  for(let i=0;i<30;i++)world.step(1/30);
  world.s.mission.park.nextCreatureAt=world.s.time;
  world.step(1/30);
  const practice=Object.values(world.s.enemies).filter(enemy=>enemy.source==='practice');
  assert.ok(practice.length<=3);
  assert.equal(practice.filter(enemy=>enemy.practiceZone==='patrol').length,2);
  assert.equal(practice.filter(enemy=>enemy.practiceZone==='boss').length,1);
  assert.equal(world.publicState().players.length,8);
  world.assertInvariants();
});

test('fish catches and automatic patrols share one room-wide creature budget',()=>{
  const {world,player}=create('free'),players=[player];
  for(let i=1;i<8;i++)players.push(world.allocate(`合成队友${i}`,`account:budget${i}`));
  for(let i=0;i<6;i++)Object.assign(players[i],{x:i%2?2:-2,z:-31,y:world.ground(i%2?2:-2,-31)});
  for(let i=0;i<8;i++){
    const fish=world.spawnEnemy('crab',i-4,22);
    fish.source='fishing';fish.ownerId=players[i].id;
  }
  for(let i=0;i<60;i++)world.step(1/30);
  assert.equal(Object.keys(world.s.enemies).length,8);
  assert.equal(Object.values(world.s.enemies).filter(enemy=>enemy.source==='practice').length,0);
  player.x=0;player.z=21.5;player.y=world.ground(0,21.5);player.heldSlot='rod';
  const blocked=world.command(player,{requestId:101,command:'Cast',payload:{x:0,z:29,power:1}});
  assert.equal(blocked.code,'PRACTICE_CAP');
  delete world.s.enemies[Object.keys(world.s.enemies)[0]];
  const cast=world.command(player,{requestId:102,command:'Cast',payload:{x:0,z:29,power:1}});
  assert.equal(cast.ok,true,JSON.stringify(cast));
  world.s.mission.park.nextCreatureAt=world.s.time;
  world.step(1/30);
  assert.equal(Object.values(world.s.enemies).filter(enemy=>enemy.source==='practice').length,0,'an active fishing line reserves its landing slot');
  world.assertInvariants();
});

test('real movement and turning advance the entry step, while a free trial starts without tutorial prompts',()=>{
  const {world,player}=create();
  world.input(player,{seq:1,dx:1,dz:0,yaw:.5,pitch:0});for(let n=0;n<15;n++)world.step(1/30);
  assert.equal(world.publicState().mission.stageId,'fish');
  assert.equal(world.equipped(player,'rod').definitionId,'rod_basic');
  const free=create('free');assert.equal(free.world.publicState().mission.freePlay,true);
  assert.equal(free.world.publicState().mission.completed,false);
});

test('switching a shared stage cancels teammates busy actions instead of stopping the host',()=>{
  const {world,player}=create(),teammate=world.allocate('合成队友','account:teammate');
  teammate.fishing={state:'CAST',id:'synthetic-line'};
  teammate.reload={remaining:2};
  teammate.work={kind:'Search',targetId:'synthetic-target'};
  assert.equal(command(world,player,1,'select',{stageId:'fish'}).ok,true);
  assert.equal(world.publicState().mission.stageId,'fish');
  assert.equal(teammate.fishing,null);
  assert.equal(teammate.reload,null);
  assert.equal(teammate.work,null);
  assert.equal(world.equipped(teammate,'rod').definitionId,'rod_basic');
  world.assertInvariants();
});

test('the final task presents a clearly damaged core and a real repair completes its check',()=>{
  const {world,player}=create();
  assert.equal(command(world,player,1,'select',{stageId:'base'}).ok,true);
  const core=world.s.buildings.core;
  assert.equal(core.maxHp-core.hp,400);
  assert.equal(world.publicState().mission.progress,0);
  const started=world.command(player,{requestId:2,command:'Repair',targetId:core.id});
  assert.equal(started.ok,true,JSON.stringify(started));
  assert.equal(player.work?.kind,'Repair');
  for(let n=0;n<90;n++){
    if(n%10===0)world.input(player,{seq:n+1,dx:0,dz:0,yaw:player.yaw,pitch:player.pitch,interact:true});
    world.step(1/30);
  }
  assert.ok(core.hp>core.maxHp-400);
  assert.equal(world.publicState().mission.stageId,'move','earlier tasks must still be completed');
  assert.ok(world.s.mission.checks.base.includes('repair'));
});

test('graduation needs all five jobs and a core repair; changing pages cannot graduate early',()=>{
  const skipped=create(),{world,player}=skipped;
  assert.equal(command(world,player,1,'select',{stageId:'base'}).ok,true);
  missionWork(world,'Repair','another-wall');
  assert.equal(world.publicState().mission.progress,0);
  assert.equal(command(world,player,2,'restart').ok,true);
  assert.equal(world.publicState().mission.stageId,'move');

  world.input(player,{seq:1,dx:1,dz:0,yaw:.5,pitch:0});
  for(let n=0;n<15;n++)world.step(1/30);
  assert.equal(world.publicState().mission.stageId,'fish');
  world.event('FishingChanged',{state:'LANDED',enemyId:'synthetic-fish',actorId:player.id});
  world.event('Removed',{kind:'enemy',actorId:player.id},'synthetic-fish');
  assert.equal(world.publicState().mission.stageId,'search');
  missionWork(world,'SearchArchive',world.s.mission.archiveId);
  world.event('Destroyed',{kind:'crate',actorId:player.id});
  assert.equal(world.publicState().mission.stageId,'fight');
  world.event('Shot',{actorId:player.id});
  world.event('Removed',{kind:'enemy',actorId:player.id},'synthetic-threat');
  assert.equal(world.publicState().mission.stageId,'base');
  assert.equal(world.publicState().mission.completed,false);
  const core=world.s.buildings.core;
  assert.equal(world.command(player,{requestId:3,command:'Repair',targetId:core.id}).ok,true);
  for(let n=0;n<90;n++){
    if(n%10===0)world.input(player,{seq:20+n,dx:0,dz:0,yaw:player.yaw,pitch:player.pitch,interact:true});
    world.step(1/30);
  }
  assert.equal(world.publicState().mission.completed,true);
  assert.equal(world.publicState().mission.freePlay,true);
  assert.equal(world.publicState().mission.completedStages.length,5);
  world.assertInvariants();
});
