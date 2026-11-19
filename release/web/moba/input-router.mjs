// One physical input state across the DOM HUD and the embedded renderer.
// Commands still use native Godot events; this only reconciles held/released state.
export function guardRendererApi(api,current){
 const retiredControls=JSON.stringify({blocked:true,keys:[],pointer:{inside:false,overUI:false,buttons:0}});
 return Object.fromEntries(Object.entries(api).map(([key,fn])=>[key,(...args)=>current()?fn(...args):key==='poll'?'[]':key==='inputState'?retiredControls:key==='ready'?false:undefined]));
}

export function createInputRouter({frame,blocked,onRelease,onCanvasEnter}) {
 const keys=new Set(),pointer={x:.5,y:.5,inside:false,overUI:false,buttons:0};
 const removers=[];let childRemove=()=>{};
 const listen=(target,event,fn,bag=removers)=>{target.addEventListener(event,fn,true);bag.push(()=>target.removeEventListener(event,fn,true));};
 const clear=()=>{keys.clear();pointer.buttons=0;onRelease?.();};
 const move=(e,child=false)=>{
  const r=frame()?.getBoundingClientRect();if(!r?.width||!r.height)return;
  const x=e.clientX+(child?r.left:0),y=e.clientY+(child?r.top:0);
  pointer.x=(x-r.left)/r.width;pointer.y=(y-r.top)/r.height;pointer.width=r.width;pointer.height=r.height;
  pointer.inside=pointer.x>=0&&pointer.x<=1&&pointer.y>=0&&pointer.y<=1&&!document.hidden;
  pointer.overUI=!child&&!!e.target?.closest?.('button,input,select,textarea,dialog,canvas,#chat');
  pointer.overMinimap=!child&&e.target?.id==='minimap';
  pointer.buttons=e.buttons??0;
 };
 const bind=(doc,child,bag)=>{
  for(const event of ['pointermove','pointerdown','pointerup'])listen(doc,event,e=>{
   move(e,child);
   if(event==='pointerdown'&&!child&&pointer.overUI&&!pointer.overMinimap)clear();
  },bag);
  listen(doc,'keydown',e=>{if(!blocked()&&!e.isComposing)keys.add(e.code);},bag);
  listen(doc,'keyup',e=>keys.delete(e.code),bag);
  listen(doc,'pointercancel',clear,bag);
  listen(doc,'mouseout',e=>{if(!e.relatedTarget)pointer.inside=false;},bag);
 };
 bind(document,false,removers);
 listen(window,'blur',()=>queueMicrotask(()=>{if(!document.hasFocus()){pointer.inside=false;clear();}}));
 listen(document,'visibilitychange',()=>{if(document.hidden){pointer.inside=false;clear();}});
 return {
  clear,
  attach(child){childRemove();const bag=[];bind(child.document,true,bag);
   listen(child.document,'pointerover',e=>{if(e.target?.tagName==='CANVAS'&&!blocked())onCanvasEnter?.();},bag);
   listen(child,'blur',()=>{if(document.activeElement!==frame()&&!pointer.overMinimap)clear();},bag);
   childRemove=()=>{for(const fn of bag)fn();};return childRemove;
  },
  snapshot(){return{pointer:{...pointer,inside:pointer.inside&&!document.hidden},keys:[...keys]};},
  dispose(){childRemove();for(const fn of removers)fn();clear();}
 };
}
