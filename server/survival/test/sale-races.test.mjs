// Sequential authoritative commands and synthetic in-memory worlds only.
// No real accounts/saves, HTTP, browser, GPU, wall-clock simulation or filesystem writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../config.mjs';
import {SurvivalWorld} from '../world.mjs';
const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
function fixture(count=1){const w=new SurvivalWorld(structuredClone(config),null,{onlineRoster:true}),ps=Array.from({length:count},(_,i)=>w.allocate('合成竞争员'+i,'isolated-race-'+i));w.s.time=10;w.s.bank.credits=1000;w.s.bank.materials=100;for(const p of ps){p.equipUntil=0;at(w,p,'recycle');}return {w,p:ps[0],ps};}
function at(w,p,id){const t=typeof id==='string'?w.staticWorld().terminals.find(t=>t.id===id):id;assert(t);Object.assign(p,{x:t.x,y:t.y??w.ground(t.x,t.z),z:t.z+1.2,swimming:false});}
const send=(w,p,command,payload={},top={})=>w.command(p,{requestId:p.requestHighWater+1,command,payload,...top});
const sell=(w,p,item,quantity=item.quantity,revision=item.revision)=>send(w,p,'Sell',{itemId:item.id,quantity,stationId:'recycle',confirmEquipped:true},{expectedRevision:revision});
const accepted=(r,label='command')=>{assert.equal(r.ok,true,label+': '+r.code);return r;};
const ledger=w=>structuredClone({items:w.s.items,containers:w.s.containers,bank:w.s.bank});
const rejected=(w,fn,label)=>{const before=ledger(w),r=fn();assert.equal(r.ok,false,label);assert.deepEqual(ledger(w),before,label+' changed inventory/funds');return r;};
const itemOf=(w,p,id)=>w.bag(p).itemIds.map(id=>w.s.items[id]).find(i=>i.definitionId===id);
const clearBag=(w,p)=>{for(const id of [...w.bag(p).itemIds])w.removeItem(w.s.items[id]);};
const price=(w,item)=>{const def=w.defs.items[item.definitionId],gun=w.defs.weapons[def.id];return def.resale_c+(gun?(item.magazineAmmo*w.defs.items[gun.ammo].resale_c)+Math.floor(config.weapon_upgrade.cost_c*.5)*(item.level-1):0);};

test('shop Buy -> Sell cannot increase C or M, guns are empty, and craft-only items cannot bypass recipes',()=>{
 for(const def of config.items.filter(d=>Number.isFinite(d.buy_c)&&d.id!=='knife')){
  const {w,p}=fixture();clearBag(w,p);if(p.equipment[def.kind])for(const id of [...w.s.containers[p.equipment[def.kind]].itemIds])w.removeItem(w.s.items[id]);
  const before=structuredClone(w.s.bank),ids=new Set(Object.keys(w.s.items));at(w,p,'terminal');
  if(w.defs.items[def.id].craft_only){assert.equal(rejected(w,()=>send(w,p,'Buy',{definitionId:def.id,stationId:'terminal'}),def.id+' recipe bypass').code,'CRAFT_ONLY');continue;}
  accepted(send(w,p,'Buy',{definitionId:def.id,stationId:'terminal'}),def.id+' buy');
  const bought=Object.values(w.s.items).filter(i=>!ids.has(i.id));assert.equal(bought.length,1,def.id);const item=bought[0];assert.equal(item.quantity,def.buy_quantity??1);
  if(w.defs.weapons[def.id])assert.equal(item.magazineAmmo,0,def.id+' free magazine');
  at(w,p,'recycle');accepted(sell(w,p,item),def.id+' sell');assert.equal(w.s.bank.credits,before.credits-def.buy_c+def.resale_c*(def.buy_quantity??1),def.id);
  assert.equal(w.s.bank.materials,before.materials-(def.buy_m??0),def.id);assert(w.s.bank.credits<=before.credits&&w.s.bank.materials<=before.materials,def.id+' profitable loop');w.assertInvariants();
 }
});

test('light-ammo purchase then loaded-gun sale retains at most its paid ammo value, not a free magazine',()=>{
 const {w,p}=fixture();clearBag(w,p);w.removeItem(w.equipped(p,'weapon'));const before=structuredClone(w.s.bank);at(w,p,'terminal');
 accepted(send(w,p,'Buy',{definitionId:'carbine',stationId:'terminal'}));accepted(send(w,p,'Buy',{definitionId:'ammo_light',stationId:'terminal'}));const gun=w.equipped(p,'weapon');assert.equal(gun.magazineAmmo,0);
 accepted(send(w,p,'Reload'));w.updateReload(p,p.reload.remaining+.01);assert.equal(gun.magazineAmmo,20);assert.equal(w.count(p,'ammo_light'),0);
 at(w,p,'recycle');accepted(sell(w,p,gun));assert.equal(w.s.bank.credits,before.credits-80-20+40+20);assert.equal(w.s.bank.materials,before.materials-10);w.assertInvariants();
});

test('initial knife can be sold once; repeated ClaimTool cannot turn replacement loans into money',()=>{
 const {w,p}=fixture(),knife=w.equipped(p,'melee'),before=w.s.bank.credits;accepted(sell(w,p,knife));assert.equal(w.s.bank.credits,before+5);
 let previous=null;
 for(let i=0;i<3;i++){at(w,p,'terminal');accepted(send(w,p,'ClaimTool',{definitionId:'knife',stationId:'terminal'}));const loan=w.equipped(p,'melee');assert.equal(loan.loanOwnerSlotId,p.slotId);if(previous)assert.equal(w.s.items[previous],undefined);previous=loan.id;
  at(w,p,'recycle');rejected(w,()=>sell(w,p,loan),'replacement loan sell');assert.equal(w.s.bank.credits,before+5);assert.equal(Object.values(w.s.items).filter(x=>x.loanOwnerSlotId===p.slotId&&x.definitionId==='knife').length,1);
 }
 at(w,p,'terminal');rejected(w,()=>send(w,p,'Buy',{definitionId:'knife',stationId:'terminal'}),'free paid-knife bypass');w.assertInvariants();
});

test('Transfer -> Sell and Sell -> Transfer serialize without duplicating a shared item',()=>{
 const {w,p,ps}=fixture(2),q=ps[1],item=w.createItem('carbine',1,w.bag(p),{magazineAmmo:7}),originalRevision=item.revision,expected=price(w,item),before=w.s.bank.credits;
 at(w,p,'storage');accepted(send(w,p,'Transfer',{itemId:item.id,toContainerId:'storage',stationId:'storage'},{expectedRevision:originalRevision}));
 at(w,p,'recycle');rejected(w,()=>sell(w,p,item,1,originalRevision),'sell after stored');
 at(w,q,'storage');accepted(send(w,q,'Transfer',{itemId:item.id,toContainerId:q.backpackId,stationId:'storage'},{expectedRevision:item.revision}));at(w,q,'recycle');accepted(sell(w,q,item));
 at(w,p,'storage');rejected(w,()=>send(w,p,'Transfer',{itemId:item.id,toContainerId:p.backpackId,stationId:'storage'}),'take sold item');assert.equal(w.s.bank.credits,before+expected);w.assertInvariants();
 const other=w.createItem('ammo_light',3,w.bag(p));at(w,p,'recycle');accepted(sell(w,p,other));at(w,p,'storage');rejected(w,()=>send(w,p,'Transfer',{itemId:other.id,toContainerId:'storage',stationId:'storage'}),'store sold item');w.assertInvariants();
});

test('Fire -> Sell prices the remaining magazine and rejects a quote from before that shot',()=>{
 const {w,p}=fixture(),gun=w.equipped(p,'weapon'),revision=gun.revision,before=w.s.bank.credits,mag=gun.magazineAmmo;
 accepted(send(w,p,'Fire',{yaw:0,pitch:1.2,ads:false}));assert.equal(gun.magazineAmmo,mag-1);
 rejected(w,()=>sell(w,p,gun,1,revision),'pre-shot quote');accepted(sell(w,p,gun));assert.equal(w.s.bank.credits,before+40+mag-1);assert.equal(w.s.statistics.shotsFired,1);w.assertInvariants();
});

test('Sell -> Fire cannot shoot the removed gun or consume reserve ammo',()=>{
 const {w,p}=fixture(),gun=w.equipped(p,'weapon'),ammo=w.count(p,'ammo_light');accepted(sell(w,p,gun));rejected(w,()=>send(w,p,'Fire',{yaw:0,pitch:1.2}),'shot after sale');assert.equal(w.s.statistics.shotsFired,0);assert.equal(w.count(p,'ammo_light'),ammo);
});

test('Reload blocks sale; completed loading invalidates the earlier quote and conserves ammunition',()=>{
 const {w,p}=fixture(),gun=w.equipped(p,'weapon');gun.magazineAmmo=3;const revision=gun.revision,beforeTotal=w.count(p,'ammo_light')+gun.magazineAmmo;
 accepted(send(w,p,'Reload'));const pending=structuredClone(p.reload);rejected(w,()=>sell(w,p,gun),'pending reload');assert.deepEqual(p.reload,pending);
 w.updateReload(p,p.reload.remaining+.01);assert.equal(w.count(p,'ammo_light')+gun.magazineAmmo,beforeTotal);assert.equal(p.reload,null);rejected(w,()=>sell(w,p,gun,1,revision),'pre-load quote');
 const money=w.s.bank.credits,quote=price(w,gun),reserve=w.count(p,'ammo_light');accepted(sell(w,p,gun));assert.equal(w.s.bank.credits,money+quote);assert.equal(w.count(p,'ammo_light'),reserve);
});

test('one inserted shotgun shell survives cancellation and is paid once; sale first makes Reload invalid',()=>{
 const {w,p}=fixture();w.removeItem(w.equipped(p,'weapon'));const gun=w.createItem('shotgun',1,w.s.containers[p.equipment.weapon]);w.addItems(w.bag(p),'ammo_shell',3);const beforeAmmo=w.count(p,'ammo_shell');
 accepted(send(w,p,'Reload'));w.updateReload(p,p.reload.remaining+.001);assert.equal(gun.magazineAmmo,1);assert.equal(w.count(p,'ammo_shell'),beforeAmmo-1);assert(p.reload);
 rejected(w,()=>sell(w,p,gun),'shell insertion busy');accepted(send(w,p,'CancelWork'));assert.equal(p.reload,null);const money=w.s.bank.credits;accepted(sell(w,p,gun));assert.equal(w.s.bank.credits,money+101);
 rejected(w,()=>send(w,p,'Reload'),'reload sold shotgun');assert.equal(w.count(p,'ammo_shell'),beforeAmmo-1);w.assertInvariants();
});

test('UseQuick -> Sell consumes one item, stales the old quote and sells only the remainder',()=>{
 const {w,p}=fixture(),coffee=w.createItem('coffee_flask',2,w.bag(p));accepted(send(w,p,'BindQuick',{itemId:coffee.id}));accepted(send(w,p,'SwitchEquip',{slot:'quick'}));w.s.time+=.4;p.stamina=20;
 const revision=coffee.revision;accepted(send(w,p,'UseQuick'));assert.equal(coffee.quantity,1);assert.equal(p.stamina,60);const cooldown=p.toolCooldowns.coffee_flask;
 rejected(w,()=>sell(w,p,coffee,1,revision),'pre-use quote');const money=w.s.bank.credits;accepted(sell(w,p,coffee));assert.equal(w.s.bank.credits,money+12);assert.equal(p.toolCooldowns.coffee_flask,cooldown);assert.equal(w.count(p,'coffee_flask'),0);w.assertInvariants();
});

test('Sell -> UseQuick cannot heal from sold supplies or refund them',()=>{
 const {w,p}=fixture(),coffee=w.createItem('coffee_flask',1,w.bag(p));accepted(send(w,p,'BindQuick',{itemId:coffee.id}));accepted(send(w,p,'SwitchEquip',{slot:'quick'}));w.s.time+=.4;p.stamina=20;
 accepted(sell(w,p,coffee));rejected(w,()=>send(w,p,'UseQuick'),'use sold coffee');assert.equal(p.stamina,20);assert.equal(w.count(p,'coffee_flask'),0);
});

test('Upgrade -> Sell denies a live work order, then returns half only of paid C and none of paid M',()=>{
 const {w,p}=fixture(),gun=w.equipped(p,'weapon'),start=structuredClone(w.s.bank),startQuote=price(w,gun),revision=gun.revision;at(w,p,'upgrade');w.addItems(w.bag(p),'field_core',1);
 accepted(send(w,p,'Upgrade',{stationId:'upgrade'},{targetId:gun.id,expectedRevision:revision}));const work=structuredClone(p.work);at(w,p,'recycle');rejected(w,()=>sell(w,p,gun),'active upgrade');assert.deepEqual(p.work,work);
 // Return to the exact work origin without advancing simulation; command ordering fixture.
 Object.assign(p,{x:work.startX,z:work.startZ});p.input.interact=true;w.updateWork(p,work.duration+.01);assert.equal(p.work,null);assert.equal(gun.level,2);assert.equal(w.s.bank.reservedCredits,0);assert.equal(w.s.bank.reservedMaterials,0);
 at(w,p,'recycle');rejected(w,()=>sell(w,p,gun,1,revision),'pre-upgrade quote');accepted(sell(w,p,gun));assert.equal(w.s.bank.credits,start.credits-config.weapon_upgrade.cost_c+startQuote+Math.floor(config.weapon_upgrade.cost_c*.5));assert.equal(w.s.bank.materials,start.materials-config.weapon_upgrade.cost_m);w.assertInvariants();
});

test('Sell -> Upgrade cannot charge or reserve funds for a removed weapon',()=>{
 const {w,p}=fixture(),gun=w.equipped(p,'weapon');accepted(sell(w,p,gun));at(w,p,'upgrade');rejected(w,()=>send(w,p,'Upgrade',{stationId:'upgrade'},{targetId:gun.id,expectedRevision:gun.revision}),'upgrade sold item');assert.equal(p.work,null);
});

test('Deposit skips locked loot, ordinary supplies and crafting materials without destroying them',()=>{
 const {w,p}=fixture(),locked=w.createItem('catch_shore',2,w.bag(p)),free=w.createItem('catch_silver',1,w.bag(p)),scrap=w.createItem('scrap',3,w.bag(p));locked.lockedBy=p.id;
 const original=structuredClone(locked),originalScrap=structuredClone(scrap),ammo=itemOf(w,p,'ammo_light'),money=structuredClone(w.s.bank);accepted(send(w,p,'Deposit',{stationId:'recycle'}));assert.deepEqual(locked,original);assert(w.s.items[ammo.id]);assert.equal(w.s.items[free.id],undefined);assert.deepEqual(w.s.items[scrap.id],originalScrap);assert.equal(w.s.bank.credits,money.credits+20);assert.equal(w.s.bank.materials,money.materials);
 delete locked.lockedBy;accepted(send(w,p,'Deposit',{stationId:'recycle'}));assert.equal(w.s.bank.credits,money.credits+36);assert.equal(w.s.items[locked.id],undefined);assert.deepEqual(w.s.items[scrap.id],originalScrap);accepted(sell(w,p,scrap));assert.equal(w.s.items[scrap.id],undefined);assert.equal(w.s.bank.materials,money.materials+3);w.assertInvariants();
});

test('night DOWNED keeps items until real death; rescue retains those same instances and loaded ammo',()=>{
 const {w,p,ps}=fixture(2),q=ps[1];w.startNight();w.s.enemies={};w.s.night.pending=[];at(w,p,{x:20,z:20});at(w,q,{x:21,z:20});const before=ledger(w);
 w.damageQueue.push({target:p.id,actorId:'synthetic-enemy',damage:100});w.resolveDamage();assert.equal(p.lifeState,'DOWNED');w.resolveNight();assert.equal(w.s.phase,'NIGHT');assert.deepEqual(w.s.items,before.items);assert.deepEqual(w.s.containers,before.containers);assert.equal(w.s.statistics.deaths,0);
 accepted(send(w,q,'Revive',{}, {targetId:p.id}));for(let i=0;i<181;i++){w.input(q,{seq:q.inputAck+1,interact:true});w.step(1/30);}assert.equal(p.lifeState,'ALIVE');assert.equal(p.hp,30);assert.equal(p.revivesUsed,1);assert.deepEqual(w.s.items,before.items);assert.deepEqual(w.s.containers,before.containers);assert.equal(w.s.statistics.deaths,0);w.assertInvariants();
});

test('DOWNED expiry occurs at the actual 60-second deadline rather than at first lethal damage',()=>{
 const {w,p,ps}=fixture(2);w.startNight();w.s.enemies={};w.s.night.pending=[];const ids=Object.keys(w.s.items).sort();w.damageQueue.push({target:p.id,actorId:'synthetic-enemy',damage:100});w.resolveDamage();assert.equal(p.downedRemaining,60);
 w.updatePlayer(p,59.99);w.resolveDamage();w.updateLife(59.99);assert.equal(p.lifeState,'DOWNED');assert.equal(w.s.statistics.deaths,0);w.updatePlayer(p,.011);w.resolveDamage();w.updateLife(.011);assert.equal(p.lifeState,'DEAD_WAIT');assert.equal(w.s.statistics.deaths,1);assert.equal(ps[1].lifeState,'ALIVE');assert.deepEqual(Object.keys(w.s.items).sort(),ids);w.assertInvariants();
});

test('individual death leaves the existing shared cabinet, its item identities and shared bank unchanged',()=>{
 const {w,p,ps}=fixture(2);w.createItem('rifle',1,w.s.containers.storage,{magazineAmmo:3,level:2});w.createItem('scrap',7,w.s.containers.storage);const cabinet=structuredClone(w.s.containers.storage),stored=cabinet.itemIds.map(id=>structuredClone(w.s.items[id])),bank=structuredClone(w.s.bank),qIds=[...w.bag(ps[1]).itemIds,...Object.values(ps[1].equipment).flatMap(id=>w.s.containers[id].itemIds)];
 w.die(p);assert.deepEqual(w.s.containers.storage,cabinet);assert.deepEqual(cabinet.itemIds.map(id=>w.s.items[id]),stored);assert.deepEqual(w.s.bank,bank);assert(qIds.every(id=>w.s.items[id]));w.assertInvariants();
});

test('N+2 corpse expiry waits through PREP and occurs on beginDayBarrier, while newer recovery loot survives',()=>{
 const {w,p}=fixture();assert.equal(config.recovery.bag_retention_days,2);w.die(p);const corpse=Object.values(w.s.containers).find(c=>c.type==='corpse'),ids=[...corpse.itemIds];assert.equal(corpse.createdDay,1);assert.equal(corpse.expiresAfterDay,3);w.respawn(p);
 const newer=w.createContainer('recovery',2,{x:10,y:w.ground(10,0),z:0,createdDay:2,expiresAfterDay:4,recoverableC:5,recoverableM:3});w.createItem('scrap',1,newer);
 w.s.dayIndex=2;w.setPhase('PREP');w.beginDayBarrier();assert(w.s.containers[corpse.id]);w.finishDayBarrier();w.s.dayIndex=3;w.setPhase('PREP');assert(w.s.containers[corpse.id]);
 const restored=new SurvivalWorld(config,w.serialize(),{onlineRoster:true});assert.equal(restored.s.containers[corpse.id].expiresAfterDay,3);restored.beginDayBarrier();assert.equal(restored.s.containers[corpse.id],undefined);assert(ids.every(id=>!restored.s.items[id]));assert(restored.s.containers[newer.id]);assert.equal(restored.s.containers[newer.id].recoverableC,5);restored.assertInvariants();
});

test('a defeat that enters the expiry day cleans old ground bags immediately, not after the rebuild day',()=>{
 const {w,p}=fixture();w.die(p);const old=Object.values(w.s.containers).find(c=>c.type==='corpse'),ids=[...old.itemIds];w.respawn(p);w.s.dayIndex=2;w.startNight();w.defeat();
 assert.equal(w.s.dayIndex,3);assert.equal(w.s.phase,'RECOVERY');assert.equal(w.s.containers[old.id],undefined);assert(ids.every(id=>!w.s.items[id]));const box=Object.values(w.s.containers).find(c=>c.type==='recovery');assert.equal(box.createdDay,3);assert.equal(box.expiresAfterDay,5);w.assertInvariants();
 // No assertion about the unanswered shared-cabinet defeat loss policy.
});

test('partial scrap Sell advances supply once per request, while an ordinary tool sale does not advance it',()=>{
 const {w,p}=fixture();w.setPhase('DAY');w.generateDay();at(w,p,'recycle');
 const o=w.director.newObjective(config.director.objectives.find(x=>x.id==='priority_supply'));w.s.director.objective=o;w.s.director.optionalObjective=null;
 const scrap=w.createItem('scrap',o.goal+2,w.bag(p)),before=w.s.bank.materials;
 const message={requestId:p.requestHighWater+1,command:'Sell',payload:{itemId:scrap.id,quantity:3,stationId:'recycle'},expectedRevision:scrap.revision};
 const result=accepted(w.command(p,message));assert.equal(result.data.materials,3);assert.equal(o.progress,3);assert.equal(o.seen.length,1);assert.equal(w.s.bank.materials,before+3);
 const after=ledger(w);assert.deepEqual(w.command(p,message),result);assert.deepEqual(ledger(w),after);assert.equal(o.progress,3);assert.equal(o.seen.length,1);
 const coffee=w.createItem('coffee_flask',1,w.bag(p)),money=w.s.bank.credits;
 const toolResult=accepted(sell(w,p,coffee));assert.equal(toolResult.data.materials,0);assert.equal(w.s.bank.credits,money+12);assert.equal(o.progress,3);assert.equal(o.seen.length,1);assert.equal(o.completed,false);w.assertInvariants();
});

test('supply goal reached by Sell grants one reward across replay, excess sale and save restoration',()=>{
 const {w,p,ps}=fixture(2);w.setPhase('DAY');w.generateDay();for(const player of ps)at(w,player,'recycle');
 const o=w.director.newObjective(config.director.objectives.find(x=>x.id==='priority_supply'));w.s.director.objective=o;w.s.director.optionalObjective=null;
 const scrap=w.createItem('scrap',o.goal+2,w.bag(p));accepted(sell(w,p,scrap,3));
 const message={requestId:p.requestHighWater+1,command:'Sell',payload:{itemId:scrap.id,quantity:o.goal-3,stationId:'recycle'},expectedRevision:scrap.revision};
 const before=w.s.bank.materials,result=accepted(w.command(p,message));assert.equal(result.data.materials,o.goal-3);assert.equal(w.s.bank.materials,before+o.goal-3);assert.equal(o.progress,o.goal);assert.equal(o.completed,true);assert.equal(o.seen.length,2);
 const key='objective:'+o.id,rewardId=o.rewardContainerId,rewardItems=[...w.s.containers[rewardId].itemIds];
 const verify=world=>{const actual=world.s.director.objective;assert.equal(actual.progress,actual.goal);assert.equal(actual.rewardContainerId,rewardId);assert.equal(world.s.director.rewardLedger.filter(x=>x===key).length,1);assert.equal(Object.values(world.s.containers).filter(c=>c.objectiveId===o.id).length,1);assert.deepEqual(world.s.containers[rewardId].itemIds,rewardItems);for(const player of Object.values(world.s.players))assert.equal(player.rewardOffers.filter(x=>x.id===key+':slot:'+player.slotId).length,1);world.assertInvariants();};
 verify(w);const after=ledger(w);assert.deepEqual(w.command(p,message),result);assert.deepEqual(ledger(w),after);verify(w);
 accepted(sell(w,p,scrap,2));assert.equal(o.seen.length,2);assert.equal(w.events.filter(e=>e.eventType==='ObjectiveCompleted'&&e.payload.objective.id===o.id).length,1);verify(w);
 const restored=new SurvivalWorld(config,w.serialize(),{onlineRoster:true});verify(restored);
 const rp=restored.s.players[p.id],savedBank=structuredClone(restored.s.bank);restored.connect(rp,rp.name);restored.command(rp,message);assert.deepEqual(restored.s.bank,savedBank);verify(restored);
});

