import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomRuntime} from '../room-runtime.mjs';
import {loadConfig} from '../config.mjs';
const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
function fixture(){const owner={peerId:'test-owner-peer',accountId:'test-owner-account',name:'合成房主',ready:true},room={id:'isolated-test-room',ownerId:owner.accountId,hostPeerId:owner.peerId,status:'waiting',members:[owner]},packets=[];const runtime=new RoomRuntime({config,room,now:()=>0,send:(peerId,json)=>packets.push({peerId,message:JSON.parse(json)}),save:async()=>({revision:1})});runtime.receive(owner.peerId,{type:'hello'});return {owner,room,packets,runtime};}
test('64 historical visitors release online spawning space, retain equipment and return to their original identity',()=>{
 const f=fixture(),visitors=[];
 for(let i=0;i<64;i++){const member={peerId:'visitor-'+i,accountId:'synthetic-account-'+i,name:'合成队员',ready:true};f.runtime.setRoom({...f.room,members:[f.owner,member]});f.runtime.receive(member.peerId,{type:'hello'});const session=f.runtime.sessions.get(member.peerId);assert(session,'visitor '+i+' must not exhaust spawn positions');const p=f.runtime.world.s.players[session.playerId];visitors.push({member,id:p.id,gunId:f.runtime.world.equipped(p,'weapon').id});f.runtime.disconnect(member.peerId);}
 assert.equal(Object.keys(f.runtime.world.s.players).length,65);assert.equal(Object.values(f.runtime.world.s.players).filter(p=>p.connected).length,1);f.runtime.world.assertInvariants();
 for(const index of [0,31,63]){const saved=visitors[index],member={...saved.member,peerId:'returning-'+index};f.runtime.setRoom({...f.room,members:[f.owner,member]});f.runtime.receive(member.peerId,{type:'hello'});const session=f.runtime.sessions.get(member.peerId);assert.equal(session.playerId,saved.id);assert.equal(f.runtime.world.equipped(f.runtime.world.s.players[saved.id],'weapon').id,saved.gunId);f.runtime.disconnect(member.peerId);}
 assert.equal(Object.keys(f.runtime.world.s.players).length,65);
});
test('unallocatable COMPLETE hello returns JOIN_UNAVAILABLE and does not kill subsequent runtime requests',async()=>{
 const f=fixture(),guest={peerId:'new-peer',accountId:'new-account',name:'合成观察员',ready:true};f.runtime.world.s.phase='COMPLETE';f.runtime.setRoom({...f.room,members:[f.owner,guest]});
 assert.doesNotThrow(()=>f.runtime.receive(guest.peerId,{type:'hello'}));assert.equal(f.packets.at(-1).message.code,'JOIN_UNAVAILABLE');assert.equal(f.runtime.sessions.has(guest.peerId),false);
 f.runtime.receive(f.owner.peerId,{type:'command',command:'Save',requestId:1});await f.runtime.saving;assert.equal(f.runtime.saveFault,false);assert.ok(f.packets.some(p=>p.message.type==='result'&&p.message.requestId===1&&p.message.ok));
 f.runtime.world.s.phase='DAY';f.runtime.setRoom({...f.room,status:'running',members:[f.owner,guest]});assert.doesNotThrow(()=>f.runtime.receive(guest.peerId,{type:'hello'}));assert(f.runtime.sessions.has(guest.peerId));const before=f.runtime.world.s.time;f.runtime.step(1/30);assert(f.runtime.world.s.time>before);
});
