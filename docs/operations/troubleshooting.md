# SyncFlow 排障手册

本文件给接手同事一个统一的排障入口。优先用“分层定位”而不是盲猜。

## 1. 先看哪一层

遇到问题时，先判断问题属于哪一层：

1. **desktop / sidecar 层**
   - Mac 没监听、没广播、签名包打不开、共享检测错误
2. **mobile 发现 / 绑定层**
   - 扫不到设备、连接失败、重启 app 后恢复
3. **mobile 队列 / 导出层**
   - 队列很多但不起传、iCloud 下载慢、列表状态不对
4. **传输层**
   - `FILE_ACK timeout`、重连、续传、hash mismatch
5. **统计 / UI 层**
   - 今天/昨天不一致、完成时间显示异常、detail 分页/排序问题

## 2. 先收什么材料

### 2.1 Desktop / sidecar

优先要：

1. desktop 诊断包
2. 当前 signed DMG 或运行的 app 版本
3. `desktop-main.log`
4. `sidecar.db`

### 2.2 Mobile

优先要：

1. mobile 诊断包 zip
2. app 版本 / build
3. 当时是前台还是后台
4. 是否存在 iCloud 素材

## 3. 常见问题判断路径

## 3.1 “app 提示连接失败，重启后恢复”

先看：

1. sidecar 是否健康
2. 日志里是否有 `HELLO_REQ / AUTH_REQ` 成功
3. 是否真正进入 `SYNC_BEGIN`
4. mobile 诊断包里是否还有大量 pending

高概率根因：

- app 主循环没有从本地 pending 队列继续推进
- 鉴权成功后没有进入真实同步轮次
- UI 最终落成了“连接失败”而不是“等待下一轮”

不是这类问题时才考虑：

- sidecar 真不可达
- pairing 失效
- desktop 端口未监听

## 3.2 “队列很多，但 `queueCount=1` 或传完一条就停住”

这是一个非常典型的 mobile 队列问题。

检查：

1. mobile `queue.json` 是否仍有大量 pending
2. sidecar 日志里的 `sync session started ... queueCount=` 是多少
3. 是否传完一个文件后没有立即起下一条

高概率根因：

- app 真实上传集合没有从 pending 队列构建
- 只拿了本轮新扫描素材

## 3.3 “显示断开连接，但又继续上传”

分两件事看：

1. 是否真有 `FILE_ACK timeout` 或短重连
2. 重连是否几秒内恢复，文件是否继续完成

如果是短时自动恢复：

- 这是“真实短重连 + UI 文案过重”
- 应视为“正在重连”，不是最终失败

## 3.4 “发现页能扫到设备，但实际连不上”

先查：

1. sidecar 是否真的监听 `39393 / 39394`
2. 本机是否有残留的 `dns-sd` Bonjour 广播孤儿进程
3. mobile 实际选到的是 IPv4 还是 `fe80::` IPv6

历史上常见根因：

- 残留 `dns-sd` 导致假在线
- 旧路径优先用了 `fe80::` link-local IPv6

## 3.5 “同一天统计在 app 和 PC 不一致”

先对总量：

1. 文件数总量是否一致
2. 总字节数是否一致

如果总量一致但分桶不一致：

- 先怀疑是历史分桶口径不一致
- 当前正确口径应以 sidecar/Mac 完成日为准

## 3.6 “iCloud 素材看起来卡住”

先确认：

1. 队列项是否标记 `iCloud`
2. 当前状态是否是 `cloud_downloading / preparing`
3. 并不是已经进入真实上传但网络无流量

iCloud 问题通常卡在导出阶段，而不是 TCP 传输阶段。

## 4. 关键日志关键词

### 4.1 正常进入同步

- `startSync`
- `scan result`
- `pending assets`
- `TCP connected`
- `auth successful`
- `sync session started`
- `FILE_INIT_REQ`

### 4.2 典型异常

- `FILE_ACK timeout`
- `ACK_WAIT_FAILED`
- `backoff_waiting`
- `reconnecting in`
- `file already completed, skipping`
- `Network is down`
- `EOF`

## 5. 什么时候怀疑哪一端

### 5.1 先怀疑 sidecar

当出现：

1. `39393 / 39394` 根本没监听
2. `desktop-main.log` 明确报 sidecar 启动失败
3. 多台设备同时受影响
4. DMG 安装后 sidecar 本体就没跑起来

### 5.2 先怀疑 mobile

当出现：

1. `HELLO / AUTH` 成功但没有 `SYNC_BEGIN`
2. 队列很多但 `queueCount` 异常小
3. 文件切换后顶部状态残留
4. 重启 app 后恢复

### 5.3 先怀疑 UI

当出现：

1. 统计总量一致，但某个页面显示不一致
2. 传输仍在推进，但文案提示已失败
3. 排序、分页、滚动等表现异常

## 6. 最小排查顺序

每次遇到线上问题，建议按这个顺序走：

1. 看版本：desktop build、mobile build 是否对齐
2. 看 desktop 诊断包
3. 看 mobile 诊断包
4. 对照是否进入了 `SYNC_BEGIN`
5. 对照 queue 真实来源是不是 pending 队列
6. 再决定是修 sidecar、mobile 状态机，还是 UI 映射
