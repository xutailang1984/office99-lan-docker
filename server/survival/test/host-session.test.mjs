// Synthetic identities, a controlled clock, and in-memory persistence only.
// These tests exercise the same host lifecycle used by the browser adapter.
import test from 'node:test';
import assert from 'node:assert/strict';
import {HostSession} from '../host-session.mjs';
import {loadConfig} from '../config.mjs';

const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function fixture({save,state=null,status='running'}={}){
 const members=[{peerId:'session-owner-peer',accountId:'session-owner',name:'合成房主',ready:true},{peerId:'session-guest-peer',accountId:'session-guest',name:'合成队员',ready:true}];
 const room={id:'session-test-room',adventureId:'session-test-adventure',epoch:1,ownerId:members[0].accountId,hostPeerId:members[0].peerId,status,members};
 const timers=new Map(),packets=[],saves=[],pulses=[],errors=[];let clock=0,nextTimer=0;
 const session=new HostSession({config:structuredClone(config),state,room,now:()=>clock,
  schedule:(callback,interval)=>{assert.ok(interval>0);const id=++nextTimer;timers.set(id,callback);return id;},cancel:id=>timers.delete(id),
  send:(peerId,json)=>packets.push({peerId,message:JSON.parse(json)}),
  save:async(value,options)=>{saves.push({state:structuredClone(value),options:structuredClone(options)});return save?await save(value,options,saves.length):{revision:saves.length};},
  onPulse:()=>pulses.push(clock),onError:error=>errors.push(error)});
 const send=(peerId,message)=>session.handle({type:'packet',peerId,json:JSON.stringify(message)});
 const join=(peerId=members[0].peerId)=>{send(peerId,{type:'hello',clientReady:true});send(peerId,{type:'client_ready'});};
 return{session,room,members,timers,packets,saves,pulses,errors,send,join,
  tick:async milliseconds=>{clock+=milliseconds;for(const callback of [...timers.values()])callback();await flush();},
  player:peerId=>session.runtime.world.s.players[session.runtime.sessions.get(peerId??members[0].peerId)?.playerId]};
}

test('start owns exactly one scheduler and duplicate start is rejected',()=>{
 const f=fixture();assert.equal(f.timers.size,0);f.session.start();assert.equal(f.timers.size,1);
 assert.throws(()=>f.session.start());assert.equal(f.timers.size,1);f.session.stop();assert.equal(f.timers.size,0);
});

test('waiting rooms and a loading owner do not consume world time',async()=>{
 const f=fixture({status:'waiting'});f.session.start();f.join();await f.tick(200);assert.equal(f.session.runtime.world.s.time,0);
 f.session.handle({type:'room',room:{...f.room,status:'running'}});await f.tick(200);assert.ok(f.session.runtime.world.s.time>0);f.session.stop();
 const loading=fixture();loading.session.start();loading.send(loading.members[0].peerId,{type:'hello',clientReady:true});loading.join(loading.members[1].peerId);
 await loading.tick(200);assert.equal(loading.session.runtime.world.s.time,0);loading.send(loading.members[0].peerId,{type:'client_ready'});await loading.tick(200);
 assert.ok(loading.session.runtime.world.s.time>0);loading.session.stop();
});

test('a delayed timer catches up at most 250 milliseconds and never accelerates a second host loop',async()=>{
 const f=fixture();f.session.start();f.join();await f.tick(10000);
 const first=f.session.runtime.world.s.time;assert.ok(first>=.19&&first<=.250001,`catch-up was ${first}`);
 await f.tick(0);assert.equal(f.session.runtime.world.s.time,first);
 await f.tick(10000);assert.ok(f.session.runtime.world.s.time<=.500001);assert.ok(f.session.runtime.world.s.time>=.46);f.session.stop();
});

test('sub-step time accumulates into fixed simulation steps',async()=>{
 const f=fixture();f.session.start();f.join();await f.tick(10);await f.tick(10);assert.equal(f.session.runtime.world.s.time,0);
 await f.tick(20);assert.ok(Math.abs(f.session.runtime.world.s.time-1/config.session.server_hz)<1e-8);f.session.stop();
});

test('heartbeats remain bounded at roughly one second instead of every frame',async()=>{
 const f=fixture();f.session.start();for(let i=0;i<75;i++)await f.tick(40);
 assert.ok(f.pulses.length>=2&&f.pulses.length<=4,`pulse count=${f.pulses.length}`);
 for(let i=1;i<f.pulses.length;i++)assert.ok(f.pulses[i]-f.pulses[i-1]>=960);f.session.stop();
});

test('malformed packets and unknown peer packets do not kill subsequent valid input',async()=>{
 const f=fixture();f.session.start();f.join();
 for(const message of [null,{},[],{type:'packet',peerId:f.members[0].peerId,json:'{'},{type:'packet',peerId:f.members[0].peerId,json:'null'},{type:'packet',peerId:f.members[0].peerId,json:'[]'},{type:'packet',peerId:f.members[0].peerId,json:42}])await assert.doesNotReject(async()=>f.session.handle(message));
 f.send('unlisted-peer',{type:'hello'});assert.equal(f.session.runtime.sessions.size,1);
 f.send(f.members[0].peerId,{type:'input',seq:71,dx:1,dz:0});await f.tick(80);assert.equal(f.player().inputAck,71);assert.equal(f.errors.length,0);f.session.stop();
});

test('room roster removal retires the old session while preserving its saved equipment',()=>{
 const f=fixture();f.session.start();f.join();f.join(f.members[1].peerId);const guest=f.player(f.members[1].peerId),id=guest.id,gun=f.session.runtime.world.equipped(guest,'weapon').id;
 f.session.handle({type:'room',room:{...f.room,members:[f.members[0]]}});assert.equal(f.session.runtime.sessions.has(f.members[1].peerId),false);assert.equal(guest.connected,false);
 f.send(f.members[1].peerId,{type:'hello'});assert.equal(f.session.runtime.sessions.has(f.members[1].peerId),false);
 f.session.handle({type:'room',room:f.room});f.join(f.members[1].peerId);assert.equal(f.player(f.members[1].peerId).id,id);assert.equal(f.session.runtime.world.equipped(guest,'weapon').id,gun);f.session.stop();
});

test('disconnect pauses only when the room owner leaves',async()=>{
 const f=fixture();f.session.start();f.join();f.join(f.members[1].peerId);await f.tick(100);
 f.session.handle({type:'disconnect',peerId:f.members[1].peerId});assert.equal(f.session.runtime.world.s.paused,false);
 f.session.handle({type:'disconnect',peerId:f.members[0].peerId});const time=f.session.runtime.world.s.time;await f.tick(100);assert.equal(f.session.runtime.world.s.time,time);assert.equal(f.session.runtime.world.s.paused,true);f.session.stop();
});

test('member resets reject the wrong room or epoch without resetting valid players',()=>{
 const f=fixture();f.session.start();f.join();const id=f.player().id;
 for(const change of [{roomId:'wrong-room'},{epoch:0}])f.session.handle({type:'member_resets',roomId:f.room.id,epoch:f.room.epoch,memberResets:[{accountId:f.members[0].accountId,generation:100,active:false}],memberResetVersion:100,...change});
 assert.equal(f.player().id,id);assert.equal(f.session.runtime.sessions.size,1);f.session.stop();
});

test('concurrent close calls share one durable save and close only after its acknowledgement',async()=>{
 const pending=deferred();const f=fixture({save:()=>pending.promise});f.session.start();f.join();
 const first=f.session.close(),second=f.session.close();assert.strictEqual(first,second);assert.equal(f.timers.size,0);assert.equal(f.session.runtime.stopping,true);assert.equal(f.session.runtime.world.s.paused,true);assert.notEqual(f.session.closed,true);
 await flush();assert.equal(f.saves.length,1);pending.resolve({revision:10});await first;assert.equal(f.session.closed,true);
 assert.equal(f.saves.at(-1).state.paused,true);assert.equal(f.saves.length,1);
});

test('a failed close freezes the world and permits an explicit durable retry',async()=>{
 let fail=true;const f=fixture({save:async()=>{if(fail)throw Error('synthetic disk failure');return{revision:7};}});f.session.start();f.join();await f.tick(100);
 await assert.rejects(f.session.close());assert.notEqual(f.session.closed,true);assert.equal(f.timers.size,0);assert.equal(f.session.runtime.stopping,true);const time=f.session.runtime.world.s.time;
 await f.tick(2000);assert.equal(f.session.runtime.world.s.time,time);fail=false;await f.session.close();assert.equal(f.session.closed,true);assert.equal(f.saves.length,2);assert.equal(f.saves[1].state.time,time);
});

test('close waits for an older save and then writes the latest frozen state',async()=>{
 const pending=deferred();const f=fixture({save:async(_state,_options,count)=>count===1?pending.promise:{revision:count}});f.session.start();f.join();
 const first=f.session.runtime.save();await f.tick(100);const closing=f.session.close();await flush();assert.equal(f.saves.length,1);
 pending.resolve({revision:1});await first;await closing;assert.equal(f.saves.length,2);assert.ok(f.saves[1].state.time>f.saves[0].state.time);assert.equal(f.saves[1].state.paused,true);
});

test('a failed in-flight autosave does not prevent close from retrying the final frozen snapshot',async()=>{
 const pending=deferred();const f=fixture({save:async(_state,_options,count)=>count===1?pending.promise:{revision:count}});f.session.start();f.join();
 const first=f.session.runtime.save();const failure=assert.rejects(first,/synthetic lost acknowledgement/);await f.tick(100);const closing=f.session.close();await flush();assert.equal(f.saves.length,1);
 pending.reject(Error('synthetic lost acknowledgement'));await failure;await closing;assert.equal(f.session.closed,true);assert.equal(f.saves.length,2);assert.equal(f.saves[1].state.paused,true);assert.equal(f.saves[1].options?.requireBackup,true);assert.equal(f.session.runtime.saveFault,false);
});

test('final save carries the requested backup requirement to its storage adapter',async()=>{
 for(const requireBackup of [true,false]){const f=fixture();f.session.start();f.join();await f.session.close({requireBackup});assert.equal(f.saves.at(-1).options?.requireBackup,requireBackup);}
});

test('ordinary save failure pauses simulation until a successful explicit retry',async()=>{
 let fail=true;const f=fixture({save:async()=>{if(fail)throw Error('synthetic storage unavailable');return{revision:2};}});f.session.start();f.join();
 await assert.rejects(f.session.runtime.save());assert.equal(f.session.runtime.saveFault,true);await f.tick(200);assert.equal(f.session.runtime.world.s.time,0);
 fail=false;await f.session.runtime.save();await f.tick(200);assert.ok(f.session.runtime.world.s.time>0);assert.equal(f.session.runtime.saveFault,false);f.session.stop();
});

test('late input, roster and reset messages cannot mutate a closed session',async()=>{
 const f=fixture();f.session.start();f.join();await f.tick(100);await f.session.close();const before=JSON.stringify(f.session.runtime.world.serialize()),sent=f.packets.length;
 f.send(f.members[0].peerId,{type:'input',seq:9000,dx:1,dz:0});f.send(f.members[0].peerId,{type:'command',command:'Settings',payload:{friendlyFire:true},requestId:9001});
 f.session.handle({type:'room',room:{...f.room,status:'running',members:[]}});f.session.handle({type:'disconnect',peerId:f.members[0].peerId});
 f.session.handle({type:'member_resets',roomId:f.room.id,epoch:f.room.epoch,memberResets:[{accountId:f.members[0].accountId,generation:9,active:false}],memberResetVersion:9});
 await f.tick(2000);assert.equal(JSON.stringify(f.session.runtime.world.serialize()),before);assert.equal(f.packets.length,sent);assert.equal(f.saves.length,1);
});

test('stop cancels work without writing and does not allow late commands or restarting',async()=>{
 const f=fixture();f.session.start();f.join();f.session.stop();const before=JSON.stringify(f.session.runtime.world.serialize());
 assert.equal(f.timers.size,0);assert.equal(f.session.runtime.stopping,true);assert.equal(f.session.runtime.world.s.paused,true);
 f.send(f.members[0].peerId,{type:'command',command:'Save',requestId:11});await f.tick(2000);assert.equal(f.saves.length,0);assert.equal(JSON.stringify(f.session.runtime.world.serialize()),before);assert.throws(()=>f.session.start());
});

test('simulation exceptions cancel the loop and report once without allowing later timer callbacks',async()=>{
 const f=fixture();f.session.start();f.join();const callback=[...f.timers.values()][0];f.session.runtime.step=()=>{throw Error('synthetic simulation failure');};
 await f.tick(100);assert.equal(f.timers.size,0);assert.equal(f.errors.length,1);callback();await flush();assert.equal(f.errors.length,1);assert.equal(f.session.runtime.stopping,true);
});

test('ordinary peer messages cannot invoke a GM grant or insert trusted roster data',async()=>{
 const f=fixture();f.session.start();f.join();const before=JSON.stringify(f.session.runtime.world.serialize());
 f.send(f.members[0].peerId,{type:'gm_grant',grantId:'fake',resources:{credits:99999,materials:99999}});
 f.send(f.members[0].peerId,{type:'room',room:{...f.room,members:[...f.members,{peerId:'injected',accountId:'injected',name:'Injected'}]}});
 assert.equal(JSON.stringify(f.session.runtime.world.serialize()),before);assert.equal(f.session.runtime.members.has('injected'),false);assert.equal(f.saves.length,0);f.session.stop();
});
