import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,command,advance,enemy,restored,base,put} from './director-helpers.mjs';
import {SurvivalWorld} from '../world.mjs';
import {extendDirectorConfig} from '../director-config.mjs';

test('phase lengths lock online headcount once; later join applies next phase only',()=>{
  for(const n of [1,2,4,8]){const {w,p}=fixture(n);advance(w,.1);assert.equal(w.phaseDuration(),60);assert.equal(w.s.phasePlan.players,n);if(n<8){const q=w.allocate('Late synthetic','late-only');w.connect(q,q.name);assert.equal(w.phaseDuration(),60);}w.setPhase('DAY');assert.equal(w.s.phasePlan.players,Math.min(8,n+1));assert.equal(w.phaseDuration(),420);w.assertInvariants();}
});
test('legacy phase remains old duration and elapsed until its transition; restart keeps lock',()=>{
  for(const [phase,field]of [['PREP','prep_seconds'],['DAY','day_seconds'],['RETURN','return_seconds'],['NIGHT','night_survival_seconds']]){const {w,p}=fixture(),duration=w.c.cycle[field];w.s.phase=phase;w.s.phaseElapsed=12;const saved=w.serialize();delete saved.director;delete saved.phasePlan;const old=new SurvivalWorld(w.c,saved,{onlineRoster:true});assert.equal(old.s.phaseElapsed,12);assert.equal(old.phaseDuration(),duration);assert.equal(old.s.phasePlan.legacy,true);old.connect(old.s.players[p.id],p.name);advance(old,.2);const again=restored(old);assert.equal(again.phaseDuration(),duration);assert(Math.abs(again.s.phaseElapsed-12.2)<.001);again.setPhase('PREP');assert.equal(again.phaseDuration(),60);}
});
test('online clock uses duration rather than timescale; empty world does not advance',()=>{
  const {w,ps}=fixture(8);advance(w,1);assert.equal(w.s.phasePlan.duration,60);assert(Math.abs(w.publicClock().hour+ w.publicClock().minute/60-(6+2/60))<.02);for(const p of ps)w.disconnect(p);const before=w.s.time;advance(w,2);assert.equal(w.s.time,before);w.connect(ps[0],ps[0].name);advance(w,59.1);assert.equal(w.s.phase,'DAY');assert.equal(w.phaseDuration(),420);
});
test('day and night composition rotate real roles without exceeding existing stock/count budgets',()=>{
  const {w}=fixture(8);w.s.lockedPlayerCount=8;w.setPhase('DAY');w.generateDay();assert.equal(Object.keys(w.s.enemies).length,24);assert.equal(Object.keys(w.s.nodes).length,56);assert.equal(Object.keys(w.s.destructibles).length,36);assert(Object.values(w.s.enemies).some(e=>['courier','shield','jammer','breaker','spore'].includes(e.role)));w.startNight();assert.equal(w.s.night.pending.length,34);assert.equal(w.s.night.aliveCap,18);assert.equal(Object.keys(w.s.enemies).length,1);assert(w.s.night.pending.some(e=>!['crab','eel'].includes(e.definitionId)));for(let i=0;i<6;i++){const id=w.s.director.nightPlan.id;assert.equal(w.s.director.history.filter(h=>h.kind==='night'&&h.id===id).length,1);if(i<5)w.startNight();}w.assertInvariants();
});
test('objective completion grants one real tool container and persistent, nonstacking private choices',()=>{
  const {w,p}=fixture();w.setPhase('DAY');w.s.director.objective=w.director.newObjective(w.c.director.objectives.find(o=>o.id==='risk_order'));w.s.director.optionalObjective=null;
  for(let i=0;i<2;i++){const e=enemy(w,p);w.killEnemy(e,p.id);}const o=w.s.director.objective;assert(o.completed);assert.equal(w.s.containers[o.rewardContainerId].itemIds.length,1);assert.equal(w.s.items[w.s.containers[o.rewardContainerId].itemIds[0]].definitionId,'decoy_alarm');assert.equal(p.rewardOffers.length,1);const offer=p.rewardOffers[0],choice=offer.options[0];assert.equal(command(w,p,'ChooseReward',{offerId:offer.id,perkId:'not-owned-offer'}).ok,false);assert(command(w,p,'ChooseReward',{offerId:offer.id,perkId:choice}).ok);assert.equal(command(w,p,'ChooseReward',{offerId:offer.id,perkId:choice}).code,'ALREADY_CLAIMED');const next=restored(w);next.connect(next.s.players[p.id],p.name);assert.deepEqual(next.s.players[p.id].perks,[choice]);assert(next.s.director.objective.completed);assert.equal(next.s.director.objective.rewardContainerId,o.rewardContainerId);const before=Object.keys(next.s.items).length;next.director.completeObjective(next.s.director.objective);assert.equal(Object.keys(next.s.items).length,before);
});
test('new config validates finite budgets and phase lengths, old config automatically extends',()=>{
  const old=structuredClone(base);delete old.director;old.creatures=old.creatures.slice(0,4);old.items=old.items.filter(i=>!['decoy_alarm','repair_kit'].includes(i.id));const c=extendDirectorConfig(old);assert.equal(c.director.perks.length,8);assert.equal(c.creatures.length,15);for(const id of ['paper_drone','stamp_bat','archive_guard'])assert(c.creatures.some(e=>e.id===id));for(const mutate of [c=>c.director.phaseRows[0].DAY=-1,c=>c.director.budgets.maxDeployables=100,c=>c.director.tools.decoy_alarm.range=NaN]){const c=structuredClone(base);mutate(c);assert.throws(()=>extendDirectorConfig(c),/Invalid/);}
});
