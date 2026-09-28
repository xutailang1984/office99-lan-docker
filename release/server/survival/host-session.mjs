import {RoomRuntime} from './room-runtime.mjs';

// Platform boundary: trusted membership, transport, durable storage and clock
// are supplied by an adapter. No browser, account API or filesystem dependency.
export class HostSession {
  constructor({now=()=>performance.now(),schedule=(callback,ms)=>setInterval(callback,ms),cancel=timer=>clearInterval(timer),onPulse=()=>{},onError=()=>{},...options}) {
    this.now=now;this.schedule=schedule;this.cancel=cancel;this.onPulse=onPulse;this.onError=onError;
    this.runtime=new RoomRuntime({...options,now});this.dt=1/options.config.session.server_hz;
    this.started=false;this.closed=false;this.timer=null;this.closing=null;this.failed=false;
  }
  start() {
    if(this.started||this.closed||this.runtime.stopping)throw Error('Host session already started or stopped');
    this.started=true;let previous=this.now(),accumulator=0,lastPulse=previous;
    this.timer=this.schedule(()=>{
      if(this.failed||this.runtime.stopping)return;
      const now=this.now();accumulator+=Math.max(0,Math.min(.25,(now-previous)/1000));previous=now;
      try{
        while(accumulator+1e-9>=this.dt){this.runtime.step(this.dt);accumulator-=this.dt;}
        if(now-lastPulse>=1000){lastPulse=now;this.onPulse(now);}
      }catch(error){this.failed=true;this.stop();this.onError(error);}
    },Math.floor(this.dt*1000));
    return this;
  }
  handle(message) {
    if(this.closed||this.runtime.stopping)return false;
    if(!message||typeof message!=='object')return false;
    if(message.type==='room')this.runtime.setRoom(message.room);
    else if(message.type==='member_resets'){
      if(message.roomId!==this.runtime.room.id||message.epoch!==this.runtime.room.epoch)return false;
      this.runtime.applyMemberResets(message.memberResets,message.memberResetVersion);
    }else if(message.type==='packet'){
      let value;try{value=JSON.parse(message.json);}catch{return false;}
      this.runtime.receive(message.peerId,value);
    }else if(message.type==='disconnect')this.runtime.disconnect(message.peerId);
    else return false;
    return true;
  }
  stop() {
    if(this.timer!==null){this.cancel(this.timer);this.timer=null;}
    this.runtime.stopping=true;this.runtime.world.s.paused=true;
  }
  close({requireBackup=true}={}) {
    if(this.closing)return this.closing;
    if(this.closed)return Promise.resolve(this.runtime.saveStatus);
    this.stop();
    const operation=this.runtime.freezeAndSave({requireBackup}).then(result=>{this.closed=true;return result;});
    this.closing=operation;
    operation.then(()=>{this.closing=null;},()=>{this.closing=null;});
    return operation;
  }
}
