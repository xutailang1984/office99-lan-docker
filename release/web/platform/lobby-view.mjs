const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
function element(tag, className, value = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = value;
  return node;
}
function makeRow() {
  const row = element('div', 'list-row');
  const icon = element('span', 'row-icon ic');
  icon.setAttribute('aria-hidden', 'true');
  const copy = element('div', 'row-copy');
  const title = element('b', 'row-title');
  const detail = element('small', 'row-detail');
  copy.append(title, detail);
  const actions = element('div', 'row-actions');
  const primary = element('button', 'secondary');
  primary.type = 'button';
  primary.dataset.action = 'open';
  const remove = element('button', 'icon-action danger-quiet');
  remove.type = 'button';
  remove.dataset.action = 'delete-adventure';
  const trash = element('span', 'icon-trash');
  trash.setAttribute('aria-hidden', 'true');
  remove.append(trash);
  actions.append(remove, primary);
  row.append(icon, copy, actions);
  row.parts = {icon, title, detail, primary, remove};
  return row;
}
function reconcile(list, models, emptyText, emptyIcon) {
  const prior = new Map([...list.children].map(node => [node.dataset.key, node]));
  const desired = new Set(models.map(model => model.id));
  for (const node of [...list.children]) if (!desired.has(node.dataset.key)) node.remove();
  let cursor = list.firstElementChild;
  for (const model of models) {
    const row = prior.get(model.id) ?? makeRow();
    row.dataset.key = model.id;
    const {icon, title, detail, primary, remove} = row.parts;
    icon.className = 'row-icon ic icon-' + model.icon; text(title, model.title); text(detail, model.detail);
    title.title = model.title;
    text(primary, model.label);
    primary.disabled = model.disabled;
    primary.title = model.reason ?? '';
    primary.onclick = model.open;
    remove.hidden = !model.remove;
    remove.disabled = !model.canRemove;
    remove.title = model.canRemove ? model.removeLabel : '先结束这个冒险的房间，再删除';
    remove.setAttribute('aria-label', (model.removeLabel ?? '删除进度') + '：' + model.title);
    remove.onclick = model.remove;
    if (row !== cursor) list.insertBefore(row, cursor);
    cursor = row.nextElementSibling;
  }
  if (!models.length) {
    const empty = element('div', 'empty-state');
    const icon = element('span', 'ic icon-' + emptyIcon);
    icon.setAttribute('aria-hidden', 'true');
    empty.append(icon, document.createTextNode(emptyText));
    list.append(empty);
  }
}
export function renderLobby({account, adventures, rooms, capacity, busy, onContinue, onJoin, onDelete}) {
  text(document.getElementById('adventure-count'), capacity?`${capacity.progressUsed}/${capacity.progressLimit}`:String(adventures.length));
  text(document.getElementById('room-count'), String(rooms.length));
  reconcile(document.getElementById('adventure-list'), adventures.map(item => {
    const mine = item.ownerId === account.id;
    const active = !!item.roomId;
    return {id:item.id, title:item.title, icon:'home',
      detail:`第 ${item.dayIndex ?? item.day ?? 1} 天 · ${({PREP:'整备',DAY:'搜集',RETURN:'返程',NIGHT:'守夜',RECOVERY:'重建',COMPLETE:'已完成'})[item.phase]??'整备'} · ${mine ? '我创建的' : '队友创建的'}${active ? ' · 房间已开启' : item.revision ? ' · 已保存' : ''}`,
      label:active ? '加入' : mine ? '继续' : '等待房主',
      disabled:busy || (!mine && !active),
      reason:!mine && !active ? '等创建者开启房间后，就能继续这次冒险' : '',
      open:() => active ? onJoin(item.roomId) : onContinue(item),
      remove:() => onDelete(item),
      removeLabel:mine ? '删除这次冒险' : '删除我的进度',
      canRemove:(!mine || !active) && !busy};
  }), '还没有冒险。点击右上角新建。', 'home');
  reconcile(document.getElementById('room-list'), rooms.map(item => {
    const full = item.members.length >= item.maxPlayers;
    const practice=item.mode==='mission';
    const progressFull=!practice&&capacity&&capacity.progressUsed>=capacity.progressLimit&&!adventures.some(a=>a.id===item.adventureId);
    const host=item.members.find(member=>member.accountId===item.ownerId)?.name??'房主';
    return {id:item.id, title:item.title, icon:'users',
      detail:`${practice?'体验 · '+host+'创建 · ':''}${item.members.length}/${item.maxPlayers} 人 · ${item.status === 'running' ? '游玩中 · 可加入' : '等队友准备'}`,
      label:full ? '房间已满' : '加入', disabled:busy || full || progressFull,
      reason:full ? '等有队员离开后再加入' : progressFull?'已有5份进度，先删除一份再加入新冒险':'',
      open:() => onJoin(item.id), remove:null, canRemove:false};
  }), '暂无房间。新建多人冒险，邀请同事加入。', 'users');
}
