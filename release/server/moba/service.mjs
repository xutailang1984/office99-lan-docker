import {WebSocketServer,WebSocket} from 'ws';
import {randomUUID,createHash} from 'node:crypto';
import {HERO_IDS,HEROES,ROLE_IDS,ROLE_HEROES,VERSION} from './catalog.mjs';
import {MobaWorld} from './world.mjs';
import {MAP} from './map.mjs';
const clean=(s,n=24)=>String(s??'').replace(/[\p{C}<>]/gu,'').trim().slice(0,n);
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function createMobaService({authenticate,now=Date.now,roomLimit=8,manualClock=false}={}){
 if(typeof authenticate!=='function')throw Error('MOBA requires authenticated identities');
 const rooms=new Map(),connections=new Map();let stopped=false;
 const wss=new WebSocketServer({noServer:true,maxPayload:1024*1024,perMessageDeflate:false});
 const send=(c,m)=>{if(c?.ws.readyState!==WebSocket.OPEN)return false;if(c.ws.bufferedAmount>2*1024*1024){c.ws.close(4008,'Slow client');return false;}c.ws.send(JSON.stringify(m));return true;};
 const fail=(c,code,message)=>send(c,{type:'error',code,message});
 const publicRoom=r=>({id:r.id,title:r.title,status:r.status,epoch:r.epoch,hostPeerId:r.hostPeerId,revision:r.revision,maxPlayers:10,winner:r.winner,roster:r.seats.map(({accountId,...s})=>({...s}))});
 const list=()=>[...rooms.values()].map(r=>({id:r.id,title:r.title,status:r.status,players:r.seats.filter(s=>!s.bot).length,maxPlayers:10}));
 const broadcastLobby=()=>{for(const c of connections.values())if(!c.roomId)send(c,{type:'rooms',rooms:list()});};
 const changed=r=>{const data={type:'room',room:publicRoom(r)},final=r.status==='finished'&&r.checkpoint?new MobaWorld({state:r.checkpoint.state}):null;for(const c of connections.values())if(c.roomId===r.id){send(c,data);const s=r.seats.find(s=>s.peerId===c.peerId);if(final&&s)send(c,{type:'final_state',epoch:r.epoch,state:final.snapshot(s.team,s.id)});}broadcastLobby();};
 const member=(r,c)=>r.seats.find(s=>s.accountId===c.account.id);
 const connectionForSeat=s=>[...connections.values()].find(c=>c.peerId===s.peerId);
 const closeRoom=(r,reason)=>{if(!rooms.delete(r.id))return;for(const c of connections.values())if(c.roomId===r.id){c.roomId=null;send(c,{type:'room',room:null,reason});}r.checkpoint=null;broadcastLobby();};
 function initHost(r){const c=[...connections.values()].find(c=>c.peerId===r.hostPeerId);if(!c)return;send(c,{type:'host_init',epoch:r.epoch,revision:r.revision,roster:publicRoom(r).roster,state:r.checkpoint?.state??null});}
 function resumeIfReady(r){if(['loading','migrating'].includes(r.status)&&r.hostReady&&r.seats.filter(s=>s.connected&&!s.bot).every(s=>s.loaded)){r.status='running';r.deadline=0;changed(r);const c=[...connections.values()].find(c=>c.peerId===r.hostPeerId);send(c,{type:'resume',epoch:r.epoch});}}
 function migrate(r){
  const next=r.seats.filter(s=>s.connected&&!s.bot).map(connectionForSeat).find(Boolean);
  if(!next){closeRoom(r,'队伍已离开，对局结束。');return;}
  if(r.status==='waiting'){r.hostPeerId=next.peerId;r.epoch++;changed(r);return;}
  if(!r.checkpoint){closeRoom(r,'主机离开，尚无恢复点，本局未结算。');return;}
  if(r.status==='finished'){r.hostPeerId=next.peerId;r.epoch++;changed(r);return;}
  r.epoch++;r.hostPeerId=next.peerId;r.status='migrating';r.hostReady=false;r.deadline=now()+45000;r.lastPulse=now();changed(r);initHost(r);
 }
 function detach(c,explicit=false){
  const r=rooms.get(c.roomId);c.roomId=null;if(!r)return;const s=member(r,c);if(!s)return;
  if(s.peerId!==c.peerId)return;
  s.connected=false;s.peerId=null;s.loaded=false;s.ready=false;
  // Before a match there is no character progress to reserve. Release offline
  // seats so one closed tab cannot permanently block everyone else's Ready.
  if(r.status==='waiting')r.seats=r.seats.filter(v=>v!==s);
  const wasHost=r.hostPeerId===c.peerId;
  if(!r.seats.some(s=>s.connected&&!s.bot)){
   if(explicit||r.status!=='waiting'&&!r.checkpoint){closeRoom(r,'队伍已离开，对局结束。');return;}
   r.hostPeerId=null;r.hostReady=false;r.epoch++;r.deadline=now()+120000;
   if(!['waiting','finished'].includes(r.status))r.status='migrating';changed(r);return;
  }
  if(wasHost)migrate(r);else {changed(r);const host=[...connections.values()].find(p=>p.peerId===r.hostPeerId);send(host,{type:'membership',epoch:r.epoch,roster:publicRoom(r).roster});}
  if(explicit)send(c,{type:'room',room:null,reason:'已返回大厅，本局席位暂时保留。'});
 }
 function add(c,r){
  if(c.roomId&&c.roomId!==r.id)return fail(c,'ALREADY_JOINED','请先退出当前房间');
  let s=member(r,c);
  if(r.status!=='waiting'&&!s)return fail(c,'MATCH_STARTED','本局已经开始，可等待下一局');
  if(!s){
   const used=new Set(r.seats.map(s=>s.id)),slot=Array.from({length:10},(_,i)=>i).find(i=>!used.has('s'+i));if(slot===undefined)return fail(c,'FULL','房间已满');
   const team=r.seats.filter(s=>s.team===0).length<=r.seats.filter(s=>s.team===1).length?0:1;
   const role=ROLE_IDS.find(id=>!r.seats.some(s=>s.team===team&&HEROES[s.heroId].roleId===id));
   const heroId=ROLE_HEROES[role][team%2];
   s={id:'s'+slot,accountId:c.account.id,name:clean(c.account.name),heroId,team,ready:false,bot:false,loaded:false};r.seats.push(s);
  }
  const old=s.peerId&&[...connections.values()].find(v=>v.peerId===s.peerId);if(old&&old!==c){old.roomId=null;old.ws.close(4001,'Reconnected elsewhere');}
  s.peerId=c.peerId;s.connected=true;s.loaded=false;c.roomId=r.id;
  const restoreHost=!r.hostPeerId;if(restoreHost){r.hostPeerId=c.peerId;r.lastPulse=now();if(['waiting','finished'].includes(r.status))r.deadline=0;}
  changed(r);if(restoreHost&&!['waiting','finished'].includes(r.status)){initHost(r);return;}
  if(r.status!=='waiting'){const host=[...connections.values()].find(v=>v.peerId===r.hostPeerId);send(host,{type:'membership',epoch:r.epoch,roster:publicRoom(r).roster});}
 }
 function begin(c,r){
  if(c.peerId!==r.hostPeerId)return fail(c,'HOST_REQUIRED','由房主开始');
  if(r.status!=='waiting')return fail(c,'BAD_STATE','对局已经开始');
  if(r.seats.some(s=>!s.ready))return fail(c,'NOT_READY','等待所有队员准备');
  const used=new Set(r.seats.map(s=>s.id));
  for(let team=0;team<2;team++)for(const role of ROLE_IDS)if(!r.seats.some(s=>s.team===team&&HEROES[s.heroId].roleId===role)){
   const heroId=ROLE_HEROES[role][team%2];
   const slot=Array.from({length:10},(_,i)=>i).find(i=>!used.has('s'+i));used.add('s'+slot);r.seats.push({id:'s'+slot,accountId:null,name:'电脑 · '+HEROES[heroId].name,team,heroId,bot:true,connected:false,ready:true,loaded:true,peerId:null});
  }
  r.status='loading';r.hostReady=false;r.deadline=now()+120000;r.lastPulse=now();changed(r);initHost(r);
 }
 function packet(c,m){
  if(!m||typeof m!=='object'||Array.isArray(m))return;
  if(m.type==='list'){send(c,{type:'rooms',rooms:list()});return;}
  if(m.type==='create'){
   if(c.roomId)return fail(c,'ALREADY_JOINED','请先退出当前房间');if(rooms.size>=roomLimit)return fail(c,'ROOM_LIMIT','房间已满，请加入已有房间');
   const r={id:randomUUID(),title:clean(m.title)||'同事对抗',status:'waiting',epoch:1,hostPeerId:c.peerId,seats:[],revision:0,checkpoint:null,winner:null,lastPulse:now(),createdAt:now()};rooms.set(r.id,r);add(c,r);return;
  }
  if(m.type==='join'){const r=rooms.get(m.roomId);if(!r)return fail(c,'NOT_FOUND','房间已结束');add(c,r);return;}
  if(m.type==='leave'){detach(c,true);return;}
  const r=rooms.get(c.roomId);if(!r)return fail(c,'ROOM_REQUIRED','请先加入房间');const s=member(r,c);if(!s||s.peerId!==c.peerId)return;
  if(m.epoch!==undefined&&m.epoch!==r.epoch)return fail(c,'STALE_HOST','主机已切换，请等待恢复');
  if(m.roomId!==undefined&&m.roomId!==r.id)return;
  if(m.type==='select'){
   if(r.status!=='waiting')return fail(c,'MATCH_STARTED','对局中不能更换英雄');
   if(m.heroId!==undefined&&!HERO_IDS.includes(m.heroId))return fail(c,'INVALID_HERO','请选择列表中的英雄');
   const team=m.team===0||m.team===1?m.team:s.team,heroId=m.heroId??s.heroId;
   if(r.seats.some(v=>v!==s&&v.team===team&&HEROES[v.heroId].roleId===HEROES[heroId].roleId))return fail(c,'HERO_TAKEN','同队已有人选择这个定位');
   if(r.seats.filter(v=>v!==s&&v.team===team).length>=5)return fail(c,'TEAM_FULL','这支队伍已满');
   s.team=team;s.heroId=heroId;s.ready=false;changed(r);return;
  }
  if(m.type==='ready'&&r.status==='waiting'){s.ready=!s.ready;changed(r);return;}
  if(m.type==='begin'){begin(c,r);return;}
  if(m.type==='rematch'){
   if(c.peerId!==r.hostPeerId||r.status!=='finished')return fail(c,'BAD_STATE','等待房主开启下一局');
   r.seats=r.seats.filter(v=>!v.bot&&v.connected);for(const v of r.seats){v.ready=false;v.loaded=false;}r.status='waiting';r.epoch++;r.revision=0;r.checkpoint=null;r.winner=null;r.hostReady=false;r.deadline=0;r.createdAt=now();changed(r);return;
  }
  if(m.type==='loaded'){if(m.epoch!==r.epoch||!['loading','running','migrating'].includes(r.status))return;s.loaded=true;resumeIfReady(r);return;}
  if(m.type==='host_ready'){if(c.peerId!==r.hostPeerId||m.epoch!==r.epoch)return fail(c,'HOST_REQUIRED','主机身份无效');if(!['loading','migrating'].includes(r.status))return;r.hostReady=true;r.lastPulse=now();resumeIfReady(r);return;}
  if(m.type==='pulse'){if(c.peerId===r.hostPeerId&&m.epoch===r.epoch)r.lastPulse=now();return;}
  if(m.type==='checkpoint'){
   if(c.peerId!==r.hostPeerId||m.epoch!==r.epoch)return fail(c,'HOST_REQUIRED','主机身份无效');
   if(!Number.isSafeInteger(m.revision)||m.revision<1)return fail(c,'INVALID_CHECKPOINT','恢复点无效');
   if(m.revision===r.revision){if(hash(m.state)===r.checkpoint?.hash)send(c,{type:'checkpoint_ack',epoch:r.epoch,revision:r.revision});else fail(c,'CHECKPOINT_CONFLICT','恢复点内容冲突');return;}
   if(!['loading','running','migrating'].includes(r.status))return;
   if(m.revision!==r.revision+1)return fail(c,'CHECKPOINT_ORDER','恢复点顺序无效');
   try{MobaWorld.validate(m.state);if(m.state.heroes.some(h=>!r.seats.some(s=>s.id===h.id&&s.heroId===h.heroId&&s.team===h.team)))throw Error('roster');if(r.checkpoint&&m.state.tick<r.checkpoint.state.tick)throw Error('time');}catch{return fail(c,'INVALID_CHECKPOINT','恢复点校验失败');}
   r.checkpoint={state:structuredClone(m.state),hash:hash(m.state),at:now()};r.revision=m.revision;r.lastPulse=now();send(c,{type:'checkpoint_ack',epoch:r.epoch,revision:r.revision});
   if(m.state.phase==='finished'){r.status='finished';r.winner=m.state.winner;changed(r);}return;
  }
  if(m.type==='signal'){
   const target=[...connections.values()].find(v=>v.peerId===m.to&&v.roomId===r.id);
   if(!target||c.peerId!==r.hostPeerId&&target.peerId!==r.hostPeerId)return fail(c,'INVALID_PEER','连接目标无效');
   if(m.roomId!==r.id||JSON.stringify(m.signal??{}).length>20000)return;send(target,{type:'signal',from:c.peerId,roomId:r.id,epoch:r.epoch,signal:m.signal});return;
  }
  if(m.type==='relay'){
   const host=c.peerId===r.hostPeerId,target=host?[...connections.values()].find(v=>v.peerId===m.to&&v.roomId===r.id):[...connections.values()].find(v=>v.peerId===r.hostPeerId);
   if(!target||m.epoch!==r.epoch||!['running','migrating','loading','finished'].includes(r.status))return;
   if(typeof m.data!=='string'||m.data.length>(host?200000:4096))return;
   if(m.roomId!==r.id)return;send(target,{type:'relay',from:c.peerId,roomId:r.id,seatId:s.id,epoch:r.epoch,data:m.data});return;
  }
  if(m.type==='chat'){
   if(now()-(c.lastChat??0)<600)return;c.lastChat=now();const text=clean(m.text,160);if(!text)return;
   for(const target of connections.values())if(target.roomId===r.id&&(r.status==='waiting'||member(r,target)?.team===s.team))send(target,{type:'chat',name:s.name,text,team:s.team});return;
  }
  if(m.type==='map_ping'){
   if(r.status!=='running'||now()-(c.lastMapPing??0)<1200||!['go','danger','help'].includes(m.kind)||!Number.isFinite(m.x)||!Number.isFinite(m.z)||Math.abs(m.x)>MAP.boundary||Math.abs(m.z)>MAP.boundary)return;
   c.lastMapPing=now();for(const target of connections.values())if(target.roomId===r.id&&member(r,target)?.team===s.team)send(target,{type:'map_ping',kind:m.kind,x:m.x,z:m.z,name:s.name});return;
  }
 }
 wss.on('connection',(ws,req,account)=>{
  const old=connections.get(account.id),previous=rooms.get(old?.roomId),oldSeat=previous&&member(previous,old),wasHost=previous?.hostPeerId===old?.peerId;
  if(old){old.roomId=null;old.ws.close(4001,'Session replaced');}
  const c={ws,req,account,peerId:randomUUID(),roomId:null,alive:true,windowAt:now(),messages:0};connections.set(account.id,c);
  ws.on('error',()=>{});ws.on('pong',()=>{c.alive=true;});
  send(c,{type:'welcome',self:{peerId:c.peerId,name:clean(account.name)},rooms:list(),version:VERSION});
  if(previous&&oldSeat){oldSeat.peerId=c.peerId;oldSeat.connected=true;oldSeat.loaded=false;c.roomId=previous.id;
   if(wasHost){previous.hostPeerId=c.peerId;previous.epoch++;previous.hostReady=false;if(!['waiting','finished'].includes(previous.status)){previous.status='migrating';previous.deadline=now()+120000;previous.lastPulse=now();}}
   changed(previous);if(wasHost&&!['waiting','finished'].includes(previous.status))initHost(previous);else if(!wasHost){const host=[...connections.values()].find(v=>v.peerId===previous.hostPeerId);send(host,{type:'membership',epoch:previous.epoch,roster:publicRoom(previous).roster});}
  }
  ws.on('message',(raw,binary)=>{
   if(stopped||binary||connections.get(account.id)!==c)return;
   const identity=authenticate(req);if(!identity||identity.id!==account.id){ws.close(4003,'Login required');return;}
   if(now()-c.windowAt>=1000){c.windowAt=now();c.messages=0;c.bytes=0;}
   const activeRoom=rooms.get(c.roomId),isHost=activeRoom?.hostPeerId===c.peerId;
   const peers=isHost?activeRoom.seats.filter(s=>s.connected&&s.peerId&&s.peerId!==c.peerId).length:0;
   // One host relays each snapshot to up to nine clients. Budget that fan-out,
   // while still bounding message count and bytes for every authenticated peer.
   const limit=isHost?200+60*peers:200;c.bytes=(c.bytes??0)+raw.length;
   if(++c.messages>limit||c.bytes>(isHost?(2+3*peers)*1024*1024:256*1024)){ws.close(4008,'Rate limit');return;}
   try{packet(c,JSON.parse(raw));}catch{fail(c,'INVALID_MESSAGE','操作未完成，请重试');}
  });
  ws.on('close',()=>{if(connections.get(account.id)===c){connections.delete(account.id);detach(c);}broadcastLobby();});
 });
 function handleUpgrade(req,socket,head){const auth=authenticate(req);let origin=false;try{origin=!req.headers.origin||new URL(req.headers.origin).host===req.headers.host;}catch{}
  if(stopped||!auth||!origin){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
  wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req,auth));
 }
 function handleRequest(req,res){if(new URL(req.url,'http://local').pathname!=='/moba/status')return false;res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({enabled:true,version:VERSION,maxPlayers:10,rooms:rooms.size}));return true;}
 function sweep(){
  for(const c of connections.values())if(!authenticate(c.req)){c.ws.close(4003,'Login required');}else if(!c.alive)c.ws.terminate();else{c.alive=false;c.ws.ping();}
  for(const r of [...rooms.values()]){
   if(r.deadline&&r.deadline<now()){closeRoom(r,'加载或恢复超时，本局未结算，请重新开房。');continue;}
   if(r.status==='running'&&now()-r.lastPulse>15000){const c=[...connections.values()].find(c=>c.peerId===r.hostPeerId);if(c){detach(c);send(c,{type:'room',room:null,reason:'主机响应中断，对局已交接。'});}else migrate(r);}
   if(r.status==='waiting'&&now()-r.createdAt>3*3600000)closeRoom(r,'房间等待超时，请重新创建。');
  }
 }
 const timer=manualClock?null:setInterval(sweep,10000);timer?.unref();
 async function stop(){if(stopped)return;stopped=true;clearInterval(timer);for(const r of [...rooms.values()])closeRoom(r,'服务已停止，本局未结算。');for(const c of connections.values())c.ws.terminate();connections.clear();await new Promise(resolve=>wss.close(resolve));}
 return{handleUpgrade,handleRequest,stop,sweep,status:()=>({enabled:!stopped,rooms:rooms.size,online:connections.size})};
}
