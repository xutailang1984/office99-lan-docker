// In-memory synthetic UUID accounts; no platform, real saves or rendered clients.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../config.mjs';
import {SurvivalWorld} from '../world.mjs';
import {RoomRuntime} from '../room-runtime.mjs';
import {applyMemberResetsToState} from '../member-progress.mjs';

const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function setup({state=null,memberResets=[],memberResetVersion=0,join=true}={}){
  const members=[1,2,3].map(n=>({peerId:'reset-peer-'+n,accountId:uuid(n),name:'合成队员'+n,ready:true}));
  const room={id:'reset-test-room',epoch:1,ownerId:members[0].accountId,hostPeerId:members[0].peerId,status:'running',members};
  const packets=[],saves=[];
  const runtime=new RoomRuntime({config,room,state,memberResets,memberResetVersion,now:()=>0,
    send:(peerId,json)=>packets.push({peerId,message:JSON.parse(json)}),save:async value=>{saves.push(structuredClone(value));return {revision:saves.length};}});
  if(join)for(const member of members)runtime.receive(member.peerId,{type:'hello'});
  const player=n=>runtime.world.s.players[runtime.sessions.get(members[n-1].peerId)?.playerId];
  const entry=(generation=1,active=false)=>({accountId:members[1].accountId,generation,active});
  return {runtime,world:runtime.world,members,room,packets,saves,player,entry};
}

test('empty member resets are a byte-for-byte no-op and first join keeps ordinary starter rules',()=>{
  const f=setup(),state=f.world.serialize(),before=JSON.stringify(state);
  assert.equal(Object.hasOwn(state,'memberResetEpochs'),false);
  assert.deepEqual(applyMemberResetsToState(state,[]),{removedPlayerIds:[],changed:false});assert.equal(JSON.stringify(state),before);
  for(const n of [1,2,3]){const p=f.player(n);assert.equal(p.memberGeneration,0);assert.equal(f.world.equipped(p,'weapon').definitionId,'carbine');assert.equal(f.world.equipped(p,'rod').loanOwnerSlotId,undefined);}
  assert.equal(state.bank.credits,3*config.economy.start_c_per_player);assert.equal(state.bank.materials,3*config.economy.start_m_per_player);
});

test('reset deletes personal growth and containers but retains storage, ordinary corpse drops and shared contributions',()=>{
  const f=setup(),w=f.world,p=f.player(2),teammate=structuredClone(f.player(3));
  const sharedGun=w.equipped(p,'weapon');w.moveItem(sharedGun,w.s.containers.storage);
  const corpse=w.createContainer('corpse',3,{ownerSlotId:p.slotId,x:3,y:1,z:3});
  const normalDrop=w.createItem('bandage',1,corpse),loan=w.createItem('rod_basic',1,corpse,{loanOwnerSlotId:p.slotId});
  p.perks=['precision'];p.rewardOffers=[{id:'test-offer',options:['precision'],selected:'precision'}];p.toolCooldowns={decoy_alarm:100};
  const privateContainers=[p.backpackId,...Object.values(p.equipment)],privateItems=privateContainers.flatMap(id=>w.s.containers[id].itemIds);
  const bank=structuredClone(w.s.bank),buildings=structuredClone(w.s.buildings),storage=structuredClone(w.s.containers.storage);
  const result=applyMemberResetsToState(w.s,[f.entry()]);
  assert.deepEqual(result.removedPlayerIds,[p.id]);assert.equal(w.s.players[p.id],undefined);
  for(const id of privateContainers)assert.equal(w.s.containers[id],undefined);
  for(const id of [...privateItems,loan.id])assert.equal(w.s.items[id],undefined);
  assert.deepEqual(w.s.players[teammate.id],teammate);assert.deepEqual(w.s.bank,bank);assert.deepEqual(w.s.buildings,buildings);assert.deepEqual(w.s.containers.storage,storage);
  assert.deepEqual(w.s.containers[corpse.id].itemIds,[normalDrop.id]);assert.equal(w.s.items[sharedGun.id].containerId,'storage');assert.equal(w.s.items[normalDrop.id].containerId,corpse.id);
  assert.equal(w.s.memberResetEpochs[uuid(2)],1);w.assertInvariants();
  const once=JSON.stringify(w.s);assert.deepEqual(applyMemberResetsToState(w.s,[f.entry()]),{removedPlayerIds:[],changed:false});assert.equal(JSON.stringify(w.s),once);
});

test('reset releases only outstanding reservations, cancels rescue and never refunds completed spending twice',()=>{
  const f=setup(),w=f.world,removed=f.player(2),rescuer=f.player(3),owner=f.player(1);
  const wall=Object.values(w.s.buildings).find(b=>b.id!=='core');
  w.beginWork(owner,{kind:'Repair',targetId:wall.id,duration:10,costC:3,costM:4});
  w.beginWork(removed,{kind:'Repair',targetId:'core',duration:10,costC:5,costM:7});
  removed.lifeState='DOWNED';w.beginWork(rescuer,{kind:'Revive',targetId:removed.id,duration:10,costC:0,costM:0});
  const bank=structuredClone(w.s.bank);
  applyMemberResetsToState(w.s,[f.entry()]);
  assert.equal(w.s.bank.credits,bank.credits);assert.equal(w.s.bank.materials,bank.materials);
  assert.equal(w.s.bank.reservedCredits,3);assert.equal(w.s.bank.reservedMaterials,4);
  assert.equal(w.s.buildings.core.lockedBy,undefined);assert.equal(wall.lockedBy,owner.id);assert(owner.work);
  assert.equal(rescuer.work,null);assert.equal(rescuer.action,'idle');
  applyMemberResetsToState(w.s,[f.entry()]);assert.equal(w.s.bank.reservedCredits,3);assert.equal(w.s.bank.reservedMaterials,4);w.assertInvariants();
});

test('private aggro, personal temporary projectiles and decoys are cleared without deleting the shared monster',()=>{
  const f=setup(),w=f.world,p=f.player(2),other=f.player(1),enemy=w.spawnEnemy('crab',28,24,false);
  Object.assign(enemy,{ownerId:p.id,targetId:p.id,state:'WINDUP',phaseRemaining:1,lockX:p.x,lockY:p.y,lockZ:p.z,chargeHit:[p.id,other.id]});
  w.s.enemyAggro[enemy.id]={targetId:p.id,engagement:{x:p.x,z:p.z,until:4},seenX:p.x,seenZ:p.z,damage:{[p.id]:{value:10,at:0},[other.id]:{value:2,at:0}}};
  w.s.director.deployables.push({id:'personal-decoy',ownerId:p.id},{id:'other-decoy',ownerId:other.id});
  w.s.projectiles.personal={id:'personal',actorId:p.id};w.s.projectiles.aimed={id:'aimed',actorId:enemy.id,targetId:p.id};w.s.projectiles.shared={id:'shared',actorId:enemy.id};
  applyMemberResetsToState(w.s,[f.entry()]);
  assert(w.s.enemies[enemy.id]);assert.equal(enemy.ownerId,null);assert.equal(enemy.targetId,null);assert.equal(enemy.state,'CHASE');assert.equal(enemy.lockX,undefined);assert.deepEqual(enemy.chargeHit,[other.id]);
  assert.equal(w.s.enemyAggro[enemy.id].damage[p.id],undefined);assert(w.s.enemyAggro[enemy.id].damage[other.id]);assert.equal(w.s.enemyAggro[enemy.id].targetId,null);
  assert.deepEqual(Object.keys(w.s.projectiles),['shared']);assert.deepEqual(w.s.director.deployables.map(d=>d.id),['other-decoy']);w.assertInvariants();
});

test('the whole incoming batch is validated before mutation',()=>{
  for(const change of [{accountId:'not-an-account'},{generation:0},{generation:1.5},{active:'false'}]){
    const f=setup(),state=f.world.serialize(),before=JSON.stringify(state);
    assert.throws(()=>applyMemberResetsToState(state,[f.entry(),{...f.entry(),accountId:uuid(3),...change}]));assert.equal(JSON.stringify(state),before);
  }
  const f=setup(),state=f.world.serialize();assert.throws(()=>applyMemberResetsToState(state,[f.entry(),f.entry()]));assert.equal(state.memberResetEpochs,undefined);
});

test('old snapshot replay is filtered repeatedly, including after the account becomes active again',()=>{
  const f=setup(),old=f.world.serialize(),oldId=f.player(2).id;
  for(const active of [false,true]){
    const replay=structuredClone(old);applyMemberResetsToState(replay,[f.entry(1,active)]);assert.equal(replay.players[oldId],undefined);
    const restored=new SurvivalWorld(config,replay,{onlineRoster:true});assert.equal(restored.s.players[oldId],undefined);restored.assertInvariants();
  }
});

test('deleting a middle player allocates a new monotonic slot without overwriting the third player',()=>{
  const f=setup(),third=structuredClone(f.player(3)),old=f.player(2);
  f.runtime.applyMemberResets([f.entry()],1);assert.equal(f.runtime.sessions.has(f.members[1].peerId),false);
  f.runtime.receive(f.members[1].peerId,{type:'hello'});assert.equal(f.player(2),undefined,'inactive record blocks stale hello');
  f.runtime.applyMemberResets([f.entry(1,true)],2);f.runtime.receive(f.members[1].peerId,{type:'hello'});
  assert.equal(f.player(2).id,'player-4');assert.equal(f.player(2).slotId,4);assert.equal(f.player(2).memberGeneration,1);
  assert.equal(f.world.s.players[old.id],undefined);assert.deepEqual(f.world.s.players[third.id],third);f.world.assertInvariants();
});

test('legacy next-slot migration remembers a removed highest slot before filtering and restoring',()=>{
  const f=setup(),state=f.world.serialize();delete state.nextPlayerSlotId;
  applyMemberResetsToState(state,[{accountId:uuid(3),generation:1,active:false}]);assert.equal(state.nextPlayerSlotId,4);
  const w=new SurvivalWorld(config,state,{onlineRoster:true}),p=w.allocate('合成新队员','account:'+uuid(9));assert.equal(p.slotId,4);assert(w.s.players['player-1']);assert(w.s.players['player-2']);w.assertInvariants();
  const older=f.world.serialize();older.nextPlayerSlotId=1;const migrated=new SurvivalWorld(config,older,{onlineRoster:true});assert.equal(migrated.allocate('合成新队员','account:'+uuid(9)).slotId,4);
});

test('repeated forgetting and rejoining cannot farm starter wallet, ammo, bandages or sellable equipment',()=>{
  const f=setup(),initialBank=structuredClone(f.world.s.bank);let version=0;
  for(let generation=1;generation<=6;generation++){
    f.runtime.applyMemberResets([f.entry(generation,false)],++version);f.runtime.applyMemberResets([f.entry(generation,true)],++version);
    f.runtime.receive(f.members[1].peerId,{type:'hello',memberGeneration:0,gm:true});const p=f.player(2);
    assert.equal(p.memberGeneration,generation);assert.equal(p.slotId,generation+3);assert.equal(p.heldSlot,'rod');assert.equal(f.world.equipped(p,'weapon'),undefined);
    assert.deepEqual(f.world.bag(p).itemIds,[]);assert.deepEqual(f.world.s.bank,initialBank);assert.deepEqual(p.perks,[]);assert.deepEqual(p.rewardOffers,[]);
    for(const slot of ['rod','melee']){const item=f.world.equipped(p,slot);assert.equal(item.loanOwnerSlotId,p.slotId);assert.equal(f.world.saleQuote(item,1),null);}
    f.world.assertInvariants();
  }
});

test('room reset versions ignore late inactive messages and duplicate updates after a new-generation hello',()=>{
  const f=setup();f.runtime.applyMemberResets([f.entry()],7);f.runtime.applyMemberResets([f.entry(1,true)],8);f.runtime.receive(f.members[1].peerId,{type:'hello'});
  const p=structuredClone(f.player(2));
  assert.equal(f.runtime.applyMemberResets([f.entry()],7).ignored,true);assert.equal(f.runtime.applyMemberResets([f.entry()],8).ignored,true);
  assert.deepEqual(f.player(2),p);assert.equal(f.runtime.lastMemberResetVersion,8);assert.equal(Object.hasOwn(f.world.serialize(),'lastMemberResetVersion'),false);
  // A lower account generation cannot delete the new generation even under a newer transport version.
  f.runtime.applyMemberResets([f.entry(2,true)],9);f.runtime.receive(f.members[1].peerId,{type:'hello'});const current=f.player(2).id;
  f.runtime.applyMemberResets([f.entry(1,false)],10);assert.equal(f.player(2).id,current);
});

test('Runtime initialization applies central resets before any returning hello and does not persist room-specific version',()=>{
  const original=setup(),oldId=original.player(2).id,state=original.world.serialize();
  const f=setup({state,memberResets:[original.entry(1,true)],memberResetVersion:14});
  assert.equal(f.world.s.players[oldId],undefined);assert.equal(f.player(2).memberGeneration,1);assert.equal(f.player(2).slotId,4);assert.equal(f.runtime.lastMemberResetVersion,14);
  assert.equal(f.world.s.memberResetVersion,undefined);assert.equal(f.runtime.state().players.find(p=>p.id===f.player(2).id).memberGeneration,undefined);
});

test('Runtime clears removed sessions and pending private hits while ordinary commands cannot invoke reset',()=>{
  const f=setup(),removed=f.player(2),owner=f.player(1),before=JSON.stringify(f.world.s);
  f.runtime.receive(f.members[0].peerId,{type:'member_resets',memberResets:[f.entry()],memberResetVersion:1});assert.equal(JSON.stringify(f.world.s),before);
  f.runtime.receive(f.members[0].peerId,{type:'command',command:'MemberReset',requestId:1,payload:{memberResets:[f.entry()]}});assert(f.world.s.players[removed.id]);assert.equal(f.world.s.memberResetEpochs,undefined);
  f.world.damageQueue=[{actorId:removed.id,target:'core',damage:3},{actorId:'enemy-test',target:removed.id,damage:3},{actorId:owner.id,target:'core',damage:3}];
  f.world.events.push({type:'event',eventType:'Spawned',payload:{id:removed.id}},{type:'event',eventType:'Hit',payload:{actorId:removed.id,targetId:owner.id}});
  const result=f.runtime.applyMemberResets([f.entry()],1);assert.deepEqual(result.removedPlayerIds,[removed.id]);assert.equal(f.runtime.sessions.has(f.members[1].peerId),false);
  assert.deepEqual(f.world.damageQueue,[{actorId:owner.id,target:'core',damage:3}]);assert(!f.world.events.some(e=>e.payload?.id===removed.id||e.payload?.actorId===removed.id));
});

test('GM contribution and its durable receipt remain after personal progress is forgotten',async()=>{
  const f=setup(),grant={id:uuid(20),roomId:f.room.id,epoch:f.room.epoch,hostPeerId:f.members[0].peerId,peerId:f.members[1].peerId,accountId:uuid(2),resources:{credits:51,materials:19}};
  await f.runtime.applyGmGrant(grant);const bank=structuredClone(f.world.s.bank),ledger=structuredClone(f.world.s.gmGrants);
  f.runtime.applyMemberResets([f.entry()],1);await f.runtime.save();assert.deepEqual(f.saves.at(-1).bank,bank);assert.deepEqual(f.saves.at(-1).gmGrants,ledger);
  const restored=setup({state:f.saves.at(-1),memberResets:[f.entry(1,true)],memberResetVersion:0});assert.deepEqual(restored.world.s.bank,bank);assert.deepEqual(restored.world.s.gmGrants,ledger);assert.equal(restored.player(2).memberGeneration,1);
});
