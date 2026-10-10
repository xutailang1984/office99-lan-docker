import {isBoss} from './night-content-config.mjs';
// Small authoritative hooks. No timers, accounts, file access or extra ammo types.
import {MODULE_BY_ID} from './crafting-config.mjs';
import {assemblyWeapon} from './assembly-config.mjs';

const usable=(item,id)=>item?.moduleId===id&&MODULE_BY_ID[id]?.definitionId===item.definitionId;
const pulse=(w,p,moduleId,cue,extra={})=>w.event('GearPulse',{actorId:p.id,moduleId,cue,...extra},p.id);
export function effectiveWeapon(def,item,p,now=0){
 const module=MODULE_BY_ID[item?.moduleId];
 if(!def)return def;
 const modified=module?.definitionId===def.id?{...def,moduleId:module.id,...(module.id==='carbine_burst'?{rpm:750}:{}),...(module.id==='rifle_focus'?{moduleReady:(p?.gearFocusSeconds??0)>=1}: {})}:def;
 return assemblyWeapon(modified,item,p,now);
}

export function gearAfterShot(w,p,item,def){
 p.gearLastShotAt=w.s.time;
 if(usable(item,'lmg_heat')){p.gearHeatShots=(p.gearHeatItem===item.id?p.gearHeatShots??0:0)+1;p.gearHeatItem=item.id;if(p.gearHeatShots>=12){p.gearHeatShots=0;p.fireAt=w.s.time+1;pulse(w,p,item.moduleId,'heat_rest',{duration:1});}}
 if(usable(item,'carbine_burst')){
  if(p.gearBurstItem!==item.id||w.s.time-(p.gearBurstAt??-100)>.8)p.gearBurstCount=0;
  p.gearBurstItem=item.id;p.gearBurstAt=w.s.time;p.gearBurstCount=(p.gearBurstCount??0)+1;
  if(p.gearBurstCount>=3){p.gearBurstCount=0;p.fireAt=w.s.time+.65;pulse(w,p,item.moduleId,'burst_rest',{duration:.65});}
 }
 if(usable(item,'smg_mobile'))p.gearWalkDistance=0;
 // The shot's piercing query runs before this hook; focusing again takes time.
 if(usable(item,'rifle_focus'))p.gearFocusSeconds=0;
}

function feedAmmo(w,p,item,quantity){
 const def=w.defs.weapons[item.definitionId];
 const amount=Math.max(0,Math.min(quantity,def.magazine-item.magazineAmmo,w.mode==='mission'?quantity:w.count(p,def.ammo)));
 if(!amount)return 0;
 if(w.mode!=='mission')w.consume(p,def.ammo,amount);
 item.magazineAmmo+=amount;item.revision++;w.s.containers[item.containerId].revision++;return amount;
}

export function updateGearGrowth(w,p,dt){
 const item=w.equipped(p,'weapon'),active=p.lifeState==='ALIVE'&&p.heldSlot==='weapon'&&!p.work&&!p.fishing&&!p.reload&&!p.swimming;
 const focused=active&&(usable(item,'rifle_focus')||usable(item,'carbine_anchor'))&&p.input?.ads===true&&(p.moveSpeed??0)<.15;
 const prior=p.gearFocusSeconds??0;
 p.gearFocusSeconds=focused?Math.min(1,prior+Math.max(0,dt)):0;
 const readyAt=item?.moduleId==='carbine_anchor'?.5:1;
 if(prior<readyAt&&p.gearFocusSeconds>=readyAt)pulse(w,p,item.moduleId,'focus_ready',{duration:readyAt});
 if(w.s.time-(p.gearLastShotAt??-100)>.8)p.gearHeatShots=0;
 const previous=p.gearWalkPosition;
 p.gearWalkPosition={x:p.x,z:p.z,itemId:item?.id??null};
 if(!active||!usable(item,'smg_mobile')||p.input?.fire===true||w.s.time-(p.gearLastShotAt??-100)<.6||(p.moveSpeed??0)<.3||p.swimming){p.gearWalkDistance=0;return;}
 if(!previous||previous.itemId!==item.id){p.gearWalkDistance=0;return;}
 const moved=Math.hypot(p.x-previous.x,p.z-previous.z);
 // Respawn, corrections or teleports never become free progress.
 if(moved>Math.max(.6,Math.max(0,dt)*10)){p.gearWalkDistance=0;return;}
 p.gearWalkDistance=(p.gearWalkDistance??0)+moved;
 if(p.gearWalkDistance>=3){p.gearWalkDistance=0;const loaded=feedAmmo(w,p,item,1);if(loaded)pulse(w,p,item.moduleId,'walk_load',{loaded});}
}

export function gearAfterHit(w,target,hit){
 if(hit.shielded||!w.s.enemies[target.id])return;
 const p=w.s.players[hit.actorId];if(!p)return;
 const item=hit.itemId?w.s.items[hit.itemId]:w.equipped(p,'weapon');
 if(!item||!w.own(p,item)||item.moduleId!==hit.moduleId||item.definitionId!==hit.weaponId)return;
 if(usable(item,'pistol_chain')&&target.hp<=0&&!target.gearKillRefilled&&!p.reload){
  target.gearKillRefilled=true;
  const loaded=feedAmmo(w,p,item,2);if(loaded)pulse(w,p,item.moduleId,'kill_load',{loaded,targetId:target.id});
 }
 if(!usable(item,'lmg_suppress')||target.hp<=0||isBoss(target)||w.defs.creatures[target.definitionId]?.tier==='elite')return;
 const prior=p.gearSuppress;
 const hits=prior?.targetId===target.id&&w.s.time-prior.at<=.55?prior.hits+1:1;
 p.gearSuppress={targetId:target.id,at:w.s.time,hits};
 if(hits>=4&&w.s.time>=(target.gearSuppressResistUntil??0)){
  p.gearSuppress.hits=0;target.gearSuppressedUntil=w.s.time+1.8;target.gearSuppressResistUntil=w.s.time+4;
  pulse(w,p,item.moduleId,'suppressed',{targetId:target.id,duration:1.8});
 }
}

export function gearEnemySpeed(enemy,now){return now<(enemy.gearSuppressedUntil??0)?.5:1;}

// Query after a first living ordinary enemy has been hit, before gearAfterShot.
// A second wall query is essential: the original aiming ray stops at target one.
export function gearPiercingHit(w,p,item,{target,from,direction,distance,maximum,shotId,damage}){
 if(!usable(item,'rifle_focus')||(p.gearFocusSeconds??0)<1||!target||!w.s.enemies[target.id]||isBoss(target)||w.defs.creatures[target.definitionId]?.tier==='elite')return null;
 const def=w.defs.weapons[item.definitionId],limit=Math.min(def.range_end,Number.isFinite(maximum)?maximum:def.range_end);
 const wall=w.rayBlock(from,direction,limit),end=Math.min(limit,wall?.distance??limit);
 let nearest=null,nearestDistance=end;
 const intersect=(entity,radius,height)=>{
  const dx=entity.x-from.x,dy=entity.y+height-from.y,dz=entity.z-from.z,along=dx*direction.x+dy*direction.y+dz*direction.z;
  const offset=dx*dx+dy*dy+dz*dz-along*along;if(offset>radius*radius)return null;
  const near=along-Math.sqrt(Math.max(0,radius*radius-offset));return near>distance+.05&&near<nearestDistance?near:null;
 };
 // Friendly players obstruct the extra ray even when friendly fire is disabled.
 for(const other of w.scenePlayers()){if(other.id===p.id||other.lifeState==='DEAD_WAIT')continue;const d=intersect(other,.55,other.lifeState==='DOWNED'?.42:1.1);if(d!==null)nearestDistance=d;}
 for(const enemy of Object.values(w.s.enemies)){
  if(enemy.id===target.id||enemy.hp<=0)continue;
  const d=intersect(enemy,enemy.radius??.6,w.defs.creatures[enemy.definitionId]?.hit_height??(isBoss(enemy)?1:.65));
  if(d!==null){nearest=enemy;nearestDistance=d;}
 }
 if(!nearest)return null;
 const position={x:from.x+direction.x*nearestDistance,y:from.y+direction.y*nearestDistance,z:from.z+direction.z*nearestDistance};
 // Keep boss armor authoritative: the follow-through never bypasses it.
 const armor=isBoss(nearest)?(w.defs.creatures[nearest.definitionId].armor_multiplier??1):1;
 return {target:nearest.id,actorId:p.id,itemId:item.id,weaponId:'rifle',moduleId:'rifle_focus',shotId,damage:Math.max(1,Math.floor(damage*.6*armor)),direction,position,pierced:true,pelletHits:1};
}
