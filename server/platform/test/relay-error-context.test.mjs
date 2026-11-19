import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelayRouter} from '../relay-router.mjs';
function fixture(){let time=1000;const sent=[],host={peerId:'host',roomId:'room-a',ws:{readyState:1,bufferedAmount:0,send:json=>sent.push(JSON.parse(json))}},members=new Map([['host',host]]),room={id:'room-a',epoch:4,hostPeerId:'host',status:'waiting',members};const router=createRelayRouter({now:()=>time,getRoom:()=>room,getPeer:id=>members.get(id),isCurrent:()=>true,sessionActive:()=>true});return {sent,host,room,router,next:()=>time+=300};}
test('rejection remains NOT_MEMBER and echoes only bounded already-supplied route context',()=>{
 const f=fixture();f.router.handle(f.host,{type:'relay_open',roomId:f.room.id,epoch:4,to:'departed'});assert.deepEqual(f.sent[0],{type:'relay_error',code:'NOT_MEMBER',message:'转发对象不在当前房间',roomId:'room-a',epoch:4,to:'departed'});assert.equal(f.sent.some(m=>m.type==='relay_ready'||m.type==='relay'),false);
 for(const to of ['x'.repeat(129),{},null,'']){f.next();f.router.handle(f.host,{type:'relay_open',roomId:f.room.id,epoch:4,to});const result=f.sent.at(-1);assert.equal(result.code,'NOT_MEMBER');assert.equal(result.to,undefined);assert.equal(result.roomId,undefined);assert.equal(result.epoch,undefined);}
 f.next();f.router.handle(f.host,{type:'relay_open',roomId:'room-a',epoch:3,to:'departed'});assert.equal(f.sent.at(-1).code,'STALE_ROOM');assert.equal(f.sent.at(-1).to,undefined);
});
