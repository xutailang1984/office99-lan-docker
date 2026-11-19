// All distances share hero movement units; do not scale attacks with the map.
const top=[{x:-124,z:118},{x:-124,z:88},{x:-122,z:32},{x:-123,z:-42},{x:-117,z:-104},{x:-95,z:-121},{x:-30,z:-123},{x:48,z:-124},{x:118,z:-124}];
const mid=[{x:-120,z:120},{x:-83,z:83},{x:-51,z:51},{x:-19,z:19},{x:19,z:-19},{x:51,z:-51},{x:83,z:-83},{x:120,z:-120}];
const turn=p=>({x:-p.x,z:-p.z}),reflect=p=>({x:-p.z,z:-p.x});
const bottom=[...top].reverse().map(turn);
const upperWalls=[{x:-103,z:56,w:24,d:8},{x:-79,z:39,w:8,d:28},{x:-102,z:6,w:24,d:8},{x:-70,z:-15,w:8,d:28},{x:-104,z:-42,w:22,d:8},{x:-62,z:-30,w:22,d:8}];
const blueWalls=[...upperWalls,...upperWalls.map(b=>({...reflect(b),w:b.d,d:b.w}))];
const upperBrush=[{x:-105,z:77,r:6},{x:-108,z:25,r:5},{x:-84,z:-40,r:6},{x:-46,z:-29,r:5},{x:-124,z:-76,r:4.5},{x:-29,z:43,r:5}];
const blueBrush=[...upperBrush,...upperBrush.map(b=>({...reflect(b),r:b.r}))];
const upperCamps=[{x:-105,z:84,kind:'paper',hp:650,gold:85},{x:-86,z:12,kind:'coffee',hp:800,gold:100},{x:-105,z:-62,kind:'printer',hp:1150,gold:130}];
const blueCamps=[...upperCamps,...upperCamps.map(c=>({...c,...reflect(c)}))];
// Objective courtyards have a broad river mouth and a narrow side escape.
// Rendered walls and path/shot blockers share these exact footprints.
const pitWalls=[{x:61,z:74,w:28,d:4},{x:74,z:61,w:4,d:22},{x:48,z:67,w:4,d:10}];
const pitBrush=[{x:43,z:53,r:4},{x:68,z:43,r:4}];
const jungleTrails=[[-114,102,-105,84],[-105,84,-90,65],[-90,65,-86,12],[-86,12,-88,-18],[-88,-18,-105,-62],[-86,12,-49,12],[-49,12,-29,25]];
const structures=[],blueTowers=[[[-123,-38],[-123,30],[-124,78]],[[-42,42],[-77,77],[-101,101]],[[38,123],[-30,123],[-78,124]]],blueInhibitors=[[-124,101],[-113,113],[-101,124]];
for(let team=0;team<2;team++){const sign=team?-1:1;
 for(let lane=0;lane<3;lane++){const authored=team&&lane!==1?2-lane:lane;
  for(let tier=0;tier<3;tier++){const [x,z]=blueTowers[authored][tier];structures.push({id:'tower-'+team+'-'+lane+'-'+tier,kind:'tower',role:'lane',team,lane,tier,x:x*sign,z:z*sign,radius:1.5});}
  const [x,z]=blueInhibitors[authored];structures.push({id:'inhibitor-'+team+'-'+lane,kind:'inhibitor',team,lane,x:x*sign,z:z*sign,radius:1.7});}
 for(const [index,[x,z]] of [[-119,128],[-128,119]].entries())structures.push({id:'nexus-tower-'+team+'-'+index,kind:'tower',role:'nexus',team,lane:-1,tier:3,x:x*sign,z:z*sign,radius:1.5});
}
export const MAP={
 size:300,boundary:144,cameraBounds:{minX:-138,maxX:138,minZ:-138,maxZ:138},laneWidth:12,riverWidth:14,gridSize:3,
 spawn:[{x:-132,z:132},{x:132,z:-132}],lanes:[top,mid,bottom],
 walls:[...blueWalls,...blueWalls.map(b=>({...b,...turn(b)})),...pitWalls,...pitWalls.map(b=>({...b,...turn(b)}))],
 brush:[...blueBrush,...blueBrush.map(b=>({...b,...turn(b)})),...pitBrush,...pitBrush.map(b=>({...b,...turn(b)}))],
 trails:[...jungleTrails,...jungleTrails.map(([x,z,tx,tz])=>[-z,-x,-tz,-tx])].flatMap(p=>[p,p.map(v=>-v)]),
 camps:[...[0,1].flatMap(team=>blueCamps.map((c,index)=>({...c,...(team?turn(c):{}),id:'camp-'+team+'-'+String.fromCharCode(97+index),team}))),{id:'epic-archive',x:-61,z:-61,kind:'archive',hp:4400,gold:220,spawnAt:480},{id:'crab',x:61,z:61,kind:'crab',hp:3200,gold:180,spawnAt:180}],
 structures,districts:[{text:'档案长廊',x:-132,z:-4},{text:'主会场',x:-33,z:39},{text:'茶水长廊',x:8,z:133},{text:'档案库',x:-61,z:-76},{text:'加单池',x:61,z:77}]
};
export const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function pathPoint(path,t){let lengths=path.slice(1).map((p,i)=>distance(p,path[i])),left=lengths.reduce((a,b)=>a+b,0)*clamp(t,0,1);for(let i=0;i<lengths.length;i++){if(left<=lengths[i]){let f=left/lengths[i];return{x:path[i].x+(path[i+1].x-path[i].x)*f,z:path[i].z+(path[i+1].z-path[i].z)*f};}left-=lengths[i];}return{...path.at(-1)};}
export function blocked(x,z,r=.65){return Math.abs(x)>MAP.boundary-r||Math.abs(z)>MAP.boundary-r||MAP.walls.some(b=>Math.abs(x-b.x)<b.w/2+r&&Math.abs(z-b.z)<b.d/2+r);}
function intersectsBox(a,b,box,r){
 let low=0,high=1;
 for(const [key,half] of [['x',box.w/2+r],['z',box.d/2+r]]){
  const delta=b[key]-a[key],min=box[key]-half,max=box[key]+half;
  if(Math.abs(delta)<1e-9){if(a[key]<=min||a[key]>=max)return false;continue;}
  const first=(min-a[key])/delta,last=(max-a[key])/delta;low=Math.max(low,Math.min(first,last));high=Math.min(high,Math.max(first,last));if(low>=high-1e-9)return false;
 }return high>0&&low<1;
}
// Swept rectangle tests avoid wall tunnelling without distance-based sampling.
export function clearLine(a,b,r=.15){return!blocked(a.x,a.z,r)&&!blocked(b.x,b.z,r)&&!MAP.walls.some(box=>intersectsBox(a,b,box,r));}
export function nearestOpen(p,r=.65){
 const limit=MAP.boundary-r-.01,v={x:clamp(p.x,-limit,limit),z:clamp(p.z,-limit,limit)};if(!blocked(v.x,v.z,r))return v;
 for(let d=.5;d<=24;d+=.5)for(let a=0;a<32;a++){const q={x:v.x+Math.cos(a*Math.PI/16)*d,z:v.z+Math.sin(a*Math.PI/16)*d};if(!blocked(q.x,q.z,r))return q;}return null;
}
function segmentCircle(a,b,c,r){
 const dx=b.x-a.x,dz=b.z-a.z,length=dx*dx+dz*dz,radius=c.radius+r+.08,start=distance(a,c);
 // Actors already touching a structure may leave it but cannot cut through it.
 if(start<radius&&(a.x-c.x)*dx+(a.z-c.z)*dz>=0)return false;
 const t=length?clamp(((c.x-a.x)*dx+(c.z-a.z)*dz)/length,0,1):0;return Math.hypot(a.x+dx*t-c.x,a.z+dz*t-c.z)<radius;
}
class MinHeap{
 constructor(){this.items=[];}
 push(item){const a=this.items;a.push(item);let i=a.length-1;while(i){const p=(i-1)>>1;if(a[p].f<=item.f)break;a[i]=a[p];i=p;}a[i]=item;}
 pop(){const a=this.items,first=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let child=i*2+1;if(child+1<a.length&&a[child+1].f<a[child].f)child++;if(a[child].f>=last.f)break;a[i]=a[child];i=child;}a[i]=last;}return first;}
 get length(){return this.items.length;}
}
const grids=new Map(),cache=new Map();
function gridFor(r){
 if(grids.has(r))return grids.get(r);
 const step=MAP.gridSize,half=Math.floor(MAP.boundary/step),width=half*2+1,count=width*width,points=new Array(count),open=new Uint8Array(count);
 for(let z=0;z<width;z++)for(let x=0;x<width;x++){const id=z*width+x,p={x:(x-half)*step,z:(z-half)*step};points[id]=p;open[id]=blocked(p.x,p.z,r)?0:1;}
 const value={step,half,width,count,points,open,edges:new Map()};grids.set(r,value);return value;
}
export function findPath(from,to,r=.65,circles=[]){
 if(!from||!to||![from.x,from.z,to.x,to.z,r].every(Number.isFinite)||r<=0||blocked(from.x,from.z,r))return[];
 const occupied=p=>blocked(p.x,p.z,r)||circles.some(c=>distance(c,p)<c.radius+r+.08),walkLine=(a,b)=>clearLine(a,b,r)&&!circles.some(c=>segmentCircle(a,b,c,r));
 let goal=nearestOpen(to,r);if(!goal)return[];
 if(occupied(goal)){let candidate=null;for(let d=.5;d<=24&&!candidate;d+=.5){const options=[];for(let i=0;i<32;i++){const a=i*Math.PI/16,p={x:goal.x+Math.cos(a)*d,z:goal.z+Math.sin(a)*d};if(!occupied(p))options.push(p);}candidate=options.sort((a,b)=>distance(from,a)-distance(from,b))[0];}if(!candidate)return[];goal=candidate;}
 if(walkLine(from,goal))return[goal];
 const grid=gridFor(r),{step,half,width,count,points,open}=grid;
 const cell=p=>{const x=Math.round(p.x/step)+half,z=Math.round(p.z/step)+half;let best=-1,bestDistance=Infinity;for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++){const nx=x+dx,nz=z+dz;if(nx<0||nz<0||nx>=width||nz>=width)continue;const id=nz*width+nx,q=points[id],d=distance(p,q);if(open[id]&&d<bestDistance&&!occupied(q)&&walkLine(p,q)){best=id;bestDistance=d;}}return best;};
 const start=cell(from),end=cell(goal);if(start<0||end<0)return[];
 const signature=start+':'+end+':'+r+':'+circles.map(c=>[c.id,c.x,c.z,c.radius].join(',')).join(';');
 const smooth=route=>{const list=[...route,goal],result=[];let anchor=from,index=0;while(index<list.length){let last=list.length-1;while(last>index&&!walkLine(anchor,list[last]))last--;if(!walkLine(anchor,list[last]))return[];result.push({...list[last]});anchor=list[last];index=last+1;}return result;};
 if(cache.has(signature)){const route=cache.get(signature);if(walkLine(from,route[0])&&walkLine(route.at(-1),goal))return smooth(route);cache.delete(signature);}
 const heap=new MinHeap(),cost=new Float64Array(count).fill(Infinity),parent=new Int32Array(count).fill(-1),closed=new Uint8Array(count);cost[start]=0;heap.push({id:start,g:0,f:distance(points[start],points[end])});let found=false;
 while(heap.length){
  const n=heap.pop();if(closed[n.id]||n.g>cost[n.id])continue;if(n.id===end){found=true;break;}closed[n.id]=1;
  let edges=grid.edges.get(n.id);
  if(!edges){edges=[];const x=n.id%width,z=Math.floor(n.id/width);for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){const nx=x+dx,nz=z+dz;if(nx<0||nz<0||nx>=width||nz>=width)continue;const id=nz*width+nx;if(open[id]&&clearLine(points[n.id],points[id],r))edges.push(id);}grid.edges.set(n.id,edges);}
  for(const id of edges){if(closed[id]||circles.some(c=>segmentCircle(points[n.id],points[id],c,r)))continue;const g=n.g+distance(points[n.id],points[id]);if(g>=cost[id])continue;cost[id]=g;parent[id]=n.id;heap.push({id,g,f:g+distance(points[id],points[end])});}
 }
 if(!found)return[];const route=[];for(let id=end;id>=0;id=parent[id]){route.push(points[id]);if(id===start)break;}route.reverse();
 if(!walkLine(from,route[0])||!walkLine(route.at(-1),goal))return[];
 if(cache.size>=512)cache.delete(cache.keys().next().value);cache.set(signature,route);return smooth(route);
}

// Floor guides follow the same traversable paths as actors, never through walls.
MAP.trails=MAP.trails.flatMap(([x,z,tx,tz])=>{
 const from=nearestOpen({x,z},2.6),to=nearestOpen({x:tx,z:tz},2.6);
 if(!from||!to)return[];const route=[from,...findPath(from,to,2.6)];
 return route.slice(1).map((p,i)=>[route[i].x,route[i].z,p.x,p.z]);
});
