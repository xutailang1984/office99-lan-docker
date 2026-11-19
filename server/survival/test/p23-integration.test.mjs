// Deterministic merge checks: real simulation/career interfaces, synthetic
// accounts, temporary checked-store files only. No listeners or production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadConfig} from '../config.mjs';
import {SurvivalWorld} from '../world.mjs';
import {Careers} from '../../platform/careers.mjs';
import {createCareerCapsule,extractCareerCapsule,importCareerCapsule,validateCareerCapsule,stripCareerPlayer,safeCareerExit} from '../career-state.mjs';
import {CRAFTING_MODULES,CRAFTING_MATERIALS} from '../crafting-config.mjs';
import {ZONE_RISKS,dayEncounterBudget,nightEncounterBudget,expeditionContract} from '../expedition-config.mjs';

const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url)),clone=structuredClone;
const account='p23-synthetic-account';
function careerWorld(count=1,{capsule=null,accountId=account,revision=2,day=true}={}){
 const w=new SurvivalWorld(clone(config),null,{onlineRoster:true}),ps=[];
 for(let i=0;i<count;i++){const id=i===0?accountId:accountId+'-'+i,p=w.allocate('合并测试','account:'+id,{career:true});importCareerCapsule(w,p,{accountId:id,revision,capsule:clone(i===0&&capsule?capsule:createCareerCapsule(config))});ps.push(p);}
 if(day){w.beginDayBarrier();w.finishDayBarrier();w.s.director.objective=null;w.s.director.optionalObjective=null;}
 return {w,p:ps[0],ps};
}
const send=(w,p,command,payload={},top={})=>w.command(p,{requestId:p.requestHighWater+1,command,payload,...top});
const accepted=result=>{assert.equal(result.ok,true,result.message??result.code);return result;};
function at(w,p,target){if(typeof target==='string')target=w.staticWorld().terminals.find(t=>t.id===target);assert(target);Object.assign(p,{x:target.x,y:w.ground(target.x,target.z),z:target.z,swimming:false,damageAt:-100,connected:true});}
function clear(w,p,all=false){const ids=all?[p.backpackId,p.vaultId,...Object.values(p.equipment)]:[p.backpackId];for(const id of ids)for(const itemId of [...w.s.containers[id].itemIds])w.removeItem(w.s.items[itemId]);}
function search(w,p,node){at(w,p,node);accepted(send(w,p,'Search',{}, {targetId:node.id}));p.input.interact=true;w.updateWork(p,p.work.duration+.1);assert.equal(node.state,'depleted');}
const materials=(w,p)=>Object.fromEntries(CRAFTING_MATERIALS.map(id=>[id,w.count(p,id)]));
const assets=c=>[...c.backpack,...c.vault,...Object.values(c.equipment).flat()];
function outfitted(){
 const f=careerWorld(1,{day:false}),{w,p}=f;clear(w,p,true);p.perks=['pockets'];w.director.player(p);p.wallet.credits=319;p.wallet.materials=47;p.blueprints=w.c.crafting.recipes.map(r=>r.id);
 p.rewardOffers=[{id:'p23-chosen-offer',source:'test',options:['pockets'],selected:'pockets',createdAt:0}];
 for(const [index,module]of CRAFTING_MODULES.entries()){
  const type=w.defs.items[module.definitionId].kind,container=index<2?w.s.containers[p.equipment[type]]:index===2||w.bag(p).itemIds.length>=w.bag(p).slotLimit?w.s.containers[p.vaultId]:w.bag(p);
  w.createItem(module.definitionId,1,container,{moduleId:module.id,crafted:true,level:2,magazineAmmo:Math.min(3,w.defs.weapons[module.definitionId]?.magazine??0)});
 }
 return {...f,capsule:extractCareerCapsule(w.s,account)};
}

test('all 28 gear cores, growth and a single pockets expansion survive repeated worlds and reloads',()=>{
 let {capsule}=outfitted();const expected=clone(capsule);assert.equal(assets(capsule).length,CRAFTING_MODULES.length);assert.equal(capsule.bagSlots,config.player.backpack_slots+2);
 for(let hop=0;hop<5;hop++){
  const {w,p}=careerWorld(1,{capsule,revision:10+hop,day:false});w.director.player(p);w.director.player(p);assert.equal(w.bag(p).slotLimit,expected.bagSlots);
  const loaded=new SurvivalWorld(clone(config),JSON.parse(JSON.stringify(w.serialize())),{onlineRoster:true}),actor=loaded.s.players[p.id];loaded.connect(actor);loaded.director.player(actor);
  capsule=extractCareerCapsule(loaded.s,account);validateCareerCapsule(capsule,config);assert.deepEqual(capsule,expected);assert.equal(actor.careerRevision,10+hop);
  const ids=assets(capsule).map(i=>i.id);assert.equal(new Set(ids).size,CRAFTING_MODULES.length);stripCareerPlayer(loaded.s,account);assert.ok(ids.every(id=>!loaded.s.items[id]));loaded.assertInvariants();
 }
});

test('module capsules reject mismatched, unknown and duplicated gear instead of importing altered assets',()=>{
 const {capsule}=outfitted();validateCareerCapsule(capsule,config);
 for(const module of CRAFTING_MODULES){const bad=clone(capsule),item=assets(bad).find(i=>i.moduleId===module.id);item.definitionId=module.definitionId==='rod_basic'?'carbine':'rod_basic';assert.throws(()=>validateCareerCapsule(bad,config));}
 const unknown=clone(capsule);assets(unknown)[0].moduleId='p23-unknown-module';assert.throws(()=>validateCareerCapsule(unknown,config));
 const duplicate=clone(capsule);duplicate.vault.push(clone(assets(duplicate)[0]));assert.throws(()=>validateCareerCapsule(duplicate,config));
});

test('gear made at the same counter in different rooms keeps distinct asset IDs when owners meet',()=>{
 const a=careerWorld(1,{accountId:'p23-origin-a',day:false}),b=careerWorld(1,{accountId:'p23-origin-b',day:false});
 const first=a.w.createItem('shotgun',1,a.w.bag(a.p)),second=b.w.createItem('shotgun',1,b.w.bag(b.p));assert.notEqual(first.id,second.id);
 const destination=careerWorld(1,{capsule:extractCareerCapsule(a.w.s,'p23-origin-a'),accountId:'p23-origin-a',day:false}),guest=destination.w.allocate('另一房队员','account:p23-origin-b',{career:true});
 importCareerCapsule(destination.w,guest,{accountId:'p23-origin-b',revision:4,capsule:extractCareerCapsule(b.w.s,'p23-origin-b')});
 assert.equal(destination.w.s.items[first.id].containerId,destination.p.backpackId);assert.equal(destination.w.s.items[second.id].containerId,guest.backpackId);destination.w.assertInvariants();
});

test('ordinary material creation after import cannot overwrite the imported gear at the same local counter',()=>{
 const source=careerWorld(1,{day:false}),item=source.w.createItem('shotgun',1,source.w.bag(source.p),{level:2,moduleId:'shotgun_stop'}),capsule=extractCareerCapsule(source.w.s,account);
 const {w,p}=careerWorld(1,{capsule,day:false}),before=clone(w.s.items[item.id]);
 // Equal local counters are normal in independently created worlds.
 for(let i=0;i<4;i++)w.createItem('scrap',1,w.bag(p));assert.deepEqual(w.s.items[item.id],before);w.assertInvariants();
});

test('checked career handoff persists the actual 28-core world capsule once and fences the old revision',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'office-p23-integration-')),worlds=new Map();
 t.after(async()=>{const target=path.resolve(directory);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(target).startsWith('office-p23-integration-'));await fs.rm(target,{recursive:true,force:true});});
 const options={directory,config,getWorldStore:id=>({load:async()=>clone(worlds.get(id)??null),save:async value=>{worlds.set(id,clone(value));}})};
 let careers=await new Careers(options).load();const binding=await careers.claim(account,'p23-world-a'),{w,p,capsule}=outfitted();p.careerRevision=binding.revision;
 const checkpoint=careers.checkpoint(account,'p23-world-a',binding.revision,capsule);assert.equal(checkpoint.revision,binding.revision);
 await careers.commit({adventureId:'p23-world-a',profiles:[checkpoint]});
 await assert.rejects(careers.claim(account,'p23-world-b'),error=>error.code==='CAREER_HELD');
 const next=careers.settled(account,'p23-world-a',binding.revision,extractCareerCapsule(w.s,account)),state=w.serialize();stripCareerPlayer(state,account);
 const snapshot={revision:1,state,checksum:createHash('sha256').update(JSON.stringify(state)).digest('hex')};
 await careers.commit({adventureId:'p23-world-a',profiles:[next],snapshot,economyEpoch:1,receipt:{id:'p23-handoff',revision:1}});
 careers=await new Careers(options).load();const imported=await careers.claim(account,'p23-world-b');assert.deepEqual(imported.capsule,capsule);assert.equal(careers.epoch('p23-world-a'),1);assert.ok(assets(capsule).every(i=>!worlds.get('p23-world-a').state.items[i.id]));
 assert.throws(()=>careers.checkBinding(account,'p23-world-a',binding.revision),error=>error.code==='CAREER_CHANGED');
 const joined=careerWorld(1,{capsule:imported.capsule,revision:imported.revision,day:false});assert.deepEqual(extractCareerCapsule(joined.w.s,account),capsule);joined.w.assertInvariants();
});

test('3/5/6/7 player budgets interpolate with bounded stock, accessible goals and no boss-health cliff',()=>{
 const guards=[6,10,13,16,18,20,22,24],nodes=[10,18,25,32,38,44,50,56],caps=[5,8,10,12,14,15,17,18],factors=[1,1.65,2.275,2.9,3.475,4.05,4.625,5.2];
 let lastPerPerson=Infinity;
 for(let n=1;n<=8;n++){
  assert.deepEqual(dayEncounterBudget(n),{players:n,guards:guards[n-1],nodes:nodes[n-1]});assert.deepEqual(nightEncounterBudget(n),{players:n,aliveCap:caps[n-1],bossFactor:factors[n-1]});
  const {w}=careerWorld(n),diff=w.difficultyFor(n);assert.equal(Object.keys(w.s.nodes).length,nodes[n-1]);assert.equal(Object.values(w.s.enemies).filter(e=>e.source==='wild').length,guards[n-1]);assert.equal(diff.aliveCap,caps[n-1]);
  assert.ok(diff.bossHp/n<=lastPerPerson+.001);lastPerPerson=diff.bossHp/n;
  for(const zone of ZONE_RISKS){const stock=Object.values(w.s.nodes).filter(node=>node.zoneId===zone.id).length;for(const day of [1,2])assert.ok(stock>=n*expeditionContract(zone.id,day).searchGoal,`${n} players day ${day} ${zone.id}`);}
 }
 assert.equal(dayEncounterBudget(100).nodes,56);assert.equal(nightEncounterBudget(NaN).bossFactor,1);
});

test('low-risk finite stock restores base tools but cannot craft advanced equipment',()=>{
 const {w,p}=careerWorld();clear(w,p);w.s.enemies={};w.s.destructibles={};
 for(const node of Object.values(w.s.nodes).filter(n=>n.zoneId==='salvage'))search(w,p,node);
 assert.ok(w.count(p,'sealed_cell')>=1);assert.ok(w.count(p,'spring_parts')>=5);
 at(w,p,'craft');assert.equal(send(w,p,'Craft',{recipeId:'shotgun',stationId:'craft'}).code,'NO_MATERIALS');const gun=accepted(send(w,p,'Craft',{recipeId:'carbine',stationId:'craft'})),rod=accepted(send(w,p,'Craft',{recipeId:'rod_basic',stationId:'craft'}));assert.equal(w.s.items[gun.data.itemId].magazineAmmo,0);assert.equal(w.s.items[rod.data.itemId].definitionId,'rod_basic');
 // The rotating low-risk drawer event supplies a second independent source.
 // Force its preceding history, not its reward, so the real event generates.
 w.s.exploration.history.push(...['desk_alarm','desk_stamp','desk_print'].map(type=>({zone:'salvage',type,day:w.s.dayIndex}))); w.exploration.generate();const event=w.s.exploration.events.find(e=>e.zoneId==='salvage');assert.equal(event.type,'desk_sort');
 const drawer=event.parts[event.answer];at(w,p,drawer);const before=w.count(p,'sealed_cell');accepted(send(w,p,'Explore',{}, {targetId:drawer.id,expectedRevision:drawer.revision}));p.input.interact=true;w.updateWork(p,p.work.duration+.1);assert.equal(event.rewarded,true);
 const box=w.s.containers[event.lootContainerId];at(w,p,box);accepted(send(w,p,'Pickup',{}, {targetId:box.id,expectedRevision:box.revision}));assert.equal(w.count(p,'sealed_cell'),before+1);w.assertInvariants();
});

test('daytime rewards remain world/account scoped after safe cross-room return, late join, death and reload',()=>{
 const {w,p}=careerWorld();clear(w,p);w.s.enemies={};w.s.destructibles={};for(const node of Object.values(w.s.nodes).filter(n=>n.zoneId==='salvage').slice(0,2))search(w,p,node);
 at(w,p,'storage');accepted(send(w,p,'ReturnExpedition',{stationId:'storage',zoneId:'salvage'}));assert.equal(safeCareerExit(w.s,account,w.c),true);const capsule=extractCareerCapsule(w.s,account),paid=materials(w,p),source=w.serialize();stripCareerPlayer(source,account);
 const other=careerWorld(1,{capsule,revision:4});assert.equal(other.w.expedition.contracts(other.p).find(c=>c.zoneId==='salvage').claimed,false);
 const backCapsule=extractCareerCapsule(other.w.s,account),resumed=new SurvivalWorld(clone(config),source,{onlineRoster:true});resumed.allocate('晚到队友','account:p23-late-guest');const joined=resumed.allocate('归来的队员','account:'+account,{career:true});importCareerCapsule(resumed,joined,{accountId:account,revision:6,capsule:backCapsule});at(resumed,joined,'storage');
 assert.equal(resumed.expedition.contracts(joined).find(c=>c.zoneId==='salvage').claimed,true);assert.equal(send(resumed,joined,'ReturnExpedition',{stationId:'storage',zoneId:'salvage'}).ok,false);assert.deepEqual(materials(resumed,joined),paid);
 resumed.die(joined);resumed.respawn(joined);at(resumed,joined,'storage');assert.equal(send(resumed,joined,'ReturnExpedition',{stationId:'storage',zoneId:'salvage'}).ok,false);
 const reloaded=new SurvivalWorld(clone(config),resumed.serialize(),{onlineRoster:true}),again=reloaded.s.players[joined.id];reloaded.connect(again);assert.equal(reloaded.expedition.contracts(again).find(c=>c.zoneId==='salvage').claimed,true);reloaded.assertInvariants();
});

test('bulk recycling records only real material gains in the personal or recovery-box destination, once',()=>{
 const {w,p}=careerWorld();clear(w,p);const definition=w.defs.items.catch_shore;
 const objective=w.director.newObjective(w.c.director.objectives.find(o=>o.id==='priority_supply'));w.s.director.objective=objective;w.s.director.optionalObjective=null;
 // Current bulk-recyclable catches pay coins only; they must not advance a
 // material goal. Crafting materials remain protected from bulk recycling.
 w.addItems(w.bag(p),'catch_shore',1);w.addItems(w.bag(p),'scrap',1);at(w,p,'recycle');const bank=clone(w.s.bank),before=p.wallet.materials;
 accepted(send(w,p,'Deposit',{stationId:'recycle'}));assert.equal(objective.progress,0);assert.equal(w.count(p,'scrap'),1);assert.equal(p.wallet.materials,before);
 // Isolated content fixture verifies a recyclable material-bearing catch.
 // This is deliberately not claimed to be a current shipped loot value.
 definition.deposit_m=2;w.addItems(w.bag(p),'catch_shore',1);
 const message={requestId:p.requestHighWater+1,command:'Deposit',payload:{stationId:'recycle'}};accepted(w.command(p,message));
 assert.equal(p.wallet.materials-before,definition.deposit_m);assert.equal(objective.progress,Math.min(objective.goal,definition.deposit_m));assert.deepEqual(w.s.bank,bank);
 const progress=objective.progress,wallet=clone(p.wallet),offers=clone(p.rewardOffers);accepted(w.command(p,message));assert.equal(objective.progress,progress);assert.deepEqual(p.wallet,wallet);assert.deepEqual(p.rewardOffers,offers);
 accepted(send(w,p,'Deposit',{stationId:'recycle'}));assert.equal(objective.progress,progress);assert.equal(p.wallet.materials,wallet.materials);assert.equal(p.wallet.credits,wallet.credits);
 const protectedWallet=clone(p.wallet),box=w.createContainer('recovery',1,{x:p.x,y:p.y,z:p.z,recoverableC:3,recoverableM:3});
 accepted(send(w,p,'Deposit',{}, {targetId:box.id}));assert.equal(objective.progress,Math.min(objective.goal,progress+3));assert.equal(w.s.bank.materials,bank.materials+3);assert.deepEqual(p.wallet,protectedWallet);w.assertInvariants();
});

test('all gear dismantling loops lose ingredients after cross-room import, preserve only loaded ammo, and reject retries',()=>{
 for(const module of CRAFTING_MODULES){
  const {w,p}=careerWorld();clear(w,p);const recipe=w.c.crafting.recipes.find(r=>r.definitionId===module.definitionId),spent=Object.fromEntries(CRAFTING_MATERIALS.map(id=>[id,0]));
  for(const row of [...recipe.ingredients,...module.ingredients]){w.addItems(w.bag(p),row.definitionId,row.quantity);spent[row.definitionId]+=row.quantity;}
  at(w,p,'craft');const crafted=accepted(send(w,p,'Craft',{recipeId:recipe.id,stationId:'craft'})),item=w.s.items[crafted.data.itemId];assert.equal(item.magazineAmmo,0);at(w,p,'upgrade');accepted(send(w,p,'ModGear',{itemId:item.id,moduleId:module.id,stationId:'upgrade'},{expectedRevision:item.revision}));
  // A finite pre-existing loaded magazine is part of the exported gear.
  const weapon=w.defs.weapons[item.definitionId];item.magazineAmmo=weapon?2:0;
  const next=careerWorld(1,{capsule:extractCareerCapsule(w.s,account),revision:4}),actor=next.p,game=next.w,gear=game.s.items[item.id];at(game,actor,'upgrade');
  const remove={requestId:actor.requestHighWater+1,command:'RemoveModule',payload:{itemId:gear.id,stationId:'upgrade'},expectedRevision:gear.revision};accepted(game.command(actor,remove));const first=materials(game,actor);accepted(game.command(actor,remove));assert.deepEqual(materials(game,actor),first);
  assert.equal(send(game,actor,'RemoveModule',{itemId:gear.id,stationId:'upgrade'},{expectedRevision:gear.revision}).ok,false);assert.deepEqual(materials(game,actor),first);
  assert.equal(send(game,actor,'ModGear',{itemId:gear.id,moduleId:module.id,stationId:'upgrade'},{expectedRevision:gear.revision}).code,'NO_MATERIALS');assert.deepEqual(materials(game,actor),first);
  at(game,actor,'recycle');accepted(send(game,actor,'DismantleGear',{itemId:gear.id,stationId:'recycle'},{expectedRevision:gear.revision}));assert.equal(game.s.items[gear.id],undefined);
  const refund=materials(game,actor);for(const id of CRAFTING_MATERIALS){const expected=w.c.crafting.nonRefundable.includes(id)?0:[recipe,module].reduce((n,def)=>n+Math.floor((def.ingredients.find(i=>i.definitionId===id)?.quantity??0)*.5),0);assert.equal(refund[id],expected,module.id+' '+id);assert.ok(refund[id]<=spent[id]/2);}
  if(weapon)assert.equal(game.count(actor,weapon.ammo),2);assert.equal(send(game,actor,'DismantleGear',{itemId:gear.id,stationId:'recycle'},{expectedRevision:gear.revision}).ok,false);assert.deepEqual(materials(game,actor),refund);game.assertInvariants();
 }
});

test('120-second nights cap entities and resolve a held base once even when peak-day queues cannot fully spawn',t=>{
 const results=[];
 for(const count of [1,2,4,8])for(const day of [1,50]){
  const {w}=careerWorld(count);w.s.statistics.daysSurvived=day-1;w.s.threatStage=day===1?1:4;w.startNight();const night=w.s.night,queued=night.pending.length,aliveCap=night.aliveCap,duration=w.phaseDuration(),initial=w.s.time,ledger=w.s.resultLedger.length;
  assert.equal(duration,120);
  // Saturation test: without kills the finite cap prevents any further spawn.
  for(let second=0;second<120;second+=.5){w.s.time=initial+second;w.s.phaseElapsed=second;w.updateNightQueue();assert.ok(Object.values(w.s.enemies).filter(e=>e.night).length<=aliveCap);}
  assert.ok(w.s.enemies[night.bossId]);assert.equal(night.rewardClaimed,false);const remaining=night.pending.length;
  w.s.phaseElapsed=duration;w.resolveNight();assert.equal(w.s.phase,'PREP');assert.equal(w.s.statistics.daysSurvived,day);assert.equal(w.s.resultLedger.length,ledger+1);assert.equal(night.completedEarly,false);assert.equal(night.rewardClaimed,false);assert.ok(!Object.values(w.s.enemies).some(e=>e.night));w.resolveNight();assert.equal(w.s.resultLedger.length,ledger+1);
  results.push({players:count,pressureDay:day,queued,remainingAtTimeout:remaining,aliveCap});
 }
 t.diagnostic(JSON.stringify(results));
});
