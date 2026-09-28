const gmCommand = /^\/gm(?:\s|$)/i;
const grantId = /^[A-Za-z0-9_-]{1,128}$/;
const noticeStatuses = new Set(['pending','saved','error','help']);

export function chatSubmission(value, cryptoProvider = globalThis.crypto) {
  const text = String(value).trim();
  const keepOpen = gmCommand.test(text.normalize('NFKC'));
  if (!text) return {message:null, keepOpen:false};
  const message = {type:'chat', text};
  if (keepOpen) {
    // getRandomValues also works on an HTTP LAN origin; randomUUID may not.
    const bytes = cryptoProvider.getRandomValues(new Uint8Array(16));
    message.gmRequestId = 'gm_' + [...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
  }
  return {message, keepOpen};
}

// Called only from the current authenticated platform socket, never from a
// peer game packet or window.postMessage. The platform still owns permission.
export function routeGmSignal(message, context, notice) {
  const {room, accountId, selfPeerId, worker, leaving, workerFailed} = context;
  if (!room || !accountId || leaving || message?.roomId !== room.id || message.epoch !== room.epoch) return false;
  if (message.type === 'gm_notice') {
    if (!noticeStatuses.has(message.status) || typeof message.text !== 'string') return false;
    notice({from:{name:'GM'}, text:message.text.slice(0,500)});
    return true;
  }
  if (message.type !== 'gm_grant' || room.ownerId !== accountId || room.hostPeerId !== selfPeerId || !worker || workerFailed || typeof message.grantId !== 'string' || !grantId.test(message.grantId)) return false;
  worker.postMessage({type:'gm_grant',roomId:room.id,epoch:room.epoch,grantId:message.grantId});
  return true;
}
