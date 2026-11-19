import test from 'node:test';
import assert from 'node:assert/strict';
import {SurvivalWorld} from '../world.mjs';
import {compileState,diffState} from '../state-wire.mjs';
import {fixture,command,advance,enemy,put,restored} from './director-helpers.mjs';

// Synthetic in-memory worlds only. No sockets, persistent saves or production identities.
const toolIds=['coffee_flask','repair_kit','flash_note','decoy_alarm'];
function carried(w,p,id) {return w.bag(p).itemIds.map(key=>w.s.items[key]).find(item=>item.definitionId===id);}
function grant(w,p,id,quantity=1) {w.addItems(w.bag(p),id,quantity);return carried(w,p,id);}
function inventory(w) {
  return structuredClone({items:w.s.items,containers:w.s.containers,bank:w.s.bank});
}
function totals(w) {
  const counts={};for(const item of Object.values(w.s.items))counts[item.definitionId]=(counts[item.definitionId]??0)+item.quantity;return counts;
}
function accepted(result,reason='command must be accepted') {assert.equal(result.ok,true,`${reason}: ${result.code??'unknown error'}`);return result;}
function bind(w,p,item) {accepted(command(w,p,'BindQuick',{itemId:item?.id??null}),'bind quick item');}
function select(w,p,item) {
  bind(w,p,item);accepted(command(w,p,'SwitchEquip',{slot:'quick'}),'select fourth slot');
  advance(w,Math.max(0,p.equipUntil-w.s.time)+.01);
}
function rejectedWithoutLoss(w,p,name,payload={}) {
  const before=inventory(w),result=command(w,p,name,payload);assert.equal(result.ok,false,`${name} must be rejected`);assert.deepEqual(inventory(w),before,'rejected action must not move, consume or create inventory/currency');return result;
}

test('binding a carried tool or bandage is a reference, preserving items, capacity and currency',()=>{
  for(const id of [...toolIds,'bandage']){
    const {w,p}=fixture(),item=id==='bandage'?carried(w,p,id):grant(w,p,id,2),before=inventory(w),equipment={...p.equipment};
    bind(w,p,item);
    assert.equal(p.quickItemDefinitionId,id);
    assert.equal(w.equipped(p,'quick')?.id,item.id);
    assert.equal(item.containerId,p.backpackId);
    assert.deepEqual(p.equipment,equipment,'quick binding must not alias backpack as an equipment container');
    assert.deepEqual(inventory(w),before);
    bind(w,p,null);
    assert.equal(p.quickItemDefinitionId,null);
    assert.equal(Boolean(w.equipped(p,'quick')),false);
    assert.deepEqual(inventory(w),before);
    w.assertInvariants();
  }
});

test('binding rejects non-tools, equipped weapons, foreign inventory, storage, missing and locked items',()=>{
  for(const source of ['ammo','scrap','fish','equipped','foreign','storage','missing','locked']){
    const {w,p,ps}=fixture(2),valid=grant(w,p,'coffee_flask');bind(w,p,valid);let candidate;
    if(source==='ammo')candidate=carried(w,p,'ammo_light');
    if(source==='scrap')candidate=grant(w,p,'scrap');
    if(source==='fish')candidate=grant(w,p,'catch_silver');
    if(source==='equipped')candidate=w.equipped(p,'weapon');
    if(source==='foreign')candidate=grant(w,ps[1],'repair_kit');
    if(source==='storage')candidate=w.createItem('repair_kit',1,w.s.containers.storage);
    if(source==='locked'){candidate=grant(w,p,'repair_kit');candidate.lockedBy=ps[1].id;}
    const before=inventory(w),result=command(w,p,'BindQuick',{itemId:candidate?.id??'missing-fixture-item'});
    assert.equal(result.ok,false,source);assert.equal(p.quickItemDefinitionId,'coffee_flask',source);
    assert.deepEqual(inventory(w),before,source);w.assertInvariants();
  }
});

test('4 selects without consumption; equip transition blocks use and public full/delta states reveal the selected tool',()=>{
  const {w,p}=fixture(),item=grant(w,p,'coffee_flask',2);p.stamina=20;bind(w,p,item);
  const baseline=compileState(w.publicState()),before=inventory(w);
  accepted(command(w,p,'SwitchEquip',{slot:'quick'}));
  assert.equal(p.heldSlot,'quick');assert.deepEqual(inventory(w),before);
  rejectedWithoutLoss(w,p,'UseQuick');
  advance(w,Math.max(0,p.equipUntil-w.s.time)+.01);
  const state=w.publicState(),publicPlayer=state.players.find(q=>q.id===p.id);
  assert.equal(publicPlayer.quickItemDefinitionId,'coffee_flask');
  assert.equal(publicPlayer.heldDefinitionId,'coffee_flask');
  assert.equal(publicPlayer.equipmentDefinitionId,'coffee_flask');
  const patch=diffState(baseline,compileState(state)).delta.entities.players.patch.find(q=>q.id===p.id);
  assert.equal(patch.set.heldSlot,'quick');assert.equal(patch.set.heldDefinitionId,'coffee_flask');
  assert.equal(w.count(p,'coffee_flask'),2);
});

test('UseQuick trusts the binding, ignores a spoofed definition/amount and handles repeated request IDs exactly once',()=>{
  const {w,p}=fixture(),coffee=grant(w,p,'coffee_flask',2);grant(w,p,'flash_note');select(w,p,coffee);p.stamina=20;
  const message={requestId:p.requestHighWater+1,command:'UseQuick',payload:{definitionId:'flash_note',amount:9999,x:Infinity,z:Infinity}};
  const first=accepted(w.command(p,message));
  assert.equal(p.stamina,60);assert.equal(w.count(p,'coffee_flask'),1);assert.equal(w.count(p,'flash_note'),1);
  const after=inventory(w);assert.deepEqual(w.command(p,message),first);assert.deepEqual(inventory(w),after);
  p.stamina=20;rejectedWithoutLoss(w,p,'UseQuick');
  w.s.time=p.toolCooldowns.coffee_flask+.01;
  accepted(command(w,p,'UseQuick'));assert.equal(w.count(p,'coffee_flask'),0);assert.equal(p.stamina,60);
  w.assertInvariants();
});

test('UseQuick requires the fourth slot, a live present player and an idle usable action state',()=>{
  const guards={weapon:p=>p.heldSlot='weapon',rod:p=>p.heldSlot='rod',melee:p=>p.heldSlot='melee',downed:p=>p.lifeState='DOWNED',dead:p=>p.lifeState='DEAD_WAIT',offline:p=>p.connected=false,swimming:p=>p.swimming=true,work:p=>p.work={kind:'fixture'},reload:p=>p.reload={remaining:1},fishing:p=>p.fishing={state:'CAST'},equip:(p,w)=>p.equipUntil=w.s.time+1};
  for(const id of ['coffee_flask','bandage'])for(const [label,change]of Object.entries(guards)){
    const {w,p}=fixture(),item=id==='bandage'?carried(w,p,id):grant(w,p,id);select(w,p,item);p.hp=30;p.stamina=20;change(p,w);
    const result=rejectedWithoutLoss(w,p,'UseQuick');assert.equal(result.ok,false,`${id}: ${label}`);
    if(label!=='work')assert.equal(p.work,null,`${id}: ${label} must not start a job`);
  }
});

test('quick bandage uses the real delayed job, never consumes on selection or interruption, and completes once',()=>{
  const {w,p}=fixture();select(w,p,carried(w,p,'bandage'));const before=w.count(p,'bandage');
  rejectedWithoutLoss(w,p,'UseQuick');p.hp=30;
  accepted(command(w,p,'UseQuick',{definitionId:'coffee_flask'}));
  assert.equal(p.work.kind,'Bandage');assert.equal(p.work.automatic,true);assert.equal(w.count(p,'bandage'),before);
  rejectedWithoutLoss(w,p,'UseQuick');advance(w,.2);accepted(command(w,p,'CancelWork'));
  assert.equal(w.count(p,'bandage'),before);assert.equal(p.hp,30);
  accepted(command(w,p,'UseQuick'));advance(w,w.defs.items.bandage.use_seconds+.05);
  assert.equal(p.work,null);assert.equal(p.hp,Math.min(w.c.player.max_hp,30+w.defs.items.bandage.heal));
  assert.equal(w.count(p,'bandage'),before-1);advance(w,.2);assert.equal(w.count(p,'bandage'),before-1);w.assertInvariants();
});

test('last quick item becomes empty hand and can punch without creating a fist item or using another tool',()=>{
  const {w,p}=fixture();select(w,p,grant(w,p,'coffee_flask'));grant(w,p,'repair_kit');p.stamina=20;
  rejectedWithoutLoss(w,p,'Melee');accepted(command(w,p,'UseQuick'));
  assert.equal(p.heldSlot,'quick');assert.equal(Boolean(w.equipped(p)),false);
  // The accepted use may keep its visual item briefly; empty-hand input follows that animation.
  advance(w,Math.max(0,(p.quickUseUntil??w.s.time)-w.s.time)+.01);
  assert.equal(w.publicState().players.find(q=>q.id===p.id).heldDefinitionId,null);
  rejectedWithoutLoss(w,p,'UseQuick',{definitionId:'repair_kit'});
  const e=enemy(w,p,'silverfish',{x:0,z:-1});e.hp=e.maxHp=100;e.state='STUNNED';e.phaseRemaining=100;
  const before=inventory(w);accepted(command(w,p,'Melee'));advance(w,w.c.unarmed.windup_seconds+.01);
  assert.equal(e.hp,100-w.c.unarmed.damage);assert.deepEqual(inventory(w),before);assert(!Object.values(w.s.items).some(item=>item.definitionId==='fist'));w.assertInvariants();
});

test('moving the bound item into real storage makes quick use unavailable without moving or duplicating any other item',()=>{
  const {w,p}=fixture(),item=grant(w,p,'coffee_flask',2);select(w,p,item);p.stamina=20;
  const station=w.staticWorld().terminals.find(t=>t.type==='storage'),before=totals(w);put(p,w,station.x,station.z+1);
  accepted(command(w,p,'Transfer',{itemId:item.id,toContainerId:station.containerId,stationId:station.id}));
  assert.equal(w.count(p,'coffee_flask'),0);assert.equal(Boolean(w.equipped(p,'quick')),false);
  rejectedWithoutLoss(w,p,'UseQuick');assert.deepEqual(totals(w),before);
  accepted(command(w,p,'Transfer',{itemId:item.id,toContainerId:p.backpackId,stationId:station.id}));
  bind(w,p,carried(w,p,'coffee_flask'));assert.equal(w.equipped(p,'quick')?.containerId,p.backpackId);assert.deepEqual(totals(w),before);w.assertInvariants();
});

test('definition binding survives consumption of its first stack without borrowing another player stack',()=>{
  const {w,p,ps}=fixture(2),first=w.createItem('coffee_flask',1,w.bag(p)),second=w.createItem('coffee_flask',1,w.bag(p));grant(w,ps[1],'coffee_flask',2);
  select(w,p,first);p.stamina=20;accepted(command(w,p,'UseQuick'));assert.equal(w.s.items[first.id],undefined);
  assert.equal(w.equipped(p,'quick')?.id,second.id);assert.equal(w.count(ps[1],'coffee_flask'),2);
  w.s.time=p.toolCooldowns.coffee_flask+.01;p.stamina=20;accepted(command(w,p,'UseQuick'));
  assert.equal(Boolean(w.equipped(p,'quick')),false);assert.equal(w.count(ps[1],'coffee_flask'),2);rejectedWithoutLoss(w,p,'UseQuick');w.assertInvariants();
});

test('locked carried items are neither resolved nor silently consumed through the fourth slot',()=>{
  const {w,p,ps}=fixture(2),locked=w.createItem('coffee_flask',1,w.bag(p));select(w,p,locked);locked.lockedBy=ps[1].id;p.stamina=20;
  assert.equal(Boolean(w.equipped(p,'quick')),false);rejectedWithoutLoss(w,p,'UseQuick');
  const usable=w.createItem('coffee_flask',1,w.bag(p));assert.equal(w.equipped(p,'quick')?.id,usable.id);
  accepted(command(w,p,'UseQuick'));assert.equal(w.s.items[locked.id]?.quantity,1,'unavailable stack must remain unchanged');assert.equal(w.s.items[usable.id],undefined);w.assertInvariants();
});

test('repair quick use rejects invalid targets without loss and accepts payload or envelope target IDs',()=>{
  for(const envelope of [false,true]){
    const {w,p}=fixture();select(w,p,grant(w,p,'repair_kit',2));const core=w.s.buildings.core;put(p,w,0,2);
    rejectedWithoutLoss(w,p,'UseQuick',{targetId:'core'});core.hp-=200;
    const before=core.hp,result=envelope?command(w,p,'UseQuick',{},'core'):command(w,p,'UseQuick',{targetId:'core'});accepted(result);
    assert.equal(core.hp,Math.min(core.maxHp,before+w.c.director.tools.repair_kit.heal));assert.equal(w.count(p,'repair_kit'),1);
    rejectedWithoutLoss(w,p,'UseQuick',{targetId:'core'});w.s.time=p.toolCooldowns.repair_kit+.01;core.hp=0;
    rejectedWithoutLoss(w,p,'UseQuick',{targetId:'core'});core.hp=1;put(p,w,24,24);rejectedWithoutLoss(w,p,'UseQuick',{targetId:'core'});w.assertInvariants();
  }
});

test('thrown quick tools keep finite-point, range and line-of-sight checks before consuming',()=>{
  for(const id of ['flash_note','decoy_alarm']){
    const {w,p}=fixture();select(w,p,grant(w,p,id,2));
    for(const point of [{x:Infinity,z:p.z},{x:p.x+100,z:p.z}])rejectedWithoutLoss(w,p,'UseQuick',point);
    const at={x:p.x,z:p.z-2};
    w.s.buildings.quickCover={id:'quickCover',definitionId:'wall',x:p.x,y:p.y,z:p.z-1,yaw:0,hp:400,maxHp:400,level:1,revision:1};
    rejectedWithoutLoss(w,p,'UseQuick',at);delete w.s.buildings.quickCover;
    accepted(command(w,p,'UseQuick',at));assert.equal(w.count(p,id),1);rejectedWithoutLoss(w,p,'UseQuick',at);w.assertInvariants();
  }
});

test('old schema-3 saves lacking the quick field restore without resetting adventure inventory or progress',()=>{
  const {w,p}=fixture();grant(w,p,'coffee_flask',2);w.s.time=17;w.s.phaseElapsed=7;
  const saved=w.serialize();for(const q of Object.values(saved.players))delete q.quickItemDefinitionId;
  const old=structuredClone(saved),copy=new SurvivalWorld(w.c,saved,{onlineRoster:true}),q=copy.s.players[p.id];
  assert.equal(q.quickItemDefinitionId,null);assert.equal(q.heldSlot,p.heldSlot);assert.equal(Boolean(copy.equipped(q,'quick')),false);
  assert.equal(copy.s.time,old.time);assert.equal(copy.s.phaseElapsed,old.phaseElapsed);assert.equal(copy.s.schema,old.schema);assert.equal(copy.s.contentVersion,old.contentVersion);
  assert.deepEqual(copy.s.items,old.items);assert.deepEqual(copy.s.containers,old.containers);assert.deepEqual(copy.s.bank,old.bank);
  copy.connect(q,q.name);select(copy,q,carried(copy,q,'coffee_flask'));q.stamina=20;accepted(command(copy,q,'UseQuick'));copy.assertInvariants();
});

test('binding, remaining tools and cooldown persist through save/rejoin with matching public state',()=>{
  const {w,p}=fixture();select(w,p,grant(w,p,'coffee_flask',2));p.stamina=20;accepted(command(w,p,'UseQuick'));
  w.serialize(); // Serialization intentionally computes hasContent/state on containers.
  const before=inventory(w),cooldown=p.toolCooldowns.coffee_flask,copy=restored(w),q=copy.s.players[p.id];copy.connect(q,q.name);
  assert.equal(q.heldSlot,'quick');assert.equal(q.quickItemDefinitionId,'coffee_flask');assert.equal(q.toolCooldowns.coffee_flask,cooldown);assert.deepEqual(inventory(copy),before);
  assert.equal(copy.publicState().players.find(item=>item.id===q.id).heldDefinitionId,'coffee_flask');q.stamina=20;rejectedWithoutLoss(copy,q,'UseQuick');
  copy.s.time=cooldown+.01;accepted(command(copy,q,'UseQuick'));assert.equal(copy.count(q,'coffee_flask'),0);copy.assertInvariants();
});

test('death moves each carried item once, clears available quick use, and respawn grants no tool copy',()=>{
  const {w,p}=fixture();select(w,p,grant(w,p,'coffee_flask',2));const before=totals(w),itemIds=Object.keys(w.s.items).sort();
  w.die(p);assert.deepEqual(totals(w),before);assert.deepEqual(Object.keys(w.s.items).sort(),itemIds);assert.equal(Boolean(w.equipped(p,'quick')),false);
  const corpses=Object.values(w.s.containers).filter(c=>c.type==='corpse');assert.equal(corpses.length,1);assert.equal(new Set(corpses[0].itemIds).size,corpses[0].itemIds.length);
  w.respawn(p,true);assert.equal(Boolean(w.equipped(p,'quick')),false);rejectedWithoutLoss(w,p,'UseQuick');assert.deepEqual(totals(w),before);w.assertInvariants();
});

test('E rescue completes with gun, rod, knife, selected quick tool or empty fourth slot without consuming items',()=>{
  for(const slot of ['weapon','rod','melee','quick','empty-quick']){
    const {w,p,ps}=fixture(2),target=ps[1];w.startNight();w.s.enemies={};w.s.night.pending=[];put(p,w,20,20);put(target,w,21,20);
    if(slot==='quick')bind(w,p,grant(w,p,'coffee_flask'));
    accepted(command(w,p,'SwitchEquip',{slot:slot==='empty-quick'?'quick':slot}));advance(w,.36);
    w.damageQueue.push({target:target.id,actorId:'synthetic-enemy',damage:100});w.resolveDamage();assert.equal(target.lifeState,'DOWNED');
    const before=inventory(w);accepted(command(w,p,'Revive',{},target.id));assert.equal(p.work.kind,'Revive');
    advance(w,w.c.player.revive_seconds+.05,q=>({interact:q.id===p.id}));
    assert.equal(target.lifeState,'ALIVE',slot);assert.equal(target.hp,w.c.player.revive_hp,slot);assert.equal(target.revivesUsed,1,slot);assert.equal(p.work,null);
    const after=inventory(w);assert.deepEqual(after.items,before.items,slot);assert.deepEqual(after.containers,before.containers,slot);
    // Completing any job advances bank.revision even when its resource cost is zero.
    for(const key of ['credits','materials','reservedCredits','reservedMaterials'])assert.equal(after.bank[key],before.bank[key],`${slot}: ${key}`);
    w.assertInvariants();
  }
});

test('legacy direct UseTool and UseBandage remain compatible with existing bots when a gun is selected',()=>{
  const {w,p}=fixture();grant(w,p,'coffee_flask');p.stamina=20;assert.equal(p.heldSlot,'weapon');
  accepted(command(w,p,'UseTool',{definitionId:'coffee_flask'}));assert.equal(w.count(p,'coffee_flask'),0);
  p.hp=30;const before=w.count(p,'bandage');accepted(command(w,p,'UseBandage'));advance(w,w.defs.items.bandage.use_seconds+.05);
  assert.equal(w.count(p,'bandage'),before-1);assert.equal(p.heldSlot,'weapon');w.assertInvariants();
});
