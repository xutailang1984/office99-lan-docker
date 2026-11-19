import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {createPlatformService} from '../service.mjs';
import {CheckedStore} from '../checked-store.mjs';

const {WebSocket}=createRequire(new URL('../../package.json',import.meta.url))('ws');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const minimal=(tick=1)=>({schema:3,worldId:'capacity-synthetic-world',tick,time:tick/30,phase:'DAY',dayIndex:2,
  players:{},items:{},containers:{storage:{id:'storage',type:'storage',slotLimit:80,itemIds:[]}},
  buildings:{core:{id:'core',hp:270}},bank:{credits:17,materials:23,reservedCredits:0,reservedMaterials:0}});

async function fixture(t,options={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'office-capacity-integration-'));
  const disk={free:20*1024**3};let clock=1000000,service;const sockets=[];
  const start=()=>createPlatformService({dataDir:directory,manualClock:true,now:()=>clock,
    statfs:async()=>({bsize:1n,bavail:BigInt(disk.free)}),...options});
  service=await start();
  const server=createServer((req,res)=>void service.handleRequest(req,res).then(handled=>{if(!handled){res.statusCode=404;res.end('{}');}}));
  server.on('upgrade',(req,socket,head)=>{if(!service.handleUpgrade(req,socket,head))socket.destroy();});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  async function api(method,route,body,account){
    const text=body===undefined?'':JSON.stringify(body);
    return new Promise((resolve,reject)=>{
      const req=httpRequest(origin+'/api/platform'+route,{method,headers:{Origin:origin,...(account?.cookie?{Cookie:account.cookie}:{}),
        ...(text?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(text)}:{})}},res=>{
        let raw='';res.setEncoding('utf8');res.on('data',c=>raw+=c);res.on('end',()=>{try{resolve({status:res.statusCode,
          body:JSON.parse(raw),cookie:res.headers['set-cookie']?.[0]?.split(';')[0]});}catch{reject(Error('Non-JSON platform response'));}});
      });req.on('error',reject);req.end(text);
    });
  }
  async function account(n){const username='cap_'+n+'_'+randomBytes(4).toString('hex'),password=randomBytes(20).toString('base64url');
    const r=await api('POST','/register',{username,password,name:'合成队员'+n});assert.equal(r.status,201);
    return {...r.body.account,username,password,cookie:r.cookie};}
  async function login(a){const r=await api('POST','/login',{username:a.username,password:a.password});assert.equal(r.status,200);a.cookie=r.cookie;}
  async function connect(a){
    const ws=new WebSocket(origin.replace('http:','ws:')+'/platform/signal',{headers:{Origin:origin,Cookie:a.cookie}}),messages=[];
    sockets.push(ws);ws.on('error',()=>{});ws.on('message',raw=>messages.push(JSON.parse(raw)));
    const end=Date.now()+3000;while(!messages.some(m=>m.type==='session')&&Date.now()<end)await pause(5);
    assert(messages.some(m=>m.type==='session'),'synthetic connection reached session');return {ws,messages};
  }
  async function adventure(a){const r=await api('POST','/adventures',{title:'临时容量专项'},a);assert.equal(r.status,201);return r.body.adventure;}
  async function room(a,id){const r=await api('POST','/rooms',{adventureId:id},a);assert.equal(r.status,201);return r.body.room;}
  async function save(a,r,state= minimal(),baseRevision=0,saveSeq=1){return api('PUT',`/adventures/${r.adventureId}/snapshot`,
    {roomId:r.id,hostEpoch:r.epoch,baseRevision,saveSeq,state},a);}
  const get=(a,r)=>api('GET',`/adventures/${r.adventureId}/snapshot`,undefined,a);
  const join=(a,r)=>api('POST',`/rooms/${r.id}/join`,{},a);
  const leave=(a,r)=>api('POST',`/rooms/${r.id}/leave`,{},a);
  const close=(a,r)=>api('POST',`/rooms/${r.id}/close`,{},a);
  const remove=(a,id)=>api('DELETE',`/adventures/${id}`,undefined,a);
  t.after(async()=>{for(const s of sockets)s.terminate();await service.stop();await new Promise(r=>server.close(r));
    const target=path.resolve(directory);assert(target.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(target).startsWith('office-capacity-integration-'));
    await fs.rm(target,{recursive:true,force:true});});
  return {directory,disk,api,account,login,connect,adventure,room,save,get,join,leave,close,remove,
    get service(){return service;},advance:ms=>{clock+=ms;},async restart(){await service.stop();service=await start();}};
}

function personalState(owner,guest,generation=0,tick=1){
  const s=minimal(tick);s.hostId='player-1';
  for(const [slot,a]of [[1,owner],[2,guest]]){
    const id='player-'+slot,bag='bag-'+slot,equipment='equipment-'+slot;
    s.players[id]={id,slotId:slot,tokenHash:'account:'+a.id,memberGeneration:slot===2?generation:0,connected:slot===1,
      lifeState:'ALIVE',hp:100,backpackId:bag,equipment:{weapon:equipment}};
    s.containers[bag]={id:bag,type:'backpack',slotLimit:12,itemIds:[],ownerSlotId:slot};
    s.containers[equipment]={id:equipment,type:'equip_weapon',slotLimit:1,itemIds:[],ownerSlotId:slot};
  }
  for(const [id,containerId,definitionId,quantity]of [['shared','storage','scrap',5],['personal','bag-2','bandage',2],['gun','equipment-2','carbine',1]]){
    s.items[id]={id,containerId,definitionId,quantity,magazineAmmo:id==='gun'?7:0};s.containers[containerId].itemIds.push(id);
  }
  if(generation)s.memberResetEpochs={[guest.id]:generation};return s;
}

test('five created plus joined adventures share one quota; repeated joins and existing reentry cost no extra slot',async t=>{
  const f=await fixture(t),owner=await f.account(1),guest=await f.account(2);await f.connect(owner);await f.connect(guest);
  for(let i=0;i<4;i++)await f.adventure(guest);
  const a=await f.adventure(owner),r=await f.room(owner,a.id);assert.equal((await f.join(guest,r)).status,200);
  assert.equal((await f.join(guest,r)).status,200);assert.equal((await f.leave(guest,r)).status,200);assert.equal((await f.join(guest,r)).status,200);
  let list=await f.api('GET','/adventures',undefined,guest);assert.equal(list.body.capacity.progressUsed,5);assert.equal(list.body.adventures.length,5);
  assert.equal((await f.api('POST','/adventures',{title:'sixth'},guest)).body.error.code,'ACCOUNT_ADVENTURE_LIMIT');
  assert.equal((await f.leave(guest,r)).status,200);const other=await f.adventure(owner);await f.close(owner,r);const next=await f.room(owner,other.id);
  assert.equal((await f.join(guest,next)).body.error.code,'ACCOUNT_ADVENTURE_LIMIT');
  assert.equal((await f.remove(guest,a.id)).status,200);assert.equal((await f.join(guest,next)).status,200);
  list=await f.api('GET','/adventures',undefined,guest);assert.equal(list.body.capacity.progressUsed,5);
});

test('concurrent new creation versus first join admits only one fifth progress',async t=>{
  const f=await fixture(t),owner=await f.account(1),guest=await f.account(2);await f.connect(owner);await f.connect(guest);
  for(let i=0;i<4;i++)await f.adventure(guest);const r=await f.room(owner,(await f.adventure(owner)).id);
  const responses=await Promise.all([f.api('POST','/adventures',{title:'contending fifth'},guest),f.join(guest,r)]);
  assert.equal(responses.filter(r=>r.status<300).length,1);assert.equal(responses.find(r=>r.status>=300).body.error.code,'ACCOUNT_ADVENTURE_LIMIT');
  assert.equal((await f.api('GET','/adventures',undefined,guest)).body.capacity.progressUsed,5);
});

test('personal deletion requires leaving; old host snapshots and identical retries cannot restore items, shared assets persist',async t=>{
  const f=await fixture(t),owner=await f.account(1),guest=await f.account(2),stranger=await f.account(3);await f.connect(owner);await f.connect(guest);
  const r=await f.room(owner,(await f.adventure(owner)).id);await f.join(guest,r);const old=personalState(owner,guest);
  assert.equal((await f.save(owner,r,old)).status,200);
  assert.equal((await f.remove(guest,r.adventureId)).body.error.code,'LEAVE_FIRST');
  assert.equal((await f.remove(stranger,r.adventureId)).status,403);
  await f.leave(guest,r);const removed=await f.remove(guest,r.adventureId);assert.equal(removed.status,200);assert.equal(removed.body.scope,'personal');
  const clean=(await f.get(owner,r)).body;assert.equal(Object.keys(clean.state.players).length,1);assert(!clean.state.items.personal&&!clean.state.items.gun);
  assert.deepEqual(clean.state.items.shared,old.items.shared);assert.deepEqual(clean.state.bank,old.bank);assert.deepEqual(clean.state.buildings,old.buildings);
  const outdated=personalState(owner,guest,0,2);const accepted=await f.save(owner,r,outdated,1,2);assert.equal(accepted.status,200);
  const replay=await f.save(owner,r,outdated,1,2);assert.equal(replay.status,200);assert.equal(replay.body.revision,accepted.body.revision);
  const persisted=(await f.get(owner,r)).body.state;assert(!persisted.players['player-2']);assert.deepEqual(persisted.items.shared,old.items.shared);
  assert.equal((await f.join(guest,r)).status,200);const current=(await f.get(owner,r)).body;
  assert(current.memberResets.some(x=>x.accountId===guest.id&&x.active&&x.generation===1));assert(!current.state.players['player-2']);
  const rebuilt=personalState(owner,guest,1,3);assert.equal((await f.save(owner,r,rebuilt,2,3)).status,200);
  assert.equal(Object.keys((await f.get(owner,r)).body.state.players).length,2);
});

test('world caches are lazy and unloaded on close or central restart, with complete snapshot restoration',async t=>{
  const f=await fixture(t),owner=await f.account(1);await f.connect(owner);const a=await f.adventure(owner);await f.adventure(owner);
  assert.equal(f.service.status().storage.cachedWorlds,0);let r=await f.room(owner,a.id);assert.equal(f.service.status().storage.cachedWorlds,1);
  const state=minimal(100);assert.equal((await f.save(owner,r,state)).status,200);await f.close(owner,r);assert.equal(f.service.status().storage.cachedWorlds,0);
  await f.restart();assert.equal(f.service.status().storage.cachedWorlds,0);await f.login(owner);await f.connect(owner);r=await f.room(owner,a.id);
  assert.deepEqual((await f.get(owner,r)).body.state,state);assert.equal(f.service.status().storage.cachedWorlds,1);
});

test('low disk rejects save/create while preserving confirmed state; identical retry after free-space recovery succeeds',async t=>{
  const f=await fixture(t),owner=await f.account(1);await f.connect(owner);const r=await f.room(owner,(await f.adventure(owner)).id);
  assert.equal((await f.save(owner,r,minimal(1))).status,200);f.disk.free=511*1024**2;
  assert.equal((await f.save(owner,r,minimal(2),1,2)).body.error.code,'DISK_SPACE_LOW');
  assert.equal((await f.api('POST','/adventures',{title:'low disk'},owner)).body.error.code,'DISK_SPACE_LOW');
  assert.equal((await f.get(owner,r)).body.revision,1);assert.deepEqual((await f.get(owner,r)).body.state,minimal(1));
  f.disk.free=20*1024**3;assert.equal((await f.save(owner,r,minimal(2),1,2)).body.revision,2);
  await f.restart();await f.login(owner);await f.connect(owner);const resumed=await f.room(owner,r.adventureId);
  assert.equal((await f.get(owner,resumed)).body.revision,2);assert.deepEqual((await f.get(owner,resumed)).body.state,minimal(2));
});

test('personal tombstone commits despite index failure and still fences a rolled-back index after restart',async t=>{
  const f=await fixture(t),owner=await f.account(1),guest=await f.account(2);await f.connect(owner);await f.connect(guest);
  const r=await f.room(owner,(await f.adventure(owner)).id);await f.join(guest,r);await f.save(owner,r,personalState(owner,guest));await f.leave(guest,r);
  const blockers=[0,1].map(n=>path.join(f.directory,'index',`snapshot-${n}.json.tmp`));for(const file of blockers)await fs.mkdir(file);
  try{const response=await f.remove(guest,r.adventureId);assert.equal(response.status,200);assert.equal(response.body.scope,'personal');}
  finally{for(const file of blockers)await fs.rmdir(file);}
  await f.restart();await f.login(owner);await f.login(guest);await f.connect(owner);
  assert.equal((await f.api('GET','/adventures',undefined,guest)).body.adventures.length,0);
  const resumed=await f.room(owner,r.adventureId);assert(!((await f.get(owner,resumed)).body.state.players['player-2']));
});

async function resetRollbackScenario(t,mode){
  const f=await fixture(t),owner=await f.account(1),guest=await f.account(2);await f.connect(owner);await f.connect(guest);
  const r=await f.room(owner,(await f.adventure(owner)).id);await f.join(guest,r);
  await f.save(owner,r,personalState(owner,guest));await f.leave(guest,r);await f.remove(guest,r.adventureId);await f.join(guest,r);
  assert.equal((await f.save(owner,r,personalState(owner,guest,1,2),1,2)).status,200);
  await f.leave(guest,r);assert.equal((await f.remove(guest,r.adventureId)).status,200);await f.service.stop();
  const resetPath=path.join(f.directory,'member-resets',r.adventureId),latest=path.join(resetPath,'snapshot-0.json');
  if(mode==='missing')await fs.unlink(latest);else await fs.writeFile(latest,'synthetic newest-slot corruption');
  let restartRejected=false;try{await f.restart();}catch(error){assert.match(error.message,/member deletion record|member reset|snapshots invalid/i);restartRejected=true;}
  if(restartRejected)return; // Fail closed is acceptable; silently restoring deleted gear is not.
  await f.login(owner);await f.login(guest);await f.connect(owner);await f.connect(guest);const resumed=await f.room(owner,r.adventureId);await f.join(guest,resumed);
  const got=(await f.get(owner,resumed)).body;
  assert(!got.state.players['player-2'],'a successful second deletion must fence the previous personal generation despite slot fallback');
}
test('second personal deletion cannot roll back its fence to the first deletion after newest reset slot is corrupt',async t=>resetRollbackScenario(t,'corrupt'));
test('missing newest reset slot cannot silently restore a personal generation deleted twice',async t=>resetRollbackScenario(t,'missing'));

test('two successful personal deletions persist matching copies and generation two survives a normal restart',async t=>{
  const f=await fixture(t),owner=await f.account(1),guest=await f.account(2);await f.connect(owner);await f.connect(guest);
  const r=await f.room(owner,(await f.adventure(owner)).id);await f.join(guest,r);await f.save(owner,r,personalState(owner,guest));
  for(let generation=1;generation<=2;generation++){
    await f.leave(guest,r);assert.equal((await f.remove(guest,r.adventureId)).status,200);
    const files=await Promise.all([0,1].map(slot=>fs.readFile(path.join(f.directory,'member-resets',r.adventureId,`snapshot-${slot}.json`),'utf8').then(JSON.parse)));
    assert.deepEqual(files[0].value,files[1].value);assert.equal(files[0].value.records[guest.id].generation,generation);
    if(generation===1){await f.join(guest,r);assert.equal((await f.save(owner,r,personalState(owner,guest,1,2),1,2)).status,200);}
  }
  await f.restart();await f.login(owner);await f.login(guest);await f.connect(owner);await f.connect(guest);
  assert.equal((await f.api('GET','/adventures',undefined,guest)).body.adventures.length,0);
  const resumed=await f.room(owner,r.adventureId);assert.equal((await f.join(guest,resumed)).status,200);
  const got=(await f.get(owner,resumed)).body;assert(got.memberResets.some(x=>x.accountId===guest.id&&x.generation===2&&x.active));
  assert(!got.state.players['player-2']);assert.equal(got.state.items.shared.quantity,5);
});

test('failure halfway through a deletion refuses ACK, preserves the earlier copy, and mixed copies fail closed on restart',async t=>{
  const f=await fixture(t),owner=await f.account(1),guest=await f.account(2);await f.connect(owner);await f.connect(guest);
  const r=await f.room(owner,(await f.adventure(owner)).id);await f.join(guest,r);await f.save(owner,r,personalState(owner,guest));
  await f.leave(guest,r);await f.remove(guest,r.adventureId);await f.join(guest,r);
  assert.equal((await f.save(owner,r,personalState(owner,guest,1,2),1,2)).status,200);await f.leave(guest,r);
  const base=path.join(f.directory,'member-resets',r.adventureId),older=await fs.readFile(path.join(base,'snapshot-0.json'));
  const blocker=path.join(base,'snapshot-0.json.tmp');await fs.mkdir(blocker);
  try{const response=await f.remove(guest,r.adventureId);assert.equal(response.status,503);assert.equal(response.body.error.code,'STORAGE_PATH');assert.equal(response.body.deleted,undefined);}
  finally{await fs.rmdir(blocker);}
  assert.equal(Buffer.compare(await fs.readFile(path.join(base,'snapshot-0.json')),older),0);
  const copies=await Promise.all([0,1].map(slot=>fs.readFile(path.join(base,`snapshot-${slot}.json`),'utf8').then(JSON.parse)));
  assert.deepEqual(copies.map(e=>e.value.records[guest.id].generation),[1,2]);
  await assert.rejects(f.restart(),/Incomplete member deletion record/);
  assert.equal(Buffer.compare(await fs.readFile(path.join(base,'snapshot-0.json')),older),0);
});

test('committed snapshot survives summary signature failure and save remains acknowledged',async t=>{
  const f=await fixture(t),directory=path.join(f.directory,'isolated-checked-store');
  const store=new CheckedStore(directory,{summary:true});await store.load();
  store.signatures=async()=>{throw Error('synthetic summary signature I/O failure');};
  const value={revision:1,state:minimal(1)};
  let rejected=false;try{await store.save(value);}catch{rejected=true;}
  const read=new CheckedStore(directory);assert.equal((await read.load()).revision,1,'authoritative snapshot is already durable');
  assert.equal(rejected,false,'disposable summary failure must not reject a durable snapshot ACK');
});
