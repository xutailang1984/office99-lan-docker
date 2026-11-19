import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalHostSave} from '../../../client/platform/local-host-save.mjs';
import {pack,unpack,latest,checkpointKey,CHECKPOINT_SCHEMA} from '../../../client/platform/checkpoint-store.mjs';

// All identities, worlds, storage, time and network responses in this suite are
// synthetic. No browser, production service, filesystem store or account API.
const copy = value => structuredClone(value);
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const world = (tick=1,extra={}) => ({worldId:'fixture-world',tick,time:tick,bank:{parts:tick},...extra});
const room = (epoch=1) => ({id:'fixture-room',ownerId:'fixture-owner',adventureId:'fixture-adventure',epoch});

test('career handoff retries an immutable request after the remote ACK is lost',async()=>{
  const f=fixture();await f.instance.initialize();
  const state=world(2,{economyVersion:1,economyEpoch:0});
  await f.instance.save(state,{requireBackup:true});
  const settlements=[{accountId:'fixture-owner',careerRevision:1}],calls=[];
  const send=async body=>{calls.push(copy(body));if(calls.length===1)throw Error('handoff ACK lost');return {revision:body.baseRevision+1,saveSeq:body.saveSeq,economyEpoch:1};};
  await assert.rejects(f.instance.handoff(state,settlements,send),/ACK lost/);
  const ack=await f.instance.handoff(world(99),[],send);
  assert.deepEqual(calls[0],calls[1]);assert.deepEqual(calls[1].settlements,settlements);
  await f.instance.acceptHandoff(world(2,{economyVersion:1,economyEpoch:1}),ack);
  const saved=await f.store.read(f.key);
  assert.equal(saved.handoff,null);assert.equal(saved.slots.length,1);
  assert.equal(latest(saved).state.economyEpoch,1);assert.equal(saved.remoteRevision,ack.revision);
  assert.equal(saved.backedLocalRevision,latest(saved).slot.sequence);
});

test('a newer asset epoch rejects a locally newer world that still contains exported gear',async()=>{
  const remote=new Remote(world(2,{economyVersion:1,economyEpoch:1}),10),f=fixture({remote,room:room(2)});
  seed(f,record({slots:[pack(world(8,{economyVersion:1,economyEpoch:0}),2)]}));
  const result=await f.instance.initialize();
  assert.equal(result.state.economyEpoch,1);assert.equal(result.state.tick,2);
  assert.equal(unpack((await f.store.read(f.key)).conflict).economyEpoch,0);
  await f.instance.flush();assert.equal(remote.calls.length,0);
});

test('invalid handoff acknowledgments keep the durable retry request',async()=>{
  const f=fixture();await f.instance.initialize();
  await f.instance.handoff(world(),[{accountId:'fixture-owner',careerRevision:1}],async()=>({}));
  await assert.rejects(f.instance.acceptHandoff(world(),{saveSeq:999,revision:999}),/回执/);
  assert.ok(await f.instance.pendingHandoff());
});

// Serialized, clone-isolated transactions match the relevant IndexedDB
// contract: callbacks do not mutate committed data, and an aborted commit has
// no effect. Reads also join the queue instead of racing a pending write.
class AtomicStore {
  rows=new Map();tail=Promise.resolve();fault=null;gate=null;
  run(fn){const op=this.tail.then(fn);this.tail=op.catch(()=>{});return op;}
  seed(key,row){this.rows.set(key,copy(row));}
  failNext(error=Error('fixture commit aborted')){this.fault=error;}
  holdNext(){const entered=deferred(),release=deferred();this.gate={entered,release};return {entered:entered.promise,release:release.resolve};}
  update(key,change){return this.run(async()=>{
    const failure=this.fault,gate=this.gate;this.fault=null;this.gate=null;
    const changed=change(copy(this.rows.get(key)??null));
    if(gate){gate.entered.resolve();await gate.release.promise;}
    if(failure)throw failure;
    if(changed===null)this.rows.delete(key);else this.rows.set(key,copy(changed));
    return copy(changed);
  });}
  read(key){return this.run(()=>copy(this.rows.get(key)??null));}
}

class Remote {
  constructor(state=world(),revision=10){this.state=copy(state);this.revision=revision;this.head=null;this.calls=[];this.receipts=new Map();this.commits=0;this.loseAck=false;this.fail=null;this.hold=null;this.resetAck={};}
  snapshot(){return copy({state:this.state,revision:this.revision,head:this.head});}
  async write(body){
    const envelope=copy(body);this.calls.push(envelope);
    if(this.fail)throw this.fail;
    const id=JSON.stringify([body.hostEpoch,body.saveSeq]);let entry=this.receipts.get(id);
    if(entry)assert.deepEqual(envelope,entry.body,'an unknown ACK must retry the identical request');
    else{
      assert.equal(body.baseRevision,this.revision,'a writer must never overwrite another revision');
      this.state=copy(body.state);this.revision++;this.commits++;this.head={hostEpoch:body.hostEpoch,saveSeq:body.saveSeq};
      entry={body:envelope,ack:{revision:this.revision,saveSeq:body.saveSeq,...copy(this.resetAck)}};this.receipts.set(id,entry);
    }
    if(this.hold){const gate=this.hold;this.hold=null;gate.entered.resolve();await gate.release.promise;}
    if(this.loseAck){this.loseAck=false;throw Error('fixture ACK lost after commit');}
    return copy(entry.ack);
  }
  holdNext(){const entered=deferred(),release=deferred();this.hold={entered,release};return {entered:entered.promise,release:release.resolve};}
}

function fixture(options={}){
  const store=options.store??new AtomicStore(),remote=options.remote??new Remote(),statuses=[],resets=[];
  const instance=new LocalHostSave({store,room:options.room??room(),remote:remote.snapshot(),writer:options.writer??'fixture-writer',now:options.now??(()=>10000),authoritative:options.authoritative,storageAccountId:options.storageAccountId,
    writeRemote:options.writeRemote??(body=>remote.write(body)),onStatus:value=>statuses.push(copy(value)),onResets:options.onResets??(ack=>resets.push(copy(ack)))});
  return {store,remote,instance,statuses,resets,key:instance.key};
}
function record({slots=[pack(world(),1)],remoteRevision=10,backedLocalRevision=1,pending=null,epoch=1,...extra}={}){
  return {schema:CHECKPOINT_SCHEMA,ownerId:room().ownerId,adventureId:room().adventureId,epoch,writer:'fixture-old-writer',slots,remoteRevision,backedLocalRevision,pending,saveSeq:pending?.body.saveSeq??0,conflict:null,...extra};
}
function seed(f,row){f.store.seed(f.key,row);}

test('delegated authority always restores the confirmed world and keeps old local data only as a conflict',async()=>{
 const f=fixture({room:room(3),authoritative:true,storageAccountId:'fixture-guest'});
 seed(f,record({epoch:1,slots:[pack(world(99),2)],remoteRevision:10,backedLocalRevision:1}));
 const loaded=await f.instance.initialize();assert.equal(loaded.state.tick,1);const row=await f.store.read(f.key);
 assert.equal(row.ownerId,'fixture-guest');assert.equal(row.adventureOwnerId,'fixture-owner');assert.equal(unpack(row.conflict).tick,99);
 assert.equal(f.key,checkpointKey('fixture-guest','fixture-adventure'));await f.instance.flush();assert.equal(f.remote.calls.length,0);
});

test('first initialization imports the server checkpoint and separates local and remote revisions',async()=>{
  const f=fixture();const result=await f.instance.initialize();
  assert.deepEqual(result.state,world());assert.equal(result.notice,null);
  const saved=await f.store.read(f.key);
  assert.equal(latest(saved).slot.sequence,1);assert.equal(saved.remoteRevision,10);assert.equal(saved.backedLocalRevision,1);
  assert.equal(f.remote.calls.length,0);
  assert.notEqual(checkpointKey('a','b:c'),checkpointKey('a:b','c'));
});

test('local ACK occurs only after the storage transaction commits',async()=>{
  const f=fixture();await f.instance.initialize();const gate=f.store.holdNext();let acked=false;
  const save=f.instance.save(world(2)).then(value=>{acked=true;return value;});
  await gate.entered;await turn();assert.equal(acked,false);assert.equal(f.remote.calls.length,0);assert.equal(f.statuses.length,1);
  gate.release();assert.equal((await save).revision,2);await f.instance.flush();
});

test('an aborted local transaction never ACKs or starts a remote write',async()=>{
  const f=fixture();await f.instance.initialize();const before=await f.store.read(f.key);f.store.failNext();
  await assert.rejects(f.instance.save(world(2)),/commit aborted/);
  assert.deepEqual(await f.store.read(f.key),before);assert.equal(f.remote.calls.length,0);assert.equal(f.statuses.length,1);
});

test('ordinary local saving ACKs while its remote backup is still waiting',async()=>{
  const f=fixture();await f.instance.initialize();const gate=f.remote.holdNext();
  assert.equal((await f.instance.save(world(2))).revision,2);await gate.entered;
  assert.equal(f.statuses.at(-1).backupPending,true);assert.equal((await f.store.read(f.key)).remoteRevision,10);
  gate.release();await f.instance.flush();assert.equal(f.statuses.at(-1).backupPending,false);
});

test('GM and final saves require the validated remote ACK',async()=>{
  const f=fixture();await f.instance.initialize();const gate=f.remote.holdNext();let acked=false;
  const final=f.instance.save(world(2),{requireBackup:true}).then(value=>{acked=true;return value;});
  await gate.entered;await turn();assert.equal(acked,false);assert.equal(latest(await f.store.read(f.key)).state.tick,2);
  gate.release();assert.equal((await final).revision,2);assert.equal(f.statuses.at(-1).backupPending,false);
});

test('a required backup failure rejects final/GM success but retains its durable local copy',async()=>{
  const f=fixture();await f.instance.initialize();f.remote.fail=Error('fixture platform unavailable');
  await assert.rejects(f.instance.save(world(2),{requireBackup:true}),/platform unavailable/);
  const saved=await f.store.read(f.key);assert.equal(latest(saved).state.tick,2);assert.ok(saved.pending);assert.equal(saved.backedLocalRevision,1);
  f.remote.fail=null;await f.instance.flush();assert.equal(f.remote.state.tick,2);
});

test('unknown ACK retry reuses the exact persisted envelope without double-applying a write',async()=>{
  const f=fixture();await f.instance.initialize();f.remote.loseAck=true;
  await assert.rejects(f.instance.save(world(2),{requireBackup:true}),/ACK lost/);
  const pending=copy((await f.store.read(f.key)).pending);await f.instance.flush();
  assert.equal(f.remote.calls.length,2);assert.deepEqual(f.remote.calls[0],f.remote.calls[1]);assert.deepEqual(f.remote.calls[1],pending.body);
  assert.equal(f.remote.commits,1);assert.equal((await f.store.read(f.key)).pending,null);
});

test('many writes coalesce to two slots and one immutable pending request',async()=>{
  const f=fixture();await f.instance.initialize();const gate=f.remote.holdNext();
  await f.instance.save(world(2));await gate.entered;const pending=copy((await f.store.read(f.key)).pending);
  for(let n=3;n<=35;n++)await f.instance.save(world(n));
  const saved=await f.store.read(f.key);assert.equal(saved.slots.length,2);assert.deepEqual(saved.pending,pending);assert.equal(latest(saved).state.tick,35);
  gate.release();await f.instance.flush();assert.equal(f.remote.calls.length,2);assert.equal(f.remote.state.tick,35);
});

test('restart after a committed but lost ACK reconciles its head and uploads later local work in the new epoch',async()=>{
  const store=new AtomicStore(),remote=new Remote(),f=fixture({store,remote});await f.instance.initialize();remote.loseAck=true;
  await assert.rejects(f.instance.save(world(2),{requireBackup:true}),/ACK lost/);
  await f.instance.save(world(3));f.instance.stop();
  const next=fixture({store,remote,room:room(2),writer:'fixture-next-writer'});const restored=await next.instance.initialize();
  assert.equal(restored.state.tick,3);assert.match(restored.notice,/本机/);
  let saved=await store.read(next.key);assert.equal(saved.remoteRevision,11);assert.equal(saved.backedLocalRevision,2);assert.equal(saved.pending,null);
  await next.instance.flush();saved=await store.read(next.key);
  assert.equal(remote.state.tick,3);assert.equal(remote.calls.at(-1).hostEpoch,2);assert.equal(remote.calls.at(-1).baseRevision,11);assert.equal(saved.remoteRevision,12);
});

test('an unchanged server ancestor resumes unbacked local progress',async()=>{
  const f=fixture({room:room(2)});seed(f,record({slots:[pack(world(),1),pack(world(4),2)]}));
  const restored=await f.instance.initialize();assert.equal(restored.state.tick,4);assert.match(restored.notice,/本机/);
  await f.instance.flush();assert.equal(f.remote.state.tick,4);assert.equal(f.remote.calls[0].hostEpoch,2);
});

test('another device revision wins and the divergent local checkpoint remains recoverable',async()=>{
  const remote=new Remote(world(50),11),f=fixture({remote,room:room(2)});
  seed(f,record({slots:[pack(world(),1),pack(world(8),2)]}));
  const restored=await f.instance.initialize();assert.equal(restored.state.tick,50);assert.match(restored.notice,/另一台/);
  const saved=await f.store.read(f.key);assert.equal(unpack(saved.conflict).tick,8);assert.equal(latest(saved).state.tick,50);
  await f.instance.flush();assert.equal(remote.calls.length,0,'initializing must not overwrite the newer device');
});

test('a different authoritative world is not replaced by a same-revision local world',async()=>{
  const remote=new Remote(world(1,{worldId:'fixture-new-world'})),f=fixture({remote,room:room(2)});
  seed(f,record({slots:[pack(world(8),2)]}));const result=await f.instance.initialize();
  assert.equal(result.state.worldId,'fixture-new-world');assert.equal(unpack((await f.store.read(f.key)).conflict).worldId,'fixture-world');
});

test('same-epoch duplicate tabs cannot claim a live local record',async()=>{
  const f=fixture();await f.instance.initialize();const before=await f.store.read(f.key);
  const duplicate=fixture({store:f.store,remote:f.remote,writer:'fixture-duplicate-writer'});
  await assert.rejects(duplicate.instance.initialize(),/另一个页面/);assert.deepEqual(await f.store.read(f.key),before);
});

test('a newer host epoch fences all old local saves and backups',async()=>{
  const f=fixture();await f.instance.initialize();const next=fixture({store:f.store,remote:f.remote,room:room(2),writer:'fixture-next-writer'});
  await next.instance.initialize();const before=await f.store.read(f.key);
  await assert.rejects(f.instance.save(world(99)),/房主已变更/);await assert.rejects(f.instance.backup({force:true}),/房主已变更/);
  assert.deepEqual(await f.store.read(f.key),before);assert.equal(f.remote.calls.length,0);
});

test('an old in-flight ACK cannot mutate a newly claimed record or emit resets',async()=>{
  const f=fixture();await f.instance.initialize();const gate=f.remote.holdNext();await f.instance.save(world(2));await gate.entered;
  const pending=f.instance.job;const rejected=assert.rejects(pending,/房主已变更/);
  const next=fixture({store:f.store,remote:f.remote,room:room(2),writer:'fixture-next-writer'});await next.instance.initialize();
  const before=await f.store.read(f.key);gate.release();await rejected;await turn();
  assert.deepEqual(await f.store.read(f.key),before);assert.equal(f.resets.length,0);
});

test('invalid remote ACKs preserve the pending request and cannot deliver member resets',async()=>{
  const f=fixture({writeRemote:async body=>({revision:body.baseRevision+2,saveSeq:body.saveSeq,memberResetVersion:5})});await f.instance.initialize();
  await assert.rejects(f.instance.save(world(2),{requireBackup:true}),/回执无效/);
  const saved=await f.store.read(f.key);assert.ok(saved.pending);assert.equal(saved.remoteRevision,10);assert.equal(saved.backedLocalRevision,1);assert.equal(f.resets.length,0);
});

test('a validated asynchronous backup delivers reset versions before later local snapshots',async()=>{
  const runtime={players:{'fixture-member':{parts:25}},memberResetVersion:0};
  const remote=new Remote();remote.resetAck={memberResetVersion:4,memberResets:[{playerId:'fixture-member',generation:2}]};
  const f=fixture({remote,onResets:ack=>{for(const item of ack.memberResets??[])delete runtime.players[item.playerId];runtime.memberResetVersion=ack.memberResetVersion;}});
  await f.instance.initialize();const gate=remote.holdNext();await f.instance.save(world(2,{players:copy(runtime.players)}));await gate.entered;
  assert.ok(runtime.players['fixture-member']);gate.release();await f.instance.flush();assert.deepEqual(runtime.players,{});assert.equal(runtime.memberResetVersion,4);
  await f.instance.save(world(3,{players:copy(runtime.players),memberResetVersion:runtime.memberResetVersion}),{requireBackup:true});
  assert.deepEqual(latest(await f.store.read(f.key)).state.players,{});assert.deepEqual(remote.state.players,{});
});

test('required backups await asynchronous reset application before reporting success',async()=>{
  const entered=deferred(),release=deferred();let applied=false,acked=false;
  const f=fixture({onResets:async()=>{entered.resolve();await release.promise;applied=true;}});await f.instance.initialize();
  const final=f.instance.save(world(2),{requireBackup:true}).then(value=>{acked=true;return value;});
  await entered.promise;await turn();assert.equal(acked,false);assert.equal(applied,false);
  assert.ok((await f.store.read(f.key)).pending,'the receipt remains replayable until resets apply');
  release.resolve();await final;assert.equal(applied,true);assert.equal((await f.store.read(f.key)).pending,null);
});

test('reset application failure keeps the exact remote receipt replayable on retry',async()=>{
  let fail=true;const calls=[];
  const f=fixture({onResets:async ack=>{calls.push(copy(ack));if(fail)throw Error('fixture reset application failed');}});await f.instance.initialize();
  await assert.rejects(f.instance.save(world(2),{requireBackup:true}),/reset application failed/);
  const saved=await f.store.read(f.key);assert.ok(saved.pending);assert.equal(saved.remoteRevision,10);assert.equal(saved.backedLocalRevision,1);
  fail=false;await f.instance.flush();assert.equal(f.remote.commits,1);assert.deepEqual(f.remote.calls[0],f.remote.calls[1]);assert.equal(calls.length,2);
  assert.deepEqual(calls[0],calls[1]);assert.equal((await f.store.read(f.key)).pending,null);
});

test('a local receipt commit failure after remote success does not lose the retry envelope',async()=>{
  const store=new AtomicStore(),remote=new Remote();let fail=true;
  const f=fixture({store,remote,writeRemote:async body=>{const ack=await remote.write(body);if(fail){fail=false;store.failNext(Error('fixture receipt commit failed'));}return ack;}});
  await f.instance.initialize();await assert.rejects(f.instance.save(world(2),{requireBackup:true}),/receipt commit failed/);
  const saved=await store.read(f.key);assert.ok(saved.pending);assert.equal(saved.remoteRevision,10);
  await f.instance.flush();assert.equal(remote.commits,1);assert.deepEqual(remote.calls[0],remote.calls[1]);assert.equal((await store.read(f.key)).pending,null);
});

test('concurrent local transactions yield unique monotonic sequence ACKs',async()=>{
  const f=fixture();await f.instance.initialize();const gate=f.remote.holdNext();
  const acks=await Promise.all(Array.from({length:24},(_,index)=>f.instance.save(world(index+2))));await gate.entered;
  assert.deepEqual(acks.map(ack=>ack.revision),Array.from({length:24},(_,index)=>index+2));
  const saved=await f.store.read(f.key);assert.equal(saved.slots.length,2);assert.equal(latest(saved).slot.sequence,25);
  gate.release();await f.instance.flush();assert.equal(f.remote.state.tick,25);
});

test('caller mutations after save do not change a checkpoint or its remote envelope',async()=>{
  const f=fixture();await f.instance.initialize();const state=world(2),gate=f.remote.holdNext();
  await f.instance.save(state);state.bank.parts=999;await gate.entered;
  assert.equal(latest(await f.store.read(f.key)).state.bank.parts,2);assert.equal(f.remote.calls[0].state.bank.parts,2);
  gate.release();await f.instance.flush();
});

test('a corrupt unbacked newest slot falls back to a valid checkpoint',async()=>{
  const corrupt=pack(world(2),2);corrupt.json+='bad';const f=fixture({room:room(2)});seed(f,record({slots:[pack(world(),1),corrupt]}));
  const restored=await f.instance.initialize();assert.deepEqual(restored.state,world());assert.equal(latest(await f.store.read(f.key)).slot.sequence,1);
});

test('two corrupt local slots recover from the server with an explicit notice',async()=>{
  const a=pack(world(),1),b=pack(world(2),2);a.checksum='broken';b.json='not json';const f=fixture({room:room(2)});seed(f,record({slots:[a,b]}));
  const restored=await f.instance.initialize();assert.deepEqual(restored.state,world());assert.match(restored.notice,/未通过检查/);
  assert.deepEqual(latest(await f.store.read(f.key)).state,world());
});

test('a corrupt already-backed newest slot must not roll back the authoritative server checkpoint',async()=>{
  const newer=pack(world(9),2);newer.checksum='broken';const f=fixture({remote:new Remote(world(9),11),room:room(2)});
  seed(f,record({slots:[pack(world(),1),newer],remoteRevision:11,backedLocalRevision:2}));
  const restored=await f.instance.initialize();assert.equal(restored.state.tick,9,'the valid old slot predates the acknowledged server state');
  assert.equal(latest(await f.store.read(f.key)).state.tick,9);await f.instance.flush();assert.equal(f.remote.calls.length,0);
});

test('malformed slot containers recover from the authoritative backup instead of preventing entry',async()=>{
  const f=fixture({room:room(2)});seed(f,record({slots:{corrupt:true}}));
  const restored=await f.instance.initialize();assert.deepEqual(restored.state,world());assert.deepEqual(latest(await f.store.read(f.key)).state,world());
});

test('a valid local checkpoint remains recoverable beside a malformed slot element',async()=>{
  const f=fixture({room:room(2)});seed(f,record({slots:[null,pack(world(3),2)]}));
  const restored=await f.instance.initialize();assert.deepEqual(restored.state,world(3));
  await f.instance.save(world(4),{requireBackup:true});assert.equal(f.remote.state.tick,4);
});

test('stopped adapters reject new local saves without modifying durable data',async()=>{
  const f=fixture();await f.instance.initialize();f.instance.stop();const before=await f.store.read(f.key);
  await assert.rejects(f.instance.save(world(2)));assert.deepEqual(await f.store.read(f.key),before);assert.equal(f.remote.calls.length,0);
});

test('stopping during an in-flight backup suppresses callbacks into the retired session',async()=>{
  const f=fixture();await f.instance.initialize();const gate=f.remote.holdNext();await f.instance.save(world(2));await gate.entered;
  const job=f.instance.job;f.instance.stop();const statuses=f.statuses.length;gate.release();await job.catch(()=>{});await turn();
  assert.equal(f.resets.length,0,'a retired runtime must not receive reset callbacks');assert.equal(f.statuses.length,statuses,'a retired UI must not receive status callbacks');
});

test('invalid snapshot content cannot produce a successful local-save ACK for an older checkpoint',async()=>{
  const f=fixture();await f.instance.initialize();const before=await f.store.read(f.key);
  await assert.rejects(f.instance.save(world(2,{tick:NaN})));assert.deepEqual(await f.store.read(f.key),before);assert.equal(f.remote.calls.length,0);
});

test('oversized snapshots abort locally and never start a backup',async()=>{
  const f=fixture();await f.instance.initialize();const before=await f.store.read(f.key);
  await assert.rejects(f.instance.save(world(2,{payload:'x'.repeat(4*1024*1024)})),/太大/);
  assert.deepEqual(await f.store.read(f.key),before);assert.equal(f.remote.calls.length,0);
});
