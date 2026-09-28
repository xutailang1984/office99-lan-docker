// Pure resource accounting for grants already verified by the platform adapter.
// This module contains no account allowlist, transport, or persistent credentials.
export const GM_GRANT_LIMIT = 1_000_000;
export const GM_BANK_LIMIT = 99_999_999;
export const GM_LEDGER_LIMIT = 512;

export class GmGrantError extends Error {
  constructor(code, message) { super(message); this.name = 'GmGrantError'; this.code = code; }
}
const need = (condition, code = 'GM_INVALID_GRANT', message = '资源票据无效') => {
  if (!condition) throw new GmGrantError(code, message);
};
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const keysAre = (value, keys) => plain(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 128
  && !/[\u0000-\u0020\u007f]/.test(value);
const grantKeys = ['id', 'roomId', 'epoch', 'hostPeerId', 'peerId', 'accountId', 'resources'];

export function normalizeGmGrant(value) {
  need(keysAre(value, grantKeys));
  need(typeof value.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id));
  need(['roomId', 'hostPeerId', 'peerId', 'accountId'].every(key => identifier(value[key])));
  need(Number.isSafeInteger(value.epoch) && value.epoch > 0);
  need(keysAre(value.resources, ['credits', 'materials']));
  const {credits, materials} = value.resources;
  need([credits, materials].every(n => Number.isSafeInteger(n) && n >= 0 && n <= GM_GRANT_LIMIT));
  need(credits > 0 || materials > 0);
  return {id:value.id.toLowerCase(), roomId:value.roomId, epoch:value.epoch,
    hostPeerId:value.hostPeerId, peerId:value.peerId, accountId:value.accountId,
    resources:{credits:credits || 0, materials:materials || 0}};
}

export const sameGmGrant = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function gmLedger(state) {
  if (state.gmGrants === undefined) return [];
  need(Array.isArray(state.gmGrants) && state.gmGrants.length <= GM_LEDGER_LIMIT,
    'GM_INVALID_LEDGER', '资源票据记录无效');
  const ids = new Set();
  return state.gmGrants.map(value => {
    let row;
    try { row = normalizeGmGrant(value); }
    catch { throw new GmGrantError('GM_INVALID_LEDGER', '资源票据记录无效'); }
    need(!ids.has(row.id), 'GM_INVALID_LEDGER', '资源票据记录重复'); ids.add(row.id);
    return row;
  });
}

export function findGmReceipt(state, grant) {
  const row = gmLedger(state).find(row => row.roomId === grant.roomId && row.epoch === grant.epoch && row.id === grant.id);
  if (row) need(sameGmGrant(row, grant), 'GM_REPLAY_MISMATCH', '同一票据不能修改内容');
  return row ?? null;
}

export function grantGmResources(world, grant) {
  const prior = findGmReceipt(world.s, grant);
  if (prior) return prior;
  // A room/epoch is independently authorized. Keep all receipts in that scope;
  // never evict a current-room ID, which would allow that ticket to mint twice.
  const ledger = gmLedger(world.s).filter(row => row.roomId === grant.roomId && row.epoch === grant.epoch);
  need(ledger.length < GM_LEDGER_LIMIT, 'GM_GRANT_LIMIT', '本房间发放次数已满，请保存后重新开房');
  const bank = world.s.bank;
  for (const key of ['credits', 'materials']) need(Number.isSafeInteger(bank[key]) && bank[key] >= 0
    && Number.isSafeInteger(bank[key] + grant.resources[key]) && bank[key] + grant.resources[key] <= GM_BANK_LIMIT,
  'GM_BALANCE_LIMIT', '共享资源已达到上限');
  need(Number.isSafeInteger(bank.revision) && bank.revision >= 0 && Number.isSafeInteger(bank.revision + 1),
    'GM_INVALID_LEDGER', '共享资源记录无效');
  const receipt = normalizeGmGrant(grant);
  bank.credits += receipt.resources.credits; bank.materials += receipt.resources.materials; bank.revision++;
  world.s.gmGrants = [...ledger, receipt]; world.requestSave = true;
  return structuredClone(receipt);
}
