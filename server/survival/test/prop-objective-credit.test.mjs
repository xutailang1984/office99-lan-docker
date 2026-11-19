import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,restored} from './director-helpers.mjs';

test('boss destruction drops loot once without completing the player break objective',()=>{
  const {w,p}=fixture();w.setPhase('DAY');
  const objective=w.director.newObjective(w.c.director.objectives.find(o=>o.id==='courier_cache'));
  w.s.director.objective=objective;w.s.director.optionalObjective=null;
  const boss=w.spawnEnemy('boss_crab',0,30,true);
  const prop={id:'synthetic-break-credit',kind:'barrel',x:0,y:w.ground(0,24),z:24,yaw:0,hp:10,maxHp:10,size:{x:1,y:1.5,z:1},radius:.7,revision:1,broken:false,seed:11};
  w.s.destructibles[prop.id]=prop;
  w.damageQueue.push({target:prop.id,damage:120,actorId:boss.id});w.resolveDamage();
  assert(prop.broken);assert.equal(objective.progress,0);assert.equal(objective.completed,false);
  assert.equal(w.s.containers[prop.lootContainerId].itemIds.length,1);
  const count=Object.keys(w.s.items).length;
  w.breakProp(prop,{actorId:p.id});
  assert.equal(objective.progress,0);assert.equal(Object.keys(w.s.items).length,count);
  assert.equal(w.drainEvents().filter(e=>e.eventType==='Destroyed'&&e.payload.targetId===prop.id).length,1);
  const fresh={...prop,id:'synthetic-player-break',hp:10,broken:false,revision:1,lootContainerId:null};w.s.destructibles[fresh.id]=fresh;
  w.damageQueue.push({target:fresh.id,damage:120,actorId:p.id});w.resolveDamage();
  assert(fresh.broken);assert.equal(objective.progress,1);
  w.breakProp(fresh,{actorId:p.id});assert.equal(objective.progress,1);
  const reloaded=restored(w);assert.equal(reloaded.s.director.objective.progress,1);assert(reloaded.s.destructibles[prop.id].broken);assert(reloaded.s.destructibles[fresh.id].broken);
});
