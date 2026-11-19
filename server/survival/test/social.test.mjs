// In-memory worlds and synthetic identities only. No services or real saves.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,command,advance} from './director-helpers.mjs';
import {SurvivalWorld} from '../world.mjs';
import {attachSocial} from '../social.mjs';
import {SOCIAL_RULES as R} from '../social-config.mjs';
import {extractCareerCapsule,importCareerCapsule,createCareerCapsule} from '../career-state.mjs';

function setup(count=2){const f=fixture(count);attachSocial(f.w);f.w.s.time=100;for(const p of f.ps){p.connected=true;p.input={};p.equipUntil=0;}return f;}
const send=(w,p,action,payload={},targetId)=>command(w,p,'Social',{action,...payload},targetId);
const settings=(w,p,payload)=>command(w,p,'SocialSettings',payload);
const accepted=x=>assert.equal(x.ok,true,x.message);
const coffeeCount=w=>Object.values(w.s.items).filter(x=>x.definitionId==='coffee_flask').reduce((n,i)=>n+i.quantity,0);
function spare(w,p){for(const id of [...w.bag(p).itemIds])w.removeItem(w.s.items[id]);}
function ready(w){w.s.time+=6;for(const p of w.scenePlayers())p.input={};}
function offers(w){return w.publicState().social.offers;}
function where(w,p,target){Object.assign(p,{x:target.x,z:target.z,y:w.ground(target.x,target.z),swimming:false});}

test('attachment is idempotent and adds five definitions without economic toys',()=>{
 const {w,p}=setup();const c=attachSocial(w),wrapper=w.command;assert.equal(attachSocial(w),c);assert.equal(w.command,wrapper);
 assert.equal(w.catalog().social.actions.length,8);assert.equal(w.catalog().social.souvenirs.length,8);
 assert(!w.c.items.some(x=>['paper_plane','paper_ball','rubber_duck','box_hat','fun_stamp'].includes(x.id)));
 const state=w.publicState().social.playerStates.find(x=>x.playerId===p.id);assert.equal(state.participating,false);
});
test('coffee requires voluntary acceptance and transfers exactly one through duplicate requests',()=>{
 const {w,p,ps}=setup(),q=ps[1];spare(w,p);spare(w,q);const original=w.createItem('coffee_flask',3,w.bag(p));
 const offer=send(w,p,'offerCoffee',{},q.id);accepted(offer);assert.equal(coffeeCount(w),3);assert.equal(w.count(q,'coffee_flask'),0);
 const accept={requestId:q.requestHighWater+1,command:'Social',payload:{action:'accept',offerId:offer.data.offerId}};
 const result=w.command(q,accept);accepted(result);assert.deepEqual(w.command(q,accept),result);
 assert.equal(w.count(p,'coffee_flask'),2);assert.equal(w.count(q,'coffee_flask'),1);assert.equal(coffeeCount(w),3);assert.equal(offers(w).length,0);
 assert.equal(w.s.items[original.id].quantity,2);assert.equal(send(w,q,'accept',{offerId:offer.data.offerId}).code,'SOCIAL_EXPIRED');w.assertInvariants();
});
test('coffee rejection, full backpack, stale revision and distant targets preserve every cup',()=>{
 for(const scenario of ['decline','capacity','stale','distance','wrong_receiver']){
  const {w,p,ps}=setup(3),q=ps[1];spare(w,p);spare(w,q);const item=w.createItem('coffee_flask',2,w.bag(p));
  const offer=send(w,p,'offerCoffee',{},q.id);accepted(offer);const id=offer.data.offerId;
  if(scenario==='decline')accepted(send(w,q,'decline',{offerId:id}));
  else{
   if(scenario==='capacity')w.bag(q).slotLimit=0;
   if(scenario==='stale')item.revision++;
   if(scenario==='distance')q.x+=10;
   const result=send(w,scenario==='wrong_receiver'?ps[2]:q,'accept',{offerId:id});assert.equal(result.ok,false,scenario);
  }
  assert.equal(coffeeCount(w),2,scenario);assert.equal(w.count(p,'coffee_flask'),2,scenario);assert.equal(w.count(q,'coffee_flask'),0,scenario);
 }
});
test('stored, loaned and used coffee cannot be gifted; a valid cup can later be consumed',()=>{
 const {w,p,ps}=setup(),q=ps[1];spare(w,p);spare(w,q);const cup=w.createItem('coffee_flask',1,w.bag(p));
 const offer=send(w,p,'offerCoffee',{itemId:cup.id},q.id);accepted(offer);
 const storage=w.createContainer('personal_storage',4,{ownerSlotId:p.slotId});w.moveItem(cup,storage);
 assert.equal(send(w,q,'accept',{offerId:offer.data.offerId}).ok,false);assert.equal(coffeeCount(w),1);
 ready(w);assert.equal(send(w,p,'offerCoffee',{itemId:cup.id},q.id).code,'NO_AMMO');
 w.moveItem(cup,w.bag(p));cup.loanOwnerSlotId=p.slotId;assert.equal(send(w,p,'offerCoffee',{},q.id).code,'NO_AMMO');delete cup.loanOwnerSlotId;
 accepted(send(w,p,'offerCoffee',{},q.id));const id=offers(w)[0].id;accepted(send(w,q,'accept',{offerId:id}));
 q.stamina=0;q.heldSlot='quick';q.quickItemDefinitionId='coffee_flask';q.equipUntil=0;
 accepted(command(w,q,'UseQuick'));assert.equal(coffeeCount(w),0);assert.equal(q.stamina,40);w.assertInvariants();
});
test('gift ownership survives both career extraction and a world save without duplicate assets',()=>{
 const {w,p,ps}=setup(),q=ps[1];spare(w,p);spare(w,q);
 p.tokenHash='account:synthetic-social-sender';q.tokenHash='account:synthetic-social-receiver';
 for(const member of [p,q]){const cap=createCareerCapsule(w.c);cap.backpack=[];cap.equipment={weapon:[],rod:[],melee:[]};importCareerCapsule(w,member,{capsule:cap,revision:1});}
 w.createItem('coffee_flask',2,w.bag(p));const offer=send(w,p,'offerCoffee',{},q.id);accepted(offer);accepted(send(w,q,'accept',{offerId:offer.data.offerId}));
 const a=extractCareerCapsule(w.s,'synthetic-social-sender'),b=extractCareerCapsule(w.s,'synthetic-social-receiver');
 assert.equal(a.backpack.reduce((n,i)=>n+i.quantity,0),1);assert.equal(b.backpack.reduce((n,i)=>n+i.quantity,0),1);
 assert.equal(new Set([...a.backpack,...b.backpack].map(i=>i.id)).size,2);
 const restored=new SurvivalWorld(w.c,w.serialize(),{onlineRoster:true});attachSocial(restored);assert.equal(coffeeCount(restored),2);assert.equal(Object.keys(restored.s.social.offers).length,0);restored.assertInvariants();
});
test('gift receiver death puts the received cup in a corpse, leaving the sender empty',()=>{
 const {w,p,ps}=setup(),q=ps[1];spare(w,p);spare(w,q);w.createItem('coffee_flask',1,w.bag(p));
 const offer=send(w,p,'offerCoffee',{},q.id);accepted(offer);accepted(send(w,q,'accept',{offerId:offer.data.offerId}));w.die(q);
 assert.equal(w.count(p,'coffee_flask'),0);assert.equal(w.count(q,'coffee_flask'),0);assert.equal(coffeeCount(w),1);
 const cup=Object.values(w.s.items).find(x=>x.definitionId==='coffee_flask');assert.equal(w.s.containers[cup.containerId].type,'corpse');w.assertInvariants();
});
test('high five supports invitations, response and an independent solo gesture',()=>{
 const {w,p,ps}=setup(),q=ps[1];const solo=send(w,p,'highFive');accepted(solo);assert.equal(solo.data.solo,true);assert.equal(p.action,'social_highfive');ready(w);
 const offer=send(w,p,'highFive',{},q.id);accepted(offer);accepted(send(w,q,'accept',{offerId:offer.data.offerId}));assert.equal(q.action,'social_highfive');assert.equal(offers(w).length,0);
 ready(w);accepted(send(w,p,'highFive',{},q.id));w.s.time+=R.offerSeconds+.1;assert.equal(offers(w).length,0);assert.equal(p.hp,w.c.player.max_hp);
});
test('paper balls are opt in, cannot hurt or move a player, and target repeat rate is limited',()=>{
 const {w,p,ps}=setup(),q=ps[1],before={hp:q.hp,x:q.x,y:q.y,z:q.z,yaw:q.yaw,pitch:q.pitch,items:Object.keys(w.s.items)};
 assert.equal(send(w,p,'paperBall',{},q.id).code,'SOCIAL_DECLINED');accepted(settings(w,p,{participating:true}));assert.equal(send(w,p,'paperBall',{},q.id).code,'SOCIAL_DECLINED');accepted(settings(w,q,{participating:true}));
 accepted(send(w,p,'paperBall',{},q.id));assert.deepEqual({hp:q.hp,x:q.x,y:q.y,z:q.z,yaw:q.yaw,pitch:q.pitch,items:Object.keys(w.s.items)},before);
 w.s.time+=2;assert.equal(send(w,p,'paperBall',{},q.id).code,'SOCIAL_COOLDOWN');
 accepted(settings(w,q,{participating:false}));assert.equal(send(w,p,'paperBall',{},q.id).code,'SOCIAL_DECLINED');assert.equal(w.s.friendlyFire,false);
 w.s.friendlyFire=true;assert.equal(w.publicState().social.playerStates.find(x=>x.playerId===q.id).participating,false);
});
test('single player paper basket and plane target work without economic rewards',()=>{
 const {w,p}=setup(1);const targets=w.s.social.targets;where(w,p,{x:targets.planeTarget.x,z:targets.planeTarget.z+3});
 const money=structuredClone(w.s.bank),itemIds=Object.keys(w.s.items),to=targets.planeTarget;
 accepted(send(w,p,'airplane',{x:to.x,z:to.z}));w.s.time+=R.planeSeconds+.1;attachSocial(w).cleanup();
 assert(w.s.social.playerStates[p.id].unlocked.includes('rubber_duck'));
 accepted(settings(w,p,{participating:true}));where(w,p,{x:targets.paperBin.x,z:targets.paperBin.z+2});ready(w);
 const ball=send(w,p,'paperBall',{x:targets.paperBin.x,z:targets.paperBin.z});accepted(ball);assert.equal(ball.data.scored,true);
 assert.deepEqual(w.s.bank,money);assert.deepEqual(Object.keys(w.s.items),itemIds);
});
test('a landed plane can be relayed once per request and expires within the budget',()=>{
 const {w,p,ps}=setup(),q=ps[1];const toss=send(w,p,'airplane',{x:q.x,z:q.z});accepted(toss);w.s.time+=R.planeSeconds+.1;attachSocial(w).cleanup();
 const planeId=toss.data.planeId,request={requestId:q.requestHighWater+1,command:'Social',payload:{action:'relayPlane',planeId,power:.2}};
 accepted(w.command(q,request));accepted(w.command(q,request));assert.equal(w.s.social.planes[planeId].relayCount,1);assert.equal(w.s.social.planes[planeId].ownerId,q.id);
 assert.equal(send(w,p,'relayPlane',{planeId}).ok,false);
 w.s.time+=R.planeLifetime+.1;attachSocial(w).cleanup();assert.equal(Object.keys(w.s.social.planes).length,0);
});
test('invalid targeting and blocked line of sight cannot create offers or remote marks',()=>{
 const {w,p,ps}=setup(),q=ps[1];for(const bad of [{x:NaN,z:1},{x:Infinity,z:0},{x:p.x+100,z:p.z},{power:-1},{power:2}])assert.equal(send(w,p,'stamp',bad).ok,false);
 assert.equal(send(w,p,'stamp',{stampId:'unbounded-string'}).ok,false);assert.equal(Object.keys(w.s.social.marks).length,0);
 const original=w.lineVisible;w.lineVisible=()=>false;assert.equal(send(w,p,'highFive',{},q.id).code,'OUT_OF_RANGE');assert.equal(offers(w).length,0);w.lineVisible=original;
});
test('stamps are finite and bounded; souvenirs unlock from real destruction and exploration',()=>{
 const {w,p}=setup(1);assert.equal(settings(w,p,{hat:true}).code,'SOCIAL_LOCKED');assert.equal(send(w,p,'souvenir',{souvenirId:'rubber_duck'}).code,'SOCIAL_LOCKED');
 w.event('Destroyed',{actorId:p.id,kind:'crate',position:{x:p.x,y:p.y,z:p.z}});accepted(settings(w,p,{hat:true}));
 w.event('ExplorationCompleted',{position:{x:p.x,y:p.y,z:p.z}});ready(w);where(w,p,w.s.buildings.core);accepted(send(w,p,'souvenir',{souvenirId:'rubber_duck',power:.2}));
 for(let i=0;i<8;i++){ready(w);accepted(send(w,p,'stamp',{stampId:['thanks','help','cheer'][i%3],power:.2}));}
 assert.equal(Object.keys(w.s.social.marks).length,R.ownerMarkLimit);assert.equal(w.s.social.playerStates[p.id].unlocked.length,2);
 const save=w.serialize(),restored=new SurvivalWorld(w.c,save,{onlineRoster:true});attachSocial(restored);assert.equal(restored.s.social.playerStates[p.id].hat,true);assert.equal(restored.s.social.playerStates[p.id].unlocked.length,2);assert.equal(Object.keys(restored.s.social.marks).length,0);
 w.s.time+=R.markLifetime+.1;attachSocial(w).cleanup();assert.equal(Object.keys(w.s.social.marks).length,0);
});
test('night, downed, disconnected and departed players clear transient toys and offers',()=>{
 for(const state of ['night','downed','disconnect','departed']){
  const {w,p,ps}=setup(),q=ps[1];accepted(send(w,p,'highFive',{},q.id));ready(w);accepted(send(w,p,'airplane',{power:.2}));ready(w);accepted(send(w,p,'stamp',{power:.2}));
  if(state==='night')w.setPhase('NIGHT');if(state==='downed')w.enterDowned(p);if(state==='disconnect')w.disconnect(p);if(state==='departed')delete w.s.players[p.id];
  attachSocial(w).cleanup();assert.equal(offers(w).length,0,state);assert.equal(Object.keys(w.s.social.planes).length,0,state);assert.equal(Object.keys(w.s.social.marks).length,0,state);
  if(state==='night')assert.equal(send(w,q,'airplane').code,'WRONG_PHASE');
 }
});
test('settings allow a downed player to leave without changing friendly fire or resources',()=>{
 const {w,p}=setup(1);accepted(settings(w,p,{participating:true}));w.enterDowned(p);w.s.friendlyFire=true;
 accepted(settings(w,p,{participating:false}));assert.equal(w.s.friendlyFire,true);assert.equal(w.s.social.playerStates[p.id].participating,false);
 assert.equal(settings(w,p,{participating:'false'}).code,'INVALID_TARGET');assert.equal(settings(w,p,{}).code,'INVALID_TARGET');
});
test('request high water and result caches cover malformed, expired and repeated social commands',()=>{
 const {w,p}=setup(1);assert.equal(w.command(p,{requestId:0,command:'Social',payload:{action:'highFive'}}).ok,false);
 const bad={requestId:1,command:'Social',payload:{action:'unknown'}};const result=w.command(p,bad);assert.equal(result.code,'INVALID_TARGET');assert.deepEqual(w.command(p,bad),result);
 p.requestCache=[];assert.equal(w.command(p,bad).code,'REQUEST_EXPIRED');assert.equal(p.requestHighWater,1);
});
test('normal fire destroys a generated event box and unlocks the cardboard hat',()=>{
 const {w,p}=setup(1);w.beginDayBarrier();w.finishDayBarrier();
 let e=w.s.exploration.events.find(e=>e.type==='supply_seal');
 for(let i=0;!e&&i<4;i++){w.s.dayIndex++;w.generateDay();e=w.s.exploration.events.find(e=>e.type==='supply_seal');}
 assert(e);w.s.enemies={};const q=e.parts[0],prop=w.s.destructibles[q.id];where(w,p,{x:q.x+3,z:q.z});
 p.heldSlot='weapon';p.equipUntil=0;
 const dx=q.x-p.x,dz=q.z-p.z,dy=q.y+.6-(p.y+w.c.player.camera_height);
 const yaw=Math.atan2(-dx,-dz),pitch=Math.atan2(dy,Math.hypot(dx,dz));
 for(let i=0;i<8&&!prop.broken;i++){accepted(command(w,p,'Fire',{yaw,pitch}));advance(w,.45);}
 assert.equal(prop.broken,true);assert(w.s.social.playerStates[p.id].unlocked.includes('box_hat'));
 assert(w.events.some(e=>e.eventType==='Destroyed'&&e.payload.actorId===p.id));w.assertInvariants();
});
test('normal explore held work completes a generated event and unlocks the duck',()=>{
 const {w,p}=setup(1);w.beginDayBarrier();w.finishDayBarrier();
 let e=w.s.exploration.events.find(e=>e.type==='desk_sort');
 if(!e){w.s.dayIndex++;w.generateDay();e=w.s.exploration.events.find(e=>e.type==='desk_sort');}
 assert(e);w.s.enemies={};const q=e.parts[e.answer];where(w,p,{x:q.x+1.8,z:q.z});
 accepted(command(w,p,'Explore',{},q.id));advance(w,1.5,{interact:true});
 assert.equal(e.done,true);assert(w.s.social.playerStates[p.id].unlocked.includes('rubber_duck'));
 assert(w.events.some(row=>row.eventType==='ExplorationCompleted'&&row.payload.eventId===e.id));w.assertInvariants();
});
