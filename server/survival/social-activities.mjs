import {SOCIAL_RULES as R,SOCIAL_SOUVENIRS,collectionOf} from './social-config.mjs';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
export function activity(w,p,payload,kind,api){const{need,cooldown,unlock}=api,s=w.s.social;let q=payload.activityId?s.activities[payload.activityId]:Object.values(s.activities).find(q=>q.kind===kind&&q.ownerId===p.id);
 if(q){need(q.kind===kind&&q.expiresAt>w.s.time,'SOCIAL_EXPIRED');need(distance(p,q)<=3&&w.lineVisible(p,q),'OUT_OF_RANGE');}
 else{need(!payload.activityId,'SOCIAL_EXPIRED');need(Object.keys(s.activities).length<R.activityLimit&&!Object.values(s.activities).some(q=>q.ownerId===p.id),'BUSY');}
 if(kind==='noteChain'&&payload.symbol!==undefined)need(Number.isInteger(payload.symbol)&&payload.symbol>=0&&payload.symbol<=2);
 let at;if(!q){for(const angle of [0,Math.PI/4,-Math.PI/4,Math.PI/2,-Math.PI/2,Math.PI]){const yaw=p.yaw+angle,x=p.x-Math.sin(yaw)*1.2,z=p.z-Math.cos(yaw)*1.2,y=w.ground(x,z),point={x,y,z};if(w.s.waterY-y<=.6&&!w.blocked(x,y,z,.45)&&w.lineVisible(p,point)){at=point;break;}}need(at,'BUSY');}
 cooldown(w,p);if(!q){q={id:w.id('social-activity'),kind,ownerId:p.id,...at,stage:0,contributors:[],revision:1,pattern:[0,1,2],expiresAt:w.s.time+R.activitySeconds};s.activities[q.id]=q;}
 if(kind==='noteChain'&&(payload.symbol??q.pattern[q.stage])!==q.pattern[q.stage]){q.stage=0;q.revision++;w.event('Notice',{actorId:p.id,message:'顺序不对，跟着三个图案来'});return{activityId:q.id,stage:0};}
 if(!q.contributors.includes(p.id))q.contributors.push(p.id);q.stage++;q.revision++;w.setAction(p,'interact',.45);w.event('SocialPlayed',{kind,actorId:p.id,activityId:q.id,stage:q.stage,position:{x:q.x,y:q.y,z:q.z}},p.id);w.requestSave=true;
 if(q.stage===3){const souvenirId=kind==='cupStack'?'cup_trophy':'message_flower';for(const id of q.contributors)unlock(w,w.s.players[id],souvenirId);delete s.activities[q.id];w.event('SocialCompleted',{kind,actorId:p.id,contributorIds:q.contributors,position:{x:q.x,y:q.y,z:q.z}},p.id);}return{activityId:q.id,stage:q.stage};
}
export function displaySouvenir(w,p,id,api){const{need,cooldown}=api,index=SOCIAL_SOUVENIRS.findIndex(q=>q.id===id);need(index>=0);need(collectionOf(p.collection).unlocked.includes(id),'SOCIAL_LOCKED');need(w.s.buildings.core.hp>0&&distance(p,w.s.buildings.core)<=14,'OUT_OF_RANGE');if(w.s.social.displays.some(q=>q.souvenirId===id))return{already:true};cooldown(w,p);
 const x=-3.6+(index%4)*1.2,z=-4.6+Math.floor(index/4)*1.2,y=w.ground(x,z);need(!w.blocked(x,y,z,.45),'BUSY');const q={id:'display-'+id,souvenirId:id,worldId:w.s.worldId,x,y,z};w.s.social.displays.push(q);w.requestSave=true;w.event('SocialPlayed',{kind:id,actorId:p.id,position:{x:q.x,y:q.y,z:q.z}},p.id);return{displayId:q.id};
}
export function validateDisplays(worldId,displays){if(!Array.isArray(displays)||displays.length>8||new Set(displays.map(q=>q.souvenirId)).size!==displays.length||displays.some(q=>q.worldId!==worldId||!SOCIAL_SOUVENIRS.some(d=>d.id===q.souvenirId)||q.id!=='display-'+q.souvenirId||!['x','y','z'].every(k=>Number.isFinite(q[k]))||Math.hypot(q.x,q.z)>30))throw Error('Invalid souvenir displays');return structuredClone(displays);}
