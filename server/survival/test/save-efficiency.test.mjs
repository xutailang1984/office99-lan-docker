// Synthetic in-memory rooms and controlled persistence only; no HTTP or disk
// saves, real accounts, browsers, or rendered clients.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../config.mjs';
import {RoomRuntime} from '../room-runtime.mjs';

const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function setup({id='save-test-room',status='waiting',loading=false,join=true,persist}={}) {
  const owner={peerId:'save-test-peer',accountId:'save-test-account',name:'合成房主',ready:true};
  const room={id,epoch:1,ownerId:owner.accountId,hostPeerId:owner.peerId,status,members:[owner]};
  const saves=[],packets=[];let elapsed=0;
  const runtime=new RoomRuntime({config:structuredClone(config),room,now:()=>elapsed*1000,
    send:(peerId,json)=>packets.push({peerId,message:JSON.parse(json)}),
    save:async state=>{const row={state:structuredClone(state),elapsed,call:saves.length+1};saves.push(row);return persist?await persist(state,row.call):{revision:row.call};}});
  if(join)runtime.receive(owner.peerId,{type:'hello',...(loading?{clientReady:true}:{})});
  return {runtime,room,owner,saves,packets,player:()=>runtime.world.s.players[runtime.sessions.get(owner.peerId)?.playerId],
    async advance(seconds){for(let n=0;n<Math.round(seconds*30);n++){elapsed+=1/30;runtime.step(1/30);if(runtime.saving)await runtime.saving;}}};
}

for(const [name,options] of [['waiting',{}],['loading',{status:'running',loading:true}],['absent owner',{status:'running',join:false}]]) {
  test(name+' room saves its initial snapshot once and skips 20 seconds of unchanged autosaves',async()=>{
    const f=setup(options);await f.advance(20);
    assert.equal(f.saves.length,1);assert.equal(f.runtime.world.s.time,0);assert.equal(f.runtime.saveStatus.sequence,1);
    assert.equal(f.runtime.saveStatus.pending,false);assert.equal(f.runtime.saveFault,false);
  });
}

test('paused player, settings, equipment and wallet changes are saved without clock or requestSave changes',async()=>{
  const f=setup();await f.advance(2);assert.equal(f.saves.length,1);
  const time=f.runtime.world.s.time,tick=f.runtime.world.s.tick,p=f.player(),gun=f.runtime.world.equipped(p,'weapon');
  const changes=[
    {apply:()=>{p.hp-=7;},check:s=>assert.equal(s.players[p.id].hp,p.hp)},
    {apply:()=>{f.runtime.receive(f.owner.peerId,{type:'command',command:'Settings',requestId:1,payload:{friendlyFire:true}});},check:s=>assert.equal(s.friendlyFire,true)},
    {apply:()=>{gun.magazineAmmo--;},check:s=>assert.equal(s.items[gun.id].magazineAmmo,gun.magazineAmmo)},
    {apply:()=>{f.runtime.world.s.bank.materials+=9;},check:s=>assert.equal(s.bank.materials,f.runtime.world.s.bank.materials)}
  ];
  for(const [index,change] of changes.entries()) {
    change.apply();f.runtime.world.requestSave=false;await f.advance(2);
    assert.equal(f.saves.length,index+2);change.check(f.saves.at(-1).state);
    assert.equal(f.runtime.world.s.time,time);assert.equal(f.runtime.world.s.tick,tick);
  }
  await f.advance(6);assert.equal(f.saves.length,5);
});

test('join and disconnect changes in a waiting room each persist without advancing the game clock',async()=>{
  const f=setup({join:false});await f.advance(2);
  f.runtime.receive(f.owner.peerId,{type:'hello'});await f.advance(2);
  const id=f.runtime.sessions.get(f.owner.peerId).playerId;
  assert.equal(f.saves.length,2);assert.equal(f.saves.at(-1).state.players[id].connected,true);
  f.runtime.disconnect(f.owner.peerId);await f.advance(2);
  assert.equal(f.saves.length,3);assert.equal(f.saves.at(-1).state.players[id].connected,false);
  await f.advance(4);assert.equal(f.saves.length,3);assert.equal(f.runtime.world.s.time,0);
});

test('active rooms keep at most two game seconds between autosave snapshots',async()=>{
  const f=setup({status:'running'});await f.advance(10);
  assert.equal(f.saves.length,5);let previous=0;
  for(const row of f.saves){assert(row.elapsed-previous<=2+1e-8);assert(row.state.time>previous);previous=row.elapsed;}
});

test('initial autosaves are spread across rooms without extending the two-second deadline',async()=>{
  const first=[];
  for(let index=0;index<8;index++){
    const f=setup({id:'capacity-room-'+index});await f.advance(2);assert.equal(f.saves.length,1);first.push(f.saves[0].elapsed);
  }
  assert(first.every(value=>value>=1.5&&value<=2+1e-8));assert(new Set(first.map(value=>value.toFixed(3))).size>1);
});

test('a manual snapshot restarts the automatic window and remains a real write when unchanged',async()=>{
  const f=setup({status:'running'});await f.advance(.5);await f.runtime.save();
  await f.advance(1.5);assert.equal(f.saves.length,1,'no autosave shortly after a forced snapshot');
  await f.advance(.5);assert.equal(f.saves.length,2);assert(Math.abs(f.saves[1].elapsed-f.saves[0].elapsed-2)<1e-8);
  await f.runtime.save();assert.equal(f.saves.length,3);assert.deepEqual(f.saves[2].state,f.saves[1].state);
});

test('manual callers queue distinct real writes and capture mutations made during earlier writes',async()=>{
  const first=deferred(),second=deferred(),secondEntered=deferred();let active=0,maxActive=0;
  const f=setup({persist:async(_,call)=>{maxActive=Math.max(maxActive,++active);try{if(call===1)await first.promise;if(call===2){secondEntered.resolve();await second.promise;}return {revision:call};}finally{active--;}}});
  const a=f.runtime.save();f.player().hp-=5;const b=f.runtime.save(),c=f.runtime.save();
  first.resolve();await a;await secondEntered.promise;
  assert.equal(f.saves.length,2);assert.equal(f.saves[1].state.players[f.player().id].hp,f.player().hp);
  f.runtime.world.s.friendlyFire=true;second.resolve();await Promise.all([b,c]);
  assert.equal(f.saves.length,3);assert.equal(maxActive,1);assert.equal(f.saves[2].state.friendlyFire,true);
});

test('an in-flight snapshot cannot make newer changes appear already saved',async()=>{
  const saving=deferred();const f=setup({persist:async(_,call)=>{if(call===1)await saving.promise;return {revision:call};}});
  const first=f.runtime.save(),oldHp=f.player().hp;f.player().hp-=8;f.runtime.world.requestSave=false;
  const next=f.runtime.save({automatic:true});saving.resolve();await Promise.all([first,next]);
  assert.equal(f.saves.length,2);assert.equal(f.saves[0].state.players[f.player().id].hp,oldHp);
  assert.equal(f.saves[1].state.players[f.player().id].hp,oldHp-8);
  await f.runtime.save({automatic:true});assert.equal(f.saves.length,2);
});

test('a failed forced write of unchanged data still requires real retry and durable confirmation',async()=>{
  const f=setup({persist:async(_,call)=>{if(call===2)throw Error('synthetic persistence failure');return {revision:call};}});
  await f.runtime.save();await assert.rejects(f.runtime.save());assert.equal(f.runtime.saveFault,true);
  assert.equal(f.runtime.saveStatus.sequence,1);assert.equal(f.runtime.saveStatus.pending,false);
  await f.runtime.save({automatic:true});assert.equal(f.saves.length,3);assert.equal(f.runtime.saveFault,false);
  assert.equal(f.runtime.saveStatus.sequence,3);await f.runtime.save({automatic:true});assert.equal(f.saves.length,3);
});

test('a phase barrier always persists before changing day and the changed day is saved within two seconds',async()=>{
  const barrier=deferred();const f=setup({status:'running',persist:async(_,call)=>{if(call===2)await barrier.promise;return {revision:call};}});
  await f.runtime.save();f.runtime.world.beginDayBarrier();f.runtime.step(0);
  assert.equal(f.saves.length,2);assert.equal(f.runtime.world.s.phase,'PREP');assert.equal(f.runtime.world.needsBarrier,true);
  // saving is the adapter promise; step's phase-change continuation runs after
  // save() adopts that promise. Drain the turn before checking that callback.
  barrier.resolve();await f.runtime.saving;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.saves[1].state.phase,'PREP');assert.equal(f.runtime.world.s.phase,'DAY');
  await f.advance(2);assert.equal(f.saves.at(-1).state.phase,'DAY');assert(f.saves.length>=3);
});

test('GM first grant and exact-ticket retry both save, while final close also writes the frozen state',async()=>{
  const f=setup({status:'running'});await f.runtime.save();
  const grant={id:'00000000-0000-4000-8000-000000000001',roomId:f.room.id,epoch:f.room.epoch,hostPeerId:f.owner.peerId,
    peerId:f.owner.peerId,accountId:f.owner.accountId,resources:{credits:101,materials:19}};
  const first=await f.runtime.applyGmGrant(grant),bank=structuredClone(f.runtime.world.s.bank);
  assert.equal(first.revision,2);assert.deepEqual(f.saves[1].state.gmGrants,[grant]);
  const retry=await f.runtime.applyGmGrant(grant);assert.equal(retry.revision,3);assert.deepEqual(f.runtime.world.s.bank,bank);
  await f.runtime.save({automatic:true});assert.equal(f.saves.length,3);
  await f.runtime.freezeAndSave();assert.equal(f.saves.length,4);assert.equal(f.saves[3].state.paused,true);
  assert.deepEqual(f.saves[3].state.gmGrants,[grant]);assert.deepEqual(f.saves[3].state.bank,bank);
});
