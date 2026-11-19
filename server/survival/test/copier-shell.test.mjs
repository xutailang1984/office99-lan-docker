import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../config.mjs';
import {SurvivalWorld} from '../world.mjs';
import {compileState,diffState} from '../state-wire.mjs';
import {missionStep} from '../mission-mode.mjs';
import {readFileSync} from 'node:fs';

const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
const counts={crate:6,barrel:6,barricade:2,partition_panel:6,archive_cabinet:6,copier_shell:2,supply_locker:2,cable_reel:2,punch_clock:2,notice_board:2};
function fixture(count=1,mode='adventure'){
  const world=new SurvivalWorld(structuredClone(config),null,{onlineRoster:true,mode,missionStart:'free'});
  const roster=Array.from({length:count},(_,i)=>world.allocate(`合成队员${i}`,`copier-test-${i}`));
  world.setPhase('DAY');world.s.paused=false;world.s.enemies={};world.drainEvents();
  return {world,roster};
}
function pair(world){
  const shell=Object.values(world.s.destructibles).find(prop=>prop.kind==='copier_shell');
  return {shell,barrel:world.s.destructibles[shell.linkedBarrelId]};
}
function lamp(shell){
  return {x:shell.x-Math.sin(shell.yaw)*shell.size.z*.5,y:shell.y+shell.size.y*.72,z:shell.z-Math.cos(shell.yaw)*shell.size.z*.5};
}
function hit(world,shell,point,damage=10,extra={}){
  world.damageQueue.push({target:shell.id,actorId:null,weaponId:'rifle',shotId:`test-${world.s.tick}-${world.damageQueue.length}`,damage,position:point,...extra});
  world.resolveDamage();
}
function isolated(yaw=0,count=1){
  const {world,roster}=fixture(count),p=roster[0],y=world.ground(20,10),shell={id:'copier-test-shell',kind:'copier_shell',material:'metal',x:20,y,z:10,yaw,hp:75,maxHp:75,size:{x:1.35,y:1.25,z:.95},radius:.83,revision:1,broken:false,seed:37,linkedBarrelId:'copier-test-barrel',armed:false,chainTriggered:false};
  const bx=20+Math.cos(yaw)*2.35,bz=10-Math.sin(yaw)*2.35;
  const barrel={id:'copier-test-barrel',kind:'barrel',material:'metal',x:bx,y:world.ground(bx,bz),z:bz,yaw:0,hp:60,maxHp:60,size:{x:1.05,y:1.5,z:1.05},radius:.74,revision:1,broken:false,seed:11,linkedShellId:shell.id};
  const other={...barrel,id:'other-barrel',x:20+Math.cos(yaw)*6,z:10-Math.sin(yaw)*6,linkedShellId:null};
  world.s.destructibles={[shell.id]:shell,[barrel.id]:barrel,[other.id]:other};
  return {world,p,roster,shell,barrel,other};
}

test('36 objects include exactly two safe, mutually linked copier and barrel pairs across seeds',()=>{
  for(let seed=1;seed<=32;seed++){
    const c=structuredClone(config);c.cycle.seed_default=seed*517;
    const world=new SurvivalWorld(c,null,{onlineRoster:true});
    const props=Object.values(world.s.destructibles);
    assert.equal(props.length,36,`seed ${seed}`);
    assert.deepEqual(Object.fromEntries(Object.keys(counts).map(kind=>[kind,props.filter(prop=>prop.kind===kind).length])),counts);
    const shells=props.filter(prop=>prop.kind==='copier_shell');
    assert.equal(new Set(shells.map(shell=>shell.linkedBarrelId)).size,2);
    for(const shell of shells){
      const barrel=world.s.destructibles[shell.linkedBarrelId];
      assert.equal(barrel.kind,'barrel');assert.equal(barrel.linkedShellId,shell.id);
      assert(Math.hypot(shell.x-barrel.x,shell.z-barrel.z)<=3);
      assert.equal(shell.armed,false);assert.equal(shell.chainTriggered,false);
      assert.equal(world.blocked(shell.x,shell.y,shell.z,.3,shell.id),undefined,`seed ${seed} shell intersects another obstacle`);
    }
    world.assertInvariants();
  }
});

test('front light on both rotations is the real gun weakpoint; side, back and non-guns are ordinary hits',()=>{
  for(const yaw of [0,Math.PI/2]){
    const {world,shell}=isolated(yaw),light=lamp(shell),forward={x:Math.sin(yaw),y:0,z:Math.cos(yaw)};
    const from={x:light.x-forward.x*1.3,y:light.y,z:light.z-forward.z*1.3};
    const collision=world.rayBlock(from,forward,1.4);
    assert.equal(collision?.id,shell.id);assert(world.copierWeakHit(shell,{weaponId:'rifle',position:collision.position}));
    assert.equal(world.copierWeakHit(shell,{weaponId:'knife',position:collision.position}),false);
    const offLight={...collision.position,y:shell.y+shell.size.y*.35};
    assert.equal(world.copierWeakHit(shell,{weaponId:'rifle',position:offLight}),false);
    const backFrom={x:shell.x+forward.x*1.3,y:light.y,z:shell.z+forward.z*1.3};
    const back=world.rayBlock(backFrom,{x:-forward.x,y:0,z:-forward.z},1.4);
    assert.equal(back?.id,shell.id);assert.equal(world.copierWeakHit(shell,{weaponId:'rifle',position:back.position}),false);
    const side={x:shell.x+Math.cos(yaw)*1.3,y:light.y,z:shell.z-Math.sin(yaw)*1.3};
    const sideDirection={x:-Math.cos(yaw),y:0,z:Math.sin(yaw)};
    const sideHit=world.rayBlock(side,sideDirection,1.4);
    assert.equal(sideHit?.id,shell.id);assert.equal(world.copierWeakHit(shell,{weaponId:'rifle',position:sideHit.position}),false);
    const gap={x:from.x+Math.cos(yaw)*shell.size.x*.55,y:light.y,z:from.z-Math.sin(yaw)*shell.size.x*.55};
    assert.equal(world.rayBlock(gap,forward,1.4),null,'invisible shell corner blocks a shot');
  }
});

test('real two-ray gunfire strikes the lit face from yaw 0 and 90, never the reverse face',()=>{
  for(const yaw of [0,Math.PI/2])for(const front of [true,false]){
    const {world,p,shell}=isolated(yaw),light=lamp(shell),out={x:-Math.sin(yaw),z:-Math.cos(yaw)},sign=front?1:-1;
    const x=shell.x+out.x*2.8*sign,z=shell.z+out.z*2.8*sign,y=world.ground(x,z);
    Object.assign(p,{x,y,z,heldSlot:'weapon',equipUntil:0,fireAt:0,joinProtectionUntil:0});
    const dx=light.x-x,dz=light.z-z,shotYaw=Math.atan2(-dx,-dz),pitch=Math.atan2(light.y-(y+world.c.player.camera_height),Math.hypot(dx,dz));
    const rng=world.rng.bind(world);world.rng=stream=>stream==='combat'?.5:rng(stream);
    world.fire(p,shotYaw,pitch);
    const shot=world.drainEvents().find(event=>event.eventType==='Shot')?.payload;
    assert.equal(shot?.targetId,shell.id,`real shot missed shell at yaw ${yaw}, front ${front}`);
    world.resolveDamage();
    const feedback=world.drainEvents().find(event=>event.eventType==='Hit'&&event.payload.targetId===shell.id)?.payload;
    assert.equal(feedback?.weak,front,`wrong real-fire weak flag at yaw ${yaw}, front ${front}`);
    assert.equal(shell.armed,front);
  }
});

test('mixed shotgun pellets amplify only real weak hits before per-shot merging and arm once',()=>{
  const {world,shell}=isolated(),before=compileState(world.publicState()),light=lamp(shell),ordinary={...light,y:shell.y+shell.size.y*.35};
  for(let i=0;i<4;i++)world.damageQueue.push({target:shell.id,damage:3,weaponId:'shotgun',shotId:'mixed-pellets',position:i%2?ordinary:light,weak:i%2===1});
  world.resolveDamage();
  assert.equal(shell.hp,51,'two 3x and two 1x pellets should do 24 damage');assert.equal(shell.armed,true);
  const events=world.drainEvents();
  assert.equal(events.filter(event=>event.eventType==='Hit'&&event.payload.targetId===shell.id).length,1);
  assert.equal(events.filter(event=>event.eventType==='CopierArmed').length,1);
  assert.equal(events.find(event=>event.eventType==='Hit')?.payload.pelletHits,4);
  const patch=diffState(before,compileState(world.publicState())).delta.entities.destructibles;
  assert.deepEqual(patch.patch.map(change=>change.id),[shell.id]);
  assert.equal(patch.patch[0].set.armed,true);
  const restored=new SurvivalWorld(world.c,world.serialize(),{onlineRoster:true});
  assert.equal(restored.s.destructibles[shell.id].armed,true);
  assert.equal(restored.s.destructibles[shell.id].linkedBarrelId,shell.linkedBarrelId);
});

test('an armed shell breaks only its bound live barrel once, without hurting others or multiplying loot',()=>{
  for(let round=0;round<8;round++){
    const {world,roster,shell,barrel,other}=isolated(0,8),base=world.s.buildings.core,hp=base.hp,playerHp=roster.map(p=>p.hp);
    hit(world,shell,lamp(shell),3);
    world.drainEvents();
    const before=compileState(world.publicState());
    for(let i=0;i<8;i++)world.damageQueue.push({target:shell.id,damage:9,actorId:roster[i].id,weaponId:'pistol',shotId:`eight-${round}-${i}`,position:{...lamp(shell),y:shell.y+shell.size.y*.35}});
    world.resolveDamage();
    assert.equal(shell.broken,true);assert.equal(shell.chainTriggered,true);assert.equal(barrel.broken,true);
    assert.equal(other.hp,60);assert.equal(base.hp,hp);assert.deepEqual(roster.map(p=>p.hp),playerHp);
    const events=world.drainEvents();
    for(const eventType of ['CopierChain','Destroyed'])assert.equal(events.filter(event=>event.eventType===eventType).length,eventType==='Destroyed'?2:1);
    assert.deepEqual(new Set(events.filter(event=>event.eventType==='Destroyed').map(event=>event.payload.targetId)),new Set([shell.id,barrel.id]));
    const shellLoot=world.s.containers[shell.lootContainerId];
    assert.equal(shellLoot.itemIds.length,1);assert.equal(world.s.items[shellLoot.itemIds[0]].definitionId,'scrap');assert.equal(world.s.items[shellLoot.itemIds[0]].quantity,1);
    const barrelLoot=world.s.containers[barrel.lootContainerId];assert.equal(barrelLoot.itemIds.length,1);
    const patch=diffState(before,compileState(world.publicState())).delta.entities.destructibles;
    assert.deepEqual(new Set(patch.patch.map(change=>change.id)),new Set([shell.id,barrel.id]));
    const count=Object.keys(world.s.items).length;
    world.breakProp(shell,{actorId:null});world.breakProp(barrel,{actorId:null});assert.equal(Object.keys(world.s.items).length,count);
    const restored=new SurvivalWorld(world.c,world.serialize(),{onlineRoster:true});
    assert.equal(restored.s.destructibles[shell.id].chainTriggered,true);assert.equal(restored.s.destructibles[barrel.id].broken,true);
    restored.assertInvariants();
  }
});

test('an unarmed shell or previously destroyed bound barrel never triggers a chain',()=>{
  for(const barrelFirst of [false,true]){
    const {world,shell,barrel}=isolated();
    if(barrelFirst){hit(world,shell,lamp(shell),3);world.breakProp(barrel,{actorId:null});world.drainEvents();}
    else {world.damageQueue.push({target:shell.id,damage:10,weaponId:'knife',position:lamp(shell)});world.resolveDamage();assert.equal(shell.armed,false);world.drainEvents();}
    world.breakProp(shell,{actorId:null});
    const events=world.drainEvents();
    assert.equal(events.filter(event=>event.eventType==='CopierChain').length,0);
    assert.equal(events.filter(event=>event.eventType==='Destroyed').length,1);
    assert.equal(barrel.broken,barrelFirst);
    world.assertInvariants();
  }
});

test('same-frame lethal light and barrel shots never duplicate either destroyed reward',()=>{
  for(const barrelFirst of [false,true]){
    const {world,shell,barrel,other}=isolated();
    const shellShot={target:shell.id,damage:25,weaponId:'rifle',shotId:'light',position:lamp(shell)};
    const barrelShot={target:barrel.id,damage:60,weaponId:'rifle',shotId:'barrel',position:{x:barrel.x,y:barrel.y+1,z:barrel.z}};
    world.damageQueue.push(...(barrelFirst?[barrelShot,shellShot]:[shellShot,barrelShot]));
    world.resolveDamage();
    const events=world.drainEvents();
    assert.equal(events.filter(event=>event.eventType==='CopierArmed').length,1);
    assert.equal(events.filter(event=>event.eventType==='CopierChain').length,barrelFirst?0:1);
    assert.deepEqual(events.filter(event=>event.eventType==='Destroyed').map(event=>event.payload.targetId).sort(),[shell.id,barrel.id].sort());
    assert.equal(shell.broken,true);assert.equal(barrel.broken,true);assert.equal(other.hp,60);
    assert.equal(world.s.containers[shell.lootContainerId].itemIds.length,1);
    assert.equal(world.s.containers[barrel.lootContainerId].itemIds.length,1);
    world.assertInvariants();
  }
});

test('copier hit, charge and break use distinct licensed sample cues within the shared voice pool',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../../../client/audio/sfx/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.voice_limit,32);
  for(const name of ['impact_copier','charge_copier','break_copier'])assert(manifest.cues[name]?.near?.length>=3,name);
  assert(manifest.cues.impact_copier.pitch_min>manifest.cues.impact_metal.pitch_max);
  assert(manifest.cues.break_copier.pitch_min>manifest.cues.break_metal.pitch_max);
  assert(manifest.cues.charge_copier.near.every(path=>path.startsWith('interactions/')));
});

test('an old day keeps its old scenery; new generation gets the two linked pairs',()=>{
  const {world}=fixture(),saved=world.serialize();
  for(const shell of Object.values(saved.destructibles).filter(prop=>prop.kind==='copier_shell')){
    const barrel=saved.destructibles[shell.linkedBarrelId];delete barrel.linkedShellId;
    Object.assign(shell,{kind:'barrel',hp:60,maxHp:60,size:{x:1.05,y:1.5,z:1.05}});
    delete shell.linkedBarrelId;delete shell.armed;delete shell.chainTriggered;
  }
  const resumed=new SurvivalWorld(world.c,saved,{onlineRoster:true});
  assert.equal(Object.values(resumed.s.destructibles).filter(prop=>prop.kind==='copier_shell').length,0);
  assert.deepEqual(resumed.s.destructibles,saved.destructibles);
  resumed.generateDay();
  assert.equal(Object.values(resumed.s.destructibles).filter(prop=>prop.kind==='copier_shell').length,2);
  assert.equal(Object.keys(resumed.s.destructibles).length,36);
  resumed.assertInvariants();
});

test('free trial rotates to a complete shell and barrel pair and cleans both fixtures',()=>{
  const {world}=fixture(1,'mission'),park=world.s.mission.park;
  world.s.destructibles={};park.propCursor=config.destructibles.types.findIndex(type=>type.id==='copier_shell');
  missionStep(world);
  assert.equal(park.activePropIds.length,2);
  const {shell,barrel}=pair(world);
  assert.equal(barrel.linkedShellId,shell.id);assert.equal(shell.practiceFixture,true);assert.equal(barrel.practiceFixture,true);
  assert.equal(world.publicState().mission.park.propTotal,10);
  hit(world,shell,lamp(shell),3);world.breakProp(shell,{actorId:null});
  assert.equal(shell.broken,true);assert.equal(barrel.broken,true);
  world.s.time+=7;missionStep(world);
  assert(!park.activePropIds.includes(shell.id));assert(!park.activePropIds.includes(barrel.id));
  assert.equal(world.s.destructibles[shell.id],undefined);assert.equal(world.s.destructibles[barrel.id],undefined);
  world.assertInvariants();
});
