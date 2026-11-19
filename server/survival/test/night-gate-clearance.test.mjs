// Regression expectations: synthetic in-memory worlds only. Product code is read-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,put} from './director-helpers.mjs';
import {quantizeWire} from '../state-wire.mjs';
const position=p=>({x:p.x,y:p.y,z:p.z});
const gates=w=>Object.values(w.s.buildings).filter(b=>b.definitionId==='gate'&&b.hp>0);
const ready=n=>{
 const f=fixture(n);f.w.setPhase('RETURN');
 // The current map has one G01 door. Additional map-local gate fixtures test
 // atomic multi-door clearance without changing production layout or config.
 const template=gates(f.w)[0];assert(template);
 for(let i=0;i<3;i++){const id=`synthetic-gate-${i}`,x=20+i*6,z=20;f.w.s.buildings[id]={...structuredClone(template),id,x,z,y:f.w.ground(x,z),yaw:0,revision:1,gateOpen:true};}
 for(const b of gates(f.w))b.gateOpen=true;f.w.drainEvents();return f;
};
function clear(w,p){
 assert(!w.blocked(p.x,p.y,p.z,w.c.player.capsule_radius,p.id),`actual ${p.slotId} inside ${w.blocked(p.x,p.y,p.z,w.c.player.capsule_radius,p.id)?.id}`);
 const publicP=w.publicState().players.find(q=>q.id===p.id);assert(publicP);assert.deepEqual(position(publicP),position(p),'public state changed coordinates');
 assert(!w.blocked(publicP.x,publicP.y,publicP.z,w.c.player.capsule_radius,publicP.id),'public coordinates inside collider');
 const wire=quantizeWire(publicP);assert(!w.blocked(wire.x,wire.y,wire.z,w.c.player.capsule_radius,wire.id),'wire quantization reintroduced overlap');
}

for(const n of [1,2,4,8])test(`night gate: ${n} players in several doorways are cleared before every gate closes`,()=>{
 const {w,ps}=ready(n),all=gates(w),previous=new Map();assert(all.length>=2);
 for(let i=0;i<ps.length;i++){const gate=all[i%all.length];put(ps[i],w,gate.x,gate.z);assert(!w.blocked(ps[i].x,ps[i].y,ps[i].z,w.c.player.capsule_radius,ps[i].id));}
 for(const gate of all)previous.set(gate.id,gate.revision);
 w.startNight();assert.equal(w.s.phase,'NIGHT');assert.equal(Object.values(w.s.enemies).filter(e=>e.definitionId==='boss_crab').length,1);
 for(const p of ps)clear(w,p);
 for(const gate of all){assert.equal(gate.gateOpen,false);assert.equal(gate.revision,previous.get(gate.id)+1,'collision state change needs a revision');}
 for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++)assert(Math.hypot(ps[i].x-ps[j].x,ps[i].z-ps[j].z)>=w.c.player.capsule_radius*2+.07,'group clearance stacked players');
 const corrected=w.drainEvents().filter(e=>e.eventType==='PositionCorrected');assert.equal(corrected.length,n);assert(corrected.every(e=>e.payload.reason==='building_clearance'));
});

test('night gate: a connected downed teammate is moved safely without being revived or damaged',()=>{
 const {w,p,ps}=ready(2),gate=gates(w)[0],q=ps[1];put(p,w,24,24);put(q,w,gate.x,gate.z);q.lifeState='DOWNED';q.hp=0;q.downedRemaining=23;
 w.startNight();clear(w,q);assert.equal(q.lifeState,'DOWNED');assert.equal(q.hp,0);assert.equal(q.downedRemaining,23);assert.equal(gate.gateOpen,false);
});

test('night gate: offline historical players do not constrain or receive clearance',()=>{
 const {w,p,ps}=ready(2),all=gates(w),q=ps[1];put(q,w,all[0].x,all[0].z);w.disconnect(q);const old=position(q);put(p,w,all[1].x,all[1].z);w.drainEvents();
 w.startNight();clear(w,p);assert.deepEqual(position(q),old);assert.equal(q.connected,false);assert.equal(w.s.night.playerCount,1);assert(!w.publicState().players.some(p=>p.id===q.id));assert(gates(w).every(g=>!g.gateOpen));
 const events=w.drainEvents().filter(e=>e.eventType==='PositionCorrected');assert.equal(events.length,1);assert.equal(events[0].payload.actorId,p.id);
});

test('night gate: an impossible clearance leaves all proposed gates open and still starts the night',()=>{
 const {w,p}=ready(1),all=gates(w),gate=all[0],previous=Object.fromEntries(all.map(g=>[g.id,g.revision]));put(p,w,gate.x,gate.z);
 // An intact small wall cage has room for the current capsule, but no legal
 // destination once the central gate becomes solid. Escape would cross an
 // unrelated wall, which real previewPlayerClearance must reject.
 for(const [index,dx,dz,yaw]of [[0,0,-.7,0],[1,0,.7,0],[2,-.7,0,Math.PI/2],[3,.7,0,Math.PI/2]]){
  const id=`synthetic-clearance-cage-${index}`,x=p.x+dx,z=p.z+dz;w.s.buildings[id]={id,definitionId:'wall',x,z,y:w.ground(x,z),yaw,hp:400,maxHp:400,level:1,revision:1};
 }
 assert(!w.blocked(p.x,p.y,p.z,w.c.player.capsule_radius,p.id),'fixture starts blocked');
 assert.equal(w.previewPlayerClearance(all.map(entity=>({entity,changes:{gateOpen:false}}))),null,'fixture should have no legal clearance');const old=position(p);
 w.startNight();assert.equal(w.s.phase,'NIGHT');assert.equal(Object.values(w.s.enemies).filter(e=>e.definitionId==='boss_crab').length,1);assert.deepEqual(position(p),old);clear(w,p);
 for(const b of all){assert.equal(b.gateOpen,true,'failed group must not partly close');assert.equal(b.revision,previous[b.id]);}
 assert.equal(w.drainEvents().filter(e=>e.eventType==='PositionCorrected').length,0);
});

test('night gate: clearance destinations never cross an unrelated intact wall',()=>{
 const {w,p}=ready(1),gate=gates(w)[0];put(p,w,gate.x,gate.z);const old=position(p),id='synthetic-side-wall';
 w.s.buildings[id]={id,definitionId:'wall',x:p.x,z:p.z+.7,y:w.ground(p.x,p.z+.7),yaw:0,hp:400,maxHp:400,level:1,revision:1};assert(!w.blocked(p.x,p.y,p.z,w.c.player.capsule_radius,p.id));
 w.startNight();assert.equal(gate.gateOpen,false);clear(w,p);const box=w.boxes().find(b=>b.id===id);assert(box);
 for(let i=1;i<=50;i++){const t=i/50,at={x:old.x+(p.x-old.x)*t,y:old.y+(p.y-old.y)*t,z:old.z+(p.z-old.z)*t},r=w.c.player.capsule_radius;assert(!(at.x>box.x0-r&&at.x<box.x1+r&&at.z>box.z0-r&&at.z<box.z1+r&&at.y<box.y1&&at.y+1.6>box.y0),'clearance crossed a separate wall');}
});

test('night gate: repeated phase entry does not move already-cleared players or revise unchanged doors again',()=>{
 const {w,p}=ready(1),all=gates(w);put(p,w,all[0].x,all[0].z);w.startNight();clear(w,p);assert(w.drainEvents().some(e=>e.eventType==='PositionCorrected'));
 const old=position(p),revisions=Object.fromEntries(all.map(g=>[g.id,g.revision]));w.startNight();assert.deepEqual(position(p),old);clear(w,p);
 for(const b of all)assert.equal(b.revision,revisions[b.id]);assert.equal(w.drainEvents().filter(e=>e.eventType==='PositionCorrected').length,0);
});

