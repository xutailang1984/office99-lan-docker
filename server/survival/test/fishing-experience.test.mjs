// Pure controller comparisons, not an end-to-end fishing or multiplayer proof.
// Only in-memory inputs/positions are used; no accounts, sockets or save files.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeFishing,beginReeling,updateWaiting,updateReeling} from '../fishing-experience.mjs';
const balance=JSON.parse(await readFile(new URL('../../../client/survival/balance.json',import.meta.url),'utf8'));
const defs=Object.fromEntries(balance.rods.map(d=>[d.id,d]));
const dt=1/30;
function fixture(id,creature='crab') {
  const p={x:0,z:0,input:{reel:false},velocity:{x:0,z:0},stamina:100};
  const f={id:'synthetic-line',x:0,z:8,state:'WAIT',progress:0,tension:25,remaining:5,creature,catch_kind:id==='rod_magnet'?'salvage':'creature',catch_resistance:id==='rod_magnet'?.9:balance.creatures.find(c=>c.id===creature).resistance};
  initializeFishing(f,p,defs[id]);return {p,f,def:defs[id]};
}
const feedback=f=>Object.fromEntries(['state','progress','tension','remaining','mode','cue','behavior','pullSide','angleAdvantage','activity','signal','motion','struggling'].map(k=>[k,f[k]]));
function waiting(id,kind) {
  const a=fixture(id);let t=0,result;
  while(t<30) {
    const f=feedback(a.f);
    a.p.input.reel=kind==='held'||kind==='expert'&&(id==='rod_magnet'||id==='rod_light'&&f.cue!=='lure_pause');
    a.f.remaining-=dt;result=updateWaiting(a.f,a.p,a.def,dt,balance.fishing);t+=dt;
    if(result.readyToBite||result.autoHook)break;
  }
  return {...a,time:t,...result};
}
function reel(id,kind,creature='crab',options={}) {
  const dt=options.step??1/30;
  const a=fixture(id,creature);a.f.state='REEL';a.f.remaining=45;beginReeling(a.f,a.p,a.def);
  let time=0,breakTime=0,held=true,snagTarget=null,sideDistance=0,pressure=0,peakTension=25;
  const counts={};
  while(time<45&&a.f.progress<100&&breakTime<balance.fishing.break_hold_seconds) {
    const f=feedback(a.f);
    if(kind==='held')held=true;
    else {
      if(f.tension>78)held=false;else if(f.tension<45)held=true;
      if(kind==='expert'||kind==='stationary') {
        if(f.mode==='lure')held=f.tension<80&&f.cue!=='lure_pause';
        if(f.mode==='power')held=f.cue!=='rush'&&f.tension<80;
        if(f.mode==='magnet'&&f.cue==='snag')held=false;
      }
    }
    a.p.input.reel=held;
    const before=a.p.x;
    if(kind==='expert'&&f.mode==='angle') {
      const goal=f.pullSide*1.2;
      a.p.x+=Math.sign(goal-a.p.x)*Math.min(Math.abs(goal-a.p.x),3*dt);
    }
    if(kind==='expert'&&f.mode==='magnet') {
      if(f.cue==='snag') {
        snagTarget??=a.p.x+.9;
        a.p.x+=Math.min(Math.max(0,snagTarget-a.p.x),3*dt);
      } else snagTarget=null;
    }
    a.p.velocity.x=(a.p.x-before)/dt;sideDistance+=Math.abs(a.p.x-before);
    const rates=updateReeling(a.f,a.p,a.def,dt,balance.fishing);
    for(const v of Object.values(rates))assert(Number.isFinite(v)&&v>=0);
    if(held) {
      a.f.progress+=rates.progressRate/a.f.catch_resistance*(a.p.stamina>0?1:.7)*dt;
      a.f.tension+=rates.tensionRate*dt;
      a.p.stamina=Math.max(0,a.p.stamina-balance.fishing.reel_stamina_drain*rates.drainScale*dt);
    } else {a.f.progress-=rates.lossRate*dt;a.f.tension-=a.def.tension_fall*dt;}
    a.f.progress=Math.max(0,Math.min(100,a.f.progress));a.f.tension=Math.max(0,Math.min(100,a.f.tension));
    peakTension=Math.max(peakTension,a.f.tension);pressure+=a.f.tension*dt;
    breakTime=a.f.tension>=100?breakTime+dt:0;
    counts[a.f.cue]=(counts[a.f.cue]??0)+1;
    time+=dt;
    options.observe?.(a,rates);
  }
  return {...a,time,landed:a.f.progress>=100,broken:breakTime>=balance.fishing.break_hold_seconds,sideDistance,pressure,peakTension,counts};
}

test('six fishing tools select distinct float, angle, lure, power, magnet and net modes',()=>{
  assert.deepEqual(balance.rods.map(d=>fixture(d.id).f.mode),['float','angle','lure','power','magnet','net']);
  assert.equal(balance.rods.length,6);
});
test('light lure rewards a readable pull/pause strategy; hold and passive waiting remain finite',()=>{
  const good=waiting('rod_light','expert'),held=waiting('rod_light','held'),idle=waiting('rod_light','idle');
  assert(good.readyToBite);assert(!good.autoHook);assert(good.time<held.time*.6,JSON.stringify([good.time,held.time]));
  assert(good.time<idle.time*.6);assert(idle.readyToBite&&idle.time<=20);assert(held.readyToBite&&held.time<=20);
});
test('magnet scans into an automatic attachment, without requiring a bite/hook click',()=>{
  const active=waiting('rod_magnet','expert'),idle=waiting('rod_magnet','idle');
  assert(active.autoHook&&!active.readyToBite);assert.equal(active.f.cue,'attached');assert.equal(active.f.signal,1);
  assert(active.time<idle.time*.5);assert(idle.autoHook&&idle.time<=25);
});
test('distant casts help pro waiting but neither change a catch nor reject valid short casts',()=>{
  const results=[];
  for(const distance of [5,17]) {
    const a=fixture('rod_pro');a.f.z=distance;delete a.f._castDistance;initializeFishing(a.f,a.p,a.def);
    let time=0;while(time<10){a.f.remaining-=dt;time+=dt;if(updateWaiting(a.f,a.p,a.def,dt,balance.fishing).readyToBite)break;}
    assert.equal(a.f.creature,'crab');results.push(time);
  }
  assert(results[1]<results[0]*.85);
});
for(const id of ['rod_basic','rod_light','rod_pro','rod_heavy','rod_magnet'])test(id+' has a successful public-feedback strategy and continuous pulling has a cost',()=>{
  const smart=reel(id,'expert'),blind=reel(id,'held');
  assert(smart.landed,JSON.stringify({id,time:smart.time,progress:smart.f.progress,cues:smart.counts}));
  assert(smart.time<30,`${id} exceeded a readable fishing duration: ${smart.time}`);
  assert(!blind.landed||blind.time>smart.time*1.3,JSON.stringify({id,smart:smart.time,blind:blind.time,landed:blind.landed}));
});
test('lure cadence beats using the old tension-only controller',()=>{
  const cadence=reel('rod_light','expert'),threshold=reel('rod_light','threshold');
  assert(cadence.landed);assert(!threshold.landed||cadence.time<threshold.time*.75,JSON.stringify({cadence:cadence.time,threshold:threshold.time,cadenceCues:cadence.counts,thresholdCues:threshold.counts}));
});
test('pro improves with actual lateral positioning, but standing still remains viable',()=>{
  const moving=reel('rod_pro','expert'),still=reel('rod_pro','stationary');
  assert(moving.landed&&still.landed);assert(moving.sideDistance>.9);assert(moving.time<still.time*.8);
  assert(moving.pressure<still.pressure*.8);
});
test('moving forward, spinning the camera, or faking movement intent cannot earn pro angle credit',()=>{
  const a=fixture('rod_pro');beginReeling(a.f,a.p,a.def);
  a.p.yaw=19;a.p.input={dx:1,dz:1,reel:true};a.p.z=3;
  updateReeling(a.f,a.p,a.def,.1,balance.fishing);assert.equal(a.f.angleAdvantage,0);
  a.p.x=.9;updateReeling(a.f,a.p,a.def,.1,balance.fishing);assert.equal(a.f.angleAdvantage,1);
});
test('heavy target rush and fatigue alter which input is productive',()=>{
  const a=fixture('rod_heavy','eel');beginReeling(a.f,a.p,a.def);a.p.input.reel=true;
  const rush=updateReeling(a.f,a.p,a.def,.1,balance.fishing);assert.equal(a.f.cue,'rush');
  const tired=updateReeling(a.f,a.p,a.def,1.4,balance.fishing);assert.equal(a.f.cue,'tired');
  assert(tired.progressRate>rush.progressRate*5);assert(rush.tensionRate>tired.tensionRate*10);
});
test('magnet lateral release is faster than its narrow-bank fallback, and both complete',()=>{
  const side=reel('rod_magnet','expert'),rest=reel('rod_magnet','stationary');
  assert(side.landed&&rest.landed);assert(side.sideDistance>=1.3);assert(rest.sideDistance===0);
  assert(side.time<rest.time-3);assert(side.counts.snag>0&&rest.counts.snag>0);assert(side.counts.free>0);
  assert.equal(side.f._snagsDone,2);assert.equal(rest.f._snagsDone,2);
});
test('magnet has no progress while caught; camera/forward motion cannot fake changing its angle',()=>{
  const a=fixture('rod_magnet');beginReeling(a.f,a.p,a.def);a.f.progress=31;a.p.input.reel=true;
  assert.equal(updateReeling(a.f,a.p,a.def,.1,balance.fishing).progressRate,0);assert.equal(a.f.cue,'snag');
  a.p.yaw=3;a.p.z=2;a.p.input.dx=1;assert.equal(updateReeling(a.f,a.p,a.def,.1,balance.fishing).progressRate,0);
  a.p.x=.7;assert(updateReeling(a.f,a.p,a.def,.1,balance.fishing).progressRate>0);assert.equal(a.f.cue,'free');
});
test('tiny button spam does not repeatedly restore a fresh lure pull',()=>{
  const a=fixture('rod_light');beginReeling(a.f,a.p,a.def);let rates;
  for(let i=0;i<90;i++){a.p.input.reel=i%2===0;rates=updateReeling(a.f,a.p,a.def,dt,balance.fishing);}
  assert(a.f._holdTime>1);assert(rates.progressRate<defs.rod_light.reel_power);
});
for(const species of ['silverfish','crab','eel','bubble_puffer','lantern_fish'])test(species+' remains obtainable with all four live-fish rod strategies',()=>{
  for(const id of ['rod_basic','rod_light','rod_pro','rod_heavy']){const result=reel(id,'expert',species);assert(result.landed,JSON.stringify({id,species,time:result.time,progress:result.f.progress}));assert(result.time<30);}
});
test('reeling lazily migrates old action fields, while serialized internal timing stays deterministic',()=>{
  const a=fixture('rod_pro');a.f.state='REEL';for(const key of Object.keys(a.f))if(key.startsWith('_'))delete a.f[key];
  a.p.input.reel=true;updateReeling(a.f,a.p,a.def,.3,balance.fishing);
  const b=structuredClone(a);for(let i=0;i<120;i++){a.p.x=b.p.x=Math.sin(i*.03);a.p.input.reel=b.p.input.reel=i%30<20;assert.deepEqual(updateReeling(a.f,a.p,a.def,dt,balance.fishing),updateReeling(b.f,b.p,b.def,dt,balance.fishing));}
  assert.deepEqual(a.f,b.f);
});
test('controllers neither mutate the private pending catch nor create/change resource fields',()=>{
  const a=fixture('rod_magnet');a.p.pendingMagnetCatch={definitionId:'synthetic-loot',quantity:1,resistance:1};
  Object.assign(a.f,{loot_definition_id:'synthetic-loot',loot_quantity:1});const before=structuredClone(a.p.pendingMagnetCatch);
  for(let i=0;i<300;i++){a.p.input.reel=true;a.f.remaining-=dt;updateWaiting(a.f,a.p,a.def,dt,balance.fishing);}
  beginReeling(a.f,a.p,a.def);for(let i=0;i<200;i++)updateReeling(a.f,a.p,a.def,dt,balance.fishing);
  assert.deepEqual(a.p.pendingMagnetCatch,before);assert.equal(a.f.loot_definition_id,'synthetic-loot');assert.equal(a.f.loot_quantity,1);
  assert.equal(a.f.creature,'crab');assert.equal(a.p.inventory,undefined);assert.equal(a.f.loot,undefined);
});
test('rush/recovery keeps continuous motion phase instead of reinterpreting elapsed time',()=>{
  const a=fixture('rod_heavy');beginReeling(a.f,a.p,a.def);
  updateReeling(a.f,a.p,a.def,1.35,balance.fishing);assert.equal(a.f.cue,'rush');
  const phase=a.f._motionPhase,motion=a.f.motion;
  updateReeling(a.f,a.p,a.def,.1,balance.fishing);assert.equal(a.f.cue,'tired');
  assert(Math.abs(a.f._motionPhase-phase-.1)<1e-8);
  assert(Math.abs(a.f.motion-motion)<.6,'motion feedback should be filtered across changing force');
});
test('20/30/60/120 Hz control steps preserve success and approximately the same completion time',()=>{
  for(const id of ['rod_basic','rod_light','rod_pro','rod_heavy','rod_magnet']) {
    const reference=reel(id,'expert','crab',{step:1/120});assert(reference.landed);
    for(const hz of [20,30,60]) {
      const measured=reel(id,'expert','crab',{step:1/hz});
      assert(measured.landed,`${id} failed at ${hz} Hz`);
      assert(Math.abs(measured.time-reference.time)<Math.max(.8,reference.time*.1),JSON.stringify({id,hz,reference:reference.time,measured:measured.time}));
      if(id==='rod_magnet')assert.equal(measured.f._snagsDone,2);
    }
  }
});
