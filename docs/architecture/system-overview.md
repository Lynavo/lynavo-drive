# SyncFlow 系统概览

本文件用于帮助新同事快速理解当前系统边界、职责分工和主链路。不作为产品规格文档；行为以当前代码和 `@syncflow/contracts` 为准。

## 1. 目标

SyncFlow 当前的目标非常聚焦：

1. iPhone 自动发现并绑定一台 desktop
2. 在局域网内把相册素材无感增量同步到 desktop
3. 在中断、重连、后台、锁屏等场景下尽可能自动恢复
4. 在 desktop 端提供队列、历史、存储、诊断和发布验证能力

当前范围明确限制为：

- 支持 `iPhone -> Desktop`（当前桌面端覆盖 macOS / Windows）
- 仅支持局域网传输
- 不支持用户在 UI 手动挑选、删除、跳过或调序队列
- 同一台 iPhone 同一时间只传 1 个文件

## 2. 运行时组件

### 2.1 Electron Desktop

职责：

1. 提供桌面 UI 和设置页
2. 拉起、监控和打包 sidecar
3. 通过 preload bridge 暴露 IPC API 给 renderer
4. 汇总 diagnostics、导出桌面诊断包

限制：

- renderer 不直接访问 sidecar、文件系统或 SQLite
- 所有访问都经由 main / preload 转发

关键目录：

- `apps/desktop/src/main`
- `apps/desktop/src/preload`
- `apps/desktop/src/renderer`

### 2.2 Go Sidecar

职责：

1. 提供 TCP 文件接收协议服务
2. 提供 HTTP API、WebSocket、共享检测和 dashboard 聚合
3. 管理落盘目录、续传 `.part` 文件、SQLite 持久化
4. 广播 Bonjour/mDNS，供 iPhone 发现

关键端口：

- TCP/LMUP：`39393`
- HTTP API：`39394`

关键目录：

- `services/sidecar-go/internal/server`
- `services/sidecar-go/internal/api`
- `services/sidecar-go/internal/store`
- `services/sidecar-go/internal/mdns`

### 2.3 React Native Mobile UI

职责：

1. 展示发现页、同步状态、历史、设置
2. 通过原生 bridge 调用 `SyncEngine`
3. 只承载 UI，不直接负责真实传输

关键目录：

- `apps/mobile/src/screens`
- `apps/mobile/src/navigation`
- `apps/mobile/specs`

### 2.4 iOS 原生 SyncEngine

职责：

1. 发现 desktop、维护绑定状态、心跳和短探活
2. 扫描相册、导出素材、维护本地上传队列
3. 建立 TCP 协议会话并执行文件传输、续传、重连
4. 对 RN 发出 binding、queue、sync state 和 diagnostics 事件

关键目录：

- `apps/mobile/ios/SyncEngine`

## 3. 关键数据流

## 3.1 发现

1. sidecar 通过 Bonjour 广播 `_syncflow._tcp`
2. macOS / Windows 优先使用原生 `dns-sd` 广播；Windows 缺失 Bonjour 时会回退到 zeroconf 兼容广播
3. iPhone 使用 `Network.framework` 浏览局域网服务
4. 当前实现优先使用 sidecar 广播的 IPv4 信息，避免 `fe80::` 链路本地 IPv6 误判
5. 发现列表展示的是“可探活、可连接”的设备，而不是单纯有广播的设备

## 3.2 配对

1. desktop 生成连接码并展示在设置页
2. mobile 输入连接码，向 sidecar 发起 `PAIR_REQ`
3. sidecar 保存 `paired_devices`
4. mobile 将 `pairingToken` 和 `clientId` 保存在本地（Keychain + SQLite）

设备身份约束：

- desktop 端识别同一台手机依赖 `clientId`
- 不是依赖设备名、IP 或目录名

## 3.3 上传

标准链路：

1. mobile 从 PhotoKit 扫描素材并写入本地 `upload_items`
2. 主上传轮次从本地 pending 队列构建真实上传集合
3. `SyncEngine` 建立 TCP 会话并发 `HELLO_REQ / AUTH_REQ / SYNC_BEGIN_REQ`
4. sidecar 逐文件处理 `FILE_INIT_REQ / FILE_DATA / FILE_END_REQ`
5. sidecar 落盘并在 `FILE_END_RES` 中返回最终结果与 `ledgerDate`
6. mobile 更新本地历史与队列状态
7. desktop 通过 sidecar HTTP / WebSocket 读取聚合结果

关键约束：

- 上传集合必须来自本地 pending 队列，而不只是“本轮新扫描出来的素材”
- 否则会出现“队列很多，但 `queueCount=1` 或 `0`”的状态机问题

## 3.4 续传与重连

1. 传输中断时，app 会进入短重连和 backoff
2. sidecar 通过 `uploads.committed_bytes` + `.part` 文件支持断点续传
3. 成功恢复后，下一轮 `FILE_INIT_REQ` 会走 `RESUME`
4. 对用户来说，短时自动恢复应该理解为“正在重连”，不是最终失败

## 3.5 历史与统计

当前已经统一到“以 sidecar/desktop 完成日为准”：

1. sidecar 在文件完成时写 `uploads.completed_at`
2. sidecar 在 `device_daily_stats` 中按 desktop 本地日做分桶
3. mobile 在 `FILE_END_RES` 中优先使用 sidecar 回传的 `ledgerDate`
4. desktop detail/history 也以 sidecar 数据为准

## 4. Source of Truth

当前开发与排障按以下优先级判断：

1. 当前已提交代码
2. `@syncflow/contracts`
3. `docs/testing/beta-test-matrix.md`

不应再依赖已删除的历史 spec 文件。

## 5. 当前项目结构

```text
apps/desktop      Electron 桌面端
apps/mobile       React Native + iOS 原生 SyncEngine
packages/contracts 共享 DTO、常量、端口、事件名
packages/design-tokens 共享设计 token
services/sidecar-go Go sidecar
scripts/ios       真机上传回归脚本
scripts/release   beta tag 等发布脚本
```

## 6. 接手建议

新同事按这个顺序进入最省时间：

1. 先读本文件
2. 再读 `docs/architecture/sync-state-machine.md`
3. 再读 `docs/architecture/data-model.md`
4. 遇到具体问题时查 `docs/operations/troubleshooting.md`
5. 发版时按 `docs/release/release-playbook.md`
