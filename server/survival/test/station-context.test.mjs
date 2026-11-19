import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../config.mjs';
import {SurvivalWorld} from '../world.mjs';
const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
function fixture(count=1){const w=new SurvivalWorld(structuredClone(config));const ps=Array.from({length:count},(_,i)=>w.allocate('隔离检查员','station-synthetic-'+i));w.s.bank.credits=1000;w.s.bank.materials=100;return{w,p:ps[0],ps};}
function at(p,t){Object.assign(p,{x:t.x,y:t.y,z:t.z,swimming:false});}
function send(w,p,command,payload={},targetId){return w.command(p,{requestId:p.requestHighWater+1,command,payload,targetId});}
function economic(w){return JSON.stringify({bank:w.s.bank,items:w.s.items,containers:w.s.containers});}
function rejectUnchanged(w,p,command,payload={},id){const before=economic(w),result=send(w,p,command,payload,id);assert.equal(result.ok,false,command);assert.equal(economic(w),before,command+' changed resources');return result;}

test('both storage stations allow storage only and bind to their configured container',()=>{
 for(const index of [1,3]){
  const {w,p}=fixture(),t=w.staticWorld().terminals[index];at(p,t);
  for(const [command,payload,id]of [['Buy',{definitionId:'bandage'}],['Deposit',{}],['ClaimTool',{definitionId:'rod_basic'}],['Upgrade',{},w.equipped(p,'weapon').id]])assert.equal(rejectUnchanged(w,p,command,payload,id).code,'OUT_OF_RANGE');
  w.addItems(w.bag(p),'scrap',1);
  const carried=w.bag(p).itemIds.map(id=>w.s.items[id]).find(i=>i.definitionId==='scrap');
  assert.equal(send(w,p,'Transfer',{itemId:carried.id,toContainerId:'storage',stationId:t.id}).ok,true);
  assert.equal(carried.containerId,'storage');
  assert.equal(send(w,p,'Transfer',{itemId:carried.id,toContainerId:p.backpackId,stationId:t.id}).ok,true);
  const unrelated=w.createContainer('storage',10);
  assert.equal(rejectUnchanged(w,p,'Transfer',{itemId:carried.id,toContainerId:unrelated.id,stationId:t.id}).code,'OUT_OF_RANGE');
 }
});

test('shops only acquire items; recycling takes place at a different station',()=>{
 for(const tIndex of [0,2]){
  const {w,p}=fixture(),t=w.staticWorld().terminals[tIndex];at(p,t);
  assert.equal(send(w,p,'Buy',{definitionId:'bandage',stationId:t.id}).ok,true);
  w.addItems(w.bag(p),'scrap',1);const scrap=w.bag(p).itemIds.map(id=>w.s.items[id]).find(i=>i.definitionId==='scrap');
  rejectUnchanged(w,p,'Transfer',{itemId:scrap.id,toContainerId:'storage',stationId:t.id});
  rejectUnchanged(w,p,'Deposit',{stationId:t.id});
  const fish=w.createItem('catch_shore',1,w.bag(p)),before=structuredClone(w.s.bank),recycler=w.staticWorld().terminals.find(t=>t.type==='recycle'&&t.id.startsWith(tIndex===2?'emergency_':'recycle'));at(p,recycler);
  assert.equal(send(w,p,'Deposit',{stationId:recycler.id}).ok,true);assert.equal(w.s.items[fish.id],undefined);assert.equal(w.s.items[scrap.id].quantity,1);assert.equal(w.s.bank.credits,before.credits+w.defs.items.catch_shore.sell_c);assert.equal(w.s.bank.materials,before.materials);
 }
});

test('lost tools are claimed only at shops, and recovery loans cannot enter shared storage',()=>{
 const {w,p}=fixture(),shop=w.staticWorld().terminals[0],storage=w.staticWorld().terminals[1];
 w.removeItem(w.equipped(p,'rod'));at(p,storage);rejectUnchanged(w,p,'ClaimTool',{definitionId:'rod_basic',stationId:storage.id});
 at(p,shop);assert.equal(send(w,p,'ClaimTool',{definitionId:'rod_basic',stationId:shop.id}).ok,true);
 const loan=w.equipped(p,'rod');assert.equal(loan.loanOwnerSlotId,p.slotId);
 at(p,storage);rejectUnchanged(w,p,'Transfer',{itemId:loan.id,toContainerId:'storage',stationId:storage.id});
 w.s.phase='NIGHT';at(p,shop);rejectUnchanged(w,p,'Buy',{definitionId:'bandage',stationId:shop.id});
});

test('distance boundaries and stale/forged shop identities preserve funds and inventory',()=>{
 const {w,p}=fixture(),shop=w.staticWorld().terminals[0];at(p,shop);
 for(const stationId of ['storage','emergency_tools','missing'])rejectUnchanged(w,p,'Buy',{definitionId:'bandage',stationId});
 p.x=shop.x+config.player.interact_distance+.01;rejectUnchanged(w,p,'Buy',{definitionId:'bandage',stationId:shop.id});
 p.x=shop.x+config.player.interact_distance-.01;assert.equal(send(w,p,'Buy',{definitionId:'bandage',stationId:shop.id}).ok,true);
 p.lifeState='DEAD_WAIT';rejectUnchanged(w,p,'Buy',{definitionId:'bandage',stationId:shop.id});
});

test('field equipment, healing and one-item loot remain usable without a station',()=>{
 const {w,p}=fixture();at(p,{x:16,y:5,z:0});
 w.addItems(w.bag(p),'shotgun',1);const spare=w.bag(p).itemIds.map(id=>w.s.items[id]).find(i=>i.definitionId==='shotgun');
 assert.equal(send(w,p,'SwitchEquip',{itemId:spare.id}).ok,true);
 p.hp=40;assert.equal(send(w,p,'UseBandage').ok,true);assert.equal(p.work.kind,'Bandage');w.cancelWork(p);
 const loot=w.createContainer('loot',1,{x:p.x,y:p.y,z:p.z});w.addItems(loot,'scrap',1);
 assert.equal(send(w,p,'Pickup',{},loot.id).ok,true);assert.equal(w.containerContent(loot),false);
});

test('recovery materials still recover at the bag and cannot be duplicated',()=>{
 const {w,p}=fixture();at(p,{x:16,y:5,z:0});const box=w.createContainer('recovery',1,{x:p.x,y:p.y,z:p.z,recoverableC:17,recoverableM:23});
 const before={c:w.s.bank.credits,m:w.s.bank.materials};
 assert.equal(send(w,p,'Deposit',{},box.id).ok,true);assert.equal(w.s.bank.credits,before.c+17);assert.equal(w.s.bank.materials,before.m+23);
 rejectUnchanged(w,p,'Deposit',{},box.id);
});

test('weapon work completes at its upgrade bench; leaving or nightfall releases the exact reservation',()=>{
 for(const condition of ['complete','leave','night']){
  const {w,p}=fixture(),t=w.staticWorld().terminals.find(t=>t.type==='upgrade');at(p,t);w.addItems(w.bag(p),'field_core',1);const gun=w.equipped(p,'weapon');
  assert.equal(send(w,p,'Upgrade',{stationId:t.id},gun.id).ok,true);assert.equal(p.work.stationId,t.id);
  assert.equal(w.s.bank.reservedCredits,config.weapon_upgrade.cost_c);
  p.input.interact=true;
  if(condition==='leave')p.x+=4;
  if(condition==='night')w.s.phase='NIGHT';
  w.updateWork(p,config.construction.upgrade_seconds+.1);
  assert.equal(p.work,null);assert.equal(w.s.bank.reservedCredits,0);assert.equal(w.s.bank.reservedMaterials,0);
  assert.equal(gun.level,condition==='complete'?2:1);
  assert.equal(w.s.bank.credits,1000-(condition==='complete'?config.weapon_upgrade.cost_c:0));
 }
});

test('two teammates cannot buy twice with one budget or take the same warehouse item',()=>{
 const {w,ps}=fixture(2),shop=w.staticWorld().terminals[0],storage=w.staticWorld().terminals[1];
 ps.forEach(p=>at(p,shop));w.s.bank.credits=8;
 assert.equal(send(w,ps[0],'Buy',{definitionId:'bandage',stationId:shop.id}).ok,true);
 rejectUnchanged(w,ps[1],'Buy',{definitionId:'bandage',stationId:shop.id});assert.equal(w.s.bank.credits,0);
 const box=w.s.containers.storage;w.addItems(box,'rifle',1);const itemId=box.itemIds[0];ps.forEach(p=>at(p,storage));
 assert.equal(send(w,ps[0],'Transfer',{itemId,toContainerId:ps[0].backpackId,stationId:storage.id}).ok,true);
 rejectUnchanged(w,ps[1],'Transfer',{itemId,toContainerId:ps[1].backpackId,stationId:storage.id});
 assert.equal(w.s.items[itemId].containerId,ps[0].backpackId);
});
