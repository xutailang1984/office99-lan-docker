# Survival / PvE MVP 服务端协议 0.3

独立 `/survival/ws`，与 v0.2 钓鱼服的数据和状态隔离。导出 `createSurvivalService({saveDir,configPath,savePolicy:'continuous',...})`；返回 `handleUpgrade(req,socket,head)`、`stop()`、`status()`。保存为任意阶段每2秒整世界一致快照，正常 stop 等待保存；零客户端在线暂停模拟，离线时间不推进世界。房主客户端离开不停止服务，房主权限转交其他在线持久槽。

## 连接与输入

`hello {type:'hello',name,token?}` → `welcome {type:'welcome',token,selfId,slotId,spectator,protocolVersion:3,build:'0.3.0',catalog,world}`。token 仅客户端保留，服务端只存哈希。没有空持久槽时 `ROOM_FULL`；战斗阶段的新身份可先观战，安全阶段自动分配空槽及首次装备。

持续输入10～30Hz：`{type:'input',seq,dx,dz,yaw,pitch,sprint,crouch,jump,fire,ads,reel,interact}`。方向分量[-1,1]，yaw/pitch为弧度；每个缺省布尔字段为false。jump以按下沿触发；fire按武器冷却处理，reel控制按住收线，interact维持已经开始的搜索/工作/救援。输入500ms未更新则停止输入。身份完全由WebSocket连接映射决定。

离散命令：`{type:'command',requestId,command,targetId?,expectedRevision?,payload?}`。requestId是该槽位单调递增正整数，重连后从 `players[].requestHighWater+1` 继续。最近256个结果可幂等重放；旧序号不重新执行。结果为 `{type:'result',requestId,ok,code?,message,data?}`。

| command | targetId / payload |
|---|---|
| Ready | `payload.ready:boolean` |
| StartDay | 房主，全体在线槽已准备；或PREP到时自动开始 |
| Settings | 房主，`payload.friendlyFire:boolean` |
| Cast | `payload.poolId` 或 targetId鱼池ID；可含瞄准水点x/z |
| Hook / CancelFish | 无；Hook在BITE提竿，之后input.reel控制张力 |
| Fire | `payload.yaw,pitch,ads?`；不接受命中/伤害结果 |
| Reload / Melee / UseBandage | Melee可带payload.yaw/pitch |
| SwitchEquip | `payload.slot:'weapon'|'rod'|'melee'` 切手持；或 `payload.itemId` 将背包装备换入对应装备槽 |
| Search | targetId为材料节点或宝箱，开始1秒按住交互 |
| Pickup | targetId为地面容器/尸包/回收箱；`payload.itemId?,quantity?`，缺省拾取可放部分；银鱼实体可直接targetId收起 |
| Transfer | `payload.itemId,toContainerId,quantity?`；仅自己的背包/装备与附近仓储之间 |
| Deposit | 附近终端，交付背包钓获/宝物/scrap；回收箱targetId时领取其货币/材料余额 |
| Buy | `payload.definitionId,replace?:boolean`；购买rod_pro时replace可把旧竿移入背包 |
| Upgrade | targetId为自己的枪实例或建筑；开始4秒按住交互并预留预算 |
| Repair / Rebuild | targetId建筑；按住交互，修复可连续结算每2秒一笔 |
| ToggleGate | targetId G01 |
| Revive | targetId倒地玩家；按住交互6秒 |
| RecoveryWork | targetId残骸任务或core；按住交互完成免费劳动 |
| ClaimTool | `payload.definitionId:'rod_basic'|'knife'`；安全点领取本槽唯一借用工具 |
| CancelWork | 取消治疗/工作/救援并释放预留 |
| Save | 请求一致快照；无单独角色存档 |
| NewAdventure | 仅COMPLETE房主，`payload.confirm:true`，保留旧world快照并新world_id |

## 10Hz全量状态

```text
{
 type:'state', protocolVersion:3, build:'0.3.0', snapshotId, serverTick, time,
 worldId, contentVersion, phase, phaseElapsed, phaseRemaining, dayIndex,
 threatStage, lockedPlayerCount, waterY, paused, hostId, friendlyFire,
 save:{policy:'continuous',sequence,lastSavedAt,pending,error,fallback},
 bank:{credits,materials,reservedCredits,reservedMaterials,revision},
 players:[{
   id,slotId,name,connected,ready,lifeState:'ALIVE'|'DOWNED'|'DEAD_WAIT',
   x,y,z,yaw,pitch,hp,stamina,oxygen,swimming,crouching,sprinting,inputAck,
   respawnRemaining,downedRemaining,revivesUsed,heldSlot,
   equipment:{weapon:containerId,rod:containerId,melee:containerId},
   backpackId,requestHighWater,reload:{remaining,loaded}|null,
   work:{kind,targetId,progress,duration}|null,
   fishing:{id,poolId,state:'CAST'|'WAIT'|'BITE'|'REEL'|'LAND',
     progress,tension,remaining,struggling}|null
 }],
 items:[{id,definitionId,quantity,level,magazineAmmo,containerId,loanOwnerSlotId?,revision}],
 containers:[{id,type,slotLimit,itemIds,ownerSlotId?,x?,y?,z?,createdDay?,
   expiresAfterDay?,recoverableC?,recoverableM?,revision}],
 buildings:[{id,socketId,definitionId,x,y,z,yaw,level,hp,maxHp,gateOpen,revision}],
 enemies:[{id,definitionId,x,y,z,yaw,hp,maxHp,state,phaseRemaining,night,
   radius,weak,attackRadius,attackKind,revision}],
 projectiles:[{id,x,y,z,vx,vy,vz,radius}],
 nodes:[{id,kind,x,y,z,state,containerId?,revision}],
 pools:[{id,type,x,y,z,radius,quota,activeLines,submerged}],
 recovery:{defeatId,destroyedSockets,debris:[{id,x,y,z,done}],coreReady}|null,
 night:{id,waveIndex,pending,spawned,remaining,bossId,addsSpawned},
 statistics:{daysSurvived,fishLanded,kills,shotsFired,deaths,breaches},
 world:{boundaryRadius,mainlandRadius,mainlandHeight,outerHeight,
   terminals:[{id,type,x,y,z}],spawn:{x,y,z},emergency:{x,y,z}}
}
```

`catalog`来自配置，只在welcome提供：items/weapons/rods/buildings/fishing/player/cycle/construction/recovery/weaponUpgrade/melee；静态中文名称由客户端内容表映射definitionId。敌方预兆由state、phaseRemaining、attackRadius、attackKind、yaw驱动。背包/装备/仓储仅引用全局唯一item.id。

## 事件与错误

事件：`{type:'event',eventId,serverTick,eventType,entityId?,revision?,requestId?,payload}`；类型 Spawned/Removed/Hit/Shot/LifeChanged/FishingChanged/InventoryChanged/TransactionResult/BuildingChanged/PhaseChanged/BreachResolved/RecoveryChanged/SaveResult/Notice。命中payload带actorId、targetId、damage、position及必要枪线from/to；不得由客户端回传为伤害依据。

错误code：OUT_OF_RANGE、WRONG_PHASE、NOT_ALIVE、NO_CAPACITY、NO_FUNDS、NOT_FOUND、STALE_REVISION、BUSY、NO_AMMO、INVALID_TARGET、SAVE_FAILED、REQUEST_EXPIRED、HOST_ONLY、ROOM_FULL、UNKNOWN_PROFILE。服务端给中文message，客户端直接显示。未知旧token不得创建替代角色或覆盖原凭证。

状态字段只做加法；任何必须改名或改变交易语义的调整先通知根代理。

## 网页后台标签页的快照确认

正式客户端 hello 发送 snapshotAck:true。每个 WebSocket 连接的 state.snapshotId 是递增传输编号，serverTick 仍代表模拟 tick。客户端完整处理 state 后回显 snapshot_ack 和相同整数 snapshotId；只有当前未确认编号能解除发送窗口。

每个连接最多一份未确认快照。等待期间丢弃过时状态，在确认后的下一次 10Hz 调度发送最新完整状态。暂停、新冒险、观战与安全期晋升也遵守同一规则；重连新建窗口，旧客户端可不启用该能力。命令结果和错误独立于状态窗口，后台不需要积攒过去的战斗表现。客户端为完整世界设置 8 MiB 有界接收缓冲。

确认等待超过真实1秒时，此连接跳过过时的广播event，不积攒战斗动画；命令result/error和直接SaveResult仍送达。ACK解除后恢复及时事件，下一份完整state还原当前事实，不补播离线期间的动作。
