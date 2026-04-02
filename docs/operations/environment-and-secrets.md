# 环境与密钥说明

本文件记录 SyncFlow 当前本地开发、签名和发布所需的环境、证书、脚本输入和调试开关。

## 1. 本地开发前置依赖

### 1.1 通用

1. macOS 或 Windows（desktop 开发 / 打包）
2. Node.js >= 20
3. pnpm >= 10
4. Go >= 1.25.x
5. Xcode + CocoaPods（仅 iOS 构建，需 macOS）

### 1.2 项目安装

```bash
pnpm install
pnpm build
```

改了 `contracts` 或 `design-tokens` 后，必须先重新 build。

## 2. 证书与发布材料

### 2.1 iOS TestFlight

需要：

1. 本机 Xcode 已登录有效 Apple 账号
2. App Store Connect 已存在 `com.syncflow.mobile`
3. `SyncFlowMobile.xcworkspace` 能正常 archive 和 export

### 2.2 macOS 签名与公证

需要：

1. `Developer ID Application` 证书已安装到 keychain
2. App Store Connect Team API key `.p8`
3. key 的 `Key ID` 和 `Issuer ID`

当前默认本机路径和 ID 约定，见：

- `docs/release/macos-desktop-signing.md`

### 2.3 Windows 桌面打包

当前仓库已包含 Windows `NSIS + zip` 打包入口：

```bash
pnpm package:desktop:win
```

当前实现里：

1. 没有单独维护的 Windows 签名文档
2. 也没有额外约定的 Windows 代码签名环境变量
3. 如果后续接入 Windows 代码签名，再单独补文档，不要把 macOS 签名变量直接套用到 Windows

## 3. 本地密钥放置

当前 macOS signed desktop 打包脚本默认会从仓库根目录读取：

- `AuthKey_49NX53FQZT.p8`

注意：

1. `.p8` 已加入 `.gitignore`
2. 只允许存在于本机，不允许提交
3. 如果路径不同，用环境变量覆盖，不要改脚本里的默认值作为多人共享方案

## 4. 关键环境变量

## 4.1 macOS Desktop 打包

- `CSC_NAME`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`
- `SYNCFLOW_BUILD_NUMBER`

说明：

1. `CSC_NAME` 不要带 `Developer ID Application:` 前缀
2. `SYNCFLOW_BUILD_NUMBER` 默认从 iOS `CURRENT_PROJECT_VERSION` 推导

## 4.2 Windows Desktop 打包

当前 `pnpm package:desktop:win` 不要求额外环境变量。

需要额外关注的不是密钥，而是：

1. Windows 机器能正常编译 `syncflow-sidecar.exe`
2. 安装包内包含 `syncflow-sidecar.exe / dns-sd.exe / dnssd.dll`
3. 安装后防火墙规则能落地

## 4.2 iOS TestFlight 脚本

常用覆盖项：

- `ARCHIVE_PATH`

默认情况下：

- archive 路径自动按 `MARKETING_VERSION + CURRENT_PROJECT_VERSION` 生成

## 4.3 调试 / 性能日志

### sidecar

- `SYNCFLOW_UPLOAD_PERF_LOG=1`

### mobile

当前 perf log 只应在 Debug 路径中使用。

原则：

1. Release / TestFlight 不应默认打开 perf log
2. Beta 发版前确认所有临时调试开关保持关闭

## 5. Debug-only 行为

当前项目里一些调试能力只应在 Debug 构建下使用，例如：

1. 上传参数 override
2. force host / force port
3. perf log
4. 各类手工压测开关

要求：

- 这些能力不能泄露进正式 beta 默认行为
- 如需临时联调，使用后必须回收或确认只在 Debug 生效

## 6. 不应提交的内容

以下内容不应进入仓库：

1. `.p8` 私钥文件
2. 个人证书导出文件
3. 本机临时数据库
4. 诊断包 zip
5. `/tmp` 下生成的压测日志和 CSV
6. 带个人路径或个人隐私信息的临时截图

## 7. 开发与发布脚本入口

仓库根目录可用：

```bash
pnpm dev:desktop
pnpm dev:mobile
pnpm dev:sidecar

pnpm package:desktop:win
pnpm package:mobile:testflight
pnpm package:desktop:signed
pnpm tag:beta
```

## 8. 交接建议

新同事接手时，优先确认：

1. 本机是否能通过 iOS build
2. keychain 是否已有 `Developer ID Application`
3. `.p8` 是否放在正确路径或已通过环境变量注入
4. 是否理解哪些开关只允许在 Debug 使用
5. 如果负责 Windows 联调，是否确认过 `pnpm package:desktop:win`、Bonjour 运行时和防火墙规则
