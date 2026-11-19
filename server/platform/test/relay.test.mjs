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

async function pair(t,extra={}){const f=await fixture(t,extra),a=await f.register(1),b=await f.register(2),host=await f.connect(a),guest=await f.connect(b);let room=await f.room(a,(await f.adventure(a)).id);room=(await f.api('POST',`/rooms/${room.id}/join`,{},b)).body.room;return {f,a,b,host,guest,room};}
const envelope=(room,to,packet)=>({type:'relay',roomId:room.id,epoch:room.epoch,to,packet:JSON.stringify(packet)});
async function openRelay(host,guest,room){const h=host.messages.length,g=guest.messages.length;guest.send({type:'relay_open',roomId:room.id,epoch:room.epoch,to:host.self.peerId});await host.wait(m=>m.type==='relay_ready'&&m.peerId===guest.self.peerId,h);await guest.wait(m=>m.type==='relay_ready'&&m.peerId===host.self.peerId,g);}

test('relay is explicitly negotiated and derives trustworthy host/guest identities',async t=>{
 const {host,guest,room,f}=await pair(t);let mark=guest.messages.length;
 guest.send(envelope(room,host.self.peerId,{type:'hello'}));assert.equal((await guest.wait(m=>m.type==='relay_error',mark)).code,'RELAY_NOT_READY');f.advance(300);
 await openRelay(host,guest,room);mark=host.messages.length;
 guest.send({...envelope(room,host.self.peerId,{type:'input',seq:1,dx:1}),from:'forged-peer'});
 const got=await host.wait(m=>m.type==='relay',mark);assert.equal(got.from,guest.self.peerId);assert.equal(got.roomId,room.id);assert.equal(got.epoch,room.epoch);assert.deepEqual(JSON.parse(got.packet),{type:'input',seq:1,dx:1});
 mark=guest.messages.length;host.send(envelope(room,guest.self.peerId,{type:'result',requestId:7,ok:true}));assert.equal(JSON.parse((await guest.wait(m=>m.type==='relay',mark)).packet).requestId,7);
});

test('relay rejects cross-room, guest-to-guest, stale epoch and guest forged state',async t=>{
 const {host,guest,room,f}=await pair(t),c=await f.register(3),d=await f.register(4),third=await f.connect(c),outside=await f.connect(d);
 await f.api('POST',`/rooms/${room.id}/join`,{},c);await f.room(d,(await f.adventure(d)).id);await openRelay(host,guest,room);
 async function denied(value,code){f.advance(300);const mark=guest.messages.length,relayCount=host.messages.filter(m=>m.type==='relay').length;guest.send(value);assert.equal((await guest.wait(m=>m.type==='relay_error',mark)).code,code);assert.equal(host.messages.filter(m=>m.type==='relay').length,relayCount);}
 await denied(envelope(room,third.self.peerId,{type:'input'}),'INVALID_TOPOLOGY');
 await denied(envelope(room,outside.self.peerId,{type:'input'}),'NOT_MEMBER');
 await denied({...envelope(room,host.self.peerId,{type:'input'}),epoch:room.epoch+1},'STALE_ROOM');
 await denied(envelope(room,host.self.peerId,{type:'state',players:[{hp:999}]}),'INVALID_PACKET');
 await denied(envelope(room,host.self.peerId,{__chunk:1,total:1,index:0,text:'forged'}),'INVALID_PACKET');
});

test('relay keeps packet UTF8 bounds and separately budgets signaling versus host game traffic',async t=>{
 const {host,guest,room,f}=await pair(t);await openRelay(host,guest,room);const mark=guest.messages.length;
 for(let i=0;i<220;i++)host.send(envelope(room,guest.self.peerId,{type:'event',eventType:'synthetic',sequence:i}));
 await guest.wait(m=>m.type==='relay'&&JSON.parse(m.packet).sequence===219,mark);
 assert.equal(guest.messages.slice(mark).filter(m=>m.type==='relay').length,220);assert.equal(host.messages.some(m=>m.type==='error'&&m.code==='RATE_LIMIT'),false);
 f.advance(300);const before=host.messages.length;host.send(envelope(room,guest.self.peerId,{type:'event',text:'中'.repeat(6000)}));assert.equal((await host.wait(m=>m.type==='relay_error',before)).code,'INVALID_PACKET');
});

test('450 input burst cannot consume the separate snapshot ACK and resync budgets',async t=>{
 const {host,guest,room}=await pair(t);await openRelay(host,guest,room);const h=host.messages.length,g=guest.messages.length;
 for(let seq=1;seq<=450;seq++)guest.send(envelope(room,host.self.peerId,{type:'input',seq}));
 guest.send(envelope(room,host.self.peerId,{type:'snapshot_ack',snapshotId:1}));guest.send(envelope(room,host.self.peerId,{type:'state_resync'}));
 guest.send(envelope(room,host.self.peerId,{type:'client_ready'}));
 assert.equal((await guest.wait(m=>m.type==='relay_error',g)).code,'RATE_LIMIT');await host.wait(m=>m.type==='relay'&&JSON.parse(m.packet).type==='state_resync',h);
 await host.wait(m=>m.type==='relay'&&JSON.parse(m.packet).type==='client_ready',h);
 const packets=host.messages.slice(h).filter(m=>m.type==='relay').map(m=>JSON.parse(m.packet));assert.equal(packets.filter(m=>m.type==='input').length,120);assert.equal(packets.filter(m=>m.type==='snapshot_ack').length,1);assert.equal(packets.filter(m=>m.type==='state_resync').length,1);assert.equal(packets.filter(m=>m.type==='client_ready').length,1);
});

test('ACK and resync retain their own strict size, shape and per-second abuse limits',async t=>{
 const {host,guest,room,f}=await pair(t);await openRelay(host,guest,room);const h=host.messages.length;
 for(let snapshotId=1;snapshotId<=31;snapshotId++)guest.send(envelope(room,host.self.peerId,{type:'snapshot_ack',snapshotId}));
 for(let i=0;i<3;i++)guest.send(envelope(room,host.self.peerId,{type:'state_resync'}));
 for(let i=0;i<5;i++)guest.send(envelope(room,host.self.peerId,{type:'client_ready'}));
 guest.send(envelope(room,host.self.peerId,{type:'snapshot_ack',snapshotId:'1'}));guest.send(envelope(room,host.self.peerId,{type:'state_resync',padding:'x'.repeat(256)}));
 guest.send(envelope(room,host.self.peerId,{type:'input',seq:1}));await host.wait(m=>m.type==='relay'&&JSON.parse(m.packet).type==='input',h);
 const packets=host.messages.slice(h).filter(m=>m.type==='relay').map(m=>JSON.parse(m.packet));assert.equal(packets.filter(m=>m.type==='snapshot_ack').length,30);assert.equal(packets.filter(m=>m.type==='state_resync').length,2);assert.equal(packets.filter(m=>m.type==='client_ready').length,4);assert.equal(packets.filter(m=>m.type==='input').length,1);
 f.advance(1001);const next=host.messages.length;guest.send(envelope(room,host.self.peerId,{type:'snapshot_ack',snapshotId:32}));await host.wait(m=>m.type==='relay'&&JSON.parse(m.packet).snapshotId===32,next);
});

test('leaving, expired host lease and new adventure epochs reject stale relay routes',async t=>{
 const {host,guest,room,f,a,b}=await pair(t);await openRelay(host,guest,room);await f.ready(host);await f.ready(guest);await f.start(a,room);
 f.advance(20001);let g=guest.messages.length;guest.send(envelope(room,host.self.peerId,{type:'input'}));assert.equal((await guest.wait(m=>m.type==='relay_error',g)).code,'LEASE_EXPIRED');
 await f.service.sweep();const next=await f.room(a,room.adventureId);assert.equal(next.epoch,room.epoch+1);await f.api('POST',`/rooms/${next.id}/join`,{},b);f.advance(300);g=guest.messages.length;guest.send(envelope(room,host.self.peerId,{type:'hello'}));assert.equal((await guest.wait(m=>m.type==='relay_error',g)).code,'STALE_ROOM');
 await f.api('POST',`/rooms/${next.id}/leave`,{},b);f.advance(300);g=guest.messages.length;guest.send(envelope(next,host.self.peerId,{type:'input'}));assert.equal((await guest.wait(m=>m.type==='relay_error',g)).code,'STALE_ROOM');
});

test('relay authenticates each active session and a replacement connection cannot inherit the old pair',async t=>{
 const {host,guest,room,f,b}=await pair(t);await openRelay(host,guest,room);const replacement=await f.connect(b);await f.until(()=>guest.closeCode===4001);
 const mark=replacement.messages.length;replacement.send(envelope(room,host.self.peerId,{type:'hello'}));assert.equal((await replacement.wait(m=>m.type==='relay_error',mark)).code,'STALE_ROOM');
});

test('slow receiver is closed at a bounded buffer instead of accumulating game frames',async()=>{
 const {createRelayRouter}=await import('../relay-router.mjs');const outputs=[];
 const make=id=>({peerId:id,accountId:id,roomId:'r',ws:{readyState:1,bufferedAmount:0,send:s=>outputs.push({id,...JSON.parse(s)}),close:code=>outputs.push({closed:id,code})}});
 const host=make('host'),guest=make('guest'),peers=new Map([['host',host],['guest',guest]]),room={id:'r',epoch:1,hostPeerId:'host',status:'waiting',members:peers};
 const router=createRelayRouter({getRoom:()=>room,getPeer:id=>peers.get(id),isCurrent:()=>true,sessionActive:()=>true});router.handle(guest,{type:'relay_open',roomId:'r',epoch:1,to:'host'});
 guest.ws.bufferedAmount=2*1024*1024+1;router.handle(host,envelope(room,'guest',{type:'state'}));assert(outputs.some(o=>o.closed==='guest'&&o.code===4008));assert.equal(outputs.some(o=>o.type==='relay'),false);
});

test('eight-player host can open all seven fallback pairs in one second with bounded retry allowance',async()=>{
 const {createRelayRouter}=await import('../relay-router.mjs'),outputs=[];
 const make=id=>({peerId:id,roomId:'r',ws:{readyState:1,bufferedAmount:0,send:json=>outputs.push({recipient:id,...JSON.parse(json)}),close(){}}});
 const host=make('host'),guests=Array.from({length:7},(_,i)=>make('guest-'+i)),peers=new Map([host,...guests].map(peer=>[peer.peerId,peer])),room={id:'r',epoch:1,hostPeerId:'host',status:'waiting',members:peers};
 const router=createRelayRouter({now:()=>1000,getRoom:()=>room,getPeer:id=>peers.get(id),isCurrent:()=>true,sessionActive:()=>true});
 for(const guest of guests)router.handle(host,{type:'relay_open',roomId:'r',epoch:1,to:guest.peerId});
 assert.equal(outputs.filter(m=>m.type==='relay_ready'&&m.recipient==='host').length,7);assert.equal(outputs.some(m=>m.type==='relay_error'),false);
 for(let i=7;i<17;i++)router.handle(host,{type:'relay_open',roomId:'r',epoch:1,to:guests[i%7].peerId});
 assert.equal(outputs.filter(m=>m.type==='relay_ready'&&m.recipient==='host').length,16);assert.equal(outputs.filter(m=>m.type==='relay_error'&&m.recipient==='host').length,1);
 const before=outputs.length;for(let i=0;i<5;i++)router.handle(guests[0],{type:'relay_open',roomId:'r',epoch:1,to:host.peerId});assert.equal(outputs.slice(before).filter(m=>m.type==='relay_ready'&&m.recipient==='host').length,4);assert.equal(outputs.slice(before).filter(m=>m.type==='relay_error').length,1);
});

test('host reliable-stream overflow closes explicitly instead of silently discarding half a snapshot',async t=>{
 const {host,guest,room,f}=await pair(t,{relayLimits:{hostPackets:2}});await openRelay(host,guest,room);
 for(let index=0;index<3;index++)host.send(envelope(room,guest.self.peerId,{__chunk:1,index,total:3,text:'synthetic'}));
 await f.until(()=>host.closeCode!==null);assert.equal(host.closeCode,4008);await guest.wait(m=>m.type==='room'&&m.room?.status==='migrating'&&m.room.hostPeerId===guest.self.peerId);assert.equal(guest.messages.filter(m=>m.type==='relay').length,2);
});

test('authenticated Worker heartbeat/save keep a loaded owner alive without pong; real socket close hands off the confirmed room',async t=>{
 const {host,guest,room,f,a}=await pair(t);await f.ready(host);await f.ready(guest);await f.start(a,room);host.ws.pong=()=>{};
 f.advance(10001);await f.service.sweep();await delay(10);f.advance(5000);
 const beat=await f.api('POST',`/rooms/${room.id}/heartbeat`,{epoch:room.epoch},a);assert.equal(beat.status,200);
 f.advance(5001);await f.service.sweep();await delay(10);assert.equal((await f.api('GET','/rooms',undefined,a)).body.rooms.length,1,'fresh authenticated Worker heartbeat is proof of owner liveness');
 f.advance(5000);assert.equal((await f.save(a,room)).status,200);f.advance(5001);await f.service.sweep();await delay(10);assert.equal((await f.api('GET','/rooms',undefined,a)).body.rooms.length,1,'fresh durable save is proof of owner liveness');
 host.ws.close();await guest.wait(m=>m.type==='room'&&m.room?.status==='migrating'&&m.room.hostPeerId===guest.self.peerId);assert.equal((await f.api('GET','/rooms',undefined,a)).body.rooms.length,1);
});

test('real WebSocket relay carries fragmented Runtime welcome/full state, inputs, commands and ACK deltas',async t=>{
 const {RoomRuntime}=await import('../../survival/room-runtime.mjs');
 const {loadConfig}=await import('../../survival/config.mjs');
 const {restoreState}=await import('../../../tools/testing/bots/observer.mjs');
 const {host,guest,room,f,a}=await pair(t);await f.ready(host);await f.ready(guest);const running=await f.start(a,room);
 const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
 let runtime,clock=0,sequence=0,revision=0,mirror=null,welcome=null,full=0,deltas=0,chunks=0;
 const errors=[],parts=new Map(),results=[];
 const sendGuest=json=>{if(Buffer.byteLength(json)<=16384){host.send({...envelope(room,guest.self.peerId,{}),packet:json});return;}const id=++sequence,total=Math.ceil(json.length/3072);for(let index=0;index<total;index++){chunks++;host.send(envelope(room,guest.self.peerId,{__chunk:id,index,total,text:json.slice(index*3072,(index+1)*3072)}));}};
 runtime=new RoomRuntime({config,room:running,now:()=>clock,save:async()=>({revision:++revision}),send:(id,json)=>{if(id===guest.self.peerId)sendGuest(json);else{const value=JSON.parse(json);if(value.snapshotId)runtime.receive(id,{type:'snapshot_ack',snapshotId:value.snapshotId});}}});
 host.ws.on('message',raw=>{try{const m=JSON.parse(raw);if(m.type==='relay')runtime.receive(m.from,JSON.parse(m.packet));}catch(e){errors.push(e);}});
 guest.ws.on('message',raw=>{try{const m=JSON.parse(raw);if(m.type!=='relay')return;let packet=JSON.parse(m.packet);if(packet.__chunk){let row=parts.get(packet.__chunk);if(!row){row={values:new Array(packet.total),count:0};parts.set(packet.__chunk,row);}if(row.values[packet.index]===undefined){row.values[packet.index]=packet.text;row.count++;}if(row.count!==row.values.length)return;parts.delete(packet.__chunk);packet=JSON.parse(row.values.join(''));}
  if(packet.type==='welcome')welcome=packet;if(packet.type==='result')results.push(packet);
  if(['state','state_delta'].includes(packet.type)){if(packet.type==='state')full++;else deltas++;mirror=restoreState(mirror,packet);guest.send(envelope(room,host.self.peerId,{type:'snapshot_ack',snapshotId:packet.snapshotId}));}
 }catch(e){errors.push(e);}});
 await openRelay(host,guest,room);runtime.receive(host.self.peerId,{type:'hello'});
 runtime.receive(host.self.peerId,{type:'command',command:'Ready',requestId:1,payload:{ready:true}});runtime.receive(host.self.peerId,{type:'command',command:'StartDay',requestId:2});runtime.step(1/30);await f.until(()=>runtime.world.s.phase==='DAY');
 guest.send(envelope(room,host.self.peerId,{type:'hello'}));
 await f.until(()=>welcome&&mirror&&runtime.sessions.get(guest.self.peerId)?.pendingId===null);const before=mirror.players.find(p=>p.id===welcome.selfId),initial={x:before.x,z:before.z};
 guest.send(envelope(room,host.self.peerId,{type:'command',command:'SwitchEquip',payload:{slot:'rod'},requestId:1}));
 guest.send(envelope(room,host.self.peerId,{type:'input',seq:1,dx:0,dz:1,yaw:0,pitch:0}));await f.until(()=>results.length>0);assert.equal(results[0].ok,true);
 for(let tick=0;tick<36;tick++){clock+=1000/30;f.advance(1000/30);runtime.step(1/30);await delay(5);}
 await f.until(()=>deltas>0&&runtime.sessions.get(guest.self.peerId)?.pendingId===null);assert.deepEqual(errors,[]);assert.equal(full,1);assert(chunks>1);assert(deltas>=5);assert.equal(parts.size,0);
 const player=mirror.players.find(p=>p.id===welcome.selfId);assert.equal(player.heldSlot,'rod');assert.equal(player.inputAck,1);assert(Math.hypot(player.x-initial.x,player.z-initial.z)>.1);
 const expected=structuredClone(runtime.sessions.get(guest.self.peerId).ackFrame.state),actual=structuredClone(mirror);delete actual.snapshotId;assert.deepEqual(actual,JSON.parse(JSON.stringify(expected)));
 assert.equal(Object.keys(runtime.world.s.players).length,2);for(const p of Object.values(runtime.world.s.players))assert.equal(runtime.world.equipped(p,'weapon').magazineAmmo,20);runtime.world.assertInvariants();await runtime.freezeAndSave();
});
