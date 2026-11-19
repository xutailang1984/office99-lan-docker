import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../config.mjs';
import {SurvivalWorld} from '../world.mjs';
import {RoomRuntime} from '../room-runtime.mjs';
import {compileState,diffState,fullEnvelope,deltaEnvelope} from '../state-wire.mjs';

// Lifecycle fixtures only: synthetic identities, in-memory saves, cleared enemies/props.
// No sockets, filesystem stores, renderer, production accounts, or modified balance values.
const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
const DT=1/30, EPS=1e-6;
function near(actual,expected,label,tolerance=EPS){assert(Math.abs(actual-expected)<=tolerance,`${label}: ${actual} != ${expected}`);}
function at(w,p,x,z){Object.assign(p,{x,z,y:w.ground(x,z),vy:0,swimming:false,velocity:{x:0,y:0,z:0}});}
function arena(w,ps){
  w.startNight();w.s.enemies={};w.s.projectiles={};w.s.destructibles={};w.s.night.pending=[];
  // Registered boss remains undefeated: an empty synthetic arena cannot auto-clear night.
  w.s.night.bossDefeated=false;w.s.paused=false;
  ps.forEach((p,i)=>{at(w,p,10+(i%4)*1.5,10+Math.floor(i/4)*2);p.joinProtectionUntil=0;});
}
function fixture(count=2){
  const w=new SurvivalWorld(structuredClone(config),null,{onlineRoster:true});
  const ps=Array.from({length:count},(_,i)=>w.allocate('合成救援队员'+i,'downed-fixture-'+i));
  arena(w,ps);return {w,ps,p:ps[0],q:ps[1],r:ps[2]};
}
function input(w,p,values={}){w.input(p,{seq:p.inputAck+1,dx:0,dz:0,yaw:p.yaw,pitch:p.pitch,...values});}
function advance(w,seconds,values=()=>({})){let left=seconds;while(left>1e-9){const dt=Math.min(DT,left);for(const p of Object.values(w.s.players))if(p.connected)input(w,p,values(p));w.step(dt);left-=dt;} }
function send(w,p,command,targetId=null,payload={},extra={}){return w.command(p,{type:'command',requestId:p.requestHighWater+1,command,targetId,payload,...extra});}
function accepted(result,label='accepted'){assert.equal(result.ok,true,`${label}: ${result.code??result.message}`);return result;}
function held(id){return p=>({interact:p.id===id});}
function hit(w,p,damage,fields={}){w.damageQueue.push({target:p.id,actorId:'synthetic-enemy',damage,...fields});w.resolveDamage();}
function knock(w,p){hit(w,p,Math.max(100,p.hp));assert.equal(p.lifeState,'DOWNED','lethal hit enters recoverable DOWNED');near(p.downedHp,40,'fresh downed blood');}
function rescue(w,q,p){input(w,q,{interact:true});return send(w,q,'Revive',p.id);}
function selfRescue(w,p){input(w,p,{interact:true});return send(w,p,'SelfRevive');}
function inventory(w){return structuredClone({items:w.s.items,containers:w.s.containers,bank:w.s.bank});}
function possessions(w,p){return [w.bag(p),...Object.values(p.equipment).map(id=>w.s.containers[id])].flatMap(c=>c.itemIds).map(id=>structuredClone(w.s.items[id])).sort((a,b)=>a.id.localeCompare(b.id));}
function corpses(w,p){return Object.values(w.s.containers).filter(c=>c.type==='corpse'&&c.ownerSlotId===p.slotId);}

test('published rescue balance is the agreed blood pool, grace, crawl and assistance contract',()=>{
  for(const [key,value]of Object.entries({downed_hp:40,downed_seconds:60,downed_repeat_penalty:15,downed_min_seconds:30,crawl_speed:1,self_revive_quiet_seconds:8,self_revive_seconds:12,self_revive_hp:20,revive_seconds:6,revive_hp:30,downed_grace_seconds:1}))assert.equal(config.player[key],value,key);
});

for(const count of [1,2,4,8])test(`${count} connected players all DOWNED retain the rescue window, including during a save decision`,()=>{
  const {w,ps}=fixture(count),before=inventory(w);
  for(const p of ps)knock(w,p);
  w.resolveNight();advance(w,1);
  assert.equal(w.s.phase,'NIGHT');assert(ps.every(p=>p.lifeState==='DOWNED'));
  assert.equal(w.s.statistics.breaches,0);assert.equal(w.s.statistics.deaths,0);
  assert.deepEqual(inventory(w),before);assert.equal(w.serialize().night.resolved,false);
});

test('one authoritative blood pool expires after 60 seconds; the display countdown is derived',()=>{
  const {w,p}=fixture();knock(w,p);advance(w,59.9);
  assert.equal(p.lifeState,'DOWNED');near(p.downedHp,40/60*.1,'last fraction of blood',1e-5);
  near(p.downedRemaining,p.downedHp/p.downedBleedRate,'derived countdown');
  advance(w,.11);assert.equal(p.lifeState,'DEAD_WAIT');assert.equal(p.downedHp,0);assert.equal(w.s.statistics.deaths,1);assert.equal(corpses(w,p).length,1);
});

test('repeated downs are 60/45/30 seconds and a later day resets even a historical player',()=>{
  const {w,p,q}=fixture();
  for(const [index,seconds]of [60,45,30].entries()){
    knock(w,p);assert.equal(p.downsThisDay,index+1);near(p.downedBleedRate,40/seconds,'daily penalty');
    accepted(rescue(w,q,p));advance(w,6.01,held(q.id));assert.equal(p.lifeState,'ALIVE');
  }
  w.disconnect(p);w.s.dayIndex++;w.connect(p,'合成返回');p.joinProtectionUntil=0;
  knock(w,p);assert.equal(p.downsThisDay,1);assert.equal(p.downsDayIndex,w.s.dayIndex);near(p.downedBleedRate,40/60,'new day');
});

test('downed crawling uses authoritative one-metre speed and preserves loaded equipment',()=>{
  const {w,p}=fixture(),before=possessions(w,p);knock(w,p);const start={x:p.x,y:p.y,z:p.z};
  advance(w,1,who=>who===p?{dx:100,sprint:true,jump:true,fire:true,ads:true,reel:true}:{});
  near(Math.hypot(p.x-start.x,p.z-start.z),1,'clamped crawl speed',.025);
  assert.equal(p.lifeState,'DOWNED');assert.equal(p.sprinting,false);assert(p.y<=w.ground(p.x,p.z)+.05,'crawl does not jump');
  assert.deepEqual(possessions(w,p),before,'held input cannot fire or consume equipment');assert.equal(p.work,null);assert.equal(p.reload,null);
});

test('a crawling player cannot cross a closed real gate',()=>{
  const {w,p}=fixture();at(w,p,1.5,4.8);w.s.buildings.G01.gateOpen=false;knock(w,p);
  advance(w,3,who=>who===p?{dz:1}:{});assert(p.z<5.6,`closed gate blocked crawl at ${p.z}`);assert(!w.blocked(p.x,p.y,p.z,w.c.player.capsule_radius),'correct x/y/z query finds no embedded collider');
});

test('DOWNED rejects combat, item use and inventory transactions without asset changes',()=>{
  const {w,p}=fixture();knock(w,p);const before=inventory(w),gun=w.equipped(p,'weapon');
  const cases=[['Fire',null,{}],['Melee',null,{}],['Reload',null,{}],['UseQuick',null,{}],['UseTool',null,{definitionId:'coffee_flask'}],['Buy',null,{definitionId:'bandage',stationId:'terminal'}],['Upgrade',gun.id,{stationId:'upgrade'}],['Transfer',null,{itemId:gun.id,toContainerId:'storage'}],['Sell',null,{itemId:gun.id,quantity:1,stationId:'recycle',confirmEquipped:true}]];
  for(const [name,target,payload]of cases){assert.equal(send(w,p,name,target,payload,{expectedRevision:gun.revision}).ok,false,name);assert.deepEqual(inventory(w),before,name);}
});

test('one-second grace prevents additional attacks, but never pauses natural bleeding',()=>{
  const {w,p}=fixture();knock(w,p);hit(w,p,1000);assert.equal(p.lifeState,'DOWNED');near(p.downedHp,40,'protected extra hit');
  advance(w,.5);near(p.downedHp,40-.5*40/60,'grace still bleeds');hit(w,p,1000);assert.equal(p.lifeState,'DOWNED');
  advance(w,.51);const hp=p.downedHp;hit(w,p,5);hit(w,p,7);near(p.downedHp,hp-12,'subsequent attacks subtract blood');assert.equal(p.lifeState,'DOWNED');
  assert(p.selfReviveReadyIn>=8-EPS);assert.equal(p.downedGraceRemaining,0);
});

test('pellets from one shot are combined once while distinct attacks retain their total damage',()=>{
  const {w,p}=fixture();knock(w,p);advance(w,1.01);const hp=p.downedHp;
  w.damageQueue.push({target:p.id,actorId:'synthetic-enemy',damage:3,shotId:'fixture-shot'}, {target:p.id,actorId:'synthetic-enemy',damage:4,shotId:'fixture-shot'}, {target:p.id,actorId:'synthetic-enemy',damage:2,shotId:'fixture-second'});
  w.resolveDamage();near(p.downedHp,hp-9,'grouped and distinct damage');assert.equal(p.lifeState,'DOWNED');
});

test('six seconds of fresh teammate interaction suspends bleeding and restores 30HP without drops',()=>{
  const {w,p,q}=fixture(),before=possessions(w,p);knock(w,p);advance(w,1.1);const hp=p.downedHp;
  accepted(rescue(w,q,p));advance(w,5.9,held(q.id));assert.equal(p.lifeState,'DOWNED');near(p.downedHp,hp,'active assistance pauses bleeding');
  assert(q.work.progress>5.8);advance(w,.11,held(q.id));assert.equal(p.lifeState,'ALIVE');assert.equal(p.hp,30);assert.equal(p.downedHp,0);assert.equal(q.work,null);assert.equal(p.lockedBy,undefined);
  assert.deepEqual(possessions(w,p),before);assert.equal(corpses(w,p).length,0);assert.equal(w.s.statistics.deaths,0);
});

test('self rescue requires eight quiet online seconds and bleeds throughout its twelve-second hold',()=>{
  const {w,p}=fixture(),before=possessions(w,p);knock(w,p);
  assert.equal(selfRescue(w,p).ok,false);advance(w,7.9);assert.equal(selfRescue(w,p).ok,false);
  advance(w,.11);accepted(selfRescue(w,p));const hp=p.downedHp;advance(w,11.9,held(p.id));
  assert.equal(p.lifeState,'DOWNED');near(p.downedHp,hp-11.9*40/60,'self rescue never pauses blood',1e-5);
  advance(w,.11,held(p.id));assert.equal(p.lifeState,'ALIVE');assert.equal(p.hp,20);assert.equal(p.work,null);assert.deepEqual(possessions(w,p),before);
});

test('starting self rescue with insufficient blood cannot beat bleeding death',()=>{
  const {w,p}=fixture();knock(w,p);advance(w,1.01);hit(w,p,28);advance(w,8.01);accepted(selfRescue(w,p));
  advance(w,12.01,held(p.id));assert.equal(p.lifeState,'DEAD_WAIT');assert.equal(corpses(w,p).length,1);assert.equal(w.s.statistics.deaths,1);
});

test('repeated start/cancel without held input cannot exploit the interaction grace to preserve blood',()=>{
  const {w,p,q}=fixture();knock(w,p);const hp=p.downedHp;
  for(let i=0;i<20;i++){
    accepted(send(w,q,'Revive',p.id));advance(w,.1);accepted(send(w,q,'CancelWork'));
  }
  assert.equal(p.lifeState,'DOWNED');near(p.downedHp,hp-2*40/60,'unheld attempts still bleed',1e-5);assert.equal(p.lockedBy,undefined);
});

test('teammate assistance replaces self rescue, excludes another rescuer, and command replay never resets progress',()=>{
  const {w,p,q,r}=fixture(3);at(w,r,10,11.5);knock(w,p);advance(w,8.01);accepted(selfRescue(w,p));advance(w,1,held(p.id));
  input(w,q,{interact:true});const message={type:'command',requestId:q.requestHighWater+1,command:'Revive',targetId:p.id,payload:{}};
  const result=accepted(w.command(q,message));assert.equal(p.work,null);assert.equal(p.lockedBy,q.id);assert.equal(rescue(w,r,p).ok,false);
  advance(w,1,held(q.id));const progress=q.work.progress;assert.deepEqual(w.command(q,message),result);near(q.work.progress,progress,'duplicate command does not restart work');
  assert.equal(selfRescue(w,p).ok,false,'cannot steal teammate lock');advance(w,5.01,held(q.id));assert.equal(p.lifeState,'ALIVE');assert.equal(p.hp,30);
});

for(const moved of ['rescuer','target'])test(`moving the ${moved} cancels assistance and releases its lock`,()=>{
  const {w,p,q}=fixture();knock(w,p);accepted(rescue(w,q,p));advance(w,1,held(q.id));
  advance(w,.4,who=>({interact:who===q,dx:who===(moved==='rescuer'?q:p)?1:0}));
  assert.equal(q.work,null);assert.equal(p.lockedBy,undefined);assert.equal(p.lifeState,'DOWNED');
});

for(const damaged of ['rescuer','target'])test(`a real hit on the ${damaged} interrupts assistance before it can complete`,()=>{
  const {w,p,q}=fixture();knock(w,p);advance(w,1.01);accepted(rescue(w,q,p));advance(w,1,held(q.id));
  hit(w,damaged==='rescuer'?q:p,1);advance(w,DT,held(q.id));assert.equal(q.work,null);assert.equal(p.lockedBy,undefined);assert.equal(p.lifeState,'DOWNED');
});

test('rescue rejects a closed gate and vertically separated bodies despite small horizontal distance',()=>{
  for(const boundary of ['gate','height']){
    const {w,p,q}=fixture();
    if(boundary==='gate'){at(w,p,1.5,4.8);at(w,q,1.5,7);w.s.buildings.G01.gateOpen=false;}
    else{at(w,q,p.x+1,p.z);q.y=p.y+10;}
    knock(w,p);assert.equal(rescue(w,q,p).ok,false,boundary);assert.equal(q.work,null);assert.equal(p.lockedBy,undefined);
  }
});

for(const targetFirst of [true,false])test(`finishing rescue and lethal damage in the same step favors death, target allocated ${targetFirst?'first':'last'}`,()=>{
  const {w,ps}=fixture(),p=ps[targetFirst?0:1],q=ps[targetFirst?1:0];knock(w,p);accepted(rescue(w,q,p));advance(w,6-DT,held(q.id));assert.equal(p.lifeState,'DOWNED');
  w.damageQueue.push({target:p.id,actorId:'synthetic-enemy',damage:100});advance(w,DT,held(q.id));
  assert.equal(p.lifeState,'DEAD_WAIT');assert.equal(p.hp,0);assert.equal(q.work,null);assert.equal(corpses(w,p).length,1);assert.equal(w.s.statistics.deaths,1);
});

test('all DEAD_WAIT or core loss still resolve defeat exactly once; DOWNED is not equivalent to dead',()=>{
  for(const reason of ['all_dead','core']){
    const {w,ps}=fixture();for(const p of ps)knock(w,p);advance(w,1.01);
    if(reason==='all_dead')for(const p of ps)hit(w,p,100);
    else w.damageQueue.push({target:'core',actorId:'synthetic-enemy',damage:100000});
    w.resolveDamage();w.resolveNight();assert.equal(w.s.phase,'RECOVERY');assert.equal(w.s.statistics.breaches,1);assert.equal(w.s.statistics.deaths,2);
    const saved=structuredClone({stats:w.s.statistics,ledger:w.s.resultLedger,items:w.s.items,containers:w.s.containers});
    w.resolveNight();w.resolveDamage();assert.deepEqual({stats:w.s.statistics,ledger:w.s.resultLedger,items:w.s.items,containers:w.s.containers},saved);
  }
});

test('target disconnect cancels assistance; blood and quiet countdown freeze without a reconnect refill',()=>{
  const {w,p,q}=fixture();knock(w,p);advance(w,1.01);accepted(rescue(w,q,p));advance(w,1,held(q.id));
  w.disconnect(p);advance(w,DT,held(q.id));assert.equal(q.work,null);assert.equal(p.lockedBy,undefined);
  const hp=p.downedHp,quiet=p.selfReviveReadyIn,grace=p.downedGraceRemaining,gear=possessions(w,p);
  advance(w,10);near(p.downedHp,hp,'offline blood');near(p.selfReviveReadyIn,quiet,'offline quiet wait');near(p.downedGraceRemaining,grace,'offline grace');
  w.connect(p,'合成返回');assert.equal(p.lifeState,'DOWNED');near(p.downedHp,hp,'returning blood');near(p.selfReviveReadyIn,quiet,'returning quiet wait');assert.equal(p.work,null);assert.equal(selfRescue(w,p).ok,false);assert.deepEqual(possessions(w,p),gear);
});

test('rescuer disconnect releases the target and natural bleeding resumes',()=>{
  const {w,p,q,r}=fixture(3);knock(w,p);accepted(rescue(w,q,p));advance(w,1,held(q.id));const hp=p.downedHp;
  w.disconnect(q);advance(w,1);assert.equal(q.work,null);assert.equal(p.lockedBy,undefined);assert(p.downedHp<hp-.6);assert.equal(r.lifeState,'ALIVE');
});

test('save restoration retains blood, remaining quiet time and gear but cancels both rescue endpoints',()=>{
  const {w,p,q}=fixture();knock(w,p);advance(w,1.01);hit(w,p,5);accepted(rescue(w,q,p));advance(w,2,held(q.id));
  const data=w.serialize(),expected=structuredClone({hp:p.downedHp,quiet:p.selfReviveReadyIn,rate:p.downedBleedRate,downs:p.downsThisDay,gear:possessions(w,p)});
  const restored=new SurvivalWorld(structuredClone(config),data,{onlineRoster:true}),a=restored.s.players[p.id],b=restored.s.players[q.id];restored.connect(a,'合成目标');restored.connect(b,'合成队友');
  assert.equal(a.lifeState,'DOWNED');near(a.downedHp,expected.hp,'saved blood');near(a.selfReviveReadyIn,expected.quiet,'saved quiet wait');near(a.downedBleedRate,expected.rate,'saved rate');assert.equal(a.downsThisDay,expected.downs);
  assert.equal(a.work,null);assert.equal(b.work,null);assert.equal(a.lockedBy,undefined);assert.deepEqual(possessions(restored,a),expected.gear);
  accepted(rescue(restored,b,a));advance(restored,5.9,held(b.id));assert.equal(a.lifeState,'DOWNED','old two seconds must not survive reload');advance(restored,.11,held(b.id));assert.equal(a.lifeState,'ALIVE');
});

test('releasing E cancels established rescue, and stale network input cannot hold the blood indefinitely',()=>{
  for(const loss of ['released','stale']){
    const {w,p,q}=fixture();knock(w,p);accepted(rescue(w,q,p));advance(w,1,held(q.id));
    const hp=p.downedHp;
    if(loss==='released')advance(w,.1);
    else for(let i=0;i<20;i++){input(w,p);w.step(DT);}
    assert.equal(q.work,null,loss);assert.equal(p.lockedBy,undefined,loss);assert(p.downedHp<hp,loss);
  }
});

test('old downed saves migrate their remaining lifetime without granting fresh blood or grace',()=>{
  const {w,p,q}=fixture();knock(w,p);const save=w.serialize(),legacy=save.players[p.id];
  legacy.downedRemaining=21;
  for(const field of ['downedHp','downedBleedRate','selfReviveReadyIn','downedGraceRemaining','downsThisDay','downsDayIndex'])delete legacy[field];
  const fresh=new SurvivalWorld(structuredClone(config),save,{onlineRoster:true}),target=fresh.s.players[p.id];fresh.connect(target,'合成旧记录');fresh.connect(fresh.s.players[q.id],'合成同伴');
  near(target.downedRemaining,21,'old remaining lifetime');near(target.downedHp,14,'old lifetime converted to blood');assert.equal(target.downedGraceRemaining,0);
  advance(fresh,20.99);assert.equal(target.lifeState,'DOWNED');advance(fresh,.02);assert.equal(target.lifeState,'DEAD_WAIT');
});

test('disconnect during the initial grace freezes the actual remaining grace rather than renewing it',()=>{
  const {w,p}=fixture();knock(w,p);advance(w,.2);w.disconnect(p);const hp=p.downedHp,grace=p.downedGraceRemaining,quiet=p.selfReviveReadyIn;
  advance(w,10);w.connect(p,'合成返回');near(p.downedHp,hp,'blood retained');near(p.downedGraceRemaining,grace,'not a new grace period');near(p.selfReviveReadyIn,quiet,'quiet time did not advance offline');
  advance(w,grace+.01);const before=p.downedHp;hit(w,p,2);near(p.downedHp,before-2,'expired original protection allows damage');
});

test('the rescue lifecycle also works during preparation, daylight and return',()=>{
  for(const phase of ['PREP','DAY','RETURN']){
    const {w,p,q}=fixture();w.setPhase(phase);knock(w,p);accepted(rescue(w,q,p));advance(w,6.01,held(q.id));assert.equal(p.lifeState,'ALIVE',phase);assert.equal(p.hp,30,phase);
  }
});

test('daytime DEAD_WAIT reconnect preserves its remaining respawn delay and stays empty until normal respawn',()=>{
  const {w,p}=fixture();w.setPhase('DAY');knock(w,p);advance(w,1.01);hit(w,p,100);assert.equal(p.lifeState,'DEAD_WAIT');
  advance(w,3);const remaining=p.respawnRemaining,gear=possessions(w,p);assert.equal(gear.length,0);w.disconnect(p);advance(w,5);w.connect(p,'合成返回');
  assert.equal(p.lifeState,'DEAD_WAIT');near(p.respawnRemaining,remaining,'reconnect does not skip death timer');advance(w,remaining-.01);assert.equal(p.lifeState,'DEAD_WAIT');advance(w,.02);assert.equal(p.lifeState,'ALIVE');assert.deepEqual(possessions(w,p),gear);assert.equal(corpses(w,p).length,1);
});

test('core destruction in the rescue completion step cannot publish a rescue success before defeat',()=>{
  const {w,p,q}=fixture();knock(w,p);accepted(rescue(w,q,p));advance(w,6-DT,held(q.id));w.drainEvents();
  w.damageQueue.push({target:'core',actorId:'synthetic-enemy',damage:100000});advance(w,DT,held(q.id));
  assert.equal(w.s.phase,'RECOVERY');assert.equal(w.s.statistics.breaches,1);assert.equal(w.s.statistics.deaths,2);
  const rescues=w.drainEvents().filter(e=>e.eventType==='LifeChanged'&&e.payload?.rescuerId);assert.equal(rescues.length,0,'emergency respawn is distinct from completed aid');
});

function runtimeFixture({state=null,save}={}){
  const members=[0,1].map(i=>({peerId:'downed-peer-'+i,accountId:'downed-account-'+i,name:'合成运行时'+i,ready:true}));
  const room={id:'downed-room',epoch:1,ownerId:members[0].accountId,hostPeerId:members[0].peerId,status:'running',members};
  const saves=[],packets=[];const r=new RoomRuntime({config:structuredClone(config),state,room,now:()=>0,send:(peerId,json)=>packets.push({peerId,value:JSON.parse(json)}),save:save??(async value=>{saves.push(structuredClone(value));return {revision:saves.length};})});
  for(const m of members)r.receive(m.peerId,{type:'hello'});const ps=members.map(m=>r.world.s.players[r.sessions.get(m.peerId).playerId]);
  if(!state)arena(r.world,ps);return {r,ps,saves,packets,members};
}

test('RoomRuntime save failure freezes blood; exact save retry and cold reopen retain the same downed player',async()=>{
  let fail=true;const saves=[];const f=runtimeFixture({save:async state=>{if(fail)throw Error('synthetic in-memory persistence fault');saves.push(structuredClone(state));return {revision:saves.length};}}),p=f.ps[0];
  knock(f.r.world,p);advance(f.r.world,2);const hp=p.downedHp,quiet=p.selfReviveReadyIn,gear=possessions(f.r.world,p);
  await assert.rejects(f.r.save(),/synthetic/);assert.equal(f.r.saveFault,true);f.r.step(.25);near(p.downedHp,hp,'save failure pauses bleeding');near(p.selfReviveReadyIn,quiet,'save failure pauses quiet timer');
  fail=false;await f.r.save();assert.equal(f.r.saveFault,false);assert.equal(saves.length,1);assert.equal(saves[0].players[p.id].lifeState,'DOWNED');
  const reopened=runtimeFixture({state:saves[0]}),q=reopened.ps[0];near(q.downedHp,hp,'runtime cold load blood');near(q.selfReviveReadyIn,quiet,'runtime cold load quiet');assert.deepEqual(possessions(reopened.r.world,q),gear);
});

test('RoomRuntime save cannot prematurely defeat an all-downed room and persists final death only once',async()=>{
  const f=runtimeFixture();for(const p of f.ps)knock(f.r.world,p);await f.r.save();assert.equal(f.r.world.s.phase,'NIGHT');assert.equal(f.saves[0].statistics.deaths,0);
  advance(f.r.world,1.01);for(const p of f.ps)f.r.world.damageQueue.push({target:p.id,actorId:'synthetic-enemy',damage:100});
  await f.r.save();assert.equal(f.r.world.s.phase,'RECOVERY');assert.equal(f.saves.at(-1).statistics.deaths,2);const items=Object.keys(f.saves.at(-1).items).sort();
  await f.r.save();assert.equal(f.saves.at(-1).statistics.deaths,2);assert.deepEqual(Object.keys(f.saves.at(-1).items).sort(),items);
});

function restoreDelta(previous,message){
  const state=structuredClone(previous);for(const key of message.removedKeys??[])delete state[key];Object.assign(state,structuredClone(message.changes));
  for(const [collection,ops]of Object.entries(message.entities)){
    const byId=new Map(state[collection].map(e=>[e.id,e]));for(const id of ops.remove??[])byId.delete(id);for(const e of ops.upsert??[])byId.set(e.id,structuredClone(e));
    for(const patch of ops.patch??[]){const e=byId.get(patch.id);assert(e);for(const key of patch.unset??[])delete e[key];Object.assign(e,structuredClone(patch.set));}state[collection]=[...byId.values()];
  }
  state.snapshotId=message.snapshotId;return state;
}

test('public full and per-connection delta states agree through down/crawl/rescue/death; private locks never leak',()=>{
  const {w,p,q}=fixture();let frame=compileState(w.publicState()),wire=JSON.parse(fullEnvelope(frame,1)),sequence=1;
  const check=()=>{const next=compileState(w.publicState()),delta=JSON.parse(deltaEnvelope(diffState(frame,next).body,++sequence,sequence-1));wire=restoreDelta(wire,delta);assert.deepEqual(wire,JSON.parse(fullEnvelope(next,sequence)));const a=wire.players.find(e=>e.id===p.id);assert.equal(a.lifeState,p.lifeState);if(p.lifeState==='DOWNED'){assert(Number.isFinite(a.downedHp));assert(Number.isFinite(a.downedRemaining));}for(const member of wire.players){assert(!Object.hasOwn(member,'lockedBy'));assert(!Object.hasOwn(member,'tokenHash'));if(member.work){assert(!Object.hasOwn(member.work,'startHitSeq'));assert(!Object.hasOwn(member.work,'targetHitSeq'));}}frame=next;};
  knock(w,p);check();advance(w,.3,who=>who===p?{dx:1}:{});check();accepted(rescue(w,q,p));advance(w,2,held(q.id));check();advance(w,4.01,held(q.id));assert.equal(p.lifeState,'ALIVE');check();knock(w,p);advance(w,1.01);hit(w,p,100);check();assert.equal(p.lifeState,'DEAD_WAIT');
});
