import {renderLobby} from './lobby-view.mjs';
import {LinkPolicy} from './link-policy.mjs';
import {roomHasPeer,rememberRetiredMembers,isRetiredRelayNotice} from './retired-peer.mjs';
import {createLoadingUI} from './loading-ui.mjs';
import {chatSubmission,routeGmSignal} from './gm-client.mjs';
import {createOnboardingChannel} from './onboarding-client.mjs';
import {createPointerGuard} from './pointer-guard.mjs';
import {BrowserCheckpointStore} from './checkpoint-store.mjs';
const localCheckpoints=new BrowserCheckpointStore();
let saveStatus={localRevision:0,remoteRevision:0,backupPending:false,error:null},lostRoom=false,lossJob=null;
const $=id=>document.getElementById(id);
let account=null,signal=null,self=null,room=null,worker=null,workerReady=false,workerInitFailed=false,workerFailed=false,roomExitSaved=false,workerPulse=0,revision=0;
let frame=null,queue=[],registerMode=false,leaving=false,refreshTimer=null,heartbeatTimer=null,toastTimer=null,gameEntered=false,frameLoaded=false;
let chatOpen=false,chatUnread=0,nativeUI={overlay:'lobby',resumeOverlay:'lobby',resumeCapture:false};
let pointerGuard=null;
let signalConnecting=null,lobbyBusy=false,lobbySnapshot={adventures:[],rooms:[]},refreshJob=null,refreshGeneration=0,roomGeneration=0,deleteTarget=null,deletePending=false,createTarget=null,createPending=false,practicePending=false;
let missionReadyRequested=false,missionStartRequested=false,missionCompleting=false,missionCompletionShown=false,missionCompletionRetries=0,missionRetryTimer=null;
const peers=new Map(),retiredPeers=new Set(),workerBacklog=[],closedWaiters=[];
const loading=createLoadingUI({element:$('game-loading'),back:()=>leaveRoom(),transport:()=>({ready:transportReady(),relay:relayActive(),failed:room?.ownerId!==account?.id&&peers.get(room?.hostPeerId)?.policy?.mode==='failed'})});
const messages={disconnected:'房主离开了。最近的进度已保留，可以等房主再开房。',host_timeout:'房主连接中断。最近的进度已保留。',host_closed:'房间已结束，进度已保留。',session_replaced:'这个账号已在另一个网页登录。'};
function toast(text){
 clearTimeout(toastTimer);
 if(frame&&frameLoaded&&!workerFailed){$('toast').classList.add('hidden');pushPacket(JSON.stringify({type:'platform_notice',text:String(text).slice(0,500)}));return;}
 (frame?$('game-stage'):$('shell')).prepend($('toast'));$('toast').textContent=text;$('toast').classList.remove('hidden');toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),6500);
}
function failGame(message){pointerGuard?.sync();loading.fail(message,frameLoaded?'游戏已暂停':'游戏没能打开');$('game-enter').classList.add('hidden');$('game-entry').classList.add('hidden');if(frame)pushPacket(JSON.stringify({type:'platform_focus',active:true}));}
async function api(endpoint,{method='GET',body}={}){const response=await fetch('/api/platform/'+endpoint,{method,credentials:'same-origin',signal:AbortSignal.timeout(8000),headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});let data;try{data=await response.json();}catch{throw Error('服务器暂时没有回应，请稍后重试。');}if(!response.ok){const error=Error(data.error?.message||'操作没有完成，请重试。');error.status=response.status;error.code=data.error?.code;throw error;}return data;}
function send(value){if(signal?.readyState===WebSocket.OPEN)signal.send(JSON.stringify(value));}
function show(view){document.body.dataset.view=view;for(const id of ['auth-view','lobby-view','room-view'])$(id).classList.toggle('hidden',id!==view);}
function formError(id,message){const error=$(id);error.textContent=message;const body=error.closest('.auth-body,.dialog-body');if(body&&message)body.scrollTop=body.scrollHeight;}
function textElement(tag,text,cls){const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;}
function button(text,fn,cls='secondary'){const b=textElement('button',text,cls);b.type='button';b.onclick=()=>Promise.resolve(fn()).catch(e=>toast(e.message));return b;}
function empty(text,symbol='◈'){const e=textElement('div','','empty-state');e.append(textElement('b',symbol),document.createTextNode(text));return e;}
function row({title,detail,icon,action,label}){const e=textElement('div','','list-row'),copy=textElement('div','','row-copy');copy.append(textElement('b',title),textElement('small',detail));e.append(textElement('span',icon,'row-icon'),copy,button(label,action));return e;}
async function connectSignal(){
 if(signal?.readyState===WebSocket.OPEN&&self)return;
 if(signalConnecting)return signalConnecting;
 const socket=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/platform/signal');
 signal=socket;self=null;
 const job=new Promise((resolve,reject)=>{
  let welcomed=false;
  const fail=message=>{if(welcomed)return;clearTimeout(timeout);reject(Error(message));};
  const timeout=setTimeout(()=>{fail('大厅连接超时，请重试。');socket.close();},8000);
  socket.onmessage=({data})=>{
   if(signal!==socket)return;
   let m;try{m=JSON.parse(data);}catch{return;}
   if(m.type==='session'){welcomed=true;clearTimeout(timeout);self=m.self;resolve();return;}
   if(!welcomed)return;
   if(m.type==='gm_notice'||m.type==='gm_grant'){routeGmSignal(m,{room,accountId:account?.id,selfPeerId:self?.peerId,worker,leaving,workerFailed},addChat);return;}
   if(m.type==='member_resets'){
    if(!leaving&&room?.id===m.roomId&&room?.epoch===m.epoch&&room?.ownerId===account?.id&&Number.isSafeInteger(m.memberResetVersion)&&Array.isArray(m.memberResets)){
     if(workerReady)worker?.postMessage(m);else workerBacklog.push(m);
    }return;
   }
   if(m.type==='room')onRoom(m.room,m.reason).catch(e=>toast(e.message));else if(m.type==='signal')onSignal(m).catch(()=>toast('与房主连接失败，请离开房间后重试。'));else if(m.type==='relay_ready')onRelayReady(m);else if(m.type==='relay')onRelayPacket(m);else if(m.type==='relay_error'){if(!isRetiredRelayNotice(m,room,retiredPeers))toast(m.message);}else if(m.type==='chat')addChat(m.message);else if(m.type==='error')toast(m.message);
  };
  socket.onerror=()=>fail('无法连接大厅。');
  socket.onclose=()=>{
   fail('大厅连接已断开，请重试。');
   if(signal!==socket)return;
   signal=null;
   if(room)void preserveDisconnected(room.mode==='mission'?'大厅连接断开，练习已结束。':'大厅连接断开，本机进度已保留。').catch(e=>toast(e.message));
   else {self=null;if(!leaving)show(account?'lobby-view':'auth-view');}
  };
 });
 signalConnecting=job;
 try{await job;}finally{if(signalConnecting===job)signalConnecting=null;}
}
async function enterLobby(){await connectSignal();$('account-name').textContent=account.name;$('logout').classList.remove('hidden');show('lobby-view');await refresh(true);clearInterval(refreshTimer);refreshTimer=setInterval(()=>{if(!room)refresh().catch(()=>{});},5000);}
function renderLobbyState(){
 if(!account)return;
 renderLobby({account,...lobbySnapshot,busy:lobbyBusy||leaving,onContinue:openCreate,onJoin:id=>runLobbyAction(()=>joinRoom(id)),onDelete:openDelete});
 renderMissionEntry();
 for(const id of ['new-adventure','logout','refresh'])$(id).disabled=lobbyBusy||leaving;
 const cap=lobbySnapshot.capacity,full=cap&&cap.progressUsed>=cap.progressLimit;
 $('new-adventure').disabled||=!!full;$('new-adventure').title=full?'进度已满，先删除一份再新建':'';
 $('lobby-message').textContent=cap?.message||(full?'进度已满。可继续已有冒险，或先删除一份记录。':'继续冒险，或加入正在等待你的队伍。');
}
function renderMissionEntry(){
 const status=account?.training?.status??'pending',first=status==='pending';
 $('mission-entry-tag').textContent=first?'推荐':status==='done'?'已完成':'已跳过';
 $('mission-entry-detail').textContent=first?'先用几分钟学操作，也能直接去冒险。':'可随时试枪、鱼竿和道具，不影响冒险进度。';
 $('mission-entry-primary').textContent=first?'开始任务':'自由试用';
 $('mission-entry-secondary').textContent=first?'暂时跳过':'重温任务';
 for(const id of ['mission-entry-primary','mission-entry-secondary'])$(id).disabled=lobbyBusy||leaving;
}
async function refresh(force=false){
 if(!account)return;
 if(refreshJob&&!force)return refreshJob;
 const generation=++refreshGeneration,accountId=account.id;
 const job=Promise.all([api('adventures'),api('rooms')]).then(async([a,r])=>{
  if(account?.id!==accountId||generation!==refreshGeneration)return;
  lobbySnapshot={adventures:a.adventures,rooms:r.rooms,capacity:a.capacity};renderLobbyState();
  await localCheckpoints.prune(accountId,a.adventures.filter(x=>x.ownerId===accountId).map(x=>x.id),()=>account?.id===accountId&&generation===refreshGeneration&&!room&&!lobbyBusy).catch(()=>{});
 });
 refreshJob=job;
 try{await job;}finally{if(refreshJob===job)refreshJob=null;}
}
async function runLobbyAction(action){
 if(lobbyBusy||leaving||room)return;
 lobbyBusy=true;renderLobbyState();
 try{await action();}catch(e){toast(e.message);if(!room)await refresh(true).catch(()=>{});}
 finally{lobbyBusy=false;renderLobbyState();}
}
function openDelete(item){
 if(lobbyBusy||leaving||room)return;
 deleteTarget=item;$('delete-name').textContent=item.title;$('delete-error').textContent='';
 const mine=item.ownerId===account.id;
 $('delete-title').textContent=mine?'删除冒险？':'删除记录？';
 $('delete-description').textContent=mine?'队友也将无法继续这次冒险。其他冒险不受影响。':'只清空你的随身装备和个人成长。队伍物资保留，队友可以继续玩。再次加入不重复领取入队补贴。';
 $('delete-confirm').textContent=mine?'删除冒险':'删除记录';
 $('delete-cancel').textContent=mine?'保留冒险':'保留记录';
 $('delete-dialog').showModal();$('delete-cancel').focus();
}
async function confirmDelete(){
 if(!deleteTarget||deletePending)return;
 const target=deleteTarget;deletePending=true;
 for(const id of ['delete-confirm','delete-cancel','delete-close'])$(id).disabled=true;
 $('delete-error').textContent='';
 try{
  try{await api('adventures/'+target.id,{method:'DELETE'});}catch(e){if(e.status!==404)throw e;}
  await localCheckpoints.remove(account.id,target.id).catch(()=>{});
  // Invalidate older polls before removing the row; a late response must not restore it.
  ++refreshGeneration;lobbySnapshot.adventures=lobbySnapshot.adventures.filter(a=>a.id!==target.id);renderLobbyState();
  $('delete-dialog').close();toast(target.ownerId===account.id?'冒险已删除。其他冒险不受影响。':'你的记录已删除，队友的进度保留。');
  await refresh(true).catch(()=>{});
 }catch(e){formError('delete-error',e.name==='TimeoutError'?'暂未收到结果。可重试，或稍后刷新查看。':e.message);}
 finally{deletePending=false;for(const id of ['delete-confirm','delete-cancel','delete-close'])$(id).disabled=false;}
}
async function requestRoom(endpoint,body){
 await connectSignal();const generation=roomGeneration,socket=signal;
 const result=await api(endpoint,{method:'POST',body});
 // WebSocket room updates can arrive before this response and be newer.
 // A completed leave or replacement connection must never restore the old room.
 if(leaving||signal!==socket||room?.id===result.room.id||generation!==roomGeneration)return;
 await onRoom(result.room);
}
async function createRoom(adventureId,title,solo){await requestRoom('rooms',{adventureId,title,solo});}
async function joinRoom(id){await requestRoom('rooms/'+id+'/join',{});}
async function createMission(start,solo=true){await requestRoom('rooms',{mode:'mission',solo,missionStart:start});}
function advanceMissionRoom(){
 if(room?.mode!=='mission'||!room.solo||room.ownerId!==account?.id||room.status==='running'||leaving||workerFailed)return;
 const mine=room.members.find(member=>member.peerId===self?.peerId);
 if(!mine)return;
 if(!mine.ready){if(!missionReadyRequested){missionReadyRequested=true;send({type:'ready',ready:true});}return;}
 if(!workerReady||missionStartRequested)return;
 missionStartRequested=true;roomUI();
 void api('rooms/'+room.id+'/start',{method:'POST',body:{}}).then(result=>{if(room?.id===result.room?.id&&room.status!=='running')void onRoom(result.room).catch(error=>toast(error.message));}).catch(error=>{missionStartRequested=false;roomUI();toast(error.message);});
}
function roomUI(){if(!room)return;const mission=room.mode==='mission',autoMission=mission&&room.solo;$('room-title').textContent=mission?(room.missionStart==='tutorial'?'入职任务':'自由试用'):room.title;$('room-mode').textContent=mission?(room.solo?'单人体验':'多人体验'):room.solo?'单人冒险':'多人合作';$('room-subtitle').textContent=mission?(room.solo?'正在准备体验园区，不占用冒险进度。':'等大家准备好，一起试用；途中也能加入。'):room.solo?'按下开始，去看看今天的园区。':'等大家准备好，一起出发；途中也能加入。';$('member-count').textContent=`${room.members.length}/${room.maxPlayers} 人`;
 const members=$('member-list'),rosterScroll=members.scrollTop;members.classList.toggle('dense',room.members.length>4);members.replaceChildren();for(const m of room.members){const row=textElement('div','','member'),copy=textElement('div');copy.append(textElement('b',m.name+(m.peerId===self.peerId?'（你）':'')),textElement('small',m.accountId===room.ownerId?'房主':'队员'));row.append(textElement('span',m.name.slice(0,1),'avatar'),copy,textElement('span',m.ready?'✓ 已准备':'等准备',m.ready?'ready-tag':'ready-tag not-ready'));copy.firstElementChild.title=m.name+(m.peerId===self.peerId?'（你）':'');members.append(row);}members.scrollTop=rosterScroll;
 const mine=room.members.find(m=>m.peerId===self.peerId),host=room.ownerId===account.id;$('ready').textContent=mine?.ready?'取消准备':'准备好了';$('ready').classList.toggle('hidden',autoMission);$('start').textContent=mission?(room.missionStart==='tutorial'?'开始任务':'开始试用'):'开始冒险';$('start').classList.toggle('hidden',!host);$('start').disabled=leaving||!workerReady||workerFailed||autoMission&&missionStartRequested||!room.members.every(m=>m.ready);$('ready').disabled=leaving;$('leave-room').disabled=leaving;const waiting=room.members.filter(m=>!m.ready).length;$('ready-hint').textContent=autoMission?(workerFailed?'任务未能启动，请回大厅重试。':'正在自动开始任务…'):leaving?'正在离开，请稍候…':host?(workerFailed?'房间暂停了，请回大厅重试。':!workerReady?'正在准备房间，请稍候…':waiting?`还有 ${waiting} 位队员未准备`:'全队已准备，可以开始。'):'准备好后，等待房主开始。';$('connection-state').textContent=mission?(host?(workerFailed?'体验园区准备失败':workerReady?'✓ 体验园区已就绪':'正在准备体验园区…'):(transportReady()?(relayActive()?'✓ 已连上房主 · 局域网中转':'✓ 已连上房主 · 直连'):(peers.get(room.hostPeerId)?.policy?.mode==='failed'?'连接未成功，请重试':'正在连接房主…'))):host?(workerFailed?'房间暂停了，请保存回大厅重试。':workerReady?(saveStatus.error?'● 本机已存 · 备份待重试':saveStatus.localRevision?(saveStatus.backupPending?'✓ 本机已存 · 备份中':'✓ 本机已存 · 已备份'):'✓ 房间已就绪'):'正在准备房间…'):(transportReady()?(relayActive()?'✓ 已连上房主 · 局域网中转':'✓ 已连上房主 · 直连'):(peers.get(room.hostPeerId)?.policy?.mode==='failed'?'连接未成功，请重试':'正在连接房主…'));}
async function onRoom(next,reason){
 if(!next){if(leaving&&!lostRoom){lostRoom=true;return;}await preserveDisconnected(room?.mode==='mission'?'任务房已结束，可从大厅重新进入。':messages[reason]||'房间已结束，本机进度已保留。');return;}
 const fresh=room?.id!==next.id||room?.epoch!==next.epoch;if(fresh){cleanupRoom();clearTimeout(toastTimer);$('toast').classList.add('hidden');$('chat-messages').replaceChildren();}
 rememberRetiredMembers(room,next,retiredPeers);room=next;
 // Retire old connections synchronously before any new connection awaits.
 for(const [id,p]of peers)if(!roomHasPeer(room,id)){peers.delete(id);closeDirect(p,true);worker?.postMessage({type:'disconnect',peerId:id});}
 const generation=roomGeneration;$('chat').classList.remove('hidden');if(!frame){$('room-chat-slot').append($('chat'));renderChat();}roomUI();
 if(fresh&&room.ownerId===account.id)await startHost(room);
 if(generation!==roomGeneration||!room)return;
 if(workerReady)worker.postMessage({type:'room',room});
 if(room.ownerId===account.id){for(const m of room.members){if(generation!==roomGeneration||!room)return;if(m.peerId!==self.peerId&&!peers.has(m.peerId))await createPeer(m.peerId,true);}}else if(!peers.has(room.hostPeerId)){await createPeer(room.hostPeerId,false);}
 if(generation!==roomGeneration||!room)return;
 if(room.status==='running')startGame();else show('room-view');roomUI();advanceMissionRoom();
}
async function startHost(initialRoom){
 const mission=initialRoom.mode==='mission';
 const [saved,config]=await Promise.all([mission?Promise.resolve({revision:0,state:null,head:null,memberResets:[],memberResetVersion:0}):api('adventures/'+initialRoom.adventureId+'/snapshot'),fetch('/platform/balance.json').then(r=>r.json())]);if(room?.id!==initialRoom.id)return;
 revision=saved.revision;workerReady=false;workerInitFailed=false;workerFailed=false;workerPulse=performance.now();
 worker=new Worker('/platform/host-worker.mjs',{type:'module'});const currentWorker=worker;
 worker.onmessage=({data:m})=>{
  if(worker!==currentWorker||room?.id!==initialRoom.id)return;
  if(m.type==='ready'){workerReady=true;workerPulse=performance.now();worker.postMessage({type:'room',room});while(workerBacklog.length)worker.postMessage(workerBacklog.shift());roomUI();advanceMissionRoom();if(m.notice)toast(m.notice);}
  else if(m.type==='pulse')workerPulse=performance.now();
  else if(m.type==='packet')sendPacket(m.peerId,m.json);
  else if(m.type==='saved_revision')revision=m.revision;
  else if(m.type==='save_status'){const wasFailed=!!saveStatus.error;saveStatus={localRevision:m.localRevision,remoteRevision:m.remoteRevision,backupPending:m.backupPending,error:m.error};revision=m.remoteRevision;roomUI();if(m.error&&!wasFailed)toast('进度已存在本机。服务器备份稍后重试，同一浏览器可继续。');else if(wasFailed&&!m.error&&!m.backupPending)toast('服务器备份已恢复。');}
  else if(m.type==='save_failed')toast(m.message||'进度保存失败，游戏已暂停。正在重试保存。');
  else if(m.type==='closed'){roomExitSaved=true;revision=m.revision;for(const waiter of closedWaiters.splice(0))waiter.resolve();}
  else if(m.type==='close_failed'){workerFailed=true;roomUI();failGame('游戏已暂停，保存尚未完成。请重试返回大厅。');for(const waiter of closedWaiters.splice(0))waiter.reject(Error(m.message));}
  else if(m.type==='fatal'){if(!workerReady)workerInitFailed=true;workerFailed=true;roomUI();toast(m.message);failGame('房主的游戏运行中断，请回大厅重试。');for(const waiter of closedWaiters.splice(0))waiter.reject(Error(m.message));}
 };
 worker.onerror=()=>{if(worker!==currentWorker)return;if(!workerReady)workerInitFailed=true;workerFailed=true;roomUI();toast('房主的游戏运行中断。请回大厅重新打开最近的存档。');failGame('房主的游戏运行中断，请回大厅重试。');};
 worker.postMessage({type:'init',room:initialRoom,state:saved.state,revision:saved.revision,head:saved.head,config,memberResets:saved.memberResets??[],memberResetVersion:saved.memberResetVersion??0});
 // The simulation Worker sends its own heartbeat, even while Godot loads on the UI thread.
}
let packetSequence=0;
function wireSend(channel,json){if(channel?.readyState!=='open')return;if(channel.bufferedAmount>1024*1024){channel.close();return;}if(json.length<=12000){channel.send(json);return;}const id=++packetSequence,total=Math.ceil(json.length/12000);for(let i=0;i<total;i++)channel.send(JSON.stringify({__chunk:id,index:i,total,text:json.slice(i*12000,(i+1)*12000)}));}
function acceptPacket(peer,data){let value;try{value=JSON.parse(data);}catch{return;}if(value.__chunk){if(!Number.isSafeInteger(value.total)||value.total<1||value.total>700||!Number.isSafeInteger(value.index)||value.index<0||value.index>=value.total||typeof value.text!=='string'||value.text.length>12000)return;const now=performance.now();for(const [id,part]of peer.chunks)if(now-part.at>10000)peer.chunks.delete(id);let part=peer.chunks.get(value.__chunk);if(!part){if(peer.chunks.size>=4)return;part={parts:new Array(value.total),at:now,count:0};peer.chunks.set(value.__chunk,part);}if(part.parts.length!==value.total)return;if(part.parts[value.index]===undefined){part.parts[value.index]=value.text;part.count++;}if(part.count!==part.parts.length)return;peer.chunks.delete(value.__chunk);data=part.parts.join('');}
 if(room?.ownerId===account.id){const message={type:'packet',peerId:peer.id,json:data};if(workerReady)worker.postMessage(message);else if(workerBacklog.length<100)workerBacklog.push(message);}else pushPacket(data);
}
function pushPacket(json){if(queue.length>=512){queue=[];const request=JSON.stringify({type:'state_resync'});if(room?.ownerId===account?.id)worker?.postMessage({type:'packet',peerId:self?.peerId,json:request});else sendPacket(room?.hostPeerId,request);}queue.push(json);}
function transportReady(){if(!room||signal?.readyState!==WebSocket.OPEN)return false;return room.ownerId===account?.id?(workerReady&&!workerFailed):peers.get(room.hostPeerId)?.policy?.ready===true;}
function relayActive(){if(!room)return false;return room.ownerId===account?.id?[...peers.values()].some(p=>p.policy?.mode==='relay'):peers.get(room.hostPeerId)?.policy?.mode==='relay';}
function retryTransport(){if(!room)return;for(const peer of peers.values())if(!peer.policy?.ready)peer.policy?.fallback();}
function closeDirect(peer,dispose=false){if(dispose)peer.policy?.dispose();if(peer.pc){peer.pc.onicecandidate=null;peer.pc.ondatachannel=null;peer.pc.onconnectionstatechange=null;}if(peer.channel){peer.channel.onopen=null;peer.channel.onmessage=null;peer.channel.onclose=null;peer.channel.close();}peer.pc?.close();peer.channel=null;}
function currentPeer(peer){return !!peer&&room?.id===peer.roomId&&room?.epoch===peer.epoch&&peers.get(peer.id)===peer&&roomHasPeer(room,peer.id);}
function makePeer(id){const roomId=room.id,epoch=room.epoch,peer={id,roomId,epoch,pc:null,channel:null,candidates:[],chunks:new Map(),error:null};peers.set(id,peer);peer.policy=new LinkPolicy({requestRelay:()=>{if(leaving||!currentPeer(peer))return;peer.error=null;send({type:'relay_open',roomId,epoch,to:id});roomUI();},onFailure:()=>{if(!currentPeer(peer))return;peer.error='直连和中转都未接通，请重试连接或回大厅重新加入。';roomUI();toast(peer.error);}});return peer;}
function relayWire(peer,json){if(signal?.readyState!==WebSocket.OPEN)return;if(signal.bufferedAmount>2*1024*1024){toast('连接积压，正在断开以保护进度，请重新加入。');signal.close(4008,'Relay client too slow');return;}const sendPart=packet=>send({type:'relay',roomId:room.id,epoch:room.epoch,to:peer.id,packet});const bytes=new TextEncoder().encode(json).length;if(bytes<=16384){sendPart(json);return;}if(room.ownerId!==account.id){toast('操作报文过大，未发送。');return;}const id=++packetSequence,total=Math.ceil(json.length/3072);if(total>700){toast('当前世界报文过大，请保存后重新进入。');return;}for(let index=0;index<total;index++)sendPart(JSON.stringify({__chunk:id,index,total,text:json.slice(index*3072,(index+1)*3072)}));}
function sendPacket(peerId,json){if(peerId===self?.peerId)pushPacket(json);else{const peer=peers.get(peerId);if(peer?.policy?.mode==='relay')relayWire(peer,json);else if(peer?.policy?.mode==='direct')wireSend(peer.channel,json);}}
function onRelayReady(m){if(!room||m.roomId!==room.id||m.epoch!==room.epoch||!room.members.some(x=>x.peerId===m.peerId)||m.peerId===self?.peerId)return;const peer=peers.get(m.peerId)??makePeer(m.peerId);if(!peer.policy.relayReady())return;closeDirect(peer);peer.chunks.clear();peer.error=null;if(room.ownerId===account.id){const reset={type:'disconnect',peerId:peer.id};if(workerReady)worker?.postMessage(reset);else workerBacklog.push(reset);}else pushPacket(JSON.stringify({type:'platform_reconnect'}));roomUI();}
function onRelayPacket(m){if(!room||m.roomId!==room.id||m.epoch!==room.epoch||typeof m.packet!=='string')return;const peer=peers.get(m.from);if(!peer||peer.policy?.mode!=='relay'||!room.members.some(x=>x.peerId===m.from))return;if(room.ownerId!==account.id&&m.from!==room.hostPeerId)return;acceptPacket(peer,m.packet);}
function setupChannel(peer,channel){peer.channel=channel;channel.onopen=()=>{if(!currentPeer(peer)||!peer.policy.directOpen()){channel.close();return;}roomUI();if(room?.ownerId!==account.id)pushPacket(JSON.stringify({type:'platform_reconnect'}));};channel.onmessage=({data})=>{if(currentPeer(peer)&&peer.policy.mode==='direct'&&typeof data==='string')acceptPacket(peer,data);};channel.onclose=()=>{if(leaving||!currentPeer(peer))return;peer.policy.fallback();roomUI();};}
async function createPeer(id,offer){if(!roomHasPeer(room,id)||leaving)return null;const previous=peers.get(id);if(previous?.policy?.mode==='relay')return previous;if(previous)closeDirect(previous,true);const peer=makePeer(id);try{const pc=new RTCPeerConnection({iceServers:[]});peer.pc=pc;pc.onicecandidate=({candidate})=>{if(candidate&&currentPeer(peer)&&['connecting','direct'].includes(peer.policy.mode))send({type:'signal',to:id,data:{candidate:candidate.toJSON()}});};pc.ondatachannel=({channel})=>{if(currentPeer(peer))setupChannel(peer,channel);else channel.close();};pc.onconnectionstatechange=()=>{if(['failed','disconnected'].includes(pc.connectionState)&&currentPeer(peer)&&!leaving)peer.policy.fallback();};if(offer){setupChannel(peer,pc.createDataChannel('tidal-game',{ordered:true}));await pc.setLocalDescription(await pc.createOffer());if(currentPeer(peer)&&['connecting','direct'].includes(peer.policy.mode))send({type:'signal',to:id,data:{description:pc.localDescription.toJSON()}});}}catch{if(currentPeer(peer)&&!leaving)peer.policy.fallback();}return peer;}
async function onSignal(m){if(!room||m.roomId!==room.id||m.epoch!==room.epoch||!room.members.some(x=>x.peerId===m.from))return;const d=m.data;let peer=peers.get(m.from);if(peer&&!['connecting','direct'].includes(peer.policy.mode))return;
 if(d.retry&&room.ownerId===account.id){peer?.policy.fallback();return;}
 if(d.description?.type==='offer'){if(m.from!==room.hostPeerId)return;peer??=await createPeer(m.from,false);if(!peer?.pc||!currentPeer(peer)||peer.policy.mode!=='connecting')return;await peer.pc.setRemoteDescription(d.description);for(const c of peer.candidates)await peer.pc.addIceCandidate(c);peer.candidates=[];await peer.pc.setLocalDescription(await peer.pc.createAnswer());send({type:'signal',to:m.from,data:{description:peer.pc.localDescription.toJSON()}});}
 else if(d.description?.type==='answer'){if(!peer?.pc)return;await peer.pc.setRemoteDescription(d.description);for(const c of peer.candidates)await peer.pc.addIceCandidate(c);peer.candidates=[];}
 else if(d.candidate){if(!peer?.pc)return;if(peer.pc.remoteDescription)await peer.pc.addIceCandidate(d.candidate);else peer.candidates.push(d.candidate);}
}
function startGame(){if(frame)return;gameEntered=false;frameLoaded=false;$('game-enter').classList.add('hidden');$('game-entry').classList.add('hidden');document.body.classList.add('in-game');$('game-stage').classList.remove('hidden');loading.start();document.body.append($('chat'));$('chat').classList.add('game-chat');chatOpen=false;chatUnread=0;nativeUI={overlay:'lobby',resumeOverlay:'lobby',resumeCapture:false};frame=document.createElement('iframe');renderChat();frame.title='办公室的99夜游戏';frame.allow='autoplay; fullscreen';frame.src='/play.html';$('game-stage').append(frame);}
async function completeMission(){
 if(missionCompleting||missionCompletionShown||room?.mode!=='mission'||room.status!=='running'||!account)return;
 const roomId=room.id,accountId=account.id;missionCompleting=true;
 try{
  let result;
  try{result=await api('training',{method:'POST',body:{action:'complete'}});}
  catch(error){const latest=await api('me').catch(()=>null);if(latest?.account?.id===accountId&&latest.account.training?.status==='done')result={training:latest.account.training};else throw error;}
  if(room?.id!==roomId||account?.id!==accountId)return;
  account.training=result.training;missionCompletionShown=true;missionCompletionRetries=0;
  clearTimeout(missionRetryTimer);missionRetryTimer=null;
  if(!$('mission-complete-dialog').open){$('mission-complete-detail').textContent='做得好！现在可以去冒险，也可以继续试装备。';$('mission-complete-dialog').showModal();$('mission-to-lobby').focus();}
 }catch(error){if(room?.id===roomId){if((!error.status||error.status>=500)&&missionCompletionRetries<3){missionCompletionRetries++;missionRetryTimer=setTimeout(()=>{missionRetryTimer=null;void completeMission();},2500*missionCompletionRetries);}else toast(error.message);}}
 finally{missionCompleting=false;renderLobbyState();}
}
window.makeGameTransport=child=>{
 if(child!==frame?.contentWindow)throw Error('Unknown game frame');
 pointerGuard?.dispose();
 pointerGuard=createPointerGuard({child,button:$('game-resume'),state:()=>({enabled:child===frame?.contentWindow&&gameEntered&&frameLoaded&&!workerFailed&&!leaving,overlay:chatOpen?'chat':nativeUI.overlay,capture:nativeUI.resumeCapture}),deliver:json=>{if(child===frame?.contentWindow)pushPacket(json);}});
 const guide=createOnboardingChannel({api,currentAccount:()=>account,isCurrent:()=>child===frame?.contentWindow&&!leaving,deliver:m=>pushPacket(JSON.stringify(m))});
 return {
  guideState:()=>child===frame?.contentWindow?guide.state():'{}',
  guideUpdate:raw=>guide.update(raw),
  missionMode:()=>child===frame?.contentWindow&&room?.mode==='mission'?JSON.stringify({mode:'mission',start:room.missionStart}):'{}',
  trainingComplete:()=>{if(child===frame?.contentWindow)void completeMission();},
  ready:()=>child===frame?.contentWindow&&transportReady(),
  name:()=>child===frame?.contentWindow?(account?.name??'队员'):'队员',
  poll:()=>{if(child!==frame?.contentWindow)return '[]';const output=queue;queue=[];return '['+output.join(',')+']';},
  send:json=>{if(child!==frame?.contentWindow||!room||typeof json!=='string'||json.length>16384)return;if(room.ownerId===account.id){const m={type:'packet',peerId:self.peerId,json};if(workerReady)worker.postMessage(m);else workerBacklog.push(m);}else sendPacket(room.hostPeerId,json);},
  loading:value=>{if(child===frame?.contentWindow)loading.report(value);},
  loaded:()=>{if(child!==frame?.contentWindow)return;frameLoaded=true;if(!workerFailed){loading.loaded();if(!gameEntered&&!leaving){$('game-enter').classList.remove('hidden');$('game-entry').classList.remove('hidden');}if(!$('toast').classList.contains('hidden'))toast($('toast').textContent);}},
  uiState:json=>{if(child!==frame?.contentWindow||typeof json!=='string'||json.length>512)return;let value;try{value=JSON.parse(json);}catch{return;}if(typeof value.overlay==='string'&&typeof value.resumeOverlay==='string'&&typeof value.resumeCapture==='boolean')nativeUI={overlay:value.overlay.slice(0,30),resumeOverlay:value.resumeOverlay.slice(0,30),resumeCapture:value.resumeCapture};pointerGuard?.sync();},
  openChat:()=>{if(child===frame?.contentWindow)focusChat();},
  focusActive:()=>child===frame?.contentWindow&&(chatOpen||workerFailed),
  escapeCurrent:generation=>child===frame?.contentWindow&&pointerGuard?.escapeCurrent(generation)===true,
  capture:()=>{if(child===frame?.contentWindow&&navigator.userActivation?.isActive)pointerGuard?.request(true);},
  closeChat:()=>{if(child===frame?.contentWindow)blurChat();},
  leave:()=>{if(child===frame?.contentWindow)return leaveRoom().catch(e=>toast(e.message));},
 };
};
async function leaveRoom(){if(!room||leaving)return;if(lostRoom)return preserveDisconnected(room.mode==='mission'?'练习已结束，可从大厅重新进入。':'本机进度已保留，服务器恢复后可继续。');leaving=true;$('game-entry-back').disabled=true;$('game-enter').disabled=true;renderLobbyState();roomUI();const old=room;try{
 if(old.ownerId===account.id){if(worker&&!workerInitFailed)await closeHost(false);await api('rooms/'+old.id+'/close',{method:'POST',body:old.mode==='mission'?{}:worker?{finalRevision:revision}:{}});}
 else await api('rooms/'+old.id+'/leave',{method:'POST',body:{}});
 cleanupRoom();show('lobby-view');if(old.mode==='mission'){const latest=await api('me').catch(()=>null);if(latest?.account?.id===account?.id)account.training=latest.account.training;}await refresh();toast(old.mode==='mission'?'已回到大厅。冒险进度不受影响。':'已回到大厅。冒险进度已保留。');
 }finally{leaving=false;$('game-entry-back').disabled=false;$('game-enter').disabled=roomExitSaved;$('game-enter').title=roomExitSaved?'进度已保存，请重试返回大厅':'';renderLobbyState();roomUI();if(!room)show(account?'lobby-view':'auth-view');if(frame&&frameLoaded&&!gameEntered&&!workerFailed){$('game-enter').classList.remove('hidden');$('game-entry').classList.remove('hidden');}}}
function closeHost(localOnly){
 const currentWorker=worker;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{const i=closedWaiters.indexOf(waiter);if(i>=0)closedWaiters.splice(i,1);reject(Error('保存还没完成，请稍后重试。'));},25000);
  const waiter={resolve:()=>{clearTimeout(timer);resolve();},reject:error=>{clearTimeout(timer);reject(error);}};
  closedWaiters.push(waiter);currentWorker.postMessage({type:'close',localOnly});
 });
}
async function preserveDisconnected(message){
 if(lossJob)return lossJob;
 const currentWorker=worker,currentRoom=room;lostRoom=true;leaving=true;pointerGuard?.sync();
 const job=(async()=>{
  try{
   if(currentRoom?.ownerId===account?.id&&currentWorker&&workerReady&&!roomExitSaved)await closeHost(true);
   if(worker!==currentWorker||room?.id!==currentRoom?.id||room?.epoch!==currentRoom?.epoch)return;
   cleanupRoom();show(account?'lobby-view':'auth-view');toast(message);if(account)void refresh(true).catch(()=>{});
  }catch(error){workerFailed=true;failGame('游戏已暂停，本机保存未完成。请重试返回大厅。');throw error;}
  finally{leaving=false;renderLobbyState();roomUI();}
 })();
 lossJob=job;try{await job;}finally{if(lossJob===job)lossJob=null;}
}
function cleanupRoom(){lostRoom=false;saveStatus={localRevision:0,remoteRevision:0,backupPending:false,error:null};pointerGuard?.dispose();pointerGuard=null;++roomGeneration;loading.stop();clearInterval(heartbeatTimer);for(const p of peers.values())closeDirect(p,true);peers.clear();retiredPeers.clear();worker?.terminate();worker=null;workerReady=false;workerInitFailed=false;roomExitSaved=false;missionReadyRequested=false;missionStartRequested=false;missionCompleting=false;missionCompletionShown=false;missionCompletionRetries=0;clearTimeout(missionRetryTimer);missionRetryTimer=null;workerBacklog.length=0;room=null;queue=[];frame?.remove();frame=null;frameLoaded=false;if($('mission-complete-dialog').open)$('mission-complete-dialog').close();document.body.classList.remove('in-game','chat-open');chatOpen=false;chatUnread=0;gameEntered=false;nativeUI={overlay:'lobby',resumeOverlay:'lobby',resumeCapture:false};$('chat-input').value='';$('chat-messages').replaceChildren();$('shell').prepend($('toast'));$('game-stage').classList.add('hidden');$('chat').classList.add('hidden');$('chat').classList.remove('game-chat','collapsed');$('room-chat-slot').append($('chat'));}
function renderChat(){
 const expanded=frame?chatOpen:!$('chat').classList.contains('collapsed');
 if(frame)frame.inert=chatOpen;pointerGuard?.sync();
 $('chat').classList.toggle('collapsed',!expanded);document.body.classList.toggle('chat-open',!!frame&&chatOpen);
 $('chat-label').textContent=expanded?'队伍聊天':'聊天';$('chat-hint').textContent=expanded?'收起':'Enter';
 $('chat-toggle').setAttribute('aria-expanded',String(expanded));
 $('chat-unread').textContent=chatUnread>99?'99+':String(chatUnread);$('chat-unread').classList.toggle('hidden',chatUnread===0||expanded);
 if(expanded)requestAnimationFrame(()=>{const list=$('chat-messages');list.scrollTop=list.scrollHeight;});
}
function focusChat(){
 if(!room)return;
 if(!frame)$('chat').classList.remove('collapsed');
 if(frame&&!chatOpen){chatOpen=true;pushPacket(JSON.stringify({type:'platform_focus',active:true}));}
 chatUnread=0;renderChat();$('chat-input').focus();
}
function focusGame(capture=false){
 if(!frame)return;pointerGuard?.request(capture);
}
function blurChat({restore=true}={}){
 if(!frame){$('chat-input').blur();$('chat').classList.add('collapsed');renderChat();return;}
 const capture=restore&&gameEntered&&frameLoaded&&!leaving&&transportReady()&&nativeUI.resumeOverlay===''&&nativeUI.resumeCapture;
 if(chatOpen)pushPacket(JSON.stringify({type:'platform_focus',active:false}));
 chatOpen=false;renderChat();$('chat-input').blur();if(restore)focusGame(capture);
}
function addChat(m){
 const line=textElement('div','','chat-message');line.append(textElement('b',m.from.name),document.createTextNode(m.text));
 const list=$('chat-messages');list.append(line);while(list.children.length>60)list.firstChild.remove();
 if(frame&&!chatOpen)chatUnread++;renderChat();
}
$('auth-form').onsubmit=async e=>{e.preventDefault();$('auth-submit').disabled=true;$('auth-error').textContent='';try{const body={username:$('username').value.trim(),password:$('password').value,...(registerMode?{name:$('display-name').value.trim()||$('username').value.trim()}:{} )};const data=await api(registerMode?'register':'login',{method:'POST',body});account=data.account;$('password').value='';await enterLobby();}catch(e){formError('auth-error',e.message);}finally{$('auth-submit').disabled=false;}};
$('auth-toggle').onclick=()=>{registerMode=!registerMode;$('auth-error').textContent='';$('auth-form').querySelector('.auth-body').scrollTop=0;$('auth-submit').textContent=registerMode?'创建账号':'登录账号';$('auth-title').textContent=registerMode?'创建账号':'登录账号';$('auth-toggle').textContent=registerMode?'返回登录':'创建账号';$('name-label').classList.toggle('hidden',!registerMode);$('password').autocomplete=registerMode?'new-password':'current-password';};
$('logout').onclick=async()=>{if(lobbyBusy||leaving)return;lobbyBusy=true;renderLobbyState();try{if(room)await leaveRoom();await api('logout',{method:'POST',body:{}});account=null;signal?.close();clearInterval(refreshTimer);$('logout').classList.add('hidden');$('account-name').textContent='';show('auth-view');}catch(e){toast(e.message);}finally{lobbyBusy=false;renderLobbyState();}};
$('refresh').onclick=()=>refresh().catch(e=>toast(e.message));
async function skipMission(){
 if(!account||account.training?.status!=='pending')return;
 const accountId=account.id,result=await api('training',{method:'POST',body:{action:'skip'}});
 if(account?.id===accountId){account.training=result.training;renderLobbyState();}
}
$('mission-entry-primary').onclick=()=>account?.training?.status==='pending'?runLobbyAction(()=>createMission('tutorial')):openPractice();
$('mission-entry-secondary').onclick=()=>account?.training?.status==='pending'?runLobbyAction(skipMission):runLobbyAction(()=>createMission('tutorial'));
function openPractice(){
 if(lobbyBusy||leaving||room||practicePending)return;
 $('practice-error').textContent='';$('practice-multi').checked=true;
 $('practice-dialog').showModal();$('practice-multi').focus();
}
for(const id of ['practice-close','practice-cancel'])$(id).onclick=()=>{if(!practicePending)$('practice-dialog').close();};
$('practice-form').onsubmit=async e=>{
 e.preventDefault();if(practicePending||lobbyBusy||leaving||room)return;
 practicePending=true;lobbyBusy=true;$('practice-error').textContent='';
 for(const id of ['practice-close','practice-cancel','practice-submit','practice-multi','practice-solo'])$(id).disabled=true;
 renderLobbyState();
 try{await createMission('free',$('practice-solo').checked);if(!room)throw Error('房间没能打开，请重试。');$('practice-dialog').close();}
 catch(error){formError('practice-error',error.message);await refresh(true).catch(()=>{});}
 finally{practicePending=false;lobbyBusy=false;for(const id of ['practice-close','practice-cancel','practice-submit','practice-multi','practice-solo'])$(id).disabled=false;renderLobbyState();}
};
$('practice-dialog').addEventListener('cancel',e=>{if(practicePending)e.preventDefault();});
function updateCreateFields(){
 const resume=!!createTarget;
 $('create-name-field').classList.toggle('hidden',resume);$('resume-name').classList.toggle('hidden',!resume);
 $('adventure-title').required=!resume;$('adventure-title').disabled=resume||createPending;
 if(resume){$('resume-name').replaceChildren(textElement('b',createTarget.title),textElement('small','第 '+(createTarget.dayIndex??1)+' 天 · 已有装备与进度保留'));}
 for(const id of ['dialog-close','create-cancel','create-submit','single-mode','multi-mode'])$(id).disabled=createPending;
}
function openCreate(item=null){
 if(lobbyBusy||leaving||room||createPending)return;
 createTarget=item;$('create-error').textContent='';$('multi-mode').checked=true;
 $('create-heading').textContent=item?'继续冒险':'新建冒险';$('create-submit').textContent=item?'开启房间':'创建房间';
 $('create-note').textContent=item?'队友可随时加入，不需要上次的人到齐。':'新冒险单独保存，已有进度保留。';
 if(!item)$('adventure-title').value='快乐办公室';
 updateCreateFields();$('create-dialog').showModal();$(item?'multi-mode':'adventure-title').focus();
}
$('new-adventure').onclick=()=>openCreate();
for(const id of ['dialog-close','create-cancel'])$(id).onclick=()=>{if(!createPending)$('create-dialog').close();};
$('create-form').onsubmit=async e=>{
 e.preventDefault();if(createPending||lobbyBusy||leaving||room)return;
 const solo=$('single-mode').checked,title=$('adventure-title').value.trim();
 createPending=true;lobbyBusy=true;$('create-error').textContent='';updateCreateFields();renderLobbyState();
 try{
  if(!createTarget){const result=await api('adventures',{method:'POST',body:{title}});createTarget=result.adventure;}
  // Keep the created adventure if opening its room fails; retry must not create a duplicate save.
  await createRoom(createTarget.id,createTarget.title,solo);
  if(!room)throw Error('房间没能打开，请重试。');
  $('create-dialog').close();
 }catch(error){
  formError('create-error',error.message);
  if(createTarget){$('create-note').textContent='冒险已保留，重试即可开启房间。';$('create-submit').textContent='重试开房';}
  await refresh(true).catch(()=>{});
 }finally{createPending=false;lobbyBusy=false;updateCreateFields();renderLobbyState();}
};
$('create-dialog').addEventListener('cancel',e=>{if(createPending)e.preventDefault();});
$('delete-confirm').onclick=confirmDelete;
for(const id of ['delete-cancel','delete-close'])$(id).onclick=()=>{if(!deletePending)$('delete-dialog').close();};
$('delete-dialog').addEventListener('cancel',e=>{if(deletePending)e.preventDefault();});
$('delete-dialog').addEventListener('close',()=>{deleteTarget=null;});
$('ready').onclick=()=>{const mine=room?.members.find(m=>m.peerId===self.peerId);if(mine)send({type:'ready',ready:!mine.ready});};
$('start').onclick=async()=>{if(!room||!workerReady||workerFailed||leaving)return;$('start').disabled=true;try{await api('rooms/'+room.id+'/start',{method:'POST',body:{}});}catch(e){toast(e.message);}finally{roomUI();}};
$('leave-room').onclick=()=>leaveRoom().catch(e=>toast(e.message));$('chat-toggle').onclick=()=>{$('chat').classList.contains('collapsed')?focusChat():blurChat();};
$('mission-continue').onclick=()=>{$('mission-complete-dialog').close();pushPacket(JSON.stringify({type:'platform_mission_continue'}));focusGame(true);};
$('mission-to-lobby').onclick=async()=>{for(const id of ['mission-continue','mission-to-lobby'])$(id).disabled=true;try{await leaveRoom();if(account&&!room&&lobbySnapshot.adventures.length===0)openCreate();}catch(error){$('mission-complete-detail').textContent=error.message;}finally{for(const id of ['mission-continue','mission-to-lobby'])$(id).disabled=false;}};
$('mission-complete-dialog').addEventListener('cancel',()=>{requestAnimationFrame(()=>focusGame(false));});
$('game-entry-back').onclick=()=>leaveRoom().catch(e=>toast(e.message));
$('game-enter').onclick=()=>{if(workerFailed||roomExitSaved||leaving||!frameLoaded)return;blurChat({restore:false});gameEntered=true;$('game-enter').classList.add('hidden');$('game-entry').classList.add('hidden');pushPacket(JSON.stringify({type:'platform_entered'}));focusGame(true);};
$('chat-form').onsubmit=e=>{e.preventDefault();let submission;try{submission=chatSubmission($('chat-input').value);}catch{addChat({from:{name:'GM'},text:'指令未发送，请刷新网页后重试。'});return;}if(submission.message)send(submission.message);$('chat-input').value='';if(frame&&!submission.keepOpen)blurChat();};
$('chat-input').onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();blurChat();}};$('chat-input').onfocus=()=>{if(frame&&!chatOpen)focusChat();};
window.addEventListener('keydown',e=>{if(e.key==='Enter'&&room&&!['INPUT','TEXTAREA','BUTTON'].includes(document.activeElement.tagName)){e.preventDefault();focusChat();}});
window.addEventListener('resize',()=>{if(room)renderChat();});
window.addEventListener('pagehide',()=>{if(room){navigator.sendBeacon('/api/platform/rooms/'+room.id+(room.ownerId===account.id?'/close':'/leave'),new Blob(['{}'],{type:'application/json'}));}signal?.close();});
window.addEventListener('message',e=>{if(e.source===frame?.contentWindow&&e.data?.type==='tidal-loaded')$('game-loading').classList.add('hidden');});
// Read-only diagnostics are useful for isolated browser regression and contain no credentials.
window.tidalDiagnostics=()=>({room:room?{status:room.status,players:room.members.length,owner:room.ownerId===account?.id}:null,workerReady,revision,save:{...saveStatus},chat:{open:chatOpen,unread:chatUnread},nativeUI:{...nativeUI},pointer:pointerGuard?.diagnostics()??null,peers:[...peers.values()].map(p=>({state:p.pc?.connectionState??'unavailable',channel:p.channel?.readyState,transport:p.policy?.mode,error:p.error})),queuedPackets:queue.length,gameLoaded:!!frame&&!$('game-loading').classList.contains('hidden')?false:!!frame});
try{const result=await api('me');account=result.account;if(account)await enterLobby();}catch{show('auth-view');}
