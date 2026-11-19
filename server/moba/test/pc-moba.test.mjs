import test from 'node:test';import assert from 'node:assert/strict';
import {MobaWorld} from '../world.mjs';import {HERO_IDS,HEROES,RULES,canLearn,skillPoints} from '../catalog.mjs';import {MAP,distance} from '../map.mjs';
const make=()=>new MobaWorld({roster:HERO_IDS.map((heroId,i)=>({id:'pc-'+i,heroId,team:i<5?0:1,connected:true}))});
const command=(w,h,m)=>w.command(h.id,{seq:h.lastSeq+1,...m});
const advance=(w,s)=>{for(let i=0;i<Math.ceil(s*30);i++)w.step();};

test('host checkpoints require every permanent objective and building even after destruction',()=>{
 const w=make(),state=w.serialize();
 for(const id of ['crab','epic-archive','tower-1-1-0','inhibitor-0-0','core-0']){const s=structuredClone(state);assert(s.units.some(e=>e.id===id));s.units=s.units.filter(e=>e.id!==id);assert.throws(()=>MobaWorld.validate(s),/永久实体/);}
 for(const [id,key,value] of [['crab','species','paper'],['tower-1-1-0','tier',2],['core-0','team',1]]){const s=structuredClone(state);s.units.find(e=>e.id===id)[key]=value;assert.throws(()=>MobaWorld.validate(s),/永久实体/);}
 const damaged=structuredClone(state);damaged.units.find(e=>e.id==='crab').hp=0;damaged.units.find(e=>e.id==='tower-1-1-0').hp=0;assert(MobaWorld.validate(damaged));assert(new MobaWorld({state:damaged}).snapshot('pc-0'));
});
test('new match offers one skill point, all four keys require learning, and R unlocks at 6/11/16',()=>{
 const w=make(),h=w.heroes[0];assert.equal(skillPoints(h),1);for(const k of ['q','w','e','r'])assert.equal(command(w,h,{type:'cast',skill:k,x:h.x,z:h.z}).code,'LEVEL_REQUIRED');
 assert(!canLearn(h,'r'));assert(command(w,h,{type:'learn',skill:'q'}).ok);assert.equal(skillPoints(h),0);assert.equal(command(w,h,{type:'learn',skill:'e'}).code,'NO_SKILL_POINT');
 h.level=6;assert(command(w,h,{type:'learn',skill:'r'}).ok);assert(!canLearn(h,'r'));h.level=11;assert(command(w,h,{type:'learn',skill:'r'}).ok);h.level=16;assert(command(w,h,{type:'learn',skill:'r'}).ok);assert(!canLearn(h,'r'));assert(MobaWorld.validate(w.serialize()));
});
for(const id of HERO_IDS)test(id+' W resolves its described effect and remains within legal checkpoint ranks',()=>{
 const w=make(),h=w.heroes.find(h=>h.heroId===id),enemy=w.heroes.find(a=>a.team!==h.team);Object.assign(h,{x:0,z:0,level:6,skillRanks:{q:1,w:1,e:1,r:1}});Object.assign(enemy,{x:2,z:0});
 const def=HEROES[id].skills.w,target=def.target==='ally'?h:enemy;h.hp-=200;
 assert(command(w,h,{type:'cast',skill:'w',x:2,z:0,target:target.id}).ok);const mana=h.mana;advance(w,.45);assert(h.cooldowns.w>w.time);assert(h.mana>=mana);assert(w.events.some(e=>e.source===h.id&&e.kind!=='cast'));assert(MobaWorld.validate(w.serialize()));
});
test('six unique equipment slots, resale and seventh item rejection',()=>{const w=make(),h=w.heroes[0];h.gold=10000;for(const item of ['boots','stapler','battery','vest','flask','timer'])assert(command(w,h,{type:'buy',item}).ok);assert.equal(command(w,h,{type:'buy',item:'belt'}).code,'SLOTS_FULL');assert(command(w,h,{type:'sell',item:'battery'}).ok);assert(command(w,h,{type:'buy',item:'belt'}).ok);assert(MobaWorld.validate(w.serialize()));});
test('all three lane towers, inhibitor and both nexus towers gate the core',()=>{
 const w=make(),h=w.heroes[0],core=w.entity('core-1'),damage=e=>w.damage(h,e,1e7);assert.equal(damage(core),0);
 for(let tier=0;tier<3;tier++){const tower=w.entity('tower-1-1-'+tier);assert(w.attackableStructure(tower));if(tier<2)assert(!w.attackableStructure(w.entity('tower-1-1-'+(tier+1))));damage(tower);assert.equal(tower.hp,0);assert.equal(damage(core),0);}
 const inhib=w.entity('inhibitor-1-1');damage(inhib);assert.equal(inhib.hp,0);for(let i=0;i<2;i++){assert.equal(damage(core),0);damage(w.entity('nexus-tower-1-'+i));}assert(w.attackableStructure(core));damage(core);assert.equal(w.winner,0);assert.equal(w.phase,'finished');assert(MobaWorld.validate(w.serialize()));
});
test('destroyed inhibitor sends super minions only down that lane and later returns',()=>{const w=make(),u=w.entity('inhibitor-1-2');u.hp=0;u.respawnAt=300;w.spawnWave();const supers=w.units.filter(u=>u.super);assert.equal(supers.length,1);assert.equal(supers[0].team,0);assert.equal(supers[0].lane,2);w.time=300;w.step();assert.equal(u.hp,u.maxHp);w.spawnWave();assert.equal(w.units.filter(u=>u.super).length,1);});
test('flash respects cooldown and control; ward gives team sight and expires',()=>{
 const w=make(),h=w.heroes[0];Object.assign(h,{x:0,z:0});h.rootUntil=1;assert.equal(command(w,h,{type:'summoner',skill:'d',x:8,z:0}).code,'ROOTED');h.rootUntil=0;assert(command(w,h,{type:'summoner',skill:'d',x:8,z:0}).ok);assert.equal(h.x,8);assert.equal(command(w,h,{type:'summoner',skill:'d',x:12,z:0}).code,'COOLDOWN');
 assert(command(w,h,{type:'ward',x:17,z:0}).ok);const ward=w.units.find(u=>u.kind==='ward');assert(ward);assert.equal(command(w,h,{type:'ward',x:18,z:0}).code,'WARD_COOLDOWN');w.time=91;w.step();assert(!w.units.some(u=>u.id===ward.id));
});
test('jungler F strikes only a nearby visible live monster; healing F does not become smite',()=>{
 const w=make(),j=w.heroes[1],c=w.entity('camp-0-a');w.time=60;Object.assign(j,{x:c.x,z:c.z+3});const hp=c.hp;assert(command(w,j,{type:'summoner',skill:'f',target:c.id}).ok);assert(c.hp<hp);const h=w.heroes[0];h.hp-=300;const before=h.hp;assert(command(w,h,{type:'summoner',skill:'f'}).ok);assert(h.hp>before);assert(MobaWorld.validate(w.serialize()));
});
test('H holds position while attacking in range and S clears that order',()=>{const w=make(),h=w.heroes[0],e=w.heroes[5];Object.assign(h,{x:0,z:0});Object.assign(e,{x:7,z:0});assert(command(w,h,{type:'hold'}).ok);advance(w,1);assert(e.hp<e.maxHp);assert.equal(h.x,0);command(w,h,{type:'stop'});assert.equal(h.order,null);});
test('eight second recall completes only without further movement or damage',()=>{const w=make(),h=w.heroes[0];Object.assign(h,{x:0,z:0});command(w,h,{type:'recall'});advance(w,7.9);assert.equal(h.x,0);advance(w,.2);assert(distance(h,MAP.spawn[0])<.01);});
test('large map wave contains three melee and three ranged units per side per lane',()=>{const w=make();w.time=RULES.firstWave;w.step();for(let team=0;team<2;team++)for(let lane=0;lane<3;lane++){const row=w.units.filter(u=>u.kind==='minion'&&u.team===team&&u.lane===lane);assert.equal(row.length,6);assert.equal(row.filter(u=>u.ranged).length,3);}assert(MobaWorld.validate(w.serialize()));});
test('crab and archive produce different team rewards',()=>{const w=make(),h=w.heroes[0];w.time=500;const crab=w.entity('crab'),archive=w.entity('epic-archive');w.damage(h,crab,1e7);assert(h.buffUntil>w.time);assert(!h.siegeUntil);w.damage(h,archive,1e7);assert(h.siegeUntil>w.time);assert.equal(archive.respawnAt,800);});
