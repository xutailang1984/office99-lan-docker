import {isBoss} from './night-content-config.mjs';
import {MODULE_BY_ID,GEAR_REFUND_RATE} from './crafting-config.mjs';
import {ATTACHMENT_BY_ID,validAttachment} from './assembly-config.mjs';

function ingredientPlan(w,p,ingredients,need){
 const plan=[];
 for(const cost of ingredients){
  let remaining=cost.quantity;
  for(const id of w.bag(p).itemIds){const item=w.s.items[id];if(!item||item.definitionId!==cost.definitionId||item.lockedBy||item.loanOwnerSlotId)continue;const quantity=Math.min(remaining,item.quantity);if(quantity>0)plan.push({item,quantity});remaining-=quantity;if(!remaining)break;}
  need(remaining===0,'NO_MATERIALS');
 }
 return plan;
}
function consumePlan(w,plan){
 for(const {item,quantity} of plan){if(quantity===item.quantity)w.removeItem(item);else {item.quantity-=quantity;item.revision++;w.s.containers[item.containerId].revision++;}}
}
const moduleFor=item=>MODULE_BY_ID[item?.moduleId];
function merged(rows){const totals=new Map();for(const row of rows)if(row.quantity>0)totals.set(row.definitionId,(totals.get(row.definitionId)??0)+row.quantity);return [...totals].map(([definitionId,quantity])=>({definitionId,quantity}));}
function refund(ingredients){return ingredients.filter(row=>!['field_core','hazard_core'].includes(row.definitionId)).map(row=>({...row,quantity:Math.floor(row.quantity*GEAR_REFUND_RATE)})).filter(row=>row.quantity>0);}
export function gearSalvageQuote(w,item,{moduleOnly=false,attachmentOnly=false}={}){
 const recipe=w.c.crafting.recipes.find(r=>r.definitionId===item?.definitionId),module=moduleFor(item);
 const attachment=ATTACHMENT_BY_ID[item?.attachmentId];
 if(!recipe||item.loanOwnerSlotId||item.moduleId&&module?.definitionId!==item.definitionId||!validAttachment(item,w.defs.items[item.definitionId]?.kind)||moduleOnly&&!module||attachmentOnly&&!attachment)return null;
 const rows=[...(!moduleOnly&&!attachmentOnly?refund(recipe.ingredients):[]),...(!attachmentOnly&&module?refund(module.ingredients):[]),...(!moduleOnly&&attachment?refund(attachment.ingredients):[])];
 const weapon=w.defs.weapons[item.definitionId];
 if(!moduleOnly&&!attachmentOnly&&weapon&&item.magazineAmmo>0)rows.push({definitionId:weapon.ammo,quantity:item.magazineAmmo});
 return merged(rows);
}
function roomForOutputs(w,p,outputs,removedId,need,consumed=[]){
 const bag=w.bag(p),sim=bag.itemIds.filter(id=>id!==removedId).map(id=>{const item=w.s.items[id];return{...item,quantity:item.quantity-consumed.filter(row=>row.item.id===id).reduce((n,row)=>n+row.quantity,0)};}).filter(item=>item.quantity>0);
 for(const row of outputs){let remaining=row.quantity;const def=w.defs.items[row.definitionId];need(def&&Number.isSafeInteger(remaining)&&remaining>0,'INVALID_TARGET');
  for(const item of sim){if(item.definitionId!==row.definitionId||item.lockedBy||item.loanOwnerSlotId)continue;const add=Math.min(remaining,def.stack-item.quantity);item.quantity+=add;remaining-=add;if(!remaining)break;}
  while(remaining>0){need(sim.length<bag.slotLimit,'NO_CAPACITY');const quantity=Math.min(remaining,def.stack);sim.push({definitionId:row.definitionId,quantity});remaining-=quantity;}
 }
}
function resetHandling(w,p){p.gearFocusSeconds=0;p.gearBurstCount=0;p.gearHeatShots=0;p.gearHeatItem=null;p.gearLastShotAt=-100;p.gearWalkDistance=0;p.gearSuppress=null;p.equipUntil=Math.max(p.equipUntil??0,w.s.time+.2);}
export function moduleHit(w,enemy,hit){
 if(hit.moduleId==='rifle_spotter'&&hit.weaponId==='rifle'&&!hit.shielded){enemy.markedUntil=w.s.time+6;enemy.markedBy=hit.actorId;w.event('GearMarked',{actorId:hit.actorId,targetId:enemy.id,duration:6},enemy.id);}
 if(hit.moduleId!=='shotgun_stop'||hit.weaponId!=='shotgun'||(hit.closePelletHits??0)<3||isBoss(enemy)||hit.shielded)return;
 const tier=w.defs.creatures[enemy.definitionId]?.tier;
 if(tier==='elite'){enemy.poiseDamage=(enemy.poiseDamage??0)+Math.min(12,enemy.maxHp*.06);return;}
 if(w.s.time<(enemy.moduleResistUntil??0))return;
 enemy.moduleResistUntil=w.s.time+3;enemy.state='STUNNED';enemy.phaseRemaining=.55;enemy.hitStunRemaining=0;enemy.attackZone=null;enemy.chargeRemaining=0;enemy.chargeHit=[];
 w.event('EnemyInterrupted',{enemyId:enemy.id,role:enemy.role,hitSeq:enemy.hitSeq,duration:.55,moduleId:'shotgun_stop',position:{x:enemy.x,y:enemy.y,z:enemy.z}},enemy.id);
}
export function attachCrafting(w,need){
 const dispatch=w.dispatch.bind(w),catalog=w.catalog.bind(w),react=w.reactToHit.bind(w);
 w.catalog=()=>({...catalog(),crafting:w.c.crafting});
 w.reactToHit=(enemy,hit,direction)=>{react(enemy,hit,direction);moduleHit(w,enemy,hit);};
 w.dispatch=(p,message)=>{
  const {command,payload={},expectedRevision}=message;
  if(command==='Buy')need(!w.defs.items[payload.definitionId]?.craft_only,'CRAFT_ONLY');
  if(!['Craft','ModGear','RemoveModule','DismantleGear','TrialModule','FitAttachment','RemoveAttachment','TrialAttachment'].includes(command))return dispatch(p,message);
  w.requireAction(p);need(!['NIGHT','COMPLETE'].includes(w.s.phase),'WRONG_PHASE');
  need(!p.work&&!p.reload&&!p.fishing&&!p.meleePending,'BUSY');
  if(command==='TrialModule'||command==='TrialAttachment'){
   need(w.mode==='mission'&&w.s.mission?.freePlay,'WRONG_PHASE');
   const item=w.s.items[payload.itemId],module=MODULE_BY_ID[payload.moduleId],attachment=ATTACHMENT_BY_ID[payload.attachmentId],fitting=command==='TrialAttachment';
   need(item&&w.own(p,item)&&item.loanOwnerSlotId===p.slotId&&!item.lockedBy,'INVALID_TARGET');
   need(fitting?(payload.attachmentId===null||attachment?.kind===w.defs.items[item.definitionId]?.kind):(payload.moduleId===null||module?.definitionId===item.definitionId),'INVALID_TARGET');
   const display=w.staticWorld().terminals.find(t=>t.type==='training'&&t.definitionId===item.definitionId);
   need(display&&Math.hypot(p.x-display.x,p.z-display.z)<=w.c.player.interact_distance&&Math.abs(p.y-display.y)<=1.4,'OUT_OF_RANGE');
   need(Number.isSafeInteger(expectedRevision),'STALE_REVISION');w.checkTargetRevision(item,expectedRevision);
   if(fitting){if(payload.attachmentId===null)delete item.attachmentId;else item.attachmentId=attachment.id;}
   else if(payload.moduleId===null)delete item.moduleId;else item.moduleId=module.id;
   item.revision++;w.s.containers[item.containerId].revision++;resetHandling(w,p);
   w.event('TransactionResult',{kind:command,actorId:p.id,itemId:item.id,moduleId:item.moduleId??null,attachmentId:item.attachmentId??null,trial:true});
   return {itemId:item.id,moduleId:item.moduleId??null,attachmentId:item.attachmentId??null,trial:true};
  }
  need(w.mode!=='mission','WRONG_PHASE');
  need(typeof payload.stationId==='string'&&w.terminal(p,command==='Craft'?'craft':command==='DismantleGear'?'recycle':'upgrade',payload.stationId),'OUT_OF_RANGE');
  if(command==='Craft'){
   const recipe=w.c.crafting.recipes.find(r=>r.id===payload.recipeId);need(recipe,'INVALID_TARGET');
   const plan=ingredientPlan(w,p,recipe.ingredients,need),bag=w.bag(p);
   roomForOutputs(w,p,[{definitionId:recipe.definitionId,quantity:1}],null,need,plan);
   consumePlan(w,plan);
   let item;
   if(w.defs.items[recipe.definitionId].kind==='material'){w.addItems(bag,recipe.definitionId,1);item=bag.itemIds.map(id=>w.s.items[id]).find(item=>item.definitionId===recipe.definitionId&&!item.lockedBy&&!item.loanOwnerSlotId);}
   else item=w.createItem(recipe.definitionId,1,bag,{crafted:true});
   w.event('TransactionResult',{kind:'Craft',actorId:p.id,definitionId:item.definitionId,itemId:item.id,recipeId:recipe.id});w.requestSave=true;
   return {itemId:item.id,definitionId:item.definitionId,recipeId:recipe.id};
  }
  const item=w.s.items[payload.itemId],module=MODULE_BY_ID[payload.moduleId];
  need(item&&w.own(p,item)&&['weapon','rod'].includes(w.defs.items[item.definitionId]?.kind)&&w.c.crafting.recipes.some(r=>r.definitionId===item.definitionId),'INVALID_TARGET');
  if(command==='ModGear')need(module&&item.definitionId===module.definitionId,'INVALID_TARGET');
  need(Number.isSafeInteger(expectedRevision),'STALE_REVISION');w.checkTargetRevision(item,expectedRevision);
  need(!item.lockedBy&&!item.loanOwnerSlotId,'BUSY');
  need((!item.moduleId||moduleFor(item)?.definitionId===item.definitionId)&&validAttachment(item,w.defs.items[item.definitionId]?.kind),'INVALID_MODULE');
  if(command==='FitAttachment'){
   const attachment=ATTACHMENT_BY_ID[payload.attachmentId];need(attachment?.kind===w.defs.items[item.definitionId]?.kind,'INVALID_TARGET');
   need(item.attachmentId!==attachment.id,'ALREADY_MODDED');need(!item.attachmentId||payload.replace===true,'CONFIRM_REPLACE');
   const plan=ingredientPlan(w,p,attachment.ingredients,need);consumePlan(w,plan);item.attachmentId=attachment.id;item.revision++;w.s.containers[item.containerId].revision++;resetHandling(w,p);
   w.event('TransactionResult',{kind:command,actorId:p.id,itemId:item.id,attachmentId:attachment.id});w.requestSave=true;return {itemId:item.id,attachmentId:attachment.id};
  }
  if(command==='RemoveModule'||command==='RemoveAttachment'||command==='DismantleGear'){
   const outputs=gearSalvageQuote(w,item,{moduleOnly:command==='RemoveModule',attachmentOnly:command==='RemoveAttachment'});need(outputs,'INVALID_MODULE');
   const equipped=item.containerId!==p.backpackId;
   if(command==='DismantleGear'&&equipped)need(payload.confirmEquipped===true,'CONFIRM_EQUIPPED');
   roomForOutputs(w,p,outputs,command==='DismantleGear'?item.id:null,need);
   const result={kind:command,actorId:p.id,itemId:item.id,definitionId:item.definitionId,moduleId:item.moduleId??null,attachmentId:item.attachmentId??null,outputs};
   if(command==='DismantleGear')w.removeItem(item);else {delete item[command==='RemoveAttachment'?'attachmentId':'moduleId'];item.revision++;w.s.containers[item.containerId].revision++;}
   for(const row of outputs)w.addItems(w.bag(p),row.definitionId,row.quantity);
   resetHandling(w,p);if(equipped&&command==='DismantleGear'){p.input={};w.setAction(p,'equip',.2);}
   w.event('TransactionResult',result);w.requestSave=true;return result;
  }
  need(module&&item.definitionId===module.definitionId,'INVALID_TARGET');
  need(item.moduleId!==module.id,'ALREADY_MODDED');need(!item.moduleId||payload.replace===true,'CONFIRM_REPLACE');
  const plan=ingredientPlan(w,p,module.ingredients,need);consumePlan(w,plan);item.moduleId=module.id;item.revision++;w.s.containers[item.containerId].revision++;
  resetHandling(w,p);
  w.event('TransactionResult',{kind:'ModGear',actorId:p.id,definitionId:item.definitionId,itemId:item.id,moduleId:module.id});w.requestSave=true;
  return {itemId:item.id,moduleId:module.id};
 };
}
