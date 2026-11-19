import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {createSurvivalService} from '../service.mjs';
const packagePath=new URL('../../package.json',import.meta.url),{WebSocket}=createRequire(packagePath)('ws');
test('two real ACK WebSockets compete for one turret and receive identical authoritative cannon hit IDs',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'fortress-isolated-')),service=await createSurvivalService({configPath:new URL('../../../client/survival/balance.json',import.meta.url),saveDir:path.join(directory,'save'),wsPackagePath:packagePath,manualClock:true}),http=createServer((req,res)=>res.writeHead(404).end()),clients=[];
  http.on('upgrade',(req,socket,head)=>{if(!service.handleUpgrade(req,socket,head))socket.destroy();});http.listen(0,'127.0.0.1');await once(http,'listening');t.after(async()=>{for(const c of clients)c.ws.terminate();await service.stop();await new Promise(resolve=>http.close(resolve));await rm(directory,{recursive:true,force:true});});
  async function wait(c,predicate){for(let i=0;i<200;i++){const found=c.messages.find(predicate);if(found)return found;await new Promise(r=>setTimeout(r,5));}throw Error('Expected isolated WS message missing');}
  for(let i=0;i<2;i++){const ws=new WebSocket(`ws://127.0.0.1:${http.address().port}/survival/ws`),c={ws,messages:[]};clients.push(c);ws.on('message',raw=>{const m=JSON.parse(raw);c.messages.push(...(m.type==='events'?m.events:[m]));if(m.type==='state')ws.send(JSON.stringify({type:'snapshot_ack',snapshotId:m.snapshotId}));});await once(ws,'open');ws.send(JSON.stringify({type:'hello',name:'隔离双端炮台测试',snapshotAck:true,eventBatch:true}));c.welcome=await wait(c,m=>m.type==='welcome');}
  const w=service.inspect();w.s.destructibles={};w.s.buildings.core.level=2;w.s.statistics.daysSurvived=2;w.s.bank.credits=1000;w.s.bank.materials=1000;
  for(let i=0;i<clients.length;i++){const c=clients[i],p=w.s.players[c.welcome.selfId];Object.assign(p,{x:-8-i,y:5,z:-6.5});c.ws.send(JSON.stringify({type:'command',requestId:1,command:'InstallTurret',targetId:'T01'}));}
  const results=await Promise.all(clients.map(c=>wait(c,m=>m.type==='result'&&m.requestId===1)));assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.filter(r=>r.code==='BUSY').length,1);
  for(let i=1;i<=32;i++){for(const c of clients)c.ws.send(JSON.stringify({type:'input',seq:i,dx:0,dz:0,yaw:0,pitch:0,interact:true}));await new Promise(r=>setTimeout(r,1));await service.advance(.2);}
  assert.equal(w.s.turrets.T01.ammo,60);assert.equal(w.s.bank.credits,840);assert.equal(w.s.bank.materials,970);const enemy=w.spawnEnemy('crab',-8,-18);enemy.hp=10;enemy.state='STUNNED';enemy.phaseRemaining=100;await service.advance(1.1);
  const hits=await Promise.all(clients.map(c=>wait(c,m=>m.eventType==='Hit'&&m.entityId===enemy.id&&m.payload.actorId==='T01')));assert.equal(hits[0].eventId,hits[1].eventId);assert.equal(hits[0].payload.shotId,hits[1].payload.shotId);assert.equal(hits[0].payload.damage,10);assert(hits[0].payload.killed);assert.equal(w.s.turrets.T01.ammo,59);assert.equal(w.s.enemies[enemy.id],undefined);assert.equal(Object.values(w.s.containers).filter(c=>c.type==='loot').length,1);await service.flushSave();assert.equal(service.status().ready,true);
});
