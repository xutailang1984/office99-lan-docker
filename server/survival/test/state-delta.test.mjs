import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {createSurvivalService} from '../service.mjs';
import {ENTITY_COLLECTIONS,compileState,diffState,fullEnvelope,deltaEnvelope,quantizeWire} from '../state-wire.mjs';
const packagePath=new URL('../../package.json',import.meta.url),{WebSocket}=createRequire(packagePath)('ws');
export function restoreState(previous,message){
  if(message.type==='state')return structuredClone(message);
  if(!previous||message.baseSnapshotId!==previous.snapshotId)throw Error('Missing delta baseline');
  const state=structuredClone(previous);for(const key of message.removedKeys??[])delete state[key];Object.assign(state,structuredClone(message.changes));
  for(const [collection,operations] of Object.entries(message.entities)){const index=new Map((state[collection]??[]).map(e=>[e.id,e]));for(const id of operations.remove??[])index.delete(id);for(const e of operations.upsert??[])index.set(e.id,structuredClone(e));for(const patch of operations.patch??[]){const e=index.get(patch.id);if(!e)throw Error('Missing entity baseline');for(const key of patch.unset??[])delete e[key];Object.assign(e,structuredClone(patch.set));}state[collection]=[...index.values()];}
  state.snapshotId=message.snapshotId;state.type='state';return state;
}
function withoutTransport(state){const copy=structuredClone(state);delete copy.snapshotId;return copy;}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(t,options={}){const directory=await mkdtemp(path.join(tmpdir(),'delta-isolated-')),service=await createSurvivalService({configPath:new URL('../../../client/survival/balance.json',import.meta.url),saveDir:directory,wsPackagePath:packagePath,manualClock:true,...options}),http=createServer((req,res)=>res.writeHead(404).end()),clients=[];http.on('upgrade',(req,socket,head)=>{if(!service.handleUpgrade(req,socket,head))socket.destroy();});http.listen(0,'127.0.0.1');await once(http,'listening');t.after(async()=>{for(const c of clients)c.ws.terminate();await service.stop();await new Promise(resolve=>http.close(resolve));await rm(directory,{recursive:true,force:true});});return {service,clients,url:`ws://127.0.0.1:${http.address().port}/survival/ws`};}
async function join(f,capabilities={stateDelta:1},token){const c={ws:new WebSocket(f.url),messages:[],frames:[],state:null,autoAck:false};f.clients.push(c);c.ws.on('message',raw=>{const m=JSON.parse(raw);c.messages.push(m);if(m.type==='state'||m.type==='state_delta'){c.frames.push(m);c.state=restoreState(c.state,m);if(c.autoAck)c.ws.send(JSON.stringify({type:'snapshot_ack',snapshotId:m.snapshotId}));}});await once(c.ws,'open');c.ws.send(JSON.stringify({type:'hello',name:'隔离增量测试',...capabilities,...(token?{token}:{})}));c.wait=async predicate=>{for(let i=0;i<200;i++){const found=c.messages.find(predicate);if(found)return found;await pause(5);}throw Error('Expected isolated WS packet missing');};c.welcome=await c.wait(m=>m.type==='welcome');await c.wait(m=>m.type==='state');return c;}
async function ack(c){c.ws.send(JSON.stringify({type:'snapshot_ack',snapshotId:c.state.snapshotId}));await pause(8);}
async function compareSameTick(delta,legacy){const snapshot=structuredClone(delta.state),full=await legacy.wait(m=>m.type==='state'&&m.serverTick===snapshot.serverTick);assert.deepEqual(withoutTransport(snapshot),withoutTransport(quantizeWire(full)));}

test('field patches exactly reconstruct nested equipment/null/array removal and preserve immutable simulation precision',()=>{
  const old={type:'state',worldId:'test-world',time:1.123456,optional:{x:1},...Object.fromEntries(ENTITY_COLLECTIONS.map(key=>[key,[]])),players:[{id:'p1',x:1.234567,equipment:{weapon:'weapon-container'},fishing:{id:'line'},temporary:'old',array:[1,2]}],items:[{id:'i1',quantity:1}]};
  const source=structuredClone(old),next=structuredClone(old);next.time=2.123456;delete next.optional;next.players[0].x=9.876543;next.players[0].equipment={weapon:null,rod:'rod-container'};next.players[0].fishing=null;next.players[0].array=[];delete next.players[0].temporary;next.items=[];next.enemies=[{id:'e1',hp:14.444444}];
  const a=compileState(old),b=compileState(next),diff=diffState(a,b);assert.equal(diffState(a,b),diff);assert.equal(diff.delta.entities.players.upsert.length,0);assert.equal(diff.delta.entities.players.patch[0].set.fishing,null);assert(diff.delta.entities.players.patch[0].unset.includes('temporary'));assert.deepEqual(diff.delta.entities.items.remove,['i1']);assert(diff.delta.removedKeys.includes('optional'));const result=restoreState(JSON.parse(fullEnvelope(a,1)),JSON.parse(deltaEnvelope(diff.body,2,1)));assert.deepEqual(withoutTransport(result),b.state);assert.deepEqual(old,source);assert.equal(next.players[0].x,9.876543);
});
test('every fixed entity collection supports insert, changed fields, null and removal across sequential baselines',()=>{
  const source={type:'state',worldId:'fixed',...Object.fromEntries(ENTITY_COLLECTIONS.map(key=>[key,[{id:key+'-1',value:1,temporary:'x'}]]))};let previous=compileState(source),restored=JSON.parse(fullEnvelope(previous,1));
  for(let step=2;step<=12;step++){for(const collection of ENTITY_COLLECTIONS){source[collection]=step%3===0?[]:[{id:collection+'-1',value:step%2===0?null:step,values:step%2?[1,2]:[]}];}const next=compileState(source),delta=diffState(previous,next);restored=restoreState(restored,JSON.parse(deltaEnvelope(delta.body,step,step-1)));assert.deepEqual(withoutTransport(restored),next.state);previous=next;}
});
test('real delta session sends only against ACK baseline, ignores wrong ACK, and matches legacy full state',async t=>{
  const f=await fixture(t),delta=await join(f),legacy=await join(f,{});assert.equal(delta.welcome.stateDelta,1);assert.equal(legacy.welcome.stateDelta,0);await ack(delta);await f.service.advance(.1);await pause(10);assert.equal(delta.frames.at(-1).type,'state_delta');await compareSameTick(delta,legacy);const base=delta.frames.at(-1).baseSnapshotId;
  const w=f.service.inspect(),p=w.s.players[delta.welcome.selfId];p.x=20.987654;p.fishing=null;p.equipment.unused=null;delta.ws.send(JSON.stringify({type:'snapshot_ack',snapshotId:99999}));await pause(8);for(let i=0;i<20;i++)await f.service.advance(.1);await pause(10);assert.equal(delta.frames.length,2);assert.equal(delta.frames[1].baseSnapshotId,base);await ack(delta);await f.service.advance(.1);await pause(10);assert.equal(delta.frames.length,3);assert.equal(delta.frames[2].baseSnapshotId,delta.frames[1].snapshotId);await compareSameTick(delta,legacy);assert.notEqual(p.x,delta.state.players.find(p=>p.id===delta.welcome.selfId).x);
});
test('manual and real snapshots cannot build a delta from an unacknowledged sent frame',async t=>{
  const f=await fixture(t,{manualClock:false}),c=await join(f);await pause(1200);assert.equal(c.frames.length,1);await ack(c);await c.wait(m=>m.type==='state_delta');const length=c.frames.length;await pause(1100);assert.equal(c.frames.length,length);const firstDelta=c.frames.at(-1);assert.equal(firstDelta.baseSnapshotId,c.frames[0].snapshotId);
});
test('explicit lost-baseline resync sends one full reset, throttles repeats and stale ACK cannot unlock it',async t=>{
  const f=await fixture(t),c=await join(f);await ack(c);await f.service.advance(.1);await pause(10);const stale=c.state.snapshotId;c.ws.send(JSON.stringify({type:'state_resync'}));await c.wait(m=>m.type==='state'&&m.snapshotId>stale);assert.equal(c.frames.at(-1).type,'state');assert(c.state.snapshotId>stale);const count=c.frames.length;c.ws.send(JSON.stringify({type:'snapshot_ack',snapshotId:stale}));for(let i=0;i<5;i++)c.ws.send(JSON.stringify({type:'state_resync'}));await pause(10);await f.service.advance(.5);await pause(10);assert.equal(c.frames.length,count);await ack(c);await f.service.advance(.1);await pause(10);assert.equal(c.frames.at(-1).baseSnapshotId,c.frames[count-1].snapshotId);
});
test('reconnection and new adventure always start with full frames despite outstanding old-world ACK',async t=>{
  const f=await fixture(t),a=await join(f),oldWorld=a.state.worldId,close=once(a.ws,'close'),b=await join(f,{stateDelta:1},a.welcome.token);assert.equal((await close)[0],4001);assert.equal(b.frames[0].type,'state');assert.equal(b.welcome.selfId,a.welcome.selfId);f.service.inspect().s.phase='COMPLETE';b.ws.send(JSON.stringify({type:'command',requestId:1,command:'NewAdventure',payload:{confirm:true}}));await b.wait(m=>m.type==='result'&&m.requestId===1);await f.service.advance(.1);await pause(20);assert.notEqual(b.state.worldId,oldWorld);assert.equal(b.frames.at(-1).type,'state');assert(b.frames.at(-1).snapshotId>b.frames[0].snapshotId);await ack(b);await f.service.advance(.1);await pause(10);assert.equal(b.frames.at(-1).type,'state_delta');
});
test('late input changes collapse into one latest patch and full inventory replacement never changes saves',async t=>{
  const f=await fixture(t),c=await join(f),w=f.service.inspect(),p=w.s.players[c.welcome.selfId];const gun=w.equipped(p),before=w.serialize();for(let i=0;i<30;i++)w.input(p,{seq:i+1,dx:0,dz:0,yaw:i*.0314159265,pitch:0});gun.magazineAmmo=3;p.reload=null;delete p.optionalTemporary;await f.service.advance(.1);assert.equal(c.frames.length,1);await ack(c);await f.service.advance(.1);await pause(10);assert.equal(c.state.players[0].inputAck,30);assert.equal(c.state.items.find(i=>i.id===gun.id).magazineAmmo,3);assert.equal(w.s.players[p.id].yaw,29*.0314159265);assert.equal(c.state.players[0].yaw,Math.round(w.s.players[p.id].yaw*1000)/1000);const saved=w.serialize();assert.equal(saved.items[gun.id].magazineAmmo,3);assert.equal(saved.players[p.id].tokenHash,before.players[p.id].tokenHash);
});
