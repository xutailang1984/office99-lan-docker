const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const requireThat=condition=>{if(!condition)throw Error('Invalid member reset data');};
const personalTypes=new Set(['backpack','equip_weapon','equip_rod','equip_melee']);

// Pure state mutation shared by the central save filter and host Runtime.
// A reset removes personal ownership, never reverses completed team spending,
// contributions, ordinary world drops, or fortress construction.
export function applyMemberResetsToState(state,entries) {
  requireThat(object(state)&&object(state.players)&&object(state.items)&&object(state.containers)&&object(state.bank)&&Array.isArray(entries));
  if(entries.length===0)return {removedPlayerIds:[],changed:false};
  requireThat(state.memberResetEpochs===undefined||object(state.memberResetEpochs));
  const ledger=state.memberResetEpochs??{},effective=new Map(),seen=new Set();
  for(const [accountId,generation]of Object.entries(ledger)){
    requireThat(uuid.test(accountId)&&positive(generation));
    effective.set(accountId,{accountId,generation,active:true});
  }
  // Validate the entire batch before any mutation, including ambiguous duplicates.
  for(const entry of entries){
    requireThat(object(entry)&&typeof entry.accountId==='string'&&uuid.test(entry.accountId)&&positive(entry.generation)&&typeof entry.active==='boolean'&&!seen.has(entry.accountId));
    seen.add(entry.accountId);
    if(entry.generation>=(effective.get(entry.accountId)?.generation??0))effective.set(entry.accountId,{...entry});
  }
  let changed=false;
  for(const entry of effective.values())if((ledger[entry.accountId]??0)<entry.generation){ledger[entry.accountId]=entry.generation;changed=true;}
  if(effective.size&&!state.memberResetEpochs)state.memberResetEpochs=ledger;
  const removedPlayerIds=[],slots=new Set();
  let nextSlot=positive(state.nextPlayerSlotId)?state.nextPlayerSlotId:1;
  for(const p of Object.values(state.players)){
    if(positive(p.slotId))nextSlot=Math.max(nextSlot,p.slotId+1);
    const match=/^player-(\d+)$/.exec(p.id??'');if(match&&positive(Number(match[1])))nextSlot=Math.max(nextSlot,Number(match[1])+1);
    const entry=typeof p.tokenHash==='string'&&p.tokenHash.startsWith('account:')?effective.get(p.tokenHash.slice(8)):null;
    if(entry&&(!entry.active||(Number.isSafeInteger(p.memberGeneration)?p.memberGeneration:0)<entry.generation)){
      requireThat(positive(p.slotId));
      removedPlayerIds.push(p.id);slots.add(p.slotId);
    }
  }
  if(!removedPlayerIds.length)return {removedPlayerIds,changed};
  requireThat(positive(nextSlot));state.nextPlayerSlotId=nextSlot;
  const players=new Set(removedPlayerIds),containers=new Set(),items=new Set();
  for(const c of Object.values(state.containers))if(slots.has(c.ownerSlotId)&&personalTypes.has(c.type))containers.add(c.id);
  for(const item of Object.values(state.items))if(containers.has(item.containerId)||slots.has(item.loanOwnerSlotId))items.add(item.id);
  const invalidTargets=new Set([...players,...items]);
  const targets=[...Object.values(state.players),...Object.values(state.items),...Object.values(state.buildings??{}),...Object.values(state.turrets??{}),...Object.values(state.nodes??{}),...Object.values(state.containers),...Object.values(state.destructibles??{}),...(state.recovery?.debris??[])];
  for(const p of Object.values(state.players))if(p.work&&(players.has(p.id)||invalidTargets.has(p.work.targetId))){
    const work=p.work;
    const target=targets.find(value=>value.id===work.targetId);if(target?.lockedBy===p.id)delete target.lockedBy;
    // Reservation release only; beginWork never debits the actual shared wallet.
    state.bank.reservedCredits=Math.max(0,(state.bank.reservedCredits??0)-Math.max(0,Number.isFinite(work.costC)?work.costC:0));
    state.bank.reservedMaterials=Math.max(0,(state.bank.reservedMaterials??0)-Math.max(0,Number.isFinite(work.costM)?work.costM:0));
    p.work=null;if(p.action==='interact'){p.action='idle';p.actionDuration=0;}
  }
  for(const target of targets)if(players.has(target.lockedBy))delete target.lockedBy;
  for(const p of Object.values(state.players)){
    if(items.has(p.reload?.itemId))p.reload=null;
    if(items.has(p.meleePending?.itemId))p.meleePending=null;
    if(items.has(p.fishing?.rodId))p.fishing=null;
  }
  for(const c of Object.values(state.containers)){
    if(containers.has(c.id)){delete state.containers[c.id];continue;}
    const filtered=c.itemIds.filter(id=>!items.has(id));
    if(filtered.length!==c.itemIds.length){
      c.itemIds=filtered;c.revision=(c.revision??0)+1;
      c.hasContent=filtered.length>0||(c.recoverableC??0)>0||(c.recoverableM??0)>0;c.state=c.hasContent?'available':'depleted';
    }
  }
  for(const id of items)delete state.items[id];
  for(const id of players)delete state.players[id];

  // Private temporary actors are not fortress structures or normal loot.
  const forgotten=new Set(players);
  if(Array.isArray(state.director?.deployables))state.director.deployables=state.director.deployables.filter(value=>{
    if(players.has(value.ownerId)){forgotten.add(value.id);return false;}return true;
  });
  for(const [id,projectile]of Object.entries(state.projectiles??{}))if(forgotten.has(projectile.actorId)||forgotten.has(projectile.ownerId)||forgotten.has(projectile.targetId))delete state.projectiles[id];
  for(const enemy of Object.values(state.enemies??{})){
    if(forgotten.has(enemy.ownerId))enemy.ownerId=null;
    if(forgotten.has(enemy.targetId)){
      enemy.targetId=null;enemy.attackZone=null;enemy.phaseRemaining=0;enemy.state='CHASE';
      for(const key of ['lockX','lockY','lockZ'])delete enemy[key];
    }
    if(Array.isArray(enemy.chargeHit))enemy.chargeHit=enemy.chargeHit.filter(id=>!forgotten.has(id));
  }
  for(const row of Object.values(state.enemyAggro??{})){
    if(object(row.damage))for(const id of forgotten)delete row.damage[id];
    if(forgotten.has(row.targetId)){row.targetId=null;row.engagement=null;row.scanAt=0;row.seenAt=-100;delete row.seenX;delete row.seenZ;}
  }
  for(const turret of Object.values(state.turrets??{}))if(forgotten.has(turret.targetId))turret.targetId=null;
  if(players.has(state.hostId))state.hostId=null;
  if(!state.hostId)state.paused=true;
  return {removedPlayerIds,changed:true};
}
