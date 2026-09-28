import {promises as fs} from 'node:fs';
import {createRelayRouter} from './relay-router.mjs';
import {DeletedAdventures} from './deleted-adventures.mjs';
import {createGmService,GmError} from './gm-service.mjs';
import {CheckedStore} from './checked-store.mjs';
import {createStoragePolicy,StoragePolicyError} from './storage-policy.mjs';
import {MemberRecords} from './member-records.mjs';
import {onboardingOf,newOnboarding,changeOnboarding} from './onboarding.mjs';
import {applyMemberResetsToState} from '../survival/member-progress.mjs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomBytes,randomUUID,createHash,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';

const scrypt=promisify(scryptCallback),prefix='/api/platform',cookieName='tidal_session';
const copy=value=>structuredClone(value),digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const tokenHash=value=>createHash('sha256').update(value).digest('hex');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
class ApiError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
function requireThat(condition,status,code,message){if(!condition)throw new ApiError(status,code,message);}
function text(value,maximum,fallback='') {const out=typeof value==='string'?value.replace(/[\p{C}]/gu,'').trim():fallback;requireThat([...out].length<=maximum,400,'INVALID_TEXT','文字太长了');return out||fallback;}
function usernameOf(value){const name=text(value,32).normalize('NFKC').toLowerCase();requireThat(/^[\p{L}\p{N}][\p{L}\p{N}_.-]{2,31}$/u.test(name),400,'INVALID_USERNAME','账号用3至32个汉字、字母、数字或下划线');return name;}
function passwordOf(value){requireThat(typeof value==='string'&&value.length>=8&&Buffer.byteLength(value)<=256,400,'INVALID_PASSWORD','密码须至少8个字符且不超过256字节');return value;}
const trainingOf=a=>a.training?.version===1&&['pending','skipped','done'].includes(a.training.status)?{version:1,status:a.training.status}:{version:1,status:onboardingOf(a).status==='done'?'done':'pending'};
const publicAccount=a=>({id:a.id,username:a.username,name:a.name,onboarding:onboardingOf(a),training:trainingOf(a)});

function validateState(state){
  requireThat(plain(state)&&state.schema===3&&typeof state.worldId==='string'&&state.worldId.length>0&&state.worldId.length<=100,400,'INVALID_SNAPSHOT','需要完整的冒险存档');
  requireThat(['PREP','DAY','RETURN','NIGHT','RECOVERY','COMPLETE'].includes(state.phase)&&Number.isFinite(state.time)&&state.time>=0&&Number.isSafeInteger(state.tick)&&state.tick>=0,400,'INVALID_SNAPSHOT','冒险阶段或时钟无效');
  for(const key of ['players','items','containers','buildings','bank'])requireThat(plain(state[key]),400,'INVALID_SNAPSHOT','需要完整的冒险存档');
  let nodes=0;const visit=(value,depth)=>{requireThat(++nodes<=250000&&depth<=48,413,'SNAPSHOT_TOO_LARGE','存档结构太大');if(typeof value==='number')requireThat(Number.isFinite(value),400,'INVALID_SNAPSHOT','存档存在无效数值');if(value&&typeof value==='object')for(const key of Object.keys(value)){requireThat(!['__proto__','prototype','constructor'].includes(key),400,'INVALID_SNAPSHOT','存档结构无效');visit(value[key],depth+1);}};visit(state,0);
  requireThat(Object.values(state.players).filter(p=>p?.connected).length<=8,400,'INVALID_SNAPSHOT','在线人数超出上限');
  const owners=new Set();for(const [id,c]of Object.entries(state.containers)){
    requireThat(plain(c)&&c.id===id&&Number.isSafeInteger(c.slotLimit)&&c.slotLimit>=0&&Array.isArray(c.itemIds)&&c.itemIds.length<=c.slotLimit,400,'INVALID_SNAPSHOT','背包结构无效');
    for(const itemId of c.itemIds){const item=state.items[itemId];requireThat(!owners.has(itemId)&&plain(item)&&item.id===itemId&&item.containerId===id,400,'INVALID_SNAPSHOT','物品归属不一致');owners.add(itemId);}
  }
  for(const [id,item]of Object.entries(state.items))requireThat(owners.has(id)&&Number.isSafeInteger(item.quantity)&&item.quantity>0,400,'INVALID_SNAPSHOT','物品数量或归属无效');
  for(const field of ['credits','materials','reservedCredits','reservedMaterials'])requireThat(Number.isFinite(state.bank[field])&&state.bank[field]>=0,400,'INVALID_SNAPSHOT','队伍资源无效');
}

export async function createPlatformService(options={}){
  if(!options.dataDir)throw Error('Explicit platform dataDir is required');
  const directory=path.resolve(options.dataDir),now=options.now??Date.now,sessionMs=options.sessionMs??12*60*60*1000,hostLeaseMs=options.hostLeaseMs??20000;
  await fs.mkdir(directory,{recursive:true});
  let capacityConfig={};try{capacityConfig=JSON.parse(await fs.readFile(path.join(directory,'capacity-policy.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw Error('Capacity configuration invalid');}
  const roomLimit=options.maxRooms??capacityConfig.maxRooms??8;requireThat(Number.isInteger(roomLimit)&&roomLimit>=1&&roomLimit<=128,500,'INVALID_CAPACITY','房间容量设置无效');
  const {maxRooms:unusedRoomLimit,...storageLimits}=capacityConfig;
  const policy=await createStoragePolicy({directory,limits:{...storageLimits,...options.storageLimits},now,...(options.statfs?{statfs:options.statfs}:{})});
  const storeOptions={policy,platformRoot:directory};
  const indexStore=new CheckedStore(path.join(directory,'index'),storeOptions);let index=await indexStore.load();
  if(!index){index={schema:1,accounts:[],adventures:[]};await indexStore.save(index);}
  if(index.schema!==1||!Array.isArray(index.accounts)||!Array.isArray(index.adventures))throw Error('Invalid platform index');
  const deletions=await new DeletedAdventures(path.join(directory,'deleted-adventures'),storeOptions).load();
  const memberRecords=await new MemberRecords(path.join(directory,'member-resets'),storeOptions).load();
  index.adventures=index.adventures.filter(a=>!deletions.has(a.id)).map(a=>memberRecords.project(a));
  const stores=new Map();for(const a of index.adventures){if(!uuid.test(a.id)||!uuid.test(a.ownerId)||!Number.isSafeInteger(a.epoch))throw Error('Invalid adventure directory');const store=new CheckedStore(path.join(directory,'adventures',a.id),{...storeOptions,summary:true});await store.loadSummary();stores.set(a.id,store);}
  const packagePath=options.wsPackagePath??new URL('../package.json',import.meta.url),{WebSocketServer,WebSocket}=createRequire(packagePath)('ws');
  const wss=new WebSocketServer({noServer:true,maxPayload:65536,perMessageDeflate:false}),sessions=new Map(),connections=new Map(),peers=new Map(),rooms=new Map(),attempts=new Map();
  let stopping=false,stopped=false,stopPromise=null,chain=Promise.resolve(),pendingMutations=0;
  const mutate=fn=>{pendingMutations++;const task=chain.catch(()=>{}).then(fn).finally(()=>pendingMutations--);chain=task.catch(()=>{});return task;};
  const mutateRequest=fn=>{requireThat(pendingMutations<64,503,'PLATFORM_BUSY','服务器正在保存，请稍后重试');return mutate(()=>{requireThat(!stopping,503,'STOPPING','平台正在停止');return fn();});};
  const saveIndex=async(next,writeOptions={})=>{const projected={...next,adventures:next.adventures.filter(a=>!deletions.has(a.id)).map(a=>memberRecords.project(a))};await indexStore.save(projected,writeOptions);index=projected;};
  const creationAttempts=new Map();
  function creationRate(id){let row=creationAttempts.get(id);if(!row||now()-row.at>=60000){row={at:now(),count:0};creationAttempts.set(id,row);}requireThat(++row.count<=10,429,'CREATE_RATE_LIMIT','新进度建立太快，请稍后再试');}
  function resetPayload(r){const a=index.adventures.find(a=>a.id===r.adventureId);return {memberResets:a?memberRecords.entries(a):[],memberResetVersion:r.memberResetVersion??0};}
  function resetChanged(r){r.memberResetVersion=(r.memberResetVersion??0)+1;send(peers.get(r.hostPeerId),{type:'member_resets',roomId:r.id,epoch:r.epoch,...resetPayload(r)});}
  async function capacityFor(accountId){const s=await policy.status();return {progressUsed:index.adventures.filter(a=>a.ownerId===accountId||a.members.includes(accountId)).length,progressLimit:policy.limits.adventuresPerAccount,roomLimit,roomsUsed:rooms.size,warnings:s.warnings,message:s.warnings.length?'服务器存储空间偏紧，请整理不用的进度。':''};}
  function originAllowed(req){try{const origin=new URL(req.headers.origin);if(!['http:','https:'].includes(origin.protocol)||origin.host!==req.headers.host)return false;if(options.allowedOrigins&&!options.allowedOrigins.includes(origin.origin))return false;return true;}catch{return false;}}
  function getSession(req){const cookie=String(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);if(!cookie||!/^[-_A-Za-z0-9]{43}$/.test(cookie))return null;const key=tokenHash(cookie),session=sessions.get(key);if(!session||session.expiresAt<=now())return null;const account=index.accounts.find(a=>a.id===session.accountId);return account?{key,session,account}:null;}
  function requireSession(req){const auth=getSession(req);requireThat(auth,401,'AUTH_REQUIRED','请先登录');return auth;}
  function setCookie(res,req,value,maxAge){res.setHeader('Set-Cookie',`${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${options.secureCookies||req.socket.encrypted?'; Secure':''}`);}
  function issueSession(account,res,req){const token=randomBytes(32).toString('base64url'),key=tokenHash(token);sessions.set(key,{accountId:account.id,expiresAt:now()+sessionMs});setCookie(res,req,token,Math.floor(sessionMs/1000));}
  function send(c,value){if(!c||c.ws.readyState!==WebSocket.OPEN)return false;if(c.ws.bufferedAmount>2*1024*1024){c.ws.close(4008,'Client too slow');return false;}c.ws.send(JSON.stringify(value));return true;}
  function publicRoom(r){return {id:r.id,mode:r.mode??'adventure',missionStart:r.missionStart??null,adventureId:r.adventureId,title:r.title,solo:r.solo,status:r.status,ownerId:r.ownerId,hostPeerId:r.hostPeerId,epoch:r.epoch,maxPlayers:8,members:[...r.members.values()].map(m=>({peerId:m.peerId,accountId:m.accountId,name:m.name,ready:m.ready}))};}
  function publicRooms(){return [...rooms.values()].filter(r=>!r.solo).map(publicRoom);}
  function lobbyChanged(){const value={type:'rooms',rooms:publicRooms()};for(const c of connections.values())send(c,value);}
  function roomChanged(r){const value={type:'room',room:publicRoom(r)};for(const m of r.members.values()){const c=peers.get(m.peerId);if(c)send(c,value);}lobbyChanged();}
  function closeRoom(r,reason='closed'){if(!rooms.has(r.id))return;rooms.delete(r.id);gm.closeRoom(r.id);for(const m of r.members.values()){const c=peers.get(m.peerId);if(c){c.roomId=null;send(c,{type:'room',room:null,reason});}}r.members.clear();if(r.adventureId)stores.get(r.adventureId)?.unload();lobbyChanged();}
  function leave(c,reason='left'){const room=rooms.get(c.roomId);if(!room){c.roomId=null;return;}if(room.hostPeerId===c.peerId){closeRoom(room,reason);return;}room.members.delete(c.peerId);c.roomId=null;send(c,{type:'room',room:null,reason});roomChanged(room);}
  function disconnect(c,reason='disconnected'){if(connections.get(c.accountId)!==c)return;leave(c,reason);connections.delete(c.accountId);peers.delete(c.peerId);}
  function connectionFor(auth){requireThat(sessions.get(auth.key)?.expiresAt>now(),401,'AUTH_REQUIRED','请先登录');const c=connections.get(auth.account.id);requireThat(c&&c.sessionKey===auth.key&&c.ws.readyState===WebSocket.OPEN,409,'SIGNAL_REQUIRED','请先连接大厅');return c;}
  function requireLiveRoom(r){if(r.status==='running'&&r.leaseExpiresAt<=now()){closeRoom(r,'host_timeout');throw new ApiError(409,'LEASE_EXPIRED','房主连接已过期，冒险已暂停');}}
  function roomForHost(auth,id){const c=connectionFor(auth),r=rooms.get(id);requireThat(r&&r.ownerId===auth.account.id&&r.hostPeerId===c.peerId&&c.roomId===r.id,403,'HOST_REQUIRED','只有当前冒险创建者可以执行');if(r.status==='running'&&r.leaseExpiresAt<=now()){closeRoom(r,'host_timeout');throw new ApiError(409,'LEASE_EXPIRED','房主连接已过期，冒险已暂停');}return {c,r};}
  function adventureFor(auth,id){requireThat(uuid.test(id),404,'NOT_FOUND','没有找到冒险');const a=index.adventures.find(a=>a.id===id&&!deletions.has(a.id));requireThat(a,404,'NOT_FOUND','没有找到冒险');return a;}
  function publicAdventure(a){const active=[...rooms.values()].find(r=>r.adventureId===a.id),saved=stores.get(a.id)?.summary;return {id:a.id,title:a.title,ownerId:a.ownerId,createdAt:a.createdAt,updatedAt:saved?.savedAt??a.createdAt,revision:saved?.revision??0,status:active?.status??'paused',roomId:active?.id??null,dayIndex:saved?.dayIndex??1,phase:saved?.phase??'PREP',daysSurvived:saved?.daysSurvived??0};}
  function authRate(req){const key=req.socket.remoteAddress??'local',time=now();let row=attempts.get(key);if(!row||time-row.at>60000){row={at:time,count:0};attempts.set(key,row);}requireThat(++row.count<=30,429,'RATE_LIMIT','请求过快，请稍后重试');}
  async function readBody(req,maximum){let length=0;const chunks=[];for await(const chunk of req){length+=chunk.length;requireThat(length<=maximum,413,'BODY_TOO_LARGE','请求内容太大');chunks.push(chunk);}if(!length)return {};let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ApiError(400,'INVALID_JSON','消息格式无效');}requireThat(plain(value),400,'INVALID_JSON','消息格式无效');return value;}
  function reply(res,status,value){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(value));}
  function safeError(error){return error instanceof ApiError||error instanceof GmError||error instanceof StoragePolicyError?{status:error.status,error:{code:error.code,message:error.message}}:{status:500,error:{code:'PLATFORM_ERROR',message:'平台操作未完成，请重试；现有存档已保留'}};}
  const gm=await createGmService({directory,now,sessionActive:c=>connections.get(c.accountId)===c&&sessions.get(c.sessionKey)?.expiresAt>now(),getPeer:id=>peers.get(id),getSaved:r=>stores.get(r.adventureId)?.current,send});
  async function routes(req,res,url){
    const method=req.method,pathname=url.pathname;requireThat(!stopping,503,'STOPPING','平台正在停止');
    if(!['GET','HEAD'].includes(method))requireThat(originAllowed(req),403,'ORIGIN_REJECTED','请求来源无效');
    if(pathname===prefix+'/register'&&method==='POST'){
      authRate(req);const body=await readBody(req,4096),username=usernameOf(body.username),password=passwordOf(body.password),name=text(body.name,18,username),salt=randomBytes(16).toString('hex');
      const hash=(await scrypt(password,Buffer.from(salt,'hex'),32,{N:16384,r:8,p:1,maxmem:64*1024*1024})).toString('hex');
      await mutateRequest(async()=>{requireThat(!index.accounts.some(a=>a.username===username),409,'USERNAME_TAKEN','账号已存在');const account={id:randomUUID(),username,name,salt,hash,createdAt:now(),onboarding:newOnboarding(),training:{version:1,status:'pending'}},next=copy(index);next.accounts.push(account);await saveIndex(next);issueSession(account,res,req);reply(res,201,{account:publicAccount(account)});});return;
    }
    if(pathname===prefix+'/login'&&method==='POST'){
      authRate(req);const body=await readBody(req,4096),username=usernameOf(body.username),password=passwordOf(body.password),account=index.accounts.find(a=>a.username===username),salt=account?.salt??'00'.repeat(16);
      const derived=await scrypt(password,Buffer.from(salt,'hex'),32,{N:16384,r:8,p:1,maxmem:64*1024*1024});
      requireThat(account&&/^[a-f0-9]{64}$/.test(account.hash)&&timingSafeEqual(derived,Buffer.from(account.hash,'hex')),401,'INVALID_LOGIN','账号或密码不正确');requireThat(!stopping,503,'STOPPING','平台正在停止');issueSession(account,res,req);reply(res,200,{account:publicAccount(index.accounts.find(a=>a.id===account.id))});return;
    }
    const auth=requireSession(req);
    if(pathname===prefix+'/me'&&method==='GET'){reply(res,200,{account:publicAccount(auth.account)});return;}
    if(pathname===prefix+'/training'&&method==='POST'){
      const body=await readBody(req,256);requireThat(['skip','complete'].includes(body.action)&&Object.keys(body).length===1,400,'INVALID_TRAINING','入职操作无效');
      await mutateRequest(async()=>{
        requireThat(sessions.get(auth.key)?.expiresAt>now(),401,'AUTH_REQUIRED','请先登录');
        const current=index.accounts.find(a=>a.id===auth.account.id),prior=trainingOf(current);
        if(body.action==='complete'&&prior.status!=='done'){
          const c=connectionFor(auth),r=rooms.get(c.roomId);
          requireThat(r?.mode==='mission'&&r.status==='running'&&r.missionStart==='tutorial'&&r.members.has(c.peerId),409,'TRAINING_ROOM_REQUIRED','请先完成入职任务');
        }
        const status=body.action==='complete'?'done':prior.status==='done'?'done':'skipped';
        if(current.training?.version!==1||current.training.status!==status){const next=copy(index);next.accounts.find(a=>a.id===current.id).training={version:1,status};await saveIndex(next);}
        reply(res,200,{training:{version:1,status}});
      });return;
    }
    if(pathname===prefix+'/onboarding'&&method==='GET'){reply(res,200,{onboarding:onboardingOf(auth.account)});return;}
    if(pathname===prefix+'/onboarding'&&method==='POST'){
      const body=await readBody(req,512);
      await mutateRequest(async()=>{
        requireThat(sessions.get(auth.key)?.expiresAt>now(),401,'AUTH_REQUIRED','请先登录');
        const next=copy(index),target=next.accounts.find(a=>a.id===auth.account.id);
        try {target.onboarding=changeOnboarding(target,body);}
        catch(error){if(error.code==='GUIDE_CHANGED')throw new ApiError(409,error.code,'引导进度已更新');if(error.code==='INVALID_GUIDE')throw new ApiError(400,error.code,'引导操作无效');throw error;}
        if(target.onboarding.revision!==onboardingOf(index.accounts.find(a=>a.id===auth.account.id)).revision)await saveIndex(next);
        reply(res,200,{onboarding:onboardingOf(target)});
      });return;
    }
    if(pathname===prefix+'/logout'&&method==='POST'){await mutateRequest(async()=>{sessions.delete(auth.key);const c=connections.get(auth.account.id);if(c?.sessionKey===auth.key){disconnect(c,'logout');c.ws.close(1000,'Logged out');}setCookie(res,req,'',0);reply(res,200,{loggedOut:true});});return;}
    if(pathname===prefix+'/adventures'&&method==='GET'){reply(res,200,{adventures:index.adventures.filter(a=>a.ownerId===auth.account.id||a.members.includes(auth.account.id)).map(publicAdventure),capacity:await capacityFor(auth.account.id)});return;}
    if(pathname===prefix+'/adventures'&&method==='POST'){const body=await readBody(req,4096),title=text(body.title,40,'新的冒险');await mutateRequest(async()=>{requireThat(sessions.get(auth.key)?.expiresAt>now(),401,'AUTH_REQUIRED','请先登录');creationRate(auth.account.id);const a={id:randomUUID(),ownerId:auth.account.id,title,members:[auth.account.id],epoch:0,createdAt:now()},next=copy(index);next.adventures.push(a);await saveIndex(next,{kind:'create',accountId:auth.account.id,getAdventures:()=>index.adventures});const store=new CheckedStore(path.join(directory,'adventures',a.id),{...storeOptions,summary:true});stores.set(a.id,store);reply(res,201,{adventure:publicAdventure(a)});});return;}
    if(pathname===prefix+'/rooms'&&method==='GET'){reply(res,200,{rooms:publicRooms()});return;}
    if(pathname===prefix+'/rooms'&&method==='POST'){
      const body=await readBody(req,4096);await mutateRequest(async()=>{const c=connectionFor(auth);
        if(body.mode==='mission'){
          requireThat(['tutorial','free'].includes(body.missionStart),400,'INVALID_MISSION','任务入口无效');
          requireThat(body.missionStart!=='tutorial'||body.solo!==false,400,'INVALID_MISSION','入职任务请单人完成');
          requireThat(!c.roomId,409,'ALREADY_IN_ROOM','请先离开当前房间');requireThat(rooms.size<roomLimit,409,'ROOM_LIMIT','同时游玩的房间已满，请稍后再开');
          const r={id:randomUUID(),mode:'mission',missionStart:body.missionStart,adventureId:null,title:body.missionStart==='tutorial'?'入职任务':'自由试用',solo:body.solo!==false,status:'waiting',ownerId:c.accountId,hostPeerId:c.peerId,epoch:1,members:new Map(),leaseExpiresAt:now()+hostLeaseMs,memberResetVersion:0};
          r.members.set(c.peerId,{peerId:c.peerId,accountId:c.accountId,name:c.name,ready:false});c.roomId=r.id;rooms.set(r.id,r);roomChanged(r);reply(res,201,{room:publicRoom(r)});return;
        }
        const a=adventureFor(auth,String(body.adventureId??'')),title=text(body.title,40,a.title);requireThat(a.ownerId===auth.account.id,403,'OWNER_REQUIRED','只有创建者可以继续此冒险');requireThat(!c.roomId,409,'ALREADY_IN_ROOM','请先离开当前房间');requireThat(![...rooms.values()].some(r=>r.adventureId===a.id),409,'ADVENTURE_ACTIVE','此冒险已经有运行中的房间');requireThat(rooms.size<roomLimit,409,'ROOM_LIMIT','同时游玩的房间已满，请稍后再开');
        const store=stores.get(a.id);await store.load();const next=copy(index),updated=next.adventures.find(x=>x.id===a.id);updated.epoch++;try{await saveIndex(next);}catch(error){store.unload();throw error;}
        const r={id:randomUUID(),mode:'adventure',adventureId:a.id,title,solo:body.solo===true,status:'waiting',ownerId:a.ownerId,hostPeerId:c.peerId,epoch:updated.epoch,members:new Map(),leaseExpiresAt:now()+hostLeaseMs,memberResetVersion:0};
        r.members.set(c.peerId,{peerId:c.peerId,accountId:c.accountId,name:c.name,ready:false});c.roomId=r.id;rooms.set(r.id,r);roomChanged(r);reply(res,201,{room:publicRoom(r)});
      });return;
    }
    const deleted=pathname.match(/^\/api\/platform\/adventures\/([a-f0-9-]+)$/);
    if(deleted&&method==='DELETE'){
      await mutateRequest(async()=>{
        requireThat(sessions.get(auth.key)?.expiresAt>now(),401,'AUTH_REQUIRED','请先登录');
        const a=adventureFor(auth,deleted[1]);
        if(a.ownerId!==auth.account.id){
          requireThat(a.members.includes(auth.account.id),403,'OWNER_REQUIRED','你没有这份个人进度');
          const active=[...rooms.values()].find(r=>r.adventureId===a.id);
          requireThat(!active||![...active.members.values()].some(m=>m.accountId===auth.account.id),409,'LEAVE_FIRST','请先退出这个房间，再删除个人进度');
          await memberRecords.mark(a.id,auth.account.id,now());
          index={...index,adventures:index.adventures.map(row=>memberRecords.project(row))};
          try{await saveIndex(index);}catch{/* The durable member tombstone already committed this deletion. */}
          if(active)resetChanged(active);lobbyChanged();
          reply(res,200,{deleted:true,id:a.id,scope:'personal'});return;
        }
        requireThat(![...rooms.values()].some(r=>r.adventureId===a.id),409,'ADVENTURE_ACTIVE','请先结束此冒险的房间，再删除进度');
        // The checked durable marker is the commit point. A crash or failure
        // while compacting the index cannot bring this adventure back.
        await deletions.mark(a.id,now());
        const next={...index,adventures:index.adventures.filter(x=>x.id!==a.id)};
        index=next;stores.delete(a.id);
        try{await saveIndex(next);}catch{/* durable deletion remains committed */}
        reply(res,200,{deleted:true,id:a.id});
      });return;
    }
    const gmAction=pathname.match(/^\/api\/platform\/rooms\/([a-f0-9-]+)\/gm\/(verify|complete|fail)$/);
    if(gmAction&&method==='POST'){
      const body=await readBody(req,4096);await mutateRequest(async()=>{const c=connectionFor(auth),r=rooms.get(gmAction[1]);requireThat(r,404,'NOT_FOUND','房间已关闭');requireThat(r.mode!=='mission',403,'NOT_AVAILABLE','任务模式请使用试用台');requireLiveRoom(r);reply(res,200,gm.route(c,r,gmAction[2],body));});return;
    }
    const action=pathname.match(/^\/api\/platform\/rooms\/([a-f0-9-]+)\/(join|leave|start|close|heartbeat)$/);
    if(action&&method==='POST'){
      const body=await readBody(req,4096);await mutateRequest(async()=>{const c=connectionFor(auth),r=rooms.get(action[1]);requireThat(r,404,'NOT_FOUND','房间已关闭');requireLiveRoom(r);
        if(action[2]==='join'){
          if(c.roomId===r.id){reply(res,200,{room:publicRoom(r)});return;}requireThat(!c.roomId,409,'ALREADY_IN_ROOM','请先离开当前房间');requireThat(!r.solo,403,'SOLO_ROOM','单人房间不能加入');requireThat(r.members.size<8,409,'ROOM_FULL','当前在线人数已满');
          if(r.mode!=='mission'){const next=copy(index),a=next.adventures.find(a=>a.id===r.adventureId);if(!a.members.includes(c.accountId)){creationRate(c.accountId);a.members.push(c.accountId);a.memberGenerations??={};a.memberGenerations[c.accountId]=memberRecords.generation(a.id,c.accountId);await saveIndex(next,{kind:'join',accountId:c.accountId,getAdventures:()=>index.adventures});if(a.memberGenerations[c.accountId]>0)resetChanged(r);}}
          r.members.set(c.peerId,{peerId:c.peerId,accountId:c.accountId,name:c.name,ready:r.status==='running'});c.roomId=r.id;roomChanged(r);reply(res,200,{room:publicRoom(r)});return;
        }
        if(action[2]==='leave'){requireThat(c.roomId===r.id,403,'NOT_MEMBER','你不在此房间');requireThat(r.hostPeerId!==c.peerId,409,'HOST_MUST_CLOSE','房主请先保存并关闭房间');leave(c,'left');reply(res,200,{left:true});return;}
        roomForHost(auth,r.id);
        if(action[2]==='heartbeat'){requireThat(body.epoch===r.epoch,409,'STALE_HOST','房间已改变，请重新加入');r.leaseExpiresAt=now()+hostLeaseMs;c.alive=true;reply(res,200,{ok:true});return;}
        if(action[2]==='start'){requireThat(r.status==='waiting',409,'ALREADY_RUNNING','房间已经开始');requireThat([...r.members.values()].every(m=>m.ready),409,'NOT_READY','请等待所有队员准备');r.status='running';r.leaseExpiresAt=now()+hostLeaseMs;roomChanged(r);reply(res,200,{room:publicRoom(r)});return;}
        const revision=r.mode==='mission'?0:stores.get(r.adventureId)?.current?.revision??0;if(body.finalRevision!==undefined)requireThat(body.finalRevision===revision,409,'REVISION_CONFLICT','最后存档尚未确认');closeRoom(r,'host_closed');reply(res,200,{closed:true,revision});
      });return;
    }
    const snapshot=pathname.match(/^\/api\/platform\/adventures\/([a-f0-9-]+)\/snapshot$/);
    if(snapshot&&['GET','PUT'].includes(method)){
      const body=method==='PUT'?await readBody(req,4*1024*1024):null;
      await mutateRequest(async()=>{const a=adventureFor(auth,snapshot[1]),active=[...rooms.values()].find(r=>r.adventureId===a.id);requireThat(active,409,'HOST_REQUIRED','请先创建此冒险的房间');const {r,c}=roomForHost(auth,active.id),store=stores.get(a.id),saved=store.current;
        if(method==='GET'){const state=copy(saved?.state??null);if(state)applyMemberResetsToState(state,memberRecords.entries(a));reply(res,200,{adventure:publicAdventure(a),revision:saved?.revision??0,head:saved?{hostEpoch:saved.hostEpoch,saveSeq:saved.saveSeq}:null,state,epoch:r.epoch,...resetPayload(r)});return;}
        requireThat(body.roomId===r.id&&body.hostEpoch===r.epoch,409,'STALE_HOST','房主授权已更新');requireThat(Number.isSafeInteger(body.saveSeq)&&body.saveSeq>0&&Number.isSafeInteger(body.baseRevision)&&body.baseRevision>=0,400,'INVALID_SAVE','存档序号无效');validateState(body.state);const requestChecksum=digest(body.state);
        if(saved?.hostEpoch===r.epoch&&saved.saveSeq===body.saveSeq){requireThat((saved.requestChecksum??saved.checksum)===requestChecksum,409,'SAVE_REPLAY_MISMATCH','同一存档序号不能提交不同内容');r.leaseExpiresAt=now()+hostLeaseMs;c.alive=true;reply(res,200,{saved:true,revision:saved.revision,saveSeq:saved.saveSeq,...resetPayload(r)});return;}
        applyMemberResetsToState(body.state,memberRecords.entries(a));validateState(body.state);const checksum=digest(body.state);
        requireThat(body.baseRevision===(saved?.revision??0),409,'REVISION_CONFLICT','存档版本已更新，请重新同步');requireThat(!saved||saved.hostEpoch!==r.epoch||body.saveSeq>saved.saveSeq,409,'STALE_SAVE','存档序号已经过期');
        if(saved)requireThat(body.state.worldId===saved.state.worldId&&body.state.time>=saved.state.time&&body.state.tick>=saved.state.tick,409,'WORLD_REWIND','不能用其他冒险或较旧进度覆盖存档');
        const next={revision:(saved?.revision??0)+1,hostEpoch:r.epoch,saveSeq:body.saveSeq,savedAt:now(),checksum,requestChecksum,state:body.state};await store.save(next,{kind:'save'});r.leaseExpiresAt=now()+hostLeaseMs;c.alive=true;reply(res,200,{saved:true,revision:next.revision,saveSeq:next.saveSeq,...resetPayload(r)});
      });return;
    }
    throw new ApiError(404,'NOT_FOUND','没有找到接口');
  }
  async function handleRequest(req,res){let url;try{url=new URL(req.url,'http://local');}catch{return false;}if(url.pathname!==prefix&&!url.pathname.startsWith(prefix+'/'))return false;try{await routes(req,res,url);}catch(error){const out=safeError(error);if(!res.headersSent)reply(res,out.status,{error:out.error});else res.end();}return true;}
  const relayRouter=createRelayRouter({now,getRoom:id=>rooms.get(id),getPeer:id=>peers.get(id),isCurrent:c=>connections.get(c.accountId)===c,sessionActive:c=>sessions.get(c.sessionKey)?.expiresAt>now(),isStopping:()=>stopping,limits:options.relayLimits});
  wss.on('connection',(ws,req,auth)=>{
    if(pendingMutations>=64){ws.close(1013,'Platform busy');return;}
    void mutate(async()=>{
      if(ws.readyState!==WebSocket.OPEN)return;
      if(stopping||!sessions.has(auth.key)||sessions.get(auth.key).expiresAt<=now()){ws.close(4003,'Session expired');return;}
      const previous=connections.get(auth.account.id);if(previous){disconnect(previous,'session_replaced');previous.ws.close(4001,'Session replaced');}
      const c={ws,accountId:auth.account.id,name:auth.account.name,peerId:randomUUID(),sessionKey:auth.key,roomId:null,alive:true,rateAt:now(),rateCount:0,chatAt:-Infinity};connections.set(c.accountId,c);peers.set(c.peerId,c);
      send(c,{type:'session',self:{peerId:c.peerId,accountId:c.accountId,name:c.name}});send(c,{type:'rooms',rooms:publicRooms()});
      ws.on('pong',()=>{c.alive=true;});ws.on('error',()=>{});ws.on('close',()=>{void mutate(async()=>disconnect(c,'disconnected'));});
      ws.on('message',raw=>{
        // Relay is synchronous and room-authorized, and must not wait behind fs
        // snapshot writes or share the 60/s signaling/chat command quota.
        if(!stopping&&connections.get(c.accountId)===c){try{const candidate=JSON.parse(raw);if(relayRouter.handle(c,candidate))return;}catch{}}
        // Admission runs before queuing so a slow durable write cannot let
        // signaling messages accumulate without bound behind it.
        if(now()-c.rateAt>1000){c.rateAt=now();c.rateCount=0;}
        if(++c.rateCount>60){send(c,{type:'error',code:'RATE_LIMIT',message:'消息过快'});return;}
        if(pendingMutations>=64){send(c,{type:'error',code:'PLATFORM_BUSY',message:'服务器正在保存，请稍后重试'});return;}
        void mutate(async()=>{
        if(stopping||connections.get(c.accountId)!==c)return;let message;try{message=JSON.parse(raw);}catch{send(c,{type:'error',code:'INVALID_JSON',message:'消息格式无效'});return;}
        try{requireThat(plain(message),400,'INVALID_JSON','消息格式无效');const r=rooms.get(c.roomId);requireThat(r,409,'NOT_IN_ROOM','请先加入房间');requireLiveRoom(r);
          if(message.type==='heartbeat'){requireThat(c.peerId===r.hostPeerId&&message.roomId===r.id&&message.epoch===r.epoch,403,'HOST_REQUIRED','房主授权无效');r.leaseExpiresAt=now()+hostLeaseMs;return;}
          if(message.type==='ready'){requireThat(r.status==='waiting'&&typeof message.ready==='boolean',409,'INVALID_READY','当前不能修改准备状态');r.members.get(c.peerId).ready=message.ready;roomChanged(r);return;}
          if(message.type==='signal'){const target=peers.get(message.to);requireThat(target&&target.peerId!==c.peerId&&target.roomId===r.id&&r.members.has(target.peerId),403,'NOT_MEMBER','信令对象不在同一房间');requireThat(c.peerId===r.hostPeerId||target.peerId===r.hostPeerId,403,'INVALID_TOPOLOGY','当前只允许房主与队员直连');requireThat(plain(message.data)&&Buffer.byteLength(JSON.stringify(message.data))<=24576,400,'INVALID_SIGNAL','信令内容无效');send(target,{type:'signal',from:c.peerId,roomId:r.id,epoch:r.epoch,data:message.data});return;}
          if(message.type==='chat'){if(gm.chat(c,r,message))return;requireThat(now()-c.chatAt>=300,429,'RATE_LIMIT','发言太快');const content=text(message.text,300);requireThat(content.length>0,400,'INVALID_TEXT','消息不能为空');c.chatAt=now();const entry={id:randomUUID(),roomId:r.id,from:{peerId:c.peerId,accountId:c.accountId,name:c.name},text:content,at:now()};for(const m of r.members.values())send(peers.get(m.peerId),{type:'chat',message:entry});return;}
          throw new ApiError(400,'INVALID_MESSAGE','不支持的消息');
        }catch(error){const out=safeError(error);send(c,{type:'error',...out.error});}
      });});
    }).catch(()=>ws.close(1011,'Platform error'));
  });
  function handleUpgrade(req,socket,head){let url;try{url=new URL(req.url,'http://local');}catch{return false;}if(url.pathname!=='/platform/signal')return false;const auth=getSession(req);if(stopping||!originAllowed(req)||!auth){socket.end(`HTTP/1.1 ${auth?'403 Forbidden':'401 Unauthorized'}\r\nConnection: close\r\n\r\n`);return true;}wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req,auth));return true;}
  let lastMaintenance=now(),maintenanceJob=null,maintenanceResult=null;
  async function maintain(){
    if(stopping||maintenanceJob)return maintenanceJob;
    lastMaintenance=now();maintenanceJob=(async()=>{
      await policy.inventory();
      maintenanceResult=await policy.cleanupDeleted({activeAdventureIds:()=>new Set(index.adventures.map(a=>a.id))});
      for(const [id,row]of creationAttempts)if(now()-row.at>=60000)creationAttempts.delete(id);
      return maintenanceResult;
    })().catch(()=>{maintenanceResult={failed:true,code:'STORAGE_MAINTENANCE_FAILED'};}).finally(()=>maintenanceJob=null);return maintenanceJob;
  }
  let lastPing=now();async function sweep(){if(stopping)return;await mutate(async()=>{const time=now();for(const [key,s]of sessions)if(s.expiresAt<=time){sessions.delete(key);const c=connections.get(s.accountId);if(c?.sessionKey===key){disconnect(c,'session_expired');c.ws.close(4003,'Session expired');}}for(const r of [...rooms.values()])if(r.status==='running'&&r.leaseExpiresAt<=time)closeRoom(r,'host_timeout');for(const [key,row]of attempts)if(time-row.at>120000)attempts.delete(key);if(time-lastPing>=10000){lastPing=time;for(const c of [...connections.values()]){if(!c.alive){disconnect(c,'disconnected');c.ws.terminate();}else {c.alive=false;c.ws.ping();}}}});}
  const timer=options.manualClock?null:setInterval(()=>{void sweep().catch(()=>{});if(now()-lastMaintenance>=900000)void maintain();},1000);timer?.unref();
  async function stop(){if(stopped)return;if(stopPromise)return stopPromise;stopping=true;clearInterval(timer);stopPromise=(async()=>{if(maintenanceJob)await maintenanceJob;await mutate(async()=>{for(const r of [...rooms.values()])closeRoom(r,'platform_stopping');for(const c of connections.values())c.ws.close(1001,'Platform stopping');});await new Promise(resolve=>{const timeout=setTimeout(()=>{for(const ws of wss.clients)ws.terminate();resolve();},250);wss.close(()=>{clearTimeout(timeout);resolve();});});sessions.clear();stopped=true;})();return stopPromise;}
  const service={handleRequest,handleUpgrade,stop,status:()=>({service:'tidal-platform',ready:!stopping&&!stopped,rooms:rooms.size,online:connections.size,roomLimit,storage:{adventures:index.adventures.length,cachedWorlds:[...stores.values()].filter(s=>s.loaded).length,maintenance:maintenanceResult}})};if(options.manualClock){service.sweep=sweep;service.maintain=maintain;}return service;
}
