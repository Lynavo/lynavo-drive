# AGENTS.md — Vivi Drop（SyncFlow V2）

## 项目概述

**Vivi Drop**（内部 monorepo 代号 SyncFlow V2）是一款面向短视频与素材协作场景的**局域网素材同步与目录管理工具**，支持移动端（iOS / Android）与 PC 端（macOS / Windows）协同工作。核心工作流：

1. 手机端拍摄或保存素材 → 上传到当前连接电脑的 **`received`** 接收目录
2. PC 端集中管理、处理、剪辑素材 → 成品放入 **`shared`** 共享目录
3. 手机端以**只读方式**访问当前连接电脑的 `shared`，支持预览图片、播放视频、下载

Monorepo 当前包含 Electron 桌面应用、Go sidecar、React Native 移动端，以及 iOS / Android 平台原生同步能力。

## 当前开发依据

开发和修改请按以下优先级判断：

1. **产品规则**：`Vivi Drop产品需求文档.docx`（当前版本 **PRD V2.1**，位于仓库根目录）——业务规则、交互流程、状态枚举、异常处理、校验规则的**权威来源**
2. **当前已提交代码**：实际运行行为以仓库中的现有实现为准；**与 PRD 冲突时视为需要对齐的 gap，不默认以代码为准**（但修改前必须评估回归影响）
3. **`@lynavo-drive/contracts`**：共享 DTO、常量、事件名、端口定义的唯一来源
4. **架构 / 运维 / 发布文档**：用于解释当前实现细节，而不是覆盖 PRD 或代码
5. **`docs/testing/beta-test-matrix.md`**：当前内测验证范围、回归场景和发布门槛

> **已知重大 gap（PRD V2.1 vs 现行实现）**：
> - PRD 要求自动/手动上传**互斥**（见下文「关键架构约束」），而早期实现基于「共存 + 手动优先排序」设计。动这块逻辑前先确认当前代码分支行为，并读本文件「产品规范（PRD V2.1）」章节。
> - 手动上传在 PRD 中是**持续追加的单一队列**，不是按次批次；取消语义 = 清空整个手动队列。

历史文档如果后续恢复，只能作为背景参考；产品规则只以最新版本 PRD 为准。

## 新会话接手顺序

如果是新的 AI coding 会话，先按这个顺序建立上下文：

1. **[Vivi Drop产品需求文档.docx](./Vivi%20Drop产品需求文档.docx)（PRD V2.1，产品规则权威来源）**
2. [README.md](./README.md)
3. [docs/architecture/system-overview.md](./docs/architecture/system-overview.md)
4. [docs/architecture/sync-state-machine.md](./docs/architecture/sync-state-machine.md)
5. [docs/architecture/data-model.md](./docs/architecture/data-model.md)
6. [docs/operations/troubleshooting.md](./docs/operations/troubleshooting.md)
7. [docs/release/release-playbook.md](./docs/release/release-playbook.md)

如果任务明确涉及某个方向，再补读：

- mobile 诊断包：[docs/operations/mobile-diagnostics.md](./docs/operations/mobile-diagnostics.md)
- sidecar 运维：[docs/operations/sidecar-runbook.md](./docs/operations/sidecar-runbook.md)
- 环境和密钥：[docs/operations/environment-and-secrets.md](./docs/operations/environment-and-secrets.md)
- 产品边界：[docs/product/constraints.md](./docs/product/constraints.md)
- iOS TF：[docs/release/ios-testflight.md](./docs/release/ios-testflight.md)
- macOS 签名：[docs/release/macos-desktop-signing.md](./docs/release/macos-desktop-signing.md)

## 关键架构约束

### 平台与传输

- **PC 支持 macOS 和 Windows**（v2 范围）
- **单文件串行上传**：同一台手机同一时间只传 1 个文件
- **一对多连接、单点默认**：一台手机可连接多台电脑，但**同一时刻仅一台「当前连接电脑」**，自动上传 / 手动上传 / 共享目录默认均指向该电脑
- **PC 多设备并发调度**：一台电脑同时接多台手机时，**不允许用户手动排序**；系统按任务进入电脑端队列的先后自动调度，兜底按设备首次连接顺序
- **PC 剩余空间告警**：低于 **500MB** 时暂停接收新任务并告警

### 目录模型

- PC 端基于用户选择的**根目录**自动生成两个系统真实目录：
  - `received/`：接收移动端上传的素材
  - `shared/`：PC 侧放置共享给移动端访问的成品
- **移动端对 `shared` 只读**：支持列表、缩略图、预览、播放、下载；不支持上传、修改、删除
- **`received` 是手动上传和自动上传的唯一目标目录**

### 上传模式（PRD V2.1 — 互斥，不再共存）

- **自动上传与手动上传互斥**，同一时刻只能有一种模式占用传输通道
- 自动上传执行中 → 用户要手动上传，**必须先关闭自动上传**
- 手动上传执行中 → 用户开自动上传开关，**必须弹出确认框**：「当前正在上传，继续自动上传将中断手动上传，是否继续？」
  - 确认：立即中断手动、清空手动状态、自动上传接管通道
  - 取消：保持手动上传继续执行、自动上传不开启
- **手动上传是持续追加的单一队列**，不是按次独立批次；新选素材去重后追加到当前手动队列
- **取消手动上传** = 清空当前整个手动队列（已完成项保留、当前传输项立即停止、未完成项全部移除），首页退出手动态并先进入「手动上传已完成」完成态卡片，再进入空闲态
- **关闭自动上传** = 停止当前自动任务、状态切换为「已关闭」、不再监听新素材；自动上传开关状态**不会被设备离线等系统事件自动改写**，只由用户主动操作变更
- **队列可控性**：允许暂停/恢复自动上传、取消整个手动队列；**不允许**删除单个队列项、跳过、调序、手动标记完成

### 去重

- 基于**本地素材唯一标识 + 「已传输」标记**全局去重
- 自动上传命中已传素材：**静默过滤**，不入队
- 手动上传命中已传素材：相册中置灰、不可选中；滑动连续选择时自动跳过已传/排队中/上传中素材
- 去重作用域覆盖自动队列与手动队列，防止两种模式重复处理同一文件

### 账号与订阅

- **手机号验证码一体化登录注册**（仅支持国内手机号）；新手机号自动注册并获得 **7 天全功能试用**
- 账号/订阅状态枚举：`试用中` / `已订阅` / `试用已结束` / `订阅已到期`
- 价格：月度 ¥9.9、年包 ¥104.5（8.8 折）
- 核心功能（上传、共享目录访问、下载）需在**试用中或已订阅**状态；登录、账号信息、帮助、订阅购买在任何状态下可用

### 工程约束

- **所有 DTO 类型从 `@lynavo-drive/contracts` 导入**，不允许在 desktop/mobile 中重新定义
- **`tmp/ui-demo/` 只做视觉参考**，不允许直接复制代码。实现以 PRD V2.1、当前代码、`@lynavo-drive/contracts` 和测试矩阵为准
- **Renderer 不直接访问** sidecar、文件系统、SQLite —— 全部走 preload bridge
- **Build 只能在本机进行，绝对不能在远端服务器上进行**。所有的代码构建、二进制编译、镜像打包必须在本地机完成，然后通过文件传输同步至远端服务器部署，以避免远端编译环境污染与资源争抢。


### 身份与历史

- 设备身份以 **mobile `clientId`** 为准，不以设备名、IP、目录名为准
- 历史「属于哪一天」以 **sidecar / Mac 完成日**为准
- 真实上传集合必须来自 **mobile 本地 pending 队列**，不能只拿本轮新扫描素材
- iCloud 素材在扫描阶段照常入队，导出阶段才会触发云端下载

## 产品规范（PRD V2.1）

以下为 `Vivi Drop产品需求文档.docx` V2.1 中的**规则性摘要索引**。具体校验项、异常处理、toast 文案、字段细节**以 PRD 原文为准**，这里只列出实现时必须对齐的要点：

| 模块 | 关键规则速查 |
|---|---|
| 登录注册（PRD §3.1） | 手机号 6 位验证码、一体化流程、必勾协议；仅国内手机号；验证码 6 位自动校验；异常态文案见 PRD |
| 会员与试用（§3.2） | 7 天全功能试用；到期前 7 天 + 到期当天两次提醒；核心功能门控；续订引导弹窗 |
| 设备连接（§4.1–4.3） | 局域网扫描 → 6 位连接码自动校验 → 同步动态首页；已连接设备免重输连接码；**切换设备前若有传输任务必须先确认**；离线状态禁用上传/共享目录并提供「重试连接」 |
| 移动端首页（§5） | 同步动态为核心工作台；主卡片按**任务来源区分**按钮：手动 → 「取消本次手动上传」；自动 → 「关闭自动上传」；**手动完成后必须先展示完成态卡片**再进入空闲态 |
| 相册页（§6.1–6.3） | 结构：自动上传入口在上、相册内容在下；**底部悬浮操作栏**仅在已选 >0 时显示，含「全选/取消全选」和「上传(N)」；**全选只作用于当前筛选结果中的可上传素材**；支持**滑动连续选择**；Tab：全部/图片/视频/未传/已传 |
| 自动上传设置（§6.2） | 时间范围：此时此刻 / 全部 / 自定义（精确到年月日时分）；不区分仅图/仅视频 |
| 互斥规则（§6.4、§6.6） | 见上文「上传模式」；UI 必须提供确认弹窗与 toast；状态回写失败也要停止对应任务并记录异常 |
| 共享目录（§7） | 只读；空目录不是错误；**订阅到期用户不可下载**（弹会员引导） |
| 设置页（§8.1） | 模块：账号与订阅、我的设备、同步与诊断、当前连接电脑、其他（帮助、退出登录）；**退出登录需二次确认**；**传输中切换设备需确认** |
| 移动端帮助页（§8.2） | 入口在设置页；内容包括基础功能介绍、首次使用引导、上传与共享说明、常见问题、联系我们（邮箱 support@vividrop.cn） |
| PC 端首页看板（§9） | 今日接收数、空间占用、剩余空间、各设备状态；**空间 < 500MB 标红并暂停接收** |
| PC 端目录管理（§10） | 根目录 → 自动生成 received + shared；**接收中禁止切换目录**；设备详情支持时间范围筛选历史记录 |
| PC 端帮助页（§11） | 系统权限指引、首次使用引导、常见问题；支持图文 |

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
- **当前重点**：异常恢复、后台上传、连接状态提示、beta 收口和发布验证
- **回归基线**：以 `go test ./...`、`pnpm --filter @lynavo-drive/mobile exec tsc --noEmit`、iOS 构建、Android Debug 构建和 `docs/testing/beta-test-matrix.md` 为准
- **交接基线**：新同事优先依赖 `docs/architecture/*`、`docs/operations/*`、`docs/release/release-playbook.md`

## 排障与发布入口

排障优先看：

1. [docs/operations/troubleshooting.md](./docs/operations/troubleshooting.md)
2. [docs/operations/mobile-diagnostics.md](./docs/operations/mobile-diagnostics.md)
3. [docs/operations/sidecar-runbook.md](./docs/operations/sidecar-runbook.md)

发布优先看：

1. [docs/release/release-playbook.md](./docs/release/release-playbook.md)
2. [docs/release/ios-testflight.md](./docs/release/ios-testflight.md)
3. [docs/release/macos-desktop-signing.md](./docs/release/macos-desktop-signing.md)

## Sidecar HTTP API 端口

- TCP/LMUP 协议端口：**39393**
- Sidecar HTTP API 端口：**39394**
- 两个端口定义在 `@lynavo-drive/contracts` 的 `PROTOCOL_PORT` 和 `SIDECAR_HTTP_PORT`

## 事件命名约定

SidecarEvent 使用 **dot-notation**（如 `device.state.changed`），不使用 underscore。
