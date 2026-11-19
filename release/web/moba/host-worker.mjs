import {MobaWorld} from './sim/world.mjs';
import {RULES} from './sim/catalog.mjs';
import {stringifySnapshots} from './sim/wire.mjs';
let world,roster=[],epoch=0,revision=0,pending=null,pendingAt=0,finishedSaved=false,running=false,timer=null,last=0,carry=0,nextFrameAt=0,lastFrameEvent=0,lastCheckpoint=0,lastPulse=0;
const emit=m=>postMessage(m);
// Keep only one snapshot batch in transit to the UI thread. Loading the renderer
// may block that thread; queued historical frames must not burst onto the network.
let frameSerial=0,framePending=0;
const snapshotInterval=1000/Math.max(20,RULES.snapshotHz);
const immediateEvents=new Set(['cast','attack','projectile_spawn','hit','ability','dash','slam','death','victory']);
function fatal(e){running=false;clearInterval(timer);timer=null;emit({type:'fatal',message:'对局出现异常，已暂停。请返回大厅重试。',detail:String(e.message).slice(0,160)});}
function members(rows){roster=rows;for(const h of world.heroes){const s=rows.find(s=>s.id===h.id),connected=!!s?.connected,bot=!!s?.bot;if(h.connected!==connected||h.bot!==bot)world.resetInput(h);h.connected=connected;h.bot=bot;}}
function checkpoint(){
 const now=performance.now();
 if(finishedSaved)return;
 if(pending){if(now-pendingAt>=3000){pendingAt=now;emit(pending);}return;}
 pending={type:'checkpoint',epoch,revision:revision+1,state:world.serialize()};emit(pending);pendingAt=lastCheckpoint=now;
}
function frame(immediate=false){
 if(framePending)return;
 const packets=stringifySnapshots(world.snapshots(roster.filter(s=>s.connected&&s.peerId)));
 if(packets.length){framePending=++frameSerial;for(let i=0;i<packets.length;i++){const{seat,data}=packets[i];emit({type:'packet',peerId:seat.peerId,data,...(i===packets.length-1?{frameId:framePending}:{})});}}
 lastFrameEvent=world.eventSeq;if(immediate)nextFrameAt=Math.max(nextFrameAt,performance.now()+snapshotInterval);
}
self.onmessage=({data:m})=>{
 try{
  if(m.type==='init'){
   clearInterval(timer);framePending=0;world=new MobaWorld({roster:m.roster,state:m.state});epoch=m.epoch;revision=m.revision;pending=null;finishedSaved=false;running=false;members(m.roster);
   if(m.state){for(const h of world.heroes)if(!h.bot)world.resetInput(h);}
   last=performance.now();carry=0;nextFrameAt=last+snapshotInterval;lastFrameEvent=0;lastCheckpoint=0;lastPulse=0;
   timer=setInterval(()=>{
    try{
    const now=performance.now(),dt=Math.min(.5,(now-last)/1000);last=now;if(running){carry+=dt;let steps=0;while(carry>=1/RULES.hz&&steps++<15){world.step(1/RULES.hz);carry-=1/RULES.hz;}}
    if(now>=nextFrameAt){nextFrameAt+=(Math.floor((now-nextFrameAt)/snapshotInterval)+1)*snapshotInterval;frame();}
    else if(world.events.some(e=>e.id>lastFrameEvent&&immediateEvents.has(e.kind)))frame(true);
    if(now-lastPulse>=2000){lastPulse=now;emit({type:'pulse',epoch});}
    if(now-lastCheckpoint>=RULES.checkpointSeconds*1000||world.phase==='finished'&&pending?.state.phase!=='finished')checkpoint();
    }catch(e){fatal(e);}
   },16);
   checkpoint();emit({type:'host_ready',epoch});frame(true);
  }else if(m.type==='frame_ack'&&m.epoch===epoch&&m.frameId===framePending){framePending=0;}
  else if(m.type==='resume'&&m.epoch===epoch){running=world.phase==='running';}
  else if(m.type==='membership'&&m.epoch===epoch){members(m.roster);frame(true);}
  else if(m.type==='checkpoint_ack'&&m.epoch===epoch&&pending?.revision===m.revision){revision=m.revision;finishedSaved=pending.state.phase==='finished';pending=null;if(finishedSaved)running=false;}
  else if(m.type==='command'&&m.epoch===epoch){
   const seat=roster.find(s=>s.peerId===m.peerId&&s.connected);if(!seat||!running)return;
   if(!m.command||typeof m.command!=='object'||Array.isArray(m.command)||!Number.isSafeInteger(m.command.seq)){emit({type:'packet',peerId:m.peerId,data:JSON.stringify({type:'result',ok:false,code:'INVALID_INPUT'})});return;}
   const result=world.command(seat.id,m.command);emit({type:'packet',peerId:m.peerId,data:JSON.stringify({type:'result',seq:m.command.seq,...result})});
   if(result.ok&&['cast','stop'].includes(m.command.type))frame(true);
  }else if(m.type==='stop'){running=false;clearInterval(timer);close();}
 }catch(e){fatal(e);}
};
