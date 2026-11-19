import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SurvivalWorld} from '../world.mjs';

const config=JSON.parse(readFileSync(new URL('../../../client/survival/balance.json',import.meta.url),'utf8'));
const create=mode=>{const w=new SurvivalWorld(structuredClone(config),null,{onlineRoster:true,mode,missionStart:'free'});const p=w.allocate('合成测试队员','account:synthetic-training');return {w,p};};
const command=(w,p,command,payload={})=>w.command(p,{requestId:p.requestHighWater+1,command,payload});
const advance=(w,seconds)=>{for(let i=0;i<Math.ceil(seconds*30);i++)w.step(1/30);};

test('fourteen fixed displays are reachable and loan equipment only from its own stand',()=>{
  const {w,p}=create('mission'),stands=w.staticWorld().terminals.filter(t=>t.type==='training');
  assert.equal(stands.length,14);assert.equal(new Set(stands.map(t=>t.definitionId)).size,14);
  assert.deepEqual([p.x,p.z],[0,9]);
  assert.equal(p.yaw,Math.PI,'free trial should face the displays on entry');
  assert.equal(command(w,p,'MissionControl',{action:'equip',definitionId:'rifle'}).code,'OUT_OF_RANGE');
  for(const stand of stands){
    Object.assign(p,{x:stand.x,y:w.ground(stand.x,stand.z-1.4),z:stand.z-1.4});
    assert(!w.blocked(p.x,p.y,p.z,.35),`${stand.id} approach is blocked`);
    assert.equal(command(w,p,'MissionControl',{action:'equip',definitionId:stand.definitionId}).ok,true,stand.id);
    assert.equal(w.equipped(p,stand.kind).definitionId,stand.definitionId);
    assert.equal(w.equipped(p,stand.kind).loanOwnerSlotId,p.slotId);
  }
  w.assertInvariants();
  const ordinary=create('adventure').w;
  assert.equal(ordinary.staticWorld().terminals.filter(t=>t.type==='training').length,0);
});

test('real fire and timed reload keep magazine limits but consume no reserve in the temporary room',()=>{
  const {w,p}=create('mission'),stand=w.staticWorld().terminals.find(t=>t.definitionId==='rifle');
  Object.assign(p,{x:stand.x,y:w.ground(stand.x,stand.z-1.4),z:stand.z-1.4});
  assert.equal(command(w,p,'MissionControl',{action:'equip',definitionId:'rifle'}).ok,true);
  for(const id of [...w.bag(p).itemIds])if(w.defs.items[w.s.items[id].definitionId].kind==='ammo')w.removeItem(w.s.items[id]);
  const item=w.equipped(p,'weapon'),capacity=w.defs.weapons.rifle.magazine;
  item.magazineAmmo=1;
  Object.assign(p,{x:12,y:w.ground(12,25),z:25,yaw:Math.PI,pitch:-.15,equipUntil:0,joinProtectionUntil:0});
  w.s.destructibles={};
  const target=w.spawnEnemy('crab',12,31);target.hp=1000;target.maxHp=1000;
  assert.equal(command(w,p,'Fire',{yaw:Math.PI,pitch:-.15}).ok,true);
  assert.equal(item.magazineAmmo,0);
  assert(w.drainEvents().some(event=>event.eventType==='Shot'&&event.payload.actorId===p.id));
  assert.equal(command(w,p,'Reload').ok,true);
  advance(w,w.defs.weapons.rifle.reload_seconds+1);
  assert.equal(item.magazineAmmo,capacity);
  assert.equal(w.count(p,'ammo_heavy'),0);
  w.assertInvariants();
});

test('practice inlet is dry at every rod stand, accepts all six fishing tools, and preserves adventure terrain',()=>{
  const {w,p}=create('mission');
  const adventure=create('adventure').w;
  assert(w.ground(0,26)<w.s.waterY-.05,'practice target must be water');
  assert(adventure.ground(0,26)>adventure.s.waterY+.6,'adventure terrain must remain dry');
  const rods=w.staticWorld().terminals.filter(t=>t.kind==='rod'&&t.type==='training');
  assert.equal(rods.length,6);
  for(const stand of rods){
    assert(stand.y>w.s.waterY+.6,`${stand.id} is submerged`);
    const x=stand.x,z=21.7,y=w.ground(x,z),shoreX=x*.25,shoreZ=22,targetX=shoreX,targetZ=29;
    assert(y>w.s.waterY+.6&&!w.blocked(x,y,z,.35),`${stand.id} shore approach is unsafe`);
    assert(w.ground(targetX,targetZ)<w.s.waterY-.05,`${stand.id} cannot reach practice water`);
    Object.assign(p,{x,y,z,yaw:Math.PI,pitch:-.12,equipUntil:0});
    assert.equal(command(w,p,'MissionControl',{action:'equip',definitionId:stand.definitionId}).ok,true,stand.id);
    Object.assign(p,{x:shoreX,z:shoreZ,y:w.ground(shoreX,shoreZ)});
    assert(p.y>w.s.waterY+.6&&!w.blocked(p.x,p.y,p.z,.35),`${stand.id} fishing shelf is unsafe`);
    p.equipUntil=0;
    const result=command(w,p,'Cast',{x:targetX,z:targetZ,power:.7});
    const origin={x:p.x,y:p.y+w.c.player.camera_height,z:p.z},target={x:targetX,y:w.s.waterY+.06,z:targetZ},delta={x:target.x-origin.x,y:target.y-origin.y,z:target.z-origin.z},length=Math.hypot(delta.x,delta.y,delta.z);
    assert.equal(result.ok,true,`${stand.id} cast failed: ${JSON.stringify({result,origin,target,block:w.rayBlock(origin,{x:delta.x/length,y:delta.y/length,z:delta.z/length},length-.08),playerGround:w.ground(p.x,p.z),targetGround:w.ground(targetX,targetZ),held:p.heldSlot})}`);
    assert.equal(p.fishing?.state,'CAST');
    w.cancelFishing(p,'测试切换鱼竿');
  }
  assert(w.ground(0,22)>w.s.waterY+.6,'no dry landing shelf');
  w.assertInvariants();
});

test('a practice catch lands on the dry shelf beside the inlet',()=>{
  const {w,p}=create('mission'),stand=w.staticWorld().terminals.find(t=>t.definitionId==='rod_basic');
  Object.assign(p,{x:stand.x,y:stand.y,z:stand.z+1.7});
  assert.equal(command(w,p,'MissionControl',{action:'equip',definitionId:'rod_basic'}).ok,true);
  Object.assign(p,{x:0,y:w.ground(0,22),z:22,yaw:Math.PI,equipUntil:0});
  assert.equal(command(w,p,'Cast',{x:0,z:29,power:1}).ok,true);
  p.fishing.state='LAND';p.fishing.remaining=.01;
  w.updateFishing(p,.02);
  assert.equal(p.fishing,null,'practice catch failed to land');
  const landed=w.drainEvents().find(event=>event.eventType==='FishingChanged'&&event.payload.state==='LANDED');
  assert(landed?.payload.enemyId,'practice catch did not become a monster');
  assert(w.ground(landed.payload.position.x,landed.payload.position.z)>w.s.waterY+.6,'monster landed underwater');
  w.assertInvariants();
});

test('free trial stays clear while the player fishes at the practice shore',()=>{
  const {w,p}=create('mission');
  Object.assign(p,{x:0,y:w.ground(0,21.5),z:21.5,yaw:Math.PI,heldSlot:'rod',equipUntil:0});
  advance(w,35);
  assert.equal(Object.values(w.s.enemies).filter(e=>e.missionWave).length,0,'standing at the shore spawned a training wave');
  assert.equal(command(w,p,'Cast',{x:0,z:29,power:1}).ok,true);
  advance(w,7);
  assert.equal(Object.values(w.s.enemies).filter(e=>e.missionWave).length,0,'fishing spawned a training wave');
  w.assertInvariants();
});

test('walking to the north lane starts a bounded automatic patrol; returning south leaves it confined',()=>{
  const {w,p}=create('mission');
  advance(w,10);
  assert.equal(Object.values(w.s.enemies).filter(e=>e.missionWave).length,0);
  assert.equal(command(w,p,'MissionControl',{action:'wave'}).code,'INVALID_TARGET');
  assert.equal(command(w,p,'MissionControl',{action:'combat'}).ok,true);
  advance(w,1);
  const first=Object.values(w.s.enemies).filter(e=>e.missionWave);
  assert.equal(first.length,1);
  assert(first.every(e=>Math.hypot(e.x,e.z-21.5)>25),'training monster spawned beside the practice shore');
  assert.equal(command(w,p,'MissionControl',{action:'water'}).ok,true);
  const hp=p.hp;
  advance(w,10);
  assert.equal(p.hp,hp,'practice patrol crossed into the fishing area');
  assert(Object.values(w.s.enemies).filter(e=>e.missionWave).every(e=>e.z<=-24));
  advance(w,12);
  assert.equal(Object.values(w.s.enemies).filter(e=>e.missionWave).length,0,'empty practice lane kept running');
  w.assertInvariants();
});

test('training and water shortcuts move only the caller and refuse active fishing or work',()=>{
  const {w,p}=create('mission'),friend=w.allocate('合成队友','account:synthetic-friend');
  const original={x:friend.x,y:friend.y,z:friend.z};
  p.work={kind:'Repair',targetId:'core'};
  assert.equal(command(w,p,'MissionControl',{action:'water'}).code,'BUSY');
  p.work=null;p.fishing={state:'CAST',id:'synthetic-line'};
  assert.equal(command(w,p,'MissionControl',{action:'water'}).code,'BUSY');
  p.fishing=null;
  assert.equal(command(w,p,'MissionControl',{action:'water'}).ok,true);
  assert(Math.hypot(p.x,p.z-21.5)<1,'water shortcut missed the practice shore');
  assert.equal(p.yaw,Math.PI,'water shortcut should face the practice inlet');
  p.heldSlot='rod';p.equipUntil=0;
  assert.equal(command(w,p,'Cast',{x:0,z:29,power:1}).ok,true,'water shortcut is not usable for fishing');
  w.cancelFishing(p,'测试返回展架');
  assert.deepEqual({x:friend.x,y:friend.y,z:friend.z},original,'teammate moved with caller');
  assert.equal(command(w,p,'MissionControl',{action:'training'}).ok,true);
  assert(Math.hypot(p.x,p.z-17)<1,'return shortcut missed the display entrance');
  assert.equal(p.yaw,0,'return shortcut should face the displays');
  assert(w.drainEvents().some(event=>event.eventType==='MissionTeleported'&&event.payload.actorId===p.id&&event.payload.yaw===0));
  w.assertInvariants();
});
