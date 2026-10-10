import {randomUUID} from './portable-id.mjs';
import {MODULE_BY_ID} from './crafting-config.mjs';
import {ATTACHMENT_BY_ID,validAttachment} from './assembly-config.mjs';
import {collectionOf} from './social-config.mjs';

const clone=value=>structuredClone(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const integer=(value,min=0,max=1000000000)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const assert=(ok,message='Invalid career capsule')=>{if(!ok)throw Error(message);};
const accountPlayer=(state,accountId)=>Object.values(state.players??{}).find(p=>p.tokenHash==='account:'+accountId);
const itemCopy=item=>({id:item.id,definitionId:item.definitionId,quantity:item.quantity,level:item.level??1,magazineAmmo:item.magazineAmmo??0,revision:item.revision??1,...(item.moduleId?{moduleId:item.moduleId}:{}),...(item.attachmentId?{attachmentId:item.attachmentId}:{}),...(item.crafted===true?{crafted:true}:{})});

export function validateCareerCapsule(capsule,config=null) {
 assert(object(capsule)&&capsule.schema===1&&object(capsule.wallet)&&integer(capsule.wallet.credits)&&integer(capsule.wallet.materials));
 capsule.collection=collectionOf(capsule.collection);
 assert(integer(capsule.bagSlots,1,64)&&Array.isArray(capsule.backpack)&&capsule.backpack.length<=capsule.bagSlots&&Array.isArray(capsule.vault)&&capsule.vault.length<=32&&object(capsule.equipment));
 for(const key of ['perks','blueprints'])assert(Array.isArray(capsule[key])&&capsule[key].length<=64&&capsule[key].every(v=>typeof v==='string'&&v.length<=80)&&new Set(capsule[key]).size===capsule[key].length);
 assert(Array.isArray(capsule.rewardOffers)&&capsule.rewardOffers.length<=128);
 const seen=new Set(),items=[...capsule.backpack,...capsule.vault];
 for(const slot of ['weapon','rod','melee']){assert(Array.isArray(capsule.equipment[slot])&&capsule.equipment[slot].length<=1);items.push(...capsule.equipment[slot]);}
 for(const item of items){
  assert(object(item)&&typeof item.id==='string'&&item.id.length>0&&item.id.length<=120&&!seen.has(item.id));seen.add(item.id);
  assert(typeof item.definitionId==='string'&&item.definitionId.length<=80&&integer(item.quantity,1,100000)&&integer(item.level,1,20)&&integer(item.magazineAmmo,0,10000)&&integer(item.revision,1));
  assert(item.moduleId===undefined||MODULE_BY_ID[item.moduleId]?.definitionId===item.definitionId);
  assert(item.attachmentId===undefined||typeof item.attachmentId==='string'&&item.attachmentId.length>0&&validAttachment(item));
  if(item.attachmentId&&config)assert(config.items.find(d=>d.id===item.definitionId)?.kind===ATTACHMENT_BY_ID[item.attachmentId].kind);
  if(config){const def=config.items.find(d=>d.id===item.definitionId),weapon=config.weapons.find(d=>d.id===item.definitionId);assert(def&&item.quantity<=def.stack&&item.magazineAmmo<=(weapon?.magazine??0));}
 }
 if(config)for(const slot of ['weapon','rod','melee'])for(const item of capsule.equipment[slot])assert(config.items.find(d=>d.id===item.definitionId)?.kind===slot);
 assert(capsule.quickItemDefinitionId===null||typeof capsule.quickItemDefinitionId==='string'&&capsule.quickItemDefinitionId.length<=80);
 return capsule;
}

export function createCareerCapsule(config) {
 assert(config?.economy&&config?.player,'Career config required');
 const make=(definitionId,quantity=1,magazineAmmo=0)=>({id:'career-'+randomUUID(),definitionId,quantity,magazineAmmo,level:1,revision:1});
 const capsule={schema:1,collection:collectionOf(),wallet:{credits:config.economy.start_c_per_player,materials:config.economy.start_m_per_player},perks:[],rewardOffers:[],blueprints:['shotgun','rod_pro'],backpack:[],equipment:{weapon:[],rod:[],melee:[]},vault:[],bagSlots:config.player.backpack_slots,quickItemDefinitionId:null};
 for(const id of config.economy.start_loadout){const def=config.items.find(d=>d.id===id);capsule.equipment[def.kind].push(make(id,1,config.weapons.find(d=>d.id===id)?.magazine??0));}
 const weapon=config.weapons.find(d=>d.id===capsule.equipment.weapon[0]?.definitionId);
 for(const [id,amount]of [['ammo_light',Math.max(0,config.economy.start_ammo_light-(weapon?.magazine??0))],['bandage',config.economy.start_bandages]]){
  const def=config.items.find(d=>d.id===id);for(let remaining=amount;remaining>0;remaining-=def.stack)capsule.backpack.push(make(id,Math.min(def.stack,remaining)));
 }
 return validateCareerCapsule(capsule,config);
}

export function extractCareerCapsule(state,accountId) {
 const p=accountPlayer(state,accountId);assert(p,'Career player missing');
 const items=id=>(state.containers[id]?.itemIds??[]).map(id=>state.items[id]).filter(item=>item&&!item.loanOwnerSlotId).map(itemCopy);
 return validateCareerCapsule({schema:1,collection:collectionOf(p.collection),wallet:{credits:p.wallet?.credits??0,materials:p.wallet?.materials??0},perks:clone(p.perks??[]),rewardOffers:clone(p.rewardOffers??[]),blueprints:clone(p.blueprints??['shotgun','rod_pro']),backpack:items(p.backpackId),equipment:Object.fromEntries(['weapon','rod','melee'].map(slot=>[slot,items(p.equipment[slot])])),vault:items(p.vaultId),bagSlots:state.containers[p.backpackId]?.slotLimit??12,quickItemDefinitionId:p.quickItemDefinitionId??null});
}

export function safeCareerExit(state,accountId,config) {
 const p=accountPlayer(state,accountId);
 if(!p||p.lifeState!=='ALIVE'||state.phase==='NIGHT'||state.phase==='COMPLETE'||p.swimming||p.work||p.fishing||p.reload||p.meleePending||state.time-(p.damageAt??-100)<5)return false;
 const core=state.buildings?.core;
 const atCore=core?.hp>0&&Math.hypot(p.x-(core.x??0),p.z-(core.z??0))<=14;
 const atLocker=(config?.level?.terminals??[]).some(t=>t.type==='storage'&&Math.hypot(p.x-t.x,p.z-t.z)<=3);
 return atCore||atLocker;
}

// Used on both sides of the durable handoff. Never reuse local player slot IDs.
export function stripCareerPlayer(state,accountId,{dropCarried=false}={}) {
 const p=accountPlayer(state,accountId);if(!p)return false;
 const ids=new Set([p.backpackId,p.vaultId,...Object.values(p.equipment??{})].filter(Boolean));
 const carried=new Set([p.backpackId,...Object.values(p.equipment??{})]);
 let drop=null;
 if(dropCarried){const id='career-drop-'+randomUUID();drop={id,type:'corpse',slotLimit:64,itemIds:[],revision:1,x:p.x,y:p.y,z:p.z,createdDay:state.dayIndex,expiresAfterDay:state.dayIndex+2,state:'available',hasContent:false};}
 for(const item of Object.values(state.items??{}))if(ids.has(item.containerId)||item.loanOwnerSlotId===p.slotId){
  if(drop&&carried.has(item.containerId)&&!item.loanOwnerSlotId){item.containerId=drop.id;item.revision++;drop.itemIds.push(item.id);}
  else {const from=state.containers[item.containerId];if(from){from.itemIds=from.itemIds.filter(id=>id!==item.id);from.revision++;}delete state.items[item.id];}
 }
 if(drop?.itemIds.length){drop.hasContent=true;state.containers[drop.id]=drop;}
 if(p.work&&!p.work.personalFunds){state.bank.reservedCredits=Math.max(0,state.bank.reservedCredits-(p.work.costC??0));state.bank.reservedMaterials=Math.max(0,state.bank.reservedMaterials-(p.work.costM??0));}
 for(const collection of ['items','buildings','turrets','nodes','destructibles','players','containers'])for(const entity of Object.values(state[collection]??{}))if(entity.lockedBy===p.id)delete entity.lockedBy;
 for(const debris of Object.values(state.recovery?.debris??{}))if(debris.lockedBy===p.id)delete debris.lockedBy;
 for(const id of ids)delete state.containers[id];delete state.players[p.id];
 for(const e of Object.values(state.enemies??{})){if(e.targetId===p.id){e.targetId=null;e.attackZone=null;e.phaseRemaining=0;}if(e.ownerId===p.id)e.ownerId=null;}
 for(const [id,shot]of Object.entries(state.projectiles??{}))if(shot.actorId===p.id||shot.ownerId===p.id||shot.targetId===p.id)delete state.projectiles[id];
 for(const row of Object.values(state.enemyAggro??{})){if(row.damage)delete row.damage[p.id];if(row.targetId===p.id){row.targetId=null;row.engagement=null;row.scanAt=0;}}
 if(state.hostId===p.id)state.hostId=null;
 return true;
}

export function importCareerCapsule(world,p,binding) {
 const capsule=validateCareerCapsule(binding.capsule,world.c);
 const containers=[p.backpackId,...Object.values(p.equipment)];
 for(const id of containers)for(const itemId of [...world.s.containers[id].itemIds])world.removeItem(world.s.items[itemId]);
 const vault=world.createContainer('personal_storage',32,{ownerSlotId:p.slotId});p.vaultId=vault.id;
 p.wallet={...clone(capsule.wallet),reservedCredits:0,reservedMaterials:0,revision:1};p.perks=clone(capsule.perks);p.rewardOffers=clone(capsule.rewardOffers);p.blueprints=clone(capsule.blueprints);p.quickItemDefinitionId=capsule.quickItemDefinitionId;p.careerRevision=binding.revision;p.collection=collectionOf(capsule.collection);
 world.bag(p).slotLimit=capsule.bagSlots;
 p.perkBackpackApplied=capsule.perks.includes('pockets');
 const put=(item,container)=>{assert(!world.s.items[item.id],'Duplicate imported asset');const v={...itemCopy(item),containerId:container.id};world.s.items[v.id]=v;container.itemIds.push(v.id);container.revision++;};
 capsule.backpack.forEach(item=>put(item,world.bag(p)));capsule.vault.forEach(item=>put(item,vault));
 for(const slot of ['weapon','rod','melee'])capsule.equipment[slot].forEach(item=>put(item,world.s.containers[p.equipment[slot]]));
 world.assertInvariants();return p;
}
