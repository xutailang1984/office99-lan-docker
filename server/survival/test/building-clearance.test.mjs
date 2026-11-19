import test from 'node:test';
import assert from 'node:assert/strict';
import {SurvivalWorld} from '../world.mjs';
import {loadConfig} from '../config.mjs';
const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
function fixture(count=1){const w=new SurvivalWorld(config,null,{onlineRoster:true}),players=Array.from({length:count},(_,i)=>w.allocate('合成角色'+i,'synthetic-'+i));w.setPhase('DAY');return {w,players};}
function at(w,p,x,z){Object.assign(p,{x,z,y:w.ground(x,z),vy:0});}
function step(w,seconds,holding=[]){for(let i=0;i<Math.ceil(seconds*30);i++){for(const p of Object.values(w.s.players))if(p.connected)w.input(p,{seq:p.inputAck+1,dx:0,dz:0,interact:holding.includes(p.id)});w.step(1/30);}}
function assertClear(w,players){for(const p of players)assert.equal(w.blocked(p.x,p.y,p.z,w.c.player.capsule_radius)?.id,undefined,'player '+p.id+' remains in a collider');for(let i=0;i<players.length;i++)for(let j=0;j<i;j++)assert(Math.hypot(players[i].x-players[j].x,players[i].z-players[j].z)>=w.c.player.capsule_radius*2+.07);}
function recover(w){w.setPhase('RECOVERY');w.s.buildings.core.hp=0;w.s.recovery={coreReady:false,duration:420,destroyedSockets:[],debris:[]};}

test('eight overlapping builders are moved to distinct nearby safe points, then normal movement works; items conserved',()=>{
 const {w,players}=fixture(8);recover(w);players.forEach((p,i)=>at(w,p,(i%3-1)*.7,(Math.floor(i/3)-1)*.7));const items=structuredClone(w.s.items),bank=structuredClone(w.s.bank);
 assert.equal(w.command(players[0],{requestId:1,command:'RecoveryWork',targetId:'core'}).ok,true);step(w,8.1,[players[0].id]);assert.equal(w.s.buildings.core.hp,1500);assertClear(w,players);assert.deepEqual(w.s.items,items);assert.equal(w.s.bank.credits,bank.credits);assert.equal(w.s.bank.materials,bank.materials);assert.equal(w.s.bank.reservedCredits,0);
 const p=players[0],before={x:p.x,z:p.z},dx=p.x>=0?1:-1;for(let i=0;i<30;i++){w.input(p,{seq:p.inputAck+1,dx,dz:0});w.step(1/30);}assert(Math.hypot(p.x-before.x,p.z-before.z)>.1);w.assertInvariants();
});

test('moving another worker and online downed teammate preserves reservations, ammo and downed/dead state',()=>{
 const {w,players:[builder,worker,downed,dead]}=fixture(4);recover(w);for(const [i,p]of [builder,worker,downed,dead].entries())at(w,p,.2*i,.2*i);
 w.enterDowned(downed);downed.downedHp=40*downed.downedBleedRate;downed.downedRemaining=40;downed.connected=true;downed.disconnectedAt=null;dead.lifeState='DEAD_WAIT';dead.hp=0;dead.connected=false;dead.respawnRemaining=0;
 const corpsePosition={x:dead.x,y:dead.y,z:dead.z};const gun=w.equipped(worker,'weapon');w.beginWork(worker,{kind:'Upgrade',targetId:gun.id,duration:90,costC:20,costM:2});worker.reload={itemId:gun.id,remaining:90,loaded:0};
 const items=structuredClone(w.s.items),credits=w.s.bank.credits,materials=w.s.bank.materials;delete items[gun.id].lockedBy; // cancellation must release this transient reservation lock
 assert(w.command(builder,{requestId:1,command:'RecoveryWork',targetId:'core'}).ok);step(w,8.1,[builder.id,worker.id]);
 assertClear(w,[builder,worker,downed]);assert.equal(worker.work,null);assert.equal(worker.reload,null);assert.equal(w.s.bank.reservedCredits,0);assert.equal(w.s.bank.reservedMaterials,0);assert.equal(w.s.bank.credits,credits);assert.equal(w.s.bank.materials,materials);assert.deepEqual(w.s.items,items);assert.equal(downed.lifeState,'DOWNED');assert.equal(downed.hp,0);assert(downed.downedRemaining<40&&downed.downedRemaining>30);assert.equal(dead.lifeState,'DEAD_WAIT');assert.deepEqual({x:dead.x,y:dead.y,z:dead.z},corpsePosition);w.assertInvariants();
});

test('wall reconstruction and gate closing safely displace other players without crossing unrelated walls',()=>{
 const {w,players:[builder,other]}=fixture(2),wall=Object.values(w.s.buildings).find(b=>b.definitionId==='wall');wall.hp=0;at(w,builder,wall.x,wall.z);at(w,other,wall.x+.4,wall.z);
 const material=w.s.bank.materials;assert(w.command(builder,{requestId:1,command:'Rebuild',targetId:wall.id}).ok);step(w,w.c.construction.rebuild_seconds+.1,[builder.id]);assert(wall.hp>0);assertClear(w,[builder,other]);assert.equal(w.s.bank.materials,material-w.c.construction.rebuild_m);
 const gate=w.s.buildings.G01;gate.gateOpen=true;at(w,builder,gate.x,gate.z-1.6);at(w,other,gate.x,gate.z);assert(w.command(builder,{requestId:2,command:'ToggleGate',targetId:gate.id}).ok);assert.equal(gate.gateOpen,false);assertClear(w,[builder,other]);const event=w.drainEvents().filter(e=>e.eventType==='PositionCorrected').at(-1);assert.equal(event.payload.actorId,other.id);w.assertInvariants();
});

test('turret installation and paid rebuild use real collision and preserve ammunition/cost rules',()=>{
 const {w,players:[p,q]}=fixture(2);w.s.buildings.core.level=2;w.s.statistics.daysSurvived=2;w.s.bank.credits=500;w.s.bank.materials=200;const t=w.s.turrets.T01;at(w,p,t.x,t.z);at(w,q,t.x+.2,t.z+.1);
 assert(w.command(p,{requestId:1,command:'InstallTurret',targetId:t.id}).ok);step(w,6.1,[p.id]);assertClear(w,[p,q]);assert.equal(t.level,1);assert.equal(t.ammo,60);assert.equal(w.s.bank.credits,340);assert.equal(w.s.bank.materials,170);
 t.hp=0;t.ammo=0;at(w,p,t.x,t.z);at(w,q,t.x+.2,t.z+.1);assert(w.command(p,{requestId:2,command:'InstallTurret',targetId:t.id}).ok);step(w,6.1,[p.id]);assertClear(w,[p,q]);assert.equal(t.ammo,0);assert.equal(w.s.bank.credits,260);assert.equal(w.s.bank.materials,150);w.assertInvariants();
});

test('automatic recovery minimum core and gate restoration also clear occupants',()=>{
 const {w,players:[p,q]}=fixture(2);recover(w);at(w,p,0,0);const gate=w.s.buildings.G01;gate.hp=0;at(w,q,gate.x+1.35,gate.z);w.finishRecovery();assert.equal(w.s.phase,'RETURN');assert.equal(w.s.buildings.core.hp,375);assert.equal(gate.gateOpen,true);assert(gate.hp>0);assertClear(w,[p,q]);
});

test('saved offline positions stay frozen until reconnect safely clears them without changing identities or gear',()=>{
 const {w,players:[p,q]}=fixture(2);at(w,p,1.2,1.2);at(w,q,-1.2,-1.2);q.connected=false;q.disconnectedAt=null;const saved=w.serialize(),items=structuredClone(saved.items);const restored=new SurvivalWorld(config,saved,{onlineRoster:true});assert.deepEqual(restored.s.items,items);assert.equal(restored.s.time,saved.time);
 for(const original of [p,q]){const kept=restored.s.players[original.id];assert.equal(kept.connected,false);assert.deepEqual({x:kept.x,y:kept.y,z:kept.z},{x:original.x,y:original.y,z:original.z});}
 const host=restored.s.players[p.id];restored.connect(host,'合成房主');assertClear(restored,[host]);
 const offline=restored.s.players[q.id];const oldToken=offline.tokenHash;restored.connect(offline,'同一合成角色');assert.equal(offline.tokenHash,oldToken);assertClear(restored,[host,offline]);assert.deepEqual(restored.s.items,items);restored.assertInvariants();
});

test('unsafe activation is rejected before charging when a separate sealed obstacle leaves no escape route',()=>{
 const {w,players:[p]}=fixture();w.s.buildings.core.level=2;w.s.statistics.daysSurvived=2;w.s.bank.credits=500;w.s.bank.materials=200;const t=w.s.turrets.T01;at(w,p,t.x,t.z);w.boxes();
 for(const sign of [-1,1]){w.staticBoxes.push({id:'sealed-x'+sign,x0:t.x+sign*.6-.1,x1:t.x+sign*.6+.1,z0:t.z-1,z1:t.z+1,y0:p.y,y1:p.y+3});w.staticBoxes.push({id:'sealed-z'+sign,x0:t.x-1,x1:t.x+1,z0:t.z+sign*.6-.1,z1:t.z+sign*.6+.1,y0:p.y,y1:p.y+3});}
 assert.equal(w.blocked(p.x,p.y,p.z)?.id,undefined);const before={x:p.x,z:p.z,credits:w.s.bank.credits,materials:w.s.bank.materials};assert(w.command(p,{requestId:1,command:'InstallTurret',targetId:t.id}).ok);step(w,6.1,[p.id]);assert.equal(t.hp,0);assert.equal(t.level,0);assert.equal(w.s.bank.credits,before.credits);assert.equal(w.s.bank.materials,before.materials);assert.equal(w.s.bank.reservedCredits,0);assert.equal(w.s.bank.reservedMaterials,0);assert.equal(p.x,before.x);assert.equal(p.z,before.z);assert(w.drainEvents().some(e=>e.eventType==='Notice'&&e.payload.code==='CLEAR_BUILDING_SPACE'));w.assertInvariants();
});
