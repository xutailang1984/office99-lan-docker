import { createRequire } from 'node:module';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';
import { loadConfig } from './config.mjs';
import { SnapshotStore } from './save-store.mjs';
import { SurvivalWorld } from './world.mjs';
import {compileState,diffState,fullEnvelope,deltaEnvelope} from './state-wire.mjs';

const hash = token => createHash('sha256').update(token).digest('hex');
const nameOf = value => String(value??'渔民').replace(/[\p{C}<>]/gu,'').trim().slice(0,18)||'渔民';
async function loadWs(packagePath) {
  const candidates=packagePath?[packagePath]:[fileURLToPath(new URL('../package.json',import.meta.url)),fileURLToPath(new URL('../../../server/package.json',import.meta.url))];
  for(const file of candidates){try{await access(file);return createRequire(file)('ws');}catch(error){if(!['ENOENT','MODULE_NOT_FOUND'].includes(error.code))throw error;}}
  throw Error('Install the existing server ws dependency before starting survival.');
}

export async function createSurvivalService(options={}) {
  if(!options.saveDir||!options.configPath)throw Error('Explicit survival saveDir and configPath are required');
  const config=await loadConfig(options.configPath),store=new SnapshotStore(options.saveDir),saved=await store.load();
  let world=new SurvivalWorld(config,saved),stopping=false,stopped=false,stopPromise=null,barrierPromise=null,saveAccumulator=0,saveFault=false,nextBarrierRetry=0;
  world.s.waiting??={};
  const {WebSocketServer,WebSocket}=await loadWs(options.wsPackagePath);
  const wss=new WebSocketServer({noServer:true,maxPayload:16384,perMessageDeflate:false});
  const sessions=new Map();
  function send(ws,value,encoded=null){if(ws.readyState===WebSocket.OPEN&&ws.bufferedAmount<1024*1024){ws.send(encoded??JSON.stringify(value));return true;}if(ws.bufferedAmount>=1024*1024)ws.close(4008,'Client too slow');return false;}
  function sendState(ws,session,state,encodedBody=null,wireFrame=null){
    if(!session.snapshotAck){send(ws,state);return;}
    // A world replacement cannot inherit an old snapshot or wait forever for its old ACK.
    if(session.stateDelta&&session.stateWorldId!==state.worldId){session.stateWorldId=state.worldId;session.ackFrame=null;session.ackSnapshotId=null;session.pendingFrame=null;session.pendingSnapshotId=null;}
    if(session.pendingSnapshotId!==null)return;
    // Simulation ticks can repeat while paused or restart for a new adventure.
    // Transport IDs are unique within this connection so stale ACKs cannot unlock a newer frame.
    const snapshotId=++session.snapshotSequence;
    if(session.stateDelta){
      const frame=wireFrame??compileState(state),baseline=session.ackFrame,delta=baseline?diffState(baseline,frame):null;
      const encoded=delta&&delta.body.length<frame.fullBody.length*.85?deltaEnvelope(delta.body,snapshotId,session.ackSnapshotId):fullEnvelope(frame,snapshotId);
      if(send(ws,null,encoded)){session.pendingSnapshotId=snapshotId;session.pendingSnapshotSentAt=performance.now();session.pendingFrame=frame;}
      return;
    }
    if(send(ws,encodedBody?null:{...state,snapshotId},encodedBody?'{'+'"snapshotId":'+snapshotId+','+encodedBody.slice(1):null)){session.pendingSnapshotId=snapshotId;session.pendingSnapshotSentAt=performance.now();}
  }
  function broadcast(value){let encoded,wireFrame=null;if(value.type==='state'){const {snapshotId,...body}=value;encoded=JSON.stringify(body);if([...sessions.values()].some(s=>s.hello&&s.stateDelta&&(s.pendingSnapshotId===null||s.stateWorldId!==value.worldId)))wireFrame=compileState(value);}else encoded=JSON.stringify(value);for(const [ws,session]of sessions)if(session.hello){
    if(value.type==='event'&&session.snapshotAck&&session.pendingSnapshotId!==null&&performance.now()-session.pendingSnapshotSentAt>1000)continue;
    if(value.type==='state')sendState(ws,session,value,encoded,wireFrame);else send(ws,value,encoded);
  }}
  function currentState(){const state=world.publicState(store.status());state.paused=state.paused||saveFault;return state;}
  function welcome(ws,session){const p=world.s.players[session.playerId];send(ws,{type:'welcome',token:session.token,selfId:p?.id??session.spectatorId,slotId:p?.slotId??null,spectator:!p,protocolVersion:3,build:'0.11.6',stateDelta:session.stateDelta?1:0,maxPlayers:config.baseline.max_players,catalog:world.catalog(),world:world.staticWorld()});sendState(ws,session,currentState());}
  function promoteSpectators(){if(world.s.phase==='COMPLETE')return;for(const [ws,session]of sessions){if(!session.hello||session.playerId)continue;const tokenHash=hash(session.token);let p=Object.values(world.s.players).find(candidate=>candidate.tokenHash===tokenHash);if(!p&&Object.keys(world.s.players).length>=config.baseline.max_players)continue;if(!p)p=world.allocate(session.name,tokenHash);else {for(const [other,existing]of sessions)if(other!==ws&&existing.playerId===p.id){existing.playerId=null;existing.hello=false;other.close(4001,'Session replaced');}world.connect(p,session.name);}session.playerId=p.id;delete world.s.waiting[session.spectatorId];welcome(ws,session);}}
  function dispatchEvents(){
    const events=world.drainEvents();if(!events.length)return;
    // ws exposes its owned net.Socket internally; cork the whole synchronous batch so
    // separate protocol frames share one OS write without changing client messages.
    const sockets=[...sessions.keys()].filter(ws=>ws.readyState===WebSocket.OPEN).map(ws=>ws._socket).filter(Boolean);
    for(const socket of sockets)socket.cork();try{for(const event of events)broadcast(event);}finally{for(const socket of sockets)socket.uncork();}
  }
  async function flushSave(){try{world.resolveDamage();world.resolveNight();world.assertInvariants();await store.save(world.serialize());world.requestSave=false;saveFault=false;return store.status();}catch(error){saveFault=true;throw error;}}
  async function performBarrier(force=false){
    if(barrierPromise)return barrierPromise;
    if(!force&&performance.now()<nextBarrierRetry)return;
    barrierPromise=(async()=>{try{await flushSave();if(!stopping&&world.needsBarrier)world.finishDayBarrier();}catch{nextBarrierRetry=performance.now()+2000;broadcast({type:'error',code:'SAVE_FAILED',message:'出发前存档失败，世界已暂停。请检查磁盘后重试保存。'});}finally{barrierPromise=null;}})();return barrierPromise;
  }
  async function resetAdventure(){
    const oldWorld=world;world.newAdventureRequested=false;world.s.paused=true;
    try{await store.archive(world.serialize());const identities=Object.values(world.s.players).map(p=>({id:p.id,name:p.name,tokenHash:p.tokenHash,connected:p.connected,requestHighWater:p.requestHighWater,requestCache:p.requestCache,actionSeq:p.actionSeq??0,hitSeq:p.hitSeq??0}));world=new SurvivalWorld(config);world.s.waiting={};
      for(const identity of identities){const p=world.allocate(identity.name,identity.tokenHash);p.connected=identity.connected;p.requestHighWater=identity.requestHighWater;p.requestCache=identity.requestCache;p.actionSeq=identity.actionSeq;p.hitSeq=identity.hitSeq;}
      world.s.hostId=Object.values(world.s.players).find(p=>p.connected)?.id??null;world.s.paused=!world.s.hostId;await flushSave();for(const [ws,session]of sessions)if(session.hello)welcome(ws,session);
    }catch{world=oldWorld;world.s.paused=!Object.values(world.s.players).some(p=>p.connected);broadcast({type:'error',code:'SAVE_FAILED',message:'未能归档旧冒险，新冒险没有开始'});}
  }
  function simulateStep(dt){
    if(stopping||stopped)return;
    if(!saveFault){promoteSpectators();world.step(dt);}saveAccumulator+=dt;
    if(world.needsBarrier&&!barrierPromise)void performBarrier();
    if(world.newAdventureRequested&&!barrierPromise){barrierPromise=resetAdventure().finally(()=>{barrierPromise=null;});}
    if(saveAccumulator>=config.session.save_interval_seconds&&!store.pending&&!barrierPromise){saveAccumulator=0;void flushSave().catch(()=>broadcast({type:'error',code:'SAVE_FAILED',message:'自动存档失败，世界已暂停保护内存进度；请检查磁盘后重试保存'}));}
    dispatchEvents();
  }
  let timer=null,snapshotTimer=null;
  if(!options.manualClock){let previous=performance.now(),heartbeatAt=previous,accumulator=0;timer=setInterval(()=>{const now=performance.now();accumulator+=Math.min(.25,(now-previous)/1000);previous=now;const dt=1/config.session.server_hz;while(accumulator>=dt){simulateStep(dt);accumulator-=dt;}if(now-heartbeatAt>=10000){heartbeatAt=now;for(const [ws,session]of sessions){if(!session.alive){ws.terminate();continue;}session.alive=false;ws.ping();}}},Math.max(5,Math.floor(1000/config.session.server_hz)));
    // Schedule against a monotonic deadline so OS timer rounding cannot accumulate drift.
    // Skip missed snapshots instead of sending catch-up bursts to clients.
    const period=1000/config.session.snapshot_hz;let nextSnapshotAt=performance.now()+period;
    const emitSnapshot=()=>{if(stopping||stopped)return;broadcast(currentState());const now=performance.now();nextSnapshotAt+=period;if(nextSnapshotAt<=now)nextSnapshotAt=now+period;snapshotTimer=setTimeout(emitSnapshot,Math.max(1,nextSnapshotAt-now));};snapshotTimer=setTimeout(emitSnapshot,period);
  }
  wss.on('connection',(ws)=>{
    const session={hello:false,playerId:null,spectatorId:null,name:'',token:null,windowAt:performance.now(),count:0,alive:true,snapshotAck:false,snapshotSequence:0,pendingSnapshotId:null,pendingSnapshotSentAt:0,stateDelta:false,stateWorldId:null,ackFrame:null,ackSnapshotId:null,pendingFrame:null,lastResyncAt:-Infinity};sessions.set(ws,session);ws.on('pong',()=>{session.alive=true;});
    const timeout=setTimeout(()=>{if(!session.hello)ws.close(4000,'Hello required');},5000);timeout.unref();
    ws.on('message',buffer=>{
      if(stopping||stopped)return;
      const now=performance.now();if(now-session.windowAt>1000){session.windowAt=now;session.count=0;}if(++session.count>100){ws.close(4008,'Rate limit');return;}
      let data;try{data=JSON.parse(buffer.toString());}catch{send(ws,{type:'error',code:'INVALID_TARGET',message:'消息格式无效'});return;}
      if(!data||typeof data!=='object'||Array.isArray(data))return;
      if(!session.hello){
        if(data.type!=='hello')return;
        const name=nameOf(data.name);let token=data.token,p=null,pending=null;
        if(token!==undefined&&token!==null&&token!==''){
          if(typeof token!=='string'||!/^[-_A-Za-z0-9]{32,128}$/.test(token)){send(ws,{type:'error',code:'UNKNOWN_PROFILE',message:'角色凭证无效，请使用原浏览器角色'});ws.close(4003,'Unknown profile');return;}
          const tokenHash=hash(token);p=Object.values(world.s.players).find(x=>x.tokenHash===tokenHash);pending=Object.entries(world.s.waiting).find(([,x])=>x.tokenHash===tokenHash);
          if(!p&&!pending){send(ws,{type:'error',code:'UNKNOWN_PROFILE',message:'没有找到原角色，现有进度未被替换'});ws.close(4003,'Unknown profile');return;}
        }else {if(Object.keys(world.s.players).length>=config.baseline.max_players||(world.s.phase==='COMPLETE'&&Object.keys(world.s.waiting).length>=config.baseline.max_players)||sessions.size>config.baseline.max_players*2){send(ws,{type:'error',code:'ROOM_FULL',message:'持久角色槽或结算观察位置已经占用'});ws.close(4004,'Room full');return;}token=randomBytes(32).toString('base64url');}
        if(!p&&world.s.phase!=='COMPLETE'&&Object.keys(world.s.players).length>=config.baseline.max_players){send(ws,{type:'error',code:'ROOM_FULL',message:'持久角色槽已经占用'});ws.close(4004,'Room full');return;}
        session.name=name;session.token=token;session.stateDelta=data.stateDelta===1;session.snapshotAck=data.snapshotAck===true||session.stateDelta;session.hello=true;clearTimeout(timeout);
        if(p){for(const [other,existing]of sessions)if(other!==ws&&existing.playerId===p.id){existing.playerId=null;existing.hello=false;other.close(4001,'Session replaced');}world.connect(p,name);session.playerId=p.id;}
        else if(world.s.phase!=='COMPLETE'){p=world.allocate(name,hash(token));session.playerId=p.id;if(pending)delete world.s.waiting[pending[0]];}
        else {session.spectatorId=pending?.[0]??world.id('spectator');world.s.waiting[session.spectatorId]={name,tokenHash:hash(token)};}
        welcome(ws,session);return;
      }
      if(data.type==='snapshot_ack'){
        if(session.snapshotAck&&Number.isSafeInteger(data.snapshotId)&&data.snapshotId===session.pendingSnapshotId){if(session.stateDelta){session.ackFrame=session.pendingFrame;session.ackSnapshotId=data.snapshotId;session.pendingFrame=null;}session.pendingSnapshotId=null;}
        return;
      }
      if(data.type==='state_resync'){
        if(session.stateDelta&&now-session.lastResyncAt>=1000){session.lastResyncAt=now;session.ackFrame=null;session.ackSnapshotId=null;session.pendingFrame=null;session.pendingSnapshotId=null;sendState(ws,session,currentState());}
        return;
      }
      const p=world.s.players[session.playerId];if(!p)return;
      if(data.type==='input')world.input(p,data);
      else if(data.type==='command'){
        if((world.needsBarrier||barrierPromise||saveFault)&&data.command!=='Save'){send(ws,{type:'result',requestId:data.requestId,ok:false,code:saveFault?'SAVE_FAILED':'BUSY',message:saveFault?'存档故障，世界已暂停，请先重试保存':'正在保存阶段状态，请稍后重试'});return;}
        try{send(ws,world.command(p,data));if(data.command==='Save')void (world.needsBarrier?performBarrier(true):flushSave()).then(()=>send(ws,{type:'event',eventType:'SaveResult',payload:{ok:!saveFault}})).catch(()=>send(ws,{type:'error',code:'SAVE_FAILED',message:'保存失败'}));dispatchEvents();}
        catch{send(ws,{type:'error',code:'INVALID_TARGET',message:'操作无法完成，请重新连接后重试'});}
      }
    });
    ws.on('close',()=>{clearTimeout(timeout);sessions.delete(ws);if(!stopping&&session.playerId){const p=world.s.players[session.playerId];if(p)world.disconnect(p);} });
    ws.on('error',()=>{});
  });
  function handleUpgrade(req,socket,head){
    let pathname;try{pathname=new URL(req.url,'http://local').pathname;}catch{return false;}
    if(pathname!=='/survival/ws')return false;
    if(stopping||stopped||sessions.size>=config.baseline.max_players*3){socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');return true;}
    if(req.headers.origin){try{const origin=new URL(req.headers.origin);if(!['http:','https:'].includes(origin.protocol)||origin.host!==req.headers.host)throw Error();}catch{socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return true;}}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));return true;
  }
  async function stop(){
    if(stopped)return;if(stopPromise)return stopPromise;stopping=true;clearInterval(timer);clearInterval(snapshotTimer);
    stopPromise=(async()=>{if(barrierPromise)await barrierPromise;await flushSave();for(const ws of sessions.keys())ws.close(1001,'Server stopping');await new Promise(resolve=>{const timer=setTimeout(()=>{for(const ws of sessions.keys())ws.terminate();resolve();},250);wss.close(()=>{clearTimeout(timer);resolve();});});stopped=true;})();
    try{await stopPromise;}catch(error){stopPromise=null;throw error;}
  }
  const service={handleUpgrade,stop,flushSave,status:()=>({service:'tidal-survival',maxPlayers:config.baseline.max_players,protocolVersion:3,build:'0.11.6',ready:!stopping&&!stopped,worldId:world.s.worldId,phase:world.s.phase,dayIndex:world.s.dayIndex,threatStage:world.s.threatStage,players:Object.values(world.s.players).filter(p=>p.connected).length,paused:world.s.paused||saveFault,save:store.status()})};
  // Test-only local API, never registered as a WebSocket or HTTP command.
  if(options.manualClock){service.advance=async seconds=>{const dt=1/config.session.server_hz;for(let elapsed=0;elapsed<seconds-1e-9;elapsed+=dt){simulateStep(Math.min(dt,seconds-elapsed));if(barrierPromise)await barrierPromise;}broadcast(currentState());await Promise.resolve();};service.inspect=()=>world;}
  if(!saved){try{await flushSave();}catch(error){clearInterval(timer);clearInterval(snapshotTimer);wss.close();throw error;}}
  return service;
}
