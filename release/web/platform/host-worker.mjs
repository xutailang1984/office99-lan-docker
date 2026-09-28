import {HostSession} from './sim/host-session.mjs';
import {createGmGrantController} from './gm-worker.mjs';
import {BrowserCheckpointStore} from './checkpoint-store.mjs';
import {LocalHostSave} from './local-host-save.mjs';

let session,storage,initialized=false,heartbeatAt=0,heartbeatPending=false;
const gmGrants=createGmGrantController({getRuntime:()=>session?.runtime});
const emit=value=>postMessage(value);
function heartbeat(now){
 if(heartbeatPending||now-heartbeatAt<3000||!session?.runtime.room)return;
 heartbeatAt=now;heartbeatPending=true;const room=session.runtime.room;
 fetch('/api/platform/rooms/'+room.id+'/heartbeat',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({epoch:room.epoch}),signal:AbortSignal.timeout(5000)}).catch(()=>{}).finally(()=>heartbeatPending=false);
}
async function writeSnapshot(body){
 const response=await fetch('/api/platform/adventures/'+session.runtime.room.adventureId+'/snapshot',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
 const value=await response.json();if(!response.ok)throw Error(value.error?.message||'服务器备份未完成');return value;
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
    let sequence=0;
    storage={remoteRevision:0,save:async()=>({revision:++sequence}),backup:async()=>{},stop:()=>{}};
    restored={state:null,notice:null};
   }else{
    const writer=Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16)).join('-');
    storage=new LocalHostSave({store:new BrowserCheckpointStore(),room:m.room,remote:{revision:m.revision??0,state:m.state,head:m.head},writer,writeRemote:writeSnapshot,
     onStatus:status=>emit({type:'save_status',...status}),
     onResets:ack=>{if(Array.isArray(ack.memberResets)&&Number.isSafeInteger(ack.memberResetVersion))session.runtime.applyMemberResets(ack.memberResets,ack.memberResetVersion);}});
    restored=await storage.initialize();
   }
   session=new HostSession({config:m.config,state:restored.state,room:m.room,memberResets:m.memberResets??[],memberResetVersion:m.memberResetVersion??0,
    send:(peerId,json)=>emit({type:'packet',peerId,json}),
    save:async(state,options)=>{try{return await storage.save(state,options);}catch(error){emit({type:'save_failed',message:error.message});throw error;}},
    onPulse:now=>{heartbeat(now);void storage.backup().catch(()=>{});emit({type:'pulse'});},
    onError:()=>emit({type:'fatal',message:'房间模拟发生异常，已暂停。最近确认的本机进度已保留。'})});
   session.start();emit({type:'ready',notice:restored.notice});
  }else if(m.type==='close'){
   gmGrants.cancel();
   try{
    await session.close({requireBackup:m.localOnly!==true});
    storage.stop();emit({type:'closed',revision:storage.remoteRevision,localOnly:m.localOnly===true});
   }catch(error){emit({type:'close_failed',message:error.message||'进度尚未备份，请重试保存'});}
  }else if(m.type==='gm_grant'){if(session?.runtime.room.mode!=='mission')void gmGrants.receive(m);}
  else{
   if(m.type==='room'&&(!m.room||m.room.id!==session?.runtime.room.id||m.room.epoch!==session?.runtime.room.epoch||m.room.hostPeerId!==session?.runtime.room.hostPeerId))gmGrants.cancel();
   session?.handle(m);
  }
 }catch(error){emit({type:'fatal',message:initialized&&!session?error.message:'房间操作未能完成，请回大厅重试。'});}
};
