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
  async function register(number,displayName){const username=`synthetic${number}`,password=randomBytes(24).toString('base64url'),r=await api('POST','/register',{username,password,name:displayName??`测试队员${number}`});assert.equal(r.status,201);return {...r.body.account,username,password,cookie:r.cookie.split(';')[0],cookieFlags:r.cookie};}
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


test('GM uses protected account IDs, stays private, and verifies saved receipt before success',async t=>{
 const f=await fixture(t),host=await f.register('gmhost'),gm=await f.register('gmguest'),impostor=await f.register('impostor',gm.name);assert.equal(impostor.name,gm.name);
 await fs.writeFile(path.join(f.directory,'gm-resources.json'),JSON.stringify({schema:1,accountIds:[gm.id]}));await f.restart();
 await Promise.all([host,gm,impostor].map(a=>f.login(a)));
 const [h,g,i]=await Promise.all([host,gm,impostor].map(a=>f.connect(a)));
 const adventure=await f.adventure(host),r=await f.room(host,adventure.id);
 for(const a of [gm,impostor])assert.equal((await f.api('POST',`/rooms/${r.id}/join`,{},a)).status,200);
 await Promise.all([h,g,i].map(p=>f.ready(p)));await f.start(host,r);
 const spoofMark=h.messages.length;i.send({type:'chat',text:'/gm 金币 1000',gmRequestId:'forged_request_123',accountId:gm.id,gm:true});
 assert.match((await i.wait(m=>m.type==='gm_notice')).text,/没有GM权限/);assert.equal(h.messages.slice(spoofMark).some(m=>m.type==='gm_grant'||m.type==='chat'),false);
 g.send({type:'chat',text:'/gm 资源 1000',gmRequestId:'grant_request_12345'});
 const ticket=await h.wait(m=>m.type==='gm_grant');assert.equal(ticket.roomId,r.id);assert.equal(g.messages.some(m=>m.type==='chat'&&m.message.text.includes('/gm')),false);
 const body={grantId:ticket.grantId,epoch:r.epoch};
 assert.equal((await f.api('POST',`/rooms/${r.id}/gm/verify`,body,gm)).status,403,'GM guest is not allowed to act as the host');
 let verified=await f.api('POST',`/rooms/${r.id}/gm/verify`,body,host);assert.equal(verified.status,200);const grant=verified.body.grant;
 assert.equal(grant.accountId,gm.id);assert.equal(grant.peerId,g.self.peerId);assert.deepEqual(grant.resources,{credits:1000,materials:1000});
 assert.equal((await f.api('POST',`/rooms/${r.id}/gm/complete`,body,host)).status,409,'No success before durable receipt');
 const value=state();value.gmGrants=[grant];value.bank.credits+=1000;value.bank.materials+=1000;
 assert.equal((await f.save(host,r,value)).status,200);const noticeMark=g.messages.length;
 assert.equal((await f.api('POST',`/rooms/${r.id}/gm/complete`,body,host)).status,200);
 assert.equal((await g.wait(m=>m.type==='gm_notice'&&m.status==='saved',noticeMark)).roomId,r.id);
 f.advance(1100);const hostMark=h.messages.length;g.send({type:'chat',text:'/gm 资源 1000',gmRequestId:'grant_request_12345'});
 await g.wait(m=>m.type==='gm_notice'&&m.status==='saved',noticeMark+1);assert.equal(h.messages.slice(hostMark).some(m=>m.type==='gm_grant'),false,'Repeat request must not issue a new ticket');
 f.advance(1100);const mismatchMark=g.messages.length;g.send({type:'chat',text:'/gm 资源 2000',gmRequestId:'grant_request_12345'});assert.match((await g.wait(m=>m.type==='gm_notice',mismatchMark)).text,/同一请求/);
 f.advance(1100);const retryMark=g.messages.length;g.send({type:'chat',text:'/gm 重试'});assert.equal((await g.wait(m=>m.type==='gm_notice',retryMark)).status,'saved');
 assert.equal(h.messages.some(m=>m.type==='gm_notice'),false,'Host does not see the guest private notices');
 assert.equal(i.messages.some(m=>m.type==='gm_notice'&&m.status==='saved'),false);
});

test('GM retries the same grant, rejects stale authority and never trusts a client completion',async t=>{
 const f=await fixture(t,{hostLeaseMs:300000}),host=await f.register('hostedge'),gm=await f.register('guestedge'),outside=await f.register('outside');
 await fs.writeFile(path.join(f.directory,'gm-resources.json'),JSON.stringify({schema:1,accountIds:[gm.id]}));await f.restart();
 for(const a of [host,gm,outside])await f.login(a);const [h,g,o]=await Promise.all([host,gm,outside].map(a=>f.connect(a)));
 const a=await f.adventure(host),r=await f.room(host,a.id);await f.api('POST',`/rooms/${r.id}/join`,{},gm);await Promise.all([h,g].map(p=>f.ready(p)));await f.start(host,r);
 const oa=await f.adventure(outside),other=await f.room(outside,oa.id);await f.ready(o);await f.start(outside,other);
 g.send({type:'chat',text:'/gm 零件 123',gmRequestId:'edge_request_12345'});const ticket=await h.wait(m=>m.type==='gm_grant');const body={grantId:ticket.grantId,epoch:r.epoch};
 assert.equal((await f.api('POST',`/rooms/${r.id}/gm/verify`,body,outside)).status,403);
 assert.equal((await f.api('POST',`/rooms/${r.id}/gm/verify`,{...body,epoch:r.epoch+1},host)).status,403);
 assert.equal((await f.api('POST',`/rooms/${other.id}/gm/verify`,{...body,epoch:other.epoch},outside)).status,404);
 assert.equal((await f.api('POST',`/rooms/${r.id}/gm/fail`,body,host)).status,200);
 f.advance(1100);let mark=h.messages.length;g.send({type:'chat',text:'/gm 重试'});assert.equal((await h.wait(m=>m.type==='gm_grant',mark)).grantId,ticket.grantId);
 f.advance(121000);assert.equal((await f.api('POST',`/rooms/${r.id}/gm/verify`,body,host)).status,409);
 mark=h.messages.length;g.send({type:'chat',text:'/gm 重试'});await h.wait(m=>m.type==='gm_grant',mark);assert.equal((await f.api('POST',`/rooms/${r.id}/gm/verify`,body,host)).status,200);
 await f.api('POST',`/rooms/${r.id}/leave`,{},gm);assert.equal((await f.api('POST',`/rooms/${r.id}/gm/verify`,body,host)).status,403);
});

test('GM checks expired sessions immediately, without waiting for sweep',async t=>{
 const f=await fixture(t,{sessionMs:1000,hostLeaseMs:50000}),host=await f.register('expiryhost'),gm=await f.register('expiryguest');
 await fs.writeFile(path.join(f.directory,'gm-resources.json'),JSON.stringify({schema:1,accountIds:[gm.id]}));await f.restart();await f.login(host);await f.login(gm);
 const h=await f.connect(host),g=await f.connect(gm),a=await f.adventure(host),r=await f.room(host,a.id);
 await f.api('POST',`/rooms/${r.id}/join`,{},gm);await Promise.all([h,g].map(p=>f.ready(p)));await f.start(host,r);f.advance(1001);
 const mark=h.messages.length;g.send({type:'chat',text:'/gm 金币 123',gmRequestId:'expiry_request_123'});assert.match((await g.wait(m=>m.type==='gm_notice')).text,/登录已过期/);assert.equal(h.messages.slice(mark).some(m=>m.type==='gm_grant'),false);
});

test('GM parser accepts simple Chinese/English aliases and rejects invalid numeric or injected commands',async()=>{
 const {parseGmCommand,isGmCommand}=await import('../gm-service.mjs');
 assert.deepEqual(parseGmCommand('/gm 零件 100000'),{kind:'grant',resources:{credits:0,materials:100000}});
 assert.deepEqual(parseGmCommand('/GM credits 1'),{kind:'grant',resources:{credits:1,materials:0}});
 assert.deepEqual(parseGmCommand('／ｇｍ　资源　１００'),{kind:'grant',resources:{credits:100,materials:100}});
 for(const text of ['/gm 资源 0','/gm 金币 -1','/gm 零件 1.5','/gm 资源 1000001','/gm 资源 Infinity','/gm 资源 1e3','/gm constructor 1','/gm 零件 1 extra'])assert.throws(()=>parseGmCommand(text));
 assert(isGmCommand('/gm'));assert(!isGmCommand('/gmx hi'));assert.equal(parseGmCommand('/gm').kind,'help');assert.equal(parseGmCommand('/gm 重试').kind,'retry');
});
