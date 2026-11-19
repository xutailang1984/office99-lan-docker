import {stringifySnapshots,parsePacket} from '../wire.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {MobaWorld} from '../world.mjs';
import {HERO_IDS} from '../catalog.mjs';

const make=()=>{const w=new MobaWorld({roster:Array.from({length:10},(_,i)=>({id:'latency-'+i,heroId:HERO_IDS[i],team:i<5?0:1,connected:true}))});for(const h of w.heroes){h.level=6;h.skillRanks={q:1,w:1,e:1,r:1};}Object.assign(w.heroes[0],{x:0,z:0});Object.assign(w.heroes[5],{x:2,z:0});return w;};
const command=(w,h,m)=>w.command(h.id,{seq:h.lastSeq+1,...m});
const advance=(w,s)=>{for(let i=0;i<Math.ceil(s*30);i++)w.step(1/30);};

test('duplicate attack clicks preserve the same windup and produce exactly one release',()=>{
 const w=make(),h=w.heroes[0],target=w.heroes[5];
 assert(command(w,h,{type:'attack',target:target.id}).ok);w.step();
 const cast=w.casts.find(c=>c.source===h.id),at=cast.at;
 for(let i=0;i<3;i++){assert(command(w,h,{type:'attack',target:target.id}).ok);w.step();}
 assert.equal(w.casts.find(c=>c.source===h.id).at,at);advance(w,.15);
 assert.equal(w.events.filter(e=>e.kind==='projectile_spawn'&&e.source===h.id).length,1);
});
test('movement and attack-move cancel only an unreleased attack without losing a full cycle or a passive',()=>{
 for(const type of ['move','attack_move']){
  const w=make(),h=w.heroes[0],target=w.heroes[5];h.empowered=10;
  command(w,h,{type:'attack',target:target.id});w.step();
  assert(command(w,h,{type,x:-2,z:0}).ok);assert(!w.casts.some(c=>c.source===h.id));
  assert(h.attackAt<=w.time);assert.equal(h.attackCount,0);assert.equal(h.empowered,10);
  command(w,h,{type:'attack',target:target.id});advance(w,.2);
  assert.equal(h.attackCount,1);assert.equal(h.empowered,0);
  assert.equal(w.events.filter(e=>e.kind==='projectile_spawn'&&e.source===h.id).length,1);
 }
});
test('moving after projectile release preserves both the projectile and attack cooldown',()=>{
 const w=make(),h=w.heroes[0],target=w.heroes[5];target.x=7;
 command(w,h,{type:'attack',target:target.id});advance(w,.2);
 const projectile=w.projectiles.find(p=>p.source===h.id),attackAt=h.attackAt;assert(projectile);
 command(w,h,{type:'move',x:-2,z:0});assert.equal(h.attackAt,attackAt);assert(w.projectiles.includes(projectile));
});
test('a paid short cast keeps only the last movement or attack intent and revalidates after release',()=>{
 const w=make(),h=w.heroes[0],target=w.heroes[5];
 assert(command(w,h,{type:'cast',skill:'q',x:10,z:0}).ok);
 assert(command(w,h,{type:'move',x:-2,z:0}).queued);
 assert(command(w,h,{type:'attack',target:target.id}).queued);
 assert.deepEqual(h.queuedOrder,{type:'attack',target:target.id});
 const mana=h.mana,otherCooldown=h.cooldowns.e;
 assert.equal(command(w,h,{type:'cast',skill:'e',x:0,z:0}).code,'CASTING');
 assert.equal(h.mana,mana);assert.equal(h.cooldowns.e,otherCooldown);assert.equal(w.casts.filter(c=>c.source===h.id).length,1);
 advance(w,.2);assert(w.events.some(e=>e.kind==='projectile_spawn'&&e.source===h.id));
 assert.equal(h.queuedOrder,null);assert.equal(h.order.target,target.id);
});
test('last movement intent is routed only after the spell releases, including replaced movement',()=>{
 const w=make(),h=w.heroes[0];command(w,h,{type:'cast',skill:'q',x:10,z:0});
 command(w,h,{type:'move',x:2,z:0});command(w,h,{type:'move',x:-2,z:0});
 assert.equal(h.x,0);advance(w,.2);assert(h.x<0);assert.equal(h.queuedOrder,null);
});
test('stop cancels a cast immediately and removes deferred movement without secretly replaying it',()=>{
 const w=make(),h=w.heroes[0];command(w,h,{type:'cast',skill:'q',x:10,z:0});command(w,h,{type:'move',x:-2,z:0});
 command(w,h,{type:'stop'});assert.equal(h.action,'idle');assert.equal(h.queuedOrder,null);
 advance(w,.6);assert.equal(h.x,0);assert(!w.events.some(e=>e.kind==='projectile_spawn'&&e.source===h.id));
});
test('control, death and membership reset clear deferred player input',()=>{
 for(const scenario of ['stun','root','silence','death','reset']){
  const w=make(),h=w.heroes[0],enemy=w.heroes[5];
  command(w,h,{type:'cast',skill:'q',x:10,z:0});command(w,h,{type:'move',x:-2,z:0});assert(h.queuedOrder);
  if(scenario==='death')w.damage(enemy,h,99999);
  else if(scenario==='reset')w.resetInput(h);
  else assert(w.control(enemy,h,scenario,1)>0);
  assert.equal(h.queuedOrder,null,scenario);
 }
});
test('deferred attacks cannot attack a target that disappeared during cast',()=>{
 const w=make(),h=w.heroes[0],target=w.heroes[5];
 command(w,h,{type:'cast',skill:'q',x:10,z:0});command(w,h,{type:'attack',target:target.id});target.hp=0;target.respawnAt=100;
 advance(w,.2);assert.equal(h.queuedOrder,null);assert.equal(h.order,null);
});
test('projectile births are timestamped and remain visible in events even after a short projectile dies',()=>{
 const w=make(),h=w.heroes[0],target=w.heroes[5];
 w.projectile(h,target,{damage:10,speed:38,width:.3,kind:'staple',target:target.id});
 const before=w.snapshot(0,h.id);assert.equal(before.projectiles[0].speed,38);assert.equal(before.projectiles[0].bornAt,w.time);
 advance(w,.1);const after=w.snapshot(0,h.id),birth=after.events.find(e=>e.kind==='projectile_spawn');
 assert.equal(after.projectiles.length,0);assert(birth);assert.equal(birth.speed,38);assert.equal(birth.bornAt,0);
 assert.equal(birth.projectileId,before.projectiles[0].id);assert.equal(birth.projectileKind,'staple');
 assert(after.events.some(e=>e.kind==='hit'));
});
test('checkpoint rejects oversized deferred orders and invalid projectile timing',()=>{
 const w=make(),h=w.heroes[0];w.projectile(h,{x:10,z:0},{damage:10});
 const original=w.serialize();assert(MobaWorld.validate(original));
 for(const mutate of [s=>s.heroes[0].queuedOrder={type:'attack',target:'x'.repeat(65)},s=>s.heroes[0].queuedOrder={type:'move',x:0,z:0,extra:1},s=>s.projectiles[0].bornAt=s.time+1,s=>s.projectiles[0].speed=0,s=>s.projectiles[0].speed=201]){
  const state=structuredClone(original);mutate(state);assert.throws(()=>MobaWorld.validate(state));
 }
});

function workerHarness(autoAck=true){
 let now=0,timer=null;const packets=[],worlds=[];
 class FakeWorld{
  constructor({roster}){this.heroes=roster.map(h=>({...h}));this.events=[];this.eventSeq=0;this.phase='running';this.time=0;this.tick=0;worlds.push(this);}
  step(dt){this.time+=dt;this.tick++;if(this.pendingEvent){this.events.push({id:++this.eventSeq,kind:this.pendingEvent});this.pendingEvent=null;}}
  serialize(){return{phase:this.phase};}
  snapshots(seats){return seats.map(seat=>({seat,state:{type:'state',tick:this.tick,time:this.time,events:this.events}}));}
  command(_id,m){if(m.type==='cast')this.events.push({id:++this.eventSeq,kind:'cast'});return{ok:true};}
  resetInput(h){h.queuedOrder=null;h.resetCount=(h.resetCount??0)+1;}
 }
 const context={stringifySnapshots,MobaWorld:FakeWorld,RULES:{hz:30,snapshotHz:20,checkpointSeconds:2},self:{},performance:{now:()=>now},postMessage:m=>packets.push({at:now,...m}),setInterval:fn=>(timer=fn,1),clearInterval:()=>{},close:()=>{}};
 const src=fs.readFileSync(new URL('../../../client/moba-web/host-worker.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
 vm.runInNewContext(src,context);
 const roster=[{id:'seat',peerId:'peer',connected:true,bot:false}];
 let acknowledged=0;const ack=()=>{if(!autoAck)return;for(const p of packets)if(p.frameId>acknowledged){acknowledged=p.frameId;context.self.onmessage({data:{type:'frame_ack',epoch:1,frameId:p.frameId}});}};
 const send=m=>{context.self.onmessage({data:m});ack();};send({type:'init',epoch:1,revision:0,roster});send({type:'resume',epoch:1});
 return{world:worlds[0],packets,roster,send,at:n=>{now=n;timer();ack();},states:()=>packets.filter(m=>m.type==='packet'&&parsePacket(m.data).type==='state')};
}

test('a blocked UI thread cannot build a stale snapshot burst, and resumes with current state',()=>{
 const w=workerHarness(false);for(let at=16;at<=20000;at+=16)w.at(at);
 assert.equal(w.states().length,1);assert(w.world.tick>500);
 const first=w.states()[0];w.send({type:'frame_ack',epoch:2,frameId:first.frameId});w.at(20016);assert.equal(w.states().length,1);
 w.send({type:'frame_ack',epoch:1,frameId:first.frameId+1});w.at(20032);assert.equal(w.states().length,1);
 w.send({type:'frame_ack',epoch:1,frameId:first.frameId});w.at(20064);
 assert.equal(w.states().length,2);assert(parsePacket(w.states()[1].data).tick>500);
 w.send({type:'command',epoch:1,peerId:'peer',command:{seq:71,type:'cast'}});
 assert(w.packets.some(p=>p.type==='packet'&&parsePacket(p.data).seq===71));
 assert.equal(w.states().length,2,'reliable command results bypass snapshot backpressure');
 w.send({type:'frame_ack',epoch:1,frameId:first.frameId});w.at(20128);assert.equal(w.states().length,2,'old acknowledgements do not open a new batch');
});
test('20Hz worker scheduling accumulates deadlines instead of drifting to each 16ms callback',()=>{
 const w=workerHarness();for(let at=16;at<=208;at+=16)w.at(at);
 assert.deepEqual(w.states().map(m=>m.at),[0,64,112,160,208]);
});
test('a large timer gap emits one current snapshot rather than bursting stale snapshots',()=>{
 const w=workerHarness();w.at(400);assert.deepEqual(w.states().map(m=>m.at),[0,400]);w.at(448);assert.equal(w.states().length,2);w.at(464);assert.equal(w.states().length,3);
});
test('accepted casts and simulation combat events publish before the next periodic deadline',()=>{
 const w=workerHarness();w.send({type:'command',epoch:1,peerId:'peer',command:{seq:1,type:'cast'}});assert.equal(w.states().length,2);
 w.world.pendingEvent='projectile_spawn';w.at(16);w.at(32);w.at(48);assert.equal(w.states().at(-1).at,48);
});
test('membership changes clear queued commands on both disconnect and reconnect',()=>{
 const w=workerHarness(),h=w.world.heroes[0];h.queuedOrder={type:'move',x:0,z:0};
 w.send({type:'membership',epoch:1,roster:[{...w.roster[0],connected:false}]});assert.equal(h.queuedOrder,null);
 h.queuedOrder={type:'move',x:0,z:0};w.send({type:'membership',epoch:1,roster:w.roster});assert.equal(h.queuedOrder,null);assert.equal(h.resetCount,2);
});

test('an immediate combat frame replaces the next scheduled frame instead of doubling it',()=>{
 const w=workerHarness();w.world.pendingEvent='projectile_spawn';w.at(48);assert.deepEqual(w.states().map(m=>m.at),[0,48]);w.at(64);w.at(96);assert.equal(w.states().length,2);w.at(112);assert.equal(w.states().length,3);
});
