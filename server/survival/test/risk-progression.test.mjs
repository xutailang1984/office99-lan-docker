// Synthetic, in-memory fixtures; no production data or services.
import test from 'node:test';import assert from 'node:assert/strict';
import {fixture,command,put} from './director-helpers.mjs';
import {riskCost,RISK_ITEMS} from '../risk-progression.mjs';
import {nodeMaterialLoot,expeditionContract} from '../expedition-config.mjs';
import {SurvivalWorld} from '../world.mjs';
const keys=RISK_ITEMS.map(d=>d.id),at=(w,p,id)=>{const s=w.staticWorld().terminals.find(s=>s.id===id);put(p,w,s.x,s.z+1);};
const clear=(w,p)=>{for(const id of [...w.bag(p).itemIds])w.removeItem(w.s.items[id]);};
const give=(w,p,rows)=>{for(const row of rows)w.addItems(w.bag(p),row.definitionId,row.quantity);};
test('base equipment remains accessible while every advanced recipe requires an earned core',()=>{
 const {w,p}=fixture();
 for(const recipe of w.c.crafting.recipes){clear(w,p);give(w,p,recipe.ingredients.filter(r=>!keys.includes(r.definitionId)));at(w,p,'craft');const result=command(w,p,'Craft',{recipeId:recipe.id,stationId:'craft'});
  if(recipe.risk>1){assert.equal(result.code,'NO_MATERIALS',recipe.id);give(w,p,recipe.ingredients.filter(r=>keys.includes(r.definitionId)));assert.equal(command(w,p,'Craft',{recipeId:recipe.id,stationId:'craft'}).ok,true,recipe.id);}
  else assert.equal(result.ok,true,recipe.id);
 }
 for(const id of keys){assert(!w.defs.items[id].buy_c);assert(!w.c.crafting.recipes.some(r=>r.definitionId===id));}
});
test('all 28 functional modules and four fittings reject ordinary materials without a risk core',()=>{
 const {w,p}=fixture();for(const [type,rows,key]of [['ModGear',w.c.crafting.modules,'moduleId'],['FitAttachment',w.c.crafting.attachments,'attachmentId']])for(const row of rows){
  clear(w,p);const gear=w.createItem(row.definitionId??(row.kind==='rod'?'rod_basic':'carbine'),1,w.bag(p));give(w,p,row.ingredients.filter(r=>!keys.includes(r.definitionId)));at(w,p,'upgrade');
  const payload={itemId:gear.id,[key]:row.id,stationId:'upgrade'};const sent=()=>w.command(p,{requestId:p.requestHighWater+1,command:type,payload,expectedRevision:gear.revision});
  assert.equal(sent().code,'NO_MATERIALS',row.id);give(w,p,row.ingredients.filter(r=>keys.includes(r.definitionId)));assert.equal(sent().ok,true,row.id);
 }
});
test('all eight weapon upgrades need and consume a core; cancelling or removing it cannot buy a level',()=>{
 for(const def of fixture().w.c.weapons)for(const outcome of ['complete','cancel','removed']){
  const {w,p}=fixture();clear(w,p);const gun=w.createItem(def.id,1,w.bag(p));w.s.bank.credits=1000;w.s.bank.materials=100;at(w,p,'upgrade');
  assert.equal(command(w,p,'Upgrade',{stationId:'upgrade'},gun.id).code,'NO_MATERIALS');const cost=riskCost(def.id,{improvement:true});give(w,p,cost);
  assert.equal(command(w,p,'Upgrade',{stationId:'upgrade'},gun.id).ok,true);p.input.interact=true;
  if(outcome==='cancel')w.cancelWork(p);else {if(outcome==='removed')for(const id of [...w.bag(p).itemIds])if(keys.includes(w.s.items[id].definitionId))w.removeItem(w.s.items[id]);w.updateWork(p,5);}
  assert.equal(gun.level,outcome==='complete'?2:1,def.id);assert.equal(w.s.bank.credits,outcome==='complete'?860:1000);assert.equal(w.s.bank.reservedCredits,0);assert.equal(w.count(p,cost[0].definitionId),outcome==='cancel'?1:0);w.assertInvariants();
 }
});
test('risk material sources are exclusive and every party size generates high-risk caches',()=>{
 for(const count of [1,2,4,8]){const {w}=fixture(count);w.s.lockedPlayerCount=count;w.generateDay();for(const zone of ['salvage','hunt','supply'])assert(Object.values(w.s.nodes).some(n=>n.zoneId===zone&&n.kind==='treasure'),`${count} ${zone}`);}
 for(const zone of ['salvage','hunt','supply'])for(const kind of ['scrap','treasure']){const loot=nodeMaterialLoot(zone,kind),cores=loot.filter(([id])=>keys.includes(id));assert.deepEqual(cores,kind!=='treasure'||zone==='salvage'?[]:[[zone==='hunt'?'field_core':'hazard_core',1]]);}
 for(const zone of ['salvage','hunt','supply'])assert.deepEqual(expeditionContract(zone).reward.filter(r=>keys.includes(r.definitionId)).map(r=>r.definitionId),zone==='salvage'?[]:[zone==='hunt'?'field_core':'hazard_core']);
 const {w}=fixture();for(const rod of w.c.rods)assert(!(rod.loot_table??[]).some(r=>keys.includes(r.definitionId)));assert(!JSON.stringify(w.c.fishing).match(/field_core|hazard_core/));
});
test('old or new high-tier equipment never refunds risk cores through disassembly',()=>{
 const {w,p}=fixture();clear(w,p);const gun=w.createItem('rifle',1,w.bag(p),{moduleId:'rifle_focus'});at(w,p,'recycle');
 assert.equal(w.command(p,{requestId:p.requestHighWater+1,command:'DismantleGear',payload:{itemId:gun.id,stationId:'recycle'},expectedRevision:gun.revision}).ok,true);
 for(const id of keys)assert.equal(w.count(p,id),0);
});
test('fishing supply exposes its daily bound and resets on a new day',()=>{
 const {w}=fixture();let p=w.exploration.public().fishParts;assert(p.limit>0);assert.equal(p.remaining,p.limit);w.exploration.s.partDay=w.s.dayIndex;w.exploration.s.partsGranted=p.limit;assert.equal(w.exploration.public().fishParts.remaining,0);w.s.dayIndex++;assert.equal(w.exploration.public().fishParts.remaining,p.limit);
});
const coreTotals=w=>Object.fromEntries(keys.map(id=>[id,Object.values(w.s.items).filter(i=>i.definitionId===id).reduce((n,i)=>n+i.quantity,0)]));
function defeat(w,boss,actorId){w.damageQueue.push({target:boss.id,actorId,damage:999999});w.resolveDamage();assert.equal(w.s.enemies[boss.id],undefined);}
for(const stage of [1,2,3,4])test(`real night stage ${stage} awards exactly one correct core across replay and restore`,()=>{
 const {w,p}=fixture();const before=coreTotals(w);w.s.threatStage=stage;w.startNight();const boss=w.s.enemies[w.s.night.bossId];assert(boss);const nightId=w.s.night.id;defeat(w,boss,p.id);
 const expected=stage<=2?{field_core:1,hazard_core:0}:{field_core:0,hazard_core:1},box=w.s.containers[w.s.night.rewardContainerId];assert(box);
 for(const id of keys)assert.equal(box.itemIds.map(i=>w.s.items[i]).filter(i=>i.definitionId===id).reduce((n,i)=>n+i.quantity,0),expected[id]);
 const awarded=Object.fromEntries(keys.map(id=>[id,before[id]+expected[id]]));assert.deepEqual(coreTotals(w),awarded);w.killEnemy(boss,p.id);w.bossReward(boss,p.id);assert.deepEqual(coreTotals(w),awarded);
 const restored=new SurvivalWorld(w.c,w.serialize()),boxId=restored.s.night.rewardContainerId;restored.killEnemy(boss,p.id);restored.bossReward(boss,p.id);assert.deepEqual(coreTotals(restored),awarded);assert.equal(restored.s.night.rewardContainerId,boxId);assert.equal(restored.s.resultLedger.filter(k=>k===`boss-reward:${nightId}`).length,1);restored.assertInvariants();
});
test('an unregistered wild boss cannot claim the active night core',()=>{
 const {w,p}=fixture();w.s.threatStage=4;w.startNight();const id=w.s.night.bossId,before=coreTotals(w),outsider=w.spawnEnemy('boss_crab',p.x+12,p.z,false);outsider.source='wild';assert.notEqual(outsider.id,id);assert.equal(outsider.night,false);defeat(w,outsider,p.id);assert.deepEqual(coreTotals(w),before);assert.equal(w.s.night.rewardClaimed,false);assert(w.s.enemies[id]);w.assertInvariants();
});
for(const stage of [1,4])test(`training suppresses progression cores even for a registered stage ${stage} night`,()=>{
 const {w:base}=fixture(),w=new SurvivalWorld(base.c,null,{mode:'mission',missionStart:'free'}),p=w.allocate('机芯训练测试',`synthetic-risk-training-${stage}`);w.connect(p,p.name);assert.equal(w.mode,'mission');w.s.threatStage=stage;w.startNight();const boss=w.s.enemies[w.s.night.bossId];assert(boss);const before=coreTotals(w);defeat(w,boss,p.id);assert.equal(w.s.night.rewardClaimed,true);assert(w.s.containers[w.s.night.rewardContainerId]);assert.deepEqual(coreTotals(w),before);w.bossReward(boss,p.id);assert.deepEqual(coreTotals(w),before);w.assertInvariants();
});
