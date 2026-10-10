import {collectionOf} from '../survival/social-config.mjs';
import {validateDisplays} from '../survival/social-activities.mjs';
import {promises as fs} from 'node:fs';
import {createRelayRouter} from './relay-router.mjs';
import {DeletedAdventures} from './deleted-adventures.mjs';
import {createGmService,GmError} from './gm-service.mjs';
import {CheckedStore} from './checked-store.mjs';
import {createStoragePolicy,StoragePolicyError} from './storage-policy.mjs';
import {MemberRecords} from './member-records.mjs';
import {onboardingOf,newOnboarding,changeOnboarding} from './onboarding.mjs';
import {applyMemberResetsToState} from '../survival/member-progress.mjs';
import {Careers,CareerError} from './careers.mjs';
import {extractCareerCapsule,stripCareerPlayer,safeCareerExit} from '../survival/career-state.mjs';
import {loadConfig} from '../survival/config.mjs';
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
  try{for(const p of Object.values(state.players))collectionOf(p.collection);if(state.social?.displays)validateDisplays(state.worldId,state.social.displays);}catch{requireThat(false,400,'INVALID_SNAPSHOT','收藏格式无效');}
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
  const economyVersion=options.economyVersion??capacityConfig.economyVersion??0;
  requireThat([0,1].includes(economyVersion),500,'INVALID_ECONOMY','个人成长配置无效');
  const {maxRooms:unusedRoomLimit,economyVersion:unusedEconomyVersion,...storageLimits}=capacityConfig;
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
  let careers=null,careerConfig=null;
  if(economyVersion===1){careerConfig=options.config??await loadConfig(new URL('../../client/survival/balance.json',import.meta.url));careers=await new Careers({directory,storeOptions,config:careerConfig,getWorldStore:id=>stores.get(id),now}).load();}
  let stopping=false,stopped=false,stopPromise=null,chain=Promise.resolve(),pendingMutations=0;
  const mutate=fn=>{pendingMutations++;const task=chain.catch(()=>{}).then(async()=>{await careers?.recover();return fn();}).finally(()=>pendingMutations--);chain=task.catch(()=>{});return task;};
  const mutateRequest=fn=>{requireThat(pendingMutations<64,503,'PLATFORM_BUSY','服务器正在保存，请稍后重试');return mutate(()=>{requireThat(!stopping,503,'STOPPING','平台正在停止');return fn();});};
  const saveIndex=async(next,writeOptions={})=>{const projected={...next,adventures:next.adventures.filter(a=>!deletions.has(a.id)).map(a=>memberRecords.project(a))};await indexStore.save(projected,writeOptions);index=projected;};
  const creationAttempts=new Map(),transferReceipts=new Map();
  function creationRate(id){let row=creationAttempts.get(id);if(!row||now()-row.at>=60000){row={at:now(),count:0};creationAttempts.set(id,row);}requireThat(++row.count<=10,429,'CREATE_RATE_LIMIT','新进度建立太快，请稍后再试');}
  function resetPayload(r){const a=index.adventures.find(a=>a.id===r.adventureId);return {memberResets:a?memberRecords.entries(a):[],memberResetVersion:r.memberResetVersion??0};}
  function careerPayload(r){return careers&&r.mode!=='mission'?{economyVersion,economyEpoch:careers.epoch(r.adventureId),careerBindings:[...r.members.values()].map(m=>careers.binding(m.accountId,r.adventureId)).filter(Boolean)}:{};}
  function projectCareers(state,adventureId){if(!careers||!state)return state;for(const p of Object.values(state.players??{})){const accountId=p.tokenHash?.startsWith('account:')?p.tokenHash.slice(8):null;if(!accountId)continue;const row=careers.binding(accountId,adventureId);if(!row||row.revision!==p.careerRevision)stripCareerPlayer(state,accountId);}return state;}
  function careerCheckpoints(state,adventureId){if(!careers)return [];const rows=[];for(const p of Object.values(state.players??{})){const accountId=p.tokenHash?.startsWith('account:')?p.tokenHash.slice(8):null;if(accountId&&careers.binding(accountId,adventureId)?.revision===p.careerRevision)rows.push(careers.checkpoint(accountId,adventureId,p.careerRevision,extractCareerCapsule(state,accountId)));}return rows;}
  async function abandonCareer(accountId){
    const prior=careers.row(accountId);requireThat(prior?.holding,409,'CAREER_NOT_HELD','没有需要取回的个人进度');
    const adventureId=prior.holding.adventureId,active=[...rooms.values()].find(r=>r.adventureId===adventureId);
    requireThat(!active,409,'ADVENTURE_ACTIVE','请先回原房间归存；房间关闭后可放弃随身物品');
    const row=careers.abandoned(accountId),store=stores.get(adventureId),saved=store?await store.load():null,nextEpoch=careers.epoch(adventureId)+1;
    let snapshot=null;if(saved){const state=copy(saved.state);stripCareerPlayer(state,accountId,{dropCarried:true});state.economyEpoch=nextEpoch;validateState(state);snapshot={...saved,revision:saved.revision+1,savedAt:now(),checksum:digest(state),requestChecksum:null,state,economyEpoch:nextEpoch};}
    await careers.commit({adventureId,snapshot,profiles:[row],economyEpoch:nextEpoch});
    return careers.publicRow(accountId);
  }
  function resetChanged(r){r.memberResetVersion=(r.memberResetVersion??0)+1;send(peers.get(r.hostPeerId),{type:'member_resets',roomId:r.id,epoch:r.epoch,...resetPayload(r)});}
  async function capacityFor(accountId){const s=await policy.status();return {progressUsed:index.adventures.filter(a=>a.ownerId===accountId||a.members.includes(accountId)).length,progressLimit:policy.limits.adventuresPerAccount,roomLimit,roomsUsed:rooms.size,warnings:s.warnings,message:s.warnings.length?'服务器存储空间偏紧，请整理不用的进度。':''};}
  function originAllowed(req){try{const origin=new URL(req.headers.origin);if(!['http:','https:'].includes(origin.protocol)||origin.host!==req.headers.host)return false;if(options.allowedOrigins&&!options.allowedOrigins.includes(origin.origin))return false;return true;}catch{return false;}}
  function getSession(req){const cookie=String(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);if(!cookie||!/^[-_A-Za-z0-9]{43}$/.test(cookie))return null;const key=tokenHash(cookie),session=sessions.get(key);if(!session||session.expiresAt<=now())return null;const account=index.accounts.find(a=>a.id===session.accountId);return account?{key,session,account}:null;}
  function requireSession(req){const auth=getSession(req);requireThat(auth,401,'AUTH_REQUIRED','请先登录');return auth;}
  function setCookie(res,req,value,maxAge){res.setHeader('Set-Cookie',`${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${options.secureCookies||req.socket.encrypted?'; Secure':''}`);}
  function issueSession(account,res,req){const token=randomBytes(32).toString('base64url'),key=tokenHash(token);sessions.set(key,{accountId:account.id,expiresAt:now()+sessionMs});setCookie(res,req,token,Math.floor(sessionMs/1000));}
  function send(c,value){if(!c||c.ws.readyState!==WebSocket.OPEN)return false;if(c.ws.bufferedAmount>2*1024*1024){c.ws.close(4008,'Client too slow');return false;}c.ws.send(JSON.stringify(value));return true;}
  function publicRoom(r){return {id:r.id,mode:r.mode??'adventure',missionStart:r.missionStart??null,adventureId:r.adventureId,title:r.title,solo:r.solo,status:r.status,ownerId:r.ownerId,hostPeerId:r.hostPeerId,epoch:r.epoch,hostGeneration:r.hostGeneration??0,...(careers&&r.mode!=='mission'?{economyVersion}:{}),maxPlayers:8,members:[...r.members.values()].map(m=>({peerId:m.peerId,accountId:m.accountId,name:m.name,ready:m.ready}))};}
  function publicRooms(){return [...rooms.values()].filter(r=>!r.solo).map(publicRoom);}
  function lobbyChanged(){const value={type:'rooms',rooms:publicRooms()};for(const c of connections.values())send(c,value);}
  function roomChanged(r){const value={type:'room',room:publicRoom(r)};for(const m of r.members.values()){const c=peers.get(m.peerId);if(c)send(c,value);}lobbyChanged();}
  function closeRoom(r,reason='closed'){if(!rooms.has(r.id))return;rooms.delete(r.id);gm.closeRoom(r.id);for(const m of r.members.values()){const c=peers.get(m.peerId);if(c){c.roomId=null;send(c,{type:'room',room:null,reason});}}r.members.clear();if(r.adventureId)stores.get(r.adventureId)?.unload();lobbyChanged();}
  async function transferHost(r,c,reason='host_disconnected'){
    if(!rooms.has(r.id)||r.hostPeerId!==c.peerId)return;
    const resume=r.resumeStatus??r.status;
    r.members.delete(c.peerId);c.roomId=null;
    send(c,{type:'room',room:null,reason});
    const saved=r.mode==='mission'?r.missionSnapshot:stores.get(r.adventureId)?.current;
    const eligible=[...r.members.values()].filter(m=>{
      const p=peers.get(m.peerId);return p&&p.ws.readyState===WebSocket.OPEN&&connections.get(p.accountId)===p&&sessions.get(p.sessionKey)?.expiresAt>now()&&p.canHost!==false;
    }).sort((a,b)=>Number(peers.get(a.peerId)?.hidden===true)-Number(peers.get(b.peerId)?.hidden===true));
    if(!eligible.length||(resume==='running'&&!saved?.state)){closeRoom(r,!eligible.length?'host_closed':'handoff_no_checkpoint');return;}
    // Fence the former writer before any await. A migration always starts from
    // the checked platform snapshot, never a peer's speculative local branch.
    r.status='migrating';r.resumeStatus=resume;r.hostPeerId=eligible[0].peerId;
    r.epoch++;r.hostGeneration=(r.hostGeneration??0)+1;r.migrationDeadline=now()+45000;r.leaseExpiresAt=r.migrationDeadline;
    gm.closeRoom(r.id);
    if(r.adventureId){
      const next=copy(index),a=next.adventures.find(a=>a.id===r.adventureId);a.epoch=r.epoch;a.delegated=true;
      try{await saveIndex(next);}catch(error){closeRoom(r,'handoff_save_failed');throw error;}
    }
    roomChanged(r);
  }
  async function leave(c,reason='left'){const room=rooms.get(c.roomId);if(!room){c.roomId=null;return;}if(room.hostPeerId===c.peerId){await transferHost(room,c,reason);return;}room.members.delete(c.peerId);c.roomId=null;send(c,{type:'room',room:null,reason});roomChanged(room);}
  async function disconnect(c,reason='disconnected'){if(connections.get(c.accountId)!==c)return;await leave(c,reason);connections.delete(c.accountId);peers.delete(c.peerId);}
  function connectionFor(auth){requireThat(sessions.get(auth.key)?.expiresAt>now(),401,'AUTH_REQUIRED','请先登录');const c=connections.get(auth.account.id);requireThat(c&&c.sessionKey===auth.key&&c.ws.readyState===WebSocket.OPEN,409,'SIGNAL_REQUIRED','请先连接大厅');return c;}
  async function requireLiveRoom(r){if((r.status==='running'&&r.leaseExpiresAt<=now())||(r.status==='migrating'&&r.migrationDeadline<=now())){const c=peers.get(r.hostPeerId);if(c)await transferHost(r,c,'host_timeout');else closeRoom(r,'host_timeout');throw new ApiError(409,'LEASE_EXPIRED','正在接替主机，请稍候');}}
  async function roomForHost(auth,id){const c=connectionFor(auth),r=rooms.get(id);requireThat(r&&r.hostPeerId===c.peerId&&r.members.has(c.peerId)&&c.roomId===r.id,403,'HOST_REQUIRED','只有当前运行主机可以执行');await requireLiveRoom(r);requireThat(r.hostPeerId===c.peerId,409,'STALE_HOST','运行主机已变更');return {c,r};}
  function adventureFor(auth,id){requireThat(uuid.test(id),404,'NOT_FOUND','没有找到冒险');const a=index.adventures.find(a=>a.id===id&&!deletions.has(a.id));requireThat(a,404,'NOT_FOUND','没有找到冒险');return a;}
  function publicAdventure(a){const active=[...rooms.values()].find(r=>r.adventureId===a.id),saved=stores.get(a.id)?.summary;return {id:a.id,...(a.economyVersion?{economyVersion:a.economyVersion}:{}),title:a.title,ownerId:a.ownerId,createdAt:a.createdAt,updatedAt:saved?.savedAt??a.createdAt,revision:saved?.revision??0,status:active?.status??'paused',roomId:active?.id??null,dayIndex:saved?.dayIndex??1,phase:saved?.phase??'PREP',daysSurvived:saved?.daysSurvived??0};}
  function authRate(req){const key=req.socket.remoteAddress??'local',time=now();let row=attempts.get(key);if(!row||time-row.at>60000){row={at:time,count:0};attempts.set(key,row);}requireThat(++row.count<=30,429,'RATE_LIMIT','请求过快，请稍后重试');}
  async function readBody(req,maximum){let length=0;const chunks=[];for await(const chunk of req){length+=chunk.length;requireThat(length<=maximum,413,'BODY_TOO_LARGE','请求内容太大');chunks.push(chunk);}if(!length)return {};let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ApiError(400,'INVALID_JSON','消息格式无效');}requireThat(plain(value),400,'INVALID_JSON','消息格式无效');return value;}
  function reply(res,status,value){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(value));}
  function safeError(error){return error instanceof ApiError||error instanceof GmError||error instanceof StoragePolicyError||error instanceof CareerError?{status:error.status,error:{code:error.code,message:error.message}}:{status:500,error:{code:'PLATFORM_ERROR',message:'平台操作未完成，请重试；现有存档已保留'}};}
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
    if(pathname===prefix+'/career'&&method==='GET'){requireThat(careers,404,'NOT_AVAILABLE','个人成长尚未启用');await mutateRequest(async()=>{await careers.ensure(auth.account.id);reply(res,200,{economyVersion,...careers.publicRow(auth.account.id)});});return;}
    if(pathname===prefix+'/career/abandon'&&method==='POST'){requireThat(careers,404,'NOT_AVAILABLE','个人成长尚未启用');const body=await readBody(req,256);await mutateRequest(async()=>{const row=careers.row(auth.account.id);requireThat(Number.isSafeInteger(body.careerRevision)&&body.careerRevision>0,400,'INVALID_CAREER_REVISION','请刷新个人进度后重试');if(row&&!row.holding&&row.revision===body.careerRevision+1){reply(res,200,{economyVersion,...careers.publicRow(auth.account.id)});return;}requireThat(row?.revision===body.careerRevision,409,'CAREER_CHANGED','个人进度已更新，请刷新后重试');reply(res,200,{economyVersion,...await abandonCareer(auth.account.id)});});return;}
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
    if(pathname===prefix+'/logout'&&method==='POST'){await mutateRequest(async()=>{sessions.delete(auth.key);const c=connections.get(auth.account.id);if(c?.sessionKey===auth.key){await disconnect(c,'logout');c.ws.close(1000,'Logged out');}setCookie(res,req,'',0);reply(res,200,{loggedOut:true});});return;}
    if(pathname===prefix+'/adventures'&&method==='GET'){reply(res,200,{adventures:index.adventures.filter(a=>a.ownerId===auth.account.id||a.members.includes(auth.account.id)).map(publicAdventure),capacity:await capacityFor(auth.account.id)});return;}
    if(pathname===prefix+'/adventures'&&method==='POST'){const body=await readBody(req,4096),title=text(body.title,40,'新的冒险');await mutateRequest(async()=>{requireThat(sessions.get(auth.key)?.expiresAt>now(),401,'AUTH_REQUIRED','请先登录');creationRate(auth.account.id);const a={id:randomUUID(),ownerId:auth.account.id,title,members:[auth.account.id],epoch:0,createdAt:now(),...(careers?{economyVersion}: {})},next=copy(index);next.adventures.push(a);await saveIndex(next,{kind:'create',accountId:auth.account.id,getAdventures:()=>index.adventures});const store=new CheckedStore(path.join(directory,'adventures',a.id),{...storeOptions,summary:true});stores.set(a.id,store);reply(res,201,{adventure:publicAdventure(a)});});return;}
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
        const a=adventureFor(auth,String(body.adventureId??'')),title=text(body.title,40,a.title);requireThat(a.ownerId===auth.account.id||a.members.includes(auth.account.id),403,'NOT_MEMBER','你没有这份冒险进度');requireThat(a.ownerId===auth.account.id||body.solo!==true,403,'SHARED_ROOM_REQUIRED','队友续玩请开启多人房，方便大家回来');requireThat(!c.roomId,409,'ALREADY_IN_ROOM','请先离开当前房间');requireThat(![...rooms.values()].some(r=>r.adventureId===a.id),409,'ADVENTURE_ACTIVE','此冒险已经有运行中的房间');requireThat(rooms.size<roomLimit,409,'ROOM_LIMIT','同时游玩的房间已满，请稍后再开');
        if(careers){requireThat(a.economyVersion===economyVersion,409,'NEW_ADVENTURE_REQUIRED','成长系统已更新，请新建冒险');await careers.ensure(c.accountId);const held=careers.row(c.accountId).holding;requireThat(!held||held.adventureId===a.id,409,'CAREER_HELD','装备还在另一份冒险里，请先归存或放弃携带物');}
        const store=stores.get(a.id);await store.load();const next=copy(index),updated=next.adventures.find(x=>x.id===a.id);updated.epoch++;if(a.ownerId!==auth.account.id)updated.delegated=true;try{await saveIndex(next);}catch(error){store.unload();throw error;}
        if(careers)await careers.claim(c.accountId,a.id);
        const r={id:randomUUID(),mode:'adventure',adventureId:a.id,title,solo:body.solo===true,status:'waiting',ownerId:a.ownerId,hostPeerId:c.peerId,epoch:updated.epoch,hostGeneration:updated.delegated?1:0,members:new Map(),leaseExpiresAt:now()+hostLeaseMs,memberResetVersion:0};
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
          if(careers?.row(auth.account.id)?.holding?.adventureId===a.id)await abandonCareer(auth.account.id);
          await memberRecords.mark(a.id,auth.account.id,now());
          index={...index,adventures:index.adventures.map(row=>memberRecords.project(row))};
          try{await saveIndex(index);}catch{/* The durable member tombstone already committed this deletion. */}
          if(active)resetChanged(active);lobbyChanged();
          reply(res,200,{deleted:true,id:a.id,scope:'personal'});return;
        }
        requireThat(![...rooms.values()].some(r=>r.adventureId===a.id),409,'ADVENTURE_ACTIVE','请先结束此冒险的房间，再删除进度');
        if(careers)for(const row of Object.values(careers.data.profiles))if(row.holding?.adventureId===a.id)await abandonCareer(row.accountId);
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
      const body=await readBody(req,4096);await mutateRequest(async()=>{const c=connectionFor(auth),r=rooms.get(gmAction[1]);requireThat(r,404,'NOT_FOUND','房间已关闭');requireThat(!careers,403,'NOT_AVAILABLE','个人成长房间不发放测试资源，请使用自由试用');requireThat(r.mode!=='mission',403,'NOT_AVAILABLE','任务模式请使用试用台');await requireLiveRoom(r);reply(res,200,gm.route(c,r,gmAction[2],body));});return;
    }
    const careerAction=pathname.match(/^\/api\/platform\/rooms\/([a-f0-9-]+)\/(careers|settle)$/);
    if(careerAction&&((careerAction[2]==='careers'&&method==='GET')||(careerAction[2]==='settle'&&method==='POST'))){
      requireThat(careers,404,'NOT_AVAILABLE','个人成长尚未启用');const body=method==='POST'?await readBody(req,4*1024*1024):null;
      await mutateRequest(async()=>{
        const {r,c}=await roomForHost(auth,careerAction[1]);requireThat(r.mode!=='mission',403,'NOT_AVAILABLE','自由试用不使用个人资产');
        if(method==='GET'){reply(res,200,careerPayload(r));return;}
        requireThat(body.hostEpoch===r.epoch&&Number.isSafeInteger(body.saveSeq)&&body.saveSeq>0&&Number.isSafeInteger(body.baseRevision)&&body.baseRevision>=0,409,'STALE_HOST','房主授权或存档已更新');
        const transactionId=`${r.id}:${r.epoch}:${body.saveSeq}`,requestChecksum=digest(body),receipt=careers.receipt(r.adventureId,transactionId);
        if(receipt){requireThat(receipt.requestChecksum===requestChecksum,409,'SAVE_REPLAY_MISMATCH','同一归存请求不能修改内容');reply(res,200,{...receipt.result,...careerPayload(r)});return;}
        const store=stores.get(r.adventureId),saved=store.current;
        requireThat(body.baseRevision===(saved?.revision??0),409,'REVISION_CONFLICT','存档版本已更新，请重新同步');
        requireThat((body.economyEpoch??body.state?.economyEpoch)===careers.epoch(r.adventureId),409,'CAREER_EPOCH_CHANGED','个人资产已交接，请重新读取房间进度');
        requireThat(!saved||saved.hostEpoch!==r.epoch||body.saveSeq>saved.saveSeq,409,'STALE_SAVE','存档序号已经过期');
        requireThat(Array.isArray(body.settlements)&&body.settlements.length>0&&body.settlements.length<=8&&new Set(body.settlements.map(row=>row?.accountId)).size===body.settlements.length,400,'INVALID_SETTLEMENT','归存队员无效');
        validateState(body.state);requireThat(body.state.economyVersion===economyVersion,409,'NEW_ADVENTURE_REQUIRED','请使用新版冒险');
        if(saved)requireThat(body.state.worldId===saved.state.worldId&&body.state.time>=saved.state.time&&body.state.tick>=saved.state.tick,409,'WORLD_REWIND','不能用较旧进度归存');
        const state=projectCareers(copy(body.state),r.adventureId),profiles=careerCheckpoints(state,r.adventureId),settled=[];
        for(const entry of body.settlements){
          requireThat(uuid.test(entry?.accountId??'')&&Number.isSafeInteger(entry.careerRevision),400,'INVALID_SETTLEMENT','归存队员无效');
          const bound=careers.checkBinding(entry.accountId,r.adventureId,entry.careerRevision),player=Object.values(state.players).find(p=>p.tokenHash==='account:'+entry.accountId);
          requireThat(player?safeCareerExit(state,entry.accountId,careerConfig):!bound.holding.materialized,409,'RETURN_TO_BASE','请在白天回到基地或仓库，脱离战斗后再归存');
          const capsule=player?extractCareerCapsule(state,entry.accountId):bound.capsule,row=careers.settled(entry.accountId,r.adventureId,entry.careerRevision,capsule),i=profiles.findIndex(p=>p.accountId===entry.accountId);if(i>=0)profiles[i]=row;else profiles.push(row);
          stripCareerPlayer(state,entry.accountId);settled.push(entry.accountId);
        }
        const economyEpoch=careers.epoch(r.adventureId)+1;state.economyEpoch=economyEpoch;validateState(state);
        const snapshot={revision:(saved?.revision??0)+1,hostEpoch:r.epoch,saveSeq:body.saveSeq,savedAt:now(),checksum:digest(state),requestChecksum:null,state,economyEpoch};
        const result={saved:true,revision:snapshot.revision,saveSeq:body.saveSeq,settled,economyVersion,economyEpoch};
        await careers.commit({adventureId:r.adventureId,snapshot,profiles,economyEpoch,receipt:{id:transactionId,requestChecksum,result}});
        r.leaseExpiresAt=now()+hostLeaseMs;c.alive=true;reply(res,200,{...result,...careerPayload(r),...resetPayload(r)});
      });return;
    }
    const action=pathname.match(/^\/api\/platform\/rooms\/([a-f0-9-]+)\/(join|leave|start|close|heartbeat|handoff|activate|decline)$/);
    if(action&&method==='POST'){
      const body=await readBody(req,4096);await mutateRequest(async()=>{const c=connectionFor(auth),key=`${action[1]}:${body.epoch}:${c.peerId}`,receipt=transferReceipts.get(key);if(action[2]==='handoff'&&receipt){requireThat(receipt.finalRevision===body.finalRevision,409,'SAVE_REPLAY_MISMATCH','交接请求不能改变');reply(res,200,receipt.result);return;}const r=rooms.get(action[1]);requireThat(r,404,'NOT_FOUND','房间已关闭');await requireLiveRoom(r);
        if(action[2]==='join'){
          if(c.roomId===r.id){reply(res,200,{room:publicRoom(r)});return;}requireThat(!c.roomId,409,'ALREADY_IN_ROOM','请先离开当前房间');requireThat(!r.solo,403,'SOLO_ROOM','单人房间不能加入');requireThat(r.members.size<8,409,'ROOM_FULL','当前在线人数已满');
          if(careers&&r.mode!=='mission'){await careers.ensure(c.accountId);const held=careers.row(c.accountId).holding;requireThat(!held||held.adventureId===r.adventureId,409,'CAREER_HELD','装备还在另一份冒险里，请先归存或放弃携带物');}
          if(r.mode!=='mission'){const next=copy(index),a=next.adventures.find(a=>a.id===r.adventureId);if(!a.members.includes(c.accountId)){creationRate(c.accountId);a.members.push(c.accountId);a.memberGenerations??={};a.memberGenerations[c.accountId]=memberRecords.generation(a.id,c.accountId);await saveIndex(next,{kind:'join',accountId:c.accountId,getAdventures:()=>index.adventures});if(a.memberGenerations[c.accountId]>0)resetChanged(r);}}
          if(careers&&r.mode!=='mission')await careers.claim(c.accountId,r.adventureId);
          r.members.set(c.peerId,{peerId:c.peerId,accountId:c.accountId,name:c.name,ready:r.status==='running'});c.roomId=r.id;roomChanged(r);reply(res,200,{room:publicRoom(r)});return;
        }
        if(action[2]==='leave'){requireThat(c.roomId===r.id,403,'NOT_MEMBER','你不在此房间');requireThat(r.hostPeerId!==c.peerId,409,'HOST_MUST_CLOSE','房主请先保存并关闭房间');await leave(c,'left');reply(res,200,{left:true});return;}
        await roomForHost(auth,r.id);
        if(action[2]==='decline'){
          requireThat(body.epoch===r.epoch,409,'STALE_HOST','主机已变更');await transferHost(r,c,'handoff_unavailable');reply(res,200,{declined:true});return;
        }
        if(['close','start'].includes(action[2])&&r.hostGeneration>0)requireThat(body.epoch===r.epoch,409,'STALE_HOST','主机已变更');
        if(action[2]==='activate'){
          requireThat(body.epoch===r.epoch,409,'STALE_HOST','主机已变更');
          if(r.status==='migrating'){
            const current=r.mode==='mission'?r.missionSnapshot:stores.get(r.adventureId)?.current;
            if(body.revision!==(current?.revision??0)||(body.economyEpoch??0)!==(r.mode==='mission'?0:careers?.epoch(r.adventureId)??0)||body.worldId!==(current?.state?.worldId??null)){
              r.epoch++;r.hostGeneration++;r.migrationDeadline=now()+45000;r.leaseExpiresAt=r.migrationDeadline;
              if(r.adventureId){const next=copy(index);next.adventures.find(a=>a.id===r.adventureId).epoch=r.epoch;await saveIndex(next);}
              roomChanged(r);reply(res,200,{room:publicRoom(r),retry:true});return;
            }
            r.status=r.resumeStatus;delete r.resumeStatus;delete r.migrationDeadline;r.leaseExpiresAt=now()+hostLeaseMs;roomChanged(r);}
          reply(res,200,{room:publicRoom(r)});return;
        }
        if(action[2]==='handoff'){
          requireThat(body.epoch===r.epoch,409,'STALE_HOST','主机已变更');
          const checkpoint=r.mode==='mission'?r.missionSnapshot:stores.get(r.adventureId)?.current;
          requireThat(body.finalRevision===(checkpoint?.revision??0),409,'REVISION_CONFLICT','最后存档尚未确认');
          await transferHost(r,c,'host_transferred');const result={transferred:rooms.has(r.id)};transferReceipts.set(key,{finalRevision:body.finalRevision,result,at:now()});while(transferReceipts.size>256)transferReceipts.delete(transferReceipts.keys().next().value);reply(res,200,result);return;
        }
        if(action[2]==='heartbeat'){requireThat(body.epoch===r.epoch,409,'STALE_HOST','房间已改变，请重新加入');r.leaseExpiresAt=now()+hostLeaseMs;c.alive=true;reply(res,200,{ok:true});return;}
        if(action[2]==='start'){requireThat(r.status==='waiting',409,'ALREADY_RUNNING','房间已经开始');requireThat([...r.members.values()].every(m=>m.ready),409,'NOT_READY','请等待所有队员准备');r.status='running';r.leaseExpiresAt=now()+hostLeaseMs;roomChanged(r);reply(res,200,{room:publicRoom(r)});return;}
        const saved=r.mode==='mission'?null:stores.get(r.adventureId)?.current;
        let revision=saved?.revision??0;
        const closeId=`${r.id}:${r.epoch}:close`,previous=careers&&r.mode!=='mission'?careers.receipt(r.adventureId,closeId):null;
        if(body.finalRevision!==undefined)requireThat(body.finalRevision===revision||previous?.result.finalRevision===body.finalRevision&&previous.result.revision===revision,409,'REVISION_CONFLICT','最后存档尚未确认');
        if(r.members.size>1){await transferHost(r,c,'host_transferred');reply(res,200,{closed:true,transferred:rooms.has(r.id),revision});return;}
        // Only a confirmed normal close returns never-materialized entrants.
        // A new waiting room has no snapshot and may omit its implicit zero;
        // legacy close calls with an existing snapshot retain all holdings.
        if(careers&&r.mode!=='mission'&&(!saved||body.finalRevision!==undefined)){
          const profiles=Object.values(careers.data.profiles).filter(row=>row.holding?.adventureId===r.adventureId&&row.holding.materialized!==true)
            .map(row=>careers.settled(row.accountId,r.adventureId,row.revision,row.capsule));
          if(profiles.length){
            const economyEpoch=careers.epoch(r.adventureId)+1;let snapshot=null;
            if(saved){const state=projectCareers(copy(saved.state),r.adventureId);for(const row of profiles)stripCareerPlayer(state,row.accountId);state.economyEpoch=economyEpoch;validateState(state);snapshot={...saved,revision:revision+1,savedAt:now(),checksum:digest(state),requestChecksum:null,state,economyEpoch};}
            const result={finalRevision:body.finalRevision??0,revision:snapshot?.revision??revision};
            // Preserve the checked close identity if journal recovery advanced
            // the world revision before the caller received its close ACK.
            await careers.commit({adventureId:r.adventureId,snapshot,profiles,economyEpoch,receipt:{id:closeId,requestChecksum:digest(result.finalRevision),result}});
            revision=result.revision;
          }
        }
        if(r.members.size>1)await transferHost(r,c,'host_transferred');else closeRoom(r,'host_closed');reply(res,200,{closed:true,revision});
      });return;
    }
    const missionCheckpoint=pathname.match(/^\/api\/platform\/rooms\/([a-f0-9-]+)\/checkpoint$/);
    if(missionCheckpoint&&['GET','PUT'].includes(method)){
      const body=method==='PUT'?await readBody(req,4*1024*1024):null;
      await mutateRequest(async()=>{
        const {r}=await roomForHost(auth,missionCheckpoint[1]);requireThat(r.mode==='mission',403,'NOT_AVAILABLE','仅供体验房间使用');
        if(method==='GET'){reply(res,200,{revision:r.missionSnapshot?.revision??0,state:r.missionSnapshot?.state??null,head:null});return;}
        requireThat(body.epoch===r.epoch,409,'STALE_HOST','主机已变更');validateState(body.state);
        const old=r.missionSnapshot,checksum=digest(body.state);
        requireThat(Number.isSafeInteger(body.saveSeq)&&body.saveSeq>0&&Number.isSafeInteger(body.baseRevision)&&body.baseRevision>=0,400,'INVALID_SAVE','保存序号无效');
        if(old?.epoch===r.epoch&&old.saveSeq===body.saveSeq){requireThat(old.checksum===checksum,409,'SAVE_REPLAY_MISMATCH','同一次保存不能改内容');reply(res,200,{revision:old.revision,saveSeq:old.saveSeq});return;}
        requireThat(body.baseRevision===(old?.revision??0)&&(!old||old.epoch!==r.epoch||body.saveSeq>old.saveSeq),409,'REVISION_CONFLICT','进度已更新');
        if(old)requireThat(body.state.worldId===old.state.worldId&&body.state.tick>=old.state.tick&&body.state.time>=old.state.time,409,'WORLD_REWIND','不能覆盖更新的进度');
        r.missionSnapshot={revision:(old?.revision??0)+1,epoch:r.epoch,saveSeq:body.saveSeq,checksum,state:copy(body.state)};reply(res,200,{revision:r.missionSnapshot.revision,saveSeq:body.saveSeq});
      });return;
    }
    const snapshot=pathname.match(/^\/api\/platform\/adventures\/([a-f0-9-]+)\/snapshot$/);
    if(snapshot&&['GET','PUT'].includes(method)){
      const body=method==='PUT'?await readBody(req,4*1024*1024):null;
      await mutateRequest(async()=>{const a=adventureFor(auth,snapshot[1]),active=[...rooms.values()].find(r=>r.adventureId===a.id);requireThat(active,409,'HOST_REQUIRED','请先创建此冒险的房间');const {r,c}=await roomForHost(auth,active.id),store=stores.get(a.id),saved=store.current;
        if(method==='GET'){const state=projectCareers(copy(saved?.state??null),a.id);if(state){applyMemberResetsToState(state,memberRecords.entries(a));if(careers){state.economyVersion=economyVersion;state.economyEpoch=careers.epoch(a.id);}}reply(res,200,{adventure:publicAdventure(a),revision:saved?.revision??0,head:saved?{hostEpoch:saved.hostEpoch,saveSeq:saved.saveSeq}:null,state,epoch:r.epoch,...resetPayload(r),...careerPayload(r)});return;}
        requireThat(body.roomId===r.id&&body.hostEpoch===r.epoch,409,'STALE_HOST','房主授权已更新');requireThat(Number.isSafeInteger(body.saveSeq)&&body.saveSeq>0&&Number.isSafeInteger(body.baseRevision)&&body.baseRevision>=0,400,'INVALID_SAVE','存档序号无效');validateState(body.state);const requestChecksum=digest(body.state);
        if(careers){requireThat(body.state.economyVersion===economyVersion,409,'NEW_ADVENTURE_REQUIRED','请使用新版冒险');requireThat((body.economyEpoch??body.state.economyEpoch)===careers.epoch(a.id),409,'CAREER_EPOCH_CHANGED','个人资产已交接，请重新读取房间进度');}
        if(saved?.hostEpoch===r.epoch&&saved.saveSeq===body.saveSeq){requireThat((saved.requestChecksum??saved.checksum)===requestChecksum,409,'SAVE_REPLAY_MISMATCH','同一存档序号不能提交不同内容');r.leaseExpiresAt=now()+hostLeaseMs;c.alive=true;reply(res,200,{saved:true,revision:saved.revision,saveSeq:saved.saveSeq,...resetPayload(r),...careerPayload(r)});return;}
        projectCareers(body.state,a.id);applyMemberResetsToState(body.state,memberRecords.entries(a));if(careers)body.state.economyEpoch=careers.epoch(a.id);validateState(body.state);const checksum=digest(body.state);
        requireThat(body.baseRevision===(saved?.revision??0),409,'REVISION_CONFLICT','存档版本已更新，请重新同步');requireThat(!saved||saved.hostEpoch!==r.epoch||body.saveSeq>saved.saveSeq,409,'STALE_SAVE','存档序号已经过期');
        if(saved)requireThat(body.state.worldId===saved.state.worldId&&body.state.time>=saved.state.time&&body.state.tick>=saved.state.tick,409,'WORLD_REWIND','不能用其他冒险或较旧进度覆盖存档');
        const next={revision:(saved?.revision??0)+1,hostEpoch:r.epoch,saveSeq:body.saveSeq,savedAt:now(),checksum,requestChecksum,state:body.state,...(careers?{economyEpoch:careers.epoch(a.id)}:{})};
        if(careers)await careers.commit({adventureId:a.id,snapshot:next,profiles:careerCheckpoints(body.state,a.id)});else await store.save(next,{kind:'save'});
        r.leaseExpiresAt=now()+hostLeaseMs;c.alive=true;reply(res,200,{saved:true,revision:next.revision,saveSeq:next.saveSeq,...resetPayload(r),...careerPayload(r)});
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
      const previous=connections.get(auth.account.id);if(previous){await disconnect(previous,'session_replaced');previous.ws.close(4001,'Session replaced');}
      const c={ws,accountId:auth.account.id,name:auth.account.name,peerId:randomUUID(),sessionKey:auth.key,roomId:null,alive:true,rateAt:now(),rateCount:0,chatAt:-Infinity};connections.set(c.accountId,c);peers.set(c.peerId,c);
      send(c,{type:'session',self:{peerId:c.peerId,accountId:c.accountId,name:c.name}});send(c,{type:'rooms',rooms:publicRooms()});
      ws.on('pong',()=>{c.alive=true;});ws.on('error',()=>{});ws.on('close',()=>{void mutate(async()=>await disconnect(c,'disconnected'));});
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
        try{requireThat(plain(message),400,'INVALID_JSON','消息格式无效');const r=rooms.get(c.roomId);requireThat(r,409,'NOT_IN_ROOM','请先加入房间');await requireLiveRoom(r);
          if(message.type==='host_candidate'){requireThat(typeof message.capable==='boolean'&&typeof message.hidden==='boolean',400,'INVALID_MESSAGE','状态无效');c.canHost=message.capable;c.hidden=message.hidden;return;}
          if(message.type==='heartbeat'){requireThat(c.peerId===r.hostPeerId&&message.roomId===r.id&&message.epoch===r.epoch,403,'HOST_REQUIRED','房主授权无效');r.leaseExpiresAt=now()+hostLeaseMs;return;}
          if(message.type==='ready'){requireThat(r.status==='waiting'&&typeof message.ready==='boolean',409,'INVALID_READY','当前不能修改准备状态');r.members.get(c.peerId).ready=message.ready;roomChanged(r);return;}
          if(message.type==='signal'){requireThat((!r.hostGeneration&&message.epoch===undefined)||(message.roomId===r.id&&message.epoch===r.epoch),409,'STALE_HOST','连接已更新');const target=peers.get(message.to);requireThat(target&&target.peerId!==c.peerId&&target.roomId===r.id&&r.members.has(target.peerId),403,'NOT_MEMBER','信令对象不在同一房间');requireThat(c.peerId===r.hostPeerId||target.peerId===r.hostPeerId,403,'INVALID_TOPOLOGY','当前只允许房主与队员直连');requireThat(plain(message.data)&&Buffer.byteLength(JSON.stringify(message.data))<=24576,400,'INVALID_SIGNAL','信令内容无效');send(target,{type:'signal',from:c.peerId,roomId:r.id,epoch:r.epoch,data:message.data});return;}
          if(message.type==='chat'){if(careers&&/^\/gm(?:\s|$)/i.test(String(message.text??'').trim())){send(c,{type:'error',code:'NOT_AVAILABLE',message:'个人成长房间不发放测试资源，请使用自由试用'});return;}if(gm.chat(c,r,message))return;requireThat(now()-c.chatAt>=300,429,'RATE_LIMIT','发言太快');const content=text(message.text,300);requireThat(content.length>0,400,'INVALID_TEXT','消息不能为空');c.chatAt=now();const entry={id:randomUUID(),roomId:r.id,from:{peerId:c.peerId,accountId:c.accountId,name:c.name},text:content,at:now()};for(const m of r.members.values())send(peers.get(m.peerId),{type:'chat',message:entry});return;}
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
      for(const [id,row]of transferReceipts)if(now()-row.at>300000)transferReceipts.delete(id);
      for(const [id,row]of creationAttempts)if(now()-row.at>=60000)creationAttempts.delete(id);
      return maintenanceResult;
    })().catch(()=>{maintenanceResult={failed:true,code:'STORAGE_MAINTENANCE_FAILED'};}).finally(()=>maintenanceJob=null);return maintenanceJob;
  }
  let lastPing=now();async function sweep(){if(stopping)return;await mutate(async()=>{const time=now();for(const [key,s]of sessions)if(s.expiresAt<=time){sessions.delete(key);const c=connections.get(s.accountId);if(c?.sessionKey===key){await disconnect(c,'session_expired');c.ws.close(4003,'Session expired');}}for(const r of [...rooms.values()])if((r.status==='running'&&r.leaseExpiresAt<=time)||(r.status==='migrating'&&r.migrationDeadline<=time)){const c=peers.get(r.hostPeerId);if(c)await transferHost(r,c,'host_timeout');else closeRoom(r,'host_timeout');}for(const [key,row]of attempts)if(time-row.at>120000)attempts.delete(key);if(time-lastPing>=10000){lastPing=time;for(const c of [...connections.values()]){if(!c.alive){await disconnect(c,'disconnected');c.ws.terminate();}else {c.alive=false;c.ws.ping();}}}});}
  const timer=options.manualClock?null:setInterval(()=>{void sweep().catch(()=>{});if(now()-lastMaintenance>=900000)void maintain();},1000);timer?.unref();
  async function stop(){if(stopped)return;if(stopPromise)return stopPromise;stopping=true;clearInterval(timer);stopPromise=(async()=>{if(maintenanceJob)await maintenanceJob;await mutate(async()=>{for(const r of [...rooms.values()])closeRoom(r,'platform_stopping');for(const c of connections.values())c.ws.close(1001,'Platform stopping');});await new Promise(resolve=>{const timeout=setTimeout(()=>{for(const ws of wss.clients)ws.terminate();resolve();},250);wss.close(()=>{clearTimeout(timeout);resolve();});});sessions.clear();stopped=true;})();return stopPromise;}
  const service={handleRequest,handleUpgrade,stop,status:()=>({service:'tidal-platform',ready:!stopping&&!stopped,rooms:rooms.size,online:connections.size,roomLimit,storage:{adventures:index.adventures.length,cachedWorlds:[...stores.values()].filter(s=>s.loaded).length,maintenance:maintenanceResult}})};if(options.manualClock){service.sweep=sweep;service.maintain=maintain;}return service;
}
