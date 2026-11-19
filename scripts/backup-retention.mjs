import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export const BACKUP_MANIFEST='backup-manifest.json';
const kind='office99-managed-backup',dayMs=86400000;
const nameRE=/^before-v[0-9]{3}-([0-9]{4})([0-9]{2})([0-9]{2})-([0-9]{2})([0-9]{2})([0-9]{2})$/;
const hex=/^[a-f0-9]{64}$/,maxEntries=200000;
const sha=value=>createHash('sha256').update(value).digest('hex');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const locks=new Map();
export class BackupRetentionError extends Error {
  constructor(code){super(code);this.name='BackupRetentionError';this.code=code;}
}
const need=(condition,code)=>{if(!condition)throw new BackupRetentionError(code);};
const safeCode=error=>error instanceof BackupRetentionError?error.code:'BACKUP_IO_FAILED';
const canonical=value=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);
const stamp=now=>{const value=typeof now==='function'?now():now;need(Number.isSafeInteger(value)&&value>=0,'BACKUP_CLOCK_INVALID');return value;};
const idOf=name=>sha('office99-backup:'+name).slice(0,24);
function policyOf(retentionDays,keepNewest){
  need(Number.isSafeInteger(retentionDays)&&retentionDays>=30&&retentionDays<=36500
    &&Number.isSafeInteger(keepNewest)&&keepNewest>=3&&keepNewest<=10000,'BACKUP_POLICY_INVALID');
  return {retentionDays,keepNewest};
}
function createdAt(name){
  const m=nameRE.exec(name);need(m,'BACKUP_NAME_UNMANAGED');
  const [year,month,date,hour,minute,second]=m.slice(1).map(Number);
  need(year>=2000,'BACKUP_NAME_UNMANAGED');
  const at=Date.UTC(year,month-1,date,hour,minute,second),check=new Date(at);
  need(check.getUTCFullYear()===year&&check.getUTCMonth()===month-1&&check.getUTCDate()===date
    &&check.getUTCHours()===hour&&check.getUTCMinutes()===minute&&check.getUTCSeconds()===second,'BACKUP_NAME_UNMANAGED');
  return at;
}
function resolveInside(root,name){
  need(typeof name==='string'&&name&&name.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!/[. ]$/.test(p))
    &&!/[\\:\u0000-\u001f\u007f]/.test(name)&&!path.isAbsolute(name),'BACKUP_PATH_INVALID');
  const full=path.resolve(root,...name.split('/')),rel=path.relative(root,full);
  need(rel&&rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel),'BACKUP_PATH_INVALID');return full;
}
async function rootInfo(root){
  const info=await fs.lstat(root);
  need(info.isDirectory()&&!info.isSymbolicLink()&&canonical(await fs.realpath(root))===canonical(root),'BACKUP_PATH_UNSAFE');
  return info;
}
async function insideInfo(root,name){
  await rootInfo(root);resolveInside(root,name);let current=root,info;
  const parts=name.split('/');
  for(let i=0;i<parts.length;i++){
    current=path.join(current,parts[i]);info=await fs.lstat(current);
    need(!info.isSymbolicLink()&&(i===parts.length-1||info.isDirectory()),'BACKUP_LINK_OR_STRUCTURE');
  }
  need(info.isDirectory()||info.isFile()&&info.nlink===1,'BACKUP_LINK_OR_STRUCTURE');return info;
}
const sameFile=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
async function hashFile(root,name,expected){
  const info=await insideInfo(root,name);need(info.isFile()&&sameFile(info,expected),'BACKUP_CHANGED');
  const file=await fs.open(resolveInside(root,name),'r');
  try{
    need(sameFile(await file.stat(),info),'BACKUP_CHANGED');const hash=createHash('sha256');
    for await(const chunk of file.createReadStream({autoClose:false}))hash.update(chunk);
    need(sameFile(await file.stat(),info),'BACKUP_CHANGED');return hash.digest('hex');
  }finally{await file.close();}
}
async function scanBackup(directory,{allowManifest=true}={}){
  const at=createdAt(path.basename(directory)),identity=await rootInfo(directory),files=new Map(),directories=[];
  const top=await fs.readdir(directory);
  need(top.includes('host.config.json')&&top.includes('data-live'),'BACKUP_NOT_COMPLETE');
  need(top.every(n=>['host.config.json','data-live','config-before-swap.json',...(allowManifest?[BACKUP_MANIFEST]:[])].includes(n)),
    'BACKUP_UNKNOWN_ENTRY');
  need((await insideInfo(directory,'host.config.json')).isFile()&&(await insideInfo(directory,'data-live')).isDirectory(),
    'BACKUP_NOT_COMPLETE');
  if(top.includes('config-before-swap.json'))need((await insideInfo(directory,'config-before-swap.json')).isFile(),'BACKUP_NOT_COMPLETE');
  let entries=0,totalBytes=0;
  async function visit(base,depth=0){
    need(depth<=64,'BACKUP_TOO_COMPLEX');const names=await fs.readdir(base?resolveInside(directory,base):directory);
    for(const name of names){
      if(!base&&name===BACKUP_MANIFEST)continue;
      need(++entries<=maxEntries,'BACKUP_TOO_COMPLEX');const rel=base?base+'/'+name:name,info=await insideInfo(directory,rel);
      if(info.isDirectory()){directories.push(rel);await visit(rel,depth+1);}
      else {need(Number.isSafeInteger(totalBytes+info.size),'BACKUP_TOO_LARGE');const digest=await hashFile(directory,rel,info);
        files.set(rel,{bytes:info.size,sha256:digest,info});totalBytes+=info.size;}
    }
  }
  await visit('');return {at,identity,files,directories,totalBytes};
}
function manifestFor(scan){
  return {schema:1,kind,complete:true,createdAt:new Date(scan.at).toISOString(),
    files:Object.fromEntries([...scan.files].map(([name,info])=>[sha(name),{bytes:info.bytes,sha256:info.sha256}]).sort(([a],[b])=>a.localeCompare(b))),
    directories:scan.directories.map(sha).sort()};
}

// Reads only. The updater writes this return value to BACKUP_MANIFEST after its
// complete, checked data copy and configuration backup are both finalized.
export async function buildBackupManifest({directory}={}){
  try{
    need(typeof directory==='string'&&directory.length>0,'BACKUP_PATH_INVALID');
    return manifestFor(await scanBackup(path.resolve(directory),{allowManifest:false}));
  }catch(error){throw new BackupRetentionError(safeCode(error));}
}
function validateManifest(value){
  need(plain(value)&&value.schema===1&&value.kind===kind&&value.complete===true&&typeof value.createdAt==='string'
    &&plain(value.files)&&Array.isArray(value.directories),'BACKUP_MANIFEST_INVALID');
  need(Object.keys(value.files).length>0&&Object.keys(value.files).length+value.directories.length<=maxEntries,'BACKUP_MANIFEST_INVALID');
  for(const [key,file]of Object.entries(value.files))need(hex.test(key)&&plain(file)&&Number.isSafeInteger(file.bytes)&&file.bytes>=0
    &&hex.test(file.sha256)&&Object.keys(file).length===2,'BACKUP_MANIFEST_INVALID');
  need(value.directories.every(d=>typeof d==='string'&&hex.test(d))&&new Set(value.directories).size===value.directories.length,
    'BACKUP_MANIFEST_INVALID');
  need(Object.keys(value).length===6,'BACKUP_MANIFEST_INVALID');
}
async function verifiedBackup(root,name){
  const directory=resolveInside(root,name);await insideInfo(root,name);
  let info;try{info=await insideInfo(directory,BACKUP_MANIFEST);}catch(error){if(error.code==='ENOENT')throw new BackupRetentionError('BACKUP_NO_MANIFEST');throw error;}
  need(info.isFile()&&info.size>0&&info.size<=32*1024**2,'BACKUP_MANIFEST_INVALID');
  let bytes,value;try{bytes=await fs.readFile(resolveInside(directory,BACKUP_MANIFEST));value=JSON.parse(bytes.toString('utf8'));}catch{throw new BackupRetentionError('BACKUP_MANIFEST_INVALID');}
  validateManifest(value);const scan=await scanBackup(directory),expected=manifestFor(scan);
  need(value.createdAt===expected.createdAt&&JSON.stringify(Object.keys(value.files).sort())===JSON.stringify(Object.keys(expected.files).sort())
    &&Object.entries(expected.files).every(([key,f])=>value.files[key].bytes===f.bytes&&value.files[key].sha256===f.sha256)
    &&JSON.stringify([...value.directories].sort())===JSON.stringify(expected.directories),'BACKUP_MANIFEST_MISMATCH');
  need(sameFile(await insideInfo(directory,BACKUP_MANIFEST),info),'BACKUP_CHANGED');
  return {...scan,name,directory,manifestInfo:info,manifestSha256:sha(bytes),bytes:scan.totalBytes+info.size,
    id:idOf(name),createdAt:value.createdAt,fileCount:scan.files.size+1};
}
async function planInternal({root,now=Date.now,retentionDays=30,keepNewest=3}={}){
  need(typeof root==='string'&&root.length>0,'BACKUP_PATH_INVALID');root=path.resolve(root);
  const policy=policyOf(retentionDays,keepNewest),at=stamp(now),identity=await rootInfo(root);
  const rootId=sha(canonical(root)+':'+identity.dev+':'+identity.ino),managed=[],unmanaged=[];
  for(const entry of await fs.readdir(root,{withFileTypes:true})){
    const id=idOf(entry.name);
    if(!nameRE.test(entry.name)){unmanaged.push({id,reason:'BACKUP_NAME_UNMANAGED'});continue;}
    try{const backup=await verifiedBackup(root,entry.name);managed.push(backup);}
    catch(error){unmanaged.push({id,reason:safeCode(error)});}
  }
  managed.sort((a,b)=>b.at-a.at||b.name.localeCompare(a.name));
  const retained=[],candidates=[];
  for(let i=0;i<managed.length;i++){
    const b=managed[i],item={id:b.id,createdAt:b.createdAt,bytes:b.bytes,fileCount:b.fileCount,manifestSha256:b.manifestSha256};
    if(i<policy.keepNewest)retained.push({...item,reason:'KEEP_NEWEST'});
    else if(at-b.at<policy.retentionDays*dayMs)retained.push({...item,reason:'WITHIN_RETENTION'});
    else candidates.push(item);
  }
  return {managed,root,report:{schema:1,kind:'office99-backup-retention-plan',dryRun:true,plannedAt:at,rootId,policy,
    managedCount:managed.length,unmanagedCount:unmanaged.length,retainedCount:retained.length,deleteCount:candidates.length,
    deleteBytes:candidates.reduce((n,b)=>n+b.bytes,0),candidates,retained,unmanaged}};
}
export async function planBackupRetention(options={}){
  try{return (await planInternal(options)).report;}catch(error){throw new BackupRetentionError(safeCode(error));}
}
async function deleteVerified(backup){
  const {directory}=backup;
  // All hashes were rechecked before this first unlink. Recheck each file's
  // identity/hash immediately before unlink as well; never follow a link or use
  // recursive removal. Protected directory ACLs and caller maintenance exclude
  // other writers; this cannot be an atomic transaction against hostile admins.
  for(const [name,file]of backup.files){
    need(await hashFile(directory,name,file.info)===file.sha256,'BACKUP_CHANGED');
    await fs.unlink(resolveInside(directory,name));
  }
  for(const name of [...backup.directories].sort((a,b)=>b.split('/').length-a.split('/').length)){
    need((await insideInfo(directory,name)).isDirectory(),'BACKUP_CHANGED');await fs.rmdir(resolveInside(directory,name));
  }
  need(await hashFile(directory,BACKUP_MANIFEST,backup.manifestInfo)===backup.manifestSha256,'BACKUP_CHANGED');
  need(JSON.stringify((await fs.readdir(directory)).sort())===JSON.stringify([BACKUP_MANIFEST]),'BACKUP_CHANGED');
  await fs.unlink(resolveInside(directory,BACKUP_MANIFEST));await rootInfo(directory);await fs.rmdir(directory);
}

export async function applyBackupRetention({root,plan,apply=false,now=Date.now}={}){
  if(apply!==true)return {applied:false,dryRun:true,plan:await planBackupRetention({root,now,
    retentionDays:plan?.policy?.retentionDays??30,keepNewest:plan?.policy?.keepNewest??3})};
  need(plain(plan)&&plan.schema===1&&plan.kind==='office99-backup-retention-plan'&&Array.isArray(plan.candidates)
    &&plain(plan.policy)&&Object.keys(plan.policy).every(k=>['retentionDays','keepNewest'].includes(k))
    &&typeof plan.rootId==='string'&&hex.test(plan.rootId),'BACKUP_PLAN_INVALID');
  need(typeof root==='string'&&root.length>0,'BACKUP_PATH_INVALID');const key=canonical(root),previous=locks.get(key)??Promise.resolve();
  const task=previous.catch(()=>{}).then(async()=>{
    const current=await planInternal({root,now,retentionDays:plan.policy.retentionDays,keepNewest:plan.policy.keepNewest});
    need(current.report.rootId===plan.rootId,'BACKUP_ROOT_CHANGED');
    const eligible=new Map(current.report.candidates.map(c=>[c.id,c])),seen=new Set(),selected=[];
    for(const requested of plan.candidates){
      need(plain(requested)&&typeof requested.id==='string','BACKUP_PLAN_INVALID');
      const candidate=eligible.get(requested.id);need(candidate&&!seen.has(requested.id)&&JSON.stringify(candidate)===JSON.stringify(requested),'BACKUP_PLAN_STALE');
      seen.add(requested.id);selected.push(current.managed.find(m=>m.id===requested.id));
    }
    const result={applied:true,dryRun:false,complete:false,deletedCount:0,deletedBytes:0,deleted:[],failed:[],retainedCount:current.report.retainedCount,
      unmanagedCount:current.report.unmanagedCount};
    for(const backup of selected){
      try{
        const fresh=await verifiedBackup(current.root,backup.name);
        need(fresh.manifestSha256===backup.manifestSha256&&fresh.bytes===backup.bytes&&sameFile(fresh.identity,backup.identity),'BACKUP_CHANGED');
        await deleteVerified(fresh);result.deletedCount++;result.deletedBytes+=fresh.bytes;result.deleted.push({id:fresh.id,bytes:fresh.bytes});
      }catch(error){result.failed.push({id:backup.id,code:safeCode(error)});break;}
    }
    result.complete=result.failed.length===0;return result;
  });
  locks.set(key,task);
  try{return await task;}catch(error){throw new BackupRetentionError(safeCode(error));}finally{if(locks.get(key)===task)locks.delete(key);}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  let root='C:/ProgramData/Office99/backups',apply=false;
  try{
    const args=process.argv.slice(2);
    for(let i=0;i<args.length;i++){
      if(args[i]==='--apply')apply=true;
      else if(args[i]==='--root'&&args[i+1])root=args[++i];
      else throw new BackupRetentionError('BACKUP_ARGUMENT_INVALID');
    }
    const plan=await planBackupRetention({root});
    const result=apply?await applyBackupRetention({root,plan,apply:true}):plan;
    process.stdout.write(JSON.stringify(result,null,2)+'\n');if(result.complete===false)process.exitCode=1;
  }catch(error){process.stderr.write(JSON.stringify({complete:false,code:safeCode(error)})+'\n');process.exitCode=1;}
}
