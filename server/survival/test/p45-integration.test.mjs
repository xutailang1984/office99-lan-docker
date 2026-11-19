// Synthetic worlds only. The integration tests exercise shared weapon and wire
// boundaries, not the independent content modules' own state machines.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,put} from './director-helpers.mjs';
import {moduleHit} from '../crafting.mjs';
import {gearAfterHit,gearPiercingHit} from '../gear-growth.mjs';
import {compileState,diffState} from '../state-wire.mjs';
import {SurvivalWorld} from '../world.mjs';
for(const id of ['boss_shredder','boss_printer'])test(id+' preserves committed warnings against all shared control modules',()=>{
 const {w,p}=fixture(),e=w.spawnEnemy(id,40,40,true);e.state='WINDUP';e.attackZone={shape:'line',x:40,z:40,length:6,width:2};const before=structuredClone(e.attackZone);
 moduleHit(w,e,{weaponId:'shotgun',moduleId:'shotgun_stop',closePelletHits:6});assert.equal(e.state,'WINDUP');assert.deepEqual(e.attackZone,before);
 const slot=w.s.containers[p.equipment.weapon];for(const itemId of [...slot.itemIds])w.removeItem(w.s.items[itemId]);
 const item=w.createItem('lmg',1,slot,{moduleId:'lmg_suppress',moduleEnabled:true});
 gearAfterHit(w,e,{actorId:p.id,itemId:item.id,weaponId:'lmg',moduleId:'lmg_suppress',actualDamage:20});assert(!e.gearSlowUntil);assert.equal(e.state,'WINDUP');
 const focus={...item,definitionId:'rifle',moduleId:'rifle_focus',moduleEnabled:true};p.gearFocusSeconds=2;
 assert.equal(gearPiercingHit(w,p,focus,{target:e,from:{x:40,y:e.y+1,z:45},direction:{x:0,y:0,z:-1},distance:5,maximum:100,shotId:'synthetic',damage:100}),null);
});
test('social preferences and cosmetics traverse full/delta wire and restore without transient duplication',()=>{
 const {w,p}=fixture();put(p,w,1,1);const first=compileState(w.publicState());
 assert(w.command(p,{requestId:p.requestHighWater+1,command:'SocialSettings',payload:{participating:true}}).ok);
 const current=compileState(w.publicState()),delta=diffState(first,current).delta;
 assert.equal(delta.changes.social.playerStates.find(s=>s.playerId===p.id).participating,true);
 const restored=new SurvivalWorld(w.c,structuredClone(w.s)),q=restored.s.players[p.id];
 restored.connect(q);assert.equal(restored.publicState().social.playerStates.find(s=>s.playerId===p.id).participating,true);
 assert.equal(restored.publicState().social.offers.length,0);assert.equal(restored.publicState().social.planes.length,0);
});
test('the practice arena rotates all seven complete boss forms while protecting the base',()=>{
 const {w:base}=fixture(),w=new SurvivalWorld(base.c,null,{onlineRoster:true,mode:'mission',missionStart:'free'}),p=w.allocate('合成实习生','account:synthetic');
 assert(w.command(p,{requestId:1,command:'MissionControl',payload:{action:'combat'}}).ok);
 put(p,w,-22,-35);const seen=new Set(),core=w.s.buildings.core,hp=core.hp;
 for(let index=0;index<7;index++){
  w.s.mission.park.nextBossAt=w.s.time;w.step(1/30);
  const boss=w.s.enemies[w.s.mission.park.bossId];assert(boss);assert.equal(boss.source,'practice');assert.equal(boss.practiceZone,'boss');assert.equal(boss.combatPreset,'complete');seen.add(boss.definitionId+'/'+boss.variantId);
  w.killEnemy(boss,p.id);w.step(1/30);
 }
 assert.deepEqual([...seen].sort(),['boss_coffee_boiler/base','boss_crab/auditor','boss_crab/base','boss_crab/overload','boss_printer/base','boss_shredder/base','boss_stamp_press/base']);assert.equal(core.hp,hp);
});
