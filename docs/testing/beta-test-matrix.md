# Lynavo Drive Beta Test Matrix

本文件只整理测试范围、执行方式和验收口径，不作为产品规格文档。

## 1. 目标

内测前需要确认 4 类能力：

1. 基础可用：配对、发现、上传、完成
2. 异常恢复：断线、重连、断点续传
3. 能力边界：guest/local 前景 LAN 同步 fail-open，remote/background 付费能力 fail-closed
4. 构建可交付：Debug/Release 构建可过，关键自动化测试全绿

## 2. 自动化测试

### 2.1 Sidecar

执行命令：

```bash
cd /Volumes/workspace/work/sync-flow/services/sidecar-go
go test ./...
```

当前关键用例：

| 用例                 | 位置                                  | 覆盖点                                   |
| -------------------- | ------------------------------------- | ---------------------------------------- |
| 默认配置加载         | `internal/config/config_test.go`      | 默认端口、目录、设备名                   |
| 完整配对+传输        | `internal/server/connection_test.go`  | `HELLO -> PAIR -> SYNC -> FILE_END`      |
| 断线后续传           | `internal/server/connection_test.go`  | 部分写入、重连、`RESUME`、最终 hash 正确 |
| ACK 定时 flush       | `internal/server/connection_test.go`  | 没有新 frame 时仍能按间隔发 ACK          |
| 错误路径             | `internal/server/connection_test.go`  | 错误连接码、重复文件、hash mismatch      |
| FileWriter 续传 seek | `internal/server/file_writer_test.go` | `.part` 恢复后写指针正确                 |

关键入口：

- [config_test.go](/Volumes/workspace/work/sync-flow/services/sidecar-go/internal/config/config_test.go)
- [connection_test.go](/Volumes/workspace/work/sync-flow/services/sidecar-go/internal/server/connection_test.go)
- [file_writer_test.go](/Volumes/workspace/work/sync-flow/services/sidecar-go/internal/server/file_writer_test.go)

### 2.2 Mobile 类型与构建

执行命令：

```bash
cd /Volumes/workspace/work/sync-flow
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit

cd /Volumes/workspace/work/sync-flow/apps/mobile/ios
xcodebuild -workspace LynavoDrive.xcworkspace -scheme LynavoDrive -configuration Debug -destination 'generic/platform=iOS' build
xcodebuild -workspace LynavoDrive.xcworkspace -scheme LynavoDrive -configuration Release -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build

cd /Volumes/workspace/work/sync-flow/apps/mobile/android
./gradlew assembleDebug
```

验收口径：

1. TypeScript 通过
2. iOS Debug 构建通过
3. iOS Release smoke 构建通过
4. Android Debug 构建通过

## 3. 真机脚本回归

脚本：

- [lynavo_upload_eval.sh](/Volumes/workspace/work/sync-flow/scripts/ios/lynavo_upload_eval.sh)

基础调用：

```bash
bash /Volumes/workspace/work/sync-flow/scripts/ios/lynavo_upload_eval.sh \
  --mode <MODE> \
  --device <DEVICE_UDID> \
  --app com.lynavo.drive.mobile \
  --file-key <FILE_KEY>
```

### 3.1 可复跑模式

| 模式                     | 目的              | 说明                                           |
| ------------------------ | ----------------- | ---------------------------------------------- |
| `batch`                  | 标准上传回归      | 单轮或多轮传输，观察吞吐与完成状态             |
| `recovery-app`           | App 重启恢复      | 传输中杀 app，再拉起，看是否 `RESUME`          |
| `recovery-sidecar`       | Sidecar 重启恢复  | 传输中重启 sidecar，看是否自动续传             |
| `recovery-late-sidecar`  | Sidecar 晚启动    | app 先进入 backoff，再启动 sidecar，看是否恢复 |
| `recovery-sidecar-pause` | ACK 黑洞/链路冻结 | `SIGSTOP` sidecar 一段时间，再恢复             |
| `recovery-app-suspend`   | App 挂起恢复      | 传输中 suspend app，再恢复                     |
| `all`                    | 全套串跑          | 依次执行上面所有模式                           |

对应入口：

- [lynavo_upload_eval.sh#L31](/Volumes/workspace/work/sync-flow/scripts/ios/lynavo_upload_eval.sh#L31)
- [lynavo_upload_eval.sh#L820](/Volumes/workspace/work/sync-flow/scripts/ios/lynavo_upload_eval.sh#L820)

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

如果这次改动涉及 iOS 热控或上传调参，再额外执行一轮手工 thermal 回归。

## 4. 手工冒烟清单

### 4.1 首次安装

1. 安装 desktop（macOS DMG / Windows NSIS / Linux `.deb`）+ sidecar
2. 安装 mobile app（iOS / Android）
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

### 4.4 前后台切换补偿

后台持续属于官方商业能力，不是 OSS 主线正向验收项。Community/OSS build 本节只验证前台 LAN 同步在切后台后安全暂停、回到前景后继续通过 pending queue 补偿同步。

1. 传输中切后台
2. 锁屏保持一段时间
3. community / guest build：不承诺后台持续增长，当前文件在安全边界暂停
4. 回到前台后通过 LAN pending queue 继续推进

### 4.4.1 Guest local LAN mode

1. mobile 未登录、无订阅、无 server entitlement
2. desktop 与 mobile 位于同一 LAN
3. mobile 可以发现 desktop、完成配对并触发前景自动同步
4. 上传集合来自 mobile 本地 pending queue
5. UI 不提供手动勾选文件、跳过文件或删除队列项作为替代路径
6. 断网恢复后继续 `RESUME`，不因 guest 身份清空 sync identity 或 pending queue

### 4.4.2 Commercial remote/background boundary

本节是商业能力负向边界 sanity check，不是 OSS 正向功能验收。

1. community / OSS runtime 不请求官方 tunnel credentials
2. community / OSS runtime 不展示官方 tunnel 激活入口，也不向 sidecar 下发 credentials
3. 缺少 official native capability 时，后台静默续传入口保持关闭
4. 前景 LAN 同步仍可用，并在回到前景后通过 pending queue 补偿

### 4.5 Windows desktop 冒烟

1. 从 `LynavoDrive-*-x64.exe` fresh install
2. 安装后确认 `Lynavo Drive Sidecar TCP / Lynavo Drive Sidecar HTTP / Lynavo Drive mDNS UDP` 防火墙规则存在，覆盖 `39393/TCP`、`39394/TCP` 和 `5353/UDP`
3. 设置页能看到 Bonjour 运行时或 fallback 状态
4. mobile 能发现并配对
5. 触发一轮真实素材同步

### 4.6 Linux desktop 冒烟

1. 在 Ubuntu 22.04 arm64 fresh install `LynavoDrive-*-linux-arm64.deb`
2. 在 Ubuntu 22.04 amd64 fresh install `LynavoDrive-*-linux-x64.deb`
3. 启动 app，确认 sidecar health 进入 healthy
4. 确认 `ss -ltnup` 能看到 `39393/TCP`、`39394/TCP`，并允许 `5353/UDP`
5. 设置页显示 Linux 手动共享提示，不显示 Apple Bonjour 安装或 Windows 高级共享按钮
6. iOS 真机发现 Linux desktop、配对并上传一轮素材
7. Android 真机发现 Linux desktop、配对并上传一轮素材
8. 重启 app 后确认历史、received library、paired devices 保持

### 4.7 iOS thermal 回归

1. 用长视频或大文件触发一轮持续上传
2. 在上传过程中手动制造高热场景，确认同步不断开但速度下降
3. thermal serious 时确认：
   - 首页出现“已降低传输强度”轻提示
   - `engine.log` 出现 `THERMAL_THROTTLE`
   - idle heartbeat 间隔变长
   - cloud asset detection 批次缩小
4. thermal critical 时确认：
   - `engine.log` 出现 `THERMAL_PAUSE` 和 `THERMAL_RESUME`
   - 传输短暂停后继续，不误报为最终失败
5. 热状态恢复后确认：
   - `activeTuningProfile` 回到正常或后台档
   - 首页轻提示消失
6. thermal serious/critical 期间拍摄的新照片，在热状态恢复到 nominal 后的下一轮 scan 中被正确发现并入队上传（验证 deferred rescan 的补偿链路）
7. 后台 + thermal fair 时拍摄新照片，回到前台后确认 deferred rescan 被补偿触发（日志出现 `foreground restored — triggering deferred rescan`）
8. 后台 + thermal != nominal 时确认：
   - `activeTuningProfile` 显示 `background_thermal`（而非普通 `background`）
   - incremental rescan 日志显示 `deferring incremental rescan`
9. Android 需完成基础构建与冒烟验证；iOS thermal 专属策略按本节验证

### 4.8 Same-LAN Wake-on-LAN 回歸

本節只驗證 Phase 1 same-LAN wake。VPN 只作 fallback 情境，不作主流程；公網 router Wake-on-WAN / router helper 尚不是本階段驗收項。

前置條件：

1. mobile 和 desktop 已完成配對，且 desktop 清醒時 sidecar 曾下發 wake metadata
2. mobile 與 desktop 在同一個 LAN；若測 VPN fallback，VPN 必須讓手機可達該 LAN 且允許 wake 封包送達
3. macOS 已開啟 `Wake for network access`，或 Windows 已開啟 BIOS/UEFI WoL 與網卡 magic packet wake
4. 優先用 Ethernet 驗證；Wi-Fi 睡眠喚醒依機型與路由器差異較大

`我的電腦` 入口：

1. 讓 desktop 進入睡眠，確認 mobile 顯示離線或 LAN `/health` 不可達
2. 在 mobile 打開 `我的電腦` 根目錄
3. 預期 shared files reachability 進入 `waking`，`engine.log` 出現 `wake packets sent`
4. desktop 被喚醒後，預期 `/health` 恢復、`engine.log` 出現 `wake recovered LAN host`，並繼續既有 LAN shared-files route
5. 若未喚醒，預期出現 `wake polling exhausted`，並回到 cached direct LAN route 或 unavailable 行為，不改動上傳佇列

`重新連接` 入口：

1. 讓 desktop 進入睡眠，mobile 同步狀態/同步動態顯示離線
2. 點擊 `重新連接`
3. 預期 native 先跑既有 discovery / LAN health retry；LAN host 不可達時才進入 bounded WoL retry
4. 喚醒成功時，預期 binding connection state 回到 connected，並恢復既有 trigger-sync recovery
5. 喚醒失敗時，預期維持既有 offline/backoff UI，不應從 0 重建或重排 pending queue

非觸發檢查：

1. 只打開 app、回到前景、或顯示離線 banner，不應送出 WoL packet
2. nested personal folder、team shared files、download 操作不應觸發 bound desktop wake
3. 手機在外部網路且沒有 router wake/helper 或 VPN fallback 時，不應把 `重新連接` 描述或行為做成公網 Wake-on-WAN

補充驗收情境：

| 類別                           | 情境                                                                                   | 前置條件 / 操作                                                                                                       | 驗收口徑                                                                                                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared files wake              | macOS sleep -> mobile opens My Computer                                                | Enable `Wake for network access`，bind mobile，let Mac sleep，open `我的電腦`                                         | Mac wakes 或 mobile shows unavailable after bounded wake attempt；diagnostics show `wake packets sent packets=<n>` and either `wake LAN reachable host=<ip>` / `wake recovered LAN host` or `wake polling exhausted` |
| Shared files wake              | Windows sleep -> mobile opens My Computer                                              | Enable BIOS/NIC WoL，bind mobile，let PC sleep，open `我的電腦`                                                       | PC wakes 或 mobile shows unavailable after bounded wake attempt；diagnostics show `wake packets sent packets=<n>` and probe result                                                                                   |
| Metadata missing               | Shared files opens without cached wake targets                                         | 清掉或避免建立 bound desktop wake metadata，open `我的電腦`                                                           | 不送 wake packet；diagnostics show `wake skipped reason=<reason> metadata_missing_or_unusable`；fallback 行為不改動 pending queue                                                                                    |
| Metadata missing               | Sync status reconnect without cached wake targets                                      | 清掉或避免建立 bound desktop wake metadata，tap `重新連接`                                                            | 不送 wake packet；diagnostics show `wake skipped reason=manual_lan_reconnect metadata_missing_or_unusable`；UI 維持既有 offline/backoff                                                                              |
| Router Wake-on-WAN follow-up   | mobile outside LAN -> router public wake target configured -> mobile opens My Computer | Configure router directed broadcast / UDP forwarding or router WoL helper before desktop sleeps                       | Official/commercial follow-up only；community OSS does not send router/public wake packets or expose setup entrypoints                                                                                               |
| No arbitrary LAN relay         | Target desktop sleeps while another LAN device is awake                                | Keep another NAS/router/desktop awake but do not run an OSS-supported local desktop endpoint                          | Mobile does not treat arbitrary LAN devices as relay/helper/proxy；bounded same-LAN wake ends in LAN reachable or unavailable without changing pending queue                                                         |
| Sync status LAN reconnect wake | macOS/Windows sleep -> mobile shows offline -> user taps Reconnect                     | Enable platform WoL settings，bind mobile，let desktop sleep，open Sync Status，tap `重新連接` on same LAN or VPN-LAN | Desktop wakes or mobile remains offline after bounded LAN wake attempt；diagnostics include `lan_reconnect` reason；此入口是 LAN/VPN-LAN retry, not public Wake-on-WAN                                               |
| Passive offline display        | macOS/Windows sleep -> mobile app opens and shows offline                              | Bind mobile，let desktop sleep，open mobile app without tapping `重新連接` or `我的電腦`                              | No wake packets are sent；desktop remains asleep until explicit user action                                                                                                                                          |
| Unsupported WoL path           | Network or device blocks broadcast / magic packet wake                                 | Disable NIC wake or use network that blocks broadcast                                                                 | Mobile does not hang；cached direct LAN route and unavailable UI remain usable；diagnostics show `wake polling exhausted` / `wake probe timed out` when packet send was attempted                                    |

## 5. 当前已覆盖的重点场景

本轮已经验证过：

1. `sidecar` 重启中断恢复
2. `sidecar` 晚启动恢复
3. `sidecar pause/resume` 恢复
4. `app` 重启恢复
5. Wi‑Fi 断开后重连恢复
6. 切后台后暂停，回前台继续 pending queue
7. 锁屏期间不启用商业后台续传
8. ACK 定时 flush 不再卡住 `0 进度 / 0 速度`
9. iOS thermal 降载策略需要随本轮改动补一次手工回归

## 6. 发布门槛

内测包建议满足：

1. `go test ./...` 全绿
2. mobile TypeScript 通过
3. iOS Debug/Release 构建通过
4. Android Debug 构建通过
5. `batch + recovery-sidecar + recovery-late-sidecar + recovery-app` 至少各过 1 轮
6. 真实设备上手工验证一次：切后台暂停、回前景 pending queue 补偿 + 断网恢复
7. guest local LAN 前景同步至少过一次：未登录 / 无订阅仍可配对并自动上传
8. 商业 remote/background 边界 sanity 至少过一次：community / guest build 不启用 official tunnel credentials 或 silent background continuation
9. 如本轮包含 Windows 桌面包，至少完成一次 NSIS fresh install + 配对上传冒烟
10. 如本轮包含 Linux 桌面包，至少完成 Ubuntu 22.04 arm64 和 amd64 `.deb` fresh install + iOS / Android 真机配对上传冒烟
11. 如本轮包含 iOS thermal 策略改动，至少完成一次 serious/critical thermal 手工回归并导出 mobile diagnostics
12. 如本輪包含 Wake-on-LAN 相關改動，至少完成一次 same-LAN `我的電腦` 喚醒回歸，並確認 `重新連接` 仍是 LAN / VPN-LAN retry，不是公網 wake

## 7. 日志与产物

真机脚本默认输出：

1. 结果 CSV：`/tmp/lynavo-drive-upload-eval`
2. App / sidecar 日志：`/tmp/lynavo-drive-upload-eval-logs`

这些目录是临时产物，不应该作为版本化测试记录保存。
