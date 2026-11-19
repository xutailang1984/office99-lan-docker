import {loadConfig} from '../config.mjs';
import {SurvivalWorld} from '../world.mjs';
export const base=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
export function fixture(n=1,change=null) {const c=structuredClone(base);change?.(c);const w=new SurvivalWorld(c,null,{onlineRoster:true}),ps=Array.from({length:n},(_,i)=>w.allocate(`Synthetic ${i+1}`,`test-only-${i+1}`));for(const p of ps){w.connect(p,p.name);Object.assign(p,{x:24+iOffset(p),z:24,y:w.ground(24+iOffset(p),24),joinProtectionUntil:0});}w.s.destructibles={};w.drainEvents();return {w,p:ps[0],ps};}
const iOffset=p=>(p.slotId-1)*1.5;
export function command(w,p,command,payload={},targetId) {return w.command(p,{requestId:p.requestHighWater+1,command,payload,...(targetId?{targetId}:{})});}
export function advance(w,seconds,inputs={}) {for(let t=0;t<seconds-1e-9;t+=1/30){for(const p of w.scenePlayers().filter(p=>p.connected))w.input(p,{seq:p.inputAck+1,dx:0,dz:0,yaw:p.yaw,pitch:p.pitch,...(typeof inputs==='function'?inputs(p):inputs)});w.step(Math.min(1/30,seconds-t));if(w.needsBarrier)w.finishDayBarrier();}}
export function enemy(w,p,id='crab',offset={x:0,z:-3}) {const e=w.spawnEnemy(id,p.x+offset.x,p.z+offset.z,true);e.night=false;e.source='wild';e.zoneId=w.nearestZone(e)?.id??null;e.homeX=e.x;e.homeZ=e.z;return e;}
export function put(p,w,x,z) {Object.assign(p,{x,z,y:w.ground(x,z),joinProtectionUntil:0});}
export function restored(w) {return new SurvivalWorld(w.c,w.serialize(),{onlineRoster:true});}
