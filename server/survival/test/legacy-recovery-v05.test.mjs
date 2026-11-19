import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../config.mjs';
import {SurvivalWorld} from '../world.mjs';
const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
test('old recovery gains distant daytime guards once while all collected nodes and inventory remain unchanged',()=>{
 const world=new SurvivalWorld(config);world.allocate('migration fixture','isolated-test-hash');world.startNight();world.defeat();
 const saved=world.serialize();saved.enemies={};delete saved.recovery.duration;delete saved.recovery.clockOffset;delete saved.calendar;
 const nodes=Object.values(saved.nodes);nodes[0].state='depleted';
 const restored=new SurvivalWorld(config,saved),guards=Object.values(restored.s.enemies);
 assert.equal(guards.length,6);assert(guards.every(e=>e.source==='wild'&&Math.hypot(e.x,e.z)>=45));
 assert.deepEqual(restored.s.nodes,saved.nodes);assert.deepEqual(restored.s.items,saved.items);assert.deepEqual(restored.s.bank,saved.bank);
 const again=new SurvivalWorld(config,restored.serialize());assert.deepEqual(again.s.enemies,restored.s.enemies);assert.equal(again.phaseRemaining(),420);
});
