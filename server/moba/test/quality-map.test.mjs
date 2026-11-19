import test from 'node:test';import assert from 'node:assert/strict';
import {MAP,findPath,distance,clearLine,blocked} from '../map.mjs';
const length=(from,path)=>path.reduce((s,p,i)=>s+distance(i?path[i-1]:from,p),0);
test('quality map has navigable objective mouths, escapes and both-team approach routes',()=>{
 for(const camp of MAP.camps.filter(c=>['crab','archive'].includes(c.kind))){
  assert(!blocked(camp.x,camp.z,1.8));
  for(const from of [...MAP.spawn,{x:0,z:0}]){const route=findPath(from,camp,.65);assert(route.length>0);assert(distance(route.at(-1),camp)<.1);let p=from;for(const q of route){assert(clearLine(p,q,.65));p=q;}assert(length(from,route)<distance(from,camp)*1.65);}
  const sign=camp.x>0?1:-1;
  for(const exit of [{x:camp.x,z:camp.z-20*sign},{x:camp.x-22*sign,z:camp.z-5*sign}])assert(findPath(camp,exit,.65).length>0);
 }
});
test('road centerlines stay open; floor guides do not imply paths through blockers',()=>{
 for(const lane of MAP.lanes)for(let i=1;i<lane.length;i++)assert(clearLine(lane[i-1],lane[i],.65));
 for(const[x,z,tx,tz]of MAP.trails)assert(clearLine({x,z},{x:tx,z:tz},2.6));
 assert(MAP.trails.length>0);
});
test('mirrored objective approaches have equal base travel cost',()=>{
 const a=MAP.camps.find(c=>c.id==='crab'),b=MAP.camps.find(c=>c.id==='epic-archive');
 const l=length(MAP.spawn[0],findPath(MAP.spawn[0],a,.65)),r=length(MAP.spawn[1],findPath(MAP.spawn[1],b,.65));
 assert(Math.abs(l-r)<1);
});
