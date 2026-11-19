import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const copy=value=>structuredClone(value),digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const summarize=value=>value?{revision:value.revision??0,savedAt:value.savedAt??0,dayIndex:value.state?.dayIndex??1,phase:value.state?.phase??'PREP',daysSurvived:value.state?.statistics?.daysSurvived??0}:null;

// The two checked snapshots are authoritative. The small summary is disposable:
// it is accepted only while both on-disk slot signatures still match.
export class CheckedStore {
 constructor(directory,{policy=null,platformRoot=null,summary=false}={}){
  this.directory=directory;this.sequence=0;this.current=null;this.fallback=false;this.loaded=false;
  this.policy=policy;this.platformRoot=platformRoot;this.summaryEnabled=summary;this.summary=null;
 }
 async signatures(){return Promise.all([0,1].map(async slot=>{try{const s=await fs.lstat(path.join(this.directory,`snapshot-${slot}.json`));if(!s.isFile()||s.isSymbolicLink())throw Error('Unexpected snapshot type');return {bytes:s.size,mtimeMs:s.mtimeMs};}catch(error){if(error.code==='ENOENT')return null;throw error;}}));}
 async writeFile(target,bytes,operation,options={}){
  if(!this.policy)return operation();
  return this.policy.withWrite({...options,kind:options.kind??'metadata',files:[{path:path.relative(this.platformRoot,target).replaceAll('\\','/'),bytes:Buffer.byteLength(bytes)}]},operation);
 }
 async loadSummary(){
  if(!this.summaryEnabled)return this.load();
  await fs.mkdir(this.directory,{recursive:true});
  const signature=await this.signatures();
  try{
   const target=path.join(this.directory,'summary.json'),info=await fs.lstat(target);
   if(!info.isFile()||info.isSymbolicLink()||info.size>16384)throw Error('Invalid summary');
   const e=JSON.parse(await fs.readFile(target,'utf8'));
   if(e.schema!==1||!Number.isSafeInteger(e.sequence)||e.sequence<0||e.checksum!==digest(e.value)||JSON.stringify(e.signature)!==JSON.stringify(signature))throw Error('Outdated summary');
   this.sequence=e.sequence;this.summary=e.value;this.loaded=false;this.current=null;return copy(this.summary);
  }catch(error){if(!['ENOENT',undefined].includes(error.code))throw error;}
  // Older installations are upgraded one snapshot at a time, without keeping
  // every world in memory. Corrupt authoritative snapshots still fail closed.
  await this.load();await this.persistSummary();this.unload();return copy(this.summary);
 }
 async load(){
  if(this.loaded)return copy(this.current);
  await fs.mkdir(this.directory,{recursive:true});const valid=[],bad=[];
  for(const slot of [0,1]){const file=path.join(this.directory,`snapshot-${slot}.json`);try{
   const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Unexpected snapshot type');
   const raw=await fs.readFile(file,'utf8');try{const e=JSON.parse(raw);if(e.schema!==1||!Number.isSafeInteger(e.sequence)||e.sequence<1||e.checksum!==digest(e.value))throw Error();valid.push(e);}catch{bad.push({file,raw});}
  }catch(error){if(error.code!=='ENOENT')throw error;}}
  if(!valid.length&&bad.length)throw Error('Platform snapshots invalid; originals retained');
  for(const item of bad){const target=`${item.file}.corrupt-${randomUUID()}`;try{await this.writeFile(target,item.raw,()=>fs.writeFile(target,item.raw,{flag:'wx'}));}catch{/* Preserve the corrupt original when no diagnostic space remains. */}}
  valid.sort((a,b)=>b.sequence-a.sequence);this.fallback=bad.length>0;
  this.sequence=valid[0]?.sequence??0;this.current=valid[0]?.value??null;this.summary=summarize(this.current);this.loaded=true;
  return copy(this.current);
 }
 unload(){if(!this.summaryEnabled)return;this.current=null;this.loaded=false;}
 async persistSummary(){
  if(!this.summaryEnabled)return;
  try{const value=this.summary,e={schema:1,sequence:this.sequence,checksum:digest(value),value,signature:await this.signatures()},bytes=JSON.stringify(e),target=path.join(this.directory,'summary.json'),temporary=target+'.tmp';
   await this.writeFile(target,bytes,async()=>{const h=await fs.open(temporary,'w');try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}await fs.rename(temporary,target);});}catch{/* Metadata is a cache; a committed snapshot must still be acknowledged. */}
 }
 async save(value,options={}){
  if(!this.loaded)await this.load();
  const captured=copy(value),sequence=this.sequence+1,envelope={schema:1,sequence,checksum:digest(captured),value:captured},bytes=JSON.stringify(envelope);
  const target=path.join(this.directory,`snapshot-${sequence%2}.json`),temporary=target+'.tmp';
  await this.writeFile(target,bytes,async()=>{
   await fs.mkdir(this.directory,{recursive:true});const file=await fs.open(temporary,'w');
   try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
   const check=JSON.parse(await fs.readFile(temporary,'utf8'));if(check.checksum!==digest(check.value))throw Error('Platform snapshot verification failed');
   await fs.rename(temporary,target);
  },options);
  this.sequence=sequence;this.current=captured;this.summary=summarize(captured);this.loaded=true;
  await this.persistSummary();return copy(captured);
 }
}
