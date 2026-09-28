// Room-scoped fallback transport only. No simulation, persistence, or credential logging.
export const RELAY_LIMITS=Object.freeze({packetBytes:16384,controlBytes:256,ackPackets:30,resyncPackets:2,readyPackets:4,guestPackets:120,guestBytes:128*1024,hostPackets:1500,hostBytes:4*1024*1024,bufferBytes:2*1024*1024});
const guestTypes=new Set(['hello','input','command','snapshot_ack','state_resync','client_ready']);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function createRelayRouter({now=Date.now,getRoom,getPeer,isCurrent,sessionActive,isStopping=()=>false,limits={}}){
 const cap={...RELAY_LIMITS,...limits},routes=new WeakMap(),rates=new WeakMap(),notices=new WeakMap();
 const output=(peer,value)=>{if(peer?.ws?.readyState!==1)return false;if(peer.ws.bufferedAmount>cap.bufferBytes){peer.ws.close(4008,'Relay receiver too slow');return false;}peer.ws.send(JSON.stringify(value));return true;};
 const fail=(peer,code,message,context={})=>{const at=now();if((notices.get(peer)??-Infinity)+250>at)return;notices.set(peer,at);output(peer,{type:'relay_error',code,message,...context});};
 const quota=(peer,host,bytes,opening,control=null)=>{const at=now();let row=rates.get(peer);if(!row||at-row.at>=1000){row={at,packets:0,bytes:0,opens:0,acks:0,resyncs:0,readies:0};rates.set(peer,row);}if(opening)return ++row.opens<=(host?16:4);
  // A background tab can release hundreds of queued inputs at once. Its sole
  // ACK must reach the Worker independently or that snapshot baseline stalls.
  if(control==='snapshot_ack')return ++row.acks<=cap.ackPackets;
  if(control==='state_resync')return ++row.resyncs<=cap.resyncPackets;
  if(control==='client_ready')return ++row.readies<=cap.readyPackets;
  row.packets++;row.bytes+=bytes;return row.packets<=(host?cap.hostPackets:cap.guestPackets)&&row.bytes<=(host?cap.hostBytes:cap.guestBytes);};
 function handle(peer,message){
  if(!plain(message)||!['relay_open','relay'].includes(message.type))return false;
  if(isStopping()||!isCurrent(peer)||!sessionActive(peer))return true;
  const room=getRoom(peer.roomId),target=getPeer(message.to);
  if(!room||message.roomId!==room.id||message.epoch!==room.epoch){fail(peer,'STALE_ROOM','房间已改变，请重新加入');return true;}
  if(room.status==='running'&&room.leaseExpiresAt<=now()){fail(peer,'LEASE_EXPIRED','房主连接已过期，请回大厅重试');return true;}
  if(!room.members.has(peer.peerId)||!target||target===peer||!isCurrent(target)||!sessionActive(target)||target.roomId!==room.id||!room.members.has(target.peerId)){fail(peer,'NOT_MEMBER','转发对象不在当前房间',typeof message.to==='string'&&message.to.length>0&&message.to.length<=128?{roomId:room.id,epoch:room.epoch,to:message.to}:{});return true;}
  const host=peer.peerId===room.hostPeerId;
  if(!host&&target.peerId!==room.hostPeerId){fail(peer,'INVALID_TOPOLOGY','转发只允许队员与房主之间通信');return true;}
  const guestId=host?target.peerId:peer.peerId;let ready=routes.get(room);if(!ready){ready=new Set();routes.set(room,ready);}
  if(message.type==='relay_open'){
   if(!quota(peer,host,0,true)){fail(peer,'RATE_LIMIT','连接请求过快，请稍后重试');return true;}
   ready.add(guestId);
   // Host first, then guest. Each recipient's ordered WS stream sees ready
   // before any subsequent relayed packet, so its Runtime reset precedes hello.
   const hostPeer=host?peer:target,guestPeer=host?target:peer;
   output(hostPeer,{type:'relay_ready',roomId:room.id,epoch:room.epoch,peerId:guestId});
   output(guestPeer,{type:'relay_ready',roomId:room.id,epoch:room.epoch,peerId:room.hostPeerId});return true;
  }
  if(!ready.has(guestId)){fail(peer,'RELAY_NOT_READY','正在建立中转连接，请稍后');return true;}
  const bytes=typeof message.packet==='string'?Buffer.byteLength(message.packet):Infinity;
  if(bytes<2||bytes>cap.packetBytes){fail(peer,'INVALID_PACKET','游戏报文大小无效');return true;}
  let packet;try{packet=JSON.parse(message.packet);}catch{fail(peer,'INVALID_PACKET','游戏报文格式无效');return true;}
  if(!plain(packet)||(!host&&!guestTypes.has(packet.type))){fail(peer,'INVALID_PACKET','队员只能发送自己的输入和操作');return true;}
  if(host&&packet.__chunk!==undefined&&(!Number.isSafeInteger(packet.__chunk)||packet.__chunk<1||!Number.isSafeInteger(packet.total)||packet.total<1||packet.total>700||!Number.isSafeInteger(packet.index)||packet.index<0||packet.index>=packet.total||typeof packet.text!=='string')){fail(peer,'INVALID_PACKET','游戏分块无效');return true;}
  const control=!host&&['snapshot_ack','state_resync','client_ready'].includes(packet.type)?packet.type:null;
  if(control&&(bytes>cap.controlBytes||(control==='snapshot_ack'&&(!Number.isSafeInteger(packet.snapshotId)||packet.snapshotId<1)))){fail(peer,'INVALID_PACKET','状态确认报文无效');return true;}
  if(!quota(peer,host,bytes,false,control)){fail(peer,'RATE_LIMIT','游戏报文超过安全速率，请重新连接');if(host)peer.ws.close(4008,'Relay reliable stream exceeded limit');return true;}
  if(!output(target,{type:'relay',roomId:room.id,epoch:room.epoch,from:peer.peerId,packet:message.packet}))fail(peer,'PEER_UNAVAILABLE','队友连接暂不可用，请重新加入');
  return true;
 }
 return {handle};
}
