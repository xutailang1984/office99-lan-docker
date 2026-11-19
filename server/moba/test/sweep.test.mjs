import test from 'node:test';
import assert from 'node:assert/strict';
import {MobaWorld} from '../world.mjs';
import {HERO_IDS} from '../catalog.mjs';
import {MAP,blocked} from '../map.mjs';

const world=()=>new MobaWorld({roster:Array.from({length:10},(_,i)=>({id:'sweep-'+i,heroId:HERO_IDS[i],team:i<5?0:1,connected:true}))});
const command=(w,h,m)=>w.command(h.id,{seq:h.lastSeq+1,...m});
const advance=(w,s)=>{for(let i=0;i<Math.ceil(s*30);i++)w.step(1/30);};
const near=(a,b,epsilon=.002)=>assert(Math.abs(a-b)<epsilon,`${a} should be within ${epsilon} of ${b}`);
function wallFixture(){
 const w=world(),a=w.heroes[0],b=w.heroes[5],wall=MAP.walls[0],left=wall.x-wall.w/2;
 Object.assign(a,{x:left-2,z:wall.z});Object.assign(b,{x:left-.8,z:wall.z});
 assert(!blocked(a.x,a.z,a.radius));assert(!blocked(b.x,b.z,b.radius));
 return{w,a,b,left,z:wall.z};
}
test('a projectile hits an exposed enemy before a wall inside the same authoritative sweep',()=>{
 const {w,a,b,left}=wallFixture(),hp=b.hp;
 w.projectile(a,b,{damage:50,speed:100,width:.3,target:b.id});w.step(1/30);
 assert(b.hp<hp);const ends=w.events.filter(e=>e.kind==='projectile_end');assert.equal(ends.length,1);
 near(ends[0].at.x,b.x-b.radius-.3);assert(ends[0].at.x<left-.1);
});
test('a piercing projectile can damage a target before the wall then terminate at the wall once',()=>{
 const {w,a,b,left,z}=wallFixture(),hp=b.hp;
 w.projectile(a,{x:left+5,z},{damage:50,speed:100,width:.3,pierce:true});w.step(1/30);
 assert(b.hp<hp);const ends=w.events.filter(e=>e.kind==='projectile_end');assert.equal(ends.length,1);
 near(ends[0].at.x,left-.1);assert.equal(w.projectiles.length,0);
});
test('a wall-only impact ends on the actual wall boundary rather than past it',()=>{
 const {w,a,b,left,z}=wallFixture();Object.assign(b,{x:0,z:0});
 w.projectile(a,{x:left+5,z},{damage:50,speed:100,width:.3});w.step(1/30);
 const end=w.events.find(e=>e.kind==='projectile_end');assert(end);near(end.at.x,left-.1);
 assert.equal(w.events.filter(e=>e.kind==='hit').length,0);
});
test('normal-speed hook impact is frozen before the target is pulled',()=>{
 const w=world(),a=w.heroes[1],b=w.heroes[5];Object.assign(a,{x:0,z:0});Object.assign(b,{x:4,z:0});
 w.projectile(a,{x:12,z:0},{damage:10,speed:24,width:.65,pull:true,kind:'hook'});advance(w,4/30);
 assert(b.x<4);const end=w.events.find(e=>e.kind==='projectile_end');assert(end);
 near(end.from.x,2.4);near(end.at.x,4-b.radius-.65);assert(end.at.x>end.from.x);
});
test('nonpiercing sweep chooses the first surface, even when its center is farther away',()=>{
 const w=world(),a=w.heroes[0],nearCenter=w.heroes[5],firstSurface=w.heroes[6];
 Object.assign(a,{x:0,z:0});Object.assign(nearCenter,{x:3,z:0,radius:.35});Object.assign(firstSurface,{x:4,z:0,radius:1.7});
 const firstHp=firstSurface.hp,nearHp=nearCenter.hp;
 w.projectile(a,{x:10,z:0},{damage:30,speed:200,width:.3});w.step(1/30);
 assert(firstSurface.hp<firstHp);assert.equal(nearCenter.hp,nearHp);
 near(w.events.find(e=>e.kind==='projectile_end').at.x,2);
});
test('range expiry cannot overshoot by a full simulation tick',()=>{
 const w=world(),a=w.heroes[0];Object.assign(a,{x:0,z:0});
 w.projectile(a,{x:10,z:0},{damage:30,speed:38,width:.3});w.projectiles[0].remaining=.2;w.step(1/30);
 const end=w.events.find(e=>e.kind==='projectile_end');assert(end);near(end.at.x,.2);assert.equal(w.projectiles.length,0);
});
test('S during stun clears the old attack intent without permitting actions while stunned',()=>{
 const w=world(),h=w.heroes[0],enemy=w.heroes[5];Object.assign(h,{x:0,z:0});Object.assign(enemy,{x:2,z:0});
 command(w,h,{type:'attack',target:enemy.id});w.step();assert(w.control(enemy,h,'stun',.3)>0);
 const afterControl=w.eventSeq;assert(command(w,h,{type:'stop'}).ok);assert.equal(h.order,null);
 advance(w,.8);assert.equal(h.x,0);assert(!w.events.some(e=>e.id>afterControl&&e.kind==='attack'&&e.source===h.id));
});
test('H during stun holds position; attacks resume only after recovery and never chase',()=>{
 const w=world(),h=w.heroes[0],enemy=w.heroes[5];Object.assign(h,{x:0,z:0});Object.assign(enemy,{x:2,z:0});
 command(w,h,{type:'attack',target:enemy.id});w.step();assert(w.control(enemy,h,'stun',.3)>0);
 const afterControl=w.eventSeq;assert(command(w,h,{type:'hold'}).ok);assert.equal(h.order.type,'hold');
 advance(w,.2);assert(!w.events.some(e=>e.id>afterControl&&e.kind==='attack'&&e.source===h.id));
 advance(w,.2);assert(w.events.some(e=>e.id>afterControl&&e.kind==='attack'&&e.source===h.id));
 enemy.x=15;advance(w,.5);assert.equal(h.x,0);assert.equal(h.z,0);
});
