import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createSurvivalService } from '../service.mjs';
import { SnapshotStore } from '../save-store.mjs';
import { loadConfig } from '../config.mjs';
const configPath=new URL('../../../client/survival/balance.json',import.meta.url);
const {WebSocket}=createRequire(new URL('../../package.json',import.meta.url))('ws');
async function fixture(t,options={}) {
  const directory=await mkdtemp(path.join(tmpdir(),'tidal-survival-test-')),service=await createSurvivalService({saveDir:directory,configPath,manualClock:true,...options});
  const http=createServer((req,res)=>res.writeHead(404).end());http.on('upgrade',(req,socket,head)=>{if(!service.handleUpgrade(req,socket,head))socket.destroy();});http.listen(0,'127.0.0.1');await once(http,'listening');
  const clients=[];t.after(async()=>{for(const ws of clients)ws.terminate();await service.stop();await new Promise(resolve=>http.close(resolve));await rm(directory,{recursive:true,force:true});});
  return {directory,service,http,clients,url:`ws://127.0.0.1:${http.address().port}/survival/ws`};
}
function inbox(ws) { const messages=[],waiters=[];ws.on('message',raw=>{const value=JSON.parse(raw);messages.push(value);for(const waiter of [...waiters])if(waiter.predicate(value)){clearTimeout(waiter.timer);waiters.splice(waiters.indexOf(waiter),1);waiter.resolve(value);}});return predicate=>{const value=messages.find(predicate);if(value)return Promise.resolve(value);return new Promise((resolve,reject)=>{const waiter={predicate,resolve,timer:setTimeout(()=>{waiters.splice(waiters.indexOf(waiter),1);reject(Error('Timed out awaiting game response'));},2000)};waiters.push(waiter);});}; }
async function join(f,token,name='测试渔民',capabilities={}) { const ws=new WebSocket(f.url),wait=inbox(ws),states=[],events=[];ws.on('message',raw=>{const value=JSON.parse(raw);if(value.type==='state')states.push(value);if(value.type==='event')events.push(value);});f.clients.push(ws);await once(ws,'open');ws.send(JSON.stringify({type:'hello',name,...(token?{token}:{}),...capabilities}));const welcome=await wait(m=>m.type==='welcome');return {ws,wait,welcome,states,events}; }
async function cmd(client,requestId,command,payload={},targetId) { client.ws.send(JSON.stringify({type:'command',requestId,command,payload,targetId}));return client.wait(m=>m.type==='result'&&m.requestId===requestId); }

test('real WebSocket auth, exact initial grant, host migration, replacement 4001, unknown token 4003',async t=>{
  const f=await fixture(t),a=await join(f),b=await join(f);const w=f.service.inspect();assert.equal(Object.keys(w.s.players).length,2);assert.equal(w.s.bank.credits,120);
  const closeA=once(a.ws,'close'),replacement=await join(f,a.welcome.token,'改名');const [code]=await closeA;assert.equal(code,4001);assert.equal(replacement.welcome.selfId,a.welcome.selfId);assert.equal(Object.keys(w.s.players).length,2);assert.equal(w.s.bank.credits,120);
  const bad=new WebSocket(f.url),wait=inbox(bad);f.clients.push(bad);await once(bad,'open');const closing=once(bad,'close');bad.send(JSON.stringify({type:'hello',name:'新名称',token:'x'.repeat(43)}));assert.equal((await wait(m=>m.type==='error')).code,'UNKNOWN_PROFILE');assert.equal((await closing)[0],4003);assert.equal(Object.keys(w.s.players).length,2);
  const close=once(replacement.ws,'close');replacement.ws.close();await close;for(let i=0;i<50&&w.s.hostId!==b.welcome.selfId;i++)await new Promise(resolve=>setTimeout(resolve,2));assert.equal(w.s.hostId,b.welcome.selfId);assert.equal((await cmd(b,1,'Settings',{friendlyFire:true})).ok,true);assert.equal(w.s.friendlyFire,true);
});
test('wire request replay/high watermark persisted and active-night late join grants only once',async t=>{
  const f=await fixture(t),a=await join(f);const w=f.service.inspect(),p=w.s.players[a.welcome.selfId];p.x=-3.5;p.y=5;p.z=-.5;
  assert((await cmd(a,1,'Buy',{definitionId:'ammo_light'})).ok);const credits=w.s.bank.credits;a.ws.send(JSON.stringify({type:'command',requestId:1,command:'Buy',payload:{definitionId:'ammo_light'}}));await new Promise(resolve=>setTimeout(resolve,10));assert.equal(w.s.bank.credits,credits);
  w.beginDayBarrier();w.finishDayBarrier();w.startNight();const b=await join(f);assert.equal(b.welcome.spectator,false);assert.equal(Object.keys(w.s.players).length,2);w.toPrep();await f.service.advance(.05);assert.equal(Object.keys(w.s.players).length,2);assert.equal(w.s.bank.credits,credits+60);
  for(let id=2;id<=258;id++)w.command(p,{requestId:id,command:'Ready',payload:{ready:true}});assert.equal(w.command(p,{requestId:1,command:'Buy',payload:{definitionId:'ammo_light'}}).code,'REQUEST_EXPIRED');await f.service.flushSave();const loaded=await new SnapshotStore(f.directory).load();assert.equal(loaded.players[p.id].requestHighWater,258);assert.equal(loaded.players[p.id].requestCache.length,256);
});
test('continuous world snapshot resumes phase/enemy health/equipment/drop/physics/RNG consistently; stop idempotent',async t=>{
  const f=await fixture(t),a=await join(f);const w=f.service.inspect(),p=w.s.players[a.welcome.selfId];w.beginDayBarrier();w.finishDayBarrier();w.s.enemies={};p.x=20;p.z=20;p.y=5;p.hp=47;w.equipped(p).magazineAmmo=3;const enemy=w.spawnEnemy('crab',75,-55);enemy.hp=13;enemy.state='STUNNED';enemy.phaseRemaining=123;
  const box=w.createContainer('loot',1,{x:20,y:5,z:20,createdDay:1,expiresAfterDay:3});w.createItem('treasure',2,box);await f.service.advance(2.2);const before=w.serialize();await Promise.all([f.service.stop(),f.service.stop()]);assert.equal(f.service.status().ready,false);
  const restart=await createSurvivalService({saveDir:f.directory,configPath,manualClock:true});const after=restart.inspect().s;
  assert.equal(after.phase,before.phase);assert.equal(after.phaseElapsed,before.phaseElapsed);assert.equal(after.enemies[enemy.id].hp,13);assert.equal(after.players[p.id].hp,47);assert.equal(after.items[w.equipped(p).id].magazineAmmo,3);assert.equal(after.containers[box.id].itemIds.length,1);assert.deepEqual(after.rng,before.rng);assert.equal(after.paused,true);assert.equal(Object.values(after.containers).filter(x=>x.type==='corpse').length,0);assert.equal(after.players[p.id].connected,false);await restart.stop();
});
test('two checked snapshots fallback preserves corrupt bytes, both corrupt refuse silently new world',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'tidal-save-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));const store=new SnapshotStore(directory);await store.load();await store.save({schema:3,worldId:'test',value:1});await store.save({schema:3,worldId:'test',value:2});
  const latest=path.join(directory,'snapshot-0.json');await writeFile(latest,'broken-current-snapshot');const fallback=new SnapshotStore(directory),loaded=await fallback.load();assert.equal(loaded.value,1);assert.equal(fallback.fallback,true);const corrupt=(await readdir(directory)).find(file=>file.includes('.corrupt-'));assert(corrupt);assert.equal(await readFile(path.join(directory,corrupt),'utf8'),'broken-current-snapshot');await fallback.save({schema:3,worldId:'test',value:3});assert.equal(await readFile(path.join(directory,corrupt),'utf8'),'broken-current-snapshot');
  await writeFile(path.join(directory,'snapshot-0.json'),'bad0');await writeFile(path.join(directory,'snapshot-1.json'),'bad1');await assert.rejects(new SnapshotStore(directory).load(),/Both world snapshots/);
});
test('failed disk write freezes shutdown without dropping connected inventory, failed PREP save does not enter DAY',async t=>{
  const f=await fixture(t),a=await join(f),w=f.service.inspect();const blocker=path.join(f.directory,'blocker');await writeFile(blocker,'not a directory');
  const failed=await createSurvivalService({saveDir:path.join(f.directory,'second'),configPath,manualClock:true});const p=failed.inspect().allocate('测试','not-a-wire-token');failed.inspect().beginDayBarrier();
  // Replace only the isolated save directory with a file to exercise real fs failure.
  await rm(path.join(f.directory,'second'),{recursive:true,force:true});await writeFile(path.join(f.directory,'second'),'not a directory');await failed.advance(.1);assert.equal(failed.inspect().s.phase,'PREP');assert.equal(failed.inspect().needsBarrier,true);await assert.rejects(failed.stop());assert.equal(failed.inspect().bag(p).itemIds.length,2);
  await rm(path.join(f.directory,'second'));await failed.stop();assert.equal(failed.status().ready,false);assert.equal(w.s.players[a.welcome.selfId].lifeState,'ALIVE');
});
test('malformed item references rejected before save creation and cross-origin upgrades rejected',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'tidal-config-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));const bad=await loadConfig(configPath);bad.weapons[0].ammo='missing';const file=path.join(directory,'bad.json');await writeFile(file,JSON.stringify(bad));await assert.rejects(createSurvivalService({saveDir:path.join(directory,'save'),configPath:file,manualClock:true}),/weapon references/);assert(!(await readdir(directory)).includes('save'));
  const f=await fixture(t);const ws=new WebSocket(f.url,{origin:'http://unrelated.example'});f.clients.push(ws);const code=await new Promise((resolve,reject)=>{ws.on('unexpected-response',(req,res)=>{resolve(res.statusCode);res.resume();ws.terminate();});ws.on('error',()=>{});setTimeout(()=>reject(Error('Origin check timeout')),1000).unref();});assert.equal(code,403);
});
test('save commits accepted pending shot and new adventure archives previous whole world',async t=>{
  const f=await fixture(t),a=await join(f),w=f.service.inspect(),p=w.s.players[a.welcome.selfId];p.x=20;p.y=5;p.z=10;w.s.destructibles={};const enemy=w.spawnEnemy('crab',20,0);enemy.state='STUNNED';enemy.phaseRemaining=100;
  assert((await cmd(a,1,'Fire',{yaw:0,pitch:-.1})).ok);assert.equal(enemy.hp,60);await f.service.flushSave();assert.equal(enemy.hp,40);const loaded=await new SnapshotStore(f.directory).load();assert.equal(loaded.enemies[enemy.id].hp,40);assert.equal(loaded.items[w.equipped(p).id].magazineAmmo,19);
  w.s.phase='COMPLETE';const before=w.s.worldId;assert.equal((await cmd(a,2,'NewAdventure',{confirm:false})).ok,false);assert.equal(w.s.worldId,before);assert((await cmd(a,3,'NewAdventure',{confirm:true})).ok);await f.service.advance(.05);const next=f.service.inspect();assert.notEqual(next.s.worldId,before);assert.equal(next.s.bank.credits,60);assert.equal(next.s.phase,'PREP');assert.equal(Object.keys(next.s.players).length,1);assert.equal(next.s.players[p.id].requestHighWater,3);
  const directories=await readdir(path.join(f.directory,'archives'));assert.equal(directories.length,1);assert(directories[0].startsWith(before));assert.equal((await readdir(path.join(f.directory,'archives',directories[0]))).filter(file=>file.startsWith('snapshot-')).length,2);
});
test('snapshot ACK opt-in bounds real 10Hz background backlog, ignores wrong ACK, then sends latest and reconnects',async t=>{
  const f=await fixture(t,{manualClock:false}),ack=await join(f,null,'确认客户端',{snapshotAck:true}),legacy=await join(f);
  const first=await ack.wait(m=>m.type==='state');assert.equal(ack.states.length,1);
  // Model a background tab that stops processing/ACKing for several seconds.
  await new Promise(resolve=>setTimeout(resolve,2200));assert.equal(ack.states.length,1);assert(legacy.states.length>=10);
  assert((await cmd(ack,1,'Settings',{friendlyFire:true})).ok);assert.equal(ack.states.length,1,'results remain independent of snapshot flow control');
  for(const snapshotId of [first.snapshotId+1,String(first.snapshotId),null])ack.ws.send(JSON.stringify({type:'snapshot_ack',snapshotId}));
  await new Promise(resolve=>setTimeout(resolve,250));assert.equal(ack.states.length,1);
  ack.ws.send(JSON.stringify({type:'snapshot_ack',snapshotId:first.snapshotId}));
  const latest=await ack.wait(m=>m.type==='state'&&m.snapshotId>first.snapshotId);assert(latest.serverTick>first.serverTick+30);assert.equal(latest.friendlyFire,true);assert.equal(ack.states.length,2);
  ack.ws.send(JSON.stringify({type:'snapshot_ack',snapshotId:first.snapshotId}));await new Promise(resolve=>setTimeout(resolve,250));assert.equal(ack.states.length,2,'stale ACK must not unlock the second state');
  const closed=once(ack.ws,'close'),replacement=await join(f,ack.welcome.token,'重连客户端',{snapshotAck:true});assert.equal((await closed)[0],4001);const resumed=await replacement.wait(m=>m.type==='state');assert.equal(replacement.welcome.selfId,ack.welcome.selfId);assert.equal(replacement.states.length,1);
  replacement.ws.send(JSON.stringify({type:'snapshot_ack',snapshotId:resumed.snapshotId}));await replacement.wait(m=>m.type==='state'&&m.snapshotId>resumed.snapshotId);assert.equal(replacement.states.length,2);
});
test('manual broadcasts and repeated welcome obey ACK window through new adventure and spectator promotion',async t=>{
  const f=await fixture(t),a=await join(f,null,'房主',{snapshotAck:true}),first=await a.wait(m=>m.type==='state'),w=f.service.inspect();
  for(let i=0;i<5;i++)await f.service.advance(.5);assert.equal(a.states.length,1);
  w.s.phase='COMPLETE';const oldWorld=w.s.worldId;assert((await cmd(a,1,'NewAdventure',{confirm:true})).ok);await f.service.advance(.05);await a.wait(m=>m.type==='welcome'&&m!==a.welcome);assert.equal(a.states.length,1,'new adventure welcome cannot enqueue another unacknowledged state');
  a.ws.send(JSON.stringify({type:'snapshot_ack',snapshotId:first.snapshotId}));assert((await cmd(a,2,'Ready',{ready:true})).ok);await f.service.advance(.05);const next=await a.wait(m=>m.type==='state'&&m.snapshotId>first.snapshotId);assert.notEqual(next.worldId,oldWorld);assert.equal(a.states.length,2);
  a.ws.send(JSON.stringify({type:'snapshot_ack',snapshotId:first.snapshotId}));assert((await cmd(a,3,'Ready',{ready:false})).ok);await f.service.advance(.05);assert.equal(a.states.length,2);
  const current=f.service.inspect();current.s.phase='COMPLETE';const spectator=await join(f,null,'结算观察者',{snapshotAck:true}),spectatorFirst=await spectator.wait(m=>m.type==='state');assert(spectator.welcome.spectator);
  spectator.ws.send(JSON.stringify({type:'snapshot_ack',snapshotId:spectatorFirst.snapshotId}));await new Promise(resolve=>setTimeout(resolve,10));await f.service.advance(.05);const spectatorNext=await spectator.wait(m=>m.type==='state'&&m.snapshotId>spectatorFirst.snapshotId);assert.equal(spectator.states.length,2,'spectators can ACK without a playerId');
  current.toPrep();await f.service.advance(.05);await spectator.wait(m=>m.type==='welcome'&&!m.spectator);assert.equal(spectator.states.length,2,'promotion welcome respects pending state');
  spectator.ws.send(JSON.stringify({type:'snapshot_ack',snapshotId:spectatorNext.snapshotId}));await new Promise(resolve=>setTimeout(resolve,10));await f.service.advance(.05);const promoted=await spectator.wait(m=>m.type==='state'&&m.snapshotId>spectatorNext.snapshotId);assert.equal(promoted.phase,'PREP');assert.equal(promoted.players.length,2);
});
test('ACK transport IDs remain distinct at an unchanged simulation tick',async t=>{
  const f=await fixture(t),a=await join(f,null,'暂停确认',{snapshotAck:true}),first=await a.wait(m=>m.type==='state');
  a.ws.send(JSON.stringify({type:'snapshot_ack',snapshotId:first.snapshotId}));assert((await cmd(a,1,'Ready',{ready:true})).ok);await f.service.advance(0);
  const second=await a.wait(m=>m.type==='state'&&m.snapshotId>first.snapshotId);assert.equal(second.serverTick,first.serverTick);assert.equal(second.players[0].ready,true);
  a.ws.send(JSON.stringify({type:'snapshot_ack',snapshotId:first.snapshotId}));assert((await cmd(a,2,'Ready',{ready:false})).ok);await f.service.advance(0);assert.equal(a.states.length,2);
  a.ws.send(JSON.stringify({type:'snapshot_ack',snapshotId:second.snapshotId}));assert((await cmd(a,3,'Ready',{ready:true})).ok);await f.service.advance(0);const third=await a.wait(m=>m.type==='state'&&m.snapshotId>second.snapshotId);assert.equal(third.serverTick,first.serverTick);assert.equal(a.states.length,3);
});
test('unacknowledged snapshot over one real second drops broadcast events but preserves replies and resumes fresh events',async t=>{
  const f=await fixture(t),a=await join(f,null,'后台确认',{snapshotAck:true}),legacy=await join(f),first=await a.wait(m=>m.type==='state'),w=f.service.inspect(),p=w.s.players[a.welcome.selfId];p.x=-3.5;p.y=5;p.z=-.5;
  assert((await cmd(a,1,'Buy',{definitionId:'ammo_light'})).ok);await a.wait(m=>m.type==='event'&&m.eventType==='TransactionResult'&&m.payload.definitionId==='ammo_light');
  const count=a.events.length;await new Promise(resolve=>setTimeout(resolve,1100));assert.equal(w.s.time,0,'staleness must use real time, not paused simulation time');
  assert((await cmd(a,2,'Buy',{definitionId:'ammo_shell'})).ok);await legacy.wait(m=>m.type==='event'&&m.eventType==='TransactionResult'&&m.payload.definitionId==='ammo_shell');assert.equal(a.events.length,count);assert.equal(a.states.length,1);
  assert((await cmd(a,3,'Save')).ok);assert.equal((await a.wait(m=>m.type==='event'&&m.eventType==='SaveResult')).payload.ok,true);
  a.ws.send('{');assert.equal((await a.wait(m=>m.type==='error')).code,'INVALID_TARGET');
  a.ws.send(JSON.stringify({type:'snapshot_ack',snapshotId:first.snapshotId}));assert((await cmd(a,4,'Ready',{ready:true})).ok);await f.service.advance(0);const latest=await a.wait(m=>m.type==='state'&&m.snapshotId>first.snapshotId);assert.equal(latest.bank.credits,84);assert(latest.items.some(item=>item.definitionId==='ammo_shell'&&item.quantity===8&&item.containerId===p.backpackId));
  assert((await cmd(a,5,'Buy',{definitionId:'bandage'})).ok);await a.wait(m=>m.type==='event'&&m.eventType==='TransactionResult'&&m.payload.definitionId==='bandage');assert(!a.events.some(m=>m.eventType==='TransactionResult'&&m.payload.definitionId==='ammo_shell'),'expired events must never replay after ACK');
});
