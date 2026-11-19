// The browser owns capture. A Godot mouse mode or a successful API call alone
// cannot prove that movement is still reaching the canvas.
export function createPointerGuard({child,button,state,deliver}) {
 const doc=child.document,top=child.parent,disposers=[];
 const consumedButtons=new Set();
 let disposed=false,signature='',blocked=false,locked=false,pending=false,consumeUntil=0;
 let retryAt=0,retryTimer=null,lastPointerLock=false,resumeGeneration=0;
 function cooldown(milliseconds){
  retryAt=performance.now()+milliseconds;clearTimeout(retryTimer);
  retryTimer=setTimeout(()=>{retryTimer=null;sync();},milliseconds+10);
 }
 const canvas=()=>doc.getElementById('canvas');
 const visible=()=>doc.visibilityState!=='hidden'&&top.document.visibilityState!=='hidden';
 function sync(){
  if(disposed)return;
  const s=state();locked=!!canvas()&&doc.pointerLockElement===canvas();
  blocked=!!s.enabled&&s.overlay===''&&(!visible()||!doc.hasFocus()||(s.capture&&!locked));
  button.classList.toggle('hidden',!blocked||!visible());
  button.disabled=pending||performance.now()<retryAt;
  button.textContent=pending?'正在恢复':performance.now()<retryAt?'稍后重试':'继续游戏';
  const value=JSON.stringify({type:'platform_pointer',blocked,locked});
  if(signature!==value){signature=value;deliver(value);}
 }
 function request(capture=true){
  if(disposed)return;
  const desired=state();capture=capture&&desired.enabled&&desired.capture;
  const element=canvas();if(!element)return;
  // A real return gesture supersedes any blur/unlock notification queued
  // while the player was clicking the browser recovery button.
  if(desired.enabled&&desired.overlay==='')resumeGeneration++;
  element.focus();child.focus();
  // Acquire in the original click/key event, before a queued engine message.
  // A refusal leaves the recovery button available for the next real gesture.
  if(capture&&doc.pointerLockElement!==element&&!pending&&performance.now()>=retryAt){
   pending=true;
   cooldown(250);
   try{const result=element.requestPointerLock();result?.then?.(()=>{pending=false;sync();},()=>{pending=false;cooldown(1100);sync();});}
   catch{pending=false;cooldown(1100);sync();}
  }
  sync();
 }
 function resume(){
  const s=state();if(!s.enabled||s.overlay!=='')return;
  consumeUntil=performance.now()+200;request(s.capture);
 }
 function listen(target,event,fn,options){target.addEventListener(event,fn,options);disposers.push(()=>target.removeEventListener(event,fn,options));}
 // Escape is also the browser's unlock gesture and can be withheld from the
 // canvas. Both routes carry the previous overlay, making them idempotent.
 const escapeFrom=overlay=>deliver(JSON.stringify({type:'platform_escape',overlay,generation:resumeGeneration}));
 const pauseWhenAway=()=>{
  if(disposed)return;
  const s=state();
  if(s.enabled&&s.overlay===''&&(!visible()||!doc.hasFocus()))escapeFrom('');
 };
 for(const target of [doc,top.document])for(const event of ['keydown','keyup'])listen(target,event,e=>{
  const s=state();
  if(e.key!=='Escape'||!s.enabled||s.overlay==='chat')return;
  e.preventDefault();e.stopImmediatePropagation();
  if(event==='keydown'&&!e.repeat)escapeFrom(s.overlay);
 },true);
 listen(doc,'pointerlockchange',()=>{
  const wasLocked=lastPointerLock;
  lastPointerLock=!!canvas()&&doc.pointerLockElement===canvas();
  pending=false;sync();
  const s=state();
  // A pending request can finish after a menu has opened. Never leave a menu
  // with its cursor captured by that older request.
  if(lastPointerLock&&(!s.enabled||!s.capture||s.overlay!==''))doc.exitPointerLock();
  if(wasLocked&&!lastPointerLock&&s.enabled&&s.capture&&s.overlay==='')escapeFrom('');
 });
 listen(doc,'pointerlockerror',()=>{pending=false;cooldown(1100);sync();});
 const cancelGesture=()=>{consumedButtons.clear();consumeUntil=performance.now()+200;};
 listen(doc,'pointercancel',cancelGesture,true);
 for(const target of [child,top])listen(target,'blur',cancelGesture);
 for(const target of [doc,top.document])listen(target,'visibilitychange',()=>{sync();pauseWhenAway();});
 for(const target of [child,top])for(const event of ['focus','blur'])listen(target,event,()=>{sync();if(event==='blur')queueMicrotask(pauseWhenAway);});
 // Swallow the complete recovery gesture, including mouseup after lock succeeds.
 // The click that regains the camera must never fire or consume a quick item.
 for(const event of ['pointerdown','pointerup','mousedown','mouseup','click','contextmenu'])listen(doc,event,e=>{
  if((event==='pointerup'||event==='mouseup')&&consumedButtons.has(e.button)){
   consumedButtons.delete(e.button);consumeUntil=performance.now()+200;
   e.preventDefault();e.stopImmediatePropagation();return;
  }
  if(e.target!==canvas())return;
  sync();
  if(!blocked&&!consumedButtons.has(e.button)&&performance.now()>=consumeUntil)return;
  e.preventDefault();e.stopImmediatePropagation();
  if(event==='pointerdown'||event==='mousedown')consumedButtons.add(e.button);
  if(event==='click'||event==='contextmenu')consumedButtons.delete(e.button);
  // Cancelling pointerdown can suppress its compatibility mousedown entirely.
  if(blocked&&(event==='pointerdown'||event==='mousedown')&&e.button===0)resume();
 },true);
 listen(button,'click',resume);
 sync();
 return {sync,request,escapeCurrent:generation=>!disposed&&generation===resumeGeneration,diagnostics:()=>({blocked,locked,pending}),dispose(){disposed=true;clearTimeout(retryTimer);consumedButtons.clear();for(const remove of disposers)remove();button.classList.add('hidden');}};
}
