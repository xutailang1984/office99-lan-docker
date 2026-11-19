// Keep download, engine startup and room connection visible as separate steps.
export function createLoadingUI({element,back,transport}) {
 const title=element.querySelector('b'),detail=element.querySelector('small');
 const bar=element.querySelector('progress'),exit=element.querySelector('button');
 const spinner=element.querySelector('.spinner');
 let active=false,started=0,timer=null,download=null,engine=false,warming=false,error='',errorTitle='游戏没能打开';
 exit.onclick=()=>Promise.resolve(back()).catch(()=>{detail.textContent='还没有保存成功，请稍后再试。';});
 function render(){
  if(!active)return;
  const elapsed=(performance.now()-started)/1000,state=transport();
  if(state.failed)error='没能连上房主，请回大厅再加入。';
  exit.classList.remove('hidden');
  spinner?.classList.toggle('hidden',!!error);
  if(error){title.textContent=errorTitle;detail.textContent=error;bar.hidden=true;return;}
  if(download&&download.current<download.total){const ratio=download.current/download.total;title.textContent='正在下载游戏 '+Math.floor(ratio*100)+'%';detail.textContent=(download.current/1048576).toFixed(1)+' / '+(download.total/1048576).toFixed(1)+' MB';bar.hidden=false;bar.value=ratio*100;}
  else if(!engine){title.textContent=download?'正在打开游戏':'正在下载游戏';detail.textContent=download?'首次打开需要准备画面，请稍候。':'正在获取园区和游戏资源…';bar.hidden=!download;if(download)bar.value=100;}
  else if(warming){title.textContent='正在准备画面';detail.textContent='首次进入会多等一会，准备好后战斗更顺畅。';bar.hidden=true;}
  else if(!state.ready){title.textContent='正在连接房主';detail.textContent=state.relay?'正在通过大厅连接，请稍候。':'正在寻找可用连接，连不上会自动换条路。';bar.hidden=true;}
  else {title.textContent='正在同步园区';detail.textContent='连接已建立，正在接收最新进度。';bar.hidden=true;}
  if(elapsed>=120){title.textContent='准备时间有些长';detail.textContent='可以先回大厅再加入。已保存的进度会保留。';exit.classList.remove('hidden');}
 }
 return {
  start(){active=true;started=performance.now();download=null;engine=false;warming=false;error='';errorTitle='游戏没能打开';element.classList.remove('hidden');clearInterval(timer);timer=setInterval(render,500);render();},
  report(value){if(!active||!value||typeof value!=='object')return;if(value.phase==='download'&&Number.isFinite(value.current)&&Number.isFinite(value.total)&&value.total>0)download={current:Math.max(0,value.current),total:value.total};else if(value.phase==='engine')engine=true;else if(value.phase==='warmup')warming=true;else if(value.phase==='error')error='请检查网络，或用新版 Chrome / Edge 重试。';render();},
  fail(message,heading='游戏没能打开'){error=message;errorTitle=heading;active=true;element.classList.remove('hidden');clearInterval(timer);render();},
  loaded(){active=false;clearInterval(timer);element.classList.add('hidden');},
  stop(){active=false;clearInterval(timer);},
  status(){return {active,engine,downloadPercent:download?Math.floor(100*download.current/download.total):0,error:!!error};},
 };
}
