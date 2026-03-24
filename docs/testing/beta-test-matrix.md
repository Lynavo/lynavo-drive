# SyncFlow Beta Test Matrix

本文件只整理测试范围、执行方式和验收口径，不作为产品规格文档。

## 1. 目标

内测前需要确认 4 类能力：

1. 基础可用：配对、发现、上传、完成
2. 异常恢复：断线、重连、断点续传
3. 后台持续：切后台、锁屏后继续上传
4. 发布可交付：Debug/Release 构建可过，关键自动化测试全绿

## 2. 自动化测试

### 2.1 Sidecar

执行命令：

```bash
cd /Volumes/workspace/work/sync-flow/services/sidecar-go
go test ./...
```

当前关键用例：

| 用例 | 位置 | 覆盖点 |
| --- | --- | --- |
| 默认配置加载 | `internal/config/config_test.go` | 默认端口、目录、设备名 |
| 完整配对+传输 | `internal/server/connection_test.go` | `HELLO -> PAIR -> SYNC -> FILE_END` |
| 断线后续传 | `internal/server/connection_test.go` | 部分写入、重连、`RESUME`、最终 hash 正确 |
| ACK 定时 flush | `internal/server/connection_test.go` | 没有新 frame 时仍能按间隔发 ACK |
| 错误路径 | `internal/server/connection_test.go` | 错误连接码、重复文件、hash mismatch |
| FileWriter 续传 seek | `internal/server/file_writer_test.go` | `.part` 恢复后写指针正确 |

关键入口：

- [config_test.go](/Volumes/workspace/work/sync-flow/services/sidecar-go/internal/config/config_test.go)
- [connection_test.go](/Volumes/workspace/work/sync-flow/services/sidecar-go/internal/server/connection_test.go)
- [file_writer_test.go](/Volumes/workspace/work/sync-flow/services/sidecar-go/internal/server/file_writer_test.go)

### 2.2 Mobile 类型与构建

执行命令：

```bash
cd /Volumes/workspace/work/sync-flow
pnpm --filter @syncflow/mobile exec tsc --noEmit

cd /Volumes/workspace/work/sync-flow/apps/mobile/ios
xcodebuild -workspace SyncFlowMobile.xcworkspace -scheme SyncFlowMobile -configuration Debug -destination 'generic/platform=iOS' build
xcodebuild -workspace SyncFlowMobile.xcworkspace -scheme SyncFlowMobile -configuration Release -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
```

验收口径：

1. TypeScript 通过
2. iOS Debug 构建通过
3. iOS Release smoke 构建通过

## 3. 真机脚本回归

脚本：

- [syncflow_upload_eval.sh](/Volumes/workspace/work/sync-flow/scripts/ios/syncflow_upload_eval.sh)

基础调用：

```bash
bash /Volumes/workspace/work/sync-flow/scripts/ios/syncflow_upload_eval.sh \
  --mode <MODE> \
  --device <DEVICE_UDID> \
  --app com.syncflow.mobile \
  --file-key <FILE_KEY>
```

### 3.1 可复跑模式

| 模式 | 目的 | 说明 |
| --- | --- | --- |
| `batch` | 标准上传回归 | 单轮或多轮传输，观察吞吐与完成状态 |
| `recovery-app` | App 重启恢复 | 传输中杀 app，再拉起，看是否 `RESUME` |
| `recovery-sidecar` | Sidecar 重启恢复 | 传输中重启 sidecar，看是否自动续传 |
| `recovery-late-sidecar` | Sidecar 晚启动 | app 先进入 backoff，再启动 sidecar，看是否恢复 |
| `recovery-sidecar-pause` | ACK 黑洞/链路冻结 | `SIGSTOP` sidecar 一段时间，再恢复 |
| `recovery-app-suspend` | App 挂起恢复 | 传输中 suspend app，再恢复 |
| `all` | 全套串跑 | 依次执行上面所有模式 |

对应入口：

- [syncflow_upload_eval.sh#L31](/Volumes/workspace/work/sync-flow/scripts/ios/syncflow_upload_eval.sh#L31)
- [syncflow_upload_eval.sh#L820](/Volumes/workspace/work/sync-flow/scripts/ios/syncflow_upload_eval.sh#L820)

### 3.2 建议最小回归集

每次准备发内测，至少跑：

1. `batch`
2. `recovery-sidecar`
3. `recovery-late-sidecar`
4. `recovery-sidecar-pause`
5. `recovery-app`

如果这次改动涉及后台或生命周期，再加：

1. `recovery-app-suspend`
2. 锁屏/后台手工 soak

## 4. 手工冒烟清单

### 4.1 首次安装

1. 安装 desktop + sidecar
2. 安装 iPhone app
3. 配对成功
4. 首页显示已连接
5. 设置页显示 `已连接`

### 4.2 基础上传

1. 触发一轮真实素材同步
2. 首页进度、速度、队列项正常变化
3. sidecar 收到文件并落盘
4. 完成后首页进入完成态

### 4.3 异常恢复

1. 传输中关闭 Wi‑Fi
2. 首页显示 `传输已中断，正在重连`
3. 超过阈值后显示 `传输已暂停，等待网络恢复`
4. 恢复网络后自动 `RESUME`
5. 不从 0 重传

### 4.4 后台持续

1. 传输中切后台
2. 锁屏保持一段时间
3. sidecar `committed_bytes` 持续增长
4. 回到前台后进度继续推进

## 5. 当前已覆盖的重点场景

本轮已经验证过：

1. `sidecar` 重启中断恢复
2. `sidecar` 晚启动恢复
3. `sidecar pause/resume` 恢复
4. `app` 重启恢复
5. Wi‑Fi 断开后重连恢复
6. 切后台继续上传
7. 锁屏长时上传 soak
8. ACK 定时 flush 不再卡住 `0 进度 / 0 速度`

## 6. 发布门槛

内测包建议满足：

1. `go test ./...` 全绿
2. mobile TypeScript 通过
3. iOS Debug/Release 构建通过
4. `batch + recovery-sidecar + recovery-late-sidecar + recovery-app` 至少各过 1 轮
5. 真实设备上手工验证一次：后台上传 + 断网恢复

## 7. 日志与产物

真机脚本默认输出：

1. 结果 CSV：`/tmp/syncflow-upload-eval`
2. App / sidecar 日志：`/tmp/syncflow-upload-eval-logs`

这些目录是临时产物，不应该作为版本化测试记录保存。
