# Lynavo Drive Community Build

本文定义 Lynavo Drive 开源社区版的行为边界。它是 global-only baseline，不包含 CN 市场分支、CN 支付、双市场 release profile 或双市场回归矩阵。

## Included

Community build 必须保留 local-first LAN sync：

1. 未登录 / 未订阅用户可以进入 guest local LAN mode。
2. mobile 与 desktop 在同一 LAN 时，可以发现、配对、扫描素材并自动上传。
3. 上传集合必须来自 mobile 本地 pending queue。
4. 队列保持只读：不允许用户删除、重排、跳过队列项。
5. 同一台 mobile 同一时间只上传一个文件。
6. iCloud 素材扫描阶段照常入队，导出阶段再触发云端下载。

## Not Included

Community build 不提供这些替代路径：

1. 不提供手动选择文件来替代自动增量同步。
2. 不提供手动挑选本轮上传集合。
3. 不提供按市场切换 CN / Global 配置。
4. 不内置官方商业 remote relay、tunnel credentials 或 background continuation native runtime。

## Fail-open / Fail-closed

前景 LAN 同步 fail-open：

1. 只要本地照片权限、配对状态和 LAN 可达，guest/local 用户可以继续同步。
2. 登录态、订阅态、server entitlement 或官方商业模块缺失，不应阻断前景 LAN 自动上传。
3. 回到前景时应继续从 pending queue 补偿未完成文件。

商业能力 fail-closed：

1. remote access、tunnel、relay 和 cloud-assisted route 缺少有效 entitlement 时关闭。
2. background / lockscreen continuation 在 community build 中没有正向 native runtime。
3. entitlement 缺失、过期、无法确认或格式异常时，按不可用处理。

## Deferred Migrations

以下项目不在 community build 文档任务中执行，只记录为后续迁移边界：

1. package scope rename。
2. mDNS service type 和 sidecar health service rename。
3. 旧 data-dir、keychain、shared-preference migration。
4. iOS bundle id、Android application id、native package namespace rename。
5. App Store / Play 既有 listing continuity 决策。
