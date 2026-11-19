const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const failureCodes = new Set(['GM_BALANCE_LIMIT','GM_GRANT_LIMIT','GM_NOT_READY','GM_NOT_MEMBER','GM_BUSY','GM_SAVE_FAILED','GM_REPLAY_MISMATCH']);

// A grant is verified using the current host's cookie. Peer packets never
// enter this controller, and there is no locally trusted resource payload.
export function createGmGrantController({getRuntime, fetcher = (...args)=>fetch(...args)}) {
  const pending = new Map(), requests = new Set();
  let generation = 0;
  function cancel() {
    generation++;
    pending.clear();
    for (const request of requests) request.abort();
    requests.clear();
  }
  function receive(message) {
    const owner = getRuntime(), room = owner?.room;
    if (message?.type !== 'gm_grant' || !owner || owner.stopping || !room || !validId(message.grantId) || message.roomId !== room.id || message.epoch !== room.epoch) return Promise.resolve({ok:false});
    const version = generation, roomId = room.id, epoch = room.epoch, hostPeerId = room.hostPeerId;
    const key = roomId + ':' + epoch + ':' + message.grantId;
    if (pending.has(key)) return pending.get(key);
    const current = () => version === generation && getRuntime() === owner && !owner.stopping && owner.room?.id === roomId && owner.room.epoch === epoch && owner.room.hostPeerId === hostPeerId;
    async function waitForCurrentSave() {
      if (!owner.saving) return;
      const controller = new AbortController();
      requests.add(controller);
      const interrupted = new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error('GM_SAVE_WAIT_ENDED')),{once:true}));
      const timer = setTimeout(()=>controller.abort(),8000);
      try {
        // Ordinary autosave may overlap verification. Wait without retrying or
        // issuing another ticket; a rejected save still needs explicit retry.
        while (owner.saving) {
          if (!current()) throw Error('GM_CONTEXT_CHANGED');
          await Promise.race([owner.saving,interrupted]);
        }
      } finally {clearTimeout(timer);requests.delete(controller);}
    }
    async function post(action, failureCode) {
      if (!current()) throw Error('GM_CONTEXT_CHANGED');
      const controller = new AbortController();
      requests.add(controller);
      const timer = setTimeout(()=>controller.abort(),8000);
      try {
        const response = await fetcher('/api/platform/rooms/' + encodeURIComponent(roomId) + '/gm/' + action, {
          method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({grantId:message.grantId,epoch,...(action === 'fail' && failureCodes.has(failureCode) ? {code:failureCode} : {})}),signal:controller.signal
        });
        if (!response.ok) throw Error('GM_REQUEST_REJECTED');
        return action === 'verify' ? await response.json() : null;
      } finally {clearTimeout(timer);requests.delete(controller);}
    }
    let operation;
    operation = Promise.resolve().then(async()=>{
      try {
        const result = await post('verify');
        if (!current()) return {ok:false};
        const grant = result?.grant;
        if (!grant || grant.id !== message.grantId || grant.roomId !== roomId || grant.epoch !== epoch || grant.hostPeerId !== hostPeerId) throw Error('GM_GRANT_MISMATCH');
        await waitForCurrentSave();
        if (!current()) return {ok:false};
        const saved = await owner.applyGmGrant(grant);
        if (!current()) return {ok:false};
        if (saved?.ok !== true) throw Error('GM_SAVE_NOT_CONFIRMED');
        await post('complete');
        return {ok:current()};
      } catch (error) {
        // A verify/save/ack failure is private GM feedback, not a fatal game
        // simulation error. Retrying the same ticket uses the durable receipt.
        if (current()) {try {await post('fail',error?.code);} catch {}}
        return {ok:false};
      } finally {if (pending.get(key) === operation) pending.delete(key);}
    });
    pending.set(key,operation);
    return operation;
  }
  return {receive,cancel};
}
