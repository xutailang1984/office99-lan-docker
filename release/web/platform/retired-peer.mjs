// Only suppress a contextual rejection for a peer this room actually retired.
// Unknown targets and other errors remain visible; server authorization is unchanged.
const boundedId=value=>typeof value==='string'&&value.length>0&&value.length<=128;
export function roomHasPeer(room,id){return boundedId(id)&&Array.isArray(room?.members)&&room.members.some(m=>m.peerId===id);}
export function rememberRetiredMembers(previous,next,retired){
 if(!previous||!next||previous.id!==next.id||previous.epoch!==next.epoch)retired.clear();
 else for(const member of previous.members??[])if(boundedId(member.peerId)&&!roomHasPeer(next,member.peerId))retired.add(member.peerId);
 for(const member of next?.members??[])retired.delete(member.peerId);
 while(retired.size>128)retired.delete(retired.values().next().value);
}
export function isRetiredRelayNotice(message,room,retired){
 return message?.type==='relay_error'&&message.code==='NOT_MEMBER'
  &&boundedId(message.roomId)&&message.roomId===room?.id
  &&Number.isSafeInteger(message.epoch)&&message.epoch>0&&message.epoch===room?.epoch
  &&boundedId(message.to)&&retired instanceof Set&&retired.has(message.to)
  &&!roomHasPeer(room,message.to);
}
