// Isolated authoritative-world coverage. The fixture only grants an owned rod
// and places players on an unobstructed bank. Cast, hook, movement, reeling,
// landing, cancel and pickup all use normal commands/inputs and 30 Hz ticks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SurvivalWorld} from '../world.mjs';
import {compileState,diffState,quantizeWire} from '../state-wire.mjs';
import {fixture,command,put} from './director-helpers.mjs';
const rods=['rod_basic','rod_light','rod_pro','rod_heavy','rod_magnet'];
const dt=1/30;
const accepted=result=>assert.equal(result.ok,true,result.code);
const totals=w=>Object.values(w.s.items).reduce((out,item)=>(out[item.definitionId]=(out[item.definitionId]??0)+item.quantity,out),{});
function setup(id,count=1,change=null) {
  const a=fixture(count,change),{w,p}=a,container=w.s.containers[p.equipment.rod];
  for(const item of [...container.itemIds])w.removeItem(w.s.items[item]);
  w.createItem(id,1,container);p.heldSlot='rod';p.equipUntil=0;put(p,w,0,99);p.yaw=Math.PI;
  w.drainEvents();return a;
}
function cast(w,p,target={x:0,z:106}) {accepted(command(w,p,'Cast',{...target,power:.7}));}
function tick(w,p,input={}) {
  for(const player of w.scenePlayers())w.input(player,{seq:player.inputAck+1,dx:0,dz:0,yaw:player.yaw,pitch:player.pitch,...(player===p?input:{})});
  w.step(dt);if(w.needsBarrier)w.finishDayBarrier();
}
function publicSelf(w,p) {return w.publicState().players.find(v=>v.id===p.id);}
function run(w,p,{stationary=false,held=false,stopAt=null,limit=70}={}) {
  let time=0,pulling=true,snagTarget=null,hooks=0,lastCue='',snags=0,snagSeconds=0;
  const cues=new Set(),states=new Set(),trace=[],events=[];
  const start={x:p.x,z:p.z};
  while(p.fishing&&time<limit) {
    const observed=publicSelf(w,p),f=observed.fishing;
    if(stopAt?.(f,observed))break;
    states.add(f.state);cues.add(f.cue);
    if(f.cue==='snag'){if(lastCue!=='snag')snags++;snagSeconds+=dt;}lastCue=f.cue;
    if(f.state==='BITE'){accepted(command(w,p,'Hook'));hooks++;}
    let input={reel:false};
    if(held)input.reel=true;
    else if(f.state==='WAIT')input.reel=f.mode==='magnet'||f.mode==='lure'&&f.cue!=='lure_pause';
    else if(f.state==='REEL') {
      if(f.tension>78)pulling=false;else if(f.tension<45)pulling=true;
      input.reel=pulling;
      if(f.mode==='lure')input.reel=f.tension<80&&f.cue!=='lure_pause';
      if(f.mode==='power')input.reel=f.cue!=='rush'&&f.tension<80;
      if(f.mode==='angle'&&!stationary) {
        const destination=start.x+f.pullSide*1.2;
        input.dx=Math.abs(p.x-destination)>.16?Math.sign(destination-p.x):0;
      }
      if(f.mode==='magnet'&&f.cue==='snag') {
        input.reel=false;
        if(!stationary){snagTarget??=p.x+.9;input.dx=Math.abs(p.x-snagTarget)>.12?Math.sign(snagTarget-p.x):0;}
      } else snagTarget=null;
    }
    if(f) {
      assert(!Object.keys(f).some(k=>k.startsWith('_')),'private control state leaked');
      for(const key of ['creature','loot_definition_id','loot_quantity','catch_resistance'])assert.equal(f[key],undefined);
      for(const key of ['progress','tension','remaining','pullSide','angleAdvantage','activity','signal','motion'])assert(Number.isFinite(f[key]),key);
      assert.equal(f.reeling,p.input.reel===true);
    }
    tick(w,p,input);time+=dt;events.push(...w.drainEvents());
    if(trace.length<10||trace.at(-1).state!==p.fishing?.state||trace.at(-1).cue!==p.fishing?.cue)trace.push({time,state:p.fishing?.state??null,cue:p.fishing?.cue??null});
  }
  return {time,hooks,cues,states,snags,snagSeconds,events,trace};
}

for(const id of rods)test(id+' completes from normal Cast/Hook/input ticks and publishes readable feedback',()=>{
  const {w,p}=setup(id,2);const bank=structuredClone(w.s.bank),before=totals(w);cast(w,p);const result=run(w,p);
  assert.equal(p.fishing,null,JSON.stringify(result.trace));assert(result.time<45,JSON.stringify({id,time:result.time}));
  assert(result.states.has('WAIT')&&result.states.has('REEL')&&result.states.has('LAND'));
  assert.deepEqual(w.s.bank,bank);assert(result.events.some(e=>e.eventType==='FishingChanged'&&e.payload.state==='LANDED'));
  if(id==='rod_magnet') {
    assert.equal(result.hooks,0);assert(!result.states.has('BITE'));assert.equal(result.snags,2);assert(result.cues.has('free'));
    const box=Object.values(w.s.containers).find(v=>v.source==='magnet');assert(box&&box.itemIds.length===1);
    const item=w.s.items[box.itemIds[0]];assert.equal(totals(w)[item.definitionId]-(before[item.definitionId]??0),item.quantity);
    assert.equal(w.s.statistics.fishLanded,0);assert.equal(w.activeMagnetCount(p),1);assert.equal(p.pendingMagnetCatch,null);
    accepted(command(w,p,'Pickup',{},box.id));assert.equal(w.activeMagnetCount(p),0);
  } else {
    assert.equal(result.hooks,1);assert(result.states.has('BITE'));assert.equal(w.activeFishingCount(p),1);
    const fish=Object.values(w.s.enemies).find(e=>e.source==='fishing');assert(fish.hp>0);
    assert.equal(command(w,p,'Pickup',{},fish.id).code,'INVALID_TARGET','living catch must still be defeated');
    assert.deepEqual(totals(w),before);
  }
  if(id==='rod_heavy')assert(result.cues.has('rush')&&result.cues.has('tired'));
  if(id==='rod_light')assert(result.cues.has('lure_pull')&&result.cues.has('lure_pause'));
  if(id==='rod_pro')assert(result.cues.has('side_left')||result.cues.has('side_right'));
  w.assertInvariants();
});

test('magnet narrow-bank release fallback succeeds twice without any position edits or extra resources',()=>{
  const {w,p}=setup('rod_magnet');const position={x:p.x,z:p.z};cast(w,p);const pending=structuredClone(p.pendingMagnetCatch),before=totals(w),r=run(w,p,{stationary:true});
  assert.equal(p.fishing,null);assert.equal(r.snags,2);assert(r.snagSeconds>=5.8&&r.snagSeconds<6.3,r.snagSeconds);
  assert.equal(p.x,position.x);assert.equal(p.z,position.z);
  assert.equal(w.activeMagnetCount(p),1);assert.equal(totals(w)[pending.definitionId]-(before[pending.definitionId]??0),pending.quantity);
});

test('light holding through BITE requires a fresh hook command and can recover after a release',()=>{
  const {w,p}=setup('rod_light');cast(w,p);
  let time=0;while(p.fishing?.state!=='BITE'&&time<25){tick(w,p,{reel:true});time+=dt;}
  assert.equal(p.fishing?.state,'BITE');assert.equal(p.input.reel,true);
  for(let i=0;i<6;i++)tick(w,p,{reel:true});assert.equal(p.fishing.state,'BITE','holding is not an unrequested hook');
  tick(w,p,{reel:false});accepted(command(w,p,'Hook'));assert.equal(p.fishing.state,'REEL');run(w,p);
  assert.equal(w.activeFishingCount(p),1);
});

for(const id of rods)test(id+' forgotten cast ends in finite time with no reward',()=>{
  const {w,p}=setup(id);const before=totals(w);cast(w,p);
  let time=0;while(p.fishing&&time<80){tick(w,p);time+=dt;}
  assert.equal(p.fishing,null,`${id} stuck after ${time}`);assert(time<75);
  assert.deepEqual(totals(w),before);assert.equal(w.activeFishingCount(p),0);assert.equal(w.activeMagnetCount(p),0);
});

test('cancel, reconnect, and online save restoration keep the pending magnet reward fixed',()=>{
  let {w,p}=setup('rod_magnet');cast(w,p);const pending=structuredClone(p.pendingMagnetCatch),stream=w.s.rng.magnet,before=totals(w);
  for(let i=0;i<4;i++){accepted(command(w,p,'CancelFish'));cast(w,p);assert.deepEqual(p.pendingMagnetCatch,pending);assert.equal(w.s.rng.magnet,stream);}
  w.disconnect(p);assert.equal(p.fishing,null);assert.deepEqual(p.pendingMagnetCatch,pending);w.connect(p,p.name);cast(w,p);
  run(w,p,{stopAt:f=>f.state==='REEL'&&f.cue==='snag'});assert.equal(p.fishing.cue,'snag');
  const state=publicSelf(w,p);assert.equal(state.pendingMagnetCatch,undefined);assert.equal(state.fishing.loot_definition_id,undefined);
  const snapshot=w.serialize();w=new SurvivalWorld(w.c,snapshot,{onlineRoster:true});p=w.s.players[p.id];assert.equal(p.fishing,null);assert.deepEqual(p.pendingMagnetCatch,pending);
  w.connect(p,p.name);assert.deepEqual(totals(w),before);cast(w,p);assert.equal(w.s.rng.magnet,stream);assert.deepEqual(p.pendingMagnetCatch,pending);
  const result=run(w,p);assert.equal(w.activeMagnetCount(p),1,JSON.stringify(result.trace));
  assert.equal(totals(w)[pending.definitionId]-(before[pending.definitionId]??0),pending.quantity);assert.equal(p.pendingMagnetCatch,null);
  const after=totals(w);for(let i=0;i<10;i++)tick(w,p);assert.deepEqual(totals(w),after);w.assertInvariants();
});

for(const reason of ['equipment','damage','disconnect'])test(reason+' interrupts fishing and cannot accidentally award a catch',()=>{
  const {w,p}=setup('rod_magnet');cast(w,p);run(w,p,{stopAt:f=>f.state==='REEL'});const before=totals(w),pending=structuredClone(p.pendingMagnetCatch);
  if(reason==='equipment')accepted(command(w,p,'SwitchEquip',{slot:'weapon'}));
  // This branch is a labeled damage fixture, not an enemy-AI/combat test.
  if(reason==='damage'){w.damageQueue.push({target:p.id,actorId:'synthetic-hit',damage:1});tick(w,p);}
  if(reason==='disconnect')w.disconnect(p);
  assert.equal(p.fishing,null);assert.equal(w.activeMagnetCount(p),0);assert.deepEqual(totals(w),before);assert.deepEqual(p.pendingMagnetCatch,pending);
});

test('valid sea points beyond named pools remain fishable around seven coast directions',()=>{
  const {w,p}=setup('rod_basic');let acceptedPoints=0;
  for(const index of [0,1,2,3,5,6,7]) {
    const angle=index*Math.PI/4,x=Math.cos(angle)*99,z=Math.sin(angle)*99;
    put(p,w,x,z);p.yaw=-angle-Math.PI/2;
    cast(w,p,{x:Math.cos(angle)*106,z:Math.sin(angle)*106});
    assert.equal(p.fishing.poolId,null);accepted(command(w,p,'CancelFish'));acceptedPoints++;
  }
  assert.equal(acceptedPoints,7);
  put(p,w,-34,0);accepted(command(w,p,'Cast',{},'near'));assert.equal(p.fishing.poolId,'near');
});

test('full and delta snapshots include feedback for observers while excluding simulation internals',()=>{
  const {w,p}=setup('rod_magnet',8);cast(w,p);const previous=compileState(w.publicState());
  run(w,p,{stopAt:f=>f.state==='REEL'&&f.cue==='snag'});
  const current=compileState(w.publicState()),delta=diffState(previous,current).delta;
  const patch=delta.entities.players.patch.find(v=>v.id===p.id),f=patch.set.fishing;
  assert.equal(f.cue,'snag');assert.equal(f.mode,'magnet');assert.equal(current.state.players.length,8);
  assert.deepEqual(f,current.state.players.find(v=>v.id===p.id).fishing);
  assert(!Object.keys(f).some(key=>key.startsWith('_')));
  assert(!current.fullBody.includes('pendingMagnetCatch'));assert(!current.fullBody.includes('loot_definition_id'));
  assert(!current.fullBody.includes('_snag'));assert(!current.fullBody.includes('_motionPhase'));
  for(const key of ['motion','angleAdvantage','signal','activity'])assert.equal(f[key],quantizeWire(p.fishing[key]));
  accepted(command(w,p,'CancelFish'));const ended=compileState(w.publicState());
  assert.equal(diffState(current,ended).delta.entities.players.patch.find(v=>v.id===p.id).set.fishing,null);
});

test('stale held input releases safely and client-supplied feedback cannot unlock a snag',()=>{
  const {w,p}=setup('rod_magnet');cast(w,p);run(w,p,{stopAt:f=>f.state==='REEL'&&f.cue==='snag'});
  w.input(p,{seq:p.inputAck+1,reel:true,dx:0,dz:0,yaw:p.yaw,pitch:0,cue:'free',signal:1,angleAdvantage:1});
  w.step(dt);assert.equal(p.fishing.cue,'snag');const before=p.fishing.progress;
  for(let i=0;i<20;i++)w.step(dt);
  assert.equal(p.input.reel,undefined);assert.equal(p.fishing.progress,before);assert.equal(publicSelf(w,p).fishing.reeling,false);
});

for(const id of ['rod_basic','rod_magnet'])for(const destination of ['backpack','storage','teammate','replacement'])test(id+' normal Transfer to '+destination+' cancels its line without awarding or duplicating a catch',()=>{
  // Explicit interaction fixture: relocate one existing storage terminal to the
  // test bank. No direct peer transfer exists; a teammate legally takes the rod
  // from shared storage. Item ownership is changed only by Transfer commands.
  const {w,p,ps}=setup(id,2,c=>{const terminal=c.level.terminals.find(t=>t.id==='storage');terminal.x=-2;terminal.z=99;});
  put(ps[1],w,-2,97.8);
  const rod=w.equipped(p,'rod');
  const replacement=destination==='replacement'?w.createItem(id==='rod_basic'?'rod_magnet':'rod_basic',1,w.bag(p)):null;
  cast(w,p);run(w,p,{stopAt:f=>f.state==='REEL'});assert.equal(p.fishing.state,'REEL');
  const before=totals(w),pending=structuredClone(p.pendingMagnetCatch),progress=p.fishing.progress;
  assert(progress<100);
  const toContainerId=['storage','teammate'].includes(destination)?'storage':p.backpackId;
  accepted(command(w,p,'Transfer',{itemId:rod.id,toContainerId,stationId:'storage'}));
  if(destination==='teammate')accepted(command(w,ps[1],'Transfer',{itemId:rod.id,toContainerId:ps[1].backpackId,stationId:'storage'}));
  if(replacement)accepted(command(w,p,'Transfer',{itemId:replacement.id,toContainerId:p.equipment.rod}));
  tick(w,p,{reel:true});
  assert.equal(p.fishing,null);assert.equal(publicSelf(w,p).fishing,null);
  assert.equal(w.activeFishingCount(p),0);assert.equal(w.activeMagnetCount(p),0);assert.deepEqual(totals(w),before);
  assert.deepEqual(p.pendingMagnetCatch,pending,'changing custody must not reroll or consume pending salvage');
  if(destination==='teammate')assert.equal(rod.containerId,ps[1].backpackId);
  if(replacement)assert.equal(w.equipped(p,'rod').id,replacement.id);
  for(let i=0;i<45;i++)tick(w,p,{reel:true});assert.deepEqual(totals(w),before);w.assertInvariants();
});
