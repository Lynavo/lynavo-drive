# SyncFlow

iPhone → Mac 局域网素材无感增量同步工具，面向短视频团队。

## 当前状态

- 桌面端、Go sidecar、移动端和 iOS 原生 `SyncEngine` 都已落地
- 当前工作重点是 beta 收口、异常恢复、后台上传和发布验证
- 仓库中目前没有单独维护的产品 spec 文件；开发基线以当前代码、`@syncflow/contracts` 和测试矩阵为准

## 前置依赖

- **macOS**（当前桌面端仅支持 macOS）
- **Node.js** >= 22.11.0
- **pnpm** >= 10
- **Go** >= 1.25.6（sidecar 开发和测试）
- **Xcode + CocoaPods**（iOS 构建和真机调试）

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 构建共享包
pnpm --filter @syncflow/contracts build
pnpm --filter @syncflow/design-tokens build

# 3. 启动 Desktop 开发模式
pnpm dev:desktop
```

Electron 窗口会自动打开；桌面端会负责拉起 sidecar。

## 常用命令

```bash
# Desktop
pnpm dev:desktop
pnpm build:desktop

# Mobile
pnpm dev:mobile
pnpm build:mobile

# Sidecar
pnpm dev:sidecar
pnpm build:sidecar
pnpm test:sidecar

# 全仓验证
pnpm build
pnpm test
pnpm typecheck
pnpm format:check
pnpm check
```

## 项目结构

```text
syncflow/
├── apps/
│   ├── desktop/              # Electron 桌面应用
│   │   └── src/
│   │       ├── main/         # 主进程（窗口、IPC、sidecar 生命周期）
│   │       ├── preload/      # 预加载桥接
│   │       └── renderer/     # React 18 UI
│   └── mobile/               # React Native iOS 应用 + 原生 SyncEngine
│       ├── ios/              # Xcode 工程、Swift 原生模块
│       ├── src/              # RN 页面和 hooks
│       └── __tests__/        # RN 测试
├── packages/
│   ├── contracts/            # 共享 DTO / 常量 / 事件 / 错误码
│   └── design-tokens/        # 共享设计 token
├── services/
│   └── sidecar-go/           # Go sidecar（TCP/HTTP/SQLite/mDNS）
├── docs/
│   └── testing/              # 测试矩阵和 beta 验证说明
└── tmp/
    └── ui-demo/              # 视觉参考，仅供比对，不直接复用代码
```

## 技术栈

| 层 | 技术 |
|----|------|
| Monorepo | pnpm 10 + turborepo 2.8 |
| Desktop | Electron 41 + electron-vite 5 + electron-builder 26 |
| Desktop UI | React 18.3 + zustand 5 + Tailwind CSS v4 |
| Mobile | React Native 0.84.1 + React 19 |
| iOS Native | Swift `SyncEngine` + BGTask + PhotoKit + Network.framework |
| Sidecar | Go 1.25.6 + SQLite + WebSocket |
| Shared | `@syncflow/contracts` + `@syncflow/design-tokens` |
| Test | vitest 4.1 + jest + `go test` |

## 架构概览

```text
iPhone (RN UI + Swift SyncEngine)
  ├── Bonjour/mDNS discover
  ├── LMUP/TCP :39393
  └── Presence/HTTP :39394
                │
                ▼
Mac (Electron + Go sidecar)
  ├── Electron: UI 壳、窗口、桥接、sidecar 生命周期管理
  ├── Sidecar HTTP API / WebSocket
  ├── LMUP 文件接收
  ├── SQLite
  └── 文件系统 / 共享目录检测
```

## 开发基线

- 共享类型、常量、事件名、端口定义统一来自 `@syncflow/contracts`
- renderer 不直接访问 sidecar、文件系统、SQLite；全部通过 preload bridge / main 进程转发
- 队列保持只读，不允许在 UI 里删除、调序或跳过
- 同一台手机同一时间只允许串行上传一个文件
- `tmp/ui-demo/` 只做视觉参考，不作为实现来源

## 文档

- 开发约束和执行准则：[`AGENTS.md`](./AGENTS.md)
- beta 测试矩阵：[`docs/testing/beta-test-matrix.md`](./docs/testing/beta-test-matrix.md)

## License

Private — 内部使用
