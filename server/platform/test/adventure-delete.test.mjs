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
        let raw='';res.setEncoding('utf8');res.on('data',chunk=>raw+=chunk);res.on('end',()=>{let body;try{body=JSON.parse(raw);}catch{if(res.statusCode!==404||raw!=='')return reject(Error(`Unexpected response status ${res.statusCode}`));body=null;}resolve({status:res.statusCode,body,cookie:res.headers['set-cookie']?.[0]??null});});
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

test('only owner can delete a paused adventure; auth, origin, unknown IDs and repeat delete are explicit',async t=>{
  const f=await fixture(t),owner=await f.register(1),guest=await f.register(2),a=await f.adventure(owner);
  assert.equal((await f.api('DELETE',`/adventures/${a.id}`)).status,401);
  assert.equal((await f.api('DELETE',`/adventures/${a.id}`,undefined,owner,{Origin:'http://other.invalid'})).status,403);
  assert.equal((await f.api('DELETE',`/adventures/${a.id}`,undefined,guest)).body.error.code,'OWNER_REQUIRED');
  assert.equal((await f.api('DELETE','/adventures/../../outside',undefined,owner)).status,404);
  assert.equal((await f.api('DELETE','/adventures/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',undefined,owner)).status,404);
  const removed=await f.api('DELETE',`/adventures/${a.id}`,undefined,owner);
  assert.equal(removed.status,200);assert.deepEqual(removed.body,{deleted:true,id:a.id});
  assert.equal((await f.api('DELETE',`/adventures/${a.id}`,undefined,owner)).status,404);
  assert.deepEqual((await f.api('GET','/adventures',undefined,owner)).body.adventures,[]);
});

test('waiting and running rooms block owner delete while guests cannot delete either',async t=>{
  const f=await fixture(t),owner=await f.register(1),guest=await f.register(2),p=await f.connect(owner);await f.connect(guest);
  const a=await f.adventure(owner),r=await f.room(owner,a.id);
  for(const running of [false,true]){
    if(running){await f.ready(p);await f.start(owner,r);}
    const blocked=await f.api('DELETE',`/adventures/${a.id}`,undefined,owner);
    assert.equal(blocked.status,409);assert.equal(blocked.body.error.code,'ADVENTURE_ACTIVE');
    assert.equal((await f.api('DELETE',`/adventures/${a.id}`,undefined,guest)).status,403);
  }
  assert.equal((await f.api('POST',`/rooms/${r.id}/close`,{},owner)).status,200);
  assert.equal((await f.api('DELETE',`/adventures/${a.id}`,undefined,owner)).status,200);
});

test('deletion removes shared progress from every member but preserves other adventures, accounts and snapshots',async t=>{
  const f=await fixture(t),owner=await f.register(1),guest=await f.register(2);await f.connect(owner);await f.connect(guest);
  const a=await f.adventure(owner),other=await f.adventure(owner),guestAdventure=await f.adventure(guest);
  const r=await f.room(owner,a.id);assert.equal((await f.api('POST',`/rooms/${r.id}/join`,{},guest)).status,200);
  assert.equal((await f.save(owner,r,state(30))).status,200);
  const snapshotDir=path.join(f.directory,'adventures',a.id),snapshotBefore=await fs.readFile(path.join(snapshotDir,'snapshot-1.json'),'utf8');
  await f.api('POST',`/rooms/${r.id}/leave`,{},guest);await f.api('POST',`/rooms/${r.id}/close`,{},owner);await f.api('DELETE',`/adventures/${a.id}`,undefined,owner);
  assert.equal(await fs.readFile(path.join(snapshotDir,'snapshot-1.json'),'utf8'),snapshotBefore,'deleted adventure bytes remain offline, unchanged');
  await f.restart();await f.login(owner);await f.login(guest);await f.connect(owner);
  assert.deepEqual((await f.api('GET','/adventures',undefined,owner)).body.adventures.map(x=>x.id),[other.id]);
  assert.deepEqual((await f.api('GET','/adventures',undefined,guest)).body.adventures.map(x=>x.id),[guestAdventure.id]);
  assert.equal((await f.api('POST','/rooms',{adventureId:a.id},owner)).status,404);
  assert.equal((await f.api('GET',`/adventures/${a.id}/snapshot`,undefined,owner)).status,404);
});

test('recovering an older index slot cannot resurrect a confirmed immutable deletion',async t=>{
  const f=await fixture(t),owner=await f.register(1),a=await f.adventure(owner),other=await f.adventure(owner);
  assert.equal((await f.api('DELETE',`/adventures/${a.id}`,undefined,owner)).status,200);
  const indexDir=path.join(f.directory,'index'),slots=await Promise.all([0,1].map(async n=>({n,value:JSON.parse(await fs.readFile(path.join(indexDir,`snapshot-${n}.json`),'utf8'))})));
  slots.sort((a,b)=>b.value.sequence-a.value.sequence);
  assert.ok(slots[1].value.value.adventures.some(x=>x.id===a.id),'fallback must actually contain the deleted adventure');
  await f.service.stop();await fs.writeFile(path.join(indexDir,`snapshot-${slots[0].n}.json`),'synthetic corruption');
  await f.restart();await f.login(owner);assert.deepEqual((await f.api('GET','/adventures',undefined,owner)).body.adventures.map(x=>x.id),[other.id]);
});

test('committed tombstone survives failed index checkpoint and restart without resurrecting late saves',async t=>{
  const f=await fixture(t),owner=await f.register(1);await f.connect(owner);const a=await f.adventure(owner),r=await f.room(owner,a.id);
  await f.save(owner,r,state(10));await f.api('POST',`/rooms/${r.id}/close`,{},owner);
  const indexDir=path.join(f.directory,'index');for(const n of [0,1])await fs.mkdir(path.join(indexDir,`snapshot-${n}.json.tmp`));
  assert.equal((await f.api('DELETE',`/adventures/${a.id}`,undefined,owner)).status,200,'durable marker, rather than index compaction, commits deletion');
  assert.equal((await f.save(owner,r,state(20),1,2)).status,404);
  await f.restart();await f.login(owner);assert.equal((await f.api('GET','/adventures',undefined,owner)).body.adventures.length,0);
  for(const n of [0,1])await fs.rmdir(path.join(indexDir,`snapshot-${n}.json.tmp`));
  const replacement=await f.adventure(owner);assert.notEqual(replacement.id,a.id);
});

test('failed tombstone commit does not report success or remove the existing adventure',async t=>{
  const f=await fixture(t),owner=await f.register(1),a=await f.adventure(owner);
  const blocker=path.join(f.directory,'deleted-adventures',a.id+'.json');await fs.mkdir(blocker);
  const failed=await f.api('DELETE',`/adventures/${a.id}`,undefined,owner);assert.equal(failed.status,503);assert.equal(failed.body.error.code,'STORAGE_PATH');assert.equal(failed.body.deleted,undefined);
  assert.equal((await f.api('GET','/adventures',undefined,owner)).body.adventures[0].id,a.id);
  await fs.rmdir(blocker);await f.restart();await f.login(owner);assert.equal((await f.api('GET','/adventures',undefined,owner)).body.adventures[0].id,a.id);
});

test('corrupt immutable deletion marker fails closed instead of falling back to an older live index',async t=>{
  const f=await fixture(t),owner=await f.register(1),a=await f.adventure(owner);await f.api('DELETE',`/adventures/${a.id}`,undefined,owner);
  await f.service.stop();await fs.writeFile(path.join(f.directory,'deleted-adventures',a.id+'.json'),'synthetic corruption');
  await assert.rejects(()=>createPlatformService({dataDir:f.directory,wsPackagePath,manualClock:true}),/Invalid adventure deletion marker/);
});

test('room creation and duplicate deletes serialize with a single consistent winning operation',async t=>{
  const f=await fixture(t),owner=await f.register(1);await f.connect(owner);
  for(let attempt=0;attempt<4;attempt++){
    const a=await f.adventure(owner);
    const [created,deleted]=await Promise.all([f.api('POST','/rooms',{adventureId:a.id},owner),f.api('DELETE',`/adventures/${a.id}`,undefined,owner)]);
    if(created.status===201){assert.equal(deleted.status,409);assert.equal(deleted.body.error.code,'ADVENTURE_ACTIVE');await f.api('POST',`/rooms/${created.body.room.id}/close`,{},owner);}
    else {assert.equal(created.status,404);assert.equal(deleted.status,200);}
    if(created.status===201){const outcomes=await Promise.all([f.api('DELETE',`/adventures/${a.id}`,undefined,owner),f.api('DELETE',`/adventures/${a.id}`,undefined,owner)]);assert.deepEqual(outcomes.map(x=>x.status).sort(),[200,404]);}
    assert.ok(!(await f.api('GET','/rooms',undefined,owner)).body.rooms.some(x=>x.adventureId===a.id));
  }
});

test('snapshot request whose body arrives after deletion is rejected and cannot recreate disk progress',async t=>{
  const f=await fixture(t),owner=await f.register(1);await f.connect(owner);const a=await f.adventure(owner),r=await f.room(owner,a.id);
  await f.save(owner,r,state(10));await f.api('POST',`/rooms/${r.id}/close`,{},owner);
  const data=JSON.stringify({roomId:r.id,hostEpoch:r.epoch,baseRevision:1,saveSeq:2,state:state(20)});
  let delayed;
  const response=new Promise((resolve,reject)=>{delayed=httpRequest(`${f.origin}/api/platform/adventures/${a.id}/snapshot`,{method:'PUT',headers:{Origin:f.origin,Cookie:owner.cookie,'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));});delayed.on('error',reject);delayed.write(data.slice(0,1));});
  await delay(15);assert.equal((await f.api('DELETE',`/adventures/${a.id}`,undefined,owner)).status,200);
  delayed.end(data.slice(1));const result=await response;assert.equal(result.status,404);
  const snapshot=JSON.parse(await fs.readFile(path.join(f.directory,'adventures',a.id,'snapshot-1.json'),'utf8'));assert.equal(snapshot.value.revision,1);assert.equal(snapshot.value.state.tick,10);
});
