// Account inventory is private to this authenticated lobby; public room cards
// never carry inventory or wallet data.
import {mountCollection} from './collection-ui.mjs';
export function installCareerUI({api,current,onChanged=()=>{}}){
 const button=document.createElement('button');button.className='secondary hidden';button.textContent='我的物资';button.id='career-open';
 document.getElementById('logout').before(button);
 const dialog=document.createElement('dialog');dialog.id='career-dialog';dialog.setAttribute('aria-labelledby','career-title');dialog.style.width='min(520px,calc(100vw - 32px))';dialog.style.height='360px';
 dialog.innerHTML='<div class="dialog-header"><h2 id="career-title">我的物资</h2><button type="button" class="icon-action" aria-label="关闭">×</button></div><div class="dialog-body" style="overflow:auto;min-height:190px;max-height:220px"><b class="resume-summary"></b><p class="muted"></p><p></p><div class="form-error" role="status"></div></div><div class="dialog-actions"><button type="button" class="secondary">返回</button><button type="button" class="primary danger hidden">放弃携带</button></div>';
 document.body.append(dialog);
 const [heading,back,abandon]=dialog.querySelectorAll('button'),summary=dialog.querySelector('b'),detail=dialog.querySelector('.muted'),inventory=detail.nextElementSibling,error=dialog.querySelector('.form-error');let profile=null,confirming=false,busy=false,refreshSequence=0;
 const collection=mountCollection(dialog.querySelector('.dialog-body'));
 heading.onclick=back.onclick=()=>{if(!busy)dialog.close();};
 function render(){
  const c=profile?.capsule;collection.render(c?.collection);summary.textContent=profile?.holding?'携带物留在冒险中':'物资已归存，可加入其他冒险';
  detail.textContent=confirming?'放弃后，随身装备和背包物品留在原冒险。个人仓库、金币和已学配方保留。':'在据点或仓库附近保存离开，可带着装备加入朋友。野外退出后，先回原冒险续玩。';
  inventory.textContent=c?`个人：${c.wallet.credits} 金币 · ${c.wallet.materials} 零件　仓库：${c.vault.length} / 32　背包：${c.backpack.length} / ${c.bagSlots}`:'';
  abandon.classList.toggle('hidden',!profile?.holding);abandon.textContent=confirming?'确认放弃':'放弃携带';abandon.disabled=busy;back.disabled=busy;heading.disabled=busy;
 }
 async function refresh(){
  const sequence=++refreshSequence,accountId=current().account?.id;
  if(!accountId||current().room){button.classList.add('hidden');profile=null;return;}
  try{const value=await api('career');if(sequence!==refreshSequence||current().account?.id!==accountId||current().room)return;profile=value;button.classList.remove('hidden');if(dialog.open)render();}catch(e){if(sequence!==refreshSequence)return;profile=null;button.classList.add('hidden');if(dialog.open)error.textContent=e.message;}
 }
 button.onclick=async()=>{if(current().room)return;confirming=false;collection.reset();error.textContent='';await refresh();if(profile){render();dialog.showModal();back.focus();}};
 abandon.onclick=async()=>{if(!confirming){confirming=true;render();return;}busy=true;error.textContent='';render();try{profile=await api('career/abandon',{method:'POST',body:{careerRevision:profile.revision}});confirming=false;await onChanged();}catch(e){error.textContent=e.message;}finally{busy=false;render();}};
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 return {refresh,hide:()=>{++refreshSequence;profile=null;button.classList.add('hidden');dialog.close();}};
}
