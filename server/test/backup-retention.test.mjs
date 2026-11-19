import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {BACKUP_MANIFEST,buildBackupManifest,planBackupRetention,applyBackupRetention} from '../../scripts/backup-retention.mjs';

const run=promisify(execFile),day=86400000,NOW=Date.UTC(2026,8,10,0,0,0);
const code=name=>e=>e?.code===name;
const hash=value=>createHash('sha256').update(value).digest('hex');
function dirname(at){return 'before-v086-'+new Date(at).toISOString().replace(/[-:]/g,'').replace('T','-').slice(0,15);}
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'office-backup-retention-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));return {root,now:()=>NOW};
}
async function add(f,daysAgo,{managed=true,at=NOW-daysAgo*day}={}){
  const directory=path.join(f.root,dirname(at));await fs.mkdir(directory);
  await fs.writeFile(path.join(directory,'host.config.json'),'synthetic config');
  await fs.writeFile(path.join(directory,'config-before-swap.json'),'synthetic previous config');
  await fs.mkdir(path.join(directory,'data-live','synthetic-private-name'),{recursive:true});
  await fs.writeFile(path.join(directory,'data-live','synthetic-private-name','snapshot-0.json'),'synthetic saved state');
  if(managed)await fs.writeFile(path.join(directory,BACKUP_MANIFEST),JSON.stringify(await buildBackupManifest({directory})));
  return directory;
}
async function four(f){const paths=[];for(const age of [100,90,80,70])paths.push(await add(f,age));return paths;}
const plan=f=>planBackupRetention({root:f.root,now:f.now});
const apply=(f,p)=>applyBackupRetention({root:f.root,plan:p,apply:true,now:f.now});

test('manifest generator reads only and uses opaque relative-path hashes for every file and directory',async t=>{
  const f=await fixture(t),directory=await add(f,100,{managed:false});
  const manifest=await buildBackupManifest({directory});assert.equal(manifest.schema,1);assert.equal(manifest.complete,true);
  assert.equal(Object.keys(manifest.files).length,3);assert.equal(manifest.directories.length,2);
  assert(manifest.files[hash('host.config.json')]);assert(manifest.directories.includes(hash('data-live')));
  assert(!JSON.stringify(manifest).includes('synthetic-private-name'));assert(!JSON.stringify(manifest).includes('synthetic saved state'));
  await assert.rejects(fs.stat(path.join(directory,BACKUP_MANIFEST)),{code:'ENOENT'});
});

test('dry run and unconfirmed apply retain everything while planning only old backups outside newest three',async t=>{
  const f=await fixture(t);const paths=await four(f);await add(f,10);await add(f,1);
  const p=await plan(f);assert.equal(p.managedCount,6);assert.equal(p.deleteCount,3);assert.equal(p.retainedCount,3);
  const no=await applyBackupRetention({root:f.root,plan:p,now:f.now});assert.equal(no.applied,false);
  for(const directory of paths)assert((await fs.stat(directory)).isDirectory());
  assert(!JSON.stringify(p).includes('synthetic-private-name'));assert(!JSON.stringify(p).includes(f.root));
});

test('applied cleanup deletes only manifest-verified old backup and always keeps most recent three',async t=>{
  const f=await fixture(t),paths=await four(f),p=await plan(f);assert.equal(p.deleteCount,1);
  const result=await apply(f,p);assert.equal(result.complete,true);assert.equal(result.deletedCount,1);assert.equal(result.deletedBytes,p.deleteBytes);
  await assert.rejects(fs.stat(paths[0]),{code:'ENOENT'});for(const directory of paths.slice(1))assert((await fs.stat(directory)).isDirectory());
  assert.equal((await plan(f)).deleteCount,0);
});

test('30 days is an exact minimum and newest-three protection applies even to much older backups',async t=>{
  const f=await fixture(t);await add(f,0,{at:NOW-30*day+1000});for(const age of [3,2,1])await add(f,age);
  assert.equal((await plan(f)).deleteCount,0);f.now=()=>NOW+1000;assert.equal((await plan(f)).deleteCount,1);
  const g=await fixture(t);for(const age of [300,200,100])await add(g,age);assert.equal((await plan(g)).deleteCount,0);
});

test('old backups without manifest and unknown root entries are preserved and reported as unmanaged',async t=>{
  const f=await fixture(t);await four(f);const legacy=await add(f,200,{managed:false});
  await fs.mkdir(path.join(f.root,'unknown-directory'));await fs.writeFile(path.join(f.root,'notes.txt'),'keep');
  const p=await plan(f);assert.equal(p.unmanagedCount,3);assert(p.unmanaged.some(x=>x.reason==='BACKUP_NO_MANIFEST'));
  await apply(f,p);assert((await fs.stat(legacy)).isDirectory());assert.equal(await fs.readFile(path.join(f.root,'notes.txt'),'utf8'),'keep');
});

test('unknown file or empty directory added after manifest blocks the entire candidate',async t=>{
  for(const extra of ['file','directory']){
    const f=await fixture(t),paths=await four(f);
    if(extra==='file')await fs.writeFile(path.join(paths[0],'data-live','unexpected.txt'),'keep');
    else await fs.mkdir(path.join(paths[0],'data-live','unexpected-empty'));
    const p=await plan(f);assert.equal(p.deleteCount,0);assert.equal(p.unmanagedCount,1);
    assert.equal(p.unmanaged[0].reason,'BACKUP_MANIFEST_MISMATCH');
    await apply(f,p);assert.equal(await fs.readFile(path.join(paths[0],'host.config.json'),'utf8'),'synthetic config');
  }
});

test('unknown top-level entry cannot be blessed even by generating a fresh manifest',async t=>{
  const f=await fixture(t),directory=await add(f,100,{managed:false});await fs.writeFile(path.join(directory,'secret.txt'),'keep');
  await assert.rejects(buildBackupManifest({directory}),code('BACKUP_UNKNOWN_ENTRY'));
  assert.equal((await plan(f)).deleteCount,0);
});

test('corrupt manifest, missing file and mutated file are all retained',async t=>{
  const f=await fixture(t);const paths=[];for(const age of [100,90,80,70,60,50])paths.push(await add(f,age));
  await fs.writeFile(path.join(paths[0],BACKUP_MANIFEST),'broken');
  await fs.unlink(path.join(paths[1],'config-before-swap.json'));
  await fs.writeFile(path.join(paths[2],'host.config.json'),'different bytes');
  const p=await plan(f);assert.equal(p.unmanagedCount,3);assert.equal(p.deleteCount,0);
  await apply(f,p);for(const directory of paths)assert((await fs.stat(directory)).isDirectory());
});

test('stale plan after a changed file refuses before deleting any candidate',async t=>{
  const f=await fixture(t),paths=await four(f),p=await plan(f);
  await fs.writeFile(path.join(paths[0],'host.config.json'),'changed');
  await assert.rejects(apply(f,p),code('BACKUP_PLAN_STALE'));
  for(const directory of paths)assert((await fs.stat(directory)).isDirectory());
});

test('manifest replacement, weaker retention, fake root and root injection cannot authorize deletion',async t=>{
  const f=await fixture(t);await four(f);const p=await plan(f);
  await assert.rejects(apply(f,{...p,policy:{retentionDays:29,keepNewest:3}}),code('BACKUP_POLICY_INVALID'));
  await assert.rejects(apply(f,{...p,policy:{retentionDays:30,keepNewest:2}}),code('BACKUP_POLICY_INVALID'));
  await assert.rejects(apply(f,{...p,rootId:'0'.repeat(64)}),code('BACKUP_ROOT_CHANGED'));
  await assert.rejects(apply(f,{...p,policy:{...p.policy,root:'../outside'}}),code('BACKUP_PLAN_INVALID'));
  const directory=path.join(f.root,dirname(NOW-100*day));
  await fs.appendFile(path.join(directory,BACKUP_MANIFEST),' ');
  await assert.rejects(apply(f,p),code('BACKUP_PLAN_STALE'));
});

test('an old plan cannot delete a backup that has become one of the last three verified copies',async t=>{
  const f=await fixture(t),paths=await four(f),p=await plan(f);
  // Simulates unrelated corruption, not an authorized production deletion.
  await fs.writeFile(path.join(paths[3],BACKUP_MANIFEST),'broken');
  await assert.rejects(apply(f,p),code('BACKUP_PLAN_STALE'));
  assert((await fs.stat(paths[0])).isDirectory());
});

test('linked roots and linked backup contents are rejected without touching their targets',async t=>{
  const f=await fixture(t),g=await fixture(t);await four(f);
  const linked=path.join(g.root,'linked-root');await fs.symlink(f.root,linked,process.platform==='win32'?'junction':'dir');
  await assert.rejects(planBackupRetention({root:linked,now:f.now}),code('BACKUP_PATH_UNSAFE'));
  const oldest=path.join(f.root,dirname(NOW-100*day));
  await fs.symlink(g.root,path.join(oldest,'data-live','linked'),process.platform==='win32'?'junction':'dir');
  const p=await plan(f);assert.equal(p.deleteCount,0);assert.equal(p.unmanaged[0].reason,'BACKUP_LINK_OR_STRUCTURE');
  assert((await fs.stat(g.root)).isDirectory());
});

test('hard-linked files are retained; invalid calendar prefix and non-backup directories are unmanaged',async t=>{
  const f=await fixture(t),paths=await four(f);
  await fs.link(path.join(paths[0],'host.config.json'),path.join(f.root,'linked-config'));
  await fs.mkdir(path.join(f.root,'before-v086-20260231-000000'));
  const p=await plan(f);assert.equal(p.deleteCount,0);assert.equal(p.unmanagedCount,3);
  assert(p.unmanaged.some(x=>x.reason==='BACKUP_LINK_OR_STRUCTURE'));
});

test('concurrent applies do not double-delete or move the keep-three boundary',async t=>{
  const f=await fixture(t);await four(f);const p=await plan(f);
  const results=await Promise.allSettled([apply(f,p),apply(f,p)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'BACKUP_PLAN_STALE');
  assert.equal((await plan(f)).managedCount,3);
});

test('CLI without --apply only produces a redacted plan in an isolated root',async t=>{
  const f=await fixture(t);await four(f);
  const script=fileURLToPath(new URL('../../scripts/backup-retention.mjs',import.meta.url));
  const {stdout}=await run(process.execPath,[script,'--root',f.root]);const report=JSON.parse(stdout);
  assert.equal(report.dryRun,true);assert.equal(report.managedCount,4);assert(!stdout.includes('synthetic-private-name'));
  assert.equal((await fs.readdir(f.root)).length,4);
});
