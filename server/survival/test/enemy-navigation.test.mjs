import test from 'node:test';
import assert from 'node:assert/strict';
import {EnemyNavigation} from '../enemy-navigation.mjs';

// Synthetic geometry only: this is not a World, AI damage, GPU or network test.
function fixture(boxes=[],options={}){
 const blocked=(p,r)=>boxes.some(b=>p.x>b[0]-r&&p.x<b[1]+r&&p.z>b[2]-r&&p.z<b[3]+r);
 const canTraverse=(a,b,r)=>{const count=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.15));for(let i=1;i<=count;i++)if(blocked({x:a.x+(b.x-a.x)*i/count,z:a.z+(b.z-a.z)*i/count},r))return false;return true;};
 const nav=new EnemyNavigation({canTraverse,...options});
 return {nav,blocked,canTraverse,boxes};
}
function walk(f,enemy,goal,seconds=16,extra={}){
 let sawPath=false;
 for(let tick=0;tick<seconds*30;tick++){
  const q=f.nav.next({enemy,goal,goalKey:'target',geometryRevision:0,tick,now:tick/30,...extra});
  if(q.status==='path')sawPath=true;
  if(q.waypoint){const d=Math.hypot(q.waypoint.x-enemy.x,q.waypoint.z-enemy.z),v=Math.min(d,3/30),next={...enemy,x:enemy.x+(q.waypoint.x-enemy.x)*v/d,z:enemy.z+(q.waypoint.z-enemy.z)*v/d};assert(f.canTraverse(enemy,next,enemy.radius));Object.assign(enemy,next);}
  assert(!f.blocked(enemy,enemy.radius));
  if(Math.hypot(goal.x-enemy.x,goal.z-enemy.z)<.26)return {reached:true,sawPath};
 }
 return {reached:false,sawPath};
}
test('straight route is direct and never searches or moves the caller',()=>{
 const f=fixture(),enemy={id:'one',x:0,z:0,radius:.6},before={...enemy};
 const q=f.nav.next({enemy,goal:{x:4,z:0},tick:1,now:0});assert.equal(q.status,'direct');assert.equal(f.nav.stats.searches,0);assert.deepEqual(enemy,before);
});
test('solid rock detours without cutting its corners',()=>{
 const f=fixture([[-2,2,-1,1]]),e={id:'rock',x:0,z:-5,radius:.6};const result=walk(f,e,{x:0,z:5});assert(result.reached);assert(result.sawPath);
});
test('bounded U trap backtracks through its opening',()=>{
 const f=fixture([[-3,3,-3,-2],[-3,-2,-2,3],[2,3,-2,3]]),e={id:'u',x:0,z:0,radius:.6};const result=walk(f,e,{x:0,z:-6},22);assert(result.reached);assert(result.sawPath);
});
test('closed-to-open geometry change invalidates cached detour',()=>{
 const f=fixture([[-2,2,-1,1]]),e={id:'gate',x:0,z:-4,radius:.6},goal={x:0,z:4};
 assert.equal(f.nav.next({enemy:e,goal,tick:1,now:0,geometryRevision:1}).status,'path');f.boxes.length=0;
 assert.equal(f.nav.next({enemy:e,goal,tick:2,now:.03,geometryRevision:2}).status,'direct');
});
test('target replacement discards the previous route',()=>{
 const f=fixture([[-2,2,-1,1]]),e={id:'target',x:0,z:-4,radius:.6};f.nav.next({enemy:e,goal:{x:0,z:4},goalKey:'old',tick:1,now:0});
 const q=f.nav.next({enemy:e,goal:{x:0,z:-8},goalKey:'new',tick:2,now:.03});assert.equal(q.status,'direct');assert(q.waypoint.z<e.z);
});
test('unreachable destination has finite budget and retry cooldown',()=>{
 const f=fixture([[-4,4,-4,-3],[-4,4,3,4],[-4,-3,-4,4],[3,4,-4,4]]),e={id:'closed',x:0,z:0,radius:.6};
 const first=f.nav.next({enemy:e,goal:{x:0,z:12},tick:1,now:0});assert.equal(first.status,'unreachable');assert(f.nav.stats.expanded<=192);assert(f.nav.stats.traversals<=768);
 assert.equal(f.nav.next({enemy:e,goal:{x:0,z:12},tick:2,now:.1}).status,'unreachable');assert.equal(f.nav.stats.searches,0);
});
test('24 enemies share a per-tick search budget rather than each searching',()=>{
 const f=fixture([[-4,4,-4,-3],[-4,4,3,4],[-4,-3,-4,4],[3,4,-4,4]]);
 const enemies=Array.from({length:24},(_,i)=>({id:`e${i}`,x:0,z:0,radius:.6}));
 for(let tick=0;tick<24;tick++){for(const e of enemies)f.nav.next({enemy:e,goal:{x:0,z:12},tick,now:tick/30});assert(f.nav.stats.searches<=1);assert(f.nav.stats.expanded<=192);assert(f.nav.stats.traversals<=768);assert(f.nav.stats.immediateChecks<=64);}
 assert(enemies.every(e=>f.nav.records.get(e.id).retryAt>0));
});
test('leash/legal-area adapter can refuse all detour points outside territory',()=>{
 const f=fixture([[-3,3,-1,1]],{allowPoint:p=>Math.abs(p.x)<=1}),e={id:'leash',x:0,z:-3,radius:.6};
 for(let tick=0;tick<90;tick++){const q=f.nav.next({enemy:e,goal:{x:0,z:4},tick,now:tick/30});if(q.waypoint)assert(Math.abs(q.waypoint.x)<=1);}
});
test('private cache is bounded and explicit removal releases its entry',()=>{
 const f=fixture([],{maxRecords:3});for(let i=0;i<20;i++)f.nav.next({enemy:{id:`x${i}`,x:0,z:0,radius:.6},goal:{x:1,z:0},tick:i,now:i});assert.equal(f.nav.records.size,3);f.nav.forget('x19');assert.equal(f.nav.records.size,2);f.nav.clear();assert.equal(f.nav.records.size,0);
});
test('oversized actor uses its own radius and cannot use a narrow corridor',()=>{
 const f=fixture([[-10,-1.1,-2,2],[1.1,10,-2,2]],{searchRadius:9}),e={id:'boss',x:0,z:-5,radius:1.2};const q=f.nav.next({enemy:e,goal:{x:0,z:5},tick:1,now:0});assert.notEqual(q.status,'direct');
});
