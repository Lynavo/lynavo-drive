# Mobile 诊断包说明

本文件说明 iPhone 端“导出诊断包”当前包含什么、怎么看、有什么限制。

## 1. 导出形式

mobile 端诊断包导出为一个 zip 文件，命名类似：

- `SyncFlow-Mobile-Diagnostics-20260325-214928.zip`

导出入口：

- app 设置页
- `支持与诊断 -> 导出诊断包`

导出后走系统分享面板，方便直接发给开发或测试负责人。

## 2. 当前包含的文件

### 2.1 `diagnostics.json`

核心运行时快照，包含：

1. `generatedAt`
2. `app`
   - app 名称
   - 版本号
   - build number
3. `device`
   - iOS 设备信息
4. `client`
   - `clientId`
   - 当前显示名
   - 是否存在 pairing token
   - 当前优选 IPv4
5. `runtime`
   - `applicationState`
   - `bindingState`
   - `syncOverview`
   - `queueCount`
   - `photoAuthorization`
   - `sidecarHost`
   - `activeSession`
   - `recentRetry`
   - `recentError`

### 2.2 `queue.json`

当前只读 pending 队列快照。

每条至少包含：

- `fileKey`
- `filename`
- `fileSize`
- `mediaType`
- `status`
- `isCloudAsset`

用途：

1. 判断是否真的还有很多 pending
2. 判断当前是否有 `uploading / preparing / cloud_downloading`
3. 判断问题是不是 iCloud 素材

### 2.3 `history.json`

当前 mobile 历史页快照，用于判断：

1. 历史是否有记录
2. 分桶是否正常
3. 设备名/IP 是否错位

### 2.4 `engine.log`

原生日志 ring buffer 快照。

重点模块：

- `SyncEngine`
- `DiscoveryService`
- `SyncPipeline`
- `SyncUpload`
- `Diagnostics`

### 2.5 `syncflow.db`

mobile 本地 SQLite 快照。

如存在，也会同时带上：

- `syncflow.db-wal`
- `syncflow.db-shm`

这是最有价值的排障材料之一，不建议为控体积过早删掉。

## 3. 当前关键字段解释

### 3.1 `runtime.bindingState`

用于看当前绑定和连接层状态。

最关键字段：

- `deviceId`
- `deviceName`
- `deviceAlias`
- `host`
- `port`
- `connectionState`

### 3.2 `runtime.syncOverview`

用于看当前 UI 看到的同步概览。

最关键字段：

- `currentDeviceId`
- `currentDeviceName`
- `currentSpeedMbps`
- `transferredBytes`
- `totalBytes`
- `progressPercent`
- `uploadState`

### 3.3 `runtime.activeSession`

用于判断是否真的处在活跃同步轮次内。

包含：

- 当前 `sessionId`
- 当前 `state`
- 当前活跃队列项
- 如本地 DB 中有活跃持久化会话，也会附上 `persistedSession`

### 3.4 `runtime.recentRetry` / `runtime.recentError`

用于判断最近一次：

- 重试发生在什么时候
- 是因为什么进入 retry
- 最近一次错误是什么

这对“提示连接失败，但几秒后又恢复”“频繁重连”“某轮上传突然停住”很关键。

## 4. 当前大小控制

当前没有硬上限，但有软控制：

1. `engine.log` 是 ring buffer
2. `diagnostics.json / history.json` 是快照
3. `queue.json` 当前是整份 pending 队列
4. `syncflow.db` 是整库副本

所以体积最不可控的通常是：

1. `queue.json`
2. `syncflow.db`

目前策略是优先保留数据库完整性，方便排障。

## 5. 适合排查的问题

这份包现在足够定位这几类问题：

1. app 到底是不是最新 build
2. 当前是否真的有大量 pending
3. 是不是队列很多但没有真实 `uploading`
4. 当前实际 sidecar 地址是什么
5. 是否是 iCloud 素材
6. 最近一次错误/重试是什么
7. 当前是否真的在一个活跃会话里

## 6. 当前限制

仍然有这些限制：

1. 日志是 ring buffer，不保证覆盖很早之前的完整历史
2. 包里没有 sidecar 端信息；需要和 desktop 诊断包配合看
3. 旧历史分桶问题如果已经落进本地聚合表，诊断包只能看到当前结果，不能自动纠偏

## 7. 推荐联动材料

远程排查时，优先同时收：

1. mobile 诊断包
2. desktop 诊断包
3. 当时的版本号
4. 简短复现描述

只收单边材料时，优先级是：

1. `diagnostics.json`
2. `queue.json`
3. `engine.log`
4. `syncflow.db`
