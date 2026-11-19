// Isolated rule fixtures only. No real accounts, saves, services or resource grants.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,command,put,base} from './director-helpers.mjs';
import {MODULE_BY_ID,CRAFTING_RECIPES,CRAFTING_MODULES,effectiveRod} from '../crafting-config.mjs';
import {gearSalvageQuote} from '../crafting.mjs';
import {effectiveWeapon,gearAfterShot,gearAfterHit,updateGearGrowth,gearEnemySpeed,gearPiercingHit} from '../gear-growth.mjs';
import {beginReeling,updateWaiting,updateReeling} from '../fishing-experience.mjs';

const at=(w,p,id)=>{const t=w.staticWorld().terminals.find(t=>t.id===id);put(p,w,t.x,t.z+1.3);};
const clear=(w,p)=>{for(const id of [...w.bag(p).itemIds])w.removeItem(w.s.items[id]);};
const give=(w,p,rows)=>{for(const row of rows)w.addItems(w.bag(p),row.definitionId,row.quantity);};
const accepted=r=>(assert.equal(r.ok,true,r.code),r);
const action=(w,p,name,item,payload={})=>w.command(p,{requestId:p.requestHighWater+1,command:name,payload:{itemId:item.id,...payload},expectedRevision:item.revision});
const snapshot=w=>structuredClone({items:w.s.items,containers:w.s.containers});
function armed(id,moduleId){const out=fixture(),{w,p}=out;clear(w,p);const slot=w.s.containers[p.equipment.weapon];for(const iid of [...slot.itemIds])w.removeItem(w.s.items[iid]);out.item=w.createItem(id,1,slot,{moduleId,magazineAmmo:0});p.heldSlot='weapon';p.equipUntil=0;p.lifeState='ALIVE';return out;}

test('eight guns and six fishing tools have recipes and two mutually exclusive cores; ammunition stays at three classes',()=>{
 const ids=[...base.weapons,...base.rods].map(d=>d.id).sort();
 assert.equal(base.weapons.length,8);assert.equal(base.rods.length,6);
 assert.deepEqual(CRAFTING_RECIPES.filter(r=>ids.includes(r.definitionId)).map(r=>r.definitionId).sort(),ids);
 for(const id of ids){const cores=CRAFTING_MODULES.filter(m=>m.definitionId===id);assert.equal(cores.length,2,id);assert.notEqual(cores[0].description,cores[1].description);}
 assert.equal(new Set(base.weapons.map(w=>w.ammo)).size,3);
 for(const id of ids)assert.equal(base.items.find(i=>i.id===id).craft_only===true,!['carbine','rod_basic'].includes(id));
 for(const entry of [...CRAFTING_RECIPES,...CRAFTING_MODULES])for(const row of entry.ingredients){assert(base.items.some(i=>i.id===row.definitionId&&i.kind==='material'));assert(Number.isSafeInteger(row.quantity)&&row.quantity>0);}
});

for(const recipe of CRAFTING_RECIPES.filter(r=>[...base.weapons,...base.rods].some(d=>d.id===r.definitionId)))test(recipe.id+' can craft, install its module, and recover a strictly smaller set of ingredients',()=>{
 const {w,p}=fixture();clear(w,p);give(w,p,recipe.ingredients);at(w,p,'craft');const result=accepted(command(w,p,'Craft',{recipeId:recipe.id,stationId:'craft'})),item=w.s.items[result.data.itemId];
 const module=CRAFTING_MODULES.find(m=>m.definitionId===recipe.id);give(w,p,module.ingredients);at(w,p,'upgrade');accepted(action(w,p,'ModGear',item,{moduleId:module.id,stationId:'upgrade'}));
 const quote=gearSalvageQuote(w,item);at(w,p,'recycle');const removed=accepted(action(w,p,'DismantleGear',item,{stationId:'recycle'}));assert.deepEqual(removed.data.outputs,quote);assert(!w.s.items[item.id]);
 for(const row of quote){const original=[...recipe.ingredients,...module.ingredients].filter(r=>r.definitionId===row.definitionId).reduce((s,r)=>s+r.quantity,0);assert(row.quantity<original);assert.equal(w.count(p,row.definitionId),row.quantity);}
 w.assertInvariants();
});

test('dismantling refunds every magazine round once and requires equipped confirmation',()=>{
 const {w,p,item}=armed('rifle','rifle_focus');item.magazineAmmo=5;at(w,p,'recycle');const before=snapshot(w);
 assert.equal(action(w,p,'DismantleGear',item,{stationId:'recycle'}).code,'CONFIRM_EQUIPPED');assert.deepEqual(snapshot(w),before);
 const message={requestId:p.requestHighWater+1,command:'DismantleGear',payload:{itemId:item.id,stationId:'recycle',confirmEquipped:true},expectedRevision:item.revision};
 accepted(w.command(p,message));assert.equal(w.count(p,'ammo_heavy'),5);const after=snapshot(w);accepted(w.command(p,message));assert.deepEqual(snapshot(w),after);
});

test('combined material and ammo capacity is checked before any dismantling mutation',()=>{
 const {w,p,item}=armed('rifle','rifle_focus');item.magazineAmmo=5;while(w.bag(p).itemIds.length<w.bag(p).slotLimit-3)w.createItem('coffee_coupon',1,w.bag(p));at(w,p,'recycle');const before=snapshot(w);
 assert.equal(action(w,p,'DismantleGear',item,{stationId:'recycle',confirmEquipped:true}).code,'NO_CAPACITY');assert.deepEqual(snapshot(w),before);assert.equal(item.magazineAmmo,5);
});

test('module removal refunds half, preserves the gun and ammo, and cannot fund reinstall loops',()=>{
 const {w,p,item}=armed('shotgun','shotgun_stop');item.magazineAmmo=4;at(w,p,'upgrade');const result=accepted(action(w,p,'RemoveModule',item,{stationId:'upgrade'}));assert.equal(item.moduleId,undefined);assert.equal(item.magazineAmmo,4);assert.equal(w.count(p,'ammo_shell'),0);
 assert.deepEqual(result.data.outputs,[{definitionId:'scrap',quantity:3},{definitionId:'spring_parts',quantity:2}]);
 assert.equal(action(w,p,'RemoveModule',item,{stationId:'upgrade'}).code,'INVALID_MODULE');
 assert.equal(action(w,p,'ModGear',item,{moduleId:'shotgun_stop',stationId:'upgrade'}).code,'NO_MATERIALS');
});

test('borrowed, foreign, malformed or stale equipment never produces refunds',()=>{
 for(const mode of ['loan','foreign','unknown','mismatch','stale']){
  const {w,p,ps}=fixture(2);clear(w,p);const item=w.createItem('shotgun',1,w.bag(mode==='foreign'?ps[1]:p),{moduleId:mode==='unknown'?'fake':mode==='mismatch'?'rifle_focus':'shotgun_stop',...(mode==='loan'?{loanOwnerSlotId:p.slotId}:{})});at(w,p,'recycle');const before=snapshot(w);
  const r=w.command(p,{requestId:p.requestHighWater+1,command:'DismantleGear',payload:{itemId:item.id,stationId:'recycle'},expectedRevision:item.revision+(mode==='stale'?1:0)});assert.equal(r.ok,false,mode);assert.deepEqual(snapshot(w),before);
 }
});

test('trial modules cycle only on personal loans at the matching training display and never refund',()=>{
 const {w,p,item}=armed('rifle',null);w.mode='mission';w.s.mission={freePlay:true};item.loanOwnerSlotId=p.slotId;
 const staticWorld=w.staticWorld.bind(w);w.staticWorld=()=>({...staticWorld(),terminals:[{id:'synthetic-rifle-rack',type:'training',definitionId:'rifle',x:p.x,y:p.y,z:p.z}]});
 const before=w.count(p,'sealed_cell');accepted(action(w,p,'TrialModule',item,{moduleId:'rifle_focus'}));assert.equal(item.moduleId,'rifle_focus');accepted(action(w,p,'TrialModule',item,{moduleId:null}));assert.equal(item.moduleId,undefined);assert.equal(w.count(p,'sealed_cell'),before);
 assert.equal(action(w,p,'TrialModule',item,{moduleId:'shotgun_stop'}).ok,false);assert.equal(action(w,p,'DismantleGear',item,{stationId:'recycle',confirmEquipped:true}).code,'WRONG_PHASE');
 w.mode='adventure';assert.equal(action(w,p,'TrialModule',item,{moduleId:'rifle_focus'}).code,'WRONG_PHASE');
});

test('three-round carbine has fast intra-burst timing followed by mandatory recovery',()=>{
 const {w,p,item}=armed('carbine','carbine_burst'),def=effectiveWeapon(w.defs.weapons.carbine,item,p,w.s.time);assert.equal(def.rpm,750);
 for(let i=0;i<3;i++){p.fireAt=w.s.time+60/def.rpm;gearAfterShot(w,p,item,def);if(i<2)assert.equal(p.fireAt-w.s.time,.08);else assert(Math.abs(p.fireAt-w.s.time-.65)<1e-8);w.s.time+=.08;}
 assert(w.drainEvents().some(e=>e.eventType==='GearPulse'&&e.payload.cue==='burst_rest'));
});

test('pistol kill-loading transfers reserves without creating ammunition and ignores nonkills',()=>{
 const {w,p,item}=armed('pistol','pistol_chain');w.addItems(w.bag(p),'ammo_light',3);const e=w.spawnEnemy('crab',p.x,p.z-3),hit={actorId:p.id,itemId:item.id,weaponId:'pistol',moduleId:item.moduleId};
 gearAfterHit(w,e,hit);assert.equal(item.magazineAmmo,0);e.hp=0;gearAfterHit(w,e,hit);assert.equal(item.magazineAmmo,2);assert.equal(w.count(p,'ammo_light'),1);gearAfterHit(w,e,hit);assert.equal(item.magazineAmmo,2);
 const e2=w.spawnEnemy('crab',p.x,p.z-3);e2.hp=0;gearAfterHit(w,e2,hit);assert.equal(item.magazineAmmo,3);assert.equal(w.count(p,'ammo_light'),0);
});

test('SMG mobile-loading requires real movement, pause in firing and actual reserve rounds',()=>{
 const {w,p,item}=armed('smg','smg_mobile');w.addItems(w.bag(p),'ammo_light',3);p.moveSpeed=3;p.input={fire:false};updateGearGrowth(w,p,.1);
 for(let i=0;i<11;i++){p.x+=.3;w.s.time+=.1;updateGearGrowth(w,p,.1);}assert.equal(item.magazineAmmo,1);assert.equal(w.count(p,'ammo_light'),2);
 p.input.fire=true;for(let i=0;i<15;i++){p.x+=.3;w.s.time+=.1;updateGearGrowth(w,p,.1);}assert.equal(item.magazineAmmo,1);
 p.input.fire=false;p.x+=20;updateGearGrowth(w,p,.1);assert.equal(item.magazineAmmo,1);assert.equal(p.gearWalkDistance,0);
});

test('LMG four-hit suppression has target, timeout, immunity and resistance constraints',()=>{
 const {w,p,item}=armed('lmg','lmg_suppress'),e=w.spawnEnemy('crab',p.x,p.z-3),hit={actorId:p.id,itemId:item.id,weaponId:'lmg',moduleId:item.moduleId};
 for(let i=0;i<4;i++){gearAfterHit(w,e,hit);w.s.time+=.14;}assert.equal(gearEnemySpeed(e,w.s.time),.5);const until=e.gearSuppressedUntil;
 for(let i=0;i<5;i++){gearAfterHit(w,e,hit);w.s.time+=.14;}assert.equal(e.gearSuppressedUntil,until);w.s.time=until+.1;assert.equal(gearEnemySpeed(e,w.s.time),1);
 const boss=w.spawnEnemy('boss_crab',p.x,p.z-3);for(let i=0;i<6;i++)gearAfterHit(w,boss,hit);assert.equal(boss.gearSuppressedUntil,undefined);
});

test('focused rifle pierces one enemy only and stops at walls or a friendly body',()=>{
 const {w,p,item}=armed('rifle','rifle_focus');p.gearFocusSeconds=1;p.x=p.y=p.z=0;w.rayBlock=()=>null;
 const first=w.spawnEnemy('crab',0,-4),second=w.spawnEnemy('crab',0,-8),third=w.spawnEnemy('crab',0,-12);for(const e of [first,second,third])e.y=0;
 const args={target:first,from:{x:0,y:.65,z:0},direction:{x:0,y:0,z:-1},distance:3.4,maximum:120,shotId:'isolated-shot',damage:75};
 const hit=gearPiercingHit(w,p,item,args);assert.equal(hit.target,second.id);assert.equal(hit.damage,45);
 w.rayBlock=()=>({distance:6});assert.equal(gearPiercingHit(w,p,item,args),null);w.rayBlock=()=>null;
 const other=w.allocate('Synthetic blocker','growth-test-blocker');other.x=0;other.y=-.45;other.z=-6;assert.equal(gearPiercingHit(w,p,item,args),null);
 p.gearFocusSeconds=.99;assert.equal(gearPiercingHit(w,p,item,args),null);
});

test('real rifle fire queues the focused follow-through once and consumes one round',()=>{
 const {w,p,item}=armed('rifle','rifle_focus');item.magazineAmmo=3;p.gearFocusSeconds=1;p.input.ads=true;p.adsSince=-1;p.fireAt=0;w.rayBlock=()=>null;
 const first=w.spawnEnemy('crab',p.x,p.z-4),second=w.spawnEnemy('crab',p.x,p.z-8);first.y=second.y=p.y;first.hp=second.hp=1000;
 const rng=w.rng.bind(w);w.rng=stream=>stream==='combat'?.5:rng(stream);w.fire(p,0,Math.atan2(.65-w.c.player.camera_height,4),true);
 const follow=w.damageQueue.filter(h=>h.pierced);assert.equal(follow.length,1);assert.equal(follow[0].target,second.id);assert.equal(item.magazineAmmo,2);assert.equal(p.gearFocusSeconds,0);
 const events=w.drainEvents();assert.equal(events.filter(e=>e.eventType==='Shot').length,1,'one recoil and firing sound');assert.equal(events.filter(e=>e.eventType==='GearPierced').length,1,'follow-through has its own visual only');
});

test('real damage resolution connects pistol kills to reserve transfer without reloading',()=>{
 const {w,p,item}=armed('pistol','pistol_chain');item.magazineAmmo=2;w.addItems(w.bag(p),'ammo_light',4);const e=w.spawnEnemy('crab',p.x,p.z-3);e.hp=1;
 w.damageQueue.push({target:e.id,actorId:p.id,itemId:item.id,weaponId:'pistol',moduleId:'pistol_chain',shotId:'growth-integration',damage:2});w.resolveDamage();
 assert.equal(item.magazineAmmo,4);assert.equal(w.count(p,'ammo_light'),2);assert(!w.s.enemies[e.id]);
});

function reel(id,moduleId){const def=effectiveRod(base.rods.find(r=>r.id===id),{moduleId}),p={x:0,z:0,input:{reel:false},moveSpeed:0},f={x:0,z:8,creature:'crab',progress:0,tension:25,remaining:30};beginReeling(f,p,def);return {def,p,f};}
test('bell float auto-hooks while retaining a slower reel than the original rod',()=>{
 const def=effectiveRod(base.rods.find(r=>r.id==='rod_basic'),{moduleId:'rod_autohook'}),p={x:0,z:0,input:{}},f={x:0,z:8,creature:'crab',remaining:-.1};const result=updateWaiting(f,p,def,.1);assert.equal(result.autoHook,true);assert.equal(result.readyToBite,false);assert(def.reel_power<base.rods.find(r=>r.id==='rod_basic').reel_power);
});
test('rhythm handle rewards a deliberate short pull-pause-pull once, not holding or tiny pulses',()=>{
 const {def,p,f}=reel('rod_light','rod_rhythm');p.input.reel=true;updateReeling(f,p,def,.4);p.input.reel=false;updateReeling(f,p,def,.3);assert.equal(f.cue,'rhythm_ready');p.input.reel=true;const burst=updateReeling(f,p,def,.1);assert.equal(f.cue,'rhythm_pull');assert(burst.progressRate>def.reel_power*2);updateReeling(f,p,def,.8);p.input.reel=false;updateReeling(f,p,def,.1);p.input.reel=true;updateReeling(f,p,def,.1);assert.notEqual(f.cue,'rhythm_pull');
});
test('anchor rewards standing through the rush, and movement cancels the stored pull',()=>{
 for(const moving of [false,true]){const {def,p,f}=reel('rod_heavy','rod_anchor');for(let i=0;i<10;i++)updateReeling(f,p,def,.1);if(moving)p.x+=1;f._reelTime=1.5;p.input.reel=true;updateReeling(f,p,def,.1);assert.equal(f.cue==='anchor_pull',!moving);}
});
test('winch unlocks a snag after a deliberate release and does not skip the second snag',()=>{
 const {def,p,f}=reel('rod_magnet','rod_winch');f.progress=31;p.input.reel=true;updateReeling(f,p,def,.1);assert.equal(f.cue,'snag');p.input.reel=false;updateReeling(f,p,def,.5);assert.equal(f.cue,'winch_ready');p.input.reel=true;updateReeling(f,p,def,.1);assert.equal(f.cue,'winch_free');assert.equal(f._snagsDone,1);
 f.progress=66;updateReeling(f,p,def,.1);assert.equal(f._snagActive,true);assert.equal(f._snagsDone,1);assert.equal(f._winchReady,false);
});

for(const [id,moduleId] of [['rod_basic','rod_autohook'],['rod_light','rod_rhythm'],['rod_heavy','rod_anchor'],['rod_magnet','rod_winch']])test(id+' module has a complete finite reel strategy with normal tension constraints',()=>{
 const {def,p,f}=reel(id,moduleId),dt=1/30;let elapsed=0,broken=0,held=true;
 while(elapsed<(def.reel_timeout_seconds??45)&&f.progress<100&&broken<base.fishing.break_hold_seconds){
  if(f.tension>78)held=false;else if(f.tension<43)held=true;
  if(id==='rod_light')held=elapsed%1.1<.5&&f.tension<80;
  if(id==='rod_heavy')held=!f.struggling&&f.tension<80;
  if(id==='rod_magnet')held=f.cue!=='snag'&&f.tension<80;
  p.input.reel=held;const rates=updateReeling(f,p,def,dt,base.fishing);for(const rate of Object.values(rates))assert(Number.isFinite(rate)&&rate>=0);
  if(held){f.progress+=rates.progressRate*dt;f.tension+=rates.tensionRate*dt;}else {f.progress-=rates.lossRate*dt;f.tension-=def.tension_fall*dt;}
  f.progress=Math.max(0,Math.min(100,f.progress));f.tension=Math.max(0,Math.min(100,f.tension));broken=f.tension>=100?broken+dt:0;elapsed+=dt;
 }
 assert(f.progress>=100,`${id} reached ${f.progress.toFixed(1)} in ${elapsed.toFixed(1)}s`);assert(broken<base.fishing.break_hold_seconds);
});
