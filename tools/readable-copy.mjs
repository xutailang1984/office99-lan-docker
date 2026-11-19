import {readFile,writeFile,mkdir,readdir,lstat} from 'node:fs/promises';
import path from 'node:path';
export async function copyReadable(source,destination){
 const info=await lstat(source);
 if(info.isSymbolicLink())throw Error('Symbolic links are not release inputs');
 if(info.isDirectory()){await mkdir(destination,{recursive:true});for(const entry of await readdir(source))await copyReadable(path.join(source,entry),path.join(destination,entry));return;}
 if(!info.isFile()||info.size===0)throw Error('Empty or unsupported release input');
 const bytes=await readFile(source);
 if(bytes.subarray(0,64).toString('ascii').includes('E-SafeNet'))throw Error('Release input requires authorized decryption');
 if(/\.svg$/i.test(source)&&!bytes.toString('utf8',0,256).includes('<svg'))throw Error('Invalid SVG release input');
 await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,bytes);
 if(!(await readFile(destination)).equals(bytes))throw Error('Readable copy verification failed');
 return bytes;
}
