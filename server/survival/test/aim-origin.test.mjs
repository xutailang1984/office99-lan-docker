import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './director-helpers.mjs';

test('all three guns hit the actual standing/crouched camera center, with distinct muzzle heights',()=>{
 for(const id of ['carbine','shotgun','rifle'])for(const crouching of [false,true]){
  const {w,p}=fixture();w.setPhase('DAY');w.s.enemies={};Object.assign(p,{x:20,y:w.ground(20,4),z:4});
  w.removeItem(w.equipped(p));const gun=w.createItem(id,1,w.s.containers[p.equipment.weapon],{magazineAmmo:5});
  const target=w.spawnEnemy('crab',20,-10);Object.assign(target,{hp:999,maxHp:999,radius:.12});
  p.crouching=crouching;p.input.ads=true;p.adsSince=-1;
  const oldRng=w.rng.bind(w);w.rng=stream=>stream==='combat'?.5:oldRng(stream);
  const cameraY=p.y+(crouching?1.05:w.c.player.camera_height);
  const pitch=Math.atan2(target.y+.65-cameraY,14);w.drainEvents();w.fire(p,0,pitch,true);w.resolveDamage();
  const events=w.drainEvents(),shots=events.filter(e=>e.eventType==='Shot');
  assert.equal(gun.magazineAmmo,4);assert.equal(shots.length,w.defs.weapons[id].pellets);
  assert(shots.every(e=>e.payload.targetId===target.id),id+' crouch='+crouching);
  assert(shots.every(e=>e.payload.from.y===p.y+(crouching?.85:1.05)));
  assert(target.hp<999);assert.equal(events.filter(e=>e.eventType==='Hit').length,1);
 }
});

test('crouched camera cannot shoot through low cover while the standing camera clears it',()=>{
 for(const crouching of [false,true]){
  const {w,p}=fixture();w.setPhase('DAY');w.s.enemies={};p.crouching=crouching;Object.assign(p,{x:20,y:w.ground(20,4),z:4});
  const target=w.spawnEnemy('crab',20,-10);Object.assign(target,{hp:999,maxHp:999,radius:.2});
  const cover={id:'aim-cover',kind:'crate',x:20,y:p.y,z:3,yaw:0,hp:500,maxHp:500,size:{x:2,y:1.0,z:.3},radius:1,broken:false,revision:1};
  w.s.destructibles[cover.id]=cover;const oldRng=w.rng.bind(w);w.rng=stream=>stream==='combat'?.5:oldRng(stream);
  w.drainEvents();w.fire(p,0,Math.atan2(target.y+.65-(p.y+(crouching?1.05:w.c.player.camera_height)),14),false);w.resolveDamage();
  const shot=w.drainEvents().find(e=>e.eventType==='Shot').payload;
  assert.equal(shot.targetId,crouching?cover.id:target.id);assert.equal(target.hp===999,crouching);
 }
});
