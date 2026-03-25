# macOS Desktop 签名与公证

本文件描述 SyncFlow 桌面端在本地完成 Developer ID 签名和 Apple notarization 的标准路径。

## 1. 前置条件

发布前先确认以下条件都满足：

1. 已安装 `Developer ID Application` 证书到当前 Mac 的 keychain
2. 已下载 App Store Connect Team API Key（`.p8`）
3. 仓库根目录存在本地 API key 文件：
   - `/Volumes/workspace/work/sync-flow/AuthKey_49NX53FQZT.p8`
4. sidecar 与 desktop 当前代码都已通过基本验证：
   - `/Volumes/workspace/work/sync-flow/services/sidecar-go` 下 `go test ./...`
   - `/Volumes/workspace/work/sync-flow` 下 `pnpm --filter @syncflow/desktop test`
   - `/Volumes/workspace/work/sync-flow` 下 `pnpm --filter @syncflow/desktop typecheck`
   - `/Volumes/workspace/work/sync-flow` 下 `pnpm --filter @syncflow/desktop build`

说明：

1. 根目录的 `.p8` 已加入 `.gitignore`，只作为本机打包输入，不应提交
2. 如果 API key 路径不同，可以通过环境变量覆盖，不要求强绑到仓库根目录

## 2. 当前默认签名材料

当前本机默认值如下：

1. Developer ID identity：
   - `Developer ID Application: Guangqiang Bi (V57RT7LMFH)`
2. `APPLE_API_KEY_ID`：
   - `49NX53FQZT`
3. `APPLE_API_ISSUER`：
   - `a4c17482-b579-4670-8d58-dec6ec282e36`
4. `APPLE_API_KEY` 默认路径：
   - `/Volumes/workspace/work/sync-flow/AuthKey_49NX53FQZT.p8`

脚本会自动探测当前 keychain 里的 `Developer ID Application` 证书，并自动去掉 electron-builder 不接受的前缀。

## 3. 一键打包

从仓库根目录执行：

```bash
cd /Volumes/workspace/work/sync-flow
pnpm --filter @syncflow/desktop package:signed
```

等价脚本入口：

```bash
bash /Volumes/workspace/work/sync-flow/apps/desktop/scripts/package-macos-signed.sh dmg
```

这条路径会执行：

1. 重新编译 sidecar 到 desktop 资源目录
2. 使用 `Developer ID Application` 对主 app 和内嵌 `syncflow-sidecar` 签名
3. 调用 Apple `notarytool` 提交公证并等待结果
4. 输出最终 DMG 到：
   - `/Volumes/workspace/work/sync-flow/apps/desktop/release`

## 4. 本地快速验签

如果只想先验证签名，不想等待 Apple notarization，可以执行：

```bash
cd /Volumes/workspace/work/sync-flow
pnpm --filter @syncflow/desktop package:signed:dir
```

等价脚本入口：

```bash
bash /Volumes/workspace/work/sync-flow/apps/desktop/scripts/package-macos-signed.sh dir
```

这会产出已签名但未 notarize 的 `.app` 目录：

- `/Volumes/workspace/work/sync-flow/apps/desktop/release/mac-arm64/SyncFlow.app`

## 5. 可覆盖的环境变量

如果本机签名材料变化，可以覆盖下面这些变量：

```bash
export CSC_NAME='Guangqiang Bi (V57RT7LMFH)'
export APPLE_API_KEY='/absolute/path/to/AuthKey_xxxxxx.p8'
export APPLE_API_KEY_ID='49NX53FQZT'
export APPLE_API_ISSUER='a4c17482-b579-4670-8d58-dec6ec282e36'

pnpm --filter @syncflow/desktop package:signed
```

注意：

1. `CSC_NAME` 不要写成完整证书名
2. 不能带 `Developer ID Application:` 前缀
3. electron-builder 只接受去掉前缀后的 identity 名称

## 6. 结果校验

打包完成后，至少做这三步校验：

### 6.1 主 app 签名

```bash
codesign -dv --verbose=4 /Volumes/workspace/work/sync-flow/apps/desktop/release/mac-arm64/SyncFlow.app
```

预期看到：

1. `Authority=Developer ID Application: ...`
2. `TeamIdentifier=V57RT7LMFH`
3. `Runtime Version` 存在

### 6.2 sidecar 签名

```bash
codesign -dv --verbose=4 /Volumes/workspace/work/sync-flow/apps/desktop/release/mac-arm64/SyncFlow.app/Contents/Resources/syncflow-sidecar
```

预期同样看到 `Developer ID Application` 和正确的 `TeamIdentifier`。

### 6.3 Gatekeeper 评估

```bash
spctl --assess --type execute -vv /Volumes/workspace/work/sync-flow/apps/desktop/release/mac-arm64/SyncFlow.app
```

公证完成并 staple 后，不应再看到：

- `source=Unnotarized Developer ID`

## 7. 代码位置

桌面端签名链当前落在这些文件：

1. 打包配置：
   - [electron-builder.yml](/Volumes/workspace/work/sync-flow/apps/desktop/electron-builder.yml)
2. 自定义签名脚本：
   - [package-macos-signed.sh](/Volumes/workspace/work/sync-flow/apps/desktop/scripts/package-macos-signed.sh)
   - [mac-sign.cjs](/Volumes/workspace/work/sync-flow/apps/desktop/scripts/mac-sign.cjs)
3. entitlements：
   - [entitlements.mac.plist](/Volumes/workspace/work/sync-flow/apps/desktop/resources/entitlements.mac.plist)
   - [entitlements.mac.inherit.plist](/Volumes/workspace/work/sync-flow/apps/desktop/resources/entitlements.mac.inherit.plist)

## 8. 当前说明

当前项目已经把自动签名问题收掉：

1. electron-builder 原生签名链在这台机器上容易卡住
2. 项目现在改用自定义 `codesign` 脚本接管签名阶段
3. notarization 仍然走 electron-builder 调起的 Apple 官方 `notarytool`

也就是说：

1. 签名问题已经由项目脚本固定下来
2. notarization 仍然依赖 Apple 服务器返回
3. 打包耗时主要由 Apple 处理速度决定

## 9. beta tag

如果本次桌面端产物要作为一次正式 beta 发布的一部分，在 iOS TestFlight 上传和桌面端 signed DMG 都确认可用后，再回到仓库根目录打 tag：

```bash
cd /Volumes/workspace/work/sync-flow
pnpm tag:beta
```

默认 tag 取当前 iOS 版本和 build：

- `beta/v<MARKETING_VERSION>-b<CURRENT_PROJECT_VERSION>`

例如：

- `beta/v0.1.0-b4`

如果需要推到远端：

```bash
cd /Volumes/workspace/work/sync-flow
pnpm tag:beta:push
```
