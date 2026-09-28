// Bounded, private steering cache. Navigation never moves or damages an actor.
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const finitePoint=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.z);

class Heap {
  a=[];
  push(v){const a=this.a;let i=a.length;a.push(v);while(i){const p=(i-1)>>1;if(a[p].f<=v.f)break;a[i]=a[p];i=p;}a[i]=v;}
  pop(){const a=this.a,top=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1].f<a[c].f)c++;if(a[c].f>=last.f)break;a[i]=a[c];i=c;}a[i]=last;}return top;}
  get length(){return this.a.length;}
}

export class EnemyNavigation {
  constructor({canTraverse,projectPoint=p=>({...p}),allowPoint=()=>true,
    cellSize=1.5,searchRadius=18,maxExpanded=192,maxTraversals=768,
    maxSearchesPerTick=1,maxImmediateChecksPerTick=64,maxRecords=128,
    retrySeconds=1,pathSeconds=4,goalTolerance=1.5,arrival=.25}={}) {
    if(typeof canTraverse!=='function')throw Error('NAV_TRAVERSE_REQUIRED');
    const values={cellSize,searchRadius,maxExpanded,maxTraversals,maxSearchesPerTick,maxImmediateChecksPerTick,maxRecords,retrySeconds,pathSeconds,goalTolerance,arrival};
    if(Object.values(values).some(x=>!Number.isFinite(x)||x<=0)||searchRadius<cellSize*2)throw Error('NAV_OPTIONS');
    for(const key of ['maxExpanded','maxTraversals','maxSearchesPerTick','maxImmediateChecksPerTick','maxRecords'])if(!Number.isSafeInteger(values[key]))throw Error('NAV_OPTIONS');
    Object.assign(this,values,{canTraverse,projectPoint,allowPoint});this.records=new Map();this.tick=null;
    this.stats={tick:null,searches:0,expanded:0,traversals:0,immediateChecks:0};
  }
  forget(id){this.records.delete(id);}
  clear(){this.records.clear();}
  invalidate(id){const r=this.records.get(id);if(r){r.path=[];r.retryAt=0;}}
  beginTick(tick){if(tick!==this.tick){this.tick=tick;this.stats={tick,searches:0,expanded:0,traversals:0,immediateChecks:0};}}
  next({enemy,goal,goalKey='',geometryRevision=0,tick,now,allowPoint=this.allowPoint,isGoal=null,finishPoint=null}) {
    if(!enemy?.id||!finitePoint(enemy)||!finitePoint(goal)||!Number.isFinite(enemy.radius)||enemy.radius<=0||!Number.isSafeInteger(tick)||!Number.isFinite(now))throw Error('NAV_QUERY');
    this.beginTick(tick);
    let r=this.records.get(enemy.id);
    if(!r){
      if(this.records.size>=this.maxRecords){const oldest=[...this.records].reduce((a,b)=>a[1].seenAt<=b[1].seenAt?a:b);this.records.delete(oldest[0]);}
      r={path:[],retryAt:0,seenAt:now,goal:{...goal},goalKey,geometryRevision,radius:enemy.radius};this.records.set(enemy.id,r);
    }
    r.seenAt=now;
    if(r.goalKey!==goalKey||r.geometryRevision!==geometryRevision||r.radius!==enemy.radius||distance(r.goal,goal)>this.goalTolerance||now<r.lastNow){
      r.path=[];r.retryAt=0;r.goal={...goal};r.goalKey=goalKey;r.geometryRevision=geometryRevision;r.radius=enemy.radius;
    }
    r.lastNow=now;
    if(distance(enemy,goal)<=this.arrival||isGoal?.(enemy))return {status:'arrived',waypoint:null};
    const project=p=>{const q=this.projectPoint({...p},enemy);return finitePoint(q)?q:null;};
    const allowed=p=>p&&allowPoint(p,enemy);
    const immediate=(a,b)=>{
      if(this.stats.immediateChecks>=this.maxImmediateChecksPerTick)return null;
      this.stats.immediateChecks++;
      return allowed(b)&&this.canTraverse(a,b,enemy.radius,enemy);
    };
    if(now>=r.pathUntil)r.path=[];
    // Corner tolerance must not cut through a narrow door post. Skip an
    // almost-reached turn only when the entire shortcut to the next is clear.
    while(r.path.length>1&&distance(enemy,r.path[0])<=this.arrival){
      const shortcut=immediate(enemy,r.path[1]);
      if(shortcut===null)return {status:'wait',waypoint:null,reason:'CHECK_BUDGET'};
      if(!shortcut)break;
      r.path.shift();
    }
    if(r.path.length===1&&distance(enemy,r.path[0])<=1e-6)r.path.shift();
    if(r.path.length){
      const valid=immediate(enemy,r.path[0]);
      if(valid===null)return {status:'wait',waypoint:null,reason:'CHECK_BUDGET'};
      if(valid)return {status:'path',waypoint:{...r.path[0]}};
      r.path=[];r.retryAt=0;
    }
    if(now<r.retryAt)return {status:'unreachable',waypoint:null,retryAt:r.retryAt};
    const fullDistance=distance(enemy,goal),range=this.searchRadius-this.cellSize;
    const localGoal=project(fullDistance>range?{x:enemy.x+(goal.x-enemy.x)*range/fullDistance,z:enemy.z+(goal.z-enemy.z)*range/fullDistance}:goal);
    const direct=localGoal?immediate(enemy,localGoal):false;
    if(direct===null)return {status:'wait',waypoint:null,reason:'CHECK_BUDGET'};
    if(direct)return {status:'direct',waypoint:localGoal};
    if(this.stats.searches>=this.maxSearchesPerTick)return {status:'wait',waypoint:null,reason:'SEARCH_BUDGET'};
    this.stats.searches++;
    const result=this.search(enemy,localGoal??goal,project,allowed,isGoal,finishPoint);
    if(result.path.length){r.path=result.path;r.pathUntil=now+this.pathSeconds;return {status:'path',waypoint:{...r.path[0]},partial:result.partial};}
    r.retryAt=now+this.retrySeconds;
    return {status:'unreachable',waypoint:null,retryAt:r.retryAt,reason:result.reason};
  }
  search(start,goal,project,allowed,isGoal=null,finishPoint=null){
    const heap=new Heap(),nodes=new Map(),step=this.cellSize,startH=distance(start,goal),limit=this.searchRadius**2;
    const first={key:'0,0',i:0,j:0,p:{...start},g:0,h:startH,f:startH,parent:null,closed:false};
    nodes.set(first.key,first);heap.push(first);let best=first,expanded=0,traversals=0,finished=null,endpoint=null,exhausted=false;
    const edge=(a,b)=>{
      if(traversals>=this.maxTraversals){exhausted=true;return false;}
      traversals++;return this.canTraverse(a,b,start.radius,start);
    };
    while(heap.length&&expanded<this.maxExpanded&&!exhausted){
      const queued=heap.pop(),current=nodes.get(queued.key);
      if(current.closed||queued.g!==current.g)continue;
      current.closed=true;expanded++;
      if(current.h<best.h)best=current;
      if(isGoal?isGoal(current.p):current.h<=step*1.5&&allowed(goal)&&edge(current.p,goal)){finished=current;break;}
      // A grid need not land exactly inside a narrow attack region. Validate
      // one short final edge to its reachable boundary, within the same budget.
      if(isGoal&&finishPoint){
        const point=finishPoint(current.p);
        if(finitePoint(point)&&allowed(point)&&isGoal(point)&&edge(current.p,point)){finished=current;endpoint=point;break;}
      }
      for(const [di,dj] of [[0,1],[1,0],[0,-1],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]]){
        const i=current.i+di,j=current.j+dj;if((i*step)**2+(j*step)**2>limit)continue;
        const key=`${i},${j}`,known=nodes.get(key);if(known?.closed)continue;
        const g=current.g+Math.hypot(di,dj)*step;if(known&&g>=known.g)continue;
        const p=known?.p??project({x:start.x+i*step,z:start.z+j*step});if(!allowed(p)||!edge(current.p,p))continue;
        const h=distance(p,goal),node={key,i,j,p,g,h,f:g+h,parent:current,closed:false};nodes.set(key,node);heap.push(node);
      }
    }
    this.stats.expanded+=expanded;this.stats.traversals+=traversals;
    // A bounded partial route must make real progress. Never disguise failure
    // as a waypoint at the actor's current position or an unchecked teleport.
    // If the reachable local component has been exhausted, approaching its
    // closed wall is not progress. Partial paths are only a search-budget
    // continuation; a proved local dead end receives the retry cooldown.
    const limited=exhausted||expanded>=this.maxExpanded;
    const end=finished??(limited&&best.h<startH-step*.5?best:null),path=[];
    for(let n=end;n?.parent;n=n.parent)path.push({...n.p});path.reverse();
    if(finished&&!isGoal&&(!path.length||distance(path.at(-1),goal)>.001))path.push({...goal});
    if(endpoint)path.push({...endpoint});
    return {path,partial:!finished,reason:exhausted||expanded>=this.maxExpanded?'SEARCH_LIMIT':'NO_ROUTE'};
  }
}
