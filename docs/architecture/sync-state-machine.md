# SyncFlow 同步状态机

本文件记录当前系统里的主要状态机、状态含义和 UI 语义。重点是区分“探活短连”和“真实同步会话”。

## 1. 为什么要单独写这份文档

过去几类真实问题都和状态语义混淆有关：

1. app 提示连接失败，但实际几秒内自动恢复并继续上传
2. 短探活成功后 UI 过早显示“已连接”
3. 顶部显示上一文件 `100%`，但当前没有任何文件在传
4. 队列很多，但实际会话 `queueCount=1`

所以交接时必须先把状态层次分开看。

## 2. 四层状态

当前至少有四层状态，不要混为一谈：

1. **Binding / Connection state**
   - 设备发现、绑定、探活、心跳连接状态
2. **Upload state**
   - 当前同步轮次的粗粒度阶段
3. **SyncEngine internal state**
   - 原生引擎内部更细的状态机
4. **Queue item state**
   - 单个文件在本地队列中的状态

## 3. Binding / Connection State

契约定义在 `@syncflow/contracts`：

- `discovering`
- `bound`
- `connecting`
- `connected`
- `offline`

用途：

1. 发现页设备状态
2. 设置页粗粒度连接状态
3. 首页顶层连接/离线提示的输入之一

语义：

- `discovering`：正在浏览 Bonjour 服务
- `bound`：本地有绑定记录，但当前还没有活连接确认
- `connecting`：正在进行探活、心跳或同步链路连接
- `connected`：最近一次心跳或同步链路确认成功
- `offline`：最近一次连接/心跳失败

注意：

- `connected` 不等于“当前一定有一个长 TCP 会话在持续传输”
- 空闲态下，app 会做短探活和 HTTP `/presence` 心跳
- 因此 `connected` 只表示“当前这台 Mac 是可达且绑定有效的”

## 4. Upload State

`@syncflow/contracts` 里定义的是粗粒度状态：

- `idle`
- `scanning`
- `queued`
- `uploading`
- `paused`
- `retrying`
- `completed`
- `failed`

但当前移动端 UI 实际消费的是更细的原生状态字符串，包括：

- `idle`
- `scanning`
- `preparing`
- `uploading`
- `reconnecting`
- `completed`
- `paused_no_permission`

这是当前实现事实。交接后如果要继续收口，应该优先考虑把 coarse state 和 runtime state 对齐，而不是继续扩散更多字符串。

## 5. SyncEngine Internal State

内部状态枚举位于 `@syncflow/contracts` 的 `SyncEngineState`：

- `idle`
- `discovering`
- `scanning`
- `preparing`
- `syncing_foreground`
- `syncing_background`
- `backoff_waiting`
- `paused_no_target`
- `paused_no_permission`
- `stopped`

这些状态主要用于原生层调度，不是直接给最终用户展示。

## 6. Queue Item State

单文件当前会经历这些状态：

- `discovered`
- `queued`
- `preparing`
- `ready`
- `cloud_downloading`
- `uploading`
- `completed`
- `failed`
- `skipped`

关键说明：

1. `cloud_downloading` 只在 iCloud 素材导出阶段出现
2. `completed / failed / skipped` 的文件不会继续留在只读 pending 队列里
3. desktop 不直接消费这套原生状态；desktop 只看 sidecar 聚合后的上传记录

## 7. 标准同步轮次

### 7.1 正常前台同步

1. `bindingState = connecting`
2. `uploadState = scanning`
3. 相册扫描结束，新素材入队
4. 上传集合从本地 pending 队列构建
5. `uploadState = preparing`
6. `HELLO_REQ / AUTH_REQ / SYNC_BEGIN_REQ`
7. `uploadState = uploading`
8. 每个文件依次 `preparing -> cloud_downloading? -> uploading -> completed`
9. 全部结束后 `uploadState = completed`
10. 空闲轮询时回到 `idle`

### 7.2 空闲探活

空闲时 app 会：

1. 短连 TCP 以解析 sidecar host
2. 鉴权后主动断开短连接
3. 通过 HTTP `/presence` 维持“已连接”心跳

因此：

- 会看到 `HELLO / AUTH` 成功后立即 EOF
- 这本身不是 bug
- 只有当它本来应该进入 `SYNC_BEGIN` 却没有进入时，才是状态机问题

## 8. 重连语义

短时 `FILE_ACK timeout` 或网络抖动时，当前正确理解是：

1. 传输层确实发生了短暂中断
2. app 会自动进入 `backoff_waiting`
3. 数秒内可能恢复并继续上传

产品展示建议：

- 几秒内自动恢复：`网络波动，正在重连`
- 超过阈值未恢复：`连接失败` 或 `等待网络恢复`

不要把可自动恢复的短波动直接作为最终失败态。

## 9. 已知易错点

1. **短探活不等于真实同步连接**
2. **顶部进度不应残留上一文件的 100% 状态**
3. **队列 UI 和真实上传集合必须都基于 pending 队列**
4. **连接失败要和“短时自动重连”分开**
5. **冷启动时不应闪未连接/重连 banner**

## 10. 交接建议

新同事排查同步问题时，先问这 3 件事：

1. 当前看到的是短探活、真实同步，还是重连恢复？
2. UI 队列和真实 `queueCount` 是否一致？
3. 问题发生在 binding、upload 还是单文件状态层？
