import {need} from './director.mjs';
const point=q=>({x:q.x,y:q.y,z:q.z});
export function startDayEvent(x,p,e,q,alt){
 const w=x.w;
 if(e.type==='parcel_relay'){need(!q.lockedBy,'BUSY');p.carryingId=q.id;q.carrierId=p.id;q.revision++;p.meleePending=null;p.jumpQueued=false;w.setAction(p,'carry',.5);return true;}
 if(e.type==='supply_dial'&&alt){need(!q.lockedBy,'BUSY');e.dial=((e.dial??0)+1)%3;e.revision++;q.revision++;w.requestSave=true;w.event('Notice',{actorId:p.id,message:'旋钮 '+['Ⅰ','Ⅱ','Ⅲ'][e.dial]});return true;}
 if(e.type==='supply_cool'&&alt){need(!q.lockedBy,'BUSY');return finishDayEvent(x,p,e,q,'force_cool');}
 const actions={desk_stamp:['stamp',1.2],desk_print:[e.stage===0?'print':'print_collect',1.6],supply_dial:['dial',1.5],supply_cool:[alt?'force_cool':e.stage===0?'cool':'cool_collect',alt?.6:1.8],parcel_invoice:['invoice',2]};
 const row=actions[e.type];if(!row)return false;
 if(['print_collect','cool_collect'].includes(row[0]))need(w.s.time>=e.until,'BUSY','还没准备好，稍后再来');
 w.beginWork(p,{kind:'Explore',targetId:q.id,duration:row[1],explorationAction:row[0]});return true;
}
export function deliverRelay(x,p,e,q){
 if(e.type!=='parcel_relay')return false;
 q.carrierId=null;q.opened=true;q.delivered=true;q.revision++;p.carryingId=null;e.stage++;e.revision++;
 Object.assign(q,point(e.receiver));x.w.setAction(p,'interact',.3);x.w.requestSave=true;
 if(e.stage>=e.parts.length)x.reward(e,[['seal_unit',2],['sealed_cell',1],['coffee_coupon',2]],e.receiver,p.id);
 else x.w.event('Notice',{actorId:p.id,message:'已送一箱，还差一箱'});
 return true;
}
export function finishDayEvent(x,p,e,q,action){
 const w=x.w;
 if(e.type==='desk_stamp'){
  const sequence=e.sequence??=[e.answer,(e.answer+1)%3,(e.answer+2)%3];
  if(q.index!==sequence[e.stage]){x.alarm(p,e);e.stage=0;for(const part of e.parts){part.stamped=false;part.revision++;}w.event('Notice',{actorId:p.id,message:'盖错了！按图重新来'});}
  else{q.stamped=true;e.stage++;if(e.stage===3)x.reward(e,[['trigger_unit',1],['float_unit',1],['spring_parts',2]],q,p.id);}w.requestSave=true;return true;
 }
 if(e.type==='desk_print'){
  if(action==='print'){e.started=true;e.stage=1;e.until=w.s.time+10;w.event('Notice',{actorId:p.id,message:'正在打印，10秒后回来'});}
  else x.reward(e,[['optic_unit',1],['float_unit',1],['coffee_coupon',1]],q,p.id);w.requestSave=true;return true;
 }
 if(e.type==='supply_dial'){
  if((e.dial??0)===e.answer)x.reward(e,[['barrel_unit',1],['spool_unit',1],['sealed_cell',1]],q,p.id);
  else{x.alarm(p,e);w.event('Notice',{actorId:p.id,message:'号码不对，看柜上的标记'});}w.requestSave=true;return true;
 }
 if(e.type==='supply_cool'){
  if(action==='force_cool'){x.alarm(p,e);w.damageQueue.push({target:p.id,damage:4,actorId:'hot_cell'});x.reward(e,[['scrap',3]],q,p.id);}
  else if(action==='cool'){e.started=true;e.stage=1;e.until=w.s.time+15;w.event('Notice',{actorId:p.id,message:'先凉15秒，保住外壳'});}
  else x.reward(e,[['seal_unit',1],['sealed_cell',2]],q,p.id);w.requestSave=true;return true;
 }
 if(e.type==='parcel_invoice'){
  q.opened=true;const prop=w.s.destructibles[q.id];if(prop&&!prop.broken){Object.assign(prop,{broken:true,hp:0,revision:prop.revision+1});w.event('Destroyed',{targetId:prop.id,kind:prop.kind,position:point(prop),seed:prop.seed,reason:'unpacked'},prop.id);if(w.navGeometry)w.navGeometry.tick=-1;}
  if(q.index===e.answer){e.noisy=true;x.alarm(p,e);w.event('Notice',{actorId:p.id,message:'这是错单，剩下两箱是真货'});}
  else e.stage++;
  if(e.stage===2)x.reward(e,[['seal_unit',e.noisy?1:2],['barrel_unit',1],['coffee_coupon',1]],q,p.id);w.requestSave=true;return true;
 }
 return false;
}
