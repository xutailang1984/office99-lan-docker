import {SurvivalWorld} from './world.mjs';
import {compileState,diffState,fullEnvelope,deltaEnvelope} from './state-wire.mjs';
import {GmGrantError,normalizeGmGrant,sameGmGrant,gmLedger,findGmReceipt,grantGmResources} from './gm-resources.mjs';
import {applyMemberResetsToState} from './member-progress.mjs';

function initialSaveOffset(room,interval) {
  let hash=2166136261;
  for(const character of `${room?.id??''}:${room?.epoch??0}`)hash=Math.imul(hash^character.charCodeAt(0),16777619)>>>0;
  return (hash%1000)/1000*Math.min(.5,interval/4);
}

// No sockets, DOM, filesystem or platform credentials. The room owner's Worker
// is authoritative; its adapter supplies already-authenticated peer membership.
export class RoomRuntime {
  constructor({config,state=null,room,send,save,memberResets=[],memberResetVersion=0,now=()=>performance.now()}) {
    this.world=new SurvivalWorld(config,state,{onlineRoster:true,mode:room.mode,missionStart:room.missionStart});this.config=config;
    gmLedger(this.world.s);this.gmQueue=Promise.resolve();this.gmPending=new Map();
    this.send=send;this.persist=save;this.now=now;this.sessions=new Map();this.members=new Map();
    this.saveStatus={sequence:0,pending:false,error:null};this.saveInterval=Math.min(2,config.session.save_interval_seconds);
    this.saveTimer=initialSaveOffset(room,this.saveInterval);this.snapshotTimer=0;this.persistedFingerprint=null;
    this.saving=null;this.saveFault=false;this.stopping=false;this.barrier=false;
    this.memberResetEntries=new Map();this.lastMemberResetVersion=-1;this.setRoom(room);this.applyMemberResets(memberResets,memberResetVersion);
  }
  // Only the central adapter calls this; ordinary peer packets have no route.
  applyMemberResets(entries,version=0) {
    if(!Number.isSafeInteger(version)||version<0)throw Error('Invalid member reset version');
    if(version<=this.lastMemberResetVersion)return {removedPlayerIds:[],changed:false,ignored:true};
    const result=applyMemberResetsToState(this.world.s,entries);
    this.lastMemberResetVersion=version;
    for(const entry of entries)if(entry.generation>=(this.world.s.memberResetEpochs?.[entry.accountId]??0))this.memberResetEntries.set(entry.accountId,{...entry});
    const removed=new Set(result.removedPlayerIds);
    for(const [peerId,session]of this.sessions)if(removed.has(session.playerId))this.sessions.delete(peerId);
    this.world.damageQueue=this.world.damageQueue.filter(hit=>!removed.has(hit.actorId)&&!removed.has(hit.target));
    this.world.events=this.world.events.filter(event=>!removed.has(event.entityId)&&!removed.has(event.payload?.id)&&!removed.has(event.payload?.actorId)&&!removed.has(event.payload?.targetId)&&!removed.has(event.payload?.rescuerId));
    if(result.changed)this.world.requestSave=true;
    this.applyOwner();this.world.assertInvariants();return result;
  }
  setRoom(room) {
    if(!room){this.running=false;this.stopping=true;this.world.s.paused=true;return;}
    this.room=room;this.running=room.status==='running';this.members=new Map(room.members.map(m=>[m.peerId,m]));
    for(const id of this.sessions.keys())if(!this.members.has(id))this.disconnect(id);
    for(const [id,s] of this.sessions){const p=this.world.s.players[s.playerId];if(p&&this.members.has(id)&&!this.running)p.ready=this.members.get(id).ready;}
    this.applyOwner();
  }
  applyOwner() {
    const owner=[...this.sessions].find(([id])=>this.members.get(id)?.accountId===this.room.ownerId);
    this.world.s.hostId=owner?.[1].playerId??null;
    this.world.s.paused=!this.running||!owner||!owner[1].readyForPlay||this.saveFault||this.stopping;
  }
  output(peerId,value) {this.send(peerId,typeof value==='string'?value:JSON.stringify(value));}
  disconnect(peerId) {
    const s=this.sessions.get(peerId);this.sessions.delete(peerId);
    if(s){const p=this.world.s.players[s.playerId];if(p)this.world.disconnect(p);}
    this.applyOwner();
  }
  // Only the adapter's centrally verified ticket path may call this method.
  // receive() deliberately has no GM packet or ordinary command routing.
  checkGmGrantContext(grant) {
    const room=this.room;
    if(!room||room.id!==grant.roomId||room.epoch!==grant.epoch||room.hostPeerId!==grant.hostPeerId)
      throw new GmGrantError('GM_STALE_ROOM','房间已改变，请重新申请');
    const member=this.members.get(grant.peerId),session=this.sessions.get(grant.peerId);
    const player=session&&this.world.s.players[session.playerId];
    if(!member||member.accountId!==grant.accountId||!session||session.accountId!==grant.accountId||!player?.connected)
      throw new GmGrantError('GM_NOT_MEMBER','请先进入当前房间');
    const owner=this.members.get(room.hostPeerId),ownerSession=this.sessions.get(room.hostPeerId);
    if(this.stopping||!this.running||room.status!=='running'||!session.readyForPlay
      ||owner?.accountId!==room.ownerId||ownerSession?.accountId!==room.ownerId||!ownerSession?.readyForPlay
      ||!this.world.s.players[ownerSession.playerId]?.connected)
      throw new GmGrantError('GM_NOT_READY','房间尚未开始或正在退出');
    return player;
  }
  async applyGmGrant(value) {
    const grant=normalizeGmGrant(value),pending=this.gmPending.get(grant.id);
    this.checkGmGrantContext(grant);
    if(pending){
      if(!sameGmGrant(pending.grant,grant))throw new GmGrantError('GM_REPLAY_MISMATCH','同一票据不能修改内容');
      return structuredClone(await pending.promise);
    }
    const promise=this.gmQueue.then(async()=>{
      const player=this.checkGmGrantContext(grant);
      // A failed save leaves the applied receipt in memory. Its exact retry may
      // save again while faulted; a new ticket must never apply in that state.
      let receipt=findGmReceipt(this.world.s,grant);
      if(!receipt){
        if(this.saveFault||this.barrier||this.world.needsBarrier||this.world.s.paused||this.saving)
          throw new GmGrantError('GM_BUSY','正在保存进度，请稍后重试');
        receipt=grantGmResources(this.world,grant);
        this.world.event('TransactionResult',{kind:'GMGrant',actorId:player.id,...grant.resources});this.events();
      }
      try{const saved=await this.save({requireBackup:true});return {ok:true,receipt:structuredClone(receipt),revision:saved.sequence};}
      catch{throw new GmGrantError('GM_SAVE_FAILED','资源已发放但保存失败，请重试同一票据');}
    });
    this.gmQueue=promise.catch(()=>{});this.gmPending.set(grant.id,{grant,promise});
    const clear=()=>{if(this.gmPending.get(grant.id)?.promise===promise)this.gmPending.delete(grant.id);};
    promise.then(clear,clear);
    return structuredClone(await promise);
  }
  receive(peerId,message) {
    if(this.stopping||!this.members.has(peerId)||!message||typeof message!=='object'||Array.isArray(message))return;
    let session=this.sessions.get(peerId);
    if(!session){
      if(message.type!=='hello')return;
      const member=this.members.get(peerId),key='account:'+member.accountId;
      if(this.memberResetEntries.get(member.accountId)?.active===false){this.output(peerId,{type:'error',code:'JOIN_UNAVAILABLE',message:'个人进度已删除，请重新加入房间'});return;}
      let p=Object.values(this.world.s.players).find(x=>x.tokenHash===key);
      for(const [other,s] of this.sessions)if(s.accountId===member.accountId)this.disconnect(other);
      if(Object.values(this.world.s.players).filter(p=>p.connected).length>=this.config.baseline.max_players){this.output(peerId,{type:'error',code:'ROOM_FULL',message:'当前在线人数已满'});return;}
      try{if(p)this.world.connect(p,member.name);else p=this.world.allocate(member.name,key);}
      catch{this.output(peerId,{type:'error',code:'JOIN_UNAVAILABLE',message:'暂时无法进入园区，请稍后重新加入'});return;}
      if(!this.running)p.ready=member.ready;
      session={playerId:p.id,accountId:member.accountId,readyForPlay:message.clientReady!==true,ackFrame:null,ackId:null,pendingFrame:null,pendingId:null,sequence:0,windowAt:this.now(),count:0};
      this.sessions.set(peerId,session);this.applyOwner();
      this.output(peerId,{type:'welcome',selfId:p.id,slotId:p.slotId,spectator:false,protocolVersion:3,build:'0.11.7',stateDelta:1,maxPlayers:this.config.baseline.max_players,catalog:this.world.catalog(),world:this.world.staticWorld()});
      this.snapshot(peerId,session);this.events();return;
    }
    if(message.type==='snapshot_ack'){
      if(session.pendingId!==null&&Number.isSafeInteger(message.snapshotId)&&message.snapshotId===session.pendingId){session.ackFrame=session.pendingFrame;session.ackId=session.pendingId;session.pendingFrame=null;session.pendingId=null;}return;
    }
    if(message.type==='client_ready'){session.readyForPlay=true;this.applyOwner();return;}
    const now=this.now();
    if(message.type==='state_resync'){if(now-(session.resyncAt??-1000)<500)return;session.resyncAt=now;session.ackFrame=null;session.ackId=null;session.pendingId=null;this.snapshot(peerId,session);return;}
    if(now-session.windowAt>1000){session.windowAt=now;session.count=0;}if(++session.count>120)return;
    const p=this.world.s.players[session.playerId];if(!p)return;
    if(message.type==='input'){if(this.running&&!this.world.s.paused&&session.readyForPlay&&!this.saveFault)this.world.input(p,message);return;}
    if(message.type!=='command')return;
    if((!this.running||this.world.s.paused||!session.readyForPlay||this.world.needsBarrier||this.saveFault||this.barrier)&&!['Save','Ready','Settings'].includes(message.command)){
      this.output(peerId,{type:'result',requestId:message.requestId,ok:false,code:'BUSY',message:this.saveFault?'保存失败，已暂停。请重试保存。':'房间尚未开始或正在保存阶段进度'});return;
    }
    if(message.command==='NewAdventure'){this.output(peerId,{type:'result',requestId:message.requestId,ok:false,code:'HOST_ONLY',message:'请保存退出，回大厅新建另一份冒险'});return;}
    try {
      this.output(peerId,this.world.command(p,message));this.events();
      if(message.command==='Save')void this.save().then(()=>this.output(peerId,{type:'event',eventType:'SaveResult',payload:{ok:true}})).catch(()=>{});
    }catch{this.output(peerId,{type:'error',code:'INVALID_TARGET',message:'操作无法完成，请重试'});}
  }
  state() {const s=this.world.publicState(this.saveStatus);s.build='0.11.7';s.room={id:this.room.id,title:this.room.title,status:this.room.status};return s;}
  snapshot(peerId,session,frame=null) {
    if(session.pendingId!==null)return;
    frame??=compileState(this.state());const delta=session.ackFrame&&session.ackFrame.worldId===frame.worldId?diffState(session.ackFrame,frame):null;
    const id=++session.sequence;session.pendingId=id;session.pendingFrame=frame;
    this.output(peerId,delta&&delta.body.length<frame.fullBody.length*.85?deltaEnvelope(delta.body,id,session.ackId):fullEnvelope(frame,id));
  }
  events() {for(const event of this.world.drainEvents())for(const id of this.sessions.keys())this.output(id,event);}
  step(dt) {
    if(this.stopping)return;this.applyOwner();
    if(!this.saveFault)this.world.step(dt);
    this.events();this.saveTimer+=dt;this.snapshotTimer+=dt;
    if(this.world.needsBarrier&&!this.barrier){this.barrier=true;void this.save().then(()=>{if(!this.stopping&&this.world.needsBarrier)this.world.finishDayBarrier();}).catch(()=>{}).finally(()=>this.barrier=false);}
    if(this.room.mode!=='mission'&&this.saveTimer+1e-9>=this.saveInterval&&!this.saving&&!this.barrier){this.saveTimer=0;void this.save({automatic:true}).catch(()=>{});}
    if(this.snapshotTimer>=1/this.config.session.snapshot_hz){this.snapshotTimer=0;const frame=compileState(this.state());for(const [id,s]of this.sessions)this.snapshot(id,s,frame);}
  }
  async save({automatic=false,requireBackup=false}={}) {
    if(this.saving){await this.saving;return this.save({automatic,requireBackup});}
    this.world.resolveDamage();this.world.resolveNight();const data=this.world.serialize(),fingerprint=JSON.stringify(data);
    // Compare the complete durable snapshot, never just clock/request flags.
    // Manual, GM, barrier and final saves always reach the storage adapter.
    if(automatic&&!this.saveFault&&fingerprint===this.persistedFingerprint)return this.saveStatus;
    this.saveTimer=0;this.saveStatus.pending=true;
    this.saving=(async()=>{try{const result=await this.persist(data,{automatic,requireBackup});this.persistedFingerprint=fingerprint;this.saveFault=false;this.saveStatus={sequence:result.revision,lastSavedAt:new Date().toISOString(),pending:false,error:null};this.world.requestSave=false;return this.saveStatus;}
      catch(error){this.saveFault=true;this.saveStatus.pending=false;this.saveStatus.error='保存失败，世界已暂停';this.applyOwner();for(const id of this.sessions.keys())this.output(id,{type:'error',code:'SAVE_FAILED',message:'保存失败，世界已暂停。请在队伍菜单重试保存。'});throw error;}
      finally{this.saving=null;}})();return this.saving;
  }
  async freezeAndSave({requireBackup=true}={}) {this.stopping=true;this.world.s.paused=true;if(this.saving)await this.saving.catch(()=>{});return this.save({requireBackup});}
}
