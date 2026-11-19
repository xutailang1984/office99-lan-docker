# Tidal PvE 0.3 权威模块

独立冒险模块已集成到 `server/server.mjs` 的同一HTTP服务。模块自身不监听端口，存档与v0.2分开；同目录 `terrain-layout.mjs` 和客户端地图共用地形定义。

```js
import { createSurvivalService } from './survival/service.mjs';
const survival = await createSurvivalService({
  configPath: absoluteBalancePath, // client/survival/balance.json，唯一数值来源
  saveDir: absoluteSurvivalSaveDirectory,
});
// 在现有 HTTP server 的 upgrade 回调中，先交给本模块。
if (survival.handleUpgrade(req, socket, head)) return;
// 主机正常停止时，先等待该函数成功，再返回关服成功。
await survival.stop();
```

导出接口：`handleUpgrade(req,socket,head)` 只消费 `/survival/ws`；`flushSave()` 结算已收到的待处理伤害并捕获同一时刻整世界，等待写盘完成；`stop()` 幂等，先冻结输入/模拟，保存成功后关闭WS；`status()` 返回不含身份凭据的版本、人数、阶段与保存状态。失败停止仍冻结，重试stop可重新写盘。

`options.manualClock: true` 仅给进程内测试提供 `advance(seconds)`、`inspect()`，不会增加任何网络调试命令。正常构建不应传该选项。模块复用上层server已有ws依赖，不另建依赖锁或常驻辅助程序。

保存使用两份交替SHA-256完整性快照、同目录临时文件写入和回读、rename替换。先前有效世界能回退；损坏原件会保留为corrupt副本；两份均坏时拒绝创建替代世界。正常每2秒保存所有阶段；0人在线暂停模拟；离线时间不推进。停服重启不把角色当成60秒断线死亡，不另发初始装备。存档故障冻结模拟和新交易，保留内存世界并支持重试。新冒险须COMPLETE房主confirm:true，先归档旧世界后创建新worldId。

完整wire字段见 `CONTRACT.md`。本实现使用4个持久角色槽和共享实例仓储；没有任何网络指令可以指定伤害、奖励或传送位置。友伤房主开关默认关闭；host离线自动转交，独立服务器继续运行。

## 隔离验证

从项目根目录执行：

```powershell
node --test server/survival/test/*.test.mjs
```

测试只创建系统临时目录、随机loopback端口及临时WebSocket客户端，全部显式关闭与清理，不写真实存档、不使用防火墙、不启动常驻服务。`world.test.mjs` 验证实际权威模拟和状态事务；`service.test.mjs` 验证真实WS、快照磁盘I/O及故障恢复。它们不能代替两端Godot构建、真人完整合作或网络/性能验收。

## 实现范围及验收边界

已实现PREP→DAY→RETURN→NIGHT→PREP/RECOVERY/COMPLETE完整循环、四槽/观战候场/重连；三枪有限弹药和实例升级、瞄准射线/枪口遮挡、刀/绷带；张力捕鱼、有限日间资源搜索狩猎；共享预算预留、唯一归属与幂等交易；死亡包、白天空装复活、夜救援；16墙门与核心修复升级重建；三波/Boss双攻击与背部弱点/增援；失守损失、多个回收箱及免费重建；连续一致快照与故障冻结。

几何直接共用美术模块的三角插值地形、16插槽、9岩石。AI采用服务端平面路径/局部转向与阻挡墙目标；鳗无视线先侧移找角度，持久阻塞的普通夜怪有0.8秒重定位预警，Boss不常规传送。四人种子遇到拥挤时采用同资源路线的有限备用点，确保8米间距、距核心45米和可站立净空。

未在本模块职责内验证：Godot视觉/音频/完整动画及参考素材来源、720p/1080p/1440p UI、真实2–4人四阶段合作录像、100ms RTT抖动丢包、10分钟浏览器帧率/带宽/内存记录。这些不得仅凭服务器回归标成T03、T35–T40或V01–V06全部通过。最终部署与真实运行入口由根代理完成。
