import test from 'node:test';
import assert from 'node:assert/strict';
import {MAP,blocked,clearLine,distance,findPath,nearestOpen} from '../map.mjs';
const circles=[...MAP.structures,{id:'core-0',x:-128,z:128,radius:2.8},{id:'core-1',x:128,z:-128,radius:2.8}];
function verifyRoute(from,to,r=.65){
 const route=findPath(from,to,r,circles);assert(route.length>0,'no path '+JSON.stringify({from,to}));let prev=from,total=0;
 for(const p of route){assert(clearLine(prev,p,r));const steps=Math.max(1,Math.ceil(distance(prev,p)*2));for(let t=1;t<=steps;t++){const f=t/steps,q={x:prev.x+(p.x-prev.x)*f,z:prev.z+(p.z-prev.z)*f};assert(!circles.some(c=>distance(c,q)<c.radius+r-.001),'structure crossed '+JSON.stringify(q));}total+=distance(prev,p);prev=p;}
 assert(distance(prev,to)<5,'arrival too far from target');return total;
}
test('map exposes dimensions and symmetric complete objective layout',()=>{assert.equal(MAP.size,300);assert.equal(MAP.boundary,144);assert.equal(MAP.gridSize,3);assert.equal(MAP.camps.filter(c=>c.id.startsWith('camp-0-')).length,6);assert.equal(MAP.camps.filter(c=>c.id.startsWith('camp-1-')).length,6);assert.equal(MAP.camps.filter(c=>['crab','archive'].includes(c.kind)).length,2);assert.equal(MAP.structures.filter(s=>s.role==='lane').length,18);assert.equal(MAP.structures.filter(s=>s.kind==='inhibitor').length,6);assert.equal(MAP.structures.filter(s=>s.role==='nexus').length,4);});
test('entire visible lane width stays clear of walls',()=>{for(const lane of MAP.lanes)for(let i=1;i<lane.length;i++)assert(clearLine(lane[i-1],lane[i],MAP.laneWidth/2+.65),'road obstructed '+JSON.stringify(lane[i]));});
test('central river stays wide while epic courtyards preserve end-to-end traversal',()=>{
 assert(clearLine({x:-35,z:-35},{x:35,z:35},MAP.riverWidth/2+.65));
 const from={x:-135,z:-135},to={x:135,z:135},route=findPath(from,to,.65);assert(route.length>0);
 let at=from,total=0;for(const p of route){assert(clearLine(at,p,.65));total+=distance(at,p);at=p;}
 assert(distance(at,to)<1);assert(total<distance(from,to)*1.25);
});
test('camps and structures have clear non-overlapping footprints',()=>{for(const p of MAP.camps)assert(!blocked(p.x,p.z,3),p.id);for(const s of MAP.structures)assert(!blocked(s.x,s.z,s.radius+.65),s.id);for(let i=0;i<circles.length;i++)for(let j=i+1;j<circles.length;j++)assert(distance(circles[i],circles[j])>circles[i].radius+circles[j].radius+1.3,circles[i].id+' overlaps '+circles[j].id);});
test('every camp and lane is reachable from both spawns with structures alive',()=>{for(const spawn of MAP.spawn)for(const point of [...MAP.camps,...MAP.lanes.flat(),{x:0,z:0}])verifyRoute(spawn,point);});
test('opposite base remains reachable beyond legacy coordinate bounds',()=>{for(const r of [.48,.65,.9]){const total=verifyRoute(MAP.spawn[0],MAP.spawn[1],r);assert(total>350&&total<470);}});
test('corresponding team travel times differ by less than one second',()=>{for(const lane of [0,1,2]){const a=MAP.structures.find(s=>s.id==='tower-0-'+lane+'-0'),b=MAP.structures.find(s=>s.id==='tower-1-'+(lane===1?1:2-lane)+'-0');assert(Math.abs(verifyRoute(MAP.spawn[0],a)-verifyRoute(MAP.spawn[1],b))<6.7);}});
test('off-map clicks clamp to actual new boundary',()=>{const p=nearestOpen({x:999,z:-999});assert(!blocked(p.x,p.z));assert(p.x>140&&p.z< -140);assert.equal(findPath({x:Infinity,z:0},{x:0,z:0}).length,0);});
test('swept lines cannot tunnel through a narrow wall',()=>{const wall=MAP.walls[0];assert.equal(clearLine({x:wall.x-30,z:wall.z},{x:wall.x+80,z:wall.z}),false);assert(findPath({x:wall.x-20,z:wall.z+15},{x:wall.x+35,z:wall.z+15}).length>0);});
