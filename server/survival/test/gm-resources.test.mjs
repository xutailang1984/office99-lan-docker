// Synthetic in-memory rooms only: no HTTP, real accounts, disk saves or GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../config.mjs';
import {RoomRuntime} from '../room-runtime.mjs';
import {GM_BANK_LIMIT,GM_LEDGER_LIMIT} from '../gm-resources.mjs';
import {compileState,diffState,fullEnvelope,deltaEnvelope} from '../state-wire.mjs';

const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function setup({state=null,persist,roomOverride={}}={}) {
  const owner={peerId:'gm-test-owner-peer',accountId:'gm-test-owner-account',name:'合成房主',ready:true};
  const guest={peerId:'gm-test-guest-peer',accountId:'gm-test-guest-account',name:'合成队员',ready:true};
  const room={id:'gm-test-room',epoch:1,ownerId:owner.accountId,hostPeerId:owner.peerId,status:'running',members:[owner,guest],...roomOverride};
  const saves=[],packets=[];
  const runtime=new RoomRuntime({config,room,state,now:()=>0,send:(peerId,json)=>packets.push({peerId,value:JSON.parse(json)}),
    save:async data=>{saves.push(structuredClone(data));return persist?persist(data,saves.length):{revision:saves.length};}});
  for(const member of room.members)runtime.receive(member.peerId,{type:'hello'});
  const player=member=>runtime.world.s.players[runtime.sessions.get(member.peerId).playerId];
  const grant=(n=1,changes={})=>({id:uuid(n),roomId:room.id,epoch:room.epoch,hostPeerId:owner.peerId,
    peerId:guest.peerId,accountId:guest.accountId,resources:{credits:100,materials:20},...changes});
  return {runtime,room,owner,guest,player,grant,saves,packets};
}
const balances=f=>structuredClone(f.runtime.world.s.bank);
const inventory=f=>structuredClone({items:f.runtime.world.s.items,containers:f.runtime.world.s.containers});
async function rejectUnchanged(f,grant,code) {
  const bank=balances(f),items=inventory(f),ledger=structuredClone(f.runtime.world.s.gmGrants);
  await assert.rejects(f.runtime.applyGmGrant(grant),error=>error.code===code);
  assert.deepEqual(balances(f),bank);assert.deepEqual(inventory(f),items);assert.deepEqual(f.runtime.world.s.gmGrants,ledger);
}
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}

test('verified adapter can fund the shared bank for a non-owner without changing inventory or reserved work funds',async()=>{
  const f=setup(),p=f.player(f.guest),before=balances(f),items=inventory(f);
  p.lifeState='DOWNED';p.downedRemaining=15;
  const high=p.requestHighWater,cache=structuredClone(p.requestCache),result=await f.runtime.applyGmGrant(f.grant());
  assert.equal(result.ok,true);assert.equal(result.revision,1);assert.deepEqual(result.receipt,f.grant());
  assert.deepEqual(balances(f),{...before,credits:before.credits+100,materials:before.materials+20,revision:before.revision+1});
  assert.deepEqual(inventory(f),items);assert.equal(p.lifeState,'DOWNED');assert.equal(p.requestHighWater,high);assert.deepEqual(p.requestCache,cache);
  assert.deepEqual(f.saves[0].gmGrants,[f.grant()]);assert.equal(f.runtime.saveFault,false);f.runtime.world.assertInvariants();
  assert(f.packets.some(row=>row.value.eventType==='TransactionResult'&&row.value.payload.kind==='GMGrant'));
});

test('dead-wait members can receive currency without being revived or granted equipment',async()=>{
  const f=setup(),p=f.player(f.guest),items=inventory(f);p.lifeState='DEAD_WAIT';p.respawnRemaining=9;
  await f.runtime.applyGmGrant(f.grant());assert.equal(p.lifeState,'DEAD_WAIT');assert.equal(p.respawnRemaining,9);assert.deepEqual(inventory(f),items);
});

test('ordinary packets, ordinary GMGrant commands and client gm flags never invoke the verified adapter path',()=>{
  const f=setup(),before=balances(f);
  f.runtime.receive(f.guest.peerId,{type:'gm_grant',grant:f.grant(),gm:true});
  f.runtime.receive(f.guest.peerId,{type:'command',command:'GMGrant',requestId:1,payload:f.grant(),gm:true});
  assert.deepEqual(balances(f),before);assert.equal(f.runtime.world.s.gmGrants,undefined);assert.equal(f.saves.length,0);
  const result=f.packets.findLast(row=>row.value.type==='result').value;assert.equal(result.ok,false);assert.equal(result.code,'INVALID_TARGET');
});

test('grant schema rejects unknown fields, malformed IDs and non-integer or excessive resources atomically',async()=>{
  const f=setup(),bad=[null,[],{},f.grant(1,{id:'not-a-uuid'}),f.grant(1,{epoch:0}),f.grant(1,{epoch:1.5}),
    f.grant(1,{roomId:''}),f.grant(1,{accountId:'bad\nidentity'}),f.grant(1,{peerId:'x'.repeat(129)}),
    {...f.grant(),gm:true},f.grant(1,{resources:{credits:1,materials:0,items:[]}}),f.grant(1,{resources:{credits:1}})];
  for(const value of [-1,.5,NaN,Infinity,'20',true,1_000_001,Number.MAX_SAFE_INTEGER])bad.push(f.grant(1,{resources:{credits:value,materials:0}}));
  bad.push(f.grant(1,{resources:{credits:0,materials:0}}),f.grant(1,{resources:{credits:0,materials:-1}}));
  for(const grant of bad)await rejectUnchanged(f,grant,'GM_INVALID_GRANT');assert.equal(f.saves.length,0);
});

test('each resource permits its exact per-ticket maximum and zero for the other resource',async()=>{
  const f=setup(),before=balances(f);
  await f.runtime.applyGmGrant(f.grant(1,{resources:{credits:1_000_000,materials:0}}));
  await f.runtime.applyGmGrant(f.grant(2,{resources:{credits:0,materials:1_000_000}}));
  assert.equal(f.runtime.world.s.bank.credits,before.credits+1_000_000);assert.equal(f.runtime.world.s.bank.materials,before.materials+1_000_000);
});

test('bank caps and invalid existing values reject both resources before any partial mutation',async()=>{
  const f=setup();f.runtime.world.s.bank.credits=GM_BANK_LIMIT-10;
  await f.runtime.applyGmGrant(f.grant(1,{resources:{credits:10,materials:0}}));
  assert.equal(f.runtime.world.s.bank.credits,GM_BANK_LIMIT);
  await rejectUnchanged(f,f.grant(2,{resources:{credits:1,materials:20}}),'GM_BALANCE_LIMIT');
  f.runtime.world.s.bank.credits=100;f.runtime.world.s.bank.materials=GM_BANK_LIMIT;
  await rejectUnchanged(f,f.grant(3),'GM_BALANCE_LIMIT');
  for(const n of [Number.MAX_SAFE_INTEGER,-1,1.5,NaN]){f.runtime.world.s.bank.materials=0;f.runtime.world.s.bank.credits=n;await rejectUnchanged(f,f.grant(4),'GM_BALANCE_LIMIT');}
});

test('a repeated exact ticket saves again but never changes bank revision or emits a second grant event',async()=>{
  const f=setup();await f.runtime.applyGmGrant(f.grant());const before=balances(f);
  const result=await f.runtime.applyGmGrant(f.grant());assert.equal(result.revision,2);assert.deepEqual(balances(f),before);assert.equal(f.runtime.world.s.gmGrants.length,1);
  assert.equal(f.packets.filter(row=>row.value.eventType==='TransactionResult'&&row.value.payload.kind==='GMGrant').length,2,'one event broadcast to two peers');
});

test('concurrent same-ID requests share one application and one pending save; returned receipts are detached',async()=>{
  const entered=deferred(),release=deferred(),f=setup({persist:async()=>{entered.resolve();await release.promise;return{revision:7};}}),before=balances(f);
  const calls=Array.from({length:10},()=>f.runtime.applyGmGrant(f.grant()));await entered.promise;
  assert.equal(f.saves.length,1);assert.equal(f.runtime.world.s.bank.credits,before.credits+100);release.resolve();
  const results=await Promise.all(calls);assert(results.every(r=>r.ok&&r.revision===7));assert.equal(f.saves.length,1);
  results[0].receipt.resources.credits=999;assert.equal(results[1].receipt.resources.credits,100);assert.equal(f.runtime.world.s.gmGrants[0].resources.credits,100);
});

test('same-ID payload changes are rejected during a pending save and after completion',async()=>{
  const entered=deferred(),release=deferred(),f=setup({persist:async()=>{entered.resolve();await release.promise;return{revision:1};}});
  const first=f.runtime.applyGmGrant(f.grant());await entered.promise;
  await rejectUnchanged(f,f.grant(1,{resources:{credits:101,materials:20}}),'GM_REPLAY_MISMATCH');release.resolve();await first;
  await rejectUnchanged(f,f.grant(1,{peerId:f.owner.peerId,accountId:f.owner.accountId}),'GM_REPLAY_MISMATCH');assert.equal(f.saves.length,1);
});

test('different ticket IDs serialize their resource mutation and snapshot persistence',async()=>{
  const entered=deferred(),release=deferred(),f=setup({persist:async(_,n)=>{if(n===1){entered.resolve();await release.promise;}return{revision:n};}}),before=balances(f);
  const first=f.runtime.applyGmGrant(f.grant()),second=f.runtime.applyGmGrant(f.grant(2));await entered.promise;
  assert.equal(f.runtime.world.s.bank.credits,before.credits+100);assert.equal(f.saves.length,1);release.resolve();
  await Promise.all([first,second]);assert.equal(f.runtime.world.s.bank.credits,before.credits+200);
  assert.equal(f.saves[0].gmGrants.length,1);assert.equal(f.saves[1].gmGrants.length,2);assert.equal(f.runtime.gmPending.size,0);
});

test('save failure retains receipt, pauses normally, denies new tickets and retries the original without double credit',async()=>{
  let fail=true;const f=setup({persist:async(_,n)=>{if(fail)throw Error('synthetic save failure');return{revision:n};}}),before=balances(f);
  await assert.rejects(f.runtime.applyGmGrant(f.grant()),e=>e.code==='GM_SAVE_FAILED');
  const applied=balances(f);assert.equal(applied.credits,before.credits+100);assert.equal(f.runtime.saveFault,true);assert.equal(f.runtime.world.s.paused,true);
  await rejectUnchanged(f,f.grant(2),'GM_BUSY');await rejectUnchanged(f,f.grant(1,{resources:{credits:101,materials:20}}),'GM_REPLAY_MISMATCH');
  fail=false;const result=await f.runtime.applyGmGrant(f.grant());assert.equal(result.ok,true);assert.deepEqual(balances(f),applied);assert.equal(f.runtime.saveFault,false);
  assert.deepEqual(f.saves.at(-1).gmGrants,[f.grant()]);assert(!f.packets.some(row=>row.value.type==='fatal'));
});

test('saved receipt deduplicates after restore and account reconnection without altering ordinary item identities',async()=>{
  const f=setup();await f.runtime.applyGmGrant(f.grant());const state=f.saves.at(-1),items=inventory(f),restored=setup({state}),before=balances(restored);
  const result=await restored.runtime.applyGmGrant(restored.grant());assert.equal(result.ok,true);assert.deepEqual(balances(restored),before);assert.deepEqual(inventory(restored),items);
  assert.equal(restored.runtime.world.s.gmGrants.length,1);assert.equal(restored.saves.length,1);
});

test('old room, epoch or host binding and forged peer-account associations cannot mint currency',async()=>{
  const f=setup();
  for(const patch of [{roomId:'another-room'},{epoch:2},{hostPeerId:'other-host'}])await rejectUnchanged(f,f.grant(1,patch),'GM_STALE_ROOM');
  for(const patch of [{peerId:'unknown-peer'},{accountId:'wrong-account'},{peerId:f.owner.peerId}])await rejectUnchanged(f,f.grant(1,patch),'GM_NOT_MEMBER');
  f.runtime.sessions.get(f.guest.peerId).accountId='replaced-account';await rejectUnchanged(f,f.grant(),'GM_NOT_MEMBER');
});

test('a queued ticket rechecks membership at execution, so leaving behind another pending save cannot grant later',async()=>{
  const entered=deferred(),release=deferred(),f=setup({persist:async(_,n)=>{if(n===1){entered.resolve();await release.promise;}return{revision:n};}});
  const first=f.runtime.applyGmGrant(f.grant(1,{peerId:f.owner.peerId,accountId:f.owner.accountId}));await entered.promise;
  const next=f.runtime.applyGmGrant(f.grant(2)),rejection=assert.rejects(next,e=>e.code==='GM_NOT_MEMBER');
  f.runtime.setRoom({...f.room,members:[f.owner]});release.resolve();await first;await rejection;assert.equal(f.saves.length,1);assert.equal(f.runtime.world.s.gmGrants.length,1);
});

test('a pending same-ID retry still checks current membership rather than returning an old connection response',async()=>{
  const entered=deferred(),release=deferred(),f=setup({persist:async()=>{entered.resolve();await release.promise;return{revision:1};}});
  const first=f.runtime.applyGmGrant(f.grant());await entered.promise;
  f.runtime.setRoom({...f.room,members:[f.owner]});await rejectUnchanged(f,f.grant(),'GM_NOT_MEMBER');
  release.resolve();await first;assert.equal(f.saves.length,1);assert.equal(f.runtime.world.s.gmGrants.length,1);
});

test('waiting, loading, closing and absent-owner rooms deny even centrally verified tickets',async()=>{
  const cases=[f=>f.runtime.setRoom({...f.room,status:'waiting'}),f=>{f.runtime.sessions.get(f.guest.peerId).readyForPlay=false;},
    f=>{f.runtime.sessions.get(f.owner.peerId).readyForPlay=false;},f=>{f.runtime.stopping=true;},f=>f.runtime.disconnect(f.owner.peerId)];
  for(const change of cases){const f=setup();change(f);await rejectUnchanged(f,f.grant(),'GM_NOT_READY');}
});

test('new tickets respect save fault, active save and phase barriers without changing reservations',async()=>{
  const cases=[f=>{f.runtime.saveFault=true;},f=>{f.runtime.barrier=true;},f=>{f.runtime.world.needsBarrier=true;},
    f=>{f.runtime.world.s.paused=true;},f=>{f.runtime.saving=Promise.resolve();}];
  for(const change of cases){const f=setup();f.runtime.world.s.bank.reservedCredits=10;f.runtime.world.s.bank.reservedMaterials=5;change(f);await rejectUnchanged(f,f.grant(),'GM_BUSY');}
});

test('same-room ledger capacity never evicts receipt IDs, but a verified new room scope can retire old receipts',async()=>{
  const f=setup();f.runtime.world.s.gmGrants=Array.from({length:GM_LEDGER_LIMIT},(_,i)=>f.grant(i+1));
  await rejectUnchanged(f,f.grant(GM_LEDGER_LIMIT+1),'GM_GRANT_LIMIT');const before=balances(f);
  await f.runtime.applyGmGrant(f.grant(1));assert.deepEqual(balances(f),before);assert.equal(f.runtime.world.s.gmGrants.length,GM_LEDGER_LIMIT);
  const nextRoom={...f.room,id:'gm-test-next-room',epoch:2};f.runtime.setRoom(nextRoom);assert.equal(f.runtime.stopping,true);f.runtime=setup({state:f.runtime.world.serialize(),roomOverride:nextRoom}).runtime;
  await rejectUnchanged(f,f.grant(1),'GM_STALE_ROOM');
  const fresh=f.grant(GM_LEDGER_LIMIT+1,{roomId:nextRoom.id,epoch:2});await f.runtime.applyGmGrant(fresh);
  assert.deepEqual(f.runtime.world.s.gmGrants,[fresh]);assert.equal(f.runtime.world.s.bank.credits,before.credits+100);
});

test('invalid persisted ledger shape, oversized history and duplicate receipts fail closed',async()=>{
  for(const ledger of [null,{},[{}],Array.from({length:513},(_,i)=>setupGrant(i+1)),[setupGrant(1),setupGrant(1)]]){
    const f=setup();f.runtime.world.s.gmGrants=ledger;await rejectUnchanged(f,f.grant(600),'GM_INVALID_LEDGER');
  }
  function setupGrant(n){return{id:uuid(n),roomId:'gm-test-room',epoch:1,hostPeerId:'gm-test-owner-peer',peerId:'gm-test-guest-peer',accountId:'gm-test-guest-account',resources:{credits:100,materials:20}};}
  const f=setup(),saved=f.runtime.world.serialize();saved.gmGrants=[{}];assert.throws(()=>setup({state:saved}),e=>e.code==='GM_INVALID_LEDGER');
});

test('grant inputs are copied before asynchronous queue execution',async()=>{
  const f=setup(),g=f.grant(),before=balances(f),pending=f.runtime.applyGmGrant(g);g.resources.credits=900;g.accountId='changed';
  const result=await pending;assert.equal(result.receipt.resources.credits,100);assert.equal(f.runtime.world.s.bank.credits,before.credits+100);
});

test('GM persists through the ordinary damage and night-resolution save path',async()=>{
  const f=setup(),w=f.runtime.world;w.startNight();w.s.buildings.core.hp=0;const before=balances(f),loss=w.c.recovery.warehouse_loss_fraction;
  await f.runtime.applyGmGrant(f.grant());assert.equal(w.s.statistics.breaches,1);assert.equal(w.s.phase,'RECOVERY');
  assert.equal(w.s.bank.credits,before.credits+100-Math.ceil((before.credits+100)*loss));assert.equal(f.saves.at(-1).gmGrants.length,1);
});

test('full and ACK-baseline delta views show identical bank changes without leaking private grant receipts',async()=>{
  const f=setup(),initial=compileState(f.runtime.state());await f.runtime.applyGmGrant(f.grant());const current=compileState(f.runtime.state());
  const full=JSON.parse(fullEnvelope(current,2)),delta=JSON.parse(deltaEnvelope(diffState(initial,current).body,2,1));
  const restored=JSON.parse(fullEnvelope(initial,1));Object.assign(restored,delta.changes);for(const key of delta.removedKeys)delete restored[key];
  for(const [key,edits]of Object.entries(delta.entities)){
    const rows=new Map(restored[key].map(row=>[row.id,row]));for(const id of edits.remove)rows.delete(id);for(const row of edits.upsert)rows.set(row.id,row);
    for(const patch of edits.patch){Object.assign(rows.get(patch.id),patch.set);for(const key of patch.unset)delete rows.get(patch.id)[key];}restored[key]=[...rows.values()];
  }
  restored.snapshotId=2;assert.deepEqual(restored,full);assert.deepEqual(delta.changes.bank,f.runtime.world.s.bank);
  assert.equal(Object.hasOwn(full,'gmGrants'),false);assert.equal(Object.hasOwn(delta.changes,'gmGrants'),false);
  assert(!JSON.stringify(full).includes(f.grant().id));assert(!JSON.stringify(f.runtime.world.catalog()).includes('gmGrants'));
});
