// Synthetic in-memory rules only. No network, account store, service or GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {loadConfig} from '../config.mjs';
import {SurvivalWorld} from '../world.mjs';
const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
const addedIds=['upgrade','recycle','emergency_upgrade','emergency_recycle'];
function fixture(count=1,phase='PREP'){
 const w=new SurvivalWorld(structuredClone(config),null,{onlineRoster:true});if(phase!=='PREP')w.setPhase(phase);
 const ps=[];for(let i=0;i<count;i++){const p=w.allocate('隔离测试员','synthetic-only-'+i);w.connect(p,p.name);ps.push(p);}
 w.s.bank.credits=1000;w.s.bank.materials=100;return {w,ps,p:ps[0]};
}
function station(w,id){const t=w.staticWorld().terminals.find(x=>x.id===id);assert(t,id);return t;}
function at(p,t){Object.assign(p,{x:t.x,y:t.y,z:t.z+1.2,swimming:false});}
const send=(w,p,command,payload={},targetId,requestId=p.requestHighWater+1)=>w.command(p,{command,payload,targetId,requestId});
const ledger=w=>structuredClone({items:w.s.items,containers:w.s.containers,bank:w.s.bank});
function denied(w,p,cmd,payload={},id){const before=ledger(w),r=send(w,p,cmd,payload,id);assert.equal(r.ok,false,cmd);assert.deepEqual(ledger(w),before,cmd+' mutated resources');return r;}
function withoutPosition(c){const {x,y,z,revision,...rest}=c;return rest;}

test('ten stationary endpoints keep five distinct capabilities and one existing shared inventory',()=>{
 const {w}=fixture();const ts=w.staticWorld().terminals;assert.equal(ts.length,10);assert.equal(new Set(ts.map(t=>t.id)).size,10);
 for(const type of ['shop','storage','upgrade','recycle','craft'])assert.equal(ts.filter(t=>t.type===type).length,2);
 for(const t of ts){assert.equal(t.y,w.ground(t.x,t.z));assert(Math.abs(w.boxes().find(b=>b.id===t.id).x1-t.x-.825)<1e-10);}
 assert(ts.filter(t=>t.type==='storage').every(t=>t.containerId==='storage'));assert.equal(w.s.containers.storage.slotLimit,32);
 assert(!Object.hasOwn(w.serialize(),'terminals'));assert(!Object.hasOwn(w.serialize(),'world'));
});

test('layout validation rejects lost capabilities, invalid identities, positions and storage links',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'station-config-review-'));t.after(()=>rm(directory,{recursive:true,force:true}));const filename=path.join(directory,'synthetic-config.json');
 for(const mutate of [c=>{delete c.level.terminals[0].id;},c=>{c.level.terminals[0].id='';},c=>{c.level.terminals[0].id='storage';},c=>{c.level.terminals[0].type='upgrade';},c=>{c.level.terminals[1].containerId='another-storage';},c=>{c.level.terminals[4].x=null;},c=>{c.level.terminals[4].label='';},c=>{c.level.terminals.pop();}]){
  const bad=structuredClone(config);mutate(bad);await writeFile(filename,JSON.stringify(bad));await assert.rejects(loadConfig(filename),/Invalid station layout/);
 }
 await writeFile(filename,JSON.stringify(config));assert.deepEqual((await loadConfig(filename)).level.terminals,config.level.terminals);
});

for(const id of ['terminal','emergency_tools'])test(id+' buys/loans but cannot recycle, upgrade or access a cabinet',()=>{
 const {w,p}=fixture();const t=station(w,id);at(p,t);w.addItems(w.bag(p),'scrap',3);const scrap=w.bag(p).itemIds.find(i=>w.s.items[i].definitionId==='scrap');
 assert(send(w,p,'Buy',{stationId:id,definitionId:'bandage'}).ok);
 denied(w,p,'Deposit',{stationId:id});denied(w,p,'Upgrade',{stationId:id},w.equipped(p,'weapon').id);denied(w,p,'Transfer',{stationId:id,itemId:scrap,toContainerId:'storage'});
 w.removeItem(w.equipped(p,'rod'));assert(send(w,p,'ClaimTool',{stationId:id,definitionId:'rod_basic'}).ok);assert.equal(w.equipped(p,'rod').loanOwnerSlotId,p.slotId);
});

for(const id of ['recycle','emergency_recycle'])test(id+' deposits exact proceeds once and rejects other station jobs',()=>{
 const {w,p}=fixture();at(p,station(w,id));w.addItems(w.bag(p),'catch_shore',2);w.addItems(w.bag(p),'scrap',3);const start=ledger(w),gun=w.equipped(p,'weapon');
 for(const cmd of ['Buy','ClaimTool'])denied(w,p,cmd,{stationId:id,definitionId:cmd==='Buy'?'bandage':'rod_basic'});denied(w,p,'Upgrade',{stationId:id},gun.id);
 const req=p.requestHighWater+1;assert(send(w,p,'Deposit',{stationId:id},null,req).ok);assert.equal(w.s.bank.credits,start.bank.credits+16);assert.equal(w.s.bank.materials,start.bank.materials);assert.equal(w.count(p,'scrap'),3);assert.equal(w.count(p,'catch_shore'),0);
 const after=ledger(w);assert(send(w,p,'Deposit',{stationId:id},null,req).ok);assert.deepEqual(ledger(w),after);assert.equal(w.equipped(p,'weapon').id,gun.id);
});

test('weapon work remains bound to the exact upgrade station through completion/cancellation',()=>{
 for(const id of ['upgrade','emergency_upgrade'])for(const ending of ['complete','leave','night','damage']){
  const {w,p}=fixture();w.addItems(w.bag(p),'field_core',1);at(p,station(w,id));const gun=w.equipped(p,'weapon'),before=ledger(w);assert(send(w,p,'Upgrade',{stationId:id},gun.id).ok);p.input.interact=true;
  assert.equal(p.work.stationId,id);assert.equal(w.s.bank.reservedCredits,config.weapon_upgrade.cost_c);
  if(ending==='leave')p.x+=3;if(ending==='night')w.s.phase='NIGHT';if(ending==='damage')p.damageAt=w.s.time+1;
  w.updateWork(p,config.construction.upgrade_seconds+.1);assert.equal(p.work,null);assert.equal(w.s.bank.reservedCredits,0);assert.equal(w.s.bank.reservedMaterials,0);assert.equal(gun.level,ending==='complete'?2:1);
  assert.equal(w.s.bank.credits,before.bank.credits-(ending==='complete'?config.weapon_upgrade.cost_c:0));assert.equal(w.s.bank.materials,before.bank.materials-(ending==='complete'?config.weapon_upgrade.cost_m:0));
 }
});

test('forged station/foreign weapon, death and swimming reject without resources changing',()=>{
 const {w,p,ps}=fixture(2);at(p,station(w,'upgrade'));const gun=w.equipped(p,'weapon');
 for(const id of ['terminal','storage','recycle','emergency_upgrade','missing'])denied(w,p,'Upgrade',{stationId:id},gun.id);
 denied(w,p,'Upgrade',{stationId:'upgrade'},w.equipped(ps[1],'weapon').id);
 p.lifeState='DOWNED';denied(w,p,'Upgrade',{stationId:'upgrade'},gun.id);p.lifeState='ALIVE';p.swimming=true;denied(w,p,'Upgrade',{stationId:'upgrade'},gun.id);
});

test('two customers cannot overspend or take the same shared equipment across two cabinets',()=>{
 const {w,ps}=fixture(2);ps.forEach(p=>at(p,station(w,'terminal')));w.s.bank.credits=8;
 assert(send(w,ps[0],'Buy',{stationId:'terminal',definitionId:'bandage'}).ok);denied(w,ps[1],'Buy',{stationId:'terminal',definitionId:'bandage'});assert.equal(w.s.bank.credits,0);
 const item=w.createItem('rifle',1,w.s.containers.storage);at(ps[0],station(w,'storage'));at(ps[1],station(w,'emergency_storage'));
 assert(send(w,ps[0],'Transfer',{stationId:'storage',itemId:item.id,toContainerId:ps[0].backpackId}).ok);denied(w,ps[1],'Transfer',{stationId:'emergency_storage',itemId:item.id,toContainerId:ps[1].backpackId});assert.equal(item.containerId,ps[0].backpackId);w.assertInvariants();
});

test('two upgrade stations share one reservation budget without duplicate deductions',()=>{
 const {w,ps}=fixture(2);at(ps[0],station(w,'upgrade'));at(ps[1],station(w,'emergency_upgrade'));
 for(const p of ps)w.addItems(w.bag(p),'field_core',1);w.s.bank.credits=config.weapon_upgrade.cost_c;w.s.bank.materials=config.weapon_upgrade.cost_m;
 assert(send(w,ps[0],'Upgrade',{stationId:'upgrade'},w.equipped(ps[0],'weapon').id).ok);
 denied(w,ps[1],'Upgrade',{stationId:'emergency_upgrade'},w.equipped(ps[1],'weapon').id);
 ps[0].input.interact=true;w.updateWork(ps[0],config.construction.upgrade_seconds+.1);
 assert.equal(w.s.bank.credits,0);assert.equal(w.s.bank.materials,0);assert.equal(w.s.bank.reservedCredits,0);assert.equal(w.s.bank.reservedMaterials,0);
 assert.equal(w.equipped(ps[0],'weapon').level,2);assert.equal(w.equipped(ps[1],'weapon').level,1);w.assertInvariants();
});

test('recovery cash is still recoverable at its field box and cannot be repeated',()=>{
 const {w,p}=fixture();Object.assign(p,{x:20,z:20,y:w.ground(20,20)});const c=w.createContainer('recovery',1,{x:p.x,y:p.y,z:p.z,recoverableC:17,recoverableM:23});
 assert(send(w,p,'Deposit',{},c.id).ok);assert.equal(w.s.bank.credits,1017);assert.equal(w.s.bank.materials,123);denied(w,p,'Deposit',{},c.id);
});

test('old ground boxes relocate once with IDs, contents, recovery cash and ledger references conserved',()=>{
 const {w,p}=fixture();const boxes=[];
 for(const [i,id]of addedIds.entries()){
  const t=station(w,id),box=w.createContainer(i%2?'recovery':'loot',4,{x:t.x,y:t.y,z:t.z,createdDay:1,expiresAfterDay:3,...(i%2?{recoverableC:17,recoverableM:23}:{})});
  w.createItem(i%2?'rifle':'scrap',i%2?1:7,box);boxes.push(box);
 }
 w.s.nodes['reference-node']={id:'reference-node',type:'salvage',state:'depleted',x:62,y:1,z:38,containerId:boxes[0].id,revision:7};
 w.createItem('bandage',3,w.s.containers.storage);const old=w.serialize(),before=ledger(w),restored=new SurvivalWorld(config,old,{onlineRoster:true});
 assert.deepEqual(restored.s.items,before.items);assert.deepEqual(restored.s.bank,before.bank);assert.deepEqual(restored.s.containers.storage,before.containers.storage);assert.equal(restored.s.nodes['reference-node'].containerId,boxes[0].id);
 for(const box of boxes){const moved=restored.s.containers[box.id];assert.deepEqual(withoutPosition(moved),withoutPosition(box));assert.equal(moved.revision,box.revision+1);assert(!restored.blocked(moved.x,moved.y,moved.z,.4));assert.notDeepEqual([moved.x,moved.z],[box.x,box.z]);}
 const twice=new SurvivalWorld(config,restored.serialize(),{onlineRoster:true});assert.deepEqual(twice.s.containers,restored.s.containers);assert.deepEqual(twice.s.items,restored.s.items);assert.deepEqual(twice.s.bank,restored.s.bank);assert.equal(twice.s.players[p.id].connected,false);
});

test('eight real allocations in every playable phase avoid terminal bodies and one another',()=>{
 for(const phase of ['PREP','DAY','RETURN','NIGHT','RECOVERY']){
  const {w,ps}=fixture(8,phase);for(const p of ps){assert(!w.blocked(p.x,p.y,p.z,config.player.capsule_radius),phase);assert(w.s.waterY-p.y<=.6);for(const q of ps)if(p.id!==q.id)assert(Math.hypot(p.x-q.x,p.z-q.z)>=1);}
  assert.equal(w.publicState().players.filter(p=>p.connected).length,8);w.assertInvariants();
 }
});

test('legacy player at a new station remains offline until connect then exits collision with equipment retained',()=>{
 const {w,p}=fixture();const t=station(w,'upgrade');Object.assign(p,{x:t.x,y:t.y,z:t.z});const old=w.serialize(),restored=new SurvivalWorld(config,old,{onlineRoster:true}),q=restored.s.players[p.id];
 assert.deepEqual([q.x,q.y,q.z],[p.x,p.y,p.z]);assert.deepEqual(restored.s.items,old.items);restored.connect(q,q.name);assert(!restored.blocked(q.x,q.y,q.z,config.player.capsule_radius));assert.deepEqual(restored.s.items,old.items);assert.deepEqual(q.equipment,p.equipment);
});

test('legacy live enemy at a newly occupied station is not left embedded in permanent geometry',()=>{
 const {w,p}=fixture(1,'NIGHT');const t=station(w,'upgrade'),e=w.spawnEnemy('crab',t.x,t.z,true);e.hp=37;
 // This was a valid position before the four new static colliders were added.
 const oldBoxes=w.boxes().filter(b=>!addedIds.includes(b.id));assert(!oldBoxes.some(b=>e.x>b.x0-.35&&e.x<b.x1+.35&&e.z>b.z0-.35&&e.z<b.z1+.35&&e.y<b.y1));
 const old=w.serialize(),restored=new SurvivalWorld(config,old,{onlineRoster:true});restored.connect(restored.s.players[p.id],p.name);
 const enemy=restored.s.enemies[e.id];assert(enemy);assert.equal(enemy.hp,37);assert(!restored.blocked(enemy.x,enemy.y,enemy.z,enemy.radius), 'legacy enemy overlaps a newly added terminal');
});

test('station migration cancels only displaced attack execution while preserving night windows and rewards',()=>{
 for(const state of ['WINDUP','CHARGE','burrow_windup']){
  const {w,p}=fixture(1,'NIGHT');w.s.time=100;const t=station(w,'upgrade'),e=w.spawnEnemy('crab',t.x,t.z,true);e.hp=37;
  Object.assign(e,{state,phaseRemaining:.2,attackIndex:11,targetId:p.id,lockX:p.x,lockY:p.y+1,lockZ:p.z,chargeRemaining:5,chargeHit:[p.id],attackZone:{shape:'circle',x:e.x,y:e.y,z:e.z,radius:3},rescuePosition:{x:3,y:5,z:3},hitVelocity:{x:2,z:1}});
  w.s.enemyAggro[e.id]={damage:{[p.id]:{value:12,at:99}},targetId:p.id,engagement:{x:e.x,z:e.z,until:103},routeUntil:99,switchAt:98,seenAt:99,seenX:p.x,seenZ:p.z,scanAt:100.1};
  const unaffected=w.spawnEnemy('eel',20,20,true);Object.assign(unaffected,{state:'WINDUP',phaseRemaining:1.2,lockX:24,lockY:2,lockZ:20,attackIndex:6});
  const old=w.serialize(),restored=new SurvivalWorld(config,old,{onlineRoster:true}),moved=restored.s.enemies[e.id],memory=restored.s.enemyAggro[e.id];
  assert(!restored.blocked(moved.x,moved.y,moved.z,moved.radius));assert.equal(moved.hp,37);assert.equal(moved.id,e.id);assert.equal(moved.source,e.source);assert.equal(moved.attackIndex,11);
  assert.equal(moved.state,'RECOVER');assert(moved.phaseRemaining>=.5);assert.equal(moved.targetId,null);assert.equal(moved.attackZone,null);assert.equal(moved.chargeRemaining,0);assert.deepEqual(moved.chargeHit,[]);assert(!moved.rescuePosition);assert(!moved.hitVelocity);
  assert(!restored.blocked(moved.homeX,restored.ground(moved.homeX,moved.homeZ),moved.homeZ,moved.radius));
  assert.deepEqual(memory.damage,old.enemyAggro[e.id].damage);assert.deepEqual(memory.engagement,old.enemyAggro[e.id].engagement);assert.equal(memory.routeUntil,99);assert.equal(memory.switchAt,98);assert.equal(memory.targetId,null);
  assert.deepEqual(restored.s.enemies[unaffected.id],old.enemies[unaffected.id]);assert.deepEqual(restored.s.statistics,old.statistics);assert.deepEqual(restored.s.resultLedger,old.resultLedger);assert.deepEqual(restored.s.items,old.items);assert.deepEqual(restored.s.bank,old.bank);
  const twice=new SurvivalWorld(config,restored.serialize(),{onlineRoster:true});assert.deepEqual(twice.s.enemies,restored.s.enemies);assert.deepEqual(twice.s.enemyAggro,restored.s.enemyAggro);assert.equal(restored.damageQueue.length,0);
 }
});

test('station migration retains stun/recovery/weak windows and does not move an already safe home',()=>{
 for(const state of ['STUNNED','RECOVER','WEAK']){
  const {w}=fixture(1,'NIGHT'),t=station(w,'emergency_recycle'),e=w.spawnEnemy('crab',t.x,t.z,true);
  Object.assign(e,{state,phaseRemaining:1.75,weak:state==='WEAK',homeX:-22,homeZ:20,hp:29});
  w.s.enemyAggro[e.id]={damage:{},returning:true,targetId:null,switchAt:-100,routeUntil:0,scanAt:0,seenAt:-100};
  assert(!w.blocked(e.homeX,w.ground(e.homeX,e.homeZ),e.homeZ,e.radius));
  const restored=new SurvivalWorld(config,w.serialize(),{onlineRoster:true}),moved=restored.s.enemies[e.id];
  assert(!restored.blocked(moved.x,moved.y,moved.z,moved.radius));assert.equal(moved.hp,29);assert.equal(moved.state,state);assert.equal(moved.phaseRemaining,1.75);assert.equal(moved.weak,state==='WEAK');
  assert.deepEqual([moved.homeX,moved.homeZ],[-22,20]);assert.equal(restored.s.enemyAggro[e.id].returning,true);
 }
});
