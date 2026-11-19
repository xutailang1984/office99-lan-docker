import test from 'node:test';
import assert from 'node:assert/strict';
import {MobaWorld} from '../world.mjs';
import {defaultTeam,HERO_IDS,TACTICS} from '../catalog.mjs';

function fixture(){
 const roster=[...defaultTeam(0),...defaultTeam(1)].map((heroId,i)=>({id:'seat'+i,heroId,team:Math.floor(i/5),connected:true}));
 const world=new MobaWorld({roster});
 world.nextWave=world.botAt=99999;
 for(const hero of world.heroes){
  hero.level=6;hero.skillRanks={q:1,w:1,e:1,r:1};world.refreshStats(hero);hero.hp=hero.maxHp;hero.mana=hero.maxMana;
 }
 return {world,hero:id=>world.heroes.find(h=>h.heroId===id)};
}
function cast(world,hero,key,point){
 assert.ok(world.command(hero.id,{type:'cast',seq:hero.lastSeq+1,skill:key,target:point.id,x:point.x,z:point.z}).ok);
}
function advance(world,ticks){for(let i=0;i<ticks;i++)world.step(1/30);}
const position=(entity,x,z)=>Object.assign(entity,{x,z});

test('chained roots and stuns leave a usable escape window across a host handover',()=>{
 const {world,hero}=fixture(),target=position(hero('archer'),2,0);
 world.time=10;world.control(hero('guardian'),target,'stun',.65);
 world.time=10.6;world.control(hero('printer'),target,'root',1.25);
 assert.equal(target.rootUntil,11.8);
 const restored=new MobaWorld({state:world.serialize()}),runner=restored.entity(target.id);
 restored.time=11.81;
 assert.equal(restored.control(restored.entity(hero('guardian').id),runner,'stun',.9),0);
 assert.equal(restored.snapshot(runner.team,runner.id).entities.find(e=>e.id===runner.id).steady,true);
 assert.ok(restored.command(runner.id,{type:'move',seq:0,x:4,z:0}).ok);
 const start=runner.x;advance(restored,5);assert.ok(runner.x>start);
 restored.control(restored.entity(hero('printer').id),runner,'silence',1);
 assert.ok(runner.silenceUntil>restored.time);
 restored.time=12.56;assert.ok(restored.control(restored.entity(hero('guardian').id),runner,'stun',.9)>.89);
});

test('spaced controls keep full duration; weaker shields cannot prolong a stronger shield',()=>{
 const {world,hero}=fixture(),caster=hero('guardian'),enemy=position(hero('mechanic'),1,0),ally=hero('stapler');
 world.time=2;world.control(caster,enemy,'stun',.65);
 world.time=3.2;assert.ok(world.control(caster,enemy,'root',1.4)>1.39);
 world.shield(caster,ally,200,3);const until=ally.shieldUntil;
 world.time+=2;world.shield(hero('barista'),ally,100,3);
 assert.equal(ally.shield,200);assert.equal(ally.shieldUntil,until);
 world.time=until+.01;world.shield(hero('barista'),ally,100,3);assert.equal(ally.shield,100);
});

test('guardian shields two teammates fully, sharing the same budget across four',()=>{
 function shields(count){
  const {world,hero}=fixture(),tank=position(hero('guardian'),0,0);
  const friends=world.heroes.filter(e=>e.team===tank.team&&e!==tank).slice(0,count);
  friends.forEach((h,i)=>position(h,1,i));cast(world,tank,'e',tank);advance(world,7);
  return {own:tank.shield,friends:friends.map(h=>h.shield)};
 }
 const two=shields(2),four=shields(4);
 assert.equal(two.own,four.own);assert(two.own>0);
 assert(four.friends.every(x=>x===two.friends[0]/2));
});

test('tea serves the three lowest health ratios and reprioritizes the next round',()=>{
 const {world,hero}=fixture(),healer=position(hero('barista'),0,0);
 const allies=world.heroes.filter(h=>h.team===healer.team&&h!==healer);
 allies.forEach((h,i)=>{position(h,1,i);h.hp=h.maxHp*(.1+i*.11);});
 cast(world,healer,'r',healer);advance(world,9);
 const healed=()=>new Set(world.events.filter(e=>e.kind==='heal'&&e.amount>5).map(e=>e.target));
 assert.deepEqual(healed(),new Set(allies.slice(0,3).map(h=>h.id)));
 allies[0].hp=allies[0].maxHp;world.events=[];advance(world,17);
 assert.deepEqual(healed(),new Set(allies.slice(1).map(h=>h.id)));
});

test('projection has a safer outer band, and a teammate can increase its damage by slowing first',()=>{
 function impact(offset,withPartner=false){
  const {world,hero}=fixture(),mage=position(hero('lecturer'),0,1),support=position(hero('broadcaster'),0,0);
  const target=position(hero('stapler'),3+offset,0);
  if(withPartner)cast(world,support,'q',target);
  advance(world,22);cast(world,mage,'r',{x:3,z:0});advance(world,15);
  return {damage:mage.damage,slowed:target.slowUntil>world.time};
 }
 const center=impact(0),edge=impact(3.5),outside=impact(5),assisted=impact(0,true);
 assert(center.damage>0&&edge.slowed);
 assert(Math.abs(edge.damage/center.damage-.65)<1e-6);
 assert(Math.abs(assisted.damage/center.damage-1.15)<1e-6);
 assert.equal(outside.damage,0);assert.equal(outside.slowed,false);
});

test('all ten hero choices describe their own play, their teammate and the counter',()=>{
 assert.deepEqual(Object.keys(TACTICS).sort(),[...HERO_IDS].sort());
 for(const tips of Object.values(TACTICS)){assert.equal(tips.length,3);assert(tips.every(s=>s.length>=8&&s.length<=27));}
});

test('board covers allies directly behind it against frontal basic attacks only',()=>{
 const {world,hero}=fixture(),board=position(hero('custodian'),0,0);
 const ally=position(hero('archer'),-2,0),attacker=position(hero('stapler'),6,0);
 const hit=(kind='attack')=>world.damage(attacker,ally,80,kind);
 const full=hit();
 cast(world,board,'e',attacker);advance(world,6);
 assert(Math.abs(hit()/full-.65)<1e-6);assert.equal(hit('spell'),full);
 position(attacker,-7,0);assert.equal(hit(),full);
 position(attacker,6,0);position(ally,-2,2);assert.equal(hit(),full);
 position(ally,-2,0);advance(world,91);assert.equal(hit(),full);
});

test('broadcast rally clears existing slow, while a fresh hit or a slowing field can reapply it',()=>{
 const {world,hero}=fixture(),support=position(hero('broadcaster'),0,0);
 const friend=position(hero('archer'),0,1),far=position(hero('mechanic'),0,9);
 for(const h of [friend,far]){h.slow=.4;h.slowUntil=5;}
 cast(world,support,'e',friend);advance(world,6);
 assert.equal(friend.slowUntil,0);assert(friend.hasteUntil>world.time);
 assert.equal(far.slowUntil,5);
 world.zones.push({id:'tape-test',kind:'tape',team:1-friend.team,source:hero('stapler').id,x:friend.x,z:friend.z,radius:2,endAt:4,nextAt:0,damage:0,slow:.4});
 advance(world,1);assert(friend.slowUntil>world.time);
});

test('three stamp hits through a shield trigger shield break without converting the bonus into HP damage',()=>{
 function run(shield){
  const {world,hero}=fixture(),mage=position(hero('printer'),0,0),target=position(hero('archer'),3,0);
  if(shield)world.shield(target,target,shield,8);
  const start=target.hp;
  cast(world,mage,'e',target);advance(world,10);
  cast(world,mage,'q',target);advance(world,13);
  assert.equal(mage.ink[target.id].count,2);
  cast(world,mage,'r',target);advance(world,16);
  assert.equal(mage.ink[target.id].count,0);
  return {health:start-target.hp,shield:target.shield,damage:mage.damage};
 }
 const bare=run(0),small=run(10),large=run(1800);
 assert(Math.abs(bare.health-small.health-10)<.001);
 assert.equal(large.health,0);assert(Math.abs(1800-large.shield-bare.damage-150)<.001);
});

test('bots roll away from a diver, peel for the shooter and rally a slowed ally',()=>{
 const {world,hero}=fixture(),archer=position(hero('archer'),0,0),diver=position(hero('courier'),3,0);
 world.bot(archer);advance(world,8);assert(archer.x<0);
 position(archer,0,0);const board=position(hero('custodian'),1,0);
 world.bot(board);assert.equal(board.action,'cast_q');advance(world,10);
 assert(diver.x>4);
 const support=position(hero('broadcaster'),0,1);
 archer.slow=.4;archer.slowUntil=world.time+4;
 world.bot(support);advance(world,8);
 assert(archer.hasteUntil>world.time);assert.equal(archer.slowUntil,0);
});
