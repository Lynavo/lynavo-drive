# iOS TestFlight 发布路径

本文件只描述 SyncFlow iOS 包从本地代码到 TestFlight 的发布步骤，不作为产品规格文档。

## 1. 当前版本约定

- Marketing Version：`0.1.0`
- Build Number：`CURRENT_PROJECT_VERSION`
- Bundle ID：`com.syncflow.mobile`

说明：

1. `0.1.0` 是对外展示版本
2. 每次重新上传 TestFlight，必须递增 `CURRENT_PROJECT_VERSION`
3. 同一个 `0.1.0` 可以对应多个 build，例如 `0.1.0 (1)`、`0.1.0 (2)`

## 2. 发布前门槛

发布前至少确认：

1. `/Volumes/workspace/work/sync-flow/services/sidecar-go` 下 `go test ./...` 全绿
2. `/Volumes/workspace/work/sync-flow` 下 `pnpm --filter @syncflow/mobile exec tsc --noEmit` 通过
3. iOS Debug 构建通过
4. iOS Release smoke 构建通过
5. 真机至少验证一次：
   - 配对
   - 首页/设置页状态
   - 后台上传
   - 断网恢复

参考：

- [beta-test-matrix.md](/Volumes/workspace/work/sync-flow/docs/testing/beta-test-matrix.md)

## 3. 递增版本

在发布前先更新 build number。

位置：

- [project.pbxproj](/Volumes/workspace/work/sync-flow/apps/mobile/ios/SyncFlowMobile.xcodeproj/project.pbxproj)

当前建议：

1. `MARKETING_VERSION` 保持 `0.1.0`
2. 每发一次 TestFlight，递增 `CURRENT_PROJECT_VERSION`

例如：

1. 第一包：`0.1.0 (1)`
2. 第二包：`0.1.0 (2)`

## 4. 本地归档

在仓库根目录执行：

```bash
cd /Volumes/workspace/work/sync-flow/apps/mobile/ios

xcodebuild \
  -workspace SyncFlowMobile.xcworkspace \
  -scheme SyncFlowMobile \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath /tmp/SyncFlowMobile.xcarchive \
  archive
```

验收口径：

1. 命令成功退出
2. 产物存在：`/tmp/SyncFlowMobile.xcarchive`

## 5. 上传 TestFlight

当前最稳妥的路径是走 Xcode Organizer，不额外维护 CLI export 配置。

步骤：

1. 打开 Xcode
2. 进入 `Window -> Organizer`
3. 选中最新的 `SyncFlowMobile` archive
4. 点击 `Distribute App`
5. 选择 `App Store Connect`
6. 选择 `Upload`
7. 按默认选项继续，完成上传

这样做的原因：

1. 当前仓库没有维护 `ExportOptions.plist`
2. 内测阶段先用 Xcode 官方上传路径，变量最少
3. 出问题时更容易从 Organizer 看见签名、校验、上传报错

## 6. App Store Connect 操作

上传完成后：

1. 打开 [App Store Connect](https://appstoreconnect.apple.com/)
2. 进入 `My Apps -> SyncFlowMobile -> TestFlight`
3. 等待 build 处理完成
4. 填写本次 beta 说明
5. 添加 Internal Testers 或 External Testers

建议准备的文案：

1. 本次版本：`0.1.0`
2. 核心验证项：
   - 配对与自动同步
   - 后台上传
   - 断网恢复
   - 设置页连接状态
3. 已知限制：
   - 仅支持 iPhone -> Mac
   - 当前 beta 重点验证局域网同步与异常恢复

## 7. 建议的发布顺序

建议按下面顺序发：

1. 先发 iOS Internal TestFlight
2. 再发 desktop beta DMG
3. 先让内部同事跑一次完整闭环
4. 再决定是否扩展到更大范围 external beta

## 8. 发布后回归

TestFlight build 可安装后，至少做一次：

1. fresh install
2. 配对
3. 传一轮真实素材
4. 切后台继续上传
5. 中途断 Wi‑Fi，再恢复
6. 确认最终完成态和历史记录正常

## 9. 当前缺口

当前仓库还没有这些自动化发布资产：

1. `ExportOptions.plist`
2. `xcodebuild -exportArchive` 的固定脚本
3. App Store Connect API 上传脚本
4. Fastlane lane

如果后续发布频率升高，建议再补一条标准化流水线；在当前 beta 阶段，先用 Organizer 上传更稳。
