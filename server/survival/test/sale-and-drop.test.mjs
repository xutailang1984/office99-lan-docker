// Synthetic in-memory rules for sale, death and carried-container access.
// No HTTP, credentials, persistent save, browser, GPU, process launch, or filesystem mutation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../config.mjs';
import {SurvivalWorld} from '../world.mjs';

const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
const prices={rod_basic:15,rod_pro:70,carbine:40,shotgun:100,rifle:120,knife:5,ammo_light:1,ammo_shell:1,ammo_heavy:1,bandage:4,decoy_alarm:12,repair_kit:20,coffee_flask:12,flash_note:17,pistol:27,smg:70,lmg:105,rod_light:35,rod_heavy:55,rod_magnet:50,doublebarrel:110,dmr:115,rod_net:65,folding_cover:17,tape_trap:12,scan_note:15};
const lootKinds=new Set(['catch','loot','material']);
function fixture(count=1){
 const w=new SurvivalWorld(structuredClone(config),null,{onlineRoster:true});
 const ps=Array.from({length:count},(_,i)=>w.allocate('合成售卖员'+i,'test-only-sale-'+i));
 w.s.time=10;for(const p of ps){p.equipUntil=0;at(w,p,'recycle');}
 return {w,p:ps[0],ps};
}
function at(w,p,id){const t=typeof id==='string'?w.staticWorld().terminals.find(t=>t.id===id):id;assert(t,'fixture station');Object.assign(p,{x:t.x,y:t.y??w.ground(t.x,t.z),z:t.z+1.2,swimming:false});}
function send(w,p,command,payload={},top={}){return w.command(p,{requestId:p.requestHighWater+1,command,payload,...top});}
function sale(w,p,item,payload={},top={}){return send(w,p,'Sell',{itemId:item.id,quantity:1,stationId:'recycle',...payload},{expectedRevision:item.revision,...top});}
function ledger(w){return structuredClone({items:w.s.items,containers:w.s.containers,bank:w.s.bank,players:Object.values(w.s.players).map(p=>({id:p.id,backpackId:p.backpackId,equipment:p.equipment,heldSlot:p.heldSlot,quick:p.quickItemDefinitionId,work:p.work,reload:p.reload,fishing:p.fishing,meleePending:p.meleePending}))});}
function rejected(w,fn,label){const before=ledger(w),result=fn();assert.equal(result.ok,false,label);assert.deepEqual(ledger(w),before,label+' changed inventory/wallet/action state');return result;}
function accepted(result,label='command'){assert.equal(result.ok,true,label+': '+result.code);return result;}
function bagItem(w,p,id){return w.bag(p).itemIds.map(id=>w.s.items[id]).find(i=>i.definitionId===id);}
function grant(w,p,id,quantity=1,extra={}){return w.createItem(id,quantity,w.bag(p),extra);}
function totals(w){const out={};for(const i of Object.values(w.s.items))out[i.definitionId]=(out[i.definitionId]??0)+i.quantity;return out;}
function expected(w,item,quantity){
 const def=w.defs.items[item.definitionId];
 if(lootKinds.has(def.kind))return {credits:(def.sell_c??0)*quantity,materials:(def.deposit_m??0)*quantity};
 assert(Number.isSafeInteger(def.resale_c)&&def.resale_c>=0,'missing authoritative resale_c '+def.id);
 const gun=w.defs.weapons[item.definitionId];
 return {credits:def.resale_c*quantity+(gun?Math.floor(config.weapon_upgrade.cost_c*.5)*(item.level-1)+item.magazineAmmo*w.defs.items[gun.ammo].resale_c:0),materials:0};
}

test('S1 price table is explicit for all 20 ordinary definitions; loot keeps existing conversion',()=>{
 for(const [id,price]of Object.entries(prices))assert.equal(config.items.find(d=>d.id===id)?.resale_c,price,id);
 assert.equal(config.items.length,45);
 for(const def of config.items)assert(lootKinds.has(def.kind)||Object.hasOwn(prices,def.id),'unclassified sale definition '+def.id);
});

test('each of the 21 ordinary/loot definitions has a single-item sale with exact shared proceeds',()=>{
 for(const def of config.items){const {w,p}=fixture(),item=grant(w,p,def.id),money=structuredClone(w.s.bank),quote=expected(w,item,1);
  accepted(sale(w,p,item),def.id);assert.equal(w.s.items[item.id],undefined,def.id);
  assert.equal(w.s.bank.credits,money.credits+quote.credits,def.id+' C');assert.equal(w.s.bank.materials,money.materials+quote.materials,def.id+' M');w.assertInvariants();
 }
});

test('partial stack sale removes only the requested count and raises its revision',()=>{
 const {w,p}=fixture(),item=bagItem(w,p,'ammo_light'),quantity=item.quantity,revision=item.revision,money=structuredClone(w.s.bank),mag=w.equipped(p,'weapon').magazineAmmo;
 accepted(sale(w,p,item,{quantity:5}));assert.equal(item.quantity,quantity-5);assert(item.revision>revision);
 assert.equal(w.s.bank.credits,money.credits+5);assert.equal(w.s.bank.materials,money.materials);assert.equal(w.equipped(p,'weapon').magazineAmmo,mag);w.assertInvariants();
});

test('quantity is required and must be a positive safe integer no larger than that instance',()=>{
 for(const quantity of [undefined,null,0,-1,1.5,'1',NaN,Infinity,Number.MAX_SAFE_INTEGER+1,41]){
  const {w,p}=fixture(),item=bagItem(w,p,'ammo_light');assert.equal(item.quantity,40);
  rejected(w,()=>sale(w,p,item,{quantity}),'quantity '+String(quantity));
 }
});

test('expectedRevision is mandatory at the top level; stale or malformed revisions cannot sell',()=>{
 for(const revision of [undefined,null,-1,1.5,'1',NaN,Infinity]){const {w,p}=fixture(),item=bagItem(w,p,'ammo_light');rejected(w,()=>sale(w,p,item,{}, {expectedRevision:revision}),'revision '+String(revision));}
 const {w,p}=fixture(),item=bagItem(w,p,'ammo_light');
 rejected(w,()=>send(w,p,'Sell',{itemId:item.id,quantity:1,stationId:'recycle',expectedRevision:item.revision}),'nested-only revision');
 rejected(w,()=>sale(w,p,item,{}, {expectedRevision:item.revision-1}),'stale revision');
});

test('only the selected nearby recycler is valid, including the highland recycler',()=>{
 const {w,p}=fixture(),item=bagItem(w,p,'ammo_light');
 for(const stationId of [undefined,null,'missing','terminal','storage','upgrade','emergency_recycle'])rejected(w,()=>sale(w,p,item,{stationId}),'wrong station '+stationId);
 at(w,p,'storage');rejected(w,()=>sale(w,p,item),'standing at cabinet');
 at(w,p,'recycle');p.x+=8;rejected(w,()=>sale(w,p,item),'out of range');
 at(w,p,'emergency_recycle');accepted(sale(w,p,item,{stationId:'emergency_recycle'}));
});

test('selling the selected equipped gun/rod/knife requires true confirmation and leaves that slot empty',()=>{
 for(const kind of ['weapon','rod','melee']){const {w,p}=fixture();p.heldSlot=kind;const item=w.equipped(p,kind),before=structuredClone(w.s.bank),quote=expected(w,item,1),other=Object.values(p.equipment).filter(id=>id!==item.containerId).flatMap(id=>w.s.containers[id].itemIds);
  for(const confirmEquipped of [undefined,false,1,'true'])rejected(w,()=>sale(w,p,item,{confirmEquipped}),'equipped confirmation');
  accepted(sale(w,p,item,{confirmEquipped:true}));assert.equal(w.equipped(p),undefined);assert.equal(w.s.containers[p.equipment[kind]].itemIds.length,0);
  assert(other.every(id=>w.s.items[id]));assert.equal(w.s.bank.credits,before.credits+quote.credits);assert.equal(w.s.bank.materials,before.materials);w.assertInvariants();
 }
});

test('starter carbine with 20 loaded rounds sells for 60 C without returning materials or reserve ammo',()=>{
 const {w,p}=fixture(),gun=w.equipped(p,'weapon'),before=structuredClone(w.s.bank),reserve=w.count(p,'ammo_light');assert.equal(gun.magazineAmmo,20);
 accepted(sale(w,p,gun,{confirmEquipped:true}));assert.equal(w.s.bank.credits,before.credits+60);assert.equal(w.s.bank.materials,before.materials);assert.equal(w.count(p,'ammo_light'),reserve);
});

test('upgraded loaded gun adds the stated credit-only upgrade and actual magazine value once',()=>{
 const {w,p}=fixture(),gun=w.equipped(p,'weapon');gun.level=config.weapon_upgrade.max_level;gun.magazineAmmo=7;
 const before=structuredClone(w.s.bank),ammo=w.count(p,'ammo_light'),price=40+7+Math.floor(config.weapon_upgrade.cost_c*.5)*(gun.level-1);
 accepted(sale(w,p,gun,{confirmEquipped:true,price:999999,credits:999999,materials:999999,level:999,magazineAmmo:999}));
 assert.equal(w.s.bank.credits,before.credits+price);assert.equal(w.s.bank.materials,before.materials);assert.equal(w.count(p,'ammo_light'),ammo);assert.equal(w.s.items[gun.id],undefined);w.assertInvariants();
});

test('selling a bound quick stack keeps the preference but cannot use the sold-away stock',()=>{
 const {w,p}=fixture(),item=grant(w,p,'coffee_flask',2);accepted(send(w,p,'BindQuick',{itemId:item.id}));p.heldSlot='quick';
 const before=w.s.bank.credits;accepted(sale(w,p,item,{quantity:1}));assert.equal(item.quantity,1);assert.equal(w.equipped(p,'quick').id,item.id);
 accepted(sale(w,p,item,{quantity:1}));assert.equal(w.equipped(p,'quick'),undefined);assert.equal(w.s.bank.credits,before+24);assert.equal(p.quickItemDefinitionId,'coffee_flask');
 p.stamina=20;rejected(w,()=>send(w,p,'UseQuick'),'sold quick stock');assert.equal(p.stamina,20);w.assertInvariants();
});

test('proceeds exceeding a safe integer reject without deleting the item or altering the wallet',()=>{
 const {w,p}=fixture(),item=bagItem(w,p,'ammo_light');w.s.bank.credits=Number.MAX_SAFE_INTEGER;
 rejected(w,()=>sale(w,p,item),'wallet overflow');
});

test('request replay and a stale new request cannot pay twice after partial or complete sale',()=>{
 for(const partial of [true,false]){const {w,p}=fixture(),item=bagItem(w,p,'ammo_light'),revision=item.revision,quantity=partial?5:item.quantity;
  const message={requestId:p.requestHighWater+1,command:'Sell',expectedRevision:revision,payload:{itemId:item.id,quantity,stationId:'recycle'}};
  const first=accepted(w.command(p,message)),after=ledger(w);assert.deepEqual(w.command(p,message),first);assert.deepEqual(ledger(w),after);
  assert.deepEqual(w.command(p,{...message,payload:{...message.payload,quantity:1}}),first);assert.deepEqual(ledger(w),after);
  rejected(w,()=>send(w,p,'Sell',message.payload,{expectedRevision:revision}),'new stale request');w.assertInvariants();
 }
});

test('different players add their own proceeds once but cannot sell another carried item',()=>{
 const {w,p,ps}=fixture(2),q=ps[1],a=bagItem(w,p,'ammo_light'),b=bagItem(w,q,'ammo_light'),before=w.s.bank.credits;
 rejected(w,()=>sale(w,q,a),'foreign backpack');rejected(w,()=>sale(w,q,w.equipped(p,'weapon'),{confirmEquipped:true}),'foreign equipment');
 accepted(sale(w,p,a,{quantity:3}));accepted(sale(w,q,b,{quantity:4}));assert.equal(w.s.bank.credits,before+7);w.assertInvariants();
});

test('recovery loans are unsellable equipped or in the owners backpack, and cannot enter shared storage',()=>{
 for(const definitionId of ['rod_basic','knife']){const {w,p}=fixture(),kind=w.defs.items[definitionId].kind;w.removeItem(w.equipped(p,kind));at(w,p,'terminal');
  accepted(send(w,p,'ClaimTool',{definitionId,stationId:'terminal'}));const loan=w.equipped(p,kind);assert.equal(loan.loanOwnerSlotId,p.slotId);at(w,p,'recycle');
  rejected(w,()=>sale(w,p,loan,{confirmEquipped:true}),'equipped loan');accepted(send(w,p,'Transfer',{itemId:loan.id,toContainerId:p.backpackId}));
  rejected(w,()=>sale(w,p,loan),'backpack loan');at(w,p,'storage');rejected(w,()=>send(w,p,'Transfer',{itemId:loan.id,toContainerId:'storage',stationId:'storage'}),'stored loan');
 }
});

test('work, reload, fishing, pending melee and item locks reject sale without canceling or consuming anything',()=>{
 const blockers=[p=>p.work={kind:'synthetic-work',progress:.2},p=>p.reload={remaining:.4,loaded:1},p=>p.fishing={state:'BITE',remaining:3},p=>p.meleePending={at:10.1,damage:25}];
 for(const block of blockers){const {w,p}=fixture(),item=bagItem(w,p,'ammo_light');block(p);rejected(w,()=>sale(w,p,item),'busy activity');}
 const {w,p}=fixture(),item=bagItem(w,p,'ammo_light');item.lockedBy=p.id;rejected(w,()=>sale(w,p,item),'locked instance');
});

test('dead, downed, disconnected, swimming and COMPLETE players cannot sell',()=>{
 for(const alter of [(w,p)=>p.lifeState='DOWNED',(w,p)=>p.lifeState='DEAD_WAIT',(w,p)=>p.connected=false,(w,p)=>p.swimming=true,w=>w.s.phase='COMPLETE']){
  const {w,p}=fixture(),item=bagItem(w,p,'ammo_light');alter(w,p);rejected(w,()=>sale(w,p,item),'inactive actor');
 }
});

test('shared cabinet, ground loot, recovery box and owned corpse are never direct Sell sources',()=>{
 const {w,p}=fixture(),containers=[w.s.containers.storage,w.createContainer('loot',2,{x:p.x,y:p.y,z:p.z}),w.createContainer('recovery',2,{x:p.x,y:p.y,z:p.z}),w.createContainer('corpse',2,{ownerSlotId:p.slotId,x:p.x,y:p.y,z:p.z})];
 for(const box of containers){const item=w.createItem('carbine',1,box,{magazineAmmo:3});rejected(w,()=>sale(w,p,item,{confirmEquipped:true}),box.type+' source');}
});

test('owned corpse cannot bypass pickup range through Transfer, SwitchEquip or Upgrade',()=>{
 const {w,p}=fixture();w.removeItem(w.equipped(p,'weapon'));const box=w.createContainer('corpse',3,{ownerSlotId:p.slotId,x:65,y:w.ground(65,0),z:0}),gun=w.createItem('carbine',1,box,{magazineAmmo:7}),ammo=w.createItem('ammo_light',4,box);
 rejected(w,()=>send(w,p,'Transfer',{itemId:ammo.id,toContainerId:p.backpackId}),'remote corpse Transfer');
 rejected(w,()=>send(w,p,'Transfer',{itemId:bagItem(w,p,'bandage').id,toContainerId:box.id}),'remote corpse stash');
 rejected(w,()=>send(w,p,'SwitchEquip',{itemId:gun.id}),'remote corpse equip');
 at(w,p,'upgrade');rejected(w,()=>send(w,p,'Upgrade',{stationId:'upgrade'},{targetId:gun.id}),'remote corpse upgrade');
 rejected(w,()=>send(w,p,'Pickup',{}, {targetId:box.id}),'normal distant pickup');
 at(w,p,box);accepted(send(w,p,'Pickup',{}, {targetId:box.id}));assert.equal(gun.containerId,p.backpackId);assert.equal(gun.magazineAmmo,7);
 accepted(send(w,p,'SwitchEquip',{itemId:gun.id}));assert.equal(w.equipped(p,'weapon').id,gun.id);w.assertInvariants();
});

test('nearby teammates can recover ordinary corpse items but cannot take its recovery loan',()=>{
 const {w,p,ps}=fixture(2),q=ps[1],box=w.createContainer('corpse',2,{ownerSlotId:p.slotId,x:q.x,y:q.y,z:q.z});
 const ordinary=w.createItem('carbine',1,box,{magazineAmmo:4}),loan=w.createItem('knife',1,box,{loanOwnerSlotId:p.slotId});
 accepted(send(w,q,'Pickup',{}, {targetId:box.id}));assert.equal(ordinary.containerId,q.backpackId);assert.equal(loan.containerId,box.id);
 rejected(w,()=>send(w,q,'Transfer',{itemId:loan.id,toContainerId:q.backpackId}),'foreign loan');
 at(w,p,box);accepted(send(w,p,'Pickup',{}, {targetId:box.id}));assert.equal(loan.containerId,p.backpackId);w.assertInvariants();
});

test('Deposit recycles ordinary loot while preserving crafting ingredients, gear and supplies',()=>{
 const {w,p}=fixture();w.removeItem(w.equipped(p,'rod'));at(w,p,'terminal');accepted(send(w,p,'ClaimTool',{definitionId:'rod_basic',stationId:'terminal'}));const loan=w.equipped(p,'rod');accepted(send(w,p,'Transfer',{itemId:loan.id,toContainerId:p.backpackId}));
 for(const id of ['shotgun','rod_pro','decoy_alarm','repair_kit','coffee_flask','flash_note'])grant(w,p,id);
 const beforeIds=Object.keys(w.s.items).sort(),beforeItems=structuredClone(w.s.items),fish=grant(w,p,'catch_shore',2),treasure=grant(w,p,'treasure'),scrap=grant(w,p,'scrap',3),before=structuredClone(w.s.bank);
 at(w,p,'recycle');accepted(send(w,p,'Deposit',{stationId:'recycle'}));
 assert.deepEqual(Object.keys(w.s.items).sort(),[...beforeIds,scrap.id].sort());for(const id of beforeIds)assert.deepEqual(w.s.items[id],beforeItems[id]);assert.equal(w.s.items[fish.id],undefined);assert.equal(w.s.items[treasure.id],undefined);assert.equal(w.s.items[scrap.id].quantity,3);
 assert.equal(w.s.bank.credits,before.credits+16+50);assert.equal(w.s.bank.materials,before.materials);
 accepted(sale(w,p,scrap,{quantity:3}));assert.equal(w.s.items[scrap.id],undefined);assert.equal(w.s.bank.materials,before.materials+3);w.assertInvariants();
});

test('individual death plus save/restore preserves item identity, upgrade and loaded ammo without grants',()=>{
 const {w,p}=fixture(),gun=w.equipped(p,'weapon');gun.level=config.weapon_upgrade.max_level;gun.magazineAmmo=7;
 const coffee=grant(w,p,'coffee_flask',2);accepted(send(w,p,'BindQuick',{itemId:coffee.id}));const before=totals(w),ids=Object.keys(w.s.items).sort(),bank=structuredClone(w.s.bank);
 w.die(p);assert.deepEqual(totals(w),before);assert.deepEqual(Object.keys(w.s.items).sort(),ids);assert.deepEqual(w.s.bank,bank);assert.equal(w.s.items[gun.id].magazineAmmo,7);
 const saved=w.serialize(),restored=new SurvivalWorld(config,saved,{onlineRoster:true}),q=restored.s.players[p.id];restored.connect(q,q.name);
 assert.deepEqual(totals(restored),before);assert.deepEqual(Object.keys(restored.s.items).sort(),ids);assert.equal(restored.s.items[gun.id].level,gun.level);assert.equal(restored.s.items[gun.id].magazineAmmo,7);assert.deepEqual(restored.s.bank,bank);restored.assertInvariants();
 // Deliberately no new insurance/cabinet loss or equipped-retention assertion here.
});

test('sold instances stay absent after checkpoint restore and the same request remains idempotent',()=>{
 const {w,p}=fixture(),gun=w.equipped(p,'weapon'),message={command:'Sell',requestId:p.requestHighWater+1,expectedRevision:gun.revision,payload:{itemId:gun.id,quantity:1,stationId:'recycle',confirmEquipped:true}};
 const first=accepted(w.command(p,message)),saved=w.serialize(),restored=new SurvivalWorld(config,saved,{onlineRoster:true}),q=restored.s.players[p.id];restored.connect(q,q.name);const before=ledger(restored);
 assert.equal(restored.s.items[gun.id],undefined);assert.deepEqual(restored.command(q,message),first);assert.deepEqual(ledger(restored),before);restored.assertInvariants();
});

