import test from 'node:test';
import assert from 'node:assert/strict';
import {SurvivalWorld} from '../world.mjs';
import {loadConfig} from '../config.mjs';
const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
const coordinates=p=>({x:p.x,y:p.y,z:p.z});
function fixture(count=1){const c=structuredClone(config);c.cycle.seed_default=88317;const w=new SurvivalWorld(c,null,{onlineRoster:true}),ps=Array.from({length:count},(_,i)=>w.allocate('合成队员'+i,'synthetic-prop-test-'+i));w.s.dayIndex=2;w.setPhase('DAY');return {w,ps};}
function forcedFallback(w){const blocked=w.blocked.bind(w),choose=w.choosePoint.bind(w);let calls=0;w.blocked=(x,y,z,radius,...rest)=>radius===1.6?{id:'synthetic-random-candidates-unavailable'}:blocked(x,y,z,radius,...rest);w.choosePoint=(...args)=>{calls++;return choose(...args);};return()=>calls;}
function nextSites(w,fallback=false){const probe=new SurvivalWorld(w.c,w.serialize(),{onlineRoster:true});if(fallback)forcedFallback(probe);probe.generateDestructibles();return Object.values(probe.s.destructibles).map(p=>structuredClone(p));}
function at(w,p,q){Object.assign(p,{x:q.x,y:w.ground(q.x,q.z),z:q.z});}
function conserved(w){return structuredClone({players:w.s.players,items:w.s.items,containers:w.s.containers,bank:w.s.bank,statistics:w.s.statistics,enemies:w.s.enemies});}
function clear(w,actors){for(const p of actors){const radius=p.lifeState?w.c.player.capsule_radius:p.radius;assert.equal(SurvivalWorld.prototype.blocked.call(w,p.x,p.y,p.z,radius)?.id,undefined,'actual authoritative collision for '+p.id);}}
function props(w){const rows=Object.values(w.s.destructibles);assert.equal(rows.length,36);assert.equal(new Set(rows.map(p=>p.id)).size,36);assert.deepEqual(Object.fromEntries(w.c.destructibles.types.map(q=>q.id).map(kind=>[kind,rows.filter(p=>p.kind===kind).length])),{crate:6,barrel:6,barricade:2,partition_panel:6,archive_cabinet:6,copier_shell:2,supply_locker:2,cable_reel:2,punch_clock:2,notice_board:2});for(const p of rows){assert.equal(p.broken,false);assert.equal(p.hp,p.explorationId&&w.s.exploration.events.find(e=>e.id===p.explorationId)?.type==='parcel_intact'?180:w.c.destructibles.types.find(q=>q.id===p.kind).hp);}}

for(const count of [1,2,4,8])test('new daily scenery avoids '+count+' existing teammates without changing players or economy',()=>{
 const {w,ps}=fixture(count),sites=nextSites(w);w.s.destructibles={};ps.forEach((p,i)=>at(w,p,sites[i]));clear(w,ps);const before=conserved(w);w.generateDestructibles();props(w);clear(w,ps);assert.deepEqual(conserved(w),before);
 const saved=w.serialize(),restored=new SurvivalWorld(w.c,saved,{onlineRoster:true});assert.deepEqual(restored.s.destructibles,saved.destructibles);assert.deepEqual(restored.s.items,saved.items);assert.deepEqual(restored.s.bank,saved.bank);for(const p of ps)assert.deepEqual(coordinates(restored.s.players[p.id]),coordinates(p));restored.assertInvariants();
});

for(const kind of ['crate','barrel'])test(kind+' corner clearance follows the real expanded collision box',()=>{
 const {w,ps:[p]}=fixture(),site=nextSites(w).find(q=>q.kind===kind);w.s.destructibles={};const box=w.propBox(site),r=w.c.player.capsule_radius;
 at(w,p,{x:box.x1+r-.02,z:box.z1+r-.02});clear(w,[p]);const before=conserved(w);w.generateDestructibles();props(w);clear(w,[p]);assert.deepEqual(conserved(w),before);
});

test('online downed players keep their position, gear and rescue timer while new props avoid them',()=>{
 const {w,ps:[p]}=fixture(),site=nextSites(w)[0];w.s.destructibles={};at(w,p,site);p.lifeState='DOWNED';p.hp=0;p.downedRemaining=17;const before=conserved(w);w.generateDestructibles();props(w);clear(w,[p]);assert.deepEqual(conserved(w),before);
});

for(const state of ['offline','dead'])test(state+' history does not consume scene space or get moved/rewarded',()=>{
 const {w,ps:[p]}=fixture(),expected=nextSites(w);w.s.destructibles={};at(w,p,expected[0]);if(state==='offline')w.disconnect(p);else{p.lifeState='DEAD_WAIT';p.hp=0;}
 const before=conserved(w);w.generateDestructibles();props(w);assert.deepEqual(Object.values(w.s.destructibles),expected);assert.deepEqual(conserved(w),before);
});

test('DAY regeneration retains landed fish and never encloses them in new scenery',()=>{
 const {w,ps:[p]}=fixture(),sites=nextSites(w);w.s.destructibles={};const e=w.spawnEnemy('silverfish',sites[0].x,sites[0].z);Object.assign(e,{source:'fishing',ownerId:p.id,landed:true,hp:10,maxHp:10,state:'STUNNED',phaseRemaining:1.25});const before=structuredClone(e),items=structuredClone(w.s.items),bank=structuredClone(w.s.bank),positions=Object.values(w.s.players).map(coordinates);
 w.generateDay();props(w);assert.deepEqual(w.s.enemies[e.id],before);clear(w,[e]);assert.deepEqual(w.s.items,items);assert.deepEqual(w.s.bank,bank);assert.deepEqual(Object.values(w.s.players).map(coordinates),positions);
});

test('bounded fallback placement avoids eight teammates and an existing landed fish',()=>{
 const {w,ps}=fixture(8),sites=nextSites(w,true);w.s.destructibles={};ps.forEach((p,i)=>at(w,p,sites[i]));const e=w.spawnEnemy('silverfish',sites[9].x,sites[9].z);Object.assign(e,{source:'fishing',ownerId:ps[0].id,landed:true});clear(w,[...ps,e]);const before=conserved(w),calls=forcedFallback(w);w.generateDestructibles();assert.equal(calls(),28,'ordinary and archive candidate searches deliberately exhausted');props(w);clear(w,[...ps,e]);assert.deepEqual(conserved(w),before);
});
