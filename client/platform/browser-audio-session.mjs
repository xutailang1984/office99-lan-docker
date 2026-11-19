// One audio device context per launcher page, shared by successive game iframes.
// Encoded buffers and decode promises belong to the launcher realm.
export function createBrowserAudioSession({AudioContextClass=globalThis.AudioContext??globalThis.webkitAudioContext,OfflineAudioContextClass=globalThis.OfflineAudioContext??globalThis.webkitOfflineAudioContext}={}){
 const encodedAssets=new Map(),decodedAssets=new Map(),decodeJobs=new Map();let context=null,decoder=null,closing=null;
 return {encodedAssets,decodedAssets,get context(){return context;},
  ensure(){if(!AudioContextClass)return null;if(!context||context.state==='closed'){try{context=new AudioContextClass();}catch{return null;}}return context;},
  cacheEncoded(relative,data){if(!encodedAssets.has(relative)){const copy=new Uint8Array(data.byteLength);copy.set(new Uint8Array(data));encodedAssets.set(relative,copy.buffer);}return encodedAssets.get(relative);},
  decode(relative,data){if(decodedAssets.has(relative))return Promise.resolve(decodedAssets.get(relative));if(!decodeJobs.has(relative)){let audio=decoder;if(!audio&&OfflineAudioContextClass){try{audio=decoder=new OfflineAudioContextClass(1,1,48000);}catch{}}audio??=this.ensure();if(!audio)return Promise.reject(Error('Audio unavailable'));decodeJobs.set(relative,audio.decodeAudioData(this.cacheEncoded(relative,data).slice(0)).then(buffer=>{decodedAssets.set(relative,buffer);return buffer;}).finally(()=>decodeJobs.delete(relative)));}return decodeJobs.get(relative);},
  close(){if(!context)return closing??Promise.resolve();const retiring=context;context=null;retiring.onstatechange=null;return closing=retiring.state==='closed'?Promise.resolve():retiring.close().catch(()=>{});}
 };
}
