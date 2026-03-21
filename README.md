# SyncFlow

iPhone → Mac 局域网素材无感增量同步工具，面向短视频团队。

## 快速开始

### 前置依赖

- **Node.js** >= 20
- **pnpm** >= 10（`corepack enable && corepack prepare pnpm@latest --activate`）
- **Go** >= 1.26（仅 sidecar 开发需要）

### 安装 & 启动

```bash
# 1. 安装依赖
pnpm install

# 2. 构建共享包（首次必须）
pnpm build

# 3. 启动 Desktop 开发模式
pnpm --filter @syncflow/desktop dev
```

Electron 窗口将自动打开，renderer 支持 HMR 热更新。

### 常用命令

```bash
# Desktop 开发（快捷方式）
pnpm dev:desktop

# 全量构建 / 测试 / 类型检查
pnpm build
pnpm test
pnpm typecheck

# 一次性跑完 build + test + typecheck
pnpm check

# 代码格式化
pnpm format

# 清理构建产物
pnpm clean

# 按包操作
pnpm --filter @syncflow/desktop dev
pnpm --filter @syncflow/desktop test:watch    # vitest watch 模式
pnpm --filter @syncflow/contracts build
```

## 项目结构

```
syncflow/
├── apps/
│   └── desktop/              # Electron 桌面应用
│       ├── src/main/         #   主进程（窗口管理、IPC、sidecar 生命周期）
│       ├── src/preload/      #   预加载脚本（contextBridge API）
│       └── src/renderer/     #   渲染进程（React 18 + shadcn/ui + Tailwind v4）
│           ├── features/     #     页面组件（dashboard / settings / device-detail）
│           ├── stores/       #     zustand 状态管理
│           ├── components/   #     UI 组件（shadcn + 共享组件）
│           └── mocks/        #     Phase 1 mock 数据
├── packages/
│   ├── contracts/            # @syncflow/contracts — 共享 DTO / 枚举 / 事件 / 错误码
│   └── design-tokens/        # @syncflow/design-tokens — 颜色 / 圆角 / 阴影 / 排版 token
├── services/
│   └── sidecar-go/           # Go sidecar（独立 go.mod，不受 turbo 管理）
├── docs/
│   └── superpowers/
│       ├── specs/            # 项目规格文档
│       └── plans/            # 实施计划文档
└── tmp/
    └── ui-demo/              # UI 视觉参考（只读，不用于开发）
```

## 技术栈

| 层 | 技术 |
|----|------|
| Monorepo | pnpm 10 + turborepo 2.8 |
| Desktop | Electron 41 + electron-vite 5 + electron-builder 26 |
| Desktop UI | React 18.3 + shadcn/ui (new-york) + Tailwind CSS v4 + zustand 5 |
| Sidecar | Go 1.26 + SQLite |
| Mobile | React Native 0.84 + Swift TurboModule（计划中） |
| 共享 | @syncflow/contracts + @syncflow/design-tokens |
| 测试 | vitest 4.1 (TS) + go test (Go) |
| TypeScript | 5.8 |

## 架构概览

```
iPhone (RN + Swift)  ──── Bonjour/mDNS ────►  Mac (Electron + Go sidecar)
                     ──── LMUP/TCP:39393 ──►
                                               Electron ◄── HTTP:39394 ──► Go sidecar
                                                                            ├── SQLite
                                                                            ├── 文件系统
                                                                            └── SMB 共享
```

- **Electron**：UI 壳 + sidecar 生命周期管理
- **Go sidecar**：Bonjour 广播、TCP 协议、文件接收、SQLite、共享检测
- **React Native**：iOS 展示层
- **Swift SyncEngine**：Bonjour 发现、PhotoKit 扫描、TCP 传输、后台任务

## 开发阶段

| Phase | 状态 | 内容 |
|-------|------|------|
| 0: Monorepo Bootstrap | ✅ 完成 | pnpm workspace + turbo + contracts + design-tokens |
| 1: Desktop Shell | ✅ 完成 | Electron 应用 + 全部页面（mock 数据） |
| 2: Go Sidecar | 📋 计划就绪 | HTTP API + SQLite + Bonjour + WebSocket |
| 3: Desktop ↔ Sidecar 集成 | 📋 待规划 | 真实数据接入 |
| 4: LMUP/2 协议 | 📋 待规划 | TCP 文件传输 |
| 5: Mobile | 📋 待规划 | RN + Swift 同步引擎 |

## 文档

- **项目规格**：[`docs/superpowers/specs/2026-03-21-syncflow-v2-spec.md`](docs/superpowers/specs/2026-03-21-syncflow-v2-spec.md)
- **Phase 0+1 计划**：[`docs/superpowers/plans/2026-03-21-phase-0-1-monorepo-desktop.md`](docs/superpowers/plans/2026-03-21-phase-0-1-monorepo-desktop.md)
- **Phase 2 计划**：[`docs/superpowers/plans/2026-03-21-phase-2-go-sidecar.md`](docs/superpowers/plans/2026-03-21-phase-2-go-sidecar.md)

## License

Private — 内部使用
