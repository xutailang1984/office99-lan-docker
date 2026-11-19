import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadConfig} from '../config.mjs';
import {RoomRuntime} from '../room-runtime.mjs';

test('room welcome, initial state and resync advertise the installed server build',async()=>{
  const {version}=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8'));
  const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
  const packets=[],peerId='version-owner';
  const room={id:'version-room',ownerId:'version-account',hostPeerId:peerId,status:'running',members:[{peerId,accountId:'version-account',name:'版本回归',ready:true}]};
  const runtime=new RoomRuntime({config,room,now:()=>0,send:(id,json)=>packets.push({id,message:JSON.parse(json)}),save:async()=>({revision:1})});
  runtime.receive(peerId,{type:'hello'});
  const welcome=packets.find(p=>p.message.type==='welcome').message;
  const initial=packets.find(p=>p.message.type==='state').message;
  assert.equal(welcome.build,version);
  assert.equal(initial.build,version);
  assert.equal(runtime.state().build,version);
  runtime.receive(peerId,{type:'snapshot_ack',snapshotId:initial.snapshotId});
  for(let tick=0;tick<4;tick++)runtime.step(1/30);
  const delta=packets.find(p=>p.message.type==='state_delta').message;
  assert.equal({...initial,...delta.changes}.build,version,'delta reconstruction must retain the advertised build');
  runtime.receive(peerId,{type:'state_resync'});
  const resynced=packets.at(-1).message;
  assert.equal(resynced.type,'state');
  assert.equal(resynced.build,version);
  assert.ok(resynced.snapshotId>initial.snapshotId);
});
