import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,command,advance,enemy,restored,put} from './director-helpers.mjs';
test('objective library rotates all eight definitions before repeating and keeps history across restore',()=>{
  const {w,p}=fixture(),chosen=[];for(let i=0;i<8;i++){w.setPhase('DAY');chosen.push(w.s.director.objective.definitionId);w.s.time+=50;}assert.equal(new Set(chosen).size,8);const save=restored(w);assert.deepEqual(save.s.director.history,w.s.director.history);save.connect(save.s.players[p.id],p.name);save.setPhase('DAY');assert.equal(save.s.director.objective.definitionId,chosen[0]);assert.equal(save.s.phasePlan.players,1);
});
test('pending windup, deployed zone, personal offer and phase resume together without rerolling',()=>{
  const {w,p}=fixture();w.setPhase('DAY');
  // A normal DAY enters only after its finite search stock is generated. Keep
  // that stock here so restoration is not also repairing an impossible fixture.
  w.generateDay();assert(Object.keys(w.s.nodes).length>0);
  const e=enemy(w,p,'spore_slug',{x:0,z:-3});advance(w,.2);
  assert.equal(e.state,'WINDUP');assert(e.phaseRemaining>0);
  w.director.addZone(e,{x:25,z:25});w.director.offer('synthetic-ledger');
  const before=w.serialize(),again=restored(w);
  assert.deepEqual(again.s.nodes,before.nodes);
  assert.deepEqual(again.s.enemies,before.enemies);assert.deepEqual(again.s.director,before.director);assert.deepEqual(again.s.phasePlan,before.phasePlan);assert.deepEqual(again.s.players[p.id].rewardOffers,before.players[p.id].rewardOffers);assert.deepEqual(again.s.items,before.items);
  again.connect(again.s.players[p.id],p.name);advance(again,.2);
  assert(again.s.enemies[e.id].phaseRemaining<before.enemies[e.id].phaseRemaining);assert.equal(again.s.enemies[e.id].attackZone.endsAt,before.enemies[e.id].attackZone.endsAt);
});
test('an offer exhausted by other saved choices is closed without random replacement or stacking',()=>{
  const {w,p}=fixture();p.rewardOffers=[{id:'first',source:'fixture',options:['pockets'],selected:null},{id:'second',source:'fixture2',options:['pockets'],selected:null}];const slots=w.bag(p).slotLimit;assert(command(w,p,'ChooseReward',{offerId:'first',perkId:'pockets'}).ok);assert.equal(p.rewardOffers[1].exhausted,true);const q=restored(w).s.players[p.id];assert(q.rewardOffers[1].exhausted);assert.deepEqual(q.rewardOffers[1].options,['pockets']);assert.equal(w.bag(p).slotLimit,slots+2);assert.equal(command(w,p,'ChooseReward',{offerId:'second',perkId:'pockets'}).ok,false);
});
test('night variation retains 1/2/4/8 active caps for a real 180-second simulation and does not freeze on failure',()=>{
  for(const [n,cap]of [[1,5],[2,8],[4,14],[8,24]]){const {w,ps}=fixture(n);w.startNight();let maximum=0;for(let tick=0;tick<180*30;tick++){for(const p of ps)if(p.connected)w.input(p,{seq:p.inputAck+1,dx:0,dz:0,yaw:0,pitch:0});w.step(1/30);maximum=Math.max(maximum,Object.values(w.s.enemies).filter(e=>e.night).length);assert(maximum<=cap);if(w.needsBarrier)w.finishDayBarrier();if(tick%30===0)w.assertInvariants();}assert(w.s.statistics.daysSurvived+w.s.statistics.breaches>=1);assert(w.s.phase!=='COMPLETE');assert(Number.isFinite(w.s.time));assert(maximum>1);}
});
test('two different players cannot claim each other offer or duplicate objective loot by a replay',()=>{
  const {w,p,ps}=fixture(2);w.director.offer('one-source');const other=ps[1].rewardOffers[0];assert.equal(command(w,p,'ChooseReward',{offerId:other.id,perkId:other.options[0]}).code,'NOT_FOUND');const own=p.rewardOffers[0],request={requestId:p.requestHighWater+1,command:'ChooseReward',payload:{offerId:own.id,perkId:own.options[0]}};const first=w.command(p,request),again=w.command(p,request);assert.deepEqual(first,again);assert.equal(p.perks.length,1);w.assertInvariants();
});
