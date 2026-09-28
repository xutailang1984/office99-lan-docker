import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// An append-only deletion authority independent of either recoverable index slot.
// Snapshots remain offline; their presence can never restore an online adventure.
export class DeletedAdventures {
  constructor(directory,{policy=null,platformRoot=null}={}){this.directory=path.resolve(directory);this.ids=new Set();this.policy=policy;this.platformRoot=platformRoot;}
  async load(){
    await fs.mkdir(this.directory,{recursive:true});
    for(const file of await fs.readdir(this.directory)){
      if(!file.endsWith('.json'))continue;
      const id=file.slice(0,-5);
      if(!uuid.test(id))throw Error('Invalid adventure deletion marker name; originals retained');
      let entry;
      try{entry=JSON.parse(await fs.readFile(path.join(this.directory,file),'utf8'));}catch{throw Error('Invalid adventure deletion marker; originals retained');}
      const value=entry?.value;
      if(entry?.schema!==1||!value||value.id!==id||!Number.isFinite(value.deletedAt)||value.deletedAt<0||entry.checksum!==digest(value))throw Error('Invalid adventure deletion marker; originals retained');
      this.ids.add(id);
    }
    return this;
  }
  has(id){return this.ids.has(id);}
  async mark(id,deletedAt){
    if(!uuid.test(id)||!Number.isFinite(deletedAt)||deletedAt<0)throw Error('Invalid adventure deletion request');
    if(this.has(id))return;
    const value={id,deletedAt},entry={schema:1,checksum:digest(value),value};
    const target=path.join(this.directory,id+'.json'),temporary=target+'.tmp',bytes=JSON.stringify(entry);
    const write=async()=>{const handle=await fs.open(temporary,'w');
      try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
      const check=JSON.parse(await fs.readFile(temporary,'utf8'));
      if(check.checksum!==digest(check.value)||check.value.id!==id)throw Error('Adventure deletion verification failed');
      await fs.rename(temporary,target);
    };
    if(this.policy)await this.policy.withWrite({kind:'control',files:[{path:path.relative(this.platformRoot,target).replaceAll('\\','/'),bytes:Buffer.byteLength(bytes)}]},write);else await write();
    this.ids.add(id);
  }
}
