import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {createPlatformService} from '../service.mjs';
import {Careers} from '../careers.mjs';
import {CheckedStore} from '../checked-store.mjs';
import {loadConfig} from '../../survival/config.mjs';

const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
const wsPackagePath=new URL('../../package.json',import.meta.url),{WebSocket}=createRequire(wsPackagePath)('ws');
const clone=value=>structuredClone(value),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'office-career-test-')),sockets=[];
 let service=await createPlatformService({dataDir:directory,wsPackagePath,economyVersion:1,config,manualClock:true});
 const server=createServer((req,res)=>void service.handleRequest(req,res));server.on('upgrade',(req,socket,head)=>{if(!service.handleUpgrade(req,socket,head))socket.destroy();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 const api=async(method,route,body,account)=>{const response=await fetch(origin+'/api/platform'+route,{method,headers:{Origin:origin,...(account?{Cookie:account.cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
 let count=0;
 async function register(){const username='careertest'+(++count),password=randomBytes(24).toString('base64url'),response=await api('POST','/register',{username,password,name:'隔离队员'});assert.equal(response.status,201);return {...response.body.account,username,password,cookie:response.cookie};}
 async function login(account){const response=await api('POST','/login',{username:account.username,password:account.password});assert.equal(response.status,200);account.cookie=response.cookie;}
 async function connect(account){const socket=new WebSocket(origin.replace('http:','ws:')+'/platform/signal',{headers:{Origin:origin,Cookie:account.cookie}});sockets.push(socket);socket.on('error',()=>{});await new Promise((resolve,reject)=>{socket.once('message',resolve);socket.once('error',reject);});return socket;}
 async function adventure(account){const response=await api('POST','/adventures',{title:'隔离测试'},account);assert.equal(response.status,201);return response.body.adventure;}
 async function room(account,adventureId){const response=await api('POST','/rooms',{adventureId,solo:false},account);assert.equal(response.status,201);return response.body.room;}
 async function career(account){const response=await api('GET','/career',null,account);assert.equal(response.status,200);return response.body;}
 async function bindings(account,room){const response=await api('GET',`/rooms/${room.id}/careers`,null,account);assert.equal(response.status,200);return response.body;}
 async function save(account,room,state,baseRevision=0,saveSeq=1){return api('PUT',`/adventures/${room.adventureId}/snapshot`,{roomId:room.id,hostEpoch:room.epoch,baseRevision,saveSeq,economyEpoch:state.economyEpoch,state},account);}
 async function settle(account,room,state,entries,baseRevision=0,saveSeq=1){return api('POST',`/rooms/${room.id}/settle`,{hostEpoch:room.epoch,baseRevision,saveSeq,economyEpoch:state.economyEpoch,state,settlements:entries.map(row=>({accountId:row.accountId,careerRevision:row.revision}))},account);}
 async function close(account,room){assert.equal((await api('POST',`/rooms/${room.id}/close`,{},account)).status,200);}
 async function restart(){for(const socket of sockets)socket.terminate();await service.stop();service=await createPlatformService({dataDir:directory,wsPackagePath,economyVersion:1,config,manualClock:true});}
 t.after(async()=>{for(const socket of sockets)socket.terminate();await service.stop();await new Promise(resolve=>server.close(resolve));const target=path.resolve(directory);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(target).startsWith('office-career-test-'));await fs.rm(target,{recursive:true,force:true});});
 return {api,register,login,connect,adventure,room,career,bindings,save,settle,close,restart,directory};
}

function world(bindings,{tick=1,economyEpoch=0,far=false}={}){
 const state={schema:3,economyVersion:1,economyEpoch,worldId:'career-fixture',tick,time:100+tick/30,dayIndex:1,phase:'DAY',players:{},items:{},containers:{},buildings:{core:{id:'core',x:0,z:0,hp:100}},bank:{credits:0,materials:0,reservedCredits:0,reservedMaterials:0}};
 for(const [i,binding]of bindings.entries()){
  const id='player-'+(i+1),capsule=binding.capsule,equipment={};
  const container=(kind,items,limit)=>{const cid=id+'-'+kind,c={id:cid,type:kind,ownerSlotId:i+1,slotLimit:limit,itemIds:[],revision:1};state.containers[cid]=c;for(const item of items){state.items[item.id]={...clone(item),containerId:cid};c.itemIds.push(item.id);}return cid;};
  const backpackId=container('backpack',capsule.backpack,capsule.bagSlots),vaultId=container('personal_storage',capsule.vault,32);
  for(const slot of ['weapon','rod','melee'])equipment[slot]=container('equip_'+slot,capsule.equipment[slot],1);
  state.players[id]={id,slotId:i+1,tokenHash:'account:'+binding.accountId,careerRevision:binding.revision,name:'测试',connected:true,lifeState:'ALIVE',x:far?100:0,y:0,z:0,hp:100,damageAt:-100,backpackId,vaultId,equipment,wallet:{...capsule.wallet},perks:clone(capsule.perks),rewardOffers:clone(capsule.rewardOffers),blueprints:clone(capsule.blueprints),quickItemDefinitionId:null};
 }
 return state;
}

test('personal character is private, held by one adventure, and mission never claims assets',async t=>{
 const f=await fixture(t),a=await f.register(),b=await f.register();await f.connect(a);await f.connect(b);
 const first=await f.career(a);assert.equal(first.holding,null);assert.ok(first.capsule.equipment.weapon.length);
 const adventure=await f.adventure(a),r=await f.room(a,adventure.id),bindings=await f.bindings(a,r);assert.equal(bindings.careerBindings.length,1);assert.equal((await f.career(a)).holding.adventureId,adventure.id);
 assert.equal((await f.api('GET',`/rooms/${r.id}/careers`,null,b)).status,403);
 assert.equal(JSON.stringify((await f.api('GET','/rooms',null,b)).body).includes('capsule'),false);
 assert.equal((await f.save(a,r,world(bindings.careerBindings,{far:true}))).status,200);
 await f.close(a,r);const own=await f.adventure(a);assert.equal((await f.api('POST','/rooms',{adventureId:own.id},a)).body.error.code,'CAREER_HELD');
 const practice=await f.api('POST','/rooms',{mode:'mission',missionStart:'free',solo:true},a);assert.equal(practice.status,201);assert.equal((await f.career(a)).holding.adventureId,adventure.id);
 assert.equal((await f.api('GET',`/rooms/${practice.body.room.id}/careers`,null,a)).status,403);
});

test('safe handoff persists exact equipment, is idempotent, and fences old world snapshots',async t=>{
 const f=await fixture(t),a=await f.register();await f.connect(a);const adventure=await f.adventure(a),r=await f.room(a,adventure.id),binding=(await f.bindings(a,r)).careerBindings[0],state=world([binding]);
 state.players['player-1'].wallet.credits+=19;const weapon=state.items[binding.capsule.equipment.weapon[0].id];weapon.magazineAmmo=3;weapon.level=2;
 const saved=await f.save(a,r,state);assert.equal(saved.status,200);
 const settled=await f.settle(a,r,state,[binding],1,2);assert.equal(settled.status,200);assert.equal(settled.body.economyEpoch,1);
 const again=await f.settle(a,r,state,[binding],1,2);assert.equal(again.status,200);assert.equal(again.body.revision,settled.body.revision);
 const profile=await f.career(a);assert.equal(profile.holding,null);assert.equal(profile.capsule.wallet.credits,binding.capsule.wallet.credits+19);assert.equal(profile.capsule.equipment.weapon[0].magazineAmmo,3);
 const current=(await f.api('GET',`/adventures/${adventure.id}/snapshot`,null,a)).body;assert.equal(Object.keys(current.state.players).length,0);assert.equal(Object.keys(current.state.items).length,0);
 const old=await f.save(a,r,{...clone(state),tick:2,time:101},current.revision,3);assert.equal(old.body.error.code,'CAREER_EPOCH_CHANGED');
 const rebased={...clone(state),economyEpoch:1,tick:2,time:101};assert.equal((await f.save(a,r,rebased,current.revision,3)).status,200);
 assert.equal(Object.keys((await f.api('GET',`/adventures/${adventure.id}/snapshot`,null,a)).body.state.players).length,0,'A forged current epoch cannot revive an exported player');
 await f.close(a,r);const second=await f.adventure(a),other=await f.room(a,second.id),next=(await f.bindings(a,other)).careerBindings[0];assert.equal(next.capsule.equipment.weapon[0].id,weapon.id);assert.equal(next.capsule.equipment.weapon[0].level,2);
});

test('unsafe departure stays held; abandon preserves confirmed vault and wallet, drops carried once',async t=>{
 const f=await fixture(t),a=await f.register();await f.connect(a);const adventure=await f.adventure(a),r=await f.room(a,adventure.id),binding=(await f.bindings(a,r)).careerBindings[0],state=world([binding],{far:true}),p=state.players['player-1'];
 const bag=state.containers[p.backpackId],vault=state.containers[p.vaultId],itemId=bag.itemIds.shift();vault.itemIds.push(itemId);state.items[itemId].containerId=vault.id;p.wallet.credits+=37;
 assert.equal((await f.save(a,r,state)).status,200);assert.equal((await f.settle(a,r,state,[binding],1,2)).body.error.code,'RETURN_TO_BASE');
 assert.equal((await f.api('POST','/career/abandon',{careerRevision:binding.revision},a)).body.error.code,'ADVENTURE_ACTIVE');
 await f.close(a,r);const abandoned=await f.api('POST','/career/abandon',{careerRevision:binding.revision},a);assert.equal(abandoned.status,200);assert.equal(abandoned.body.capsule.vault[0].id,itemId);assert.equal(abandoned.body.capsule.wallet.credits,binding.capsule.wallet.credits+37);assert.equal(abandoned.body.capsule.backpack.length,0);assert.equal(abandoned.body.capsule.equipment.weapon.length,0);
 assert.equal((await f.api('POST','/career/abandon',{careerRevision:binding.revision},a)).status,200);
 const reopened=await f.room(a,adventure.id),snapshot=(await f.api('GET',`/adventures/${adventure.id}/snapshot`,null,a)).body;
 assert.equal(Object.keys(snapshot.state.players).length,0);assert.equal(snapshot.state.items[itemId],undefined);assert.equal(Object.values(snapshot.state.containers).filter(c=>c.type==='corpse').length,1);
 assert.equal((await f.api('POST','/career/abandon',{careerRevision:binding.revision},a)).body.error.code,'CAREER_CHANGED');await f.close(a,reopened);
});

test('unspawned waiting member can return the untouched starter kit without loss',async t=>{
 const f=await fixture(t),a=await f.register();await f.connect(a);const adventure=await f.adventure(a),r=await f.room(a,adventure.id),binding=(await f.bindings(a,r)).careerBindings[0];
 const result=await f.settle(a,r,world([]),[binding]);assert.equal(result.status,200);assert.deepEqual((await f.career(a)).capsule,binding.capsule);
});

test('normal close of a fresh waiting room releases unspawned entrants, including one who already left',async t=>{
 const f=await fixture(t),host=await f.register(),guest=await f.register();await f.connect(host);await f.connect(guest);
 const adventure=await f.adventure(host),r=await f.room(host,adventure.id);assert.equal((await f.api('POST',`/rooms/${r.id}/join`,{},guest)).status,200);
 const before=await Promise.all([f.career(host),f.career(guest)]);assert.equal((await f.api('POST',`/rooms/${r.id}/leave`,{},guest)).status,200);
 await f.close(host,r);
 for(const [i,account]of [host,guest].entries()){const after=await f.career(account);assert.equal(after.holding,null);assert.deepEqual(after.capsule,before[i].capsule);assert.equal(after.revision,before[i].revision+1);}
 const other=await f.adventure(guest),joined=await f.room(guest,other.id);assert.deepEqual((await f.bindings(guest,joined)).careerBindings[0].capsule,before[1].capsule);
 const reopened=await f.room(host,adventure.id),snapshot=(await f.api('GET',`/adventures/${adventure.id}/snapshot`,null,host)).body;
 assert.equal(snapshot.state,null);assert.equal(snapshot.economyEpoch,1);assert.equal(snapshot.revision,0);await f.close(host,reopened);
});

test('a guest joining after final host settlement is released on confirmed close and stale snapshots cannot reimport it',async t=>{
 const f=await fixture(t),host=await f.register(),guest=await f.register();await f.connect(host);await f.connect(guest);
 const adventure=await f.adventure(host),r=await f.room(host,adventure.id),binding=(await f.bindings(host,r)).careerBindings[0],state=world([binding]);
 assert.equal((await f.save(host,r,state)).status,200);assert.equal((await f.settle(host,r,state,[binding],1,2)).status,200);
 assert.equal((await f.api('POST',`/rooms/${r.id}/join`,{},guest)).status,200);const late=await f.career(guest);
 const oldLocal=world([late],{tick:2,economyEpoch:1});
 await f.api('POST',`/rooms/${r.id}/leave`,{},guest);const closed=await f.api('POST',`/rooms/${r.id}/close`,{finalRevision:2},host);assert.equal(closed.status,200);assert.equal(closed.body.revision,3);
 const after=await f.career(guest);assert.equal(after.holding,null);assert.deepEqual(after.capsule,late.capsule);assert.equal(after.revision,late.revision+1);
 const reopened=await f.room(host,adventure.id),snapshot=(await f.api('GET',`/adventures/${adventure.id}/snapshot`,null,host)).body;
 assert.equal(snapshot.economyEpoch,2);assert.equal(snapshot.state.economyEpoch,2);assert.equal(Object.keys(snapshot.state.players).length,0);assert.equal(Object.keys(snapshot.state.items).length,0);
 assert.equal((await f.save(host,reopened,oldLocal,snapshot.revision,1)).body.error.code,'CAREER_EPOCH_CHANGED');
 assert.equal((await f.save(host,reopened,{...clone(oldLocal),economyEpoch:2},snapshot.revision,1)).status,200);
 const projected=(await f.api('GET',`/adventures/${adventure.id}/snapshot`,null,host)).body;assert.equal(Object.keys(projected.state.players).length,0);assert.equal(Object.keys(projected.state.items).length,0);
 assert.deepEqual((await f.career(guest)).capsule,late.capsule);
});

test('confirmed close returns only never-spawned profiles and leaves saved field characters held',async t=>{
 const f=await fixture(t),host=await f.register(),guest=await f.register(),late=await f.register();for(const account of [host,guest,late])await f.connect(account);
 const adventure=await f.adventure(host),r=await f.room(host,adventure.id);assert.equal((await f.api('POST',`/rooms/${r.id}/join`,{},guest)).status,200);
 const bindings=(await f.bindings(host,r)).careerBindings,state=world(bindings,{far:true});assert.equal((await f.save(host,r,state)).status,200);
 assert.equal((await f.api('POST',`/rooms/${r.id}/join`,{},late)).status,200);const untouched=await f.career(late);
 assert.equal((await f.api('POST',`/rooms/${r.id}/close`,{finalRevision:0},host)).body.error.code,'REVISION_CONFLICT');assert.equal((await f.career(late)).holding.adventureId,adventure.id);
 await f.api('POST',`/rooms/${r.id}/leave`,{},guest);await f.api('POST',`/rooms/${r.id}/leave`,{},late);assert.equal((await f.api('POST',`/rooms/${r.id}/close`,{finalRevision:1},host)).status,200);
 for(const binding of bindings){const account=binding.accountId===host.id?host:guest,after=await f.career(account);assert.equal(after.holding.adventureId,adventure.id);assert.equal(after.holding.materialized,true);assert.equal(after.revision,binding.revision);assert.deepEqual(after.capsule,binding.capsule);}
 const returned=await f.career(late);assert.equal(returned.holding,null);assert.deepEqual(returned.capsule,untouched.capsule);
 const reopened=await f.room(host,adventure.id),snapshot=(await f.api('GET',`/adventures/${adventure.id}/snapshot`,null,host)).body;
 assert.equal(Object.keys(snapshot.state.players).length,2);assert.equal(snapshot.economyEpoch,1);assert.equal(snapshot.revision,2);await f.close(host,reopened);
});

test('close without a confirmed revision on an existing snapshot does not release an unspawned holding',async t=>{
 const f=await fixture(t),host=await f.register();await f.connect(host);const adventure=await f.adventure(host),r=await f.room(host,adventure.id),before=await f.career(host);
 assert.equal((await f.save(host,r,world([]))).status,200);await f.close(host,r);
 const after=await f.career(host);assert.deepEqual(after,before);
});

test('close journal recovery accepts the original final revision and releases the starter kit exactly once',async t=>{
 const f=await fixture(t),host=await f.register();await f.connect(host);const adventure=await f.adventure(host),r=await f.room(host,adventure.id),before=await f.career(host);
 assert.equal((await f.save(host,r,world([]))).status,200);
 const blocked=path.join(f.directory,'adventures',adventure.id,'snapshot-0.json.tmp');await fs.mkdir(blocked);
 let failed;try{failed=await f.api('POST',`/rooms/${r.id}/close`,{finalRevision:1},host);}finally{await fs.rmdir(blocked);}assert.ok(failed.status>=500);
 const retried=await f.api('POST',`/rooms/${r.id}/close`,{finalRevision:1},host);assert.equal(retried.status,200);assert.equal(retried.body.revision,2);
 const after=await f.career(host);assert.equal(after.holding,null);assert.deepEqual(after.capsule,before.capsule);assert.equal(after.revision,before.revision+1);
 await f.restart();await f.login(host);await f.connect(host);assert.deepEqual(await f.career(host),after);
 const reopened=await f.room(host,adventure.id),snapshot=(await f.api('GET',`/adventures/${adventure.id}/snapshot`,null,host)).body;assert.equal(snapshot.economyEpoch,1);assert.equal(snapshot.revision,2);await f.close(host,reopened);
});

test('platform shutdown keeps an unspawned holding because it is not a confirmed host close',async t=>{
 const f=await fixture(t),host=await f.register();await f.connect(host);const adventure=await f.adventure(host);await f.room(host,adventure.id);const before=await f.career(host);
 await f.restart();await f.login(host);await f.connect(host);assert.deepEqual(await f.career(host),before);
});

test('a materialized character cannot be omitted from a handoff to recover an old kit',async t=>{
 const f=await fixture(t),a=await f.register();await f.connect(a);const adventure=await f.adventure(a),r=await f.room(a,adventure.id),binding=(await f.bindings(a,r)).careerBindings[0];assert.equal((await f.save(a,r,world([binding]))).status,200);
 assert.equal((await f.settle(a,r,world([],{tick:2}),[binding],1,2)).body.error.code,'RETURN_TO_BASE');
});

test('durable transfer intent recovers after world write failure and platform restart',async t=>{
 const f=await fixture(t),a=await f.register();await f.connect(a);const adventure=await f.adventure(a),r=await f.room(a,adventure.id),binding=(await f.bindings(a,r)).careerBindings[0],state=world([binding]);assert.equal((await f.save(a,r,state)).status,200);
 const blocked=path.join(f.directory,'adventures',adventure.id,'snapshot-0.json.tmp');await fs.mkdir(blocked);
 let failed;try{failed=await f.settle(a,r,state,[binding],1,2);}finally{await fs.rmdir(blocked);}assert.ok(failed.status>=500);
 await f.restart();await f.login(a);await f.connect(a);const profile=await f.career(a);assert.equal(profile.holding,null);assert.deepEqual(profile.capsule,binding.capsule);
 const reopened=await f.room(a,adventure.id),snapshot=(await f.api('GET',`/adventures/${adventure.id}/snapshot`,null,a)).body;assert.equal(snapshot.revision,2);assert.equal(snapshot.economyEpoch,1);assert.equal(Object.keys(snapshot.state.players).length,0);await f.close(a,reopened);
});

test('deleting an offline world preserves protected personal assets and frees character',async t=>{
 const f=await fixture(t),a=await f.register();await f.connect(a);const adventure=await f.adventure(a),r=await f.room(a,adventure.id),binding=(await f.bindings(a,r)).careerBindings[0],state=world([binding]);assert.equal((await f.save(a,r,state)).status,200);await f.close(a,r);
 assert.equal((await f.api('DELETE',`/adventures/${adventure.id}`,null,a)).status,200);const profile=await f.career(a);assert.equal(profile.holding,null);assert.equal(profile.capsule.wallet.credits,binding.capsule.wallet.credits);assert.equal(profile.capsule.equipment.weapon.length,0);
});

test('one guest can settle and join another room while the original host keeps its own equipment',async t=>{
 const f=await fixture(t),a=await f.register(),b=await f.register();await f.connect(a);await f.connect(b);const adventure=await f.adventure(a),r=await f.room(a,adventure.id);
 assert.equal((await f.api('POST',`/rooms/${r.id}/join`,{},b)).status,200);const bindings=(await f.bindings(a,r)).careerBindings,state=world(bindings),guest=bindings.find(row=>row.accountId===b.id),host=bindings.find(row=>row.accountId===a.id);
 assert.equal((await f.settle(b,r,state,[guest])).status,403);assert.equal((await f.save(a,r,state)).status,200);
 const result=await f.settle(a,r,state,[guest],1,2);assert.equal(result.status,200);assert.equal(result.body.careerBindings.length,1);assert.equal(result.body.careerBindings[0].accountId,a.id);
 assert.equal((await f.api('POST',`/rooms/${r.id}/leave`,{},b)).status,200);const own=await f.adventure(b),other=await f.room(b,own.id),imported=(await f.bindings(b,other)).careerBindings[0];assert.equal(imported.capsule.equipment.weapon[0].id,guest.capsule.equipment.weapon[0].id);
 const original=(await f.api('GET',`/adventures/${r.adventureId}/snapshot`,null,a)).body.state;
 assert.equal(Object.keys(original.players).length,1);assert.ok(original.items[host.capsule.equipment.weapon[0].id]);assert.equal(original.items[guest.capsule.equipment.weapon[0].id],undefined);
 assert.equal((await f.api('POST',`/rooms/${r.id}/gm/verify`,{},a)).body.error.code,'NOT_AVAILABLE');
});

test('fresh Careers instance replays an interrupted journal without reissuing assets',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'office-career-journal-')),adventureId='00000000-0000-4000-8000-000000000001',accountId='00000000-0000-4000-8000-000000000002';
 t.after(async()=>{const target=path.resolve(directory);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(target).startsWith('office-career-journal-'));await fs.rm(target,{recursive:true,force:true});});
 const worldStore=new CheckedStore(path.join(directory,'adventures',adventureId)),careers=await new Careers({directory,config,getWorldStore:()=>worldStore}).load();
 const binding=await careers.claim(accountId,adventureId),returned=careers.settled(accountId,adventureId,binding.revision,binding.capsule),snapshot={revision:1,checksum:'synthetic-world-checksum',state:world([],{economyEpoch:1})};
 const save=worldStore.save.bind(worldStore);worldStore.save=async()=>{throw Error('Synthetic disk interruption');};
 await assert.rejects(careers.commit({adventureId,snapshot,profiles:[returned],economyEpoch:1}),/Synthetic disk/);
 const newWorldStore=new CheckedStore(path.join(directory,'adventures',adventureId));
 const recovered=await new Careers({directory,config,getWorldStore:()=>newWorldStore}).load();assert.equal(recovered.row(accountId).holding,null);assert.deepEqual(recovered.row(accountId).capsule,binding.capsule);assert.equal(recovered.epoch(adventureId),1);assert.equal(newWorldStore.current.revision,1);
 await recovered.recover();assert.equal(newWorldStore.current.revision,1);assert.equal(recovered.row(accountId).revision,returned.revision);worldStore.save=save;
});
