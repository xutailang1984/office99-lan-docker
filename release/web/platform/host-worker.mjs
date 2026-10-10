import {HostSession} from './sim/host-session.mjs';
import {createGmGrantController} from './gm-worker.mjs';
import {BrowserCheckpointStore} from './checkpoint-store.mjs';
import {LocalHostSave} from './local-host-save.mjs';

let session,storage,initialized=false,heartbeatAt=0,heartbeatPending=false,careerJob=Promise.resolve();
const gmGrants=createGmGrantController({getRuntime:()=>session?.runtime});
const emit=value=>postMessage(value);
const deferredMembership=new Map();
function deliver(message){
 if(session?.runtime.handoff&&message.type!=='packet'){deferredMembership.set(message.type+':'+(message.peerId??''),message);return;}
 session?.handle(message);
}
function resumeAfterHandoff(){
 const runtime=session.runtime;runtime.handoff=false;
 for(const message of deferredMembership.values())session.handle(message);
 deferredMembership.clear();runtime.setCareers([]);runtime.applyOwner();
}
function revoked(code){
 if(['HOST_REQUIRED','STALE_HOST','LEASE_EXPIRED','NOT_FOUND','SIGNAL_REQUIRED'].includes(code)){
  session?.stop();storage?.stop();emit({type:'host_revoked',message:'主机已交接，正在同步队伍'});return true;
 }return false;
}
function heartbeat(now){
 if(heartbeatPending||now-heartbeatAt<3000||!session?.runtime.room)return;
 heartbeatAt=now;heartbeatPending=true;const room=session.runtime.room;
 fetch('/api/platform/rooms/'+room.id+'/heartbeat',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({epoch:room.epoch}),signal:AbortSignal.timeout(5000)}).then(async r=>{if(!r.ok){const v=await r.json();revoked(v.error?.code);}}).catch(()=>{}).finally(()=>heartbeatPending=false);
}
async function writeSnapshot(body){
 const response=await fetch('/api/platform/adventures/'+session.runtime.room.adventureId+'/snapshot',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
 const value=await response.json();if(!response.ok){revoked(value.error?.code);throw Error(value.error?.message||'服务器备份未完成');}return value;
}
async function careerRequest(suffix,body){
 const response=await fetch('/api/platform/rooms/'+session.runtime.room.id+'/'+suffix,{credentials:'same-origin',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
 const value=await response.json();if(!response.ok)throw Error(value.error?.message||'个人物资尚未保存，请重试');return value;
}
async function settleCareers(accountIds){
 const runtime=session.runtime;if(runtime.economyVersion!==1)return {settled:[]};
 runtime.handoff=true;runtime.applyOwner();
 try{
  const settled=new Set();let ack;
  const commit=async settlements=>{
   const result=await storage.handoff(runtime.world.serialize(),settlements,body=>careerRequest('settle',body));
   runtime.finishHandoff(result.settled,result.economyEpoch);
   await storage.acceptHandoff(runtime.world.serialize(),result);
   for(const accountId of result.settled)settled.add(accountId);ack=result;
  };
  // Recover the previous caller's unknown ACK first, then also settle this
  // caller. A teammate's retry must never stand in for the current exit.
  const pending=await storage.pendingHandoff();if(pending)await commit(pending.settlements);
  await runtime.save({requireBackup:true});
  const settlements=runtime.settleCandidates(accountIds);
  if(settlements.length)await commit(settlements);
  resumeAfterHandoff();return {...ack,settled:[...settled]};
 }catch(error){runtime.handoff=true;runtime.applyOwner();throw error;}
}
self.onmessage=async({data:m})=>{
 try{
  if(m.type==='init'){
   if(initialized)throw Error('房间已经初始化，请回大厅重开');initialized=true;
   let restored;
   if(m.room.mode==='mission'){
    // Mission rooms are disposable practice. The simulation still receives
    // successful save acknowledgements for phase barriers, but writes no
    // account checkpoint, adventure snapshot, or production inventory.
    let sequence=m.revision??0,last=0,pending=null,latest=null,stopped=false,saveSeq=0,envelope=null;
    const backup=async(force=false)=>{
     if(pending)await pending;if(!latest||stopped||!force&&Date.now()-last<10000)return;
     do {const state=latest;last=Date.now();envelope??={epoch:session.runtime.room.epoch,baseRevision:storage.remoteRevision,saveSeq:++saveSeq,state};
     pending=(async()=>{const response=await fetch('/api/platform/rooms/'+session.runtime.room.id+'/checkpoint',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(envelope),signal:AbortSignal.timeout(8000)});const value=await response.json();if(!response.ok){revoked(value.error?.code);throw Error(value.error?.message||'试用进度同步失败');}storage.remoteRevision=value.revision;if(latest===envelope.state)latest=null;envelope=null;})();
     try{await pending;}finally{pending=null;}
     }while(force&&latest&&!stopped);
    };
    storage={remoteRevision:m.revision??0,save:async(state,options={})=>{latest=structuredClone(state);if(options.requireBackup)await backup(true);else void backup().catch(()=>{});return {revision:++sequence};},backup:()=>backup(false),stop:()=>{stopped=true;}};
    restored={state:m.state??null,notice:null};
   }else{
    const writer=Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16)).join('-');
    storage=new LocalHostSave({store:new BrowserCheckpointStore(),room:m.room,remote:{revision:m.revision??0,state:m.state,head:m.head},writer,storageAccountId:m.storageAccountId,authoritative:(m.room.hostGeneration??0)>0,writeRemote:writeSnapshot,
     onStatus:status=>emit({type:'save_status',...status}),
     onResets:ack=>{if(Array.isArray(ack.memberResets)&&Number.isSafeInteger(ack.memberResetVersion))session.runtime.applyMemberResets(ack.memberResets,ack.memberResetVersion);}});
    restored=await storage.initialize();
   }
   session=new HostSession({config:m.config,state:restored.state,room:m.room,economyVersion:m.economyVersion??0,economyEpoch:m.economyEpoch??0,careerBindings:m.careerBindings??[],memberResets:m.memberResets??[],memberResetVersion:m.memberResetVersion??0,
    send:(peerId,json)=>emit({type:'packet',peerId,json}),
    save:async(state,options)=>{try{return await storage.save(state,options);}catch(error){emit({type:'save_failed',message:error.message});throw error;}},
    onPulse:now=>{heartbeat(now);void storage.backup().catch(()=>{});emit({type:'pulse'});},
    onError:()=>emit({type:'fatal',message:'房间模拟发生异常，已暂停。最近确认的本机进度已保留。'})});
   if(m.room.status!=='migrating')session.start();emit({type:'ready',notice:restored.notice});
  }else if(m.type==='prepare_transfer'){
   gmGrants.cancel();
   careerJob=careerJob.catch(()=>{}).then(async()=>{
    if(session.closed){emit({type:'closed',revision:storage.remoteRevision});return;}
    try{
     const host=session.runtime.members.get(session.runtime.room.hostPeerId);
     if(host)await settleCareers([host.accountId]);
     await session.close({requireBackup:true});storage.stop();emit({type:'closed',revision:storage.remoteRevision});
    }catch(error){emit({type:'close_failed',message:error.message||'交接尚未保存，请重试'});}
   });await careerJob;
  }else if(m.type==='close'){
   gmGrants.cancel();
   if(session?.closed){emit({type:'closed',revision:storage.remoteRevision,localOnly:m.localOnly===true});return;}
   try{
    const closing=careerJob.catch(()=>{}).then(async()=>{
     if(session.closed){emit({type:'closed',revision:storage.remoteRevision,localOnly:m.localOnly===true});return;}
     if(m.localOnly!==true)await settleCareers([...session.runtime.members.values()].map(member=>member.accountId));
     await session.close({requireBackup:m.localOnly!==true});
     storage.stop();emit({type:'closed',revision:storage.remoteRevision,localOnly:m.localOnly===true});
    });
    careerJob=closing;await closing;
   }catch(error){emit({type:'close_failed',message:error.message||'进度尚未备份，请重试保存'});}
  }else if(m.type==='settle_peer'){
   const member=session?.runtime.members.get(m.peerId);if(!member)return;
   careerJob=careerJob.catch(()=>{}).then(async()=>{
    try{const result=await settleCareers([member.accountId]);emit({type:'career_exit_result',peerId:m.peerId,requestId:m.requestId,ok:true,settled:result.settled.includes(member.accountId)});}
    catch(error){emit({type:'career_exit_result',peerId:m.peerId,requestId:m.requestId,ok:false,message:error.message});}
   });
  }else if(m.type==='gm_grant'){if(session?.runtime.room.mode!=='mission')void gmGrants.receive(m);}
  else{
   if(m.type==='room'&&(!m.room||m.room.id!==session?.runtime.room.id||m.room.epoch!==session?.runtime.room.epoch||m.room.hostPeerId!==session?.runtime.room.hostPeerId))gmGrants.cancel();
   deliver(m);if(m.type==='room'&&m.room?.status==='running'&&!session.started&&!session.runtime.stopping)session.start();
   if(m.type==='room'&&m.room&&session?.runtime.economyVersion===1){const value=await careerRequest('careers');deliver({type:'careers',economyEpoch:value.economyEpoch,careerBindings:value.careerBindings??value.bindings??[]});}
  }
 }catch(error){emit({type:'fatal',message:initialized&&!session?error.message:'房间操作未能完成，请回大厅重试。'});}
};
