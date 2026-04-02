# SyncFlow 数据模型与统计口径

本文件记录 mobile / sidecar 两端的核心持久化结构、身份语义和统计口径。

## 1. 身份语义

### 1.1 设备身份

- **iPhone 身份**：`clientId`
- 由 mobile 生成并持久化在 Keychain
- desktop 端识别“是不是同一台手机”依赖它，而不是设备名或 IP

### 1.2 设备显示名

- 系统设备名在 iOS 16+ 并不可靠
- 当前实现会为通用名生成稳定唯一名，例如 `iPhone 9C2A`
- 用户手动修改的显示名保存在 Keychain

### 1.3 双端 `deviceId`

共享 `HistoryLedgerCardDTO` 的 `deviceId` 在两端方向不同：

- desktop：`deviceId = iPhone clientId`
- mobile：`deviceId = desktop serverId`

读代码时必须注意这个方向差异。

## 2. Sidecar 数据库

sidecar SQLite 初始迁移定义在：

- `services/sidecar-go/internal/store/migrations/001_initial.sql`

### 2.1 `paired_devices`

用途：

1. 保存已绑定设备
2. 保存 `client_name / device_alias / last_ip / pairing_id / pairing_token_hash`
3. 作为 dashboard 和 detail 的设备主索引

### 2.2 `sessions`

用途：

1. 当前 sidecar 视角的同步会话
2. 记录 `state / active_file_key / active_offset / started_at / updated_at`

### 2.3 `uploads`

用途：

1. 每个 `file_key` 一条最终上传记录
2. 记录最终路径、hash、完成时间、传输耗时、已提交字节数

关键字段：

- `status`
- `part_path`
- `final_path`
- `committed_bytes`
- `active_transmission_ms`
- `completed_at`
- `updated_at`

### 2.4 `device_daily_stats`

用途：

1. 按“设备 + 日期”聚合完成记录
2. 为 desktop dashboard/history 提供快速统计

关键字段：

- `stat_date`
- `client_id`
- `client_name_snapshot`
- `client_ip_snapshot`
- `file_count`
- `total_bytes`
- `active_transmission_ms`

### 2.5 `settings` / `share_config`

用途：

1. sidecar 基础设置
2. 共享目录检测与 SMB URL 状态

## 3. Mobile 数据库

mobile SQLite 由 `UploadStore.swift` 管理。

### 3.1 `binding`

用途：

1. 当前绑定的 desktop 信息
2. 包括 `device_id / host / port / pairing_id / share_name / last_bound_at`

### 3.2 `upload_items`

用途：

1. 本地上传队列和文件级状态机
2. 当前同步主循环的真实数据来源

关键字段：

- `asset_local_id`
- `modified_at`
- `media_type`
- `original_filename`
- `file_key`
- `file_size`
- `status`
- `temp_file_path`
- `acked_offset`
- `last_error_code`
- `updated_at`

重要约束：

- pending 队列来自 `status in ('queued','discovered','preparing','ready','cloud_downloading','uploading')`
- 真实上传集合必须从这里取
- 不能只拿“本轮新扫描的素材”做上传集合

### 3.3 `sync_sessions`

用途：

1. mobile 视角的同步会话快照
2. 保存 `queue_total_count / queue_total_bytes / completed_count / completed_bytes / active_file_key`

### 3.4 `daily_ledgers`

用途：

1. mobile 历史页和首页统计
2. 保存“哪台 desktop、哪一天、传了多少”

关键字段：

- `ledger_date`
- `device_id`
- `device_name_snapshot`
- `device_ip_snapshot`
- `file_count`
- `total_bytes`
- `active_transmission_ms`

## 4. 统计口径

## 4.1 “属于哪一天”

当前统一口径：

- 以 **sidecar / desktop 完成日** 为准

原因：

1. 真正落盘发生在 desktop sidecar 接收目录
2. desktop 统计本来就依赖 sidecar
3. mobile 过去用 UTC 自己分桶，曾导致与 desktop 分桶错位

当前实现：

1. sidecar 在 `FILE_END_RES` 返回 `ledgerDate`
2. mobile 优先使用这个 `ledgerDate`
3. 只有异常 fallback 才用本地日期

## 4.2 “完成时间”

desktop detail 的完成时间来自：

- 优先 `uploads.completed_at`
- fallback 时用 `updated_at` 或文件系统 `modTime`

注意：

- UI 当前默认只显示到分钟 `HH:mm`
- 因此一批在同一分钟内完成的文件，看起来可能都是同一个时间

## 4.3 队列数量

- mobile 首页队列数字来自本地 `upload_items` pending 集合
- sidecar 的 `queueCount` 来自当前同步会话 `SYNC_BEGIN_REQ`

这两个值理论上应一致。

如果出现：

- UI 队列很多
- sidecar `queueCount=1` 或 `0`

通常说明 app 主循环的数据源错了，而不是 sidecar 丢数据。

## 5. 文件系统布局

默认接收根目录：

- macOS：`~/Library/Application Support/小豹闪传/received`
- Windows：`%AppData%\\小豹闪传\\received`

以上默认值来自 sidecar 的 `os.UserConfigDir()/小豹闪传/received`。

实际布局：

```text
received/
  <devicePath>/
    <YYYY-MM-DD>/
      <original file>
```

说明：

1. `storagePath` 指接收根目录
2. `devicePath` 指设备自己的目录
3. desktop detail“打开文件夹”应优先打开 `<devicePath>/<selectedDate>`

## 6. 设备重命名与目录名

当前约束：

1. desktop 识别设备靠 `clientId`
2. 设备名变化不应把设备识别成新设备
3. 磁盘目录迁移不是 UI rename 的唯一触发条件；需要看 sidecar 实际落盘和目录重命名逻辑

读代码时不要把：

- 设备名
- IP
- 当前目录名

误认为是设备主键。

## 7. iCloud 素材

iCloud 素材有特殊处理，但不改变数据模型主键：

1. 扫描时照常入队
2. 导出时允许系统从 iCloud 下载到本地临时文件
3. 队列项可带 `isCloudAsset` 标识
4. 导出阶段会进入 `cloud_downloading` 状态

这意味着：

- iCloud 素材会影响“准备时间”
- 但不应改变 `queueCount` 的统计语义
