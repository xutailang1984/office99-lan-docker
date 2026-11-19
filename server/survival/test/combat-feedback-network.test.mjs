import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomRuntime} from '../room-runtime.mjs';
import {loadConfig} from '../config.mjs';
import {quantizeWire} from '../state-wire.mjs';
const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));

test('eight peers receive one identical complete coffee strike; late join and saved world retain its action sequence',()=>{
 const members=Array.from({length:8},(_,i)=>({peerId:'combat-peer-'+i,accountId:'combat-account-'+i,name:'合成队员',ready:true}));
 const room={id:'combat-room',ownerId:members[0].accountId,hostPeerId:members[0].peerId,status:'running',mode:'mission',missionStart:'free',members};
 const packets=[];let time=0;
 const runtime=new RoomRuntime({config:structuredClone(config),room,now:()=>time,send:(peer,json)=>packets.push({peer,value:JSON.parse(json)}),save:async()=>({revision:1})});
 for(const m of members)runtime.receive(m.peerId,{type:'hello'});
 const owner=runtime.world.s.players[runtime.sessions.get(members[0].peerId).playerId];
 runtime.receive(members[0].peerId,{type:'command',command:'MissionControl',requestId:1,payload:{action:'boss'}});
 runtime.step(.1);const w=runtime.world,e=w.s.enemies[w.s.mission.park.bossId];assert(e?.definitionId==='boss_coffee_boiler');
 Object.assign(owner,{x:e.x,z:e.z+3,y:w.ground(e.x,e.z+3),joinProtectionUntil:0});
 const ack=()=>{for(const [peer,s] of runtime.sessions)if(s.pendingId!==null)runtime.receive(peer,{type:'snapshot_ack',snapshotId:s.pendingId});};
 for(let i=0;i<150&&!(e.attackActionSeq>0);i++){time+=34;ack();runtime.step(1/30);}
 assert(e.attackActionSeq>0);assert.equal(e.state,'ATTACK');assert(e.activeAttack.zone.travel);assert(e.attackTimeline);
 const strikes=packets.filter(p=>p.value.eventType==='EnemyAttackResolved'&&p.value.entityId===e.id);
 assert.equal(strikes.length,8);assert.equal(new Set(strikes.map(p=>p.peer)).size,8);
 assert(strikes.every(p=>JSON.stringify(p.value)===JSON.stringify(strikes[0].value)));
 const last=members.at(-1).peerId;runtime.disconnect(last);runtime.receive(last,{type:'hello'});
 const fresh=packets.filter(p=>p.peer===last&&p.value.type==='state').at(-1).value.enemies.find(q=>q.id===e.id);
 assert.equal(fresh.attackActionSeq,e.attackActionSeq);assert.equal(fresh.attackActionAt,quantizeWire(e.attackActionAt));assert.equal(fresh.attackActionKind,e.attackKind);assert.equal(fresh.attackTimeline.startedAt,quantizeWire(e.attackTimeline.startedAt));assert.deepEqual(fresh.activeAttack,quantizeWire(e.activeAttack));
 const restored=new RoomRuntime({config:structuredClone(config),state:w.serialize(),room,send:()=>{},save:async()=>({revision:1})});
 assert.equal(restored.world.s.enemies[e.id].attackActionSeq,e.attackActionSeq);
 assert.equal(packets.filter(p=>p.value.type==='error').length,0);w.assertInvariants();
});
