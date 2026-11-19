import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../config.mjs';
import {RoomRuntime} from '../room-runtime.mjs';

const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
function setup({state=null,save}={}){
 const members=[{peerId:'owner-peer',accountId:'owner',name:'测试房主',ready:true},{peerId:'guest-peer',accountId:'guest',name:'测试队员',ready:true}];
 const room={id:'test-room',ownerId:'owner',hostPeerId:'owner-peer',status:'waiting',members};const packets=[],saves=[];
 const runtime=new RoomRuntime({config:structuredClone(config),state,room,now:()=>0,send:(id,json)=>packets.push({id,value:JSON.parse(json)}),save:save??(async state=>{saves.push(state);return{revision:saves.length};})});
 return {runtime,packets,saves,room,members,join:id=>runtime.receive(id,{type:'hello',name:'不能覆盖可信昵称',token:'不能覆盖可信身份'})};
}
test('room only accepts centrally listed peers; remains paused before host starts',()=>{
 const f=setup();f.join('outsider');assert.equal(Object.keys(f.runtime.world.s.players).length,0);f.join('guest-peer');f.join('owner-peer');assert.equal(f.runtime.world.s.hostId,'player-2');assert.equal(f.runtime.world.s.players['player-2'].name,'测试房主');for(let n=0;n<60;n++)f.runtime.step(1/30);assert.equal(f.runtime.world.s.time,0);f.runtime.setRoom({...f.room,status:'running'});f.runtime.step(1/30);assert.ok(f.runtime.world.s.time>0);
});
test('delta snapshot ACK is connection-bound and guest cannot change owner settings',()=>{
 const f=setup();f.join('owner-peer');f.join('guest-peer');const s=f.runtime.sessions.get('guest-peer'),id=s.pendingId;
 f.runtime.receive('guest-peer',{type:'snapshot_ack',snapshotId:id+10});assert.equal(s.pendingId,id);f.runtime.receive('guest-peer',{type:'snapshot_ack',snapshotId:id});assert.equal(s.pendingId,null);
 f.runtime.receive('guest-peer',{type:'command',command:'Settings',requestId:1,payload:{friendlyFire:true}});assert.equal(f.packets.at(-1).value.code,'HOST_ONLY');assert.equal(f.runtime.world.s.friendlyFire,false);
 f.runtime.receive('owner-peer',{type:'command',command:'Settings',requestId:1,payload:{friendlyFire:true}});assert.equal(f.runtime.world.s.friendlyFire,true);
});
test('leaving releases online space while more than eight historical identities retain gear',()=>{
 const f=setup();f.join('owner-peer');for(let i=0;i<12;i++){const member={peerId:'visitor-'+i,accountId:'visitor-account-'+i,name:'测试队员',ready:true};f.runtime.setRoom({...f.room,members:[f.members[0],member]});f.join(member.peerId);const p=f.runtime.world.s.players[f.runtime.sessions.get(member.peerId).playerId];assert.ok(f.runtime.world.equipped(p,'weapon'));f.runtime.disconnect(member.peerId);}
 assert.equal(Object.keys(f.runtime.world.s.players).length,13);assert.equal(Object.values(f.runtime.world.s.players).filter(p=>p.connected).length,1);f.runtime.world.assertInvariants();
 const old=Object.values(f.runtime.world.s.players).find(p=>p.tokenHash==='account:visitor-account-0'),gun=f.runtime.world.equipped(old,'weapon').id;
 const returning={peerId:'new-connection',accountId:'visitor-account-0',name:'回来的队员',ready:true};f.runtime.setRoom({...f.room,members:[f.members[0],returning]});f.join(returning.peerId);assert.equal(f.runtime.sessions.get(returning.peerId).playerId,old.id);assert.equal(f.runtime.world.equipped(old,'weapon').id,gun);
});
test('owner departure pauses world, guest departure does not; final save restores equipment',async()=>{
 const f=setup();f.join('owner-peer');f.join('guest-peer');f.runtime.setRoom({...f.room,status:'running'});f.runtime.disconnect('guest-peer');assert.equal(f.runtime.world.s.paused,false);f.runtime.disconnect('owner-peer');assert.equal(f.runtime.world.s.paused,true);await f.runtime.freezeAndSave();const restored=setup({state:f.saves.at(-1)});restored.join('owner-peer');assert.equal(Object.keys(restored.runtime.world.s.items).length,Object.keys(f.saves.at(-1).items).length);assert.equal(restored.runtime.world.s.time,f.saves.at(-1).time);
});
test('save failure pauses simulation and a successful retry clears fault',async()=>{
 let fail=true;const f=setup({save:async()=>{if(fail)throw Error('isolated disk fault');return{revision:1};}});f.join('owner-peer');f.runtime.setRoom({...f.room,status:'running'});await assert.rejects(f.runtime.save());assert.equal(f.runtime.saveFault,true);const time=f.runtime.world.s.time;f.runtime.step(.1);assert.equal(f.runtime.world.s.time,time);fail=false;await f.runtime.save();f.runtime.step(.1);assert.equal(f.runtime.saveFault,false);assert.ok(f.runtime.world.s.time>time);
});
test('final close waits for earlier save then persists the latest frozen tick',async()=>{
 let release,calls=0;const snapshots=[];const f=setup({save:async state=>{snapshots.push(state);if(++calls===1)await new Promise(resolve=>release=resolve);return{revision:calls};}});f.join('owner-peer');f.runtime.setRoom({...f.room,status:'running'});const first=f.runtime.save();f.runtime.step(.1);const final=f.runtime.freezeAndSave();release();await first;await final;assert.equal(snapshots.length,2);assert.ok(snapshots[1].time>snapshots[0].time);assert.equal(snapshots[1].paused,true);
});

test('a burst of queued inputs cannot discard the sole snapshot acknowledgment and freeze updates',()=>{
 const f=setup();f.join('owner-peer');f.join('guest-peer');f.runtime.setRoom({...f.room,status:'running'});const s=f.runtime.sessions.get('guest-peer'),first=s.pendingId;
 for(let seq=1;seq<=450;seq++)f.runtime.receive('guest-peer',{type:'input',seq,dx:0,dz:0});
 f.runtime.receive('guest-peer',{type:'snapshot_ack',snapshotId:first});assert.equal(s.pendingId,null);
 f.runtime.snapshot('guest-peer',s);assert.ok(s.pendingId>first);assert.equal(f.packets.at(-1).value.type,'state_delta');
});

test('web owner loading does not consume preparation and only its enter handshake starts the clock',()=>{
 const f=setup();f.runtime.setRoom({...f.room,status:'running'});
 for(const id of ['owner-peer','guest-peer'])f.runtime.receive(id,{type:'hello',clientReady:true});
 for(let i=0;i<1500;i++)f.runtime.step(1/30);
 assert.equal(f.runtime.world.s.time,0);assert.equal(f.runtime.world.s.phase,'PREP');
 f.runtime.receive('guest-peer',{type:'client_ready'});f.runtime.step(.1);assert.equal(f.runtime.world.s.time,0);
 f.runtime.receive('owner-peer',{type:'command',command:'StartDay',requestId:3,payload:{}});assert.equal(f.packets.at(-1).value.code,'BUSY');
 f.runtime.receive('owner-peer',{type:'client_ready'});f.runtime.step(.1);assert.equal(f.runtime.world.s.paused,false);assert.ok(f.runtime.world.s.time>0);
 assert.equal(f.runtime.world.s.phasePlan.players,2);assert.equal(f.runtime.world.phaseDuration(),60);
});

test('loading late guest cannot input and does not pause a playing owner; reconnect must re-enter',()=>{
 const f=setup();f.join('owner-peer');f.runtime.setRoom({...f.room,status:'running'});f.runtime.receive('guest-peer',{type:'hello',clientReady:true});
 const guest=f.runtime.world.s.players[f.runtime.sessions.get('guest-peer').playerId],seq=guest.lastInputSeq;
 f.runtime.receive('guest-peer',{type:'input',seq:100,dx:1,dz:0});assert.equal(guest.lastInputSeq,seq);
 f.runtime.step(.1);assert.equal(f.runtime.world.s.paused,false);
 f.runtime.disconnect('owner-peer');assert.equal(f.runtime.world.s.paused,true);
 f.runtime.receive('owner-peer',{type:'hello',clientReady:true});const time=f.runtime.world.s.time;
 f.runtime.step(.1);assert.equal(f.runtime.world.s.time,time);
 f.runtime.receive('owner-peer',{type:'client_ready'});f.runtime.step(.1);assert.ok(f.runtime.world.s.time>time);
});
