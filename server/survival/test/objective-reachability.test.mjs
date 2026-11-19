import test from 'node:test';
import assert from 'node:assert/strict';
import {SurvivalWorld as FixedWorld} from '../world.mjs';

import {loadConfig} from '../config.mjs';
const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
function fixture(World=FixedWorld,n=2,id='lost_files'){const w=new World(config,null,{onlineRoster:true}),ps=Array.from({length:n},(_,i)=>w.allocate('Synthetic '+i,'isolated-'+i));w.s.lockedPlayerCount=n;w.setPhase('DAY');w.s.director.objective=w.director.newObjective(w.c.director.objectives.find(o=>o.id===id));w.s.director.optionalObjective=null;w.generateDay();w.s.enemies={};w.s.destructibles={};return {w,ps,p:ps[0],o:w.s.director.objective};}
function legacyFixture(){const f=fixture();f.o.zoneId='supply';delete f.o.stockExpanded;f.w.director.reconcileObjectives=()=>{};return f;}
function search(f,node){const {w,p}=f;Object.assign(p,{x:node.x+.3,z:node.z,y:w.ground(node.x+.3,node.z),joinProtectionUntil:0});const result=w.command(p,{requestId:p.requestHighWater+1,command:'Search',targetId:node.id});assert(result.ok);w.input(p,{seq:p.inputAck+1,interact:true});w.s.time+=1;w.updateWork(p,1);assert.equal(node.state,'depleted');}
function connectAll(w){for(const p of Object.values(w.s.players))w.connect(p,p.name);}
function rewards(w){return Object.values(w.s.containers).filter(c=>c.source==='objective');}
test('regional-only fixture reproduces two-person supply has one treasure against goal two and remains incomplete after all treasures',()=>{
  const f=legacyFixture(),treasures=Object.values(f.w.s.nodes).filter(n=>n.kind==='treasure');assert.equal(treasures.length,3);assert.equal(treasures.filter(n=>n.zoneId==='supply').length,1);assert.equal(f.o.goal,2);assert.equal(f.o.zoneId,'supply');for(const node of treasures)search(f,node);assert.equal(f.o.progress,1);assert.equal(f.o.completed,false);assert.equal(rewards(f.w).length,0);
});
test('fixed generated stage expands the objective area, leaves stock unchanged and rewards exactly two actual searches once',()=>{
  const f=fixture(),nodes=Object.values(f.w.s.nodes),treasures=nodes.filter(n=>n.kind==='treasure');assert.equal(nodes.length,18);assert.equal(treasures.length,3);assert.equal(f.o.goal,2);assert.equal(f.o.zoneId,null);assert(f.o.stockExpanded);search(f,treasures.find(n=>n.zoneId==='supply'));assert.equal(f.o.progress,1);search(f,treasures.find(n=>n.zoneId!=='supply'));assert(f.o.completed);assert.equal(rewards(f.w).length,1);const stock=Object.keys(f.w.s.items).length;f.w.director.reconcileObjectives();assert.equal(rewards(f.w).length,1);assert.equal(Object.keys(f.w.s.items).length,stock);f.w.assertInvariants();
});
test('old v080 outside-area completed searches backfill by ID and settle only after players resume; reconnect cannot grant again',()=>{
  const old=legacyFixture();for(const node of Object.values(old.w.s.nodes).filter(n=>n.kind==='treasure'&&n.zoneId!=='supply').slice(0,2))search(old,node);assert.equal(old.o.progress,0);const saved=old.w.serialize(),w=new FixedWorld(config,saved,{onlineRoster:true});assert.equal(w.s.director.objective.progress,2);assert.equal(w.s.director.objective.completed,false);assert.equal(rewards(w).length,0);assert.deepEqual(w.s.items,saved.items);assert.deepEqual(w.s.nodes,saved.nodes);assert.deepEqual(w.s.bank,saved.bank);connectAll(w);w.step(1/30);assert.equal(rewards(w).length,1);assert(w.s.director.objective.completed);for(const p of Object.values(w.s.players))assert.equal(p.rewardOffers.length,1);const granted=w.serialize(),again=new FixedWorld(config,granted,{onlineRoster:true});connectAll(again);again.step(1/30);assert.equal(rewards(again).length,1);assert.deepEqual(again.s.items,granted.items);for(const p of Object.values(again.s.players))assert.equal(p.rewardOffers.length,1);
});
test('partial old progress plus one missed outside search completes without duplicating the already counted supply node',()=>{
  const old=legacyFixture(),treasures=Object.values(old.w.s.nodes).filter(n=>n.kind==='treasure');search(old,treasures.find(n=>n.zoneId==='supply'));search(old,treasures.find(n=>n.zoneId!=='supply'));assert.equal(old.o.progress,1);const w=new FixedWorld(config,old.w.serialize(),{onlineRoster:true});assert.equal(w.s.director.objective.progress,2);assert.equal(new Set(w.s.director.objective.seen).size,2);connectAll(w);w.step(1/30);assert.equal(rewards(w).length,1);
});
test('enough remaining regional stock including a held search keeps its area and remains achievable',()=>{
  const f=fixture(FixedWorld,4),regional=Object.values(f.w.s.nodes).filter(n=>n.kind==='treasure'&&n.zoneId==='supply');assert.equal(regional.length,2);assert.equal(f.o.goal,2);assert.equal(f.o.zoneId,'supply');regional[0].state='SEARCHING';regional[0].lockedBy=f.p.id;f.w.director.reconcileObjectives();assert.equal(f.o.zoneId,'supply');assert.equal(f.o.unavailable,undefined);assert.equal(f.o.progress,0);
});
test('quiet-search failure marks missed only when actual remaining stock is insufficient; historical depletion earns nothing',()=>{
  const f=fixture(FixedWorld,2,'quiet_patrol'),nodes=Object.values(f.w.s.nodes);for(const node of nodes.slice(3))node.state='depleted';nodes[0].state='SEARCHING';nodes[0].lockedBy=f.p.id;f.w.director.reconcileObjectives();assert.equal(f.o.unavailable,undefined);assert.equal(f.o.goal,3);nodes[1].state='depleted';f.w.director.reconcileObjectives();assert(f.o.unavailable);assert.equal(f.o.unavailableMessage,'本轮错过，明天再试');assert.equal(f.o.progress,0);assert.equal(rewards(f.w).length,0);const w=new FixedWorld(config,f.w.serialize(),{onlineRoster:true});connectAll(w);w.step(1/30);assert.equal(rewards(w).length,0);assert(w.s.director.objective.unavailable);w.setPhase('DAY');assert(!w.s.director.objective.unavailable);
});
