# AGENTS.md — Lynavo Drive

## 项目概述

Lynavo Drive：移动端（iOS / Android）→ Desktop（macOS / Windows / Linux）局域网素材无感增量同步工具。Monorepo 当前包含 Electron 桌面应用、Go sidecar、React Native 移动端，以及 iOS / Android 平台原生同步能力。当前开源基线为 global-only，不再维护 CN / Global 双市场产品路径。

## 当前开发依据

仓库中目前**没有单独维护的产品 spec 文件**。开发和修改请按以下优先级判断：

1. **当前已提交代码**：实际行为以仓库中的现有实现为准
2. **`@lynavo-drive/contracts`**：共享 DTO、常量、事件名、端口定义的唯一来源
3. **架构 / 运维 / 发布文档**：用于解释当前实现，而不是覆盖代码
4. **`docs/testing/beta-test-matrix.md`**：当前内测验证范围、回归场景和发布门槛

历史文档如果后续恢复，只能作为背景参考；在新的 source of truth 明确之前，不要再假定某个已删除 spec 文件仍然有效。

## 新会话接手顺序

如果是新的 AI coding 会话，先按这个顺序建立上下文：

1. [README.md](./README.md)
2. [docs/architecture/system-overview.md](./docs/architecture/system-overview.md)
3. [docs/architecture/sync-state-machine.md](./docs/architecture/sync-state-machine.md)
4. [docs/architecture/data-model.md](./docs/architecture/data-model.md)
5. [docs/operations/troubleshooting.md](./docs/operations/troubleshooting.md)
6. [docs/release/release-playbook.md](./docs/release/release-playbook.md)

如果任务明确涉及某个方向，再补读：

- mobile 诊断包：[docs/operations/mobile-diagnostics.md](./docs/operations/mobile-diagnostics.md)
- sidecar 运维：[docs/operations/sidecar-runbook.md](./docs/operations/sidecar-runbook.md)
- 环境和密钥：[docs/operations/environment-and-secrets.md](./docs/operations/environment-and-secrets.md)
- 产品边界：[docs/product/constraints.md](./docs/product/constraints.md)
- iOS 构建验证：[docs/release/ios-build.md](./docs/release/ios-build.md)
- macOS 桌面构建验证：[docs/release/macos-desktop-build.md](./docs/release/macos-desktop-build.md)

## 多 Agent 派发优先规则

面对可以拆分的工程任务时，优先派发多个 agents 并行处理，以缩短探索、实现和验证周期。适用场景包括跨模块排查、前后端或多平台并行修改、独立测试/验证、文档与代码同步更新等。

派发前必须先明确每个 agent 的职责边界、可修改文件范围和预期产出；不同 agents 不得同时修改同一批文件或互相覆盖已有改动。主 agent 必须负责最终整合、冲突处理、self-review 和验证结果汇总。

以下情况不应强行多 agent 化：任务本身很小、下一步被单一关键结论阻塞、修改高度耦合、或并行会增加协议/状态机/持久化语义误改风险。

## 关键架构约束

- **Desktop 当前覆盖 macOS / Windows**；平台差异（如共享检测、打包）按当前代码和对应文档处理；开源仓库不提供官方签名 / 上传路径
- **队列绝对只读**：不允许用户在 UI 删除、调序、跳过队列项
- **全自动增量同步**：不允许手动勾选文件
- **无手动文件选择替代路径**：不得新增手动挑选文件来绕过 mobile 本地扫描和 pending 队列
- **单文件串行上传**：同一台手机同一时间只传 1 个文件
- **guest local LAN mode**：未登录 / 未订阅用户在前景 LAN 场景仍可发现、配对和自动同步
- **商业能力 fail-closed**：后台静默续传、远程访问、tunnel credentials 必须有官方 capability 和有效 entitlement；缺失、过期或无法确认时关闭
- **所有 DTO 类型从 `@lynavo-drive/contracts` 导入**，不允许在 desktop/mobile 中重新定义
- **`tmp/ui-demo/` 只做视觉参考**，不允许直接复制代码。实现以当前代码、`@lynavo-drive/contracts` 和测试矩阵为准。
- **Renderer 不直接访问** sidecar、文件系统、SQLite —— 全部走 preload bridge
- **Build 只能在本机进行，绝对不能在远端服务器上进行**。所有的代码构建、二进制编译、镜像打包必须在本地机完成，然后通过文件传输同步至远端服务器部署，以避免远端编译环境污染与资源争抢。

补充解释：

- 设备身份以 **mobile `clientId`** 为准，不以设备名、IP、目录名为准
- 历史“属于哪一天”以 **sidecar / desktop 完成日** 为准
- 真实上传集合必须来自 **mobile 本地 pending 队列**，不能只拿本轮新扫描素材
- iCloud 素材在扫描阶段照常入队，导出阶段才会触发云端下载
- 前景 LAN 同步 fail-open，不因登录态、订阅态或商业模块缺失而阻断
- 远程 / 后台能力 fail-closed，不允许用本地默认值把付费能力误开
- mDNS service、旧 data-dir、native package / bundle id、包 scope rename 是后续迁移边界；除非任务明确要求，不要在文档任务中执行迁移

## 开发流程

```bash
# 日常开发
pnpm install           # 安装依赖
pnpm build             # 构建 contracts + design-tokens（改了共享包后必须先 build）
pnpm --filter @lynavo-drive/desktop dev   # 启动 Electron 开发模式

# 验证
pnpm test              # 全量测试
pnpm typecheck         # 类型检查
pnpm format:check      # 格式检查
```

## 代码修改后的强制 review

只要本次任务修改了代码，交付前必须做一次 self-review，并在最终回复中说明：

1. **影响范围**：列出直接修改的模块、调用链、用户可见行为和可能受影响的平台
2. **污染检查**：确认是否污染或改变了相邻逻辑、共享状态、DTO/协议、持久化数据、队列语义、同步状态机、权限/订阅 gate、历史统计等非目标路径
3. **验证结果**：列出已运行的测试、类型检查、构建或无法运行的原因

如果发现改动可能影响非目标路径，必须继续收敛实现或明确标注剩余风险，不能只给出代码 diff。

## 包依赖关系

```
@lynavo-drive/contracts       ← 无依赖，纯类型 + 常量
@lynavo-drive/design-tokens   ← 无依赖，纯 token 值
@lynavo-drive/desktop         ← 依赖 contracts + design-tokens
```

改了 `contracts` 或 `design-tokens` 后，必须先 `pnpm build` 再启动 desktop dev。

## 编码规范

### TypeScript

- strict 模式，不允许 `any`
- 所有共享类型从 `@lynavo-drive/contracts` 导入
- 文件路径使用 `@renderer/` alias（在 renderer 内）
- 组件使用 named export，不用 default export

### React (Desktop Renderer)

- React 18.3（不是 19）
- shadcn/ui new-york 风格，通过 `npx shadcn@latest add` 安装组件
- 状态管理用 zustand，不用 Context 或 Redux
- 导航用简单 view state 切换（`app-store.currentView`），不用 react-router
- 页面级组件放 `features/<page>/`，共享组件放 `components/shared/`
- 玻璃态效果用 `<GlassCard>` 组件 + `@lynavo-drive/design-tokens` 的 elevation/glass token

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
- **当前重点**：异常恢复、连接状态提示、OSS 边界收口和本地构建 / 打包验证
- **回归基线**：以 `go test ./...`、`pnpm --filter @lynavo-drive/mobile exec tsc --noEmit`、iOS 构建、Android Debug/Release 构建和 `docs/testing/beta-test-matrix.md` 为准
- **交接基线**：新同事优先依赖 `docs/architecture/*`、`docs/operations/*`、`docs/release/release-playbook.md`

## 排障与构建验证入口

排障优先看：

1. [docs/operations/troubleshooting.md](./docs/operations/troubleshooting.md)
2. [docs/operations/mobile-diagnostics.md](./docs/operations/mobile-diagnostics.md)
3. [docs/operations/sidecar-runbook.md](./docs/operations/sidecar-runbook.md)

构建 / 打包验证优先看：

1. [docs/release/release-playbook.md](./docs/release/release-playbook.md)
2. [docs/release/ios-build.md](./docs/release/ios-build.md)
3. [docs/release/macos-desktop-build.md](./docs/release/macos-desktop-build.md)

Windows 桌面包当前跟随 `docs/release/release-playbook.md` 中的 Windows 小节，以及根目录脚本 `pnpm package:desktop:win`。

## Release profile 构建规则

AI 或人工执行 OSS 构建验证时，优先使用根目录单一入口查看或执行本机构建路径：

```bash
pnpm release --profile <review|prod> --targets ios,android,mac,win,linux
```

禁止用手动拼接历史 market 或 API base URL 环境变量来替代 release profile。OSS 仓库只维护本机构建和打包验证路径。如果只是确认将执行什么，使用 `--dry-run`。

## Sidecar HTTP API 端口

- TCP/LMUP 协议端口：**39393**
- Sidecar HTTP API 端口：**39394**
- 两个端口定义在 `@lynavo-drive/contracts` 的 `PROTOCOL_PORT` 和 `SIDECAR_HTTP_PORT`

## 事件命名约定

SidecarEvent 使用 **dot-notation**（如 `device.state.changed`），不使用 underscore。
