import {checkpointKey,pack,latest,CHECKPOINT_SCHEMA} from './checkpoint-store.mjs';

// One durable record holds two checkpoints, at most one in-flight request,
// and at most one preserved divergent checkpoint. Transaction completion is
// the local ACK. Platform revision and local sequence never share a counter.
export class LocalHostSave {
  constructor({store,room,remote,writeRemote,onStatus=()=>{},onResets=()=>{},now=()=>Date.now(),writer}){
    this.store=store;this.room=room;this.remote=remote;this.writeRemote=writeRemote;this.onStatus=onStatus;this.onResets=onResets;this.now=now;
    this.writer=writer;this.key=checkpointKey(room.ownerId,room.adventureId);this.job=null;this.lastAttempt=-Infinity;this.stopped=false;this.localRevision=0;this.remoteRevision=remote.revision;this.backupError=null;
  }
  owned(record){if(!record||record.writer!==this.writer||record.epoch!==this.room.epoch)throw Error('房主已变更，请回大厅重新进入');return record;}
  status(record,error=this.backupError){this.localRevision=latest(record)?.slot.sequence??0;this.remoteRevision=record.remoteRevision;if(!this.stopped)this.onStatus({localRevision:this.localRevision,remoteRevision:this.remoteRevision,backupPending:this.localRevision>record.backedLocalRevision,error});}
  async initialize(){
    let chosen=null,notice=null;
    const record=await this.store.update(this.key,old=>{
      if(old?.epoch>=this.room.epoch)throw Error('此冒险已在另一个页面运行，请回大厅重开');
      const local=latest(old),pending=old?.pending;
      const sameHead=old&&old.remoteRevision===this.remote.revision;
      const acknowledged=pending&&this.remote.head?.hostEpoch===pending.body.hostEpoch&&this.remote.head?.saveSeq===pending.body.saveSeq;
      const sameWorld=!this.remote.state||local?.state.worldId===this.remote.state.worldId;
      const compatible=old?.schema===CHECKPOINT_SCHEMA&&sameWorld&&(sameHead||acknowledged)&&local?.slot.sequence>=(acknowledged?pending.localRevision:old.backedLocalRevision??0);
      chosen=compatible&&local?local.state:this.remote.state;
      if(compatible&&local&&local.slot.sequence>(old.backedLocalRevision??0))notice='已接上本机保存的进度。';
      const diverged=local&&!compatible&&local.slot.sequence>(old.backedLocalRevision??0);
      if(diverged)notice='另一台电脑保存了新进度，已使用服务器存档。本机旧副本已保留。';
      if(old?.slots?.length&&!local)notice='本机副本未通过检查，已使用服务器备份。';
      const sequence=local?.slot.sequence??0;
      const slots=compatible&&local?old.slots.filter(s=>s&&Number.isSafeInteger(s.sequence)&&s.sequence<=local.slot.sequence).slice(-2):chosen?[pack(chosen,sequence+1)]:[];
      const last=latest({slots})?.slot.sequence??0;
      return {schema:CHECKPOINT_SCHEMA,ownerId:this.room.ownerId,adventureId:this.room.adventureId,epoch:this.room.epoch,writer:this.writer,slots,remoteRevision:this.remote.revision,saveSeq:0,pending:null,backedLocalRevision:compatible?(acknowledged?pending.localRevision:old.backedLocalRevision):last,conflict:diverged?local.slot:old?.conflict??null};
    });
    this.status(record);return {state:chosen,notice};
  }
  async save(state,{requireBackup=false}={}){
    if(this.stopped)throw Error('房间已经关闭');
    const record=await this.store.update(this.key,old=>{const r=this.owned(old),sequence=(latest(r)?.slot.sequence??0)+1;const slot=pack(state,sequence);r.slots=[...(Array.isArray(r.slots)?r.slots:[]).filter(s=>s&&Number.isSafeInteger(s.sequence)&&s.sequence<sequence).slice(-1),slot];return r;});
    this.status(record);
    if(requireBackup)await this.flush();else void this.backup().catch(()=>{});
    return {revision:latest(record).slot.sequence};
  }
  async backup({force=false}={}){
    if(this.job)return this.job;
    if(this.stopped||!force&&this.now()-this.lastAttempt<10000)return;
    this.lastAttempt=this.now();
    const operation=(async()=>{
      let record=await this.store.update(this.key,old=>{
        const r=this.owned(old),current=latest(r);if(!current||current.slot.sequence<=r.backedLocalRevision)return r;
        if(!r.pending)r.pending={localRevision:current.slot.sequence,body:{roomId:this.room.id,hostEpoch:this.room.epoch,baseRevision:r.remoteRevision,saveSeq:++r.saveSeq,state:current.state}};
        return r;
      });
      if(!record.pending)return;
      const request=record.pending,ack=await this.writeRemote(request.body);
      if(!Number.isSafeInteger(ack.revision)||ack.revision!==request.body.baseRevision+1||ack.saveSeq!==request.body.saveSeq)throw Error('服务器备份回执无效');
      this.owned(await this.store.read(this.key));
      if(!this.stopped)await this.onResets(ack);
      record=await this.store.update(this.key,old=>{
        const r=this.owned(old);if(r.pending?.body.saveSeq!==request.body.saveSeq)throw Error('备份请求已改变');
        r.remoteRevision=ack.revision;r.backedLocalRevision=request.localRevision;r.pending=null;return r;
      });
      this.backupError=null;this.status(record);
    })();
    this.job=operation;
    try{await operation;}catch(error){this.backupError='备份待重试';const record=await this.store.read(this.key).catch(()=>null);if(record?.writer===this.writer)this.status(record);throw error;}
    finally{if(this.job===operation)this.job=null;}
  }
  async flush(){
    // Existing unknown-ACK request must complete unchanged before the latest
    // checkpoint is sent. No unbounded queue of full-world snapshots.
    if(this.job)await this.job;
    for(let n=0;n<3;n++){
      const r=this.owned(await this.store.read(this.key));if((latest(r)?.slot.sequence??0)<=r.backedLocalRevision)return;
      await this.backup({force:true});
    }
    const r=this.owned(await this.store.read(this.key));if((latest(r)?.slot.sequence??0)>r.backedLocalRevision)throw Error('进度仍在备份，请重试');
  }
  stop(){this.stopped=true;}
}
