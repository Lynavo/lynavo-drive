# AGENTS.md — SyncFlow V2

## 项目概述

SyncFlow V2：iPhone → Mac 局域网素材无感增量同步工具。Monorepo 当前包含 Electron 桌面应用、Go sidecar、React Native 移动端，以及 iOS 原生 `SyncEngine`。

## 当前开发依据

仓库中目前**没有单独维护的产品 spec 文件**。开发和修改请按以下优先级判断：

1. **当前已提交代码**：实际行为以仓库中的现有实现为准
2. **`@syncflow/contracts`**：共享 DTO、常量、事件名、端口定义的唯一来源
3. **`docs/testing/beta-test-matrix.md`**：当前内测验证范围、回归场景和发布门槛

历史文档如果后续恢复，只能作为背景参考；在新的 source of truth 明确之前，不要再假定某个已删除 spec 文件仍然有效。

## 关键架构约束

- **PC 仅 macOS**（v2 范围）
- **队列绝对只读**：不允许用户在 UI 删除、调序、跳过队列项
- **全自动增量同步**：不允许手动勾选文件
- **单文件串行上传**：同一台手机同一时间只传 1 个文件
- **所有 DTO 类型从 `@syncflow/contracts` 导入**，不允许在 desktop/mobile 中重新定义
- **`tmp/ui-demo/` 只做视觉参考**，不允许直接复制代码。实现以当前代码、`@syncflow/contracts` 和测试矩阵为准。
- **Renderer 不直接访问** sidecar、文件系统、SQLite —— 全部走 preload bridge

## 开发流程

```bash
# 日常开发
pnpm install           # 安装依赖
pnpm build             # 构建 contracts + design-tokens（改了共享包后必须先 build）
pnpm --filter @syncflow/desktop dev   # 启动 Electron 开发模式

# 验证
pnpm test              # 全量测试
pnpm typecheck         # 类型检查
pnpm format:check      # 格式检查
```

## 包依赖关系

```
@syncflow/contracts       ← 无依赖，纯类型 + 常量
@syncflow/design-tokens   ← 无依赖，纯 token 值
@syncflow/desktop         ← 依赖 contracts + design-tokens
```

改了 `contracts` 或 `design-tokens` 后，必须先 `pnpm build` 再启动 desktop dev。

## 编码规范

### TypeScript
- strict 模式，不允许 `any`
- 所有共享类型从 `@syncflow/contracts` 导入
- 文件路径使用 `@renderer/` alias（在 renderer 内）
- 组件使用 named export，不用 default export

### React (Desktop Renderer)
- React 18.3（不是 19）
- shadcn/ui new-york 风格，通过 `npx shadcn@latest add` 安装组件
- 状态管理用 zustand，不用 Context 或 Redux
- 导航用简单 view state 切换（`app-store.currentView`），不用 react-router
- 页面级组件放 `features/<page>/`，共享组件放 `components/shared/`
- 玻璃态效果用 `<GlassCard>` 组件 + `@syncflow/design-tokens` 的 elevation/glass token

### Electron
- main/preload/renderer 严格隔离
- IPC channel 名定义在 `src/main/ipc-handlers.ts` 的 `IPC` 常量对象
- preload 通过 `contextBridge.exposeInMainWorld('electronAPI', ...)` 暴露 API
- renderer 不直接访问 sidecar、文件系统、SQLite，全部通过 preload bridge / main 进程转发

### Go Sidecar
- 独立 `go.mod`，不受 turbo 管理
- 标准库优先（`net/http`, `log/slog`）
- SQLite 用 `mattn/go-sqlite3`（CGO）
- migration 用 `go:embed`
- 所有 SQL 查询必须使用参数化查询

### 测试
- vitest 4.1（TypeScript），环境为 jsdom
- 测试文件放在 `__tests__/` 目录下，紧挨被测模块
- store 测试验证状态转换和 action 行为
- 组件测试用 @testing-library/react，验证渲染和交互
- Go 用标准 `go test`

## 当前状态

- **Monorepo / Desktop / Sidecar / Mobile SyncEngine**：都已落地，不再是 greenfield 阶段
- **当前重点**：异常恢复、后台上传、连接状态提示、beta 收口和发布验证
- **回归基线**：以 `go test ./...`、`pnpm --filter @syncflow/mobile exec tsc --noEmit`、iOS 构建和 `docs/testing/beta-test-matrix.md` 为准

## Sidecar HTTP API 端口

- TCP/LMUP 协议端口：**39393**
- Sidecar HTTP API 端口：**39394**
- 两个端口定义在 `@syncflow/contracts` 的 `PROTOCOL_PORT` 和 `SIDECAR_HTTP_PORT`

## 事件命名约定

SidecarEvent 使用 **dot-notation**（如 `device.state.changed`），不使用 underscore。
