import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {loadConfig} from '../config.mjs';
import {SurvivalWorld} from '../world.mjs';
const base=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
function fixture(count=1){const w=new SurvivalWorld(structuredClone(base)),players=Array.from({length:count},(_,i)=>w.allocate('Synthetic '+i,'test-only-'+i));w.s.enemies={};w.s.destructibles={};for(const p of players){Object.assign(p,{x:20,y:w.ground(20,20),z:20,joinProtectionUntil:0,yaw:0,pitch:0});}return {w,p:players[0],players};}
function empty(w,p,slot='weapon'){const item=w.equipped(p,slot);if(item)w.removeItem(item);p.heldSlot=slot;}
function command(w,p,name='Melee',payload={}){return w.command(p,{type:'command',requestId:p.requestHighWater+1,command:name,payload});}
function enemy(w,p,x=0,z=-1){const e=w.spawnEnemy('silverfish',p.x+x,p.z+z,false);e.hp=e.maxHp=100;e.state='STUNNED';e.phaseRemaining=1000;return e;}
function advance(w,seconds,input={}){for(let elapsed=0;elapsed<seconds-1e-9;elapsed+=1/30){for(const p of Object.values(w.s.players))if(p.connected)w.input(p,{seq:p.inputAck+1,dx:0,dz:0,yaw:p.yaw,pitch:p.pitch,...input});w.step(Math.min(1/30,seconds-elapsed));}}
function prop(w,p){const q={id:w.id('prop'),kind:'crate',x:p.x,y:p.y,z:p.z-1,yaw:0,hp:80,maxHp:80,size:{x:.8,y:1.2,z:.8},radius:.5,revision:1,broken:false,seed:7};w.s.destructibles[q.id]=q;return q;}

test('every held empty slot punches after .16s for 8 damage without an inventory item',()=>{
  for(const slot of ['weapon','rod','melee']){const {w,p}=fixture();empty(w,p,slot);const e=enemy(w,p),items=JSON.stringify(w.s.items);w.drainEvents();assert(command(w,p).ok);advance(w,.159);assert.equal(e.hp,100);advance(w,.002);assert.equal(e.hp,92);assert.equal(JSON.stringify(w.s.items),items);assert(!Object.values(w.s.items).some(i=>i.definitionId==='fist'));
    const events=w.drainEvents(),action=events.find(e=>e.eventType==='Action'&&e.payload.action==='punch'),shot=events.find(e=>e.eventType==='Shot');assert(action);assert.equal(action.payload.duration,.6);assert.equal(action.payload.definitionId,'fist');assert.equal(shot.payload.weapon,'fist');assert.equal(shot.payload.weaponId,'fist');assert.equal(shot.payload.definitionId,'fist');assert.equal(events.find(e=>e.eventType==='Hit').payload.damage,8);w.assertInvariants();}
});

test('held mouse input repeats punches only on the .6s authority cooldown',()=>{
  const {w,p}=fixture();empty(w,p);const target=prop(w,p);advance(w,1.44,{fire:true});const shots=w.drainEvents().filter(e=>e.eventType==='Shot'&&e.payload.weapon==='fist');assert.equal(shots.length,3);assert.equal(target.hp,56);assert(command(w,p).ok===false);assert.equal(p.meleeAt>=1.8,true);w.assertInvariants();
});

test('equipped gun or rod cannot request punches; knife keeps original damage and timing',()=>{
  for(const slot of ['weapon','rod']){const {w,p}=fixture();p.heldSlot=slot;assert.equal(command(w,p).code,'INVALID_TARGET');assert.equal(p.meleePending,undefined);}
  const {w,p}=fixture();p.heldSlot='melee';const e=enemy(w,p);assert(command(w,p).ok);advance(w,.199);assert.equal(e.hp,100);advance(w,.002);assert.equal(e.hp,75);assert.equal(p.meleeAt,.7);assert(w.drainEvents().some(e=>e.eventType==='Shot'&&e.payload.weaponId==='knife'));
});

test('unarmed direction, short range and real wall obstruction reject false hits',()=>{
  for(const [x,z]of [[0,1],[0,-1.26],[1,-.2]]){const {w,p}=fixture();empty(w,p);const e=enemy(w,p,x,z);assert(command(w,p).ok);advance(w,.2);assert.equal(e.hp,100);}
  const {w,p}=fixture();empty(w,p);const e=enemy(w,p);w.s.buildings.testWall={id:'testWall',definitionId:'wall',x:p.x,y:p.y,z:p.z-.5,yaw:0,level:1,hp:400,maxHp:400,revision:1};assert.equal(w.lineVisible(p,e),false);assert(command(w,p).ok);advance(w,.2);assert.equal(e.hp,100);
});

test('death, water, work, reload, fishing and equip transitions deny punches',()=>{
  for(const change of [p=>p.lifeState='DEAD_WAIT',p=>p.lifeState='DOWNED',p=>p.swimming=true,p=>p.work={kind:'fixture'},p=>p.fishing={state:'CAST'},p=>p.reload={remaining:1},p=>p.equipUntil=1]){const {w,p}=fixture();empty(w,p);change(p);assert.equal(command(w,p).ok,false);assert.equal(p.meleePending,undefined);}
  const {w,p}=fixture();empty(w,p);const e=enemy(w,p);assert(command(w,p).ok);w.die(p);advance(w,.2);assert.equal(e.hp,100);
});

test('windup snapshots server parameters and switching cannot convert fist to knife or vice versa',()=>{
  {const {w,p}=fixture();empty(w,p);const e=enemy(w,p);assert(command(w,p,'Melee',{damage:999,range:999,definitionId:'knife'}).ok);w.c.unarmed.damage=999;advance(w,.2);assert.equal(e.hp,92,'windup captured server damage, ignores payload and later config mutation');}
  for(const fistFirst of [true,false]){const {w,p}=fixture();empty(w,p,'weapon');p.heldSlot=fistFirst?'weapon':'melee';const e=enemy(w,p);assert(command(w,p).ok);assert(command(w,p,'SwitchEquip',{slot:fistFirst?'melee':'weapon'}).ok);advance(w,.3);assert.equal(e.hp,100);assert.equal(w.drainEvents().filter(e=>e.eventType==='Shot').length,0);}
});

test('downed mid-windup cancels a punch permanently instead of striking after revive',()=>{
  const {w,p}=fixture();empty(w,p);const e=enemy(w,p);assert(command(w,p).ok);p.lifeState='DOWNED';p.downedRemaining=3;advance(w,.1);assert.equal(p.meleePending,null);p.lifeState='ALIVE';advance(w,.2);assert.equal(e.hp,100);assert.equal(w.drainEvents().filter(e=>e.eventType==='Shot').length,0);
});

test('punch uses prop destruction and friendly-fire single target rules',()=>{
  {const {w,p}=fixture();empty(w,p);const q=prop(w,p);q.hp=8;assert(command(w,p).ok);advance(w,.2);assert.equal(q.broken,true);const events=w.drainEvents();assert.equal(events.filter(e=>e.eventType==='Destroyed').length,1);assert.equal(events.find(e=>e.eventType==='Hit').payload.targetKind,'prop');assert(w.s.containers[q.lootContainerId]);}
  {const {w,p,players}=fixture(3);empty(w,p);players[1].z=19;players[2].z=18.8;assert(command(w,p).ok);advance(w,.7);assert.equal(players[1].hp,100);assert.equal(players[2].hp,100);w.s.friendlyFire=true;assert(command(w,p).ok);advance(w,.2);assert.equal(players[1].hp,92);assert.equal(players[2].hp,100);}
});

test('legacy config and pending knife saves keep working without adding fist items',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'office-unarmed-config-'));t.after(()=>rm(directory,{recursive:true,force:true}));const file=path.join(directory,'balance.json'),old=structuredClone(base);delete old.unarmed;await writeFile(file,JSON.stringify(old));const loaded=await loadConfig(file);assert.equal(loaded.unarmed.damage,8);const world=new SurvivalWorld(old);assert.equal(world.catalog().unarmed.damage,8);
  const {w,p}=fixture();p.heldSlot='melee';const e=enemy(w,p);assert(command(w,p).ok);for(const key of ['definitionId','itemId','heldSlot','damage','range','arc_deg'])delete p.meleePending[key];const saved=w.serialize(),restored=new SurvivalWorld(structuredClone(base),saved),rp=restored.s.players[p.id];restored.connect(rp,rp.name);advance(restored,.21);assert.equal(restored.s.enemies[e.id].hp,75);restored.assertInvariants();
});

test('unarmed config rejects nonnumeric, nonpositive, oversized cone and longer-than-cooldown windup',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'office-unarmed-invalid-'));t.after(()=>rm(directory,{recursive:true,force:true}));const file=path.join(directory,'balance.json');
  for(const [key,value]of [['damage',0],['damage','8'],['range',-1],['arc_deg',181],['cooldown_seconds',0],['windup_seconds',.7],['id','knife']]){const c=structuredClone(base);c.unarmed[key]=value;await writeFile(file,JSON.stringify(c));await assert.rejects(()=>loadConfig(file),/Invalid unarmed config/);}
});
