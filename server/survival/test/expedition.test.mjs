import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../config.mjs';
import {SurvivalWorld} from '../world.mjs';
import {stripCareerPlayer} from '../career-state.mjs';
import {ZONE_RISKS,dayEncounterBudget,nightEncounterBudget,nodeMaterialLoot,expeditionContract} from '../expedition-config.mjs';

// Isolated, deterministic rule scenarios. Work completion and kills use the
// real world methods; combat aim, rendering and full survival are separate QA.
const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
const clone=value=>structuredClone(value);
function fixture(n=1){const w=new SurvivalWorld(clone(config),null,{onlineRoster:true}),ps=Array.from({length:n},(_,i)=>w.allocate('外勤测试','account:expedition-fixture-'+i));w.beginDayBarrier();w.finishDayBarrier();w.s.director.objective=null;w.s.director.optionalObjective=null;return {w,ps,p:ps[0]};}
function at(w,p,target,offset=0){Object.assign(p,{x:target.x+offset,z:target.z,y:w.ground(target.x+offset,target.z),swimming:false,damageAt:-100,connected:true});}
const command=(w,p,name,payload={},targetId)=>w.command(p,{requestId:p.requestHighWater+1,command:name,payload,targetId});
const accepted=result=>assert.equal(result.ok,true,result.message??result.code);
function search(w,p,node){at(w,p,node,1);accepted(command(w,p,'Search',{},node.id));p.input.interact=true;w.updateWork(p,p.work.duration+.1);assert.equal(node.state,'depleted');}
function nodes(w,zone){return Object.values(w.s.nodes).filter(n=>n.zoneId===zone);}
function ready(w,p,zone){const def=expeditionContract(zone,w.s.dayIndex);for(let i=0;i<def.searchGoal;i++)w.expedition.record('search',{id:'fixture-'+zone+'-'+p.id+'-'+i,zoneId:zone,actorId:p.id});for(let i=0;i<def.killGoal;i++)w.expedition.record('kill',{id:'fixture-kill-'+zone+'-'+p.id+'-'+i,zoneId:zone,source:'wild',actorId:p.id});}
function locker(w,p){const t=w.staticWorld().terminals.find(t=>t.id==='storage');at(w,p,t);return {stationId:t.id};}
function clearBag(w,p){for(const id of [...w.bag(p).itemIds])w.removeItem(w.s.items[id]);}
const contract=(w,p,zone)=>w.expedition.contracts(p).find(c=>c.zoneId===zone);

test('1/2/4/8 players share the longer day and phase lengths never jump on late join',()=>{
 for(const n of [1,2,4,8]){const {w}=fixture(n);assert.equal(w.phaseDuration('DAY'),420);const locked=clone(w.s.phasePlan);if(n<8)w.allocate('晚到队员','late-fixture');assert.deepEqual(w.s.phasePlan,locked);w.s.phaseElapsed=115;const r=new SurvivalWorld(clone(config),w.serialize(),{onlineRoster:true});assert.equal(r.phaseDuration('DAY'),420);assert.equal(r.s.phaseElapsed,115);w.setPhase('RETURN');assert.equal(w.phaseDuration(),75);w.startNight();assert.equal(w.phaseDuration(),120);}
});

test('multiplayer stock grows in bounded tiers with no exponential per-player payout',()=>{
 assert.deepEqual([1,2,4,8].map(n=>dayEncounterBudget(n).guards),[6,10,16,24]);assert.deepEqual([1,2,4,8].map(n=>dayEncounterBudget(n).nodes),[10,18,32,56]);
 assert.deepEqual([1,2,4,8].map(n=>nightEncounterBudget(n).aliveCap),[5,8,12,18]);assert.deepEqual([1,2,4,8].map(n=>nightEncounterBudget(n).bossFactor),[1,1.65,2.9,5.2]);
 for(const n of [1,2,4,8]){const {w}=fixture(n),budget=dayEncounterBudget(n);assert.equal(Object.values(w.s.enemies).filter(e=>e.source==='wild').length,budget.guards);assert.equal(Object.keys(w.s.nodes).length,budget.nodes);assert.equal(w.difficultyFor(n).aliveCap,nightEncounterBudget(n).aliveCap);assert.ok(w.difficultyFor(n).bossHp<=Math.ceil(w.c.encounters.nightly_boss.base_hp*n));
  for(const risk of ZONE_RISKS){assert.ok(nodes(w,risk.id).length>=expeditionContract(risk.id,w.s.dayIndex).searchGoal*n);for(const enemy of Object.values(w.s.enemies).filter(e=>e.zoneId===risk.id)){assert.equal(enemy.riskTier,risk.risk);assert.ok(risk.roles.includes(enemy.definitionId));}}
 }
});

test('every material has low and higher risk sources and resource value rises by risk tier',()=>{
 const value=loot=>loot.reduce((n,[id,count])=>n+({scrap:1,spring_parts:3,sealed_cell:8,treasure:12}[id]??0)*count,0);
 for(const kind of ['scrap','treasure']){const values=ZONE_RISKS.map(z=>value(nodeMaterialLoot(z.id,kind)));assert.ok(values[0]<values[1]&&values[1]<values[2]);}
 for(const id of ['scrap','spring_parts','sealed_cell'])for(const z of ZONE_RISKS)assert.ok(['scrap','treasure'].some(kind=>nodeMaterialLoot(z.id,kind).some(([item])=>item===id)));
 const {w,p}=fixture();w.s.enemies={};w.s.destructibles={};
 for(const zone of ZONE_RISKS)for(const kind of ['scrap','treasure']){clearBag(w,p);const center=w.dangerZones().find(z=>z.id===zone.id),node={id:w.id('node'),...center,y:w.ground(center.x,center.z),zoneId:zone.id,kind,state:'available',revision:1};w.s.nodes[node.id]=node;search(w,p,node);for(const [id,quantity]of nodeMaterialLoot(zone.id,kind))assert.equal(w.count(p,id),quantity);}
});

test('real search completes personal progress and safe warehouse return pays the backpack once',()=>{
 const {w,p}=fixture();w.s.enemies={};for(const node of nodes(w,'salvage').slice(0,2))search(w,p,node);assert.equal(contract(w,p,'salvage').ready,true);
 const payload=locker(w,p),before={scrap:w.count(p,'scrap'),spring:w.count(p,'spring_parts')},message={requestId:p.requestHighWater+1,command:'ReturnExpedition',payload:{...payload,zoneId:'salvage'}};
 accepted(w.command(p,message));accepted(w.command(p,message));assert.equal(w.count(p,'scrap'),before.scrap+4);assert.equal(w.count(p,'spring_parts'),before.spring+1);assert.equal(contract(w,p,'salvage').claimed,true);assert.equal(command(w,p,'ReturnExpedition',payload).ok,false);w.assertInvariants();
});

test('return enforces alive, daytime, combat quiet, warehouse and empty hands',()=>{
 const {w,p}=fixture();ready(w,p,'salvage');at(w,p,w.location('salvage'));assert.equal(command(w,p,'ReturnExpedition',{stationId:'storage'}).code,'OUT_OF_RANGE');const payload=locker(w,p);
 for(const [key,value]of [['work',{}],['carryingId','fixture-carry'],['damageAt',w.s.time],['lifeState','DOWNED']]){const before=p[key];p[key]=value;assert.equal(command(w,p,'ReturnExpedition',payload).ok,false);p[key]=before;assert.equal(contract(w,p,'salvage').claimed,false);}
 w.setPhase('NIGHT');assert.equal(command(w,p,'ReturnExpedition',payload).ok,false);assert.equal(contract(w,p,'salvage').claimed,false);
});

test('combined reward capacity is checked before adding any materials or claims',()=>{
 const {w,p}=fixture();for(const z of ZONE_RISKS)ready(w,p,z.id);clearBag(w,p);while(w.bag(p).itemIds.length<w.bag(p).slotLimit-1)w.createItem('knife',1,w.bag(p));const payload=locker(w,p),before=clone({items:w.s.items,containers:w.s.containers,expedition:w.s.expedition});
 assert.equal(command(w,p,'ReturnExpedition',payload).code,'NO_CAPACITY');assert.deepEqual({items:w.s.items,containers:w.s.containers,expedition:w.s.expedition},before);
 clearBag(w,p);accepted(command(w,p,'ReturnExpedition',payload));assert.equal(w.count(p,'scrap'),7);assert.equal(w.count(p,'spring_parts'),8);assert.equal(w.count(p,'sealed_cell'),3);assert.ok(w.expedition.contracts(p).every(c=>c.claimed));w.assertInvariants();
});

test('death loses unreturned progress while paid contracts stay consumed for that day',()=>{
 const {w,p}=fixture();ready(w,p,'salvage');ready(w,p,'hunt');accepted(command(w,p,'ReturnExpedition',{...locker(w,p),zoneId:'salvage'}));w.die(p);assert.equal(contract(w,p,'salvage').claimed,true);assert.equal(contract(w,p,'hunt').search,0);assert.equal(contract(w,p,'hunt').kills,0);assert.equal(contract(w,p,'hunt').ready,false);w.respawn(p);assert.equal(command(w,p,'ReturnExpedition',locker(w,p)).ok,false);
});

test('slot changes, reconnect and reload cannot repeat an account daily reward',()=>{
 const {w,p}=fixture();ready(w,p,'salvage');accepted(command(w,p,'ReturnExpedition',locker(w,p)));const token=p.tokenHash;stripCareerPlayer(w.s,token.slice(8));const newcomer=w.allocate('重入队员',token);assert.notEqual(newcomer.id,p.id);assert.equal(contract(w,newcomer,'salvage').claimed,true);assert.equal(command(w,newcomer,'ReturnExpedition',locker(w,newcomer)).ok,false);
 const restored=new SurvivalWorld(clone(config),w.serialize(),{onlineRoster:true}),same=restored.s.players[newcomer.id];restored.connect(same,same.name);assert.equal(contract(restored,same,'salvage').claimed,true);assert.equal(command(restored,same,'ReturnExpedition',locker(restored,same)).ok,false);
 const publicText=JSON.stringify(restored.publicState().expedition);assert.ok(!publicText.includes('account:'));assert.ok(!publicText.includes('accountKey'));assert.ok(publicText.includes(same.id));
});

test('same-day regeneration and late join do not reset claims; a new day starts fresh rotating goals',()=>{
 const {w,p}=fixture();ready(w,p,'hunt');accepted(command(w,p,'ReturnExpedition',locker(w,p)));const old=contract(w,p,'hunt');w.generateDay();assert.equal(contract(w,p,'hunt').claimed,true);const late=w.allocate('后来队员','account:late-expedition');assert.equal(contract(w,late,'hunt').claimed,false);assert.equal(contract(w,late,'hunt').search,0);
 w.s.dayIndex++;w.generateDay();const next=contract(w,p,'hunt');assert.equal(next.claimed,false);assert.notEqual(next.searchGoal,old.searchGoal);assert.equal(next.search,0);
});

test('nearby living collaborators share regional kill progress but remote and downed players do not',()=>{
 const {w,ps}=fixture(4),zone=w.dangerZones().find(z=>z.id==='supply'),enemy=Object.values(w.s.enemies).find(e=>e.zoneId==='supply');
 Object.assign(enemy,{x:zone.x,z:zone.z});at(w,ps[0],enemy,1);at(w,ps[1],enemy,8);at(w,ps[2],w.s.buildings.core);at(w,ps[3],enemy,3);ps[3].lifeState='DOWNED';w.killEnemy(enemy,ps[0].id);w.killEnemy(enemy,ps[0].id);
 assert.deepEqual(ps.map(p=>contract(w,p,'supply').kills),[1,1,0,0]);
 const fish=w.spawnEnemy('crab',zone.x,zone.z);fish.source='fishing';fish.zoneId='supply';w.killEnemy(fish,ps[0].id);assert.equal(contract(w,ps[0],'supply').kills,1);
});

test('eight players can finish all three personal tiers with the actual finite stock',()=>{
 const {w,ps}=fixture(8);w.s.destructibles={};
 for(const zone of ZONE_RISKS){const goal=expeditionContract(zone.id,w.s.dayIndex),stock=nodes(w,zone.id);for(const p of ps)for(let i=0;i<goal.searchGoal;i++)search(w,p,stock.shift());
  const guards=Object.values(w.s.enemies).filter(e=>e.zoneId===zone.id);assert.ok(guards.length>=goal.killGoal);for(const enemy of guards.slice(0,goal.killGoal)){const center=w.dangerZones().find(z=>z.id===zone.id);Object.assign(enemy,{x:center.x,z:center.z});for(const p of ps)at(w,p,enemy,1+(p.slotId%4));w.killEnemy(enemy,ps[0].id);}
  assert.ok(ps.every(p=>contract(w,p,zone.id).ready),zone.id);
 }
 for(const p of ps){clearBag(w,p);accepted(command(w,p,'ReturnExpedition',locker(w,p)));assert.equal(w.count(p,'sealed_cell'),3);assert.ok(w.expedition.contracts(p).every(c=>c.claimed));}
 assert.equal(Object.keys(w.s.nodes).length,56);w.assertInvariants();
});

test('exploration completion contributes once and free practice never creates daily asset rewards',()=>{
 const {w,p}=fixture(),e=w.s.exploration.events.find(e=>e.zoneId==='salvage');w.exploration.reward(e,[['scrap',1]],e.parts[0],p.id);w.exploration.reward(e,[['scrap',9]],e.parts[0],p.id);assert.equal(contract(w,p,'salvage').search,1);
 const practice=new SurvivalWorld(clone(config),null,{mode:'mission',missionStart:'free',onlineRoster:true});assert.equal(practice.expedition,undefined);assert.equal(practice.s.expedition,undefined);
});

test('public risk panels expose goals, material expectations and ready/claimed states without account identity',()=>{
 const {w,p}=fixture();ready(w,p,'hunt');const state=w.publicState().expedition;assert.equal(state.zones.length,3);assert.ok(state.zones.every(z=>z.advice&&z.riskName&&z.loot.search.length&&z.loot.cache.length));const visible=state.players.find(x=>x.playerId===p.id).contracts.find(c=>c.zoneId==='hunt');assert.equal(visible.ready,true);assert.equal(visible.claimed,false);assert.ok(visible.reward.some(i=>i.definitionId==='sealed_cell'));assert.equal(w.catalog().expedition.returnCommand,'ReturnExpedition');
});
