import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../config.mjs';
import {SurvivalWorld} from '../world.mjs';
import {EXPLORATION_EVENTS} from '../exploration-config.mjs';
import {dayEncounterBudget} from '../expedition-config.mjs';
const base=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
function fixture(count=2){const w=new SurvivalWorld(base,null,{onlineRoster:true}),ps=Array.from({length:count},(_,i)=>w.allocate('Synthetic '+i,'exploration-'+i));w.beginDayBarrier();w.finishDayBarrier();return{w,p:ps[0],ps};}
function command(w,p,kind,id,payload={},extra={}){return w.command(p,{type:'command',requestId:p.requestHighWater+1,command:kind,targetId:id,payload,...extra});}
function input(w,p,values={}){w.input(p,{seq:p.inputAck+1,dx:0,dz:0,yaw:p.yaw,pitch:p.pitch,...values});}
function advance(w,seconds,values={}){for(let t=0;t<seconds-1e-8;t+=1/30){for(const p of w.scenePlayers())input(w,p,values);w.step(Math.min(1/30,seconds-t));}}
function place(w,p,q,offset=1.8){Object.assign(p,{x:q.x+offset,z:q.z,y:w.ground(q.x+offset,q.z),vy:0,swimming:false});}
function event(w,type){for(let i=0;i<4;i++){const e=w.s.exploration.events.find(e=>e.type===type);if(e)return e;w.s.dayIndex++;w.generateDay();}throw Error(type);}
function work(w,p,q,seconds){assert.equal(command(w,p,'Explore',q.id).ok,true);advance(w,seconds,{interact:true});assert.equal(p.work,null);}
function totals(w,id){return Object.values(w.s.items).filter(i=>i.definitionId===id).reduce((n,i)=>n+i.quantity,0);}

test('three districts rotate twelve distinct events in four days within unchanged entity budget',()=>{
 for(const n of [1,2,4,8]){const seen=new Set(),{w}=fixture(n);for(let day=0;day<4;day++){assert.equal(w.s.exploration.events.length,3);assert.equal(Object.keys(w.s.destructibles).length,36);assert.equal(Object.keys(w.s.enemies).length,dayEncounterBudget(n).guards);for(const e of w.s.exploration.events){assert(!seen.has(e.type));seen.add(e.type);assert(e.parts.length<=3);for(const q of e.parts){assert(Number.isFinite(q.y));assert(w.c.cycle.low_water_y-q.y<=.6);}}w.s.dayIndex++;w.generateDay();}w.assertInvariants();assert.deepEqual(seen,new Set(EXPLORATION_EVENTS.map(e=>e.id)));}
});
test('old adventure migration preserves world, inventory and current day; additions appear next day',()=>{
 const{w,p}=fixture();const save=w.serialize();delete save.exploration;const items=structuredClone(save.items),props=structuredClone(save.destructibles);const restored=new SurvivalWorld(base,save,{onlineRoster:true});assert.deepEqual(restored.s.items,items);assert.deepEqual(restored.s.destructibles,props);assert.equal(restored.s.exploration.events.length,0);restored.connect(restored.s.players[p.id],'Synthetic');restored.s.dayIndex++;restored.generateDay();assert.equal(restored.s.exploration.events.length,3);
});
test('held work accepts delayed input, cancels on release and races yield exactly one reward',()=>{
 const{w,p,ps}=fixture();const e=event(w,'desk_alarm'),q=e.parts[0];w.s.enemies={};place(w,p,q);place(w,ps[1],q,-1.8);assert(command(w,p,'Explore',q.id).ok);for(let i=0;i<5;i++)w.step(1/30);assert(p.work);assert.equal(command(w,ps[1],'Explore',q.id).code,'BUSY');advance(w,.4);assert.equal(p.work,null);work(w,p,q,4.1);assert.equal(e.stage,1);work(w,p,q,4.1);assert.equal(totals(w,'spring_parts'),4);assert.equal(command(w,ps[1],'Explore',q.id).ok,false);w.exploration.reward(e,[['spring_parts',9]]);assert.equal(totals(w,'spring_parts'),4);assert(!q.lockedBy);w.assertInvariants();
});
test('ringing alternative starts loud fast opening without hidden held-F requirement',()=>{
 const{w,p}=fixture();const e=event(w,'desk_alarm'),q=e.parts[0];w.s.enemies={};place(w,p,q);assert(command(w,p,'Explore',q.id,{alternate:true}).ok);assert.equal(p.work,null);assert(e.noisy);work(w,p,q,2.1);assert.equal(totals(w,'coffee_coupon'),2);
});
test('symbol drawers use public clue, wrong drawer alarms and completion cancels other locks',()=>{
 const{w,p,ps}=fixture();const e=event(w,'desk_sort');w.s.enemies={};const q=e.parts[e.answer],wrong=e.parts[(e.answer+1)%3];place(w,p,wrong);work(w,p,wrong,1.4);assert(e.noisy);assert(!e.done);place(w,p,q);const other=e.parts[(e.answer+2)%3];place(w,ps[1],other);assert(command(w,ps[1],'Explore',other.id).ok);work(w,p,q,1.4);assert(e.done);advance(w,.1);assert.equal(ps[1].work,null);assert.equal(totals(w,'sealed_cell'),1);assert.equal(totals(w,'coffee_coupon'),1);
});
test('carry limits real continuous input, drops on disconnect/death and cleans deleted-owner locks',()=>{
 const{w,p}=fixture();const e=event(w,'supply_carry'),q=e.parts[0];w.s.enemies={};place(w,p,q);assert(command(w,p,'Explore',q.id).ok);const ammo=w.equipped(p).magazineAmmo;advance(w,.5,{fire:true,sprint:true,jump:true,dx:1});assert.equal(w.equipped(p).magazineAmmo,ammo);assert(p.moveSpeed<=w.c.player.walk_speed*base.exploration.carrySpeed+.01);assert.equal(command(w,p,'Melee').code,'BUSY');assert.equal(command(w,p,'Cast','near').code,'BUSY');w.disconnect(p);assert.equal(q.carrierId,null);assert.equal(p.carryingId,null);assert(!w.blocked(q.x,q.y,q.z,.7));w.connect(p,'Synthetic');place(w,p,q);assert(command(w,p,'Explore',q.id).ok);w.enterDowned(p);assert.equal(q.carrierId,null);q.carrierId='missing';q.lockedBy='missing';w.exploration.tick();assert.equal(q.carrierId,null);assert(!q.lockedBy);w.assertInvariants();
});
test('carried progress restores to one reachable package and delivers resources once',()=>{
 const{w,p}=fixture();const e=event(w,'supply_carry'),q=e.parts[0];w.s.enemies={};place(w,p,q);assert(command(w,p,'Explore',q.id).ok);advance(w,.1);const restored=new SurvivalWorld(base,w.serialize(),{onlineRoster:true}),rp=restored.s.players[p.id],re=restored.s.exploration.events.find(x=>x.id===e.id),rq=re.parts[0];restored.connect(rp,'Synthetic');assert.equal(rq.carrierId,null);place(restored,rp,rq);assert(command(restored,rp,'Explore',rq.id).ok);place(restored,rp,re.receiver,.4);assert(command(restored,rp,'Explore',rq.id).ok);assert(re.done);assert.equal(rp.carryingId,null);assert.equal(totals(restored,'spring_parts'),5);assert.equal(totals(restored,'sealed_cell'),1);restored.assertInvariants();
});
test('sealed package distinguishes slow recovery and fast destructive reward with no duplicate debris loot',()=>{
 for(const smash of [false,true]){const{w,p}=fixture();const e=event(w,'supply_seal'),q=e.parts[0],prop=w.s.destructibles[q.id];w.s.enemies={};place(w,p,q);if(smash){w.breakProp(prop,{actorId:p.id});w.breakProp(prop,{actorId:p.id});assert.equal(totals(w,'scrap'),3);}else{for(let i=0;i<3;i++)work(w,p,q,3.1);assert.equal(totals(w,'sealed_cell'),2);}assert(e.done&&prop.broken);assert.equal(w.events.filter(x=>x.eventType==='Destroyed'&&x.payload.targetId===q.id).length,1);w.assertInvariants();}
});
test('timed parcels reward only boxes broken after timer starts, and stop after timeout',()=>{
 for(const late of [false,true]){const{w,p}=fixture();const e=event(w,'parcel_rush');w.s.enemies={};place(w,p,e.parts[0]);assert(command(w,p,'Explore',e.parts[0].id).ok);if(late)advance(w,25.1);for(const q of e.parts)w.breakProp(w.s.destructibles[q.id],{actorId:p.id});assert.equal(totals(w,'spring_parts'),late?0:6);assert.equal(totals(w,'sealed_cell'),late?0:1);assert(e.done);w.assertInvariants();}
});
test('intact parcel offers early cashout instead of mandatory perfect defense',()=>{
 const{w,p}=fixture();const e=event(w,'parcel_intact'),q=e.parts[0];place(w,p,q);w.s.enemies={};work(w,p,q,4.1);assert.equal(e.stage,1);assert(command(w,p,'Explore',q.id,{alternate:true}).ok);assert(e.done);assert.equal(totals(w,'spring_parts'),3);assert.equal(totals(w,'team_medal'),0);
});
test('last coupon frees its slot atomically; replay and failed exchanges preserve quantities',()=>{
 const{w,p}=fixture();const shop=w.staticWorld().terminals.find(t=>t.type==='shop');place(w,p,shop,1);for(const id of [...w.bag(p).itemIds])w.removeItem(w.s.items[id]);w.addItems(w.bag(p),'coffee_coupon',1);while(w.bag(p).itemIds.length<w.bag(p).slotLimit)w.createItem('knife',1,w.bag(p));const msg={type:'command',requestId:p.requestHighWater+1,command:'Redeem',payload:{definitionId:'coffee_coupon',stationId:shop.id}};assert(w.command(p,msg).ok);assert(w.command(p,msg).ok);assert.equal(w.count(p,'coffee_coupon'),0);assert.equal(w.count(p,'coffee_flask'),1);w.assertInvariants();
});
test('rare fish has larger collision and cannot attack camp or persist after abandonment',()=>{
 const{w,p}=fixture();w.s.enemies={};const e=w.spawnEnemy('manager_koi',20,20);e.ownerId=p.id;w.exploration.landed(e,p,{special:true});assert.equal(e.radius,.9);assert.equal(w.aggro.leash(e),12);assert.equal(w.activeFishingCount(p),1);const core=w.s.buildings.core.hp;place(w,p,w.s.buildings.core,1);advance(w,26);assert(!w.s.enemies[e.id]);assert.equal(w.s.buildings.core.hp,core);w.assertInvariants();
});

test('full backpack with a larger coupon stack before a single coupon consumes the actual freed slot',()=>{
 const{w,p}=fixture();const shop=w.staticWorld().terminals.find(t=>t.type==='shop');place(w,p,shop,1);for(const id of [...w.bag(p).itemIds])w.removeItem(w.s.items[id]);w.createItem('coffee_coupon',2,w.bag(p));w.createItem('coffee_coupon',1,w.bag(p));while(w.bag(p).itemIds.length<w.bag(p).slotLimit)w.createItem('knife',1,w.bag(p));assert(command(w,p,'Redeem',null,{definitionId:'coffee_coupon',stationId:shop.id}).ok);assert.equal(w.count(p,'coffee_coupon'),2);assert.equal(w.count(p,'coffee_flask'),1);w.assertInvariants();
});
test('blocked drop search never throws or leaves one-way ownership on downing/disconnect/restore',()=>{
 const{w,p}=fixture();const e=event(w,'supply_carry'),q=e.parts[0];w.s.enemies={};place(w,p,q);assert(command(w,p,'Explore',q.id).ok);const safe=pos(q);w.exploration.safeDrop=()=>{throw Error('synthetic all candidates blocked');};assert.doesNotThrow(()=>w.disconnect(p));assert.equal(p.carryingId,null);assert.equal(q.carrierId,null);assert.deepEqual(pos(q),safe);w.assertInvariants();
});
test('guard stun is honored; a route windup keeps the obstacle id and never silently hits the parcel',()=>{
 const{w,p}=fixture();const e=event(w,'parcel_intact'),q=e.parts[0];w.s.enemies={};e.started=true;const parcel=w.s.destructibles[q.id],g=w.spawnEnemy('crab',q.x,q.z+2.4);g.explorationTarget=q.id;g.state='STUNNED';g.phaseRemaining=1;
 const before=parcel.hp;for(let i=0;i<15;i++)w.exploration.guardUpdate(g,1/30);assert.equal(g.state,'STUNNED');assert.equal(parcel.hp,before);
 const obstacle={id:'fixture-block',x:q.x,y:q.y,z:q.z+1.35,yaw:0,kind:'crate',hp:45,maxHp:45,size:{x:1.2,y:1.2,z:1.2},radius:.85,revision:1,broken:false};w.s.destructibles[obstacle.id]=obstacle;Object.assign(g,{state:'WINDUP',phaseRemaining:.01,attackKind:'clear_route',targetId:obstacle.id});w.exploration.guardUpdate(g,.02);assert(w.damageQueue.some(hit=>hit.target===obstacle.id));assert(!w.damageQueue.some(hit=>hit.target===parcel.id));
});
test('new fish use damage aggro and keep target when nearest distances alternate',()=>{
 const{w,p,ps}=fixture();w.s.enemies={};w.s.destructibles={};const e=w.spawnEnemy('ink_cuttle',22,22);e.source='fishing';e.state='CHASE';e.phaseRemaining=0;place(w,p,e,2);place(w,ps[1],e,3);for(const a of ps)a.joinProtectionUntil=0;w.aggro.damage(e,ps[1],40);w.exploration.fishUpdate(e,.01);assert.equal(e.targetId,ps[1].id);place(w,p,e,1.5);w.exploration.fishUpdate(e,.01);assert.equal(e.targetId,ps[1].id);
});
test('real casts reserve rare chance once, preserve it through saved reconnect, and cancel prevents reroll',()=>{
 const{w,p,ps}=fixture();w.s.enemies={};w.s.destructibles={};w.s.exploration.catches=3;for(const a of ps){Object.assign(a,{x:0,y:w.ground(0,99),z:99,yaw:Math.PI,heldSlot:'rod',equipUntil:0});}const original=w.rng.bind(w);w.rng=stream=>stream==='exploration_fish'?.95:original(stream);
 assert(command(w,p,'Cast',null,{x:0,z:106,power:.7}).ok);assert(p.fishing.special);assert(command(w,ps[1],'Cast',null,{x:0,z:106,power:.7}).ok);assert(!ps[1].fishing.special);assert.equal(w.publicState().players[0].pendingSeaCatch,undefined);
 const r=new SurvivalWorld(w.c,w.serialize(),{onlineRoster:true}),q=r.s.players[p.id];r.connect(q,'Synthetic');assert(command(r,q,'Cast',null,{x:0,z:106,power:.7}).ok);assert(q.fishing.special);r.cancelFishing(q);assert.equal(q.pendingSeaCatch,null);const rng=r.rng.bind(r);r.rng=stream=>stream==='exploration_fish'?.95:rng(stream);assert(command(r,q,'Cast',null,{x:0,z:106,power:.7}).ok);assert(!q.fishing.special);assert.equal(r.s.exploration.rareDay,r.s.dayIndex);r.assertInvariants();
});
test('invalid exploration ids, pending creature and counters are rejected without clearing a valid old adventure',()=>{
 const{w,p}=fixture();for(const modify of [s=>s.exploration.events[0].parts=[],s=>s.exploration.events[0].zoneId='wrong',s=>s.exploration.catches=-1,s=>s.players[p.id].pendingSeaCatch={creature:'boss_crab',rare:false,day:s.dayIndex}]){const saved=w.serialize();modify(saved);assert.throws(()=>new SurvivalWorld(base,saved));}const restored=new SurvivalWorld(base,w.serialize());assert.deepEqual(restored.s.items,w.s.items);
});
function pos(q){return{x:q.x,y:q.y,z:q.z};}

test('a far guard inside its home range travels to protect the parcel instead of silently patrolling',()=>{
 const{w,p}=fixture();const e=event(w,'parcel_intact'),q=e.parts[0];w.s.enemies={};w.s.destructibles=Object.fromEntries(Object.entries(w.s.destructibles).filter(([id])=>id===q.id));
 const g=w.spawnEnemy('crab',q.x,q.z+21);Object.assign(g,{source:'wild',zoneId:e.zoneId,homeX:q.x,homeZ:q.z+21,state:'CHASE'});place(w,p,q);assert(command(w,p,'Explore',q.id).ok);assert.equal(g.explorationTarget,q.id);const before=Math.hypot(g.x-q.x,g.z-q.z);assert(w.exploration.guardUpdate(g,.1));assert.equal(g.targetId,q.id);assert(Math.hypot(g.x-q.x,g.z-q.z)<before);w.assertInvariants();
});
test('removing a working member immediately before destruction does not leave a stale lock crash',()=>{
 const{w,p}=fixture();const e=event(w,'supply_seal'),q=e.parts[0];w.s.enemies={};place(w,p,q);assert(command(w,p,'Explore',q.id).ok);delete w.s.players[p.id];assert.doesNotThrow(()=>w.breakProp(w.s.destructibles[q.id],{actorId:'synthetic'}));assert(!q.lockedBy);assert.equal(totals(w,'scrap'),3);
});
