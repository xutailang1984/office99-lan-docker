// Synthetic players and in-memory worlds only; no services or persistent data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../config.mjs';
import {SurvivalWorld} from '../world.mjs';
import {RoomRuntime} from '../room-runtime.mjs';
import {createCareerCapsule,extractCareerCapsule,importCareerCapsule,stripCareerPlayer,safeCareerExit} from '../career-state.mjs';

const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
const clone=value=>structuredClone(value);
function fixture(count=1){
 const w=new SurvivalWorld(clone(config),null,{onlineRoster:true}),ps=[],bindings=[];
 for(let i=0;i<count;i++){const binding={accountId:'synthetic-career-'+i,revision:3,capsule:createCareerCapsule(w.c)},p=w.allocate('隔离队员','account:'+binding.accountId,{career:true});importCareerCapsule(w,p,binding);ps.push(p);bindings.push(binding);}
 w.s.time=100;w.s.phase='DAY';for(const p of ps)p.equipUntil=0;
 return {w,ps,p:ps[0],bindings,binding:bindings[0]};
}
function at(w,p,id){const target=typeof id==='string'?w.staticWorld().terminals.find(t=>t.id===id):id;assert(target);Object.assign(p,{x:target.x,y:target.y??w.ground(target.x,target.z),z:target.z,swimming:false});}
const send=(w,p,command,payload={},top={})=>w.command(p,{requestId:p.requestHighWater+1,command,payload,...top});
const accepted=value=>assert.equal(value.ok,true,value.code??value.message);
function runtimeFixture({bindings=true}={}){
 const members=[0,1].map(i=>({peerId:'career-peer-'+i,accountId:'career-account-'+i,name:'合成队员',ready:true}));
 const room={id:'career-room',adventureId:'career-adventure',mode:'adventure',epoch:1,ownerId:members[0].accountId,hostPeerId:members[0].peerId,status:'running',members};
 const profiles=members.map(m=>({accountId:m.accountId,revision:4,capsule:createCareerCapsule(config)})),packets=[],saves=[];
 const runtime=new RoomRuntime({config:clone(config),room,economyVersion:1,economyEpoch:0,careerBindings:bindings?profiles:[],send:(id,json)=>packets.push({id,value:JSON.parse(json)}),save:async state=>{saves.push(clone(state));return {revision:saves.length};}});
 const join=(index=0)=>{runtime.receive(members[index].peerId,{type:'hello'});return runtime.world.s.players[runtime.sessions.get(members[index].peerId)?.playerId];};
 return {runtime,room,members,profiles,packets,saves,join};
}

test('career allocation imports one starter kit without adding team subsidies or repeating on reconnect',()=>{
 const {runtime,join,members,profiles}=runtimeFixture(),p=join(),w=runtime.world,bank=clone(w.s.bank),ids=Object.keys(w.s.items).sort();
 assert.equal(bank.credits,0);assert.equal(bank.materials,0);assert.equal(p.wallet.credits,profiles[0].capsule.wallet.credits);
 runtime.disconnect(members[0].peerId);assert.equal(join().id,p.id);assert.deepEqual(w.s.bank,bank);assert.deepEqual(Object.keys(w.s.items).sort(),ids);w.assertInvariants();
});

test('purchase, sale, and loot recycling affect only the acting personal wallet',()=>{
 const {w,p,ps}=fixture(2);p.wallet.credits=1000;p.wallet.materials=100;const team=clone(w.s.bank),other=clone(ps[1].wallet);
 at(w,p,'terminal');const price=w.defs.items.bandage.buy_c,before=p.wallet.credits;accepted(send(w,p,'Buy',{definitionId:'bandage',stationId:'terminal'}));assert.equal(p.wallet.credits,before-price);
 const item=w.bag(p).itemIds.map(id=>w.s.items[id]).find(i=>i.definitionId==='bandage');at(w,p,'recycle');const quote=w.saleQuote(item,1),saleBefore=p.wallet.credits;accepted(send(w,p,'Sell',{itemId:item.id,quantity:1,stationId:'recycle'},{expectedRevision:item.revision}));assert.equal(p.wallet.credits,saleBefore+quote.credits);
 const loot=w.c.items.find(d=>['loot','catch','material'].includes(d.kind)&&!d.crafting_material&&d.sell_c>0);w.createItem(loot.id,1,w.bag(p));const recycleBefore=clone(p.wallet);accepted(send(w,p,'Deposit',{stationId:'recycle'}));assert.equal(p.wallet.credits,recycleBefore.credits+loot.sell_c);assert.equal(p.wallet.materials,recycleBefore.materials+(loot.deposit_m??0));assert.deepEqual(w.s.bank,team);assert.deepEqual(ps[1].wallet,other);w.assertInvariants();
});

test('donation transfers exact funds once, requires a warehouse, and cannot spend reserved money',()=>{
 const {w,p}=fixture();p.wallet.credits=100;p.wallet.materials=30;at(w,p,'storage');
 const message={requestId:1,command:'Donate',payload:{stationId:'storage',credits:25,materials:7}};accepted(w.command(p,message));accepted(w.command(p,message));assert.equal(p.wallet.credits,75);assert.equal(p.wallet.materials,23);assert.equal(w.s.bank.credits,25);assert.equal(w.s.bank.materials,7);
 const before=clone({wallet:p.wallet,bank:w.s.bank});at(w,p,'terminal');assert.equal(send(w,p,'Donate',{stationId:'storage',credits:1}).ok,false);assert.deepEqual({wallet:p.wallet,bank:w.s.bank},before);
 at(w,p,'storage');p.wallet.reservedCredits=75;assert.equal(send(w,p,'Donate',{stationId:'storage',credits:1}).code,'NO_FUNDS');assert.equal(w.s.bank.credits,25);w.assertInvariants();
});

test('weapon upgrade reserves and spends personal funds without drawing from the team bank',()=>{
 const {w,p}=fixture();p.wallet.credits=1000;p.wallet.materials=100;const bank=clone(w.s.bank),wallet=clone(p.wallet),gun=w.equipped(p,'weapon');at(w,p,'upgrade');w.addItems(w.bag(p),'field_core',1);
 accepted(send(w,p,'Upgrade',{stationId:'upgrade'},{targetId:gun.id,expectedRevision:gun.revision}));assert.equal(p.work.personalFunds,true);assert.equal(p.wallet.reservedCredits,w.c.weapon_upgrade.cost_c);assert.deepEqual(w.s.bank,bank);
 p.input.interact=true;w.updateWork(p,w.c.construction.upgrade_seconds+.1);assert.equal(p.work,null);assert.equal(gun.level,2);assert.equal(p.wallet.credits,wallet.credits-w.c.weapon_upgrade.cost_c);assert.equal(p.wallet.materials,wallet.materials-w.c.weapon_upgrade.cost_m);assert.equal(p.wallet.reservedCredits,0);assert.deepEqual(w.s.bank,bank);w.assertInvariants();
});

test('personal warehouse is accessible only to its owner at a warehouse station',()=>{
 const {w,p,ps}=fixture(2),other=ps[1],gun=w.equipped(p,'weapon');at(w,p,'storage');at(w,other,'storage');accepted(send(w,p,'Transfer',{stationId:'storage',itemId:gun.id,toContainerId:p.vaultId},{expectedRevision:gun.revision}));
 const quantity=Object.keys(w.s.items).length;assert.equal(send(w,other,'Transfer',{stationId:'storage',itemId:gun.id,toContainerId:other.backpackId},{expectedRevision:gun.revision}).ok,false);
 assert.equal(send(w,other,'Pickup',{}, {targetId:p.vaultId,expectedRevision:w.s.containers[p.vaultId].revision}).ok,false);
 at(w,p,{x:100,z:100});assert.equal(send(w,p,'Transfer',{stationId:'storage',itemId:gun.id,toContainerId:p.backpackId},{expectedRevision:gun.revision}).ok,false);
 assert.equal(gun.containerId,p.vaultId);assert.equal(Object.keys(w.s.items).length,quantity);w.assertInvariants();
});

test('death and fortress failure preserve personal vault and wallet while dropping carried gear once',()=>{
 const {w,p}=fixture(),stash=w.createItem('bandage',1,w.s.containers[p.vaultId]),protectedWallet=clone(p.wallet),carried=[...w.bag(p).itemIds,...Object.values(p.equipment).flatMap(id=>w.s.containers[id].itemIds)];
 w.die(p);w.die(p);assert.deepEqual(p.wallet,protectedWallet);assert.equal(stash.containerId,p.vaultId);assert.equal(Object.values(w.s.containers).filter(c=>c.type==='corpse').length,1);for(const id of carried)assert.equal(w.s.containers[w.s.items[id].containerId].type,'corpse');
 w.respawn(p);w.s.phase='NIGHT';w.s.night={...w.s.night,id:'career-night',resolved:false};w.s.buildings.core.hp=0;w.defeat();assert.deepEqual(p.wallet,protectedWallet);assert.equal(w.s.items[stash.id].containerId,p.vaultId);w.assertInvariants();
});

test('borrowed recovery tools cannot be moved into the private vault or exported as owned gear',()=>{
 const {w,p,binding}=fixture();w.die(p);w.respawn(p);at(w,p,'terminal');accepted(send(w,p,'ClaimTool',{definitionId:'rod_basic',stationId:'terminal'}));const loan=w.equipped(p,'rod');assert.equal(loan.loanOwnerSlotId,p.slotId);
 at(w,p,'storage');assert.equal(send(w,p,'Transfer',{stationId:'storage',itemId:loan.id,toContainerId:p.vaultId},{expectedRevision:loan.revision}).ok,false);assert.equal(extractCareerCapsule(w.s,binding.accountId).equipment.rod.length,0);w.assertInvariants();
});

test('safe exit requires an alive settled player near base or a warehouse and outside night combat',()=>{
 const {w,p,binding}=fixture(),safe=()=>safeCareerExit(w.s,binding.accountId,w.c);at(w,p,w.s.buildings.core);assert.equal(safe(),true);
 for(const [key,value]of [['lifeState','DOWNED'],['swimming',true],['work',{}],['fishing',{}],['reload',{}],['meleePending',{}],['damageAt',w.s.time-4]]){const before=p[key];p[key]=value;assert.equal(safe(),false,key);p[key]=before;}
 w.s.phase='NIGHT';assert.equal(safe(),false);w.s.phase='DAY';at(w,p,{x:100,z:100});assert.equal(safe(),false);at(w,p,'emergency_storage');assert.equal(safe(),true);
});

test('abandoning a saved recovery worker releases debris so a teammate can finish rebuilding',()=>{
 const {w,p,ps,binding}=fixture(2),debris={id:'career-recovery-debris',x:4.2,y:w.ground(4.2,0),z:0,done:false,revision:1};
 w.s.buildings.core.hp=0;w.s.recovery={coreReady:false,destroyedSockets:[],duration:420,debris:[debris]};w.setPhase('RECOVERY');
 at(w,p,debris);accepted(send(w,p,'RecoveryWork',{}, {targetId:debris.id}));assert.equal(debris.lockedBy,p.id);
 const saved=w.serialize();stripCareerPlayer(saved,binding.accountId,{dropCarried:true});
 assert.equal(saved.recovery.debris[0].lockedBy,undefined,'removing an offline worker must release its persistent recovery lock');
 const resumed=new SurvivalWorld(clone(config),saved,{onlineRoster:true}),teammate=resumed.s.players[ps[1].id],target=resumed.s.recovery.debris[0];
 resumed.connect(teammate);at(resumed,teammate,target);accepted(send(resumed,teammate,'RecoveryWork',{}, {targetId:target.id}));
 teammate.input.interact=true;resumed.updateWork(teammate,resumed.c.recovery.debris_work_seconds+.1);
 assert.equal(target.done,true);assert.equal(target.lockedBy,undefined);assert.equal(teammate.work,null);resumed.assertInvariants();
});

test('cross-world capsule keeps modules, magazine, crafted marker, perks, offers, and private stash',()=>{
 const {w,p,binding}=fixture();const old=w.equipped(p,'weapon');w.removeItem(old);const gun=w.createItem('shotgun',1,w.s.containers[p.equipment.weapon],{moduleId:'shotgun_stop',crafted:true,level:2,magazineAmmo:2});const oldRod=w.equipped(p,'rod');w.removeItem(oldRod);w.createItem('rod_pro',1,w.s.containers[p.equipment.rod],{moduleId:'rod_rebound',crafted:true});
 const perk=w.c.director.perks[0].id;p.perks=[perk];p.rewardOffers=[{id:'test-reward',source:'test',options:[perk],selected:perk,createdAt:0}];w.createItem('bandage',1,w.s.containers[p.vaultId]);const capsule=extractCareerCapsule(w.s,binding.accountId);
 const next=new SurvivalWorld(clone(config),null,{onlineRoster:true}),newPlayer=next.allocate('跨房队员','account:'+binding.accountId,{career:true});importCareerCapsule(next,newPlayer,{...binding,revision:5,capsule});
 assert.deepEqual(extractCareerCapsule(next.s,binding.accountId),capsule);assert.equal(next.equipped(newPlayer,'weapon').id,gun.id);assert.equal(next.equipped(newPlayer,'weapon').moduleId,'shotgun_stop');assert.equal(newPlayer.careerRevision,5);next.assertInvariants();
});

test('pending hello waits for trusted profile, then creates exactly one imported character',()=>{
 const {runtime,join,profiles,packets}=runtimeFixture({bindings:false});join();join();assert.equal(runtime.sessions.size,0);assert.equal(Object.keys(runtime.world.s.players).length,0);assert.equal(runtime.pendingHellos.size,1);
 runtime.setCareers([profiles[0]]);assert.equal(runtime.sessions.size,1);assert.equal(runtime.pendingHellos.size,0);assert.equal(packets.filter(p=>p.value.type==='welcome').length,1);const ids=Object.keys(runtime.world.s.items);runtime.setCareers([profiles[0]]);assert.deepEqual(Object.keys(runtime.world.s.items),ids);
});

test('holding revisions remain stable across repeated saves and trusted same-revision refreshes',async()=>{
 const {runtime,join,profiles,members}=runtimeFixture(),p=join();for(let i=0;i<3;i++){await runtime.save();runtime.setCareers([clone(profiles[0])]);assert.equal(p.careerRevision,4);assert.equal(runtime.careerBindings.get(members[0].accountId).revision,4);assert.equal(runtime.sessions.size,1);}
});

test('completed handoff removes only the settled actor, preserving teammate and pending world drops',()=>{
 const {runtime,join,profiles,members}=runtimeFixture(),host=join(0),guest=join(1),w=runtime.world,hostGun=w.equipped(host,'weapon'),guestGun=w.equipped(guest,'weapon'),drop=w.createContainer('loot',1,{x:0,y:0,z:0});w.createItem('bandage',1,drop);
 runtime.finishHandoff([members[1].accountId],1);assert.equal(w.s.players[guest.id],undefined);assert.equal(w.s.items[guestGun.id],undefined);assert.ok(w.s.players[host.id]);assert.ok(w.s.items[hostGun.id]);assert.equal(w.s.containers[drop.id].itemIds.length,1);assert.equal(runtime.careerBindings.has(profiles[1].accountId),false);assert.equal(runtime.world.s.economyEpoch,1);w.assertInvariants();
});

test('a late stale profile response cannot replace a newer held revision or delete its live actor',()=>{
 const f=runtimeFixture(),p=f.join(),newer={...clone(f.profiles[0]),revision:5};f.runtime.setCareers([newer]);f.runtime.receive(f.members[0].peerId,{type:'hello'});
 f.runtime.setCareers([f.profiles[0]]);assert.equal(f.runtime.careerBindings.get(f.members[0].accountId).revision,5);assert.ok(Object.values(f.runtime.world.s.players).some(player=>player.tokenHash==='account:'+f.members[0].accountId&&player.careerRevision===5));
});

test('retired peers cannot leave pending hello entries behind or materialize after leaving',()=>{
 const f=runtimeFixture({bindings:false});f.join(1);f.runtime.setRoom({...f.room,members:[f.members[0]]});f.runtime.setCareers(f.profiles);assert.equal(f.runtime.pendingHellos.size,0);assert.equal(f.runtime.sessions.size,0);assert.equal(Object.keys(f.runtime.world.s.players).length,0);
});

test('invalid imported profile fails before creating an empty connected ghost player',()=>{
 const f=runtimeFixture({bindings:false}),broken=clone(f.profiles[0]);broken.capsule.wallet.credits=-1;f.runtime.setCareers([broken]);f.join();
 assert.equal(f.runtime.sessions.size,0);assert.equal(Object.keys(f.runtime.world.s.players).length,0);assert.equal(f.runtime.world.s.bank.credits,0);assert.equal(f.packets.some(packet=>packet.value.code==='JOIN_UNAVAILABLE'),true);
});

test('a profile response from before handoff cannot reimport already exported gear',()=>{
 const f=runtimeFixture();f.join(0);const guest=f.join(1),gun=f.runtime.world.equipped(guest,'weapon');f.runtime.finishHandoff([f.members[1].accountId],1);
 f.runtime.setCareers(f.profiles,0);f.join(1);assert.equal(f.runtime.careerBindings.has(f.members[1].accountId),false);assert.equal(f.runtime.world.s.items[gun.id],undefined);assert.equal(f.runtime.sessions.has(f.members[1].peerId),false);
});
