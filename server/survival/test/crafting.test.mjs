// In-memory synthetic worlds only; no real profiles, services or save writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SurvivalWorld} from '../world.mjs';
import {fixture,command,put,base} from './director-helpers.mjs';
import {beginReeling,updateReeling} from '../fishing-experience.mjs';
import {effectiveRod} from '../crafting-config.mjs';

const at=(w,p,id)=>{const t=w.staticWorld().terminals.find(t=>t.id===id);put(p,w,t.x,t.z+1.3);};
const clear=(w,p)=>{for(const id of [...w.bag(p).itemIds])w.removeItem(w.s.items[id]);};
const give=(w,p,ingredients,extra=0)=>{for(const row of ingredients)w.addItems(w.bag(p),row.definitionId,row.quantity+extra);};
const totals=w=>Object.values(w.s.items).reduce((r,i)=>(r[i.definitionId]=(r[i.definitionId]??0)+i.quantity,r),{});
const accepted=r=>{assert.equal(r.ok,true,r.code);return r;};
const mod=(w,p,item,moduleId)=>w.command(p,{requestId:p.requestHighWater+1,command:'ModGear',payload:{itemId:item.id,moduleId,stationId:'upgrade'},expectedRevision:item.revision});

for(const recipeId of ['shotgun','rod_pro'])test(recipeId+' crafts from carried ingredients once and persists its instance through death and reload',()=>{
 const {w,p}=fixture();clear(w,p);const recipe=w.c.crafting.recipes.find(r=>r.id===recipeId);give(w,p,recipe.ingredients);at(w,p,'craft');
 const message={requestId:p.requestHighWater+1,command:'Craft',payload:{recipeId,stationId:'craft'}};
 const result=accepted(w.command(p,message)),item=w.s.items[result.data.itemId];assert.equal(item.definitionId,recipeId);assert.equal(item.magazineAmmo,0);
 const total=totals(w);accepted(w.command(p,message));assert.deepEqual(totals(w),total);for(const row of recipe.ingredients)assert.equal(w.count(p,row.definitionId),0);
 w.die(p);assert.equal(w.s.containers[item.containerId].type,'corpse');const restored=new SurvivalWorld(w.c,w.serialize(),{onlineRoster:true});assert.equal(restored.s.items[item.id].crafted,true);restored.assertInvariants();
});
test('craft is atomic when missing materials, out of range, at the wrong station, or without final capacity',()=>{
 const {w,p}=fixture();clear(w,p);const recipe=w.c.crafting.recipes[0];at(w,p,'craft');const before=totals(w);
 assert.equal(command(w,p,'Craft',{recipeId:recipe.id,stationId:'craft'}).code,'NO_MATERIALS');assert.deepEqual(totals(w),before);
 give(w,p,recipe.ingredients,1);while(w.bag(p).itemIds.length<w.bag(p).slotLimit)w.createItem('coffee_coupon',1,w.bag(p));const full=totals(w);
 assert.equal(command(w,p,'Craft',{recipeId:recipe.id,stationId:'craft'}).code,'NO_CAPACITY');assert.deepEqual(totals(w),full);
 assert.equal(command(w,p,'Craft',{recipeId:recipe.id,stationId:'upgrade'}).code,'OUT_OF_RANGE');put(p,w,30,30);assert.equal(command(w,p,'Craft',{recipeId:recipe.id,stationId:'craft'}).code,'OUT_OF_RANGE');assert.deepEqual(totals(w),full);
});
test('consuming entire ingredient stacks can free a full backpack slot before output placement',()=>{
 const {w,p}=fixture();clear(w,p);const recipe=w.c.crafting.recipes[0];give(w,p,recipe.ingredients);while(w.bag(p).itemIds.length<w.bag(p).slotLimit)w.createItem('coffee_coupon',1,w.bag(p));at(w,p,'craft');accepted(command(w,p,'Craft',{recipeId:recipe.id,stationId:'craft'}));assert.equal(w.bag(p).itemIds.length,w.bag(p).slotLimit-recipe.ingredients.length+1);w.assertInvariants();
});
test('a player cannot craft using another player inventory, warehouse materials, or locked items',()=>{
 const {w,p,ps}=fixture(2);clear(w,p);clear(w,ps[1]);const recipe=w.c.crafting.recipes[0];give(w,ps[1],recipe.ingredients);at(w,p,'craft');assert.equal(command(w,p,'Craft',{recipeId:recipe.id,stationId:'craft'}).code,'NO_MATERIALS');
 give(w,p,recipe.ingredients);w.s.items[w.bag(p).itemIds[0]].lockedBy='synthetic-lock';const before=totals(w);assert.equal(command(w,p,'Craft',{recipeId:recipe.id,stationId:'craft'}).code,'NO_MATERIALS');assert.deepEqual(totals(w),before);
});
test('one-click recycling preserves all crafting ingredients and normal shop cannot bypass recipes',()=>{
 const {w,p}=fixture();clear(w,p);give(w,p,w.c.crafting.recipes[0].ingredients);w.addItems(w.bag(p),'catch_shore',2);at(w,p,'recycle');accepted(command(w,p,'Deposit',{stationId:'recycle'}));for(const row of w.c.crafting.recipes[0].ingredients)assert.equal(w.count(p,row.definitionId),row.quantity);assert.equal(w.count(p,'catch_shore'),0);
 at(w,p,'terminal');for(const definitionId of ['shotgun','rod_pro'])assert.equal(command(w,p,'Buy',{definitionId,stationId:'terminal'}).code,'CRAFT_ONLY');
});
for(const moduleId of ['shotgun_stop','rod_rebound'])test(moduleId+' modifies only an owned correct item once and survives inventory/death/save',()=>{
 const {w,p}=fixture();clear(w,p);const module=w.c.crafting.modules.find(m=>m.id===moduleId),item=w.createItem(module.definitionId,1,w.bag(p));give(w,p,module.ingredients);at(w,p,'upgrade');
 const before=totals(w);assert.equal(w.command(p,{requestId:p.requestHighWater+1,command:'ModGear',payload:{itemId:item.id,moduleId,stationId:'upgrade'},expectedRevision:item.revision+1}).code,'STALE_REVISION');assert.deepEqual(totals(w),before);
 accepted(mod(w,p,item,moduleId));assert.equal(item.moduleId,moduleId);assert.equal(mod(w,p,item,moduleId).code,'ALREADY_MODDED');w.die(p);const restored=new SurvivalWorld(w.c,w.serialize(),{onlineRoster:true});assert.equal(restored.s.items[item.id].moduleId,moduleId);restored.assertInvariants();
});
test('borrowed equipment and mismatched modules cannot consume materials',()=>{
 const {w,p}=fixture();clear(w,p);const item=w.createItem('shotgun',1,w.bag(p),{loanOwnerSlotId:p.slotId});give(w,p,w.c.crafting.modules[0].ingredients);at(w,p,'upgrade');const before=totals(w);assert.equal(mod(w,p,item,'shotgun_stop').code,'BUSY');assert.equal(mod(w,p,item,'rod_rebound').code,'INVALID_TARGET');assert.deepEqual(totals(w),before);
});
function queuedHit(w,p,e,{pellets=3,close=true,module=true}={}){const shotId=w.id('test-shot');for(let n=0;n<pellets;n++)w.damageQueue.push({target:e.id,damage:1,actorId:p.id,weaponId:'shotgun',shotId,moduleId:module?'shotgun_stop':null,pelletHits:1,closePelletHits:close?1:0,direction:{x:0,y:0,z:-1}});w.resolveDamage();}
test('stop module groups a single close shot, interrupts ordinary enemies, and cannot chain-stun',()=>{
 const {w,p}=fixture(),e=w.spawnEnemy('crab',p.x,p.z-4);e.hp=e.maxHp=500;e.state='WINDUP';queuedHit(w,p,e);assert.equal(e.state,'STUNNED');assert.equal(e.phaseRemaining,.55);assert.equal(w.drainEvents().filter(e=>e.eventType==='EnemyInterrupted').length,1);
 e.state='WINDUP';w.s.time+=1;queuedHit(w,p,e);assert.equal(e.state,'WINDUP');w.s.time+=3;queuedHit(w,p,e);assert.equal(e.state,'STUNNED');
});
test('insufficient pellets, long range, base gun, elite and boss do not gain ordinary hard control',()=>{
 for(const options of [{pellets:2},{close:false},{module:false}]){const {w,p}=fixture(),e=w.spawnEnemy('crab',p.x,p.z-4);e.hp=e.maxHp=500;e.state='WINDUP';queuedHit(w,p,e,options);assert.equal(e.state,'WINDUP');}
 for(const id of ['manager_koi','boss_crab']){const {w,p}=fixture(),e=w.spawnEnemy(id,p.x,p.z-4);e.hp=e.maxHp=1000;e.state='WINDUP';queuedHit(w,p,e);assert.equal(e.state,'WINDUP');}
});
test('real shotgun fire attaches the installed module and groups close pellet hits',()=>{
 const {w,p}=fixture(),slot=w.s.containers[p.equipment.weapon];for(const id of [...slot.itemIds])w.removeItem(w.s.items[id]);const item=w.createItem('shotgun',1,slot,{magazineAmmo:4,moduleId:'shotgun_stop'});p.heldSlot='weapon';p.equipUntil=0;p.fireAt=0;p.input.ads=true;p.adsSince=-1;
 const e=w.spawnEnemy('crab',p.x,p.z-4);e.hp=e.maxHp=500;e.state='WINDUP';const rng=w.rng.bind(w);w.rng=stream=>stream==='combat'?.5:rng(stream);const pitch=Math.atan2(e.y+.65-p.y-w.c.player.camera_height,4);w.fire(p,0,pitch,true);assert(w.damageQueue.length>=3);assert(w.damageQueue.every(h=>h.moduleId==='shotgun_stop'));w.resolveDamage();assert.equal(e.state,'STUNNED');assert.equal(item.magazineAmmo,3);
});
function reel(module=true){const def=effectiveRod(base.rods.find(r=>r.id==='rod_pro'),{moduleId:module?'rod_rebound':null}),p={x:0,z:0,input:{reel:false}},f={x:0,z:10,creature:'silverfish',progress:0,tension:25,remaining:40};beginReeling(f,p,def);return{def,p,f};}
test('rebound requires correct lateral positioning and a pause, then spends one burst per direction',()=>{
 const {def,p,f}=reel();p.x=1;updateReeling(f,p,def,.2);updateReeling(f,p,def,.2);assert.equal(f.cue,'rebound_ready');p.input.reel=true;const rate=updateReeling(f,p,def,.1);assert.equal(f.cue,'rebound_pull');const normal=reel(false);normal.p.x=1;normal.p.input.reel=true;normal.f._reelTime=.4;const plain=updateReeling(normal.f,normal.p,normal.def,.1);assert(rate.progressRate>plain.progressRate*1.5);
 updateReeling(f,p,def,.8);for(let i=0;i<5;i++){p.input.reel=false;updateReeling(f,p,def,.1);p.input.reel=true;updateReeling(f,p,def,.1);assert.notEqual(f.cue,'rebound_pull');}assert.equal(f._reboundSpent,true);
 f._reelTime=5.1;p.x=-1;p.input.reel=false;updateReeling(f,p,def,.4);assert.equal(f.cue,'rebound_ready');p.input.reel=true;updateReeling(f,p,def,.1);assert.equal(f.cue,'rebound_pull');
});
test('wrong side, continuous hold and invalid rod module cannot create rebound bursts',()=>{
 for(const mode of ['wrong','hold','base']){const {def,p,f}=reel(mode!=='base');p.x=mode==='wrong'?-1:1;p.input.reel=mode==='hold';for(let n=0;n<20;n++)updateReeling(f,p,def,.05);p.input.reel=true;updateReeling(f,p,def,.05);assert.notEqual(f.cue,'rebound_pull');}
});
