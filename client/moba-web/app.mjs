import {HEROES,HERO_IDS,ITEMS,RECOMMENDED,VERSION,LANES,ROLE_IDS,ROLE_HEROES,TACTICS,upgradePrice,RULES} from './sim/catalog.mjs';
import {MAP} from './sim/map.mjs';
import {createInputRouter,guardRendererApi} from './input-router.mjs';
import {parsePacket} from './sim/wire.mjs';
const mapPings=[];
const inputTimes=new Map(),feedbackSamples=[],visualFeedbackSamples=[];let hudScheduled=false,scoreHeld=false;
function scheduleHUD(){if(hudScheduled)return;hudScheduled=true;requestAnimationFrame(()=>{hudScheduled=false;if(lastState)renderHUD();});}
const $=id=>document.getElementById(id),peers=new Map(),queue=[],chunks=new Map();
let socket,self,room,worker,frameReady=false,lastState=null,seq=0,eventId=0,epoch=0,toastTimer,chatCollapsed=false,aiming='',loadedURL=false,rtt=0,packetSerial=0,checkpointReceipt=0,rendererToken=0,unbindPointer=()=>{},rendererRetirement=Promise.resolve();
const icons={crosshair:'M12 3v4m0 10v4M3 12h4m10 0h4M8 8h8v8H8z',bolt:'M14 2 5 13h6l-1 9 9-13h-6z',paper:'M6 3h9l4 4v14H6zM9 10h7M9 14h7M9 18h4',shield:'m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6z',cup:'M4 6h12v10a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zm12 1h3a3 3 0 0 1 0 6h-3M8 2v2m5-2v2',boot:'M7 3h6v10l7 3v5H4v-8h3z',battery:'M8 2h8v3H8zM5 5h14v17H5zM12 8v11m-4-5h8',clock:'M12 8v5l4 2M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',heart:'M12 21 3 12C-2 4 8-1 12 7c4-8 14-3 9 5z'};
Object.assign(icons,{pierce:'M3 12h18m-5-5 5 5-5 5M8 4v4m0 8v4',dash:'m11 4 8 8-8 8M4 6h4M2 12h7M4 18h4',hook:'M5 3h11v12a5 5 0 0 1-10 0v-3l3 3',execute:'M5 3 19 17m0-14L5 17M8 3h8M5 20h14',ink:'M12 2S5 10 5 14a7 7 0 0 0 14 0c0-4-7-12-7-12M8 15a4 4 0 0 0 4 4',waves:'m3 5 5-2 8 4 5-2M3 12l5-2 8 4 5-2M3 19l5-2 8 4 5-2',burst:'M12 3v6M5 5l4 4m10-4-4 4M3 12h6m6 0h6M5 19l4-4m10 4-4-4M12 15v6',heal:'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',group:'M7 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6m10 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6M2 19v-4c0-5 10-5 10 0v4m0 0v-4c0-5 10-5 10 0v4',zone:'M4 16a8 4 0 1 0 16 0 8 4 0 1 0-16 0M12 3v10M7 8h10',rapid:'M3 6h14m-4-3 4 3-4 3M5 12h16m-3-3 3 3-3 3M3 18h14m-4-3 4 3-4 3'});
Object.assign(icons,{crossbow:'M3 8h18M7 4 3 8l4 4M17 4l4 4-4 4M12 4v17m-3-3 3 3 3-3',bow:'M6 2c16 3 16 17 0 20L12 12 6 2M3 12h17m-4-3 4 3-4 3',blades:'M4 3 16 17l-3 3L2 5zM20 3 8 17l3 3L22 5z',stamp:'M9 3h6v8l4 4v3H5v-3l4-4zM3 21h18',bind:'M7 4H4v16h3M17 4h3v16h-3M8 8l8 8m0-8-8 8',wrench:'M14 3 11 7l4 4 4-3a6 6 0 0 1-7 7l-7 7-3-3 7-7a6 6 0 0 1 5-9',projector:'M3 5h18v12H3zM12 17v5m-4 0h8M7 9l4 3-4 3m7-6h4',mop:'M16 2 8 14M4 13l11 5-2 4-11-5z',speaker:'M3 9h5l7-6v18l-7-6H3zM18 7q6 5 0 10',mute:'M3 9h4l6-5v16l-6-5H3zM17 9l5 6m0-6-5 6',sweep:'M3 18Q12 2 21 18M12 7v14m-4-4 4 4 4-4'});
function icon(name,color='currentColor'){return `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[name]??icons.bolt}"/></svg>`;}
function text(tag,value,cls=''){const e=document.createElement(tag);e.textContent=value;e.className=cls;return e;}
function button(label,fn,cls='quiet'){const b=text('button',label,cls);b.type='button';b.onclick=fn;return b;}
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,4000);}
function send(m){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({...m,...(room&&m.epoch===undefined?{epoch:room.epoch}: {}),...(room&&m.roomId===undefined?{roomId:room.id}: {})}));}
const seat=()=>room?.roster.find(s=>s.peerId===self?.peerId);
const hosting=()=>!!room&&room.hostPeerId===self?.peerId;
function transportReady(){return !runtimeFault&&connectionReady&&socket?.readyState===WebSocket.OPEN&&room?.status==='running'&&seat()?.connected&&seat()?.peerId===self?.peerId;}
function inputBlocked(){return [...document.querySelectorAll('dialog')].some(d=>d.open)||document.activeElement===$('chat-input')||!!room&&!transportReady();}
function controlState(){return{blocked:inputBlocked(),castMode:$('cast-mode').value,volume:Number($('volume').value),edgePan:$('edge-pan').checked,cameraSpeed:Number($('camera-speed').value),edgeWidth:24,...inputs.snapshot()};}
function block(){push({type:'control',...controlState()});}
const inputs=createInputRouter({frame:()=>$('game-frame'),blocked:inputBlocked,onRelease:()=>{push({type:'focus_lost'});endMapDrag('cancel');},onCanvasEnter:focusGame});
let reconnectTimer,reconnectAttempts=0,pageClosing=false,connecting=false,connectionReady=false,runtimeFault=false;
function push(m){if(m.type==='state'){const index=queue.findIndex(v=>v.type==='state');if(index>=0)queue.splice(index,1);}queue.push(m);if(queue.length>48)queue.splice(0,queue.length-48);}
function closePeers(){for(const p of peers.values())p.pc.close();peers.clear();chunks.clear();}
function focusGame(){if(!frameReady||document.querySelector('dialog[open]')||document.activeElement===$('chat-input'))return;const frame=$('game-frame');frame.contentWindow?.focus();frame.contentDocument?.querySelector('canvas')?.focus();}
function retireRenderer(old){
 const veil=text('div','正在退出对局…','retirement-cover');old.hidden=false;old.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:7;pointer-events:none';document.body.append(veil);
 const release=async()=>{let error;try{await Promise.race([old.contentWindow?.disposeTidalGame?.(),new Promise(resolve=>setTimeout(resolve,2500))]);}catch(e){error=e.message;}const exit=old.contentWindow?.mobaEngineExit;const receipt={exited:exit?.code===0,code:exit?.code??null,error:error??null};(window.mobaExitDiagnostics??=[]).push(receipt);old.remove();veil.remove();if(!loadedURL)$('game').hidden=true;if(!receipt.exited)toast('画面退出未完成，请刷新后继续。');return receipt;};
 rendererRetirement=Promise.all([rendererRetirement,release()]);
}
function finishLocal(){runtimeFault=false;inputs.clear();hudHero='';mapPings.length=0;$('chat-lines').replaceChildren();$('chat-input').value='';unbindPointer();unbindPointer=()=>{};rendererToken++;worker?.terminate();worker=null;closePeers();const old=$('game-frame');if(old.hasAttribute('src')){const fresh=old.cloneNode(false);fresh.removeAttribute('src');fresh.hidden=true;old.id='retiring-frame-'+rendererToken;old.before(fresh);retireRenderer(old);}else old.hidden=true;loadedURL=false;frameReady=false;lastState=null;queue.length=0;eventId=0;seq=0;document.body.classList.remove('playing');$('game').hidden=!document.querySelector('[id^=retiring-frame-]');$('hud').hidden=true;for(const d of document.querySelectorAll('dialog'))d.close();}
function leave(){send({type:'leave'});finishLocal();room=null;renderRoom();send({type:'list'});}
function renderRooms(rows){const box=$('room-list');box.replaceChildren();if(!rows.length){box.append(text('div','还没有房间，来创建第一场团建吧。','empty'));return;}for(const r of rows){const row=text('div','','room-row');row.append(text('strong',r.title),text('span',r.players+'/10','muted'),text('small',r.status==='waiting'?'等待中':r.status==='finished'?'已结束':'对战中','muted'),button('加入',()=>send({type:'join',roomId:r.id})));box.append(row);}}
function renderRoom(){
 $('lobby').hidden=!!room;$('room').hidden=!room||room.status!=='waiting';$('chat').hidden=!room;
 if(!room)return;const mine=seat();if(!mine)return;
 $('room-title').textContent=room.title;$('room-hint').textContent='每队各定位一位，双方可用相同英雄。空位由电脑补齐。';
 for(let team=0;team<2;team++){const box=$('team-'+team);box.replaceChildren();const rows=room.roster.filter(s=>s.team===team);for(let i=0;i<5;i++){const s=rows[i],row=text('div','',s?'seat':'seat empty-seat');if(s){const mark=text('span','','mini');mark.innerHTML=icon(HEROES[s.heroId].icon,HEROES[s.heroId].color);row.append(mark,text('b',s.name+(s.id===mine.id?' · 你':'')),text('small',s.ready?'已准备':HEROES[s.heroId].role));}else row.textContent='空位 · 开始后电脑补齐';box.append(row);}}
 const heroes=$('heroes');heroes.replaceChildren();for(const role of ROLE_IDS){const column=text('div','','hero-role');column.append(text('h3',HEROES[ROLE_HEROES[role][0]].role));for(const id of ROLE_HEROES[role]){const h=HEROES[id],b=button('',()=>send({type:'select',heroId:id,team:mine.team}),'hero-choice'+(mine.heroId===id?' selected':''));b.dataset.hero=id;b.innerHTML=icon(h.icon,h.color);b.append(text('b',h.name),text('small',h.style));b.disabled=room.roster.some(s=>s.id!==mine.id&&s.team===mine.team&&HEROES[s.heroId].roleId===role);b.title=b.disabled?'同队已有这个定位':h.weakness;column.append(b);}heroes.append(column);}
 const h=HEROES[mine.heroId],detail=$('hero-detail');
 if(detail.dataset.detailFor!==mine.heroId){
  detail.dataset.detailFor=mine.heroId;
  const moves=text('div','','hero-skills');
  for(const [key,skill] of Object.entries(h.skills)){
   const chip=text('span',key.toUpperCase()+' '+skill.name);chip.title=skill.hint;moves.append(chip);
  }
  const tips=document.createElement('details');
  tips.className='hero-tactics';tips.append(text('summary','打法与应对'));
  TACTICS[mine.heroId].forEach((tip,i)=>{
   const row=text('div','');row.append(text('b',['自己','配合','对手'][i]),document.createTextNode(tip));tips.append(row);
  });
  detail.replaceChildren(text('strong',LANES[mine.heroId]),text('div',h.passive+' '+h.weakness),moves,tips);
  detail.scrollTop=0;
 }
 $('ready').textContent=mine.ready?'取消准备':'准备';$('begin').hidden=!hosting();$('begin').disabled=room.roster.some(s=>!s.ready);$('ready-hint').textContent=hosting()?'所有同事准备后即可开始。':'准备好后，由房主开始。';
 if(!['waiting','finished'].includes(room.status)){loadGame();if(room.status==='migrating'){push({type:'control',blocked:true});toast('主机正在交接，对局暂时暂停。');}if(room.status==='running'){block();$('loading').hidden=frameReady;}}
}
function loadGame(){if(loadedURL)return;loadedURL=true;rendererToken++;document.body.classList.add('playing');$('game').hidden=false;$('loading').hidden=false;$('loading-title').textContent='正在准备战场';$('loading-note').textContent='首次进入需要加载游戏资源。';const f=$('game-frame');f.hidden=false;const token=rendererToken;void rendererRetirement.then(()=>{if(loadedURL&&rendererToken===token)f.src='/moba-play.html?renderer='+token;});}
function onRoom(next,reason){
 const changedEpoch=next&&next.epoch!==epoch;
 if(!next){finishLocal();room=null;epoch=0;if(reason)toast(reason);renderRoom();send({type:'list'});return;}
 if(room?.id!==next.id){finishLocal();checkpointReceipt=0;}
 if(changedEpoch){worker?.terminate();worker=null;closePeers();queue.length=0;eventId=0;lastState=null;push({type:'transport_reset'});}
 room=next;epoch=room.epoch;renderRoom();if(room.status==='waiting'){if(loadedURL||$('result').open)finishLocal();renderRoom();return;}
 const activePeers=new Set(room.roster.filter(s=>s.connected&&s.peerId!==self.peerId&&(hosting()||s.peerId===room.hostPeerId)).map(s=>s.peerId));for(const[id,p]of peers)if(!activePeers.has(id)){p.pc.close();peers.delete(id);for(const key of chunks.keys())if(key.startsWith(id+':'))chunks.delete(key);}
 if(hosting()){for(const s of room.roster)if(s.connected&&s.peerId!==self.peerId)void ensurePeer(s.peerId,true).catch(()=>{});worker?.postMessage({type:'membership',epoch,roster:room.roster});}
 if(changedEpoch&&frameReady){send({type:'loaded'});block();}
 if(room.status==='finished')showResult();
}
async function ensurePeer(id,offer=false){
 if(peers.has(id))return peers.get(id);const pc=new RTCPeerConnection({iceServers:[]}),p={pc,channel:null,candidates:[],epoch,roomId:room.id,mode:'relay'};peers.set(id,p);const current=()=>peers.get(id)===p&&room?.id===p.roomId&&epoch===p.epoch;p.current=current;
 pc.onicecandidate=e=>{if(current()&&e.candidate)send({type:'signal',to:id,signal:{candidate:e.candidate},epoch:p.epoch,roomId:p.roomId});};
 pc.onconnectionstatechange=()=>{if(['failed','closed','disconnected'].includes(pc.connectionState))p.mode='relay';};
 const channel=dc=>{p.channel=dc;dc.onopen=()=>{if(current())p.mode='direct';};dc.onclose=()=>{p.mode='relay';};dc.onmessage=({data})=>{if(current())receiveWire(id,data,p.epoch);};};pc.ondatachannel=e=>{if(current())channel(e.channel);else e.channel.close();};
 if(offer){channel(pc.createDataChannel('moba',{ordered:true}));const description=await pc.createOffer();if(!current())return p;await pc.setLocalDescription(description);if(current())send({type:'signal',to:id,signal:{description:pc.localDescription},epoch:p.epoch,roomId:p.roomId});}return p;
}
async function signal(m){if(!room||m.epoch!==epoch||m.roomId!==room.id)return;const p=await ensurePeer(m.from);if(!p.current())return;if(m.signal.description){await p.pc.setRemoteDescription(m.signal.description);if(!p.current())return;for(const c of p.candidates.splice(0)){if(!p.current())return;await p.pc.addIceCandidate(c);}if(m.signal.description.type==='offer'){const answer=await p.pc.createAnswer();if(!p.current())return;await p.pc.setLocalDescription(answer);if(p.current())send({type:'signal',to:m.from,signal:{description:p.pc.localDescription},epoch:p.epoch,roomId:p.roomId});}}if(m.signal.candidate&&p.current()){if(p.pc.remoteDescription)await p.pc.addIceCandidate(m.signal.candidate);else p.candidates.push(m.signal.candidate);}}
function transmit(id,data){
 const p=peers.get(id);if(p?.channel?.readyState==='open'&&p.channel.bufferedAmount<256*1024){
  try{if(data.length<=12000)p.channel.send(JSON.stringify({epoch,data}));else{const count=Math.ceil(data.length/12000),key=++packetSerial;for(let i=0;i<count;i++)p.channel.send(JSON.stringify({epoch,chunk:key,index:i,count,data:data.slice(i*12000,(i+1)*12000)}));}return;}catch{p.mode='relay';}
 }
 send({type:'relay',to:id,data});
}
function receiveWire(from,raw,wireEpoch){
 if(wireEpoch!==epoch)return;let wrapper;try{wrapper=JSON.parse(raw);}catch{return;}if(wrapper.epoch!==epoch)return;
 if(wrapper.chunk!==undefined){if(!Number.isInteger(wrapper.count)||wrapper.count<1||wrapper.count>32||wrapper.index<0||wrapper.index>=wrapper.count||typeof wrapper.data!=='string'||wrapper.data.length>12000)return;const key=from+':'+wrapper.chunk;let entry=chunks.get(key);if(!entry){if(chunks.size>=16)chunks.clear();entry={parts:new Array(wrapper.count),at:performance.now()};chunks.set(key,entry);}entry.parts[wrapper.index]=wrapper.data;if(entry.parts.filter(x=>x!==undefined).length===wrapper.count){chunks.delete(key);receive(from,entry.parts.join(''));}for(const[k,v]of chunks)if(performance.now()-v.at>3000)chunks.delete(k);return;}
 if(typeof wrapper.data==='string')receive(from,wrapper.data);
}
function receive(from,raw){
 if(!room)return;let m;try{m=parsePacket(raw);}catch{return;}
 if(hosting()){
  if(!room.roster.some(s=>s.peerId===from&&s.connected))return;
  if(m.type==='input')worker?.postMessage({type:'command',epoch,peerId:from,command:m.command});
  else if(m.type==='ping')transmit(from,JSON.stringify({type:'pong',at:m.at}));return;
 }
 if(from!==room.hostPeerId)return;
 if(m.type==='pong'){rtt=Math.max(0,performance.now()-m.at);return;}deliver(m);
}
function deliver(m){
 if(m.type==='state'){if(!hosting())runtimeFault=false;if(lastState&&m.tick<lastState.tick)return;lastState=m;seq=Math.max(seq,m.self?.lastSeq??0);push(m);scheduleHUD();}
 else if(m.type==='result'){if(!m.ok)toast(({COOLDOWN:'技能还在冷却',NO_MANA:'法力不足',LEVEL_REQUIRED:'先升级技能，大招6级可学',CASTING:'技能施放中',NO_SKILL_POINT:'暂无可用技能点',INVALID_SKILL_RANK:'还不能升级这招',WARD_COOLDOWN:'侦查灯还在冷却',SHOP_AT_BASE:'回到基地才能购买',NO_GOLD:'金币不足',INVALID_TARGET:'请选择范围内可见的目标',BLOCKED:'这里无法到达',CONTROLLED:'正在被控制',ROOTED:'定身中，暂时不能移动',SILENCED:'沉默中，仍可移动和普攻',SLOTS_FULL:'最多六件，同类不重复'})[m.code]??'这次操作暂时无法执行');}
}
function command(m){if(!transportReady()||!frameReady)return;const cmd={...m,seq:++seq};inputTimes.set(cmd.seq,{at:performance.now(),type:m.type});while(inputTimes.size>128)inputTimes.delete(inputTimes.keys().next().value);if(hosting())worker?.postMessage({type:'command',epoch,peerId:self.peerId,command:cmd});else transmit(room.hostPeerId,JSON.stringify({type:'input',command:cmd}));}
window.makeMobaTransport=(child,token)=>{const current=()=>String(rendererToken)===String(token)&&child===$('game-frame').contentWindow&&loadedURL;
const api={
 ready:()=>!!room,
 beforePointer:callback=>{unbindPointer();const detachInput=inputs.attach(child),canvas=child.document.querySelector('canvas'),events=['mousedown','mouseup','mousemove','wheel'];let flushing=false;const flush=()=>{if(!current()||flushing)return;flushing=true;try{callback();}finally{flushing=false;}};for(const event of events)canvas?.addEventListener(event,flush,{capture:true,passive:true});unbindPointer=()=>{detachInput();for(const event of events)canvas?.removeEventListener(event,flush,true);};},
 poll:()=>JSON.stringify(queue.splice(0)),
 inputState:()=>JSON.stringify(controlState()),
 localFeedback:raw=>{try{visualFeedbackSamples.push(JSON.parse(raw));if(visualFeedbackSamples.length>256)visualFeedbackSamples.shift();}catch{}},
 send:raw=>{try{command(JSON.parse(raw));}catch{}},
 feedback:seq=>{const sent=inputTimes.get(Number(seq));if(sent){feedbackSamples.push({type:sent.type,ms:performance.now()-sent.at,at:performance.now()});if(feedbackSamples.length>256)feedbackSamples.shift();inputTimes.delete(Number(seq));}},
 loaded:()=>{frameReady=true;$('hud').hidden=false;send({type:'loaded'});if(lastState)push(lastState);push({type:'map',map:MAP,heroes:HEROES});block();if(room?.status==='running')$('loading').hidden=true;else{$('loading-title').textContent='等待队友';$('loading-note').textContent='大家加载完成后，一起开始。';}},
 ui:action=>{if(action==='score_hold'){scoreHeld=true;renderScore($('score-preview-rows'));$('score-preview').hidden=false;return;}if(action==='score_hide'){scoreHeld=false;$('score-preview').hidden=true;return;}if(action==='menu')openDialog('menu');if(action==='shop')openDialog('shop');if(action==='score')openDialog('scoreboard');if(action==='chat'){$('chat-body').hidden=false;chatCollapsed=false;$('chat-input').focus();block();}},
 aim:key=>{aiming=String(key);updateSkills();},
 ping:(kind,x,z)=>send({type:'map_ping',kind:String(kind),x:Number(x),z:Number(z)}),
 diagnostic:raw=>{try{window.mobaRenderDiagnostics={...window.mobaRenderDiagnostics,...JSON.parse(raw)};}catch{}},
 loading:m=>{if(m.phase==='error'){$('loading-title').textContent='战场加载失败';$('loading-note').textContent='请返回大厅重试。';}}
};return guardRendererApi(api,current);};
function openDialog(id){for(const d of document.querySelectorAll('dialog'))if(d.open)d.close();if(id==='shop')renderShop();if(id==='scoreboard')renderScore($('score-rows'));$(id).showModal();block();}
function closeDialog(id){$(id).close();block();focusGame();}
function updateSkills(){if(!lastState?.self)return;const mine=lastState.self,hero=HEROES[mine.heroId];for(const k of ['q','w','e','r']){const b=$('skill-'+k);if(!b)continue;const cd=Math.max(0,mine.cooldowns[k]-lastState.time);b.classList.toggle('aiming',aiming===k);b.querySelector('.cooldown').hidden=cd<=0&&mine.skills[k]>0;b.querySelector('.cooldown').textContent=mine.skills[k]===0?'未学':Math.ceil(cd);b.parentElement.querySelector('.learn').hidden=!mine.learnable?.includes(k);b.parentElement.querySelector('.rank').textContent='●'.repeat(mine.skills[k]);b.title=hero.skills[k].name+' · '+mine.skills[k]+'级\n'+hero.skills[k].hint+'\n冷却 '+(hero.skills[k].cooldown*(1-mine.stats.haste)).toFixed(1)+'秒 · 法力 '+hero.skills[k].mana+' · 射程 '+hero.skills[k].range+(hero.skills[k].radius?' · 范围 '+hero.skills[k].radius:'')+(mine.learnable?.includes(k)?'\n可升级：提升招式效果':'');b.classList.toggle('locked',mine.skills[k]===0);b.classList.toggle('unavailable',mine.skills[k]===0||mine.mana<hero.skills[k].mana||mine.silenced||mine.hp<=0);b.setAttribute('aria-label',k.toUpperCase()+' '+hero.skills[k].name+'：'+hero.skills[k].hint);}for(const k of ['d','f','ward']){const b=$('skill-'+k),cd=Math.max(0,(k==='ward'?mine.wardAt:mine.summoners?.[k])??0)-lastState.time;b.querySelector('.cooldown').hidden=cd<=0;b.querySelector('.cooldown').textContent=Math.ceil(Math.max(0,cd));} $('skill-f').querySelector('b').textContent=hero.roleId==='jungle'?'惩戒':'治疗';}
let hudHero='';
function renderHUD(){
 const s=lastState,m=s.self;if(!m)return;const h=HEROES[m.heroId];
 if(hudHero!==m.heroId){hudHero=m.heroId;$('self-icon').innerHTML=icon(h.icon,h.color);$('self-name').textContent=h.name;const box=$('skill-buttons');box.replaceChildren();for(const k of ['q','w','e','r']){const b=button('',()=>{push({type:'aim',key:k});focusGame();},'skill');b.id='skill-'+k;b.title=h.skills[k].name+' · '+h.skills[k].hint;b.innerHTML=`<span class="key">${k.toUpperCase()}</span><span class="skill-symbol">${icon(h.skills[k].icon,h.color)}</span><b>${h.skills[k].name}</b><span class="cooldown" hidden></span>`;const cell=text('div','','skill-cell'),learn=button('+',()=>{command({type:'learn',skill:k});focusGame();},'learn');learn.title='升级 '+k.toUpperCase()+'（Ctrl+'+k.toUpperCase()+'）';learn.setAttribute('aria-label','升级 '+k.toUpperCase());cell.append(learn,b,text('small','','rank'));box.append(cell);}}
 $('clock').textContent=String(Math.floor(s.time/60)).padStart(2,'0')+':'+String(Math.floor(s.time%60)).padStart(2,'0');const kills=[0,1].map(t=>s.score.filter(h=>h.team===t).reduce((sum,h)=>sum+h.kills,0));$('score').textContent=kills[0]+' : '+kills[1];
 $('net').textContent=hosting()?'本地主机':(peers.get(room.hostPeerId)?.mode==='direct'?'直连 ':'中转 ')+Math.round(rtt)+'ms';$('self-level').textContent='Lv.'+m.level+' · '+h.role+' · 补刀 '+(m.cs??0);$('economy-note').textContent=h.roleId==='support'?'协作收入 '+Math.floor(m.supportGold??0)+' 金':'末击得金币 · 附近共享经验';$('self-card').title='累计收入 '+Math.floor(m.totalGold??m.gold)+' 金 · 护甲 '+Math.round(m.stats.armor)+' · 魔抗 '+Math.round(m.stats.magicResist??0);
 $('hp-fill').style.width=(m.hp/m.maxHp*100)+'%';$('hp-label').textContent=Math.ceil(m.hp)+' / '+m.maxHp;$('mana-fill').style.width=(m.mana/m.maxMana*100)+'%';$('mana-label').textContent=Math.floor(m.mana)+' / '+m.maxMana;$('xp-fill').style.width=(m.level===RULES.maxLevel?100:m.xp/m.nextXp*100)+'%';$('gold').textContent=m.gold+' 金';updateSkills();
 const equipment=$('equipped'),equipmentKey=JSON.stringify([m.items,m.itemRanks]);if(equipment.dataset.key!==equipmentKey){equipment.dataset.key=equipmentKey;equipment.replaceChildren();for(let i=0;i<RULES.itemSlots;i++){const id=m.items[i],slot=text('span','','equipped-slot');if(id){slot.innerHTML=icon(ITEMS[id].icon);slot.title=ITEMS[id].name+(m.itemRanks?.[id]?' · 强化':'');if(m.itemRanks?.[id])slot.classList.add('upgraded');}else slot.title='空装备位';equipment.append(slot);}}
 const objective=s.objective;$('objective-status').textContent=(s.objectives??[]).map(o=>{const secs=Math.max(0,Math.ceil(o.nextAt-s.time));return o.name+' '+(o.alive?'可争夺':Math.floor(secs/60)+':'+String(secs%60).padStart(2,'0'));}).join(' · ');
 $('lane-hint').textContent=s.time<35?LANES[m.heroId]:(m.skillPoints>0?'有技能点 · 点技能上方＋':m.level<6?'发育到6级，解锁大招':'推塔破基地 · G集合 V撤退');
 $('phase-hint').textContent=s.time<RULES.firstWave?'出兵倒计时 '+Math.ceil(RULES.firstWave-s.time):s.time<RULES.firstWave+5?'兵线出发！':'巨蟹助战 · 巨像强化兵线';
 $('death').hidden=m.hp>0;const recap=m.deathRecap;const totals=new Map();for(const hit of recap?.damage??[]){const key=hit.source+'|'+hit.type,entry=totals.get(key)??{name:hit.name,type:hit.type,amount:0};entry.amount+=hit.amount;totals.set(key,entry);}const cause=[...totals.values()].sort((a,b)=>b.amount-a.amount).slice(0,2).map(d=>(d.name??'敌方单位')+' '+Math.round(d.amount)+' '+({physical:'物理',magic:'法术',true:'真实'}[d.type]??'')).join(' / ');$('death').replaceChildren(text('b',Math.max(0,Math.ceil(m.respawnAt-s.time))+' 秒后归队'),text('small',recap?'击败你的：'+(recap.killer?.name??'敌方单位'):'等待队友，留意小地图'),text('small',cause?'主要承伤：'+cause:'可在基地商店调整装备'));$('death').title=(recap?.controls??[]).map(c=>({stun:'眩晕',root:'定身',silence:'沉默',slow:'减速'}[c.type]??c.type)+' '+Number(c.duration).toFixed(1)+'秒').join(' / ');if(m.recallAt>s.time){$('recall').querySelector('b').textContent=Math.ceil(m.recallAt-s.time)+'秒';}else $('recall').querySelector('b').textContent='回城';
 drawMap(s);if(scoreHeld)renderScore($('score-preview-rows'));if($('scoreboard').open)renderScore($('score-rows'));if($('shop').open)renderShop();
 for(const e of s.events){if(e.id<=eventId)continue;eventId=e.id;if(e.kind==='death'&&e.kindOf==='hero'){const a=s.score.find(h=>h.id===e.source),b=s.score.find(h=>h.id===e.target),row=text('div',(a?.name??'防御设施')+' 击败 '+(b?.name??'英雄'));$('killfeed').prepend(row);while($('killfeed').childNodes.length>4)$('killfeed').lastChild.remove();setTimeout(()=>row.remove(),4500);}}
 if(s.phase==='finished')showResult();
}
function drawMap(s){
 const c=$('minimap').getContext('2d'),n=190,to=p=>({x:(p.x+MAP.size/2)/MAP.size*n,y:(p.z+MAP.size/2)/MAP.size*n});c.fillStyle='#26443d';c.fillRect(0,0,n,n);
 c.strokeStyle='#447984';c.lineWidth=10;c.beginPath();c.moveTo(15,15);c.lineTo(175,175);c.stroke();
 c.strokeStyle='#a5ac92';c.lineWidth=MAP.laneWidth/MAP.size*n;for(const lane of MAP.lanes){c.beginPath();lane.forEach((p,i)=>{const q=to(p);i?c.lineTo(q.x,q.y):c.moveTo(q.x,q.y);});c.stroke();}
 c.fillStyle='#5a7e50';for(const b of MAP.brush){const p=to(b);c.beginPath();c.arc(p.x,p.y,b.r/MAP.size*n,0,Math.PI*2);c.fill();}
 c.fillStyle='#152a2d';for(const b of MAP.walls){const p=to({x:b.x-b.w/2,z:b.z-b.d/2});c.fillRect(p.x,p.y,b.w/MAP.size*n,b.d/MAP.size*n);}
 if(s.vision){const z=s.vision.size,t=n/z;c.fillStyle='#06151bb8';for(let i=0;i<s.vision.cells.length;i++)if(s.vision.cells[i]==='0')c.fillRect(i%z*t,Math.floor(i/z)*t,t+.5,t+.5);}
 for(const e of s.entities){if(e.hp<=0)continue;const p=to(e);c.fillStyle=e.team===0?'#62c1e2':e.team===1?'#f19c80':'#dfc677';c.strokeStyle='#122b32';c.lineWidth=1;c.beginPath();
  if(e.kind==='hero'){c.arc(p.x,p.y,4.5,0,Math.PI*2);c.fill();c.stroke();c.fillStyle='#152c33';c.font='bold 7px sans-serif';c.textAlign='center';c.fillText(({marksman:'射',jungle:'野',mage:'法',tank:'坦',support:'辅'})[HEROES[e.heroId]?.roleId]??'',p.x,p.y+2.5);}
  else if(['tower','inhibitor','core'].includes(e.kind)){const r=e.kind==='core'?4.5:2.5;c.rect(p.x-r,p.y-r,r*2,r*2);c.fill();c.stroke();}
  else if(e.kind==='ward'){c.moveTo(p.x,p.y-3);c.lineTo(p.x+3,p.y);c.lineTo(p.x,p.y+3);c.lineTo(p.x-3,p.y);c.closePath();c.strokeStyle='#e8edbd';c.stroke();}
  else if(['crab','archive'].includes(e.species)){c.moveTo(p.x,p.y-4);c.lineTo(p.x+4,p.y);c.lineTo(p.x,p.y+4);c.lineTo(p.x-4,p.y);c.closePath();c.fill();c.stroke();}
  else{c.arc(p.x,p.y,e.kind==='minion'?1.2:2,0,Math.PI*2);c.fill();}
  if(e.id===s.selfId){c.beginPath();c.arc(p.x,p.y,5.5,0,Math.PI*2);c.strokeStyle='#fff7d8';c.lineWidth=1.5;c.stroke();}
 }
 const camera=window.mobaRenderDiagnostics;if(camera){const p=to({x:camera.cameraX,z:camera.cameraZ});c.strokeStyle='#edf0c999';c.lineWidth=1;if(camera.viewCorners?.length===4){c.beginPath();camera.viewCorners.forEach((v,i)=>{const q=to(v);i?c.lineTo(q.x,q.y):c.moveTo(q.x,q.y);});c.closePath();c.stroke();}}
 for(const ping of mapPings){if(performance.now()>ping.until)continue;const p=to(ping);c.strokeStyle=ping.kind==='danger'?'#ffad8c':'#a2edf3';c.lineWidth=2;c.beginPath();c.arc(p.x,p.y,5+(performance.now()%800)/160,0,Math.PI*2);c.stroke();}
 while(mapPings.length&&mapPings[0].until<performance.now())mapPings.shift();
}
function renderShop(){
 const m=lastState?.self;if(!m)return;const root=$('items'),own=lastState.entities.find(e=>e.id===lastState.selfId),base=MAP.spawn[lastState.team],atBase=m.hp<=0||own&&Math.hypot(own.x-base.x,own.z-base.z)<7;
 const labels={speed:'移速',attack:'攻击',power:'技能强度',armor:'护甲',magicResist:'魔抗',hp:'生命',mana:'法力',haste:'冷却缩减',attackSpeed:'攻速',regen:'回血',healing:'治疗'};
 for(const[id,item]of Object.entries(ITEMS)){
  let row=root.querySelector('[data-item="'+id+'"]');
  if(!row){row=text('div','','item');row.dataset.item=id;const i=text('span');i.innerHTML=icon(item.icon);i.title=item.hint??'';const desc=text('div');desc.append(text('b',''),text('small',''),text('span','','item-price'));const actions=text('div','','item-actions');const purchase=button('购买',()=>command({type:lastState.self.items.includes(id)?'upgrade':'buy',item:id}),'primary'),sell=button('卖出',()=>command({type:'sell',item:id}),'quiet');purchase.dataset.action='purchase';sell.dataset.action='sell';actions.append(purchase,sell);row.append(i,desc,actions);root.append(row);}
  const bought=m.items.includes(id),upgraded=m.itemRanks?.[id]===1,price=bought?upgradePrice(id):item.price;
  row.title=item.hint??'';row.dataset.branch=item.branch??'utility';row.hidden=shopBranch!=='all'&&row.dataset.branch!==shopBranch;row.querySelector('b').textContent=item.name+(upgraded?' ★':RECOMMENDED[m.heroId].includes(id)?' · 推荐':'');
  row.querySelector('small').textContent=Object.entries(labels).filter(([k])=>item[k]).map(([k,l])=>{const value=item[k]*(upgraded?1.5:1);return l+' +'+(item[k]<1?Math.round(value*100)+'%':Math.round(value*10)/10);}).join(' / ');
  row.querySelector('.item-price').title=item.hint??'';row.querySelector('.item-price').textContent=upgraded?'已完成强化':price+' 金'+(bought?' · 属性 +50%':'');
  const purchase=row.querySelector('[data-action="purchase"]'),sell=row.querySelector('[data-action="sell"]');purchase.textContent=upgraded?'已强化':bought?'强化':'购买';purchase.disabled=upgraded||(!bought&&m.items.length>=RULES.itemSlots)||m.gold<price||!atBase;purchase.title=!atBase?'回基地或等待复活时购买':m.gold<price?'金币不足':'';sell.hidden=!bought;sell.disabled=!atBase;sell.title='返还 '+Math.floor((item.price+(upgraded?upgradePrice(id):0))*.7)+' 金';
 }
 $('shop-hint').textContent=(atBase?'基地补给':'回到基地购买')+' · '+m.gold+' 金 · '+m.items.length+'/'+RULES.itemSlots+' 件';
}
function renderScore(root){root.replaceChildren();if(!lastState)return;for(let team=0;team<2;team++){root.append(text('h3',team===0?'蓝队':'橙队'));for(const h of lastState.score.filter(h=>h.team===team)){const row=text('div','','score-row');row.append(text('span',h.name),text('small',HEROES[h.heroId].role+' · '+h.level+'级'),text('b',h.kills+'/'+h.deaths+'/'+h.assists),text('small','补刀 '+(h.cs??0)+(Number.isFinite(h.totalGold)?' · 收入 '+Math.floor(h.totalGold)+' 金':'')+(h.supportGold?' · 协作 '+Math.floor(h.supportGold):'')));if(lastState.phase==='finished')row.append(text('small','伤害 '+Math.round(h.damage)+' · 治疗 '+Math.round(h.healing)+' · 推塔 '+h.towers));root.append(row);}}}
function showResult(){if(!lastState||lastState.phase!=='finished')return;const won=lastState.winner===lastState.team;$('result-title').textContent=won?'团建胜利！':'下局再战';$('result-note').textContent='用时 '+Math.floor(lastState.time/60)+'分'+Math.floor(lastState.time%60)+'秒 · 摧毁基地获胜';renderScore($('result-stats'));$('rematch').hidden=!hosting();if(!$('result').open){for(const d of document.querySelectorAll('dialog'))d.close();$('result').showModal();block();}}
async function connect(){
 if(connecting||pageClosing)return;connecting=true;clearTimeout(reconnectTimer);
 const auth=await fetch('/api/platform/me',{credentials:'same-origin'});if(!auth.ok){connecting=false;location.replace('/');return;}connectionReady=false;
 const activeSocket=socket=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/moba/socket');
 socket.onopen=()=>{connecting=false;};
 socket.onmessage=({data})=>{if(socket!==activeSocket)return;let m;try{m=JSON.parse(data);}catch{return;}
  if(m.type==='welcome'){connectionReady=!room;reconnectAttempts=0;$('reconnect').hidden=true;self=m.self;$('create').disabled=false;$('refresh').disabled=false;$('connection').textContent='已连接 · '+self.name;renderRooms(m.rooms);const previous=sessionStorage.getItem('moba-room');if(previous)send({type:'join',roomId:previous});}
  if(m.type==='rooms')renderRooms(m.rooms);
  if(m.type==='room'){connectionReady=true;const resumed=frameReady&&m.room&&m.room.id===room?.id&&socket===activeSocket;if(m.room)sessionStorage.setItem('moba-room',m.room.id);else sessionStorage.removeItem('moba-room');onRoom(m.room,m.reason);if(resumed){send({type:'loaded'});block();}}
  if(m.type==='final_state'&&m.epoch===epoch)deliver(m.state);
  if(m.type==='error'){toast(m.message);if(m.code==='NOT_FOUND'){sessionStorage.removeItem('moba-room');connectionReady=true;onRoom(null,'原对局已结束，请重新创建或加入。');}}
  if(m.type==='signal')void signal(m).catch(()=>{});
  if(m.type==='relay'&&m.epoch===epoch&&m.roomId===room?.id)receive(m.from,m.data);
  if(m.type==='host_init'){
   if(m.epoch!==epoch||!hosting())return;
   runtimeFault=false;worker?.terminate();worker=new Worker('/moba/host-worker.mjs',{type:'module'});
   const active=worker,activeEpoch=epoch;
   worker.onmessage=({data:v})=>{if(worker!==active||epoch!==activeEpoch)return;if(v.type==='packet'){if(v.peerId===self.peerId)deliver(parsePacket(v.data));else transmit(v.peerId,v.data);if(v.frameId)active.postMessage({type:'frame_ack',epoch:activeEpoch,frameId:v.frameId});}else if(v.type==='fatal'){runtimeFault=true;toast(v.message);push({type:'control',blocked:true});}else send(v);};
   worker.onerror=()=>{if(worker!==active||epoch!==activeEpoch)return;runtimeFault=true;toast('对局主机出现异常，正在等待恢复。');push({type:'control',blocked:true});active.terminate();};
   worker.postMessage({...m,type:'init'});
  }
  if(['resume','membership','checkpoint_ack'].includes(m.type)){if(m.type==='checkpoint_ack')checkpointReceipt=m.revision;worker?.postMessage(m);}
  if(m.type==='map_ping'){mapPings.push({...m,until:performance.now()+3500});if(mapPings.length>8)mapPings.shift();push(m);toast(m.name+'：'+({go:'这里集合',danger:'小心，撤退',help:'需要支援'})[m.kind]);}
  if(m.type==='chat'){const line=text('div');line.append(text('b',m.name+'：'),document.createTextNode(m.text));$('chat-lines').append(line);while($('chat-lines').childNodes.length>80)$('chat-lines').firstChild.remove();$('chat-lines').scrollTop=$('chat-lines').scrollHeight;}
 };
 socket.onclose=()=>{if(socket!==activeSocket||pageClosing)return;connecting=false;connectionReady=false;inputs.clear();$('create').disabled=true;$('refresh').disabled=true;for(const b of $('room-list').querySelectorAll('button'))b.disabled=true;worker?.terminate();worker=null;closePeers();$('connection').textContent='连接已断开';push({type:'control',blocked:true});toast('连接中断，正在尝试回到本局。');scheduleReconnect();};
 socket.onerror=()=>{if(socket===activeSocket)$('connection').textContent='正在重新连接…';};
}
function scheduleReconnect(){clearTimeout(reconnectTimer);if(pageClosing)return;$('reconnect').hidden=false;$('reconnect').textContent='重连';if(reconnectAttempts>=6){toast('暂未连上，可点重连；原对局会尝试保留。');return;}const wait=Math.min(500*2**reconnectAttempts++,5000);reconnectTimer=setTimeout(()=>connect().catch(()=>{connecting=false;scheduleReconnect();}),wait);}
let shopBranch='all';for(const b of document.querySelectorAll('[data-branch]'))b.onclick=()=>{shopBranch=b.dataset.branch;for(const t of document.querySelectorAll('#shop-tabs button'))t.classList.toggle('active',t===b);for(const item of $('items').children)item.hidden=shopBranch!=='all'&&item.dataset.branch!==shopBranch;};
$('reconnect').onclick=()=>{reconnectAttempts=0;void connect().catch(()=>{connecting=false;scheduleReconnect();});};
$('create').onclick=()=>send({type:'create',title:'办公室团建'});$('refresh').onclick=()=>send({type:'list'});$('ready').onclick=()=>send({type:'ready'});$('begin').onclick=()=>send({type:'begin'});
for(const b of document.querySelectorAll('[data-team]'))b.onclick=()=>{const team=Number(b.dataset.team),heroId=HERO_IDS.find(id=>!room.roster.some(s=>s.team===team&&HEROES[s.heroId].roleId===HEROES[id].roleId&&s.id!==seat()?.id));if(heroId)send({type:'select',team,heroId});else toast('这支队伍已满');};
for(const id of ['leave','loading-back','exit-match','result-leave'])$(id).onclick=leave;
$('back').onclick=async()=>{if(room)leave();await rendererRetirement;location.href='/';};$('rematch').onclick=()=>send({type:'rematch'});
for(const id of ['menu','shop'])$(id+'-open').onclick=()=>openDialog(id);
// Score button uses a shorter visible name; dialog remains a separate stable panel.
$('score-open').onclick=()=>openDialog('scoreboard');
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>closeDialog(b.dataset.close);
for(const d of document.querySelectorAll('dialog')){d.addEventListener('close',()=>{block();focusGame();});d.addEventListener('cancel',e=>{if(d.id==='result'&&lastState?.phase==='finished')e.preventDefault();setTimeout(block,0);});}
$('recall').onclick=()=>{command({type:'recall'});focusGame();};$('cast-mode').onchange=()=>{localStorage.setItem('moba-cast-mode',$('cast-mode').value);block();};$('cast-mode').value=localStorage.getItem('moba-cast-mode')??'normal';$('volume').oninput=block;$('edge-pan').onchange=()=>{localStorage.setItem('moba-edge-pan',String($('edge-pan').checked));block();};$('edge-pan').checked=localStorage.getItem('moba-edge-pan')!=='false';$('camera-speed').value=String(Math.max(24,Math.min(100,Number(localStorage.getItem('moba-camera-speed'))||56)));$('camera-speed').oninput=()=>{localStorage.setItem('moba-camera-speed',$('camera-speed').value);block();};$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('浏览器未开启全屏，可使用 F11。');}};document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'退出全屏':'全屏';block();});window.addEventListener('resize',block);
$('chat-toggle').onclick=()=>{chatCollapsed=!chatCollapsed;$('chat-body').hidden=chatCollapsed;$('chat-toggle').querySelector('span').textContent=chatCollapsed?'展开':'收起';block();focusGame();};
$('chat-input').onfocus=block;$('chat-input').onblur=block;
$('chat-input').onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();$('chat-input').blur();$('game-frame').contentWindow?.focus();}};
$('chat-form').onsubmit=e=>{e.preventDefault();send({type:'chat',text:$('chat-input').value});$('chat-input').value='';$('chat-input').blur();$('game-frame').contentWindow?.focus();block();};
const mapPosition=e=>{const r=$('minimap').getBoundingClientRect();return{x:Math.max(-MAP.boundary,Math.min(MAP.boundary,(e.clientX-r.left)/r.width*MAP.size-MAP.size/2)),z:Math.max(-MAP.boundary,Math.min(MAP.boundary,(e.clientY-r.top)/r.height*MAP.size-MAP.size/2))};};
let mapDragging=false;
function endMapDrag(phase='end'){if(!mapDragging)return;mapDragging=false;push({type:'camera',phase});}

$('minimap').addEventListener('pointerdown',e=>{e.preventDefault();const p=mapPosition(e);if(e.button===2){command({type:'move',...p});focusGame();return;}if(e.shiftKey){send({type:'map_ping',kind:'go',...p});focusGame();return;}if(e.button!==0)return;mapDragging=true;e.currentTarget.setPointerCapture(e.pointerId);push({type:'camera',phase:'start',...p});});
$('minimap').addEventListener('pointermove',e=>{if(mapDragging)push({type:'camera',phase:'move',...mapPosition(e)});});
$('minimap').addEventListener('pointerup',()=>{endMapDrag();focusGame();});
for(const event of ['pointercancel','lostpointercapture'])$('minimap').addEventListener(event,()=>endMapDrag('cancel'));
$('minimap').addEventListener('contextmenu',e=>e.preventDefault());
for(const k of ['d','f','ward'])$('skill-'+k).onclick=()=>{push({type:'aim',key:k});focusGame();};
window.addEventListener('keyup',e=>{if(e.key==='Tab'&&scoreHeld){scoreHeld=false;$('score-preview').hidden=true;focusGame();}});
window.addEventListener('blur',()=>setTimeout(()=>{if(document.hasFocus())return;scoreHeld=false;$('score-preview').hidden=true;push({type:'focus_lost'});},0));
document.addEventListener('visibilitychange',()=>{if(document.hidden&&loadedURL&&room?.status==='running')openDialog('menu');});
window.addEventListener('blur',()=>setTimeout(()=>{if(!document.hasFocus()&&loadedURL&&room?.status==='running')openDialog('menu');},0));
window.addEventListener('keydown',e=>{if(e.target instanceof HTMLInputElement)return;if(e.key==='Escape'&&loadedURL&&!document.querySelector('dialog[open]')){e.preventDefault();openDialog('menu');}});
window.addEventListener('pagehide',()=>{pageClosing=true;clearTimeout(reconnectTimer);inputs.dispose();unbindPointer();worker?.terminate();closePeers();socket?.close();});
setInterval(()=>{if(room?.status==='running'&&!hosting())transmit(room.hostPeerId,JSON.stringify({type:'ping',at:performance.now()}));},1500);
window.mobaDiagnostics=()=>({version:VERSION,inputFeedback:feedbackSamples,visualFeedback:visualFeedbackSamples,input:controlState(),room:room?{status:room.status,epoch:room.epoch,slots:room.roster.length}:null,hosting:hosting(),frameReady,checkpointReceipt,transport:hosting()?'local':peers.get(room?.hostPeerId)?.mode??'relay',rtt,state:lastState?{phase:lastState.phase,tick:lastState.tick,time:lastState.time,self:lastState.self,entities:lastState.entities,team:lastState.team,selfId:lastState.selfId}:null});
void connect().catch(()=>{connecting=false;scheduleReconnect();});
