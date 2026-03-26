# SyncFlow Beta 发布手册

本文件是当前 beta 发布的总入口。iOS TestFlight、macOS signed DMG 和 beta tag 都按这里的顺序执行。

详细步骤仍然分别落在：

- `docs/release/ios-testflight.md`
- `docs/release/macos-desktop-signing.md`

## 1. 当前版本规则

当前统一规则：

1. 对外版本：`0.1.0`
2. beta build：使用 iOS `CURRENT_PROJECT_VERSION`
3. desktop build number 跟随 iOS build number
4. beta tag 格式：`beta/v<MARKETING_VERSION>-b<CURRENT_PROJECT_VERSION>`

例如：

- `0.1.0 (6)`
- `beta/v0.1.0-b6`

## 2. 发布前检查

在仓库根目录确认：

```bash
git status --short
pnpm --filter @syncflow/mobile exec tsc --noEmit
pnpm --filter @syncflow/desktop test
pnpm --filter @syncflow/desktop typecheck
cd services/sidecar-go && go test ./...
```

还要满足：

1. iOS Debug / Release build 通过
2. 关键真机回归过一轮
3. 当前工作区干净

回归基线见：

- `docs/testing/beta-test-matrix.md`

## 3. 递增 build

每次准备发 beta：

1. 保持 `MARKETING_VERSION = 0.1.0`
2. 递增 `CURRENT_PROJECT_VERSION`

原因：

- TestFlight 同一 marketing version 下必须递增 build
- desktop 的 build 也依赖这条数字做对齐和展示

## 4. 发 iOS TestFlight

从仓库根目录执行：

```bash
pnpm package:mobile:testflight
```

如果只想拆步：

```bash
pnpm package:mobile:testflight:archive
pnpm package:mobile:testflight:upload
```

产物位置：

- `apps/mobile/ios/build/archives/SyncFlow-<version>-b<build>.xcarchive`

上传成功后：

1. 去 App Store Connect `TestFlight`
2. 等 build 从 `Processing` 变为可用
3. 填 beta 说明

## 5. 出 desktop signed DMG

从仓库根目录执行：

```bash
pnpm package:desktop:signed
```

如果只做本地验签：

```bash
pnpm package:desktop:signed:dir
```

产物位置：

- `apps/desktop/release/SyncFlow-0.1.0-arm64.dmg`
- `apps/desktop/release/mac-arm64/SyncFlow.app`

发布前至少确认：

```bash
spctl --assess --type execute -vv apps/desktop/release/mac-arm64/SyncFlow.app
hdiutil verify apps/desktop/release/SyncFlow-0.1.0-arm64.dmg
```

## 6. 打 beta tag

只有在这两件事都完成后再打 tag：

1. TestFlight 上传成功
2. desktop signed DMG 已完成并验签

执行：

```bash
pnpm tag:beta
```

如果要直接推远端 tag：

```bash
pnpm tag:beta:push
```

## 7. 推荐发布顺序

每次 beta 都按这个固定顺序，避免遗漏：

1. 递增 iOS build number
2. 跑预检测试
3. 发 iOS TestFlight
4. 出 desktop signed DMG
5. 打 beta tag
6. 确认工作区干净
7. 推代码和 tag
8. 等 TestFlight processing 完成后再扩大测试范围

## 8. 发布后的最小冒烟

### 8.1 iOS

1. fresh install
2. 配对
3. 同步一轮真实素材
4. 切后台继续上传
5. 中途断网恢复
6. 历史和设置页状态正常

### 8.2 macOS

1. 从 DMG fresh install
2. app 正常启动
3. sidecar 正常监听和广播
4. 设置页版本正确
5. 诊断包导出正常
6. detail 分页、排序、滚动正常

## 9. 发布物与记录

建议每次 beta 都在发布记录里明确写出：

1. iOS build：例如 `0.1.0 (6)`
2. desktop build：例如 `0.1.0 (6)`
3. git tag：例如 `beta/v0.1.0-b6`
4. 对应提交 SHA
5. 本轮重点验证项
6. 已知限制

## 10. 当前已脚本化的入口

仓库根目录已有：

```bash
pnpm package:mobile:testflight
pnpm package:desktop:signed
pnpm tag:beta
```

这些脚本就是当前 beta 阶段的标准路径，不再建议临时发明另一套手工步骤。
