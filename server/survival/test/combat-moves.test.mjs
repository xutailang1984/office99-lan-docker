import test from 'node:test';
import assert from 'node:assert/strict';
import {SurvivalWorld} from '../world.mjs';
import {stripCareerPlayer} from '../career-state.mjs';
import {BOSS_MOVES,combatPreset,combatRoleDefinition,bossChains} from '../combat-moves.mjs';
import {base,fixture,enemy,put,command,advance} from './director-helpers.mjs';
function tick(w,e,seconds,trace=[]){for(let t=0;t<seconds-1e-8;t+=1/30){w.s.tick++;w.s.time+=1/30;w.updateEnemy(e,1/30);w.resolveDamage();trace.push(...w.drainEvents());}return trace;}
function setup(id='boss_crab',variant='base'){const {w,p}=fixture();w.s.enemies={};const e=enemy(w,p,id,{x:0,z:-3});e.variantId=variant;e.combatPreset='complete';return {w,p,e};}

test('role tempo changes exclude fishing and rare catches; presets separate mechanics from stats',()=>{
 const {w,p}=fixture();const e=enemy(w,p,'courier'),def=w.defs.creatures.courier;
 assert(combatRoleDefinition(e,def).attack_windup<def.attack_windup);e.source='fishing';assert.equal(combatRoleDefinition(e,def),def);
 e.source='rare_catch';assert.equal(combatRoleDefinition(e,def),def);
 const b=enemy(w,p,'boss_crab');b.source='practice';assert.equal(combatPreset(w,b).id,'complete');
 b.source='wild';b.night=true;w.s.dayIndex=1;assert.equal(combatPreset(w,b).comboLimit,1);w.s.dayIndex=8;assert.equal(combatPreset(w,b).comboLimit,3);
 assert.equal(combatRoleDefinition(b,w.defs.creatures.boss_crab).hp,w.defs.creatures.boss_crab.hp);
});

for(const [id,variant] of [['boss_crab','base'],['boss_crab','auditor'],['boss_crab','overload'],['boss_shredder','base'],['boss_printer','base'],['boss_stamp_press','base'],['boss_coffee_boiler','base']])test(`${id}/${variant}: complete attacks progress, hit, recover and persist bounded sequences`,()=>{
 const {w,p,e}=setup(id,variant);p.hp=1000;const events=tick(w,e,12);
 const strikes=events.filter(x=>x.eventType==='EnemyAttackResolved');assert(strikes.length>=2);assert(strikes.length<22);
 assert.equal(new Set(strikes.map(x=>x.payload.attackActionSeq)).size,strikes.length);
 assert(strikes.every(x=>BOSS_MOVES[x.payload.attackKind]));
 assert(events.some(x=>x.eventType==='EnemyAttackWarning'&&x.payload.timeline));
 assert(events.some(x=>x.eventType==='EnemyWeakPoint'));
 assert(p.hp<1000||variant==='overload','standing in a path must be dangerous');
 assert((e.comboQueue?.length??0)<=3);assert((e.moveHits?.length??0)<=10);
});

test('paper wave damages along a moving front, once per target',()=>{
 const {w,p,e}=setup('boss_printer');e.lastChain='printer_shift/printer_wave';put(p,w,e.x,e.z+7);e.yaw=Math.PI;
 for(let i=0;i<100&&e.state!=='ATTACK';i++)tick(w,e,1/30);
 assert.equal(e.attackKind,'printer_wave');const hp=p.hp;
 tick(w,e,.2);assert.equal(p.hp,hp,'far target is not hit at muzzle time');
 tick(w,e,.6);assert(p.hp<hp);const after=p.hp;tick(w,e,.1);assert.equal(p.hp,after,'same wave hits once');
});

test('walking sideways after paper launch evades its committed moving front',()=>{
 const {w,p,e}=setup('boss_printer');e.lastChain='printer_shift/printer_wave';put(p,w,e.x,e.z+7);e.yaw=Math.PI;
 for(let i=0;i<100&&e.state!=='ATTACK';i++)tick(w,e,1/30);
 const origin={x:e.x,z:e.z},hp=p.hp;
 for(let i=0;i<25;i++){w.move(p,5,0,1/30,w.c.player.capsule_radius);tick(w,e,1/30);}
 assert(p.x-origin.x>3);assert.equal(p.hp,hp);assert.equal(e.attackActionSeq,1);
});

test('practice charge cannot enqueue structure damage even when its caster dies in the same tick',()=>{
 for(const killFirst of [false,true]){
  const {w,p,e}=setup();put(p,w,-22,-32);Object.assign(e,{x:-22,z:-38,y:w.ground(-22,-38),homeX:-22,homeZ:-38,source:'practice',practiceZone:'boss'});
  for(let i=0;i<100&&e.state!=='CHARGE';i++)tick(w,e,1/30);
  assert.equal(e.state,'CHARGE');
  const wall={id:'synthetic-practice-wall',definitionId:'wall',x:e.x,y:e.y,z:e.z+1.2,yaw:0,hp:400,maxHp:400,level:1,revision:1};w.s.buildings[wall.id]=wall;w.navGeometry=null;
  const death={target:e.id,actorId:p.id,damage:99999};if(killFirst)w.damageQueue.push(death);
  w.s.tick++;w.s.time+=.1;w.updateEnemy(e,.1);assert(!w.damageQueue.some(q=>q.target===wall.id));
  if(!killFirst)w.damageQueue.push(death);w.resolveDamage();assert.equal(wall.hp,400);assert(!w.s.enemies[e.id]);
 }
});

test('committed aim stops tracking and every ordinary windup uses body cues',()=>{
 const {w,p,e}=setup();e.lastChain='charge/claw_right';
 for(let i=0;i<100&&e.state!=='WINDUP';i++)tick(w,e,1/30);
 assert.equal(e.attackZone.presentation,'body');
 tick(w,e,Math.max(0,e.attackTimeline.trackUntil-w.s.time+.01));const yaw=e.yaw;
 put(p,w,e.x+5,e.z);tick(w,e,.08);assert.equal(e.yaw,yaw);
});

for(const targetState of ['WINDUP','ATTACK','FOLLOW_THROUGH','WEAK'])test(`save/restore during ${targetState} preserves attack progress and hit deduplication`,()=>{
 const {w,p,e}=setup('boss_printer');e.lastChain='printer_shift/printer_wave';p.hp=1000;
 for(let i=0;i<700&&e.state!==targetState;i++)tick(w,e,1/30);
 assert.equal(e.state,targetState);
 const saved=new SurvivalWorld(w.c,w.serialize(),{onlineRoster:true});const restored=saved.s.enemies[e.id];
 for(const q of Object.values(saved.s.players))saved.connect(q,q.name);
 w.drainEvents();saved.drainEvents();
 const a=tick(w,e,.4),b=tick(saved,restored,.4);
 assert.equal(restored.state,e.state);assert.equal(restored.attackActionSeq,e.attackActionSeq);
 assert.deepEqual(restored.moveHits,e.moveHits);assert.equal(saved.s.players[p.id].hp,p.hp);
 assert.deepEqual(b.filter(x=>x.eventType==='EnemyAttackResolved').map(x=>x.payload.attackKind),a.filter(x=>x.eventType==='EnemyAttackResolved').map(x=>x.payload.attackKind));
});

test('stamp full sequence uses physical projections and revisits a previous location',()=>{
 const {w,p,e}=setup('boss_stamp_press');let events=[];
 for(let i=0;i<150;i++){if(e.comboCursor===1)put(p,w,e.x+3,e.z+3);if(e.comboCursor===2)put(p,w,e.x-3,e.z+3);events.push(...tick(w,e,1/30));}
 const warnings=events.filter(x=>x.eventType==='EnemyAttackWarning');
 assert(warnings.length>=3);assert(warnings.every(x=>x.payload.zone.presentation==='projection'));
 assert(warnings.some(x=>x.payload.zone.points.length===2));
});

test('settling a departing player during windup cancels safely, including after save',()=>{
 const {w,p,e}=setup('boss_printer');p.tokenHash='account:synthetic-departing';
 tick(w,e,.1);assert.equal(e.state,'WINDUP');const seq=e.attackActionSeq??0;
 assert(stripCareerPlayer(w.s,'synthetic-departing'));tick(w,e,.3);
 assert.equal(e.attackActionSeq??0,seq);assert.equal(e.activeAttack,null);assert.equal(e.attackTimeline,null);
 const saved=new SurvivalWorld(w.c,w.serialize(),{onlineRoster:true});tick(saved,saved.s.enemies[e.id],.3);
 assert.equal(saved.s.enemies[e.id].attackActionSeq??0,seq);
});

test('shredder approaches a real fortress instead of stopping outside runtime reach',()=>{
 const {w,p}=fixture();w.s.enemies={};put(p,w,50,50);const core=w.s.buildings.core;
 for(const b of Object.values(w.s.buildings))if(b.id!==core.id)b.hp=0;
 const e=w.spawnEnemy('boss_shredder',core.x,core.z+12,true);e.source='night';e.combatPreset='complete';
 const hp=core.hp;tick(w,e,10);assert((e.attackActionSeq??0)>0);assert(core.hp<hp);
});

test('coffee pursues a target at 9.9 metres into actual firing range',()=>{
 const {w,p,e}=setup('boss_coffee_boiler');put(p,w,e.x,e.z+9.9);e.homeX=e.x;e.homeZ=e.z;
 w.aggro.damage(e,p,20);const hp=p.hp;tick(w,e,8);assert(p.hp<hp);assert(e.z>21,'must move instead of firing out of range');
});

test('practice begins with complete coffee boss and cycles crab variants without new population slots',()=>{
 const w=new SurvivalWorld(structuredClone(base),null,{onlineRoster:true,mode:'mission',missionStart:'free'}),p=w.allocate('Synthetic practice visitor','test-combat-moves');
 assert(command(w,p,'MissionControl',{action:'boss'}).ok);advance(w,.2);
 const boss=w.s.enemies[w.s.mission.park.bossId];assert.equal(boss.definitionId,'boss_coffee_boiler');assert.equal(boss.combatPreset,'complete');
 const core=w.s.buildings.core.hp;put(p,w,0,20);advance(w,3);assert.equal(w.s.buildings.core.hp,core);
 const ids=['boss_crab','boss_shredder','boss_printer','boss_stamp_press','boss_coffee_boiler'];
 for(const id of ids){const chains=bossChains({definitionId:id},3,{comboLimit:3});assert(chains.length);assert(chains.every(c=>c.length<=3&&c.every(k=>BOSS_MOVES[k])));}
});
