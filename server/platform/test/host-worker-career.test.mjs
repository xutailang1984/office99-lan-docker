import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {LocalHostSave} from '../../../client/platform/local-host-save.mjs';
import {latest} from '../../../client/platform/checkpoint-store.mjs';

// Exercise the real Worker orchestration and checkpoint adapter. Only the
// simulator, IndexedDB and HTTP transport are replaced with deterministic,
// clone-isolated memory fixtures. No account, disk save or network is accessed.
const source=await fs.readFile(new URL('../../../client/platform/host-worker.mjs',import.meta.url),'utf8');
const appSource=await fs.readFile(new URL('../../../client/platform/app.mjs',import.meta.url),'utf8');
const copy=value=>structuredClone(value);
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
class AtomicStore {
  rows=new Map();tail=Promise.resolve();
  run(fn){const job=this.tail.then(fn);this.tail=job.catch(()=>{});return job;}
  update(key,change){return this.run(()=>{const row=change(copy(this.rows.get(key)??null));this.rows.set(key,copy(row));return copy(row);});}
  read(key){return this.run(()=>copy(this.rows.get(key)??null));}
}
const member=id=>({peerId:'peer-'+id,accountId:id});
const room=()=>({id:'fixture-room',ownerId:'host',adventureId:'fixture-adventure',epoch:1,hostPeerId:'peer-host',mode:'adventure',members:['host','a','b'].map(member)});
const initialState=()=>({worldId:'fixture-world',time:1,tick:1,economyVersion:1,economyEpoch:0,players:Object.fromEntries(['host','a','b'].map(id=>[id,{id,careerRevision:1,gear:'fixture-'+id}]))});
class MemoryPlatform {
  revision=0;state=initialState();receipts=new Map();calls=[];commits=[];lost=0;gate=null;
  holdNext(){const entered=deferred(),release=deferred();this.gate={entered,release};return {entered:entered.promise,release:release.resolve};}
  async fetch(url,options={}){
    if(url.endsWith('/careers'))return {ok:true,json:async()=>({economyEpoch:this.state.economyEpoch,careerBindings:[]})};
    const kind=url.endsWith('/settle')?'settle':'snapshot';
    assert.ok(url.endsWith('/settle')||url.endsWith('/snapshot'),'fixture refuses unexpected network paths');
    const body=JSON.parse(options.body),key=body.hostEpoch+':'+body.saveSeq;
    this.calls.push({kind,body:copy(body)});let receipt=this.receipts.get(key);
    if(receipt){assert.equal(receipt.kind,kind);assert.deepEqual(body,receipt.body,'unknown ACK retries must be byte-equivalent in content');}
    else{
      assert.equal(body.baseRevision,this.revision,'world revisions must not race');
      assert.equal(body.state.economyEpoch,this.state.economyEpoch,'exported equipment must not return through stale snapshots');
      this.state=copy(body.state);const settled=kind==='settle'?body.settlements.map(x=>x.accountId):[];
      if(kind==='settle'){for(const id of settled)delete this.state.players[id];this.state.economyEpoch++;}
      receipt={kind,body:copy(body),ack:{revision:++this.revision,saveSeq:body.saveSeq,economyEpoch:this.state.economyEpoch,settled}};
      this.receipts.set(key,receipt);this.commits.push({kind,settled});
    }
    if(kind==='settle'&&this.gate){const gate=this.gate;this.gate=null;gate.entered.resolve();await gate.release.promise;}
    if(kind==='settle'&&this.lost>0){this.lost--;throw Error('fixture settlement ACK lost after commit');}
    return {ok:true,json:async()=>copy(receipt.ack)};
  }
}
class FakeSession {
  constructor(options){
    this.closed=false;this.handled=[];
    const state=copy(options.state),runtime={room:copy(options.room),economyVersion:options.economyVersion,handoff:false,
      members:new Map(options.room.members.map(m=>[m.peerId,copy(m)])),bindings:new Map(options.careerBindings.map(b=>[b.accountId,copy(b)])),
      world:{s:state,serialize:()=>copy(state)},save:opts=>options.save(copy(state),opts),applyOwner:()=>{},applyMemberResets:()=>{},
      setCareers:()=>{},settleCandidates:ids=>ids.filter(id=>runtime.bindings.has(id)).map(accountId=>({accountId,careerRevision:runtime.bindings.get(accountId).revision})),
      finishHandoff:(ids,epoch)=>{for(const id of ids){delete state.players[id];runtime.bindings.delete(id);}state.economyEpoch=epoch;}
    };this.runtime=runtime;
  }
  start(){}
  async close(options){if(this.closed)return;await this.runtime.save(options);this.closed=true;}
  handle(message){
    if(this.closed)return false;this.handled.push({message:copy(message),handoff:this.runtime.handoff,epoch:this.runtime.world.s.economyEpoch});
    if(message.type==='room')this.runtime.members=new Map(message.room.members.map(m=>[m.peerId,copy(m)]));
    return true;
  }
}
async function fixture(){
  const remote=new MemoryPlatform(),events=[],store=new AtomicStore(),self={};
  const build=new Function('HostSession','createGmGrantController','BrowserCheckpointStore','LocalHostSave','self','postMessage','fetch','crypto',
    source.replace(/^import .+;\r?\n/gm,'')+'\nreturn {dispatch:message=>self.onmessage({data:message}),session:()=>session,storage:()=>storage,drain:()=>careerJob};');
  const worker=build(FakeSession,()=>({cancel(){},receive(){}}),class{constructor(){return store;}},LocalHostSave,self,value=>events.push(copy(value)),remote.fetch.bind(remote),{getRandomValues:array=>array.fill(1)});
  await worker.dispatch({type:'init',room:room(),state:initialState(),revision:0,economyVersion:1,economyEpoch:0,careerBindings:['host','a','b'].map(accountId=>({accountId,revision:1})),config:{}});
  assert.ok(events.some(e=>e.type==='ready'));
  return {...worker,remote,events,store,exit:async(id,requestId=id)=>worker.dispatch({type:'settle_peer',peerId:'peer-'+id,requestId}),close:()=>worker.dispatch({type:'close'})};
}
const result=(f,id)=>f.events.findLast(e=>e.type==='career_exit_result'&&e.requestId===id);

test('host transfer exports only the departing host and preserves every guest in the final world',async()=>{
 const f=await fixture();await f.dispatch({type:'prepare_transfer'});
 assert.equal(f.events.findLast(e=>e.type==='closed').revision,f.remote.revision);
 assert.deepEqual(f.remote.commits.flatMap(c=>c.settled),['host']);
 assert.equal(f.remote.state.players.host,undefined);assert(f.remote.state.players.a&&f.remote.state.players.b);
 assert.equal(f.session().closed,true);
});

test('mission final flush retries a lost ACK then saves the newer final state before transfer',async()=>{
 const start=source.indexOf('    let sequence=m.revision'),end=source.indexOf('    restored={state:m.state',start);assert(start>0&&end>start);
 let revision=0,latestState=null,lose=true;const receipts=new Map(),calls=[];
 const fetch=async(_url,options)=>{const body=JSON.parse(options.body);calls.push(copy(body));let ack=receipts.get(body.saveSeq);if(!ack){assert.equal(body.baseRevision,revision);latestState=copy(body.state);ack={revision:++revision};receipts.set(body.saveSeq,ack);}if(lose){lose=false;throw Error('committed ACK lost');}return {ok:true,json:async()=>ack};};
 const storage=new Function('fetch',`const m={revision:0},session={runtime:{room:{id:'mission',epoch:1}}},revoked=()=>{};let storage;${source.slice(start,end)}return storage;`)(fetch);
 await assert.rejects(storage.save({tick:1},{requireBackup:true}),/ACK lost/);
 await storage.save({tick:2},{requireBackup:true});assert.deepEqual(calls[0],calls[1]);assert.equal(calls.length,3);assert.equal(storage.remoteRevision,2);assert.equal(latestState.tick,2);
});

test('explicit host revocation exits without writing through a stopped checkpoint store',async()=>{
 const start=appSource.indexOf('async function preserveDisconnected('),end=appSource.indexOf('async function disposeCurrentGame()',start);assert(start>0&&end>start);
 let closes=0,cleaned=0;
 const run=new Function('closeHook','cleanHook',`let lossJob=null,worker={},room={id:'r',epoch:1},lostRoom=false,leaving=false,pointerGuard=null,workerReady=true,roomExitSaved=false,hostRevoked=true,workerFailed=false,account=null;
 const isRuntimeHost=()=>true,closeHost=async()=>{closeHook();throw Error('closed storage');},disposeCurrentGame=async()=>{},cleanupRoom=()=>cleanHook(),show=()=>{},toast=()=>{},refresh=async()=>{},careerUI={},renderLobbyState=()=>{},roomUI=()=>{},failGame=()=>{};
 ${appSource.slice(start,end)}return preserveDisconnected('transferred');`);
 await run(()=>closes++,()=>cleaned++);assert.equal(closes,0);assert.equal(cleaned,1);
});
function assertExportedOnce(f,ids){const actual=f.remote.commits.flatMap(c=>c.settled);assert.deepEqual(actual.slice().sort(),ids.slice().sort());assert.equal(new Set(actual).size,actual.length);for(const id of ids)assert.equal(f.remote.state.players[id],undefined);}

test('two simultaneous guest exits each settle once with serialized revisions',async()=>{
  const f=await fixture(),gate=f.remote.holdNext();await f.exit('a');await gate.entered;await f.exit('b');gate.release();await f.drain();
  for(const id of ['a','b'])assert.equal(result(f,id)?.settled,true);
  assertExportedOnce(f,['a','b']);assert.equal(f.session().runtime.handoff,false);assert.equal(await f.storage().pendingHandoff(),null);
});

test('a second guest recovers the first lost ACK and still exports their own character',async()=>{
  const f=await fixture();f.remote.lost=1;await f.exit('a');await f.drain();
  assert.equal(result(f,'a').ok,false);assert.equal(f.session().runtime.handoff,true);
  await f.exit('b');await f.drain();assert.equal(result(f,'b').settled,true);assertExportedOnce(f,['a','b']);
  const requests=f.remote.calls.filter(c=>c.kind==='settle');assert.deepEqual(requests[0],requests[1]);assert.equal(requests.length,3);
  assert.equal(await f.storage().pendingHandoff(),null);assert.equal(f.session().runtime.handoff,false);
});

test('host close after a lost guest ACK also settles every remaining safe member',async()=>{
  const f=await fixture();f.remote.lost=1;await f.exit('a');await f.drain();await f.close();
  assertExportedOnce(f,['host','a','b']);assert.equal(f.session().closed,true);assert.equal(f.storage().stopped,true);
  assert.equal(f.events.some(e=>e.type==='close_failed'),false);assert.equal(f.events.at(-1).type,'closed');
});

test('host close queued behind a guest exit waits for the durable handoff',async()=>{
  const f=await fixture(),gate=f.remote.holdNext();await f.exit('a');await gate.entered;const closing=f.close();
  assert.equal(f.session().closed,false);assert.equal(f.remote.commits.filter(c=>c.kind==='settle').length,1);
  gate.release();await closing;assertExportedOnce(f,['host','a','b']);assert.equal(f.session().closed,true);
  assert.equal(f.events.filter(e=>e.type==='close_failed').length,0);
});

test('a completed Worker close is idempotent when the browser retries its HTTP close',async()=>{
  const f=await fixture();await f.close();const writes=f.remote.calls.length,revision=f.remote.revision;await f.close();
  assert.equal(f.remote.calls.length,writes);assert.deepEqual(f.events.filter(e=>e.type==='closed').map(e=>e.revision),[revision,revision]);
  assert.equal(f.events.some(e=>e.type==='close_failed'),false);assertExportedOnce(f,['host','a','b']);
});

test('duplicate close arriving during the first handoff returns two successful close ACKs',async()=>{
  const f=await fixture(),gate=f.remote.holdNext();const first=f.close();await gate.entered;const second=f.close();gate.release();await Promise.all([first,second]);
  assert.equal(f.events.filter(e=>e.type==='close_failed').length,0,'a queued close must recheck whether the preceding close already stopped storage');
  assert.equal(f.events.filter(e=>e.type==='closed').length,2);assertExportedOnce(f,['host','a','b']);
});

test('membership and career responses remain deferred until the frozen handoff is durable',async()=>{
  const f=await fixture(),gate=f.remote.holdNext();await f.exit('a');await gate.entered;
  await f.dispatch({type:'disconnect',peerId:'peer-b'});
  const next=room();next.members=[member('host'),member('a'),member('new')];
  await f.dispatch({type:'room',room:next});await f.dispatch({type:'packet',peerId:'peer-new',json:'{"type":"hello"}'});
  assert.deepEqual(f.session().handled.map(e=>e.message.type),['packet'],'only transport packets may reach the runtime while membership is frozen');
  assert.equal(f.session().handled[0].handoff,true);
  gate.release();await f.drain();
  const delivered=f.session().handled.filter(e=>e.message.type!=='packet');assert.deepEqual(delivered.map(e=>e.message.type),['disconnect','room','careers']);
  assert.ok(delivered.every(e=>e.handoff===false&&e.epoch===1));assert.ok(f.session().runtime.members.has('peer-new'));
  const saved=latest(await f.store.read(f.storage().key)).state;assert.equal(saved.players.a,undefined);assert.equal(saved.economyEpoch,1);
});

test('concurrent checkpoint handoffs reuse the one persisted immutable request',async()=>{
  const f=await fixture(),storage=f.storage(),requests=[];
  const write=async body=>{requests.push(copy(body));return {revision:body.baseRevision+1,saveSeq:body.saveSeq};};
  const [ack]=await Promise.all(['a','b'].map(accountId=>storage.handoff(initialState(),[{accountId,careerRevision:1}],write)));
  assert.deepEqual(requests[0],requests[1]);assert.equal(requests[0].saveSeq,1);
  await storage.acceptHandoff({...initialState(),economyEpoch:1},ack);assert.equal(await storage.pendingHandoff(),null);
});

test('browser retry after HTTP close fails does not invoke the stopped Worker again',async()=>{
  const start=appSource.indexOf('async function leaveRoom()'),end=appSource.indexOf('function closeHost(',start);
  const disposeStart=appSource.indexOf('async function disposeCurrentGame()'),disposeEnd=appSource.indexOf('function cleanupRoom(',disposeStart);
  assert.ok(start>=0&&end>start&&disposeStart>=0&&disposeEnd>disposeStart);let apiCalls=0,closeCalls=0,cleaned=0,disposed=0;const order=[];
  const build=new Function('api','closeHook','cleanHook','disposeHook',`
    let room={id:'fixture-room',ownerId:'host',hostPeerId:'peer-host',epoch:1,members:[{}],mode:'adventure'},account={id:'host'},worker={},workerInitFailed=false,roomExitSaved=false,revision=9,
      leaving=false,lostRoom=false,hostRevoked=false,frame={contentWindow:{disposeTidalGame:disposeHook}},frameLoaded=false,gameEntered=false,workerFailed=false;
    const controls=new Map(),$=id=>{if(!controls.has(id))controls.set(id,{disabled:false,classList:{remove(){}}});return controls.get(id);};
    const isRuntimeHost=()=>true,renderLobbyState=()=>{},roomUI=()=>{},show=()=>{},toast=()=>{},refresh=async()=>{},careerUI={refresh:async()=>{}};
    async function closeHost(){closeHook();roomExitSaved=true;}
    function cleanupRoom(){cleanHook();room=null;roomExitSaved=false;}
    ${appSource.slice(disposeStart,disposeEnd)}
    ${appSource.slice(start,end)}
    return {leave:leaveRoom,get:()=>({room,leaving,roomExitSaved})};`);
  const app=build(async()=>{if(++apiCalls===1)throw Error('fixture close HTTP unavailable');return {};},()=>closeCalls++,()=>{cleaned++;order.push('cleanup');},()=>{disposed++;order.push('dispose');});
  await assert.rejects(app.leave(),/HTTP unavailable/);assert.equal(app.get().roomExitSaved,true);assert.equal(app.get().leaving,false);
  assert.equal(disposed,0);assert.equal(cleaned,0);
  await app.leave();assert.equal(closeCalls,1);assert.equal(apiCalls,2);assert.equal(cleaned,1);assert.equal(disposed,1);assert.deepEqual(order,['dispose','cleanup']);assert.equal(app.get().room,null);
});

