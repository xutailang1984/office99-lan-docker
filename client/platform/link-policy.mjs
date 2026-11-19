// Independent of browser/RTC APIs so every connection-state timeout is testable.
export class LinkPolicy {
 constructor({requestRelay,onFailure=()=>{},schedule=(fn,ms)=>setTimeout(fn,ms),cancel=id=>clearTimeout(id),directTimeout=5000,relayTimeout=8000,deferDirectStart=false}){
  this.mode='connecting';this.requestRelay=requestRelay;this.onFailure=onFailure;this.schedule=schedule;this.cancel=cancel;this.relayTimeout=relayTimeout;this.directTimeout=directTimeout;this.timer=null;if(!deferDirectStart)this.startDirect();
 }
 startDirect(){if(this.mode!=='connecting'||this.timer!==null)return false;this.timer=this.schedule(()=>this.fallback(),this.directTimeout);return true;}
 clear(){if(this.timer!==null){this.cancel(this.timer);this.timer=null;}}
 directOpen(){if(!['connecting','direct'].includes(this.mode))return false;this.clear();this.mode='direct';return true;}
 fallback(){if(['relay','relay-pending','disposed'].includes(this.mode))return;this.clear();this.mode='relay-pending';this.requestRelay();this.timer=this.schedule(()=>{this.timer=null;if(this.mode!=='relay-pending')return;this.mode='failed';this.onFailure();},this.relayTimeout);}
 relayReady(){if(this.mode==='disposed')return false;const changed=this.mode!=='relay';this.clear();this.mode='relay';return changed;}
 dispose(){this.clear();this.mode='disposed';}
 get ready(){return this.mode==='direct'||this.mode==='relay';}
}
