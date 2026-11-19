import {SOCIAL_RULES as R,SOCIAL_STAMPS,SOCIAL_SOUVENIRS,collectionOf,mergeCollection,socialCatalog} from './social-config.mjs';

import {activity,displaySouvenir,validateDisplays} from './social-activities.mjs';

const ATTACHED=Symbol('Office99 social');
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const position=p=>({x:p.x,y:p.y,z:p.z});
const clone=structuredClone;
const text={INVALID_TARGET:'这个目标不能互动',NOT_ALIVE:'先站起来再玩',OUT_OF_RANGE:'靠近一点再试',
  WRONG_PHASE:'守夜时先收起玩具',BUSY:'先完成手上的事',NO_AMMO:'背包里没有可递的咖啡',
  NO_CAPACITY:'对方背包满了',SOCIAL_COOLDOWN:'稍等一下再玩',SOCIAL_DECLINED:'对方还没加入纸团嬉戏',
  SOCIAL_EXPIRED:'这次邀请已结束',STALE_REVISION:'咖啡已变化，请重新递出',SOCIAL_LOCKED:'先找到这件纪念品'};
export class SocialError extends Error {constructor(code){super(text[code]??'暂时不能互动');this.code=code;}}
const need=(ok,code='INVALID_TARGET')=>{if(!ok)throw new SocialError(code);};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);

function preferences(w,p) {
  const key=p.id;
  if(!w.s.social.playerStates[key])w.s.social.playerStates[key]={participating:false,hat:false,unlocked:[],nextAt:0,targetCooldowns:{}};
  p.collection??=collectionOf();const row=w.s.social.playerStates[key];row.unlocked=[...p.collection.unlocked];row.hat=p.collection.hat;return row;
}
function active(w,p) {return !!p&&p.connected===true&&w.inScene(p)&&p.lifeState==='ALIVE';}
function available(w,p) {
  need(active(w,p),'NOT_ALIVE');need(!['NIGHT','COMPLETE'].includes(w.s.phase),'WRONG_PHASE');
  need(!p.swimming&&!p.work&&!p.fishing&&!p.reload&&!p.meleePending&&!p.carryingId&&!p.input?.fire,'BUSY');
}
function near(w,p,q,range=R.range) {
  need(active(w,q)&&p.id!==q.id,'INVALID_TARGET');
  need(distance(p,q)<=range&&Math.abs(p.y-q.y)<=1.8&&w.lineVisible(p,q),'OUT_OF_RANGE');
}
function clearOffers(w,pId) {
  for(const [id,o]of Object.entries(w.s.social.offers))if(o.fromId===pId||o.toId===pId)delete w.s.social.offers[id];
}
function cooldown(w,p,seconds=R.cooldownSeconds) {
  const row=preferences(w,p);need(w.s.time>=row.nextAt,'SOCIAL_COOLDOWN');row.nextAt=w.s.time+seconds;
}
function unlock(w,p,id) {
  if(!p||w.mode==='mission')return;
  const row=preferences(w,p);if(row.unlocked.includes(id))return;
  p.collection.unlocked.push(id);row.unlocked=[...p.collection.unlocked];w.requestSave=true;w.event('SocialUnlocked',{actorId:p.id,souvenirId:id},p.id);
}
function coffee(w,p,itemId=null) {
  const item=itemId?w.s.items[itemId]:w.bag(p)?.itemIds.map(id=>w.s.items[id]).find(i=>i?.definitionId==='coffee_flask'&&!i.lockedBy&&!i.loanOwnerSlotId);
  need(item?.definitionId==='coffee_flask'&&item.containerId===p.backpackId&&!item.lockedBy&&!item.loanOwnerSlotId&&item.quantity>0,'NO_AMMO');
  return item;
}
function invitation(w,p,q,kind,extra={}) {
  for(const [id,o]of Object.entries(w.s.social.offers))if(o.fromId===p.id)delete w.s.social.offers[id];
  need(Object.keys(w.s.social.offers).length<R.offerLimit,'BUSY');
  const id=w.id('social-offer'),offer={id,kind,fromId:p.id,toId:q.id,expiresAt:w.s.time+R.offerSeconds,...extra};
  w.s.social.offers[id]=offer;w.event('SocialOffered',clone(offer),p.id);return {offerId:id};
}
function targetPoint(w,p,payload,range) {
  const supplied=payload.x!==undefined||payload.z!==undefined;
  need(!supplied||(Number.isFinite(payload.x)&&Number.isFinite(payload.z)));
  const power=payload.power??.65;need(Number.isFinite(power)&&power>=.15&&power<=1);
  const x=supplied?payload.x:p.x-Math.sin(p.yaw)*range*power,z=supplied?payload.z:p.z-Math.cos(p.yaw)*range*power;
  need(distance(p,{x,z})<=range+.001,'OUT_OF_RANGE');
  const boundary=w.staticWorld().boundaryRadius??200;need(Math.hypot(x,z)<=boundary-1,'OUT_OF_RANGE');
  const y=w.ground(x,z);need(Number.isFinite(y)&&y>=w.s.waterY-.4,'INVALID_TARGET');
  return {x,y:y+.05,z};
}
function launch(w,p,payload,existing=null) {
  const at=targetPoint(w,p,payload,R.planeRange),state=w.s.social;
  if(!existing){for(const [id,plane]of Object.entries(state.planes))if(plane.ownerId===p.id)delete state.planes[id];need(Object.keys(state.planes).length<R.planeLimit,'BUSY');}
  const plane=existing??{id:w.id('social-plane'),relayCount:0};
  Object.assign(plane,{ownerId:p.id,from:position({...p,y:p.y+1.1}),to:at,startedAt:w.s.time,
    landsAt:w.s.time+R.planeSeconds,expiresAt:w.s.time+R.planeLifetime,landed:false,scored:false});
  if(existing)plane.relayCount++;
  state.planes[plane.id]=plane;w.event('SocialPlayed',{kind:'airplane',actorId:p.id,planeId:plane.id,relayCount:plane.relayCount,position:position(p)},p.id);
  w.setAction(p,'social_throw',.45);return {planeId:plane.id};
}
function mark(w,p,payload,kind='stamp') {
  const at=targetPoint(w,p,payload,R.markRange),state=w.s.social;
  const stamp=payload.stampId??'thanks';need(kind==='duck'||SOCIAL_STAMPS.some(x=>x.id===stamp));
  const mine=Object.values(state.marks).filter(x=>x.ownerId===p.id).sort((a,b)=>a.createdAt-b.createdAt);
  while(mine.length>=R.ownerMarkLimit)delete state.marks[mine.shift().id];
  const all=Object.values(state.marks).sort((a,b)=>a.createdAt-b.createdAt);
  while(all.length>=R.markLimit)delete state.marks[all.shift().id];
  const id=w.id('social-mark');state.marks[id]={id,kind,stampId:kind==='stamp'?stamp:null,ownerId:p.id,...at,createdAt:w.s.time,expiresAt:w.s.time+R.markLifetime};
  w.event('SocialPlayed',{kind,actorId:p.id,markId:id,position:at},p.id);return {markId:id};
}
function dispatch(w,p,message) {
  const payload=message.payload??{};need(object(payload));
  if(message.command==='SocialSettings'){
    need(p?.connected===true&&w.s.players[p.id]===p,'INVALID_TARGET');
    need(Object.keys(payload).length>0&&Object.keys(payload).every(k=>['participating','hat'].includes(k)));
    for(const v of Object.values(payload))need(typeof v==='boolean');
    const row=preferences(w,p);
    if(payload.hat===true)need(row.unlocked.includes('box_hat'),'SOCIAL_LOCKED');
    if(payload.participating!==undefined){row.participating=payload.participating;if(!row.participating){clearOffers(w,p.id);for(const [id,plane]of Object.entries(w.s.social.planes))if(plane.ownerId===p.id)delete w.s.social.planes[id];}}
    if(payload.hat!==undefined){row.hat=payload.hat;p.collection.hat=payload.hat;}
    w.event('SocialSettingsChanged',{actorId:p.id,participating:row.participating,hat:row.hat},p.id);return {participating:row.participating,hat:row.hat};
  }
  need(w.s.players[p?.id]===p,'INVALID_TARGET');
  const action=payload.action;
  if(action==='decline'){
    const offer=w.s.social.offers[payload.offerId];need(offer&&(offer.toId===p.id||offer.fromId===p.id),'SOCIAL_EXPIRED');
    delete w.s.social.offers[offer.id];return {offerId:offer.id};
  }
  available(w,p);
  if(action==='accept'){
    const o=w.s.social.offers[payload.offerId];need(o&&o.toId===p.id&&o.expiresAt>w.s.time,'SOCIAL_EXPIRED');
    const sender=w.s.players[o.fromId];available(w,sender);near(w,p,sender);
    if(o.kind==='coffee'){
      const item=coffee(w,sender,o.itemId);need(item.revision===o.itemRevision,'STALE_REVISION');
      need(w.canFit(w.bag(p),'coffee_flask',1),'NO_CAPACITY');
      need(w.moveItem(item,w.bag(p),1)===1,'NO_CAPACITY');
      w.event('SocialCompleted',{kind:'coffee',actorId:sender.id,targetId:p.id,quantity:1},p.id);
      w.setAction(sender,'social_give',.55);w.setAction(p,'social_receive',.55);
    }else if(o.kind==='pose'){
      w.setAction(sender,'social_highfive',.75);w.setAction(p,'social_highfive',.75);unlock(w,sender,'portrait_badge');unlock(w,p,'portrait_badge');w.event('SocialCompleted',{kind:'groupPose',actorId:sender.id,targetId:p.id,position:position(p)},p.id);
    }else if(o.kind==='highfive'){
      w.setAction(sender,'social_highfive',.75);w.setAction(p,'social_highfive',.75);
      w.event('SocialCompleted',{kind:'highfive',actorId:sender.id,targetId:p.id,position:position(p)},p.id);
    }
    else need(false,'INVALID_TARGET');
    delete w.s.social.offers[o.id];return {offerId:o.id,kind:o.kind};
  }
  if(action==='offerCoffee'){
    const q=w.s.players[message.targetId??payload.targetId];near(w,p,q);available(w,q);
    const item=coffee(w,p,payload.itemId??null);cooldown(w,p);
    return invitation(w,p,q,'coffee',{itemId:item.id,itemRevision:item.revision});
  }
  if(action==='highFive'){
    const q=w.s.players[message.targetId??payload.targetId];
    if(q){near(w,p,q);available(w,q);}cooldown(w,p,2);
    w.setAction(p,'social_highfive',.75);
    if(q)return invitation(w,p,q,'highfive');
    w.event('SocialPlayed',{kind:'highfive',actorId:p.id,solo:true,position:position(p)},p.id);return {solo:true};
  }
  if(['cupStack','noteChain'].includes(action))return activity(w,p,payload,action,{need,cooldown,unlock});
  if(action==='groupPose'){const q=w.s.players[message.targetId??payload.targetId];if(q){near(w,p,q);available(w,q);}cooldown(w,p,2);w.setAction(p,'social_highfive',.75);if(q)return invitation(w,p,q,'pose');unlock(w,p,'portrait_badge');w.event('SocialCompleted',{kind:'groupPose',actorId:p.id,solo:true,position:position(p)},p.id);return{solo:true};}
  if(action==='airplane'){const at=targetPoint(w,p,payload,R.planeRange);cooldown(w,p);return launch(w,p,{...payload,...at});}
  if(action==='relayPlane'){
    const plane=w.s.social.planes[payload.planeId];need(plane&&plane.landed&&plane.expiresAt>w.s.time,'SOCIAL_EXPIRED');
    need(distance(p,plane.to)<=R.range&&Math.abs(p.y-plane.to.y)<1.8,'OUT_OF_RANGE');
    targetPoint(w,p,payload,R.planeRange);cooldown(w,p);return launch(w,p,payload,plane);
  }
  if(action==='paperBall'){
    need(preferences(w,p).participating,'SOCIAL_DECLINED');
    const q=w.s.players[message.targetId??payload.targetId],row=preferences(w,p);
    if(q){near(w,p,q,R.paperBallRange);available(w,q);need(preferences(w,q).participating,'SOCIAL_DECLINED');need(w.s.time>=(row.targetCooldowns[q.id]??0),'SOCIAL_COOLDOWN');}
    const at=q?position({...q,y:q.y+.8}):targetPoint(w,p,payload,R.paperBallRange);
    cooldown(w,p);if(q)row.targetCooldowns[q.id]=w.s.time+R.repeatTargetSeconds;
    w.setAction(p,'social_throw',.45);const bin=w.s.social.targets.paperBin;
    const scored=!q&&distance(at,bin)<=1.3;
    w.event('SocialPlayed',{kind:'paperball',actorId:p.id,targetId:q?.id??null,from:position({...p,y:p.y+1}),position:at,scored},p.id);
    return {scored};
  }
  if(action==='stamp'){targetPoint(w,p,payload,R.markRange);need(SOCIAL_STAMPS.some(x=>x.id===(payload.stampId??'thanks')));cooldown(w,p);return mark(w,p,payload);}
  if(action==='souvenir'){
    preferences(w,p);return displaySouvenir(w,p,payload.souvenirId,{need,cooldown});
  }
  throw new SocialError('INVALID_TARGET');
}
function clean(w) {
  const s=w.s.social,unsafe=['NIGHT','COMPLETE'].includes(w.s.phase);
  for(const [id,o]of Object.entries(s.offers)){
    const p=w.s.players[o.fromId],q=w.s.players[o.toId];
    if(unsafe||o.expiresAt<=w.s.time||!active(w,p)||!active(w,q)||distance(p,q)>R.range||Math.abs(p.y-q.y)>1.8)delete s.offers[id];
    else if(o.kind==='coffee'){const i=w.s.items[o.itemId];if(!i||i.containerId!==p.backpackId||i.revision!==o.itemRevision||i.lockedBy||i.loanOwnerSlotId)delete s.offers[id];}
  }
  for(const [id,plane]of Object.entries(s.planes)){
    if(unsafe||plane.expiresAt<=w.s.time||!active(w,w.s.players[plane.ownerId])){delete s.planes[id];continue;}
    if(!plane.landed&&w.s.time>=plane.landsAt){
      plane.landed=true;
      if(distance(plane.to,s.targets.planeTarget)<=1.5){plane.scored=true;unlock(w,w.s.players[plane.ownerId],'rubber_duck');w.event('SocialScored',{kind:'airplane',actorId:plane.ownerId,planeId:id,position:clone(plane.to)},plane.ownerId);}
    }
  }
  for(const [id,m]of Object.entries(s.marks))if(unsafe||m.expiresAt<=w.s.time||!active(w,w.s.players[m.ownerId]))delete s.marks[id];
  for(const [id,q]of Object.entries(s.activities))if(unsafe||q.expiresAt<=w.s.time)delete s.activities[id];
  for(const [id,row]of Object.entries(s.playerStates)){
    if(!w.s.players[id]){delete s.playerStates[id];continue;}
    for(const [targetId,until]of Object.entries(row.targetCooldowns))if(until<=w.s.time||!w.s.players[targetId])delete row.targetCooldowns[targetId];
  }
}
function publicSocial(w) {
  clean(w);const s=w.s.social;
  return {paused:['NIGHT','COMPLETE'].includes(w.s.phase),offers:Object.values(s.offers).map(o=>{const {itemRevision,...value}=o;return clone(value);}),
    planes:clone(Object.values(s.planes)),marks:clone(Object.values(s.marks)),activities:clone(Object.values(s.activities)),displays:clone(s.displays),targets:clone(s.targets),
    playerStates:w.scenePlayers().map(p=>{const row=preferences(w,p);return {playerId:p.id,participating:row.participating,hat:row.hat,unlocked:[...row.unlocked]};})};
}

// Only these wrappers are installed. No platform account, persistence adapter,
// network endpoint or economic item definition is changed by this module.
export function attachSocial(w) {
  if(w[ATTACHED])return w[ATTACHED];
  const old=object(w.s.social)?w.s.social:{},rows={};
  for(const [id,row]of Object.entries(old.playerStates??{}))if(w.s.players[id]&&object(row))rows[id]={
    participating:row.participating===true,hat:row.hat===true&&row.unlocked?.includes('box_hat'),
    unlocked:Array.isArray(row.unlocked)?[...new Set(row.unlocked.filter(x=>['box_hat','rubber_duck'].includes(x)))]:[],nextAt:0,targetCooldowns:{}};
  for(const p of Object.values(w.s.players)){p.collection=mergeCollection(p.collection,rows[p.id]?{schema:1,unlocked:rows[p.id].unlocked,hat:rows[p.id].hat}:p.collection);}
  const spawn=w.staticWorld().spawn;
  const at=(dx,dz)=>{const x=spawn.x+dx,z=spawn.z+dz;return {x,y:w.ground(x,z)+.05,z};};
  w.s.social={schema:1,playerStates:rows,offers:{},planes:{},marks:{},activities:{},displays:validateDisplays(w.s.worldId,old.displays??[]),targets:{planeTarget:at(-4,4),paperBin:at(4,3)}};
  const original={command:w.command.bind(w),step:w.step.bind(w),publicState:w.publicState.bind(w),catalog:w.catalog.bind(w),event:w.event.bind(w),disconnect:w.disconnect.bind(w)};
  w.command=(p,message)=>{
    if(!['Social','SocialSettings'].includes(message?.command))return original.command(p,message);
    const requestId=message.requestId;
    if(!Number.isSafeInteger(requestId)||requestId<1)return {type:'result',requestId:0,ok:false,code:'INVALID_TARGET',message:'请求序号无效'};
    const cached=p.requestCache.find(r=>r.requestId===requestId);if(cached)return cached;
    if(requestId<=p.requestHighWater)return {type:'result',requestId,ok:false,code:'REQUEST_EXPIRED',message:'旧请求已处理，不会重复执行'};
    let result;
    try{const data=dispatch(w,p,message);result={type:'result',requestId,ok:true,message:'已完成',...(data?{data}:{})};}
    catch(error){if(!(error instanceof SocialError))throw error;result={type:'result',requestId,ok:false,code:error.code,message:error.message};}
    p.requestHighWater=requestId;p.requestCache.push(result);if(p.requestCache.length>256)p.requestCache.shift();w.requestSave=true;return result;
  };
  w.step=dt=>{original.step(dt);clean(w);};
  w.publicState=save=>({...original.publicState(save),social:publicSocial(w)});
  w.catalog=()=>({...original.catalog(),social:socialCatalog()});
  w.disconnect=p=>{original.disconnect(p);clean(w);};
  w.event=(kind,payload={},entityId=null)=>{
    original.event(kind,payload,entityId);
    if(kind==='Destroyed'&&payload.actorId)unlock(w,w.s.players[payload.actorId],'box_hat');
    if(kind==='ExplorationCompleted'&&payload.position)for(const p of w.scenePlayers())if(active(w,p)&&distance(p,payload.position)<=6)unlock(w,p,'rubber_duck');
    if(kind==='ExpeditionReturned'&&payload.actorId&&payload.items?.length)unlock(w,w.s.players[payload.actorId],'field_postcard');
    if(kind==='FishingChanged'&&payload.state==='LANDED'&&payload.catch_kind==='salvage')unlock(w,w.s.players[payload.actorId],'salvage_bottle');
    if(kind==='PhaseChanged'&&payload.phase==='PREP'&&w.mode!=='mission'&&w.s.night.outcome==='won'&&w.s.night.resolved&&w.s.resultLedger.includes(w.s.night.id)&&w.s.buildings.core.hp>0)for(const p of w.scenePlayers())unlock(w,p,'night_lantern');
    if(kind==='PhaseChanged'||kind==='LifeChanged')clean(w);
  };
  const api={publicState:()=>publicSocial(w),cleanup:()=>clean(w)};w[ATTACHED]=api;return api;
}
