# iOS TestFlight 发布路径

本文件只描述 Vivi Drop iOS 包从本地代码到 TestFlight 的发布步骤，不作为产品规格文档。

## 1. 当前版本约定

- Marketing Version：`0.1.0`
- Build Number：`CURRENT_PROJECT_VERSION`
- Bundle ID：`com.vividrop.mobile.china`

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

- [project.pbxproj](/Volumes/workspace/work/sync-flow/apps/mobile/ios/Vivi DropMobile.xcodeproj/project.pbxproj)

当前建议：

1. `MARKETING_VERSION` 保持 `0.1.0`
2. 每发一次 TestFlight，递增 `CURRENT_PROJECT_VERSION`

例如：

1. 第一包：`0.1.0 (1)`
2. 第二包：`0.1.0 (2)`

## 4. 脚本入口

现在仓库已经提供固定脚本，不再要求手动走 Xcode Organizer。

从仓库根目录执行：

```bash
cd /Volumes/workspace/work/sync-flow
pnpm package:mobile:testflight:archive
pnpm package:mobile:testflight:upload
pnpm package:mobile:testflight
```

分别对应：

1. `archive`：只生成 `xcarchive`
2. `upload`：把现有 `xcarchive` 上传到 TestFlight
3. `archive-upload`：先归档，再上传

脚本位置：

- [testflight-release.sh](/Volumes/workspace/work/sync-flow/apps/mobile/ios/scripts/testflight-release.sh)

## 5. 本地归档

在仓库根目录执行：

```bash
cd /Volumes/workspace/work/sync-flow
pnpm package:mobile:testflight:archive
```

验收口径：

1. 命令成功退出
2. 产物存在：
   - `/Volumes/workspace/work/sync-flow/apps/mobile/ios/build/archives/Vivi Drop-<version>-b<build>.xcarchive`

## 6. 上传 TestFlight

当前默认路径已经切到 CLI，不再要求手工点 Organizer。

步骤：

```bash
cd /Volumes/workspace/work/sync-flow
pnpm package:mobile:testflight
```

如果只想上传已经存在的 archive：

```bash
cd /Volumes/workspace/work/sync-flow
pnpm package:mobile:testflight:upload
```

当前脚本使用：

1. [ExportOptions-TestFlight.plist](/Volumes/workspace/work/sync-flow/apps/mobile/ios/ExportOptions-TestFlight.plist)
2. `xcodebuild -exportArchive`

因此前提是：

1. 当前 Mac 的 Xcode 账号已登录
2. 对应团队在本机可用
3. `com.vividrop.mobile.china` 已在 App Store Connect 建立 app 记录

## 7. App Store Connect 操作

上传完成后：

1. 打开 [App Store Connect](https://appstoreconnect.apple.com/)
2. 进入 `My Apps -> Vivi Drop -> TestFlight`
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

## 8. 建议的发布顺序

建议按下面顺序发：

1. 先发 iOS Internal TestFlight
2. 再发 desktop beta DMG
3. 先让内部同事跑一次完整闭环
4. 确认上传成功后，在当前提交打一个 beta tag
5. 再决定是否扩展到更大范围 external beta

## 8.1 发布 tag

每次真正发布 beta 时，都在当前提交打一个 annotated tag。

从仓库根目录执行：

```bash
cd /Volumes/workspace/work/sync-flow
pnpm tag:beta
```

默认 tag 格式：

- `beta/v<MARKETING_VERSION>-b<CURRENT_PROJECT_VERSION>`

例如：

- `beta/v0.1.0-b4`

如果需要立即推到远端：

```bash
cd /Volumes/workspace/work/sync-flow
pnpm tag:beta:push
```

约束：

1. 只在 TestFlight 上传成功后打 tag
2. 打 tag 前工作区必须是干净的
3. 一个 build 只对应一个 tag，不复用、不覆盖

## 9. 发布后回归

TestFlight build 可安装后，至少做一次：

1. fresh install
2. 配对
3. 传一轮真实素材
4. 切后台继续上传
5. 中途断 Wi‑Fi，再恢复
6. 确认最终完成态和历史记录正常

## 10. 当前缺口

当前仓库还没有这些自动化发布资产：

1. 自动递增 `CURRENT_PROJECT_VERSION`
2. App Store Connect 元数据自动填充
3. Fastlane lane

如果后续发布频率继续升高，再补 Fastlane 或 CI 发布流水线；当前 beta 阶段，这套本地脚本已经足够稳定。
