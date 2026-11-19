import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {createPlatformService} from '../service.mjs';

const wsPackagePath=new URL('../../package.json',import.meta.url);
const {WebSocket}=createRequire(wsPackagePath)('ws');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const state=(tick=1)=>({schema:3,worldId:'synthetic-test-world',tick,time:tick/30,phase:'DAY',players:{},items:{},containers:{storage:{id:'storage',slotLimit:80,itemIds:[]}},buildings:{core:{id:'core',hp:270}},bank:{credits:17,materials:23,reservedCredits:0,reservedMaterials:0}});

async function fixture(t,extra={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'tidal-platform-test-'));
  let clock=1000000,service=await createPlatformService({dataDir:directory,wsPackagePath,now:()=>clock,manualClock:true,...extra});
  const sockets=[];
  const server=createServer((req,res)=>void service.handleRequest(req,res).then(handled=>{if(!handled){res.statusCode=404;res.end();}}));
  server.on('upgrade',(req,socket,head)=>{if(!service.handleUpgrade(req,socket,head))socket.destroy();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  async function api(method,route,body,account,headers={}){
    const data=body===undefined?'':JSON.stringify(body);
    return await new Promise((resolve,reject)=>{
      const req=httpRequest(`${origin}/api/platform${route}`,{method,headers:{Origin:origin,...(account?.cookie?{Cookie:account.cookie}:{}),...(data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{}),...headers}},res=>{
        let raw='';res.setEncoding('utf8');res.on('data',chunk=>raw+=chunk);res.on('end',()=>{let body;try{body=JSON.parse(raw);}catch{return reject(Error(`Unexpected response status ${res.statusCode}`));}resolve({status:res.statusCode,body,cookie:res.headers['set-cookie']?.[0]??null});});
      });req.on('error',reject);req.end(data);
    });
  }
  async function register(number){const username=`synthetic${number}`,password=randomBytes(24).toString('base64url'),r=await api('POST','/register',{username,password,name:`测试队员${number}`});assert.equal(r.status,201);return {...r.body.account,username,password,cookie:r.cookie.split(';')[0],cookieFlags:r.cookie};}
  async function login(account){const r=await api('POST','/login',{username:account.username,password:account.password});assert.equal(r.status,200);account.cookie=r.cookie.split(';')[0];return account;}
  async function connect(account,headers={}){
    const ws=new WebSocket(origin.replace('http:','ws:')+'/platform/signal',{headers:{Origin:origin,Cookie:account.cookie,...headers}}),messages=[];
    sockets.push(ws);ws.on('error',()=>{});ws.on('message',raw=>messages.push(JSON.parse(raw)));
    let closeCode=null;ws.on('close',code=>closeCode=code);
    const peer={ws,messages,get closeCode(){return closeCode;},send:value=>ws.send(JSON.stringify(value)),async wait(predicate,start=0){const end=Date.now()+3000;while(Date.now()<end){const found=messages.slice(start).find(predicate);if(found)return found;if(closeCode!==null)throw Error(`Socket closed ${closeCode}`);await delay(5);}throw Error('Expected WebSocket message not received');}};
    peer.self=(await peer.wait(m=>m.type==='session')).self;return peer;
  }
  async function adventure(account,title='隔离冒险'){const r=await api('POST','/adventures',{title},account);assert.equal(r.status,201);return r.body.adventure;}
  async function room(account,adventureId,solo=false){const r=await api('POST','/rooms',{adventureId,solo},account);assert.equal(r.status,201);return r.body.room;}
  async function ready(peer,value=true){const n=peer.messages.length;peer.send({type:'ready',ready:value});await peer.wait(m=>m.type==='room'&&m.room?.members.find(x=>x.peerId===peer.self.peerId)?.ready===value,n);}
  async function start(account,r){const result=await api('POST',`/rooms/${r.id}/start`,{},account);assert.equal(result.status,200);return result.body.room;}
  async function save(account,r,value=state(),baseRevision=0,saveSeq=1){return api('PUT',`/adventures/${r.adventureId}/snapshot`,{roomId:r.id,hostEpoch:r.epoch,baseRevision,saveSeq,state:value},account);}
  async function until(predicate){const end=Date.now()+3000;while(Date.now()<end){if(await predicate())return;await delay(5);}throw Error('Expected condition not reached');}
  t.after(async()=>{for(const ws of sockets)ws.terminate();await service.stop();await new Promise(resolve=>server.close(resolve));const resolved=path.resolve(directory);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('tidal-platform-test-'));await fs.rm(resolved,{recursive:true,force:true});});
  return {directory,origin,api,register,login,connect,adventure,room,ready,start,save,until,get service(){return service;},advance:ms=>clock+=ms,async restart(){await service.stop();service=await createPlatformService({dataDir:directory,wsPackagePath,now:()=>clock,manualClock:true,...extra});}};
}

test('registration, session cookie, auth and same-origin mutations keep secrets out of responses',async t=>{
  const f=await fixture(t),a=await f.register(1);
  assert.ok(a.cookieFlags.includes('HttpOnly')&&a.cookieFlags.includes('SameSite=Strict'));
  assert.equal((await f.api('GET','/me')).status,401);
  const me=await f.api('GET','/me',undefined,a);assert.equal(me.body.account.id,a.id);assert.deepEqual(Object.keys(me.body.account).sort(),['id','name','onboarding','training','username']);
  // The only new public account metadata is the owner's learning checkpoint.
  assert.deepEqual(me.body.account.onboarding,{version:2,status:'pending',step:0,revision:0,checks:[]});
  assert.equal((await f.api('POST','/adventures',{title:'denied'},a,{Origin:'http://other.invalid'})).status,403);
  assert.equal((await f.api('POST','/adventures',{},a,{Origin:''})).status,403);
  assert.equal((await f.api('POST','/login',{username:a.username,password:'wrong-password'})).status,401);
  assert.equal((await f.api('POST','/register',{username:a.username.toUpperCase(),password:'other-password'})).body.error.code,'USERNAME_TAKEN');
  const files=await fs.readdir(path.join(f.directory,'index'));let safe=true;for(const file of files){const raw=await fs.readFile(path.join(f.directory,'index',file),'utf8');safe&&=!raw.includes(a.password)&&!raw.includes(a.cookie.split('=')[1]);}assert.ok(safe,'plaintext credentials must not be persisted');
  assert.equal((await f.api('POST','/logout',{},a)).status,200);assert.equal((await f.api('GET','/me',undefined,a)).status,401);
});

test('WS upgrade requires both authenticated cookie and exact origin',async t=>{
  const f=await fixture(t),a=await f.register(1);
  async function rejected(headers,expected){await new Promise((resolve,reject)=>{const ws=new WebSocket(f.origin.replace('http:','ws:')+'/platform/signal',{headers});ws.on('unexpected-response',(_req,res)=>{res.resume();try{assert.equal(res.statusCode,expected);resolve();}catch(e){reject(e);}});ws.on('error',()=>{});ws.on('open',()=>{ws.terminate();reject(Error('Unauthenticated upgrade accepted'));});});}
  await rejected({Origin:f.origin},401);await rejected({Origin:'http://other.invalid',Cookie:a.cookie},403);
  const peer=await f.connect(a);assert.equal(peer.self.accountId,a.id);assert.deepEqual(Object.keys(peer.self).sort(),['accountId','name','peerId']);
});

test('room start needs all ready, running late join is immediate, historical members do not use 8 online slots',async t=>{
  const f=await fixture(t),accounts=[],peers=[];for(let i=1;i<=9;i++){accounts.push(await f.register(i));peers.push(await f.connect(accounts.at(-1)));}
  const a=await f.adventure(accounts[0]),r=await f.room(accounts[0],a.id);
  assert.equal((await f.api('POST',`/rooms/${r.id}/start`,{},accounts[0])).body.error.code,'NOT_READY');
  await f.ready(peers[0]);await f.start(accounts[0],r);
  for(let i=1;i<8;i++){const joined=await f.api('POST',`/rooms/${r.id}/join`,{},accounts[i]);assert.equal(joined.status,200);assert.equal(joined.body.room.status,'running');assert.equal(joined.body.room.members.at(-1).ready,true);}
  assert.equal((await f.api('POST',`/rooms/${r.id}/join`,{},accounts[8])).body.error.code,'ROOM_FULL');
  assert.equal((await f.api('POST',`/rooms/${r.id}/leave`,{},accounts[1])).status,200);
  const ninth=await f.api('POST',`/rooms/${r.id}/join`,{},accounts[8]);assert.equal(ninth.status,200);assert.equal(ninth.body.room.members.length,8);
  assert.equal((await f.api('GET','/adventures',undefined,accounts[1])).body.adventures.length,1);
  assert.equal((await f.api('POST','/rooms',{adventureId:a.id},accounts[1])).body.error.code,'ADVENTURE_ACTIVE');
  assert.equal((await f.api('POST',`/rooms/${r.id}/close`,{},accounts[8])).body.error.code,'HOST_REQUIRED');
});

test('solo stays out of lobby, independent adventures retain owner scope',async t=>{
  const f=await fixture(t),a=await f.register(1),b=await f.register(2);await f.connect(a);await f.connect(b);
  const adventure=await f.adventure(a),other=await f.adventure(a,'第二进度'),r=await f.room(a,adventure.id,true);
  assert.equal((await f.api('GET','/rooms',undefined,b)).body.rooms.length,0);
  assert.equal((await f.api('POST',`/rooms/${r.id}/join`,{},b)).body.error.code,'SOLO_ROOM');
  assert.equal((await f.api('GET','/adventures',undefined,b)).body.adventures.length,0);
  assert.equal((await f.api('POST','/rooms',{adventureId:other.id},a)).body.error.code,'ALREADY_IN_ROOM');
  assert.equal((await f.api('GET',`/adventures/${adventure.id}/snapshot`,undefined,b)).body.error.code,'HOST_REQUIRED');
});

test('mission rooms are temporary, bypass adventure slots and only training rooms can complete onboarding',async t=>{
  const f=await fixture(t),a=await f.register(1),b=await f.register(2);const owner=await f.connect(a);await f.connect(b);
  assert.deepEqual(a.training,{version:1,status:'pending'});
  assert.equal((await f.api('POST','/training',{action:'complete'},a)).body.error.code,'TRAINING_ROOM_REQUIRED');
  assert.deepEqual((await f.api('POST','/training',{action:'skip'},a)).body.training,{version:1,status:'skipped'});
  const created=await f.api('POST','/rooms',{mode:'mission',solo:true,missionStart:'tutorial'},a);
  assert.equal(created.status,201);const room=created.body.room;
  assert.equal(room.mode,'mission');assert.equal(room.adventureId,null);
  assert.equal((await f.api('GET','/adventures',undefined,a)).body.capacity.progressUsed,0);
  assert.equal((await f.api('GET','/rooms',undefined,b)).body.rooms.length,0);
  assert.equal((await f.api('POST',`/rooms/${room.id}/join`,{},b)).body.error.code,'SOLO_ROOM');
  assert.equal((await f.api('POST','/training',{action:'complete'},a)).body.error.code,'TRAINING_ROOM_REQUIRED');
  await f.ready(owner);await f.start(a,room);
  assert.equal((await f.api('POST',`/rooms/${room.id}/gm/verify`,{},a)).body.error.code,'NOT_AVAILABLE');
  assert.deepEqual((await f.api('POST','/training',{action:'complete'},a)).body.training,{version:1,status:'done'});
  assert.deepEqual((await f.api('POST','/training',{action:'skip'},a)).body.training,{version:1,status:'done'});
  assert.equal((await f.api('POST',`/rooms/${room.id}/close`,{},a)).status,200);
  assert.equal((await f.api('GET','/rooms',undefined,a)).body.rooms.length,0);
  await f.restart();await f.login(a);
  assert.deepEqual((await f.api('GET','/me',undefined,a)).body.account.training,{version:1,status:'done'});
  assert.deepEqual((await f.api('GET','/adventures',undefined,a)).body.adventures,[]);
});

test('free practice supports waiting and running joins without granting training completion or adventure progress',async t=>{
  const f=await fixture(t),a=await f.register(1),b=await f.register(2),c=await f.register(3);
  const host=await f.connect(a),guest=await f.connect(b);await f.connect(c);
  for(let n=1;n<=5;n++)await f.adventure(c,`已有冒险${n}`);
  assert.equal((await f.api('GET','/adventures',undefined,c)).body.capacity.progressUsed,5);
  assert.equal((await f.api('POST','/rooms',{mode:'mission',missionStart:'tutorial',solo:false},a)).body.error.code,'INVALID_MISSION');
  const created=await f.api('POST','/rooms',{mode:'mission',missionStart:'free',solo:false},a);
  assert.equal(created.status,201);const room=created.body.room;
  assert.equal(room.solo,false);assert.equal(room.adventureId,null);
  assert.equal((await f.api('GET','/rooms',undefined,b)).body.rooms[0].id,room.id);
  assert.equal((await f.api('POST',`/rooms/${room.id}/join`,{},b)).status,200);
  assert.equal((await f.api('POST',`/rooms/${room.id}/start`,{},a)).body.error.code,'NOT_READY');
  await f.ready(host);await f.ready(guest);await f.start(a,room);
  const late=await f.api('POST',`/rooms/${room.id}/join`,{},c);
  assert.equal(late.status,200);assert.equal(late.body.room.status,'running');assert.equal(late.body.room.members.at(-1).ready,true);
  assert.equal((await f.api('POST','/training',{action:'complete'},a)).body.error.code,'TRAINING_ROOM_REQUIRED');
  for(const account of [a,b]){
    assert.equal((await f.api('GET','/adventures',undefined,account)).body.capacity.progressUsed,0);
    assert.deepEqual((await f.api('GET','/adventures',undefined,account)).body.adventures,[]);
  }
  assert.equal((await f.api('GET','/adventures',undefined,c)).body.capacity.progressUsed,5);
  assert.equal((await f.api('POST',`/rooms/${room.id}/close`,{},a)).status,200);
  assert.equal((await f.api('GET','/rooms',undefined,b)).body.rooms.length,0);
});

test('signaling and chat derive sender identity, forbid cross-room and guest-to-guest routes',async t=>{
  const f=await fixture(t),accounts=[],peers=[];for(let i=1;i<=4;i++){accounts.push(await f.register(i));peers.push(await f.connect(accounts.at(-1)));}
  const r=await f.room(accounts[0],(await f.adventure(accounts[0])).id);
  for(const a of accounts.slice(1,3))assert.equal((await f.api('POST',`/rooms/${r.id}/join`,{},a)).status,200);
  await f.room(accounts[3],(await f.adventure(accounts[3])).id);
  let mark=peers[0].messages.length;peers[1].send({type:'signal',to:peers[0].self.peerId,from:'spoof',roomId:'spoof',data:{description:{type:'offer',sdp:'synthetic'}}});
  const signal=await peers[0].wait(m=>m.type==='signal',mark);assert.equal(signal.from,peers[1].self.peerId);assert.equal(signal.roomId,r.id);assert.equal(signal.epoch,r.epoch);
  mark=peers[1].messages.length;peers[1].send({type:'signal',to:peers[2].self.peerId,data:{candidate:null}});assert.equal((await peers[1].wait(m=>m.type==='error',mark)).code,'INVALID_TOPOLOGY');
  mark=peers[1].messages.length;peers[1].send({type:'signal',to:peers[3].self.peerId,data:{candidate:null}});assert.equal((await peers[1].wait(m=>m.type==='error',mark)).code,'NOT_MEMBER');
  mark=peers[0].messages.length;peers[1].send({type:'chat',text:' 合作守夜\u0000 ',from:{accountId:accounts[0].id,name:'spoof'}});
  const chat=await peers[0].wait(m=>m.type==='chat',mark);assert.equal(chat.message.from.accountId,accounts[1].id);assert.equal(chat.message.text,'合作守夜');assert.equal(peers[3].messages.some(m=>m.type==='chat'),false);
});

test('whole-state save ACK is durable, revision and sequence fence retries and reject invalid item ownership',async t=>{
  const f=await fixture(t),a=await f.register(1),peer=await f.connect(a),r=await f.room(a,(await f.adventure(a)).id);await f.ready(peer);await f.start(a,r);
  assert.equal((await f.api('GET',`/adventures/${r.adventureId}/snapshot`,undefined,a)).body.state,null);
  const one=await f.save(a,r);assert.deepEqual(one.body,{saved:true,revision:1,saveSeq:1,memberResets:[],memberResetVersion:0});
  assert.deepEqual((await f.save(a,r)).body,one.body);
  assert.equal((await f.save(a,r,state(2),0,1)).body.error.code,'SAVE_REPLAY_MISMATCH');
  assert.equal((await f.save(a,r,state(2),0,2)).body.error.code,'REVISION_CONFLICT');
  const broken=state(2);broken.items.orphan={id:'orphan',quantity:1,containerId:'storage'};
  assert.equal((await f.save(a,r,broken,1,2)).body.error.code,'INVALID_SNAPSHOT');
  const duplicate=state(2);duplicate.items.thing={id:'thing',quantity:1,containerId:'storage'};duplicate.containers.storage.itemIds=['thing','thing'];assert.equal((await f.save(a,r,duplicate,1,2)).body.error.code,'INVALID_SNAPSHOT');
  const full=state(2);full.items.thing={id:'thing',definitionId:'scrap',quantity:2,containerId:'storage'};full.containers.storage.itemIds=['thing'];full.players.p={id:'p',connected:false,equipment:{weapon:null}};
  full.dayIndex=7;full.statistics={daysSurvived:4};
  assert.equal((await f.save(a,r,full,1,2)).body.revision,2);
  assert.equal((await f.save(a,r,state(1),2,3)).body.error.code,'WORLD_REWIND');
  const received=await f.api('GET',`/adventures/${r.adventureId}/snapshot`,undefined,a);assert.deepEqual(received.body.state,full);assert.equal(received.body.revision,2);
  const summary=(await f.api('GET','/adventures',undefined,a)).body.adventures[0];assert.equal(summary.dayIndex,7);assert.equal(summary.phase,'DAY');assert.equal(summary.daysSurvived,4);
  const snapshotFiles=await fs.readdir(path.join(f.directory,'adventures',r.adventureId));assert.equal(snapshotFiles.filter(x=>/^snapshot-[01]\.json$/.test(x)).length,2);
  assert.equal((await f.api('POST',`/rooms/${r.id}/close`,{finalRevision:1},a)).body.error.code,'REVISION_CONFLICT');
  assert.deepEqual((await f.api('POST',`/rooms/${r.id}/close`,{finalRevision:2},a)).body,{closed:true,revision:2});
});

test('host disconnect transfers the same adventure; restart restores the confirmed world',async t=>{
 const f=await fixture(t),a=await f.register(1),b=await f.register(2),host=await f.connect(a),guest=await f.connect(b),adventure=await f.adventure(a),r=await f.room(a,adventure.id);
 await f.api('POST',`/rooms/${r.id}/join`,{},b);assert.equal((await f.save(a,r,state(75))).status,200);
 const mark=guest.messages.length;host.ws.terminate();const next=(await guest.wait(m=>m.type==='room'&&m.room?.status==='migrating',mark)).room;
 assert.equal(next.id,r.id);assert.equal(next.ownerId,a.id);assert.equal(next.hostPeerId,guest.self.peerId);assert.ok(next.epoch>r.epoch);
 const resumed=await f.api('GET',`/adventures/${adventure.id}/snapshot`,undefined,b);assert.deepEqual(resumed.body.state,state(75));
 const activated=await f.api('POST',`/rooms/${r.id}/activate`,{epoch:next.epoch,revision:1,worldId:state().worldId,economyEpoch:0},b);assert.equal(activated.status,200);
 await f.connect(a);assert.equal((await f.save(a,r,state(76),1,2)).body.error.code,'HOST_REQUIRED');
 await f.restart();await f.login(a);await f.connect(a);const third=await f.room(a,adventure.id);assert.ok(third.epoch>next.epoch);assert.ok(third.hostGeneration>0);
 const after=await f.api('GET',`/adventures/${adventure.id}/snapshot`,undefined,a);assert.equal(after.body.revision,1);assert.deepEqual(after.body.state,state(75));
});

test('same-account replacement closes old authority and old cookie cannot operate replacement connection',async t=>{
  const f=await fixture(t),a=await f.register(1),original=await f.connect(a),r=await f.room(a,(await f.adventure(a)).id),oldCookie=a.cookie;
  await f.login(a);const replacement=await f.connect(a);await f.until(()=>original.closeCode===4001);assert.notEqual(original.self.peerId,replacement.self.peerId);assert.equal(f.service.status().rooms,0);
  assert.equal((await f.api('POST','/rooms',{adventureId:r.adventureId},{...a,cookie:oldCookie})).body.error.code,'SIGNAL_REQUIRED');
  const next=await f.room(a,r.adventureId);assert.ok(next.epoch>r.epoch);await delay(20);assert.equal(f.service.status().online,1);assert.equal(f.service.status().rooms,1);
});

test('application lease expires despite live socket pong and late heartbeat cannot revive stale authority',async t=>{
  const f=await fixture(t),a=await f.register(1),peer=await f.connect(a),adventure=await f.adventure(a),r=await f.room(a,adventure.id);await f.ready(peer);await f.start(a,r);
  f.advance(10000);await f.service.sweep();await delay(10);assert.equal(peer.ws.readyState,WebSocket.OPEN);
  f.advance(10001);let mark=peer.messages.length;peer.send({type:'heartbeat',roomId:r.id,epoch:r.epoch});assert.equal((await peer.wait(m=>m.type==='error',mark)).code,'LEASE_EXPIRED');assert.equal(f.service.status().rooms,0);
  const next=await f.room(a,adventure.id);await f.ready(peer);await f.start(a,next);f.advance(19000);peer.send({type:'heartbeat',roomId:next.id,epoch:next.epoch});await delay(15);f.advance(19000);await f.service.sweep();assert.equal(f.service.status().rooms,1);
  f.advance(1001);await f.service.sweep();assert.equal(f.service.status().rooms,0);
});

test('central expiry revokes signaling and host room, guest departure releases membership immediately',async t=>{
  const f=await fixture(t,{sessionMs:60000}),a=await f.register(1),b=await f.register(2),host=await f.connect(a),guest=await f.connect(b),r=await f.room(a,(await f.adventure(a)).id);await f.api('POST',`/rooms/${r.id}/join`,{},b);
  guest.ws.terminate();await f.until(async()=>(await f.api('GET','/rooms',undefined,a)).body.rooms[0].members.length===1);
  f.advance(60001);await f.service.sweep();await f.until(()=>host.closeCode===4003);assert.equal(f.service.status().rooms,0);assert.equal((await f.api('GET','/me',undefined,a)).status,401);
});

test('checked snapshot fallback restores prior complete revision and never silently creates empty adventure',async t=>{
  const f=await fixture(t),a=await f.register(1);await f.connect(a);const r=await f.room(a,(await f.adventure(a)).id);await f.save(a,r,state(1));await f.save(a,r,state(2),1,2);await f.service.stop();
  const savePath=path.join(f.directory,'adventures',r.adventureId);await fs.writeFile(path.join(savePath,'snapshot-0.json'),'synthetic interrupted data');
  await f.restart();await f.login(a);await f.connect(a);await f.room(a,r.adventureId);const back=await f.api('GET',`/adventures/${r.adventureId}/snapshot`,undefined,a);assert.equal(back.body.revision,1);assert.deepEqual(back.body.state,state(1));assert.ok((await fs.readdir(savePath)).some(x=>x.includes('.corrupt-')));
  await f.service.stop();await fs.writeFile(path.join(savePath,'snapshot-1.json'),'synthetic second interrupted data');await assert.rejects(()=>createPlatformService({dataDir:f.directory,wsPackagePath,manualClock:true}),/snapshots invalid/);
});

test('failed disk write never acknowledges or changes confirmed state; identical retry succeeds after repair',async t=>{
  const f=await fixture(t),a=await f.register(1);await f.connect(a);const r=await f.room(a,(await f.adventure(a)).id);assert.equal((await f.save(a,r,state(1))).status,200);
  const blocker=path.join(f.directory,'adventures',r.adventureId,'snapshot-0.json.tmp');await fs.mkdir(blocker);
  const failed=await f.save(a,r,state(2),1,2);assert.equal(failed.status,503);assert.equal(failed.body.error.code,'STORAGE_PATH');assert.equal(failed.body.saved,undefined);
  const confirmed=await f.api('GET',`/adventures/${r.adventureId}/snapshot`,undefined,a);assert.equal(confirmed.body.revision,1);assert.deepEqual(confirmed.body.state,state(1));
  await fs.rmdir(blocker);assert.equal((await f.save(a,r,state(2),1,2)).body.revision,2);
});

test('concurrent saves serialize against one baseline; stale older retry never rewinds confirmed progress',async t=>{
  const f=await fixture(t),a=await f.register(1);await f.connect(a);const r=await f.room(a,(await f.adventure(a)).id);await f.save(a,r,state(1));
  const attempts=await Promise.all([f.save(a,r,state(2),1,2),f.save(a,r,state(3),1,3)]);assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]);
  assert.equal((await f.save(a,r,state(4),2,4)).body.revision,3);
  const replay=await f.save(a,r,state(2),1,2);assert.equal(replay.status,409);
  const confirmed=await f.api('GET',`/adventures/${r.adventureId}/snapshot`,undefined,a);assert.equal(confirmed.body.revision,3);assert.deepEqual(confirmed.body.state,state(4));
});

test('stop is idempotent and refuses every later state mutation',async t=>{
  const f=await fixture(t),a=await f.register(1);await f.connect(a);const r=await f.room(a,(await f.adventure(a)).id);await f.save(a,r,state(1));
  await Promise.all([f.service.stop(),f.service.stop()]);assert.equal(f.service.status().ready,false);assert.equal(f.service.status().rooms,0);
  assert.equal((await f.save(a,r,state(2),1,2)).status,503);assert.equal((await f.api('POST','/adventures',{title:'after stop'},a)).status,503);
});

test('Worker HTTP heartbeat renews only the current owner epoch and cannot revive an expired room',async t=>{
  const f=await fixture(t),owner=await f.register(1),guest=await f.register(2),p=await f.connect(owner);await f.connect(guest);
  const r=await f.room(owner,(await f.adventure(owner)).id);await f.ready(p);await f.start(owner,r);
  assert.equal((await f.api('POST',`/rooms/${r.id}/heartbeat`,{epoch:r.epoch},guest)).status,403);
  assert.equal((await f.api('POST',`/rooms/${r.id}/heartbeat`,{epoch:r.epoch+1},owner)).body.error.code,'STALE_HOST');
  for(let i=0;i<3;i++){f.advance(19000);assert.equal((await f.api('POST',`/rooms/${r.id}/heartbeat`,{epoch:r.epoch},owner)).status,200);await f.service.sweep();assert.equal(f.service.status().rooms,1);}
  f.advance(20001);assert.equal((await f.api('POST',`/rooms/${r.id}/heartbeat`,{epoch:r.epoch},owner)).body.error.code,'LEASE_EXPIRED');assert.equal(f.service.status().rooms,0);
});

test('chat preserves Chinese punctuation and fullwidth typed text',async t=>{
  const f=await fixture(t),a=await f.register(1),p=await f.connect(a);await f.room(a,(await f.adventure(a)).id);
  const body='一起回营，准备守夜！１２３';p.send({type:'chat',text:body});assert.equal((await p.wait(m=>m.type==='chat')).message.text,body);
});

test('handoff is idempotent, rejects stale signals and can move through multiple hosts',async t=>{
 const f=await fixture(t),accounts=[],peers=[];for(let i=0;i<3;i++){accounts.push(await f.register(i+1));peers.push(await f.connect(accounts[i]));}
 const r=await f.room(accounts[0],(await f.adventure(accounts[0])).id);
 for(let i=1;i<3;i++)await f.api('POST',`/rooms/${r.id}/join`,{},accounts[i]);
 await f.save(accounts[0],r,state(90));
 const body={epoch:r.epoch,finalRevision:1},route=`/rooms/${r.id}/handoff`;
 assert.equal((await f.api('POST',route,body,accounts[0])).status,200);
 const next=(await f.api('GET','/rooms',undefined,accounts[1])).body.rooms[0];
 assert.equal(next.hostPeerId,peers[1].self.peerId);assert.equal(next.members.length,2);
 assert.equal((await f.api('POST',route,body,accounts[0])).status,200);
 assert.equal((await f.api('GET','/rooms',undefined,accounts[1])).body.rooms[0].epoch,next.epoch);
 assert.equal((await f.api('POST',route,{...body,finalRevision:2},accounts[0])).body.error.code,'SAVE_REPLAY_MISMATCH');
 const at=peers[2].messages.length;peers[2].send({type:'signal',roomId:r.id,epoch:r.epoch,to:peers[1].self.peerId,data:{probe:true}});
 await peers[2].wait(m=>m.type==='error'&&m.code==='STALE_HOST',at);
 await f.api('POST',`/rooms/${r.id}/decline`,{epoch:next.epoch},accounts[1]);
 const third=(await f.api('GET','/rooms',undefined,accounts[2])).body.rooms[0];assert.equal(third.hostPeerId,peers[2].self.peerId);
 const load=await f.api('GET',`/adventures/${r.adventureId}/snapshot`,undefined,accounts[2]);assert.deepEqual(load.body.state,state(90));
 assert.equal((await f.api('POST',`/rooms/${r.id}/activate`,{epoch:third.epoch,revision:1,worldId:state().worldId,economyEpoch:0},accounts[2])).status,200);
 assert.equal((await f.api('POST',`/rooms/${r.id}/close`,{epoch:next.epoch},accounts[2])).body.error.code,'STALE_HOST');
});
test('candidate loading a stale checkpoint rotates authority before any simulation starts',async t=>{
 const f=await fixture(t),a=await f.register(1),b=await f.register(2);await f.connect(a);await f.connect(b);
 const r=await f.room(a,(await f.adventure(a)).id);await f.api('POST',`/rooms/${r.id}/join`,{},b);await f.save(a,r,state(60));
 await f.api('POST',`/rooms/${r.id}/handoff`,{epoch:r.epoch,finalRevision:1},a);
 const next=(await f.api('GET','/rooms',undefined,b)).body.rooms[0];
 const retry=await f.api('POST',`/rooms/${r.id}/activate`,{epoch:next.epoch,revision:0,worldId:null,economyEpoch:0},b);
 assert.equal(retry.body.retry,true);assert.equal(retry.body.room.status,'migrating');assert.ok(retry.body.room.epoch>next.epoch);
});
test('practice checkpoints have ordered idempotent saves and migrate without account snapshots',async t=>{
 const f=await fixture(t),a=await f.register(1),b=await f.register(2);await f.connect(a);const guest=await f.connect(b);
 const r=(await f.api('POST','/rooms',{mode:'mission',missionStart:'free',solo:false},a)).body.room;
 await f.api('POST',`/rooms/${r.id}/join`,{},b);
 const route=`/rooms/${r.id}/checkpoint`,body={epoch:r.epoch,baseRevision:0,saveSeq:1,state:state(30)};
 assert.equal((await f.api('PUT',route,body,a)).body.revision,1);assert.equal((await f.api('PUT',route,body,a)).body.revision,1);
 assert.equal((await f.api('PUT',route,{...body,state:state(31)},a)).body.error.code,'SAVE_REPLAY_MISMATCH');
 await f.api('POST',`/rooms/${r.id}/handoff`,{epoch:r.epoch,finalRevision:1},a);
 const next=(await f.api('GET','/rooms',undefined,b)).body.rooms[0];assert.equal(next.hostPeerId,guest.self.peerId);
 assert.deepEqual((await f.api('GET',route,undefined,b)).body.state,state(30));assert.equal((await f.api('GET','/adventures',undefined,b)).body.adventures.length,0);
});

test('existing members can resume one shared adventure, but cannot own-delete it or reserve it as solo',async t=>{
 const f=await fixture(t),owner=await f.register(1),a=await f.register(2),b=await f.register(3);for(const user of [owner,a,b])await f.connect(user);
 const r=await f.room(owner,(await f.adventure(owner)).id);for(const user of [a,b])await f.api('POST',`/rooms/${r.id}/join`,{},user);
 await f.save(owner,r,state(300));for(const user of [a,b])await f.api('POST',`/rooms/${r.id}/leave`,{},user);await f.api('POST',`/rooms/${r.id}/close`,{finalRevision:1},owner);
 assert.equal((await f.api('POST','/rooms',{adventureId:r.adventureId,solo:true},a)).body.error.code,'SHARED_ROOM_REQUIRED');
 const attempts=await Promise.all([a,b].map(user=>f.api('POST','/rooms',{adventureId:r.adventureId},user)));assert.deepEqual(attempts.map(x=>x.status).sort(),[201,409]);
 const ix=attempts.findIndex(x=>x.status===201),host=[a,b][ix],newRoom=attempts[ix].body.room;
 assert.equal(newRoom.ownerId,owner.id);assert.equal(newRoom.adventureId,r.adventureId);assert.equal(newRoom.hostGeneration,1);
 assert.deepEqual((await f.api('GET',`/adventures/${r.adventureId}/snapshot`,undefined,host)).body.state,state(300));
 assert.equal((await f.api('DELETE',`/adventures/${r.adventureId}`,undefined,host)).body.error.code,'LEAVE_FIRST');
 await f.api('POST',`/rooms/${newRoom.id}/close`,{epoch:newRoom.epoch,finalRevision:1},host);
 assert.equal((await f.api('DELETE',`/adventures/${r.adventureId}`,undefined,a)).body.scope,'personal');
 assert.equal((await f.api('POST','/rooms',{adventureId:r.adventureId},a)).status,403);
 assert.equal((await f.api('GET','/adventures',undefined,owner)).body.adventures[0].id,r.adventureId);
});

