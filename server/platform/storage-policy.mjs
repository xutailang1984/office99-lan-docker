import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const MiB=1024*1024,GiB=1024*MiB,dayMs=86400000;
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const uuidRE=new RegExp('^'+uuid+'$');
const snapshotRE=new RegExp('^(?:snapshot-[01]\\.json(?:\\.tmp|\\.corrupt-'+uuid+')?|summary\\.json(?:\\.tmp)?)$');
const controlRE=new RegExp('^(?:deleted-adventures/'+uuid+'\\.json|member-resets/'+uuid+'/snapshot-[01]\\.json)$');
export const STORAGE_CONTROL_WRITE_BYTES=256*1024;
export const STORAGE_CONTROL_RESERVE_BYTES=8*MiB;
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

export const DEFAULT_STORAGE_LIMITS=Object.freeze({
  adventuresPerAccount:5,maxAdventures:500,maxUsageBytes:2*GiB,saveReserveBytes:64*MiB,
  minFreeCreateBytes:5*GiB,minFreeSaveBytes:512*MiB,warnFreeBytes:10*GiB,
  warnUsageRatio:.8,retentionDays:30,cleanupBatchSize:20,
});

export class StoragePolicyError extends Error {
  constructor(code,message,status=503){super(message);this.name='StoragePolicyError';this.code=code;this.status=status;}
}
const need=(condition,code,message,status=503)=>{if(!condition)throw new StoragePolicyError(code,message,status);};
const positive=value=>Number.isSafeInteger(value)&&value>0;
const nonnegative=value=>Number.isSafeInteger(value)&&value>=0;

export function validateStorageLimits(overrides={}) {
  need(plain(overrides)&&Object.keys(overrides).every(k=>Object.hasOwn(DEFAULT_STORAGE_LIMITS,k)),
    'STORAGE_CONFIG','存储保护配置无效');
  const value={...DEFAULT_STORAGE_LIMITS,...overrides};
  for(const key of Object.keys(value).filter(k=>k!=='warnUsageRatio'))
    need((key==='saveReserveBytes'?nonnegative:positive)(value[key]),'STORAGE_CONFIG','存储保护配置无效');
  need(value.adventuresPerAccount<=value.maxAdventures&&value.saveReserveBytes<value.maxUsageBytes
    &&value.minFreeSaveBytes<=value.minFreeCreateBytes&&value.minFreeCreateBytes<=value.warnFreeBytes
    &&Number.isFinite(value.warnUsageRatio)&&value.warnUsageRatio>0&&value.warnUsageRatio<1
    &&value.retentionDays>=30&&value.retentionDays<=36500&&value.cleanupBatchSize<=20,
    'STORAGE_CONFIG','存储保护配置无效');
  return Object.freeze(value);
}

// Owns no timers and creates no directories. The caller supplies an already-created,
// private platform directory. All write callbacks for that directory must use the
// same policy instance. This is an in-process admission lock, not a cross-process lock.
export async function createStoragePolicy({directory,limits={},now=Date.now,statfs=fs.statfs}={}) {
  need(typeof directory==='string'&&directory.length>0&&typeof now==='function'&&typeof statfs==='function',
    'STORAGE_CONFIG','存储保护配置无效');
  const cap=validateStorageLimits(limits),root=path.resolve(directory);
  const canonical=value=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);
  let chain=Promise.resolve(),sizes=new Map(),usageBytes=0,lastInventoryAt=null,cleanupCursor=0;
  const locked=operation=>{const work=chain.catch(()=>{}).then(operation);chain=work.catch(()=>{});return work;};
  const timestamp=()=>{const at=now();need(Number.isFinite(at)&&at>=0,'STORAGE_CLOCK','存储时钟无效');return at;};
  const relative=name=>{
    need(typeof name==='string'&&name.length>0&&name.length<=1024&&!name.includes('\\')&&!name.includes(':')
      &&!/[\u0000-\u001f\u007f]/.test(name)&&!path.isAbsolute(name)
      &&name.split('/').every(p=>p!==''&&p!=='.'&&p!=='..'&&!/[. ]$/.test(p)),
      'STORAGE_PATH','存储路径超出允许范围');
    const full=path.resolve(root,...name.split('/')),rel=path.relative(root,full);
    need(rel&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel),'STORAGE_PATH','存储路径超出允许范围');
    return full;
  };
  async function rootSafe() {
    const info=await fs.lstat(root);
    need(info.isDirectory()&&!info.isSymbolicLink()&&canonical(await fs.realpath(root))===canonical(root),
      'STORAGE_PATH','存储目录不是独立的受保护目录');
  }
  async function safeStat(name,{missing=true}={}) {
    await rootSafe();const parts=name.split('/');relative(name);let current=root;
    for(let i=0;i<parts.length;i++){
      current=path.join(current,parts[i]);let info;
      try{info=await fs.lstat(current);}catch(error){if(missing&&error.code==='ENOENT')return null;throw error;}
      need(!info.isSymbolicLink(),'STORAGE_PATH','存储目录包含不允许的链接');
      need(i===parts.length-1||info.isDirectory(),'STORAGE_PATH','存储目录结构无效');
      if(i===parts.length-1)return info;
    }
  }
  const updateSize=(name,size)=>{
    usageBytes+=(size??0)-(sizes.get(name)??0);
    need(nonnegative(usageBytes),'STORAGE_ACCOUNTING','存储用量无法确认');
    if(size===null)sizes.delete(name);else sizes.set(name,size);
  };
  async function refreshFiles(names) {
    for(const name of names){const info=await safeStat(name);need(!info||info.isFile(),'STORAGE_PATH','写入目标不是普通文件');updateSize(name,info?.size??null);}
  }
  async function inventoryUnlocked() {
    await rootSafe();const next=new Map();let total=0;
    async function visit(base=''){
      const entries=await fs.readdir(base?relative(base):root,{withFileTypes:true});
      for(const entry of entries){
        const name=base?base+'/'+entry.name:entry.name,info=await safeStat(name,{missing:false});
        need(info.isDirectory()||info.isFile(),'STORAGE_PATH','存储目录包含不允许的文件类型');
        if(info.isDirectory())await visit(name);
        else {need(nonnegative(info.size)&&Number.isSafeInteger(total+info.size),'STORAGE_ACCOUNTING','存储用量无法确认');next.set(name,info.size);total+=info.size;}
      }
    }
    await visit();sizes=next;usageBytes=total;lastInventoryAt=timestamp();return {usageBytes,fileCount:sizes.size,lastInventoryAt};
  }
  async function freeBytes() {
    try{
      const stat=await statfs(root,{bigint:true}),block=BigInt(stat.bsize),available=BigInt(stat.bavail);
      need(block>0n&&available>=0n,'STORAGE_UNAVAILABLE','暂时无法确认磁盘剩余空间');
      const bytes=block*available;return Number(bytes>BigInt(Number.MAX_SAFE_INTEGER)?BigInt(Number.MAX_SAFE_INTEGER):bytes);
    }catch{throw new StoragePolicyError('STORAGE_UNAVAILABLE','暂时无法确认磁盘剩余空间');}
  }
  async function statusUnlocked() {
    const free=await freeBytes();const warnings=[];
    if(free<cap.warnFreeBytes)warnings.push('DISK_SPACE_LOW');
    if(usageBytes/cap.maxUsageBytes>cap.warnUsageRatio)warnings.push('STORAGE_USAGE_HIGH');
    return {usageBytes,freeBytes:free,maxUsageBytes:cap.maxUsageBytes,createUsageLimitBytes:cap.maxUsageBytes-cap.saveReserveBytes,
      fileCount:sizes.size,lastInventoryAt,warnings};
  }
  function assertCreation(kind,accountId,adventures) {
    need(typeof accountId==='string'&&accountId.length>0&&Array.isArray(adventures)
      &&adventures.every(a=>plain(a)&&typeof a.ownerId==='string'&&(a.members===undefined||Array.isArray(a.members)
        &&a.members.every(m=>typeof m==='string'))),'STORAGE_REQUEST','新建冒险参数无效',400);
    if(kind==='create')need(adventures.length<cap.maxAdventures,'ADVENTURE_LIMIT','冒险数量已满，请整理旧进度后再新建',409);
    need(adventures.filter(a=>a.ownerId===accountId||a.members?.includes(accountId)).length<cap.adventuresPerAccount,
      'ACCOUNT_ADVENTURE_LIMIT','你的冒险数量已满，请整理旧进度后再新建',409);
  }
  // files contains final envelope byte lengths, not just the JSON state payload.
  // A callback may touch only these paths and their fixed .tmp siblings. Declare
  // summary.json too when it is written by the same callback. A partial failure
  // is measured in finally, so durable writes/temp remnants retain their budget.
  async function withWrite(request,operation) {
    need(plain(request)&&['create','join','save','metadata','control'].includes(request.kind)&&typeof operation==='function'
      &&Array.isArray(request.files)&&request.files.length>0,'STORAGE_REQUEST','存储写入参数无效',400);
    const kind=request.kind,accountId=request.accountId,getAdventures=request.getAdventures,newRecord=['create','join'].includes(kind);
    need(!newRecord||typeof getAdventures==='function','STORAGE_REQUEST','缺少当前冒险目录',400);
    const files=request.files.map(file=>{
      need(plain(file)&&typeof file.path==='string'&&nonnegative(file.bytes),'STORAGE_REQUEST','存储写入参数无效',400);
      relative(file.path);need(!file.path.endsWith('.tmp'),'STORAGE_REQUEST','请声明最终存储文件',400);
      return {path:file.path,bytes:file.bytes};
    });
    const touched=files.flatMap(f=>[f.path,f.path+'.tmp']);
    need(new Set(touched.map(n=>process.platform==='win32'?n.toLowerCase():n)).size===touched.length,'STORAGE_REQUEST','存储写入目标重复',400);
    if(kind==='control')need(files.every(f=>controlRE.test(f.path))&&files.reduce((n,f)=>n+f.bytes,0)<=STORAGE_CONTROL_WRITE_BYTES,
      'STORAGE_REQUEST','紧急清理标记超出允许范围',400);
    return locked(async()=>{
      if(newRecord)assertCreation(kind,accountId,await getAdventures());
      await refreshFiles(touched);
      const projected=usageBytes+files.reduce((n,f)=>n+f.bytes-(sizes.get(f.path)??0)-(sizes.get(f.path+'.tmp')??0),0);
      const ceiling=kind==='control'?cap.maxUsageBytes+STORAGE_CONTROL_RESERVE_BYTES:newRecord?cap.maxUsageBytes-cap.saveReserveBytes:cap.maxUsageBytes;
      // Existing over-quota saves may replace data without growing it. Old saves
      // are never erased or rejected solely because adventure counts are higher.
      need(Number.isSafeInteger(projected)&&projected<=Math.max(ceiling,newRecord||kind==='control'?ceiling:usageBytes),
        'STORAGE_LIMIT','存档空间不足，请先整理旧进度',507);
      const peakBytes=files.reduce((n,f)=>n+f.bytes,0),free=await freeBytes();
      need(Number.isSafeInteger(peakBytes)&&free-peakBytes>=(newRecord?cap.minFreeCreateBytes:cap.minFreeSaveBytes),
        'DISK_SPACE_LOW','磁盘剩余空间不足，已保留现有存档',507);
      let value,failure;
      try{value=await operation();}catch(error){failure=error;}
      try{
        await refreshFiles(touched);
        if(!failure)for(const file of files)need(sizes.has(file.path)&&sizes.get(file.path)===file.bytes&&!sizes.has(file.path+'.tmp'),
          'STORAGE_WRITE_MISMATCH','存储写入大小与预算不一致');
      }catch(error){failure=error;}
      if(failure)throw failure;return value;
    });
  }
  async function deletionMarker(id) {
    const name='deleted-adventures/'+id+'.json',info=await safeStat(name);
    need(info?.isFile()&&info.size<=16384,'CLEANUP_MARKER_INVALID','删除凭据无效，原文件已保留');
    let entry;try{entry=JSON.parse(await fs.readFile(relative(name),'utf8'));}catch{throw new StoragePolicyError('CLEANUP_MARKER_INVALID','删除凭据无效，原文件已保留');}
    const value=entry?.value;
    need(entry?.schema===1&&plain(value)&&value.id===id&&Number.isFinite(value.deletedAt)&&value.deletedAt>=0
      &&entry.checksum===sha(value),'CLEANUP_MARKER_INVALID','删除凭据无效，原文件已保留');
    return {at:value.deletedAt,checksum:entry.checksum};
  }
  async function cleanupDeleted({activeAdventureIds}={}) {
    need(typeof activeAdventureIds==='function','STORAGE_REQUEST','清理需要当前活动冒险列表',400);
    return locked(async()=>{
      await rootSafe();const markerDir=await safeStat('deleted-adventures');
      const report={deletedCount:0,blockedCount:0,examinedCount:0,bytesFreed:0,hasMore:false,issues:[]};
      if(!markerDir)return report;
      need(markerDir.isDirectory(),'STORAGE_PATH','删除凭据目录无效');
      const names=(await fs.readdir(relative('deleted-adventures'))).filter(n=>n.endsWith('.json')).sort();
      if(!names.length)return report;
      const start=cleanupCursor%names.length;
      // A corrupt or blocked prefix cannot starve later deleted adventures.
      for(let offset=0;offset<names.length;offset++){
        const position=(start+offset)%names.length,name=names[position];
        if(report.examinedCount>=cap.cleanupBatchSize){report.hasMore=true;break;}
        cleanupCursor=(position+1)%names.length;report.examinedCount++;
        const id=name.slice(0,-5);let marker;
        try{
          need(uuidRE.test(id),'CLEANUP_MARKER_INVALID','删除凭据无效，原文件已保留');marker=await deletionMarker(id);
          if(timestamp()-marker.at<cap.retentionDays*dayMs)continue;
          const base='adventures/'+id,folder=await safeStat(base);if(!folder)continue;
          const active=await activeAdventureIds();need(active instanceof Set,'STORAGE_REQUEST','活动冒险列表无效');
          need(!active.has(id),'CLEANUP_ACTIVE','活动冒险不能清理');
          need(folder.isDirectory(),'STORAGE_PATH','待清理目录无效');
          const entries=await fs.readdir(relative(base)),files=[];
          // Inspect the entire candidate before removing a single byte.
          for(const entry of entries){
            need(snapshotRE.test(entry),'CLEANUP_UNKNOWN_FILE','待清理目录含未知文件，已保留');
            const rel=base+'/'+entry,info=await safeStat(rel,{missing:false});
            need(info.isFile(),'CLEANUP_UNKNOWN_FILE','待清理目录含未知文件，已保留');
            files.push({rel,info});
          }
          need((await deletionMarker(id)).checksum===marker.checksum,'CLEANUP_MARKER_CHANGED','删除凭据发生变化，已保留');
          const latest=await activeAdventureIds();need(latest instanceof Set&&!latest.has(id),'CLEANUP_ACTIVE','活动冒险不能清理');
          for(const file of files){
            const info=await safeStat(file.rel,{missing:false});
            need(info.isFile()&&info.dev===file.info.dev&&info.ino===file.info.ino&&info.size===file.info.size
              &&info.mtimeMs===file.info.mtimeMs,'CLEANUP_CHANGED','待清理文件发生变化，已保留');
            await fs.unlink(relative(file.rel));updateSize(file.rel,null);report.bytesFreed+=info.size;
          }
          await safeStat(base,{missing:false});await fs.rmdir(relative(base));report.deletedCount++;
        }catch(error){report.blockedCount++;if(report.issues.length<20)report.issues.push(error instanceof StoragePolicyError?error.code:'CLEANUP_FAILED');}
      }
      return report;
    });
  }
  await inventoryUnlocked();
  return Object.freeze({limits:cap,withWrite,inventory:()=>locked(inventoryUnlocked),status:()=>locked(statusUnlocked),cleanupDeleted});
}
