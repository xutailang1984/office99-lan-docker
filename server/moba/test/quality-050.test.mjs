import test from 'node:test';
import assert from 'node:assert/strict';
import {MobaWorld} from '../world.mjs';
import {HERO_IDS,MINION_REWARDS,SUPPORT_INCOME,stats,ITEMS} from '../catalog.mjs';
import {MAP,blocked,distance} from '../map.mjs';

const make=()=>{
 const roster=Array.from({length:10},(_,i)=>({id:'quality-'+i,heroId:HERO_IDS[i%5],team:Math.floor(i/5),connected:true,bot:false}));
 const w=new MobaWorld({roster});w.nextWave=1e6;
 for(const h of w.heroes){h.level=6;h.skillRanks={q:1,w:1,e:1,r:1};w.refreshStats(h);h.hp=h.maxHp;h.mana=h.maxMana;}
 return w;
};
const place=(h,x,z)=>Object.assign(h,{x,z,path:[],order:null});
const command=(w,h,m)=>w.command(h.id,{seq:h.lastSeq+1,...m});
const advance=(w,seconds)=>{for(let i=0;i<Math.ceil(seconds*30);i++)w.step();};
const minion=(w,attrs={})=>{const m={id:'fixture-'+(++w.serial),kind:'minion',team:1,x:3,z:0,hp:20,maxHp:300,radius:.48,path:[],route:[{x:3,z:0}],waypoint:0,attackAt:99999,contributors:{},...attrs};w.units.push(m);return m;};

test('interrupting targeted approach clears movement, ordinary movement is preserved',()=>{
 for(const control of ['silence','stun']){
  const w=make(),h=w.heroes[2],enemy=w.heroes[5];place(h,0,0);place(enemy,15,0);
  assert(command(w,h,{type:'cast',skill:'e',target:enemy.id}).approaching);assert(h.path.length);
  w.control(enemy,h,control,1);assert.equal(h.pendingCast,null);assert.equal(h.path.length,0);
  advance(w,1.2);assert(distance(h,{x:0,z:0})<.05);
 }
 const w=make(),h=w.heroes[2];place(h,0,0);assert(command(w,h,{type:'move',x:8,z:0}).ok);const path=structuredClone(h.path);w.cancelCast(h);assert.deepEqual(h.path,path);
});

test('strict last hit awards four distinct minion classes, XP shares but gold does not',()=>{
 for(const type of ['melee','ranged','siege','super']){
  const w=make(),a=w.heroes[0],near=w.heroes[2];place(a,0,0);place(near,1,0);const m=minion(w,{[type]:true}),gold=a.gold,nearGold=near.gold;
  w.damage(a,m,9999);assert.equal(a.gold-gold,MINION_REWARDS[type].gold);assert.equal(near.gold,nearGold);assert(near.xp>0);assert.equal(a.cs,1);assert.equal(a.totalGold,gold+MINION_REWARDS[type].gold);
 }
});
test('minion or tower final blow gives nearby XP and no lane gold',()=>{
 const w=make(),h=w.heroes[0],tower=w.entity('tower-0-1-0');place(h,0,0);const gold=h.gold;murder();function murder(){w.damage(tower,minion(w),9999);}assert.equal(h.gold,gold);assert(h.xp>0);assert.equal(h.cs,0);
});
test('support receives bounded cooperative last-hit income, duplicate death cannot pay again',()=>{
 const w=make(),a=w.heroes[0],s=w.heroes[4];place(a,0,0);place(s,1,0);const m=minion(w);w.damage(a,m,9999);assert.equal(s.supportGold,8);assert.equal(s.gold,508);const before=s.gold;w.kill(a,m);assert.equal(s.gold,before);assert.equal(a.cs,1);
 for(let i=0;i<10;i++)w.damage(a,minion(w),9999);assert.equal(s.supportGold,24);assert.equal(s.supportCredit,6);
 w.time=10;w.damage(a,minion(w),9999);assert.equal(s.supportGold,32);assert.equal(s.supportCredit,18);
 const state=w.serialize(),restored=new MobaWorld({state});assert.deepEqual(restored.serialize(),state);assert.equal(restored.playerState(s.id).supportIncome.perMinute,120);
});
test('support cannot farm self, a support partner, a distant carry, or repeated full-health heals',()=>{
 const w=make(),s=w.heroes[4],other=w.heroes[9],carry=w.heroes[0];place(s,0,0);place(carry,40,0);place(other,1,0);other.team=0;
 for(const ally of [s,other,carry]){w.support(s,ally);w.heal(s,ally,100);assert.equal(w.grantSupport(s,ally,'lastHit'),0);}const tower=w.entity('tower-0-1-0');place(tower,1,0);assert.equal(w.grantSupport(s,tower,'combat'),0);assert.equal(s.supportGold,0);
});
test('support kill-assist bonus shares the same public capped cooperation budget',()=>{
 const w=make(),s=w.heroes[4],a=w.heroes[0],e=w.heroes[5];place(s,0,0);place(a,1,0);place(e,4,0);s.supportCredit=0;w.damage(a,e,99999);assert.equal(s.assists,1);assert.equal(s.gold,570);assert.equal(s.supportGold,0);w.kill(a,e);assert.equal(s.gold,570);
});
test('effective combat support pays once per eight seconds and stays within token budget',()=>{
 const w=make(),s=w.heroes[4],a=w.heroes[0],e=w.heroes[5];place(s,0,0);place(a,1,0);place(e,5,0);w.damage(e,a,100);w.heal(s,a,40);assert.equal(s.supportGold,10);w.heal(s,a,40);assert.equal(s.supportGold,10);w.damage(s,e,40,'coffee_bolt');assert.equal(s.supportGold,10);
 w.time=8;w.damage(e,a,100);w.shield(s,a,80,3);w.damage(e,a,50);assert.equal(s.supportGold,20);assert.equal(s.supportCredit,20);
});
test('physical and magic defenses are independent, smite ignores both',()=>{
 const sample=(item,kind)=>{const w=make(),source=w.heroes[2],target=w.heroes[5];place(source,0,0);place(target,3,0);target.items=item?[item]:[];w.refreshStats(target);target.hp=target.maxHp;return w.damage(source,target,100,kind);};
 assert(sample('vest','attack')<sample(null,'attack'));assert.equal(sample('flask','attack'),sample(null,'attack'));
 assert(sample('flask','spell')<sample(null,'spell'));assert.equal(sample('vest','spell'),sample(null,'spell'));assert.equal(sample('flask','smite'),100);
 assert.equal(Object.keys(ITEMS).length,8);assert.equal(stats({heroId:'guardian',level:6,items:['flask']}).magicResist,59.5);
});
test('selling equipment does not manufacture total-earned-gold statistics',()=>{
 const w=make(),h=w.heroes[0];h.gold=1000;const earned=h.totalGold;assert(w.buy(h,'boots').ok);assert(w.sell(h,'boots').ok);assert.equal(h.totalGold,earned);advance(w,.1);assert(h.totalGold>earned&&h.totalGold<earned+1);
});
test('death recap includes recent physical/magic impacts and control, omits old combat',()=>{
 const w=make(),a=w.heroes[2],e=w.heroes[5];place(a,0,0);place(e,3,0);w.damage(a,e,20,'attack');w.time=10;w.control(a,e,'root',1);w.damage(a,e,20,'spell');w.damage(a,e,99999,'spell');
 const recap=w.playerState(e.id).deathRecap;assert.equal(recap.killer.id,a.id);assert.equal(recap.damage.length,2);assert(recap.damage.every(r=>r.type==='magic'));assert.equal(recap.controls[0].type,'root');assert(recap.total>0);assert(MobaWorld.validate(w.serialize()));
 advance(w,40);assert(e.hp>0);assert.equal(e.recentDamage.length,0);assert(e.deathRecap);
});
test('economy and recap snapshots reject malformed or oversized values',()=>{
 const w=make();for(const change of [h=>h.cs=-1,h=>h.totalGold=1e10,h=>h.supportCredit=31,h=>h.pendingCast={skill:'x',target:'a',expiresAt:9},h=>h.recentDamage=Array(25).fill({}),h=>h.deathRecap={at:0,total:1,damage:[],controls:[],killer:{id:'x',name:'x'.repeat(100),kind:'hero',heroId:null}}]){const state=w.serialize();change(state.heroes[0]);assert.throws(()=>MobaWorld.validate(state));}
 const snap=w.snapshot(0,w.heroes[0].id);assert.equal(snap.score[0].totalGold,500);assert.equal(snap.score[5].totalGold,undefined);assert.equal(snap.score[5].cs,0);assert.equal(snap.entities.find(e=>e.id==='nexus-tower-0-0').role,'nexus');
});
test('targeted skill walks into range, spends once, and survives checkpoint while approaching',()=>{
 const w=make(),h=w.heroes[2],enemy=w.heroes[5];place(h,0,0);place(enemy,15,0);const mana=h.mana;const result=command(w,h,{type:'cast',skill:'e',target:enemy.id});assert(result.ok&&result.approaching);assert.equal(h.mana,mana);assert.equal(h.cooldowns.e,0);assert.equal(w.playerState(h.id).pendingCast.target,enemy.id);assert(MobaWorld.validate(w.serialize()));
 advance(w,1.8);assert(h.x>5);assert.equal(h.pendingCast,null);assert(h.cooldowns.e>w.time);assert(enemy.rootUntil>w.time);assert.equal(w.events.filter(e=>e.kind==='cast'&&e.source===h.id).length,1);
});
test('stop, hold, movement, recall and a new cast clear pending targeted casts',()=>{
 for(const next of [{type:'stop'},{type:'hold'},{type:'move',x:-3,z:0},{type:'recall'},{type:'cast',skill:'q',x:5,z:2}]){const w=make(),h=w.heroes[2],enemy=w.heroes[5];place(h,0,0);place(enemy,15,0);assert(command(w,h,{type:'cast',skill:'e',target:enemy.id}).approaching);assert(command(w,h,next).ok);assert.equal(h.pendingCast,null);advance(w,.2);assert.equal(h.cooldowns.e,0);}
});
test('queued targeted cast cancels when enemy is hidden or dies, without charging mana',()=>{
 for(const hidden of [true,false]){const w=make(),h=w.heroes[2],enemy=w.heroes[5];place(h,0,0);place(enemy,15,0);command(w,h,{type:'cast',skill:'e',target:enemy.id});if(hidden)place(enemy,100,-100);else{enemy.hp=0;enemy.respawnAt=100;}advance(w,.1);assert.equal(h.pendingCast,null);assert.equal(h.cooldowns.e,0);}
});
test('soft separation disperses overlapping units with bounded work and respects walls',()=>{
 const w=make(),h=w.heroes[0],a=w.heroes[2];place(h,0,0);place(a,.05,0);for(let i=0;i<20;i++)w.separateUnits(1/30);assert(distance(h,a)>.8);
 for(let i=0;i<160;i++)minion(w,{x:i%8*.12,z:Math.floor(i/8)*.12});w.separateUnits(1/30);assert(w.metrics.separationChecks<=24*(w.units.length+10)/2);
 const wall=MAP.walls[0];place(h,wall.x-wall.w/2-h.radius-.01,wall.z);place(a,h.x-.02,h.z);for(let i=0;i<10;i++)w.separateUnits(1/30);assert(!blocked(h.x,h.z,h.radius));assert(!blocked(a.x,a.z,a.radius));
});
test('blink and dash pass through soft unit bodies without delaying the endpoint',()=>{
 const w=make(),h=w.heroes[1],a=w.heroes[0];place(h,0,0);place(a,5,0);w.dash(h,{x:6,z:0},6);assert(h.x>5);const at={x:h.x,z:h.z};w.separateUnits(1/30);assert.equal(h.x,at.x);assert.equal(h.z,at.z);
});
test('bot takes a safe last hit and support does not steal that last hit near carry',()=>{
 const w=make(),carry=w.heroes[0],support=w.heroes[4];place(carry,0,0);place(support,1,0);const m=minion(w,{hp:10});w.bot(carry);assert.equal(carry.order?.target,m.id);w.bot(support);assert.notEqual(support.order?.target,m.id);
});
test('bot heals, smites, wards and recalls for an affordable meaningful purchase',()=>{
 {const w=make(),h=w.heroes[0];place(h,0,0);h.hp=h.maxHp*.35;w.bot(h);assert(h.summoners.f>w.time);}
 {const w=make(),h=w.heroes[1],m=w.entity('camp-0-a');w.time=60;place(h,m.x,m.z+3);m.hp=100;w.bot(h);assert(h.summoners.f>w.time);assert.equal(m.hp,0);}
 {const w=make(),h=w.heroes[0];w.time=60;const p=MAP.brush.find(p=>!w.units.some(u=>u.kind==='monster'&&distance(u,p)<14)&&!w.units.some(u=>u.kind==='tower'&&u.team===1&&distance(u,p)<18));place(h,p.x+2,p.z);w.bot(h);assert(h.wardAt>w.time);assert(w.units.some(e=>e.kind==='ward'&&e.owner===h.id));}
 {const w=make(),h=w.heroes[0];place(h,0,0);h.gold=1300;w.bot(h);assert(h.recallAt>w.time);}
});
test('bot avoids an unescorted tower and does not chase hidden enemy heroes',()=>{
 const w=make(),h=w.heroes[0],enemy=w.heroes[5],tower=w.entity('tower-1-1-0');place(h,tower.x-10,tower.z);place(enemy,tower.x,tower.z+3);w.bot(h);assert.notEqual(h.order?.target,enemy.id);assert.equal(h.order?.type,'move');
 place(h,0,0);place(enemy,80,-80);h.order=null;h.path=[];w.bot(h);assert.notEqual(h.order?.target,enemy.id);
});
test('team goal assignment recruits for public epic objectives and preserves checkpoints',()=>{
 const w=make();w.time=500;for(const h of w.heroes.filter(h=>h.team===0)){place(h,-20+h.level,20);h.level=12;w.refreshStats(h);h.hp=h.maxHp;}const jobs=w.heroes.filter(h=>h.team===0).map(h=>w.botObjective(h));assert(jobs.filter(j=>j?.kind==='epic').length===3);assert(jobs.some(j=>j?.id==='crab'));assert(MobaWorld.validate(w.serialize()));
});
