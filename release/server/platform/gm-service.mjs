import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export class GmError extends Error {
 constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
const requireThat=(condition,status,code,message)=>{if(!condition)throw new GmError(status,code,message);};
const normalize=value=>typeof value==='string'?value.normalize('NFKC').trim():'';
export const isGmCommand=value=>/^\/gm(?:\s|$)/i.test(normalize(value));
const help='GM仅供测试。/gm 零件 100000；/gm 金币 100000；/gm 资源 100000（两种各加）。资源全队共享并随当前冒险保存。数量1—1000000；失败用 /gm 重试。';
export function parseGmCommand(value){
 const parts=normalize(value).split(/\s+/);requireThat(parts[0]?.toLowerCase()==='/gm'&&parts.length<=3,400,'GM_SYNTAX','格式：/gm 零件 100000。输入 /gm 查看帮助。');
 const action=(parts[1]??'help').toLowerCase();
 if(['help','帮助','?'].includes(action)&&parts.length<=2)return {kind:'help'};
 if(['retry','重试'].includes(action)&&parts.length===2)return {kind:'retry'};
 const names={credits:'credits',money:'credits',金币:'credits',经费:'credits',materials:'materials',parts:'materials',零件:'materials',材料:'materials',resources:'both',all:'both',资源:'both'};
 const resource=Object.hasOwn(names,action)?names[action]:null;
 requireThat(resource&&/^\d{1,7}$/.test(parts[2]??''),400,'GM_SYNTAX','格式：/gm 零件 100000。输入 /gm 查看帮助。');
 const amount=Number(parts[2]);requireThat(Number.isSafeInteger(amount)&&amount>=1&&amount<=1000000,400,'GM_AMOUNT','数量须为1—1000000的整数。');
 return {kind:'grant',resources:{credits:resource==='materials'?0:amount,materials:resource==='credits'?0:amount}};
}

// Permissions are held in the protected platform data directory, never in the
// web package or player save. Nicknames and request-supplied roles are ignored.
export async function createGmService({directory,now,sessionActive,getPeer,getSaved,send}){
 let ids=[];
 try{
  const access=JSON.parse(await readFile(path.join(directory,'gm-resources.json'),'utf8'));
  if(access.schema!==1||!Array.isArray(access.accountIds)||access.accountIds.length>16||new Set(access.accountIds).size!==access.accountIds.length||!access.accountIds.every(id=>typeof id==='string'&&uuid.test(id)))throw Error('Invalid GM access file');
  ids=access.accountIds;
 }catch(error){if(error.code!=='ENOENT')throw Error('GM access configuration is invalid; no permissions granted');}
 const allowed=new Set(ids),rooms=new Map();
 function roomRecords(room){let value=rooms.get(room.id);if(!value){value={grants:new Map(),requests:new Map(),last:new Map(),rates:new Map()};rooms.set(room.id,value);}return value;}
 function current(c,r){requireThat(sessionActive(c),401,'AUTH_REQUIRED','登录已过期，请重新登录。');requireThat(c.roomId===r.id&&r.members.get(c.peerId)?.accountId===c.accountId,403,'GM_MEMBER','请先重新加入当前房间。');}
 function authorized(c,r){current(c,r);requireThat(allowed.has(c.accountId),403,'GM_FORBIDDEN','此账号没有GM权限。');}
 function notice(c,r,text,status){send(c,{type:'gm_notice',roomId:r.id,epoch:r.epoch,text,status});}
 function existingReceipt(r,grant){
  const rows=getSaved(r)?.state?.gmGrants;if(!Array.isArray(rows))return null;
  const row=rows.find(x=>x?.id===grant.id);if(!row)return null;
  return row.roomId===grant.roomId&&row.epoch===grant.epoch&&row.accountId===grant.accountId&&row.peerId===grant.peerId&&row.hostPeerId===grant.hostPeerId&&row.resources?.credits===grant.resources.credits&&row.resources?.materials===grant.resources.materials?row:null;
 }
 function saved(c,r,entry){entry.status='saved';notice(c,r,`已保存：全队经费 +${entry.grant.resources.credits}，零件 +${entry.grant.resources.materials}。`,'saved');}
 function dispatch(c,r,entry){
  const host=getPeer(r.hostPeerId);requireThat(host&&sessionActive(host),409,'GM_HOST_OFFLINE','房主未连接，请稍后重试。');
  requireThat(entry.grant.peerId===c.peerId,409,'GM_SESSION_CHANGED','连接已改变，请先核对当前资源。旧指令不会重新发放。');
  if(existingReceipt(r,entry.grant)){saved(c,r,entry);return;}
  entry.expiresAt=now()+120000;entry.status='pending';
  requireThat(send(host,{type:'gm_grant',roomId:r.id,epoch:r.epoch,grantId:entry.grant.id}),409,'GM_HOST_OFFLINE','房主未连接，请稍后重试。');
  notice(c,r,'正在补充资源，等待保存确认…','pending');
 }
 function chat(c,r,message){
  if(!isGmCommand(message.text))return false;
  try{
   authorized(c,r);const command=parseGmCommand(message.text);
   if(command.kind==='help'){notice(c,r,help,'help');return true;}
   requireThat(r.status==='running',409,'GM_NOT_STARTED','请先开始并进入游戏。');
   const records=roomRecords(r),priorAt=records.rates.get(c.accountId)??-Infinity;
   requireThat(now()-priorAt>=1000,429,'GM_RATE_LIMIT','请等1秒再发指令。');records.rates.set(c.accountId,now());
   if(command.kind==='retry'){
    const entry=records.grants.get(records.last.get(c.accountId));requireThat(entry,404,'GM_NOT_FOUND','当前房间没有可重试的GM指令。');dispatch(c,r,entry);return true;
   }
   requireThat(typeof message.gmRequestId==='string'&&/^[A-Za-z0-9_-]{16,80}$/.test(message.gmRequestId),400,'GM_REQUEST_ID','请刷新到最新版后重试。');
   const key=c.accountId+':'+message.gmRequestId,previous=records.grants.get(records.requests.get(key));
   if(previous){requireThat(JSON.stringify(previous.grant.resources)===JSON.stringify(command.resources),409,'GM_REQUEST_MISMATCH','同一请求不能改成其他数量。');dispatch(c,r,previous);return true;}
   requireThat(records.grants.size<512,429,'GM_ROOM_LIMIT','本房间测试指令已达上限，请保存后重新开房。');
   const grant={id:randomUUID(),roomId:r.id,epoch:r.epoch,hostPeerId:r.hostPeerId,peerId:c.peerId,accountId:c.accountId,resources:command.resources};
   const entry={grant,status:'pending',expiresAt:now()+120000};records.grants.set(grant.id,entry);records.requests.set(key,grant.id);records.last.set(c.accountId,grant.id);dispatch(c,r,entry);
  }catch(error){notice(c,r,error instanceof GmError?error.message:'GM操作未完成，请重试。','error');}
  return true;
 }
 function route(c,r,action,body){
  current(c,r);requireThat(c.peerId===r.hostPeerId&&c.accountId===r.ownerId&&body.epoch===r.epoch,403,'GM_HOST_REQUIRED','只有当前房主可以确认GM发放。');
  const entry=rooms.get(r.id)?.grants.get(body.grantId);requireThat(entry&&entry.grant.epoch===r.epoch,404,'GM_NOT_FOUND','发放请求已失效。');
  const requester=getPeer(entry.grant.peerId);requireThat(requester&&requester.accountId===entry.grant.accountId,403,'GM_MEMBER','操作者已经离开。');authorized(requester,r);
  if(action==='verify'){
   requireThat(r.status==='running'&&entry.expiresAt>=now(),409,'GM_EXPIRED','发放请求已过期，请输入 /gm 重试。');
   return {grant:structuredClone(entry.grant)};
  }
  if(action==='complete'){
   requireThat(existingReceipt(r,entry.grant),409,'GM_NOT_SAVED','资源尚未保存，请输入 /gm 重试。');saved(requester,r,entry);return {ok:true};
  }
  if(action==='fail'){
   if(existingReceipt(r,entry.grant)){saved(requester,r,entry);return {ok:true};}
   const errors={GM_BALANCE_LIMIT:'共享资源已达上限，请先使用一些资源。',GM_GRANT_LIMIT:'本房间测试指令已达上限，请保存后重新开房。',GM_NOT_READY:'请先进入游戏，随后输入 /gm 重试。',GM_NOT_MEMBER:'请先进入当前房间，随后输入 /gm 重试。',GM_BUSY:'正在保存进度，请稍后输入 /gm 重试。',GM_REPLAY_MISMATCH:'该请求内容不一致，已停止发放。'};
   entry.status='retry';notice(requester,r,Object.hasOwn(errors,body.code??'')?errors[body.code]:'尚未确认保存。输入 /gm 重试；同一请求不会重复加资源。','error');return {ok:true};
  }
  throw new GmError(404,'GM_NOT_FOUND','没有找到接口。');
 }
 return {chat,route,closeRoom:id=>rooms.delete(id)};
}
