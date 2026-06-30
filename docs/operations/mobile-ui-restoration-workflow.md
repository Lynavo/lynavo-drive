# Mobile UI 一比一还原执行流程

本文档沉淀移动端 UI/UX 按 `/Volumes/workspace/work/vividrop-ui-mobile` 参考项目进行一比一还原的执行流程。登录页是第一轮完整试点，后续页面按同一流程推进。

配套的页面映射、subagent 派发边界、等待策略和验证矩阵见 `docs/operations/mobile-ui-restoration-coordination.md`。后续 coordinator 以该文档拆分工作，页面实现尽量交给 subagents 执行。

## 目标

- 以参考项目的 global UI 为视觉和交互基准，还原 React Native mobile global 页面。
- 保留当前仓库的业务行为、状态管理、导航、DTO、同步协议和 native sync 能力。
- 避免把 cn / global 两套市场逻辑混在一起。global 还原只改 global 页面、global shell、global 弹框和可复用 UI 基础件。
- 将高风险视觉能力沉淀成共享组件，例如 modal blur backdrop，后续页面直接复用。

## Source Of Truth

执行优先级：

1. 当前仓库实现：业务流程、状态来源、native bridge、权限、同步状态机。
2. `@lynavo-drive/contracts`：DTO、事件、端口、协议常量。
3. `/Volumes/workspace/work/vividrop-ui-mobile`：UI/UX 视觉参考。
4. `docs/testing/beta-test-matrix.md`：回归验证范围。

注意：

- 参考项目用于视觉和交互结构对照，不替代当前业务代码。
- 不要把参考项目里的 web 状态模型、mock 数据或不适合 RN 的实现直接搬进当前 app。
- 如果当前业务语义和参考 UI 不一致，先保留业务语义，再把 UI 映射到当前状态。

## 登录页试点流程

### 1. 明确市场边界

登录页最初的问题是 global / cn 边界没有先固定，导致容易误改 cn 登录逻辑。

最终原则：

- cn 登录页继续走 `LoginScreen.tsx` 现有手机号 / 邮箱 / CN 逻辑。
- global 登录页使用独立 `LoginGlobalScreen.tsx`。
- global 登录 shell 使用独立 `GlobalAuthScreenShell`。
- 登录页弹框、图标、协议确认流程都只接入 global 页面。

后续所有页面也要先确认入口属于 cn、global 还是共用页面。只还原 global 的页面，不顺手改 cn 分支。

### 2. 对照参考源码和截图

不能只凭肉眼截图调样式。登录页中 modal 遮罩层的问题反复出现，根因就是一开始只看截图，没有逐层核对参考源码。

固定步骤：

1. 用 `rg` 在参考项目中定位页面和组件。
2. 读取参考组件附近的常量、className、inline style。
3. 运行参考项目并截屏。
4. 运行当前 RN 页面并截屏。
5. 对比布局、色值、层叠、透明度、弹框行为。

登录页关键参考位置：

- `/Volumes/workspace/work/vividrop-ui-mobile/components/global/mobile-app-global.tsx`
- `LIGHT_GLASS_PAGE_STYLE`
- `LIGHT_MODAL_BACKDROP_CLASS`
- `LIGHT_CENTER_MODAL_CLASS`
- 登录 provider 按钮和协议确认 modal。

### 3. 先还原结构，再还原细节

登录页采用的顺序：

1. 页面背景和 shell。
2. logo、标题、副标题。
3. 三个素材能力卡片。
4. 登录卡片。
5. Google / Apple provider 按钮。
6. 协议 checkbox 与法律链接。
7. 未勾选协议时的协议确认 modal。
8. 已勾选协议后的 provider confirmation modal。
9. blur backdrop、图标细节、弹框 shadow / radius / spacing。

后续页面也按这个顺序，不要先陷入单个 icon 或色值。

### 4. 用 mock 数据暴露完整状态

之前设备管理、同步记录、访问记录数据太少，导致分页、筛选、空状态、列表密度都看不到。

后续页面还原时，每个页面要准备足够覆盖 UI 的 mock 数据：

- 空状态。
- 少量数据。
- 多页数据。
- loading。
- error。
- active / disabled / selected / pending 等交互状态。
- 权限或订阅 gate 状态。

mock 数据只服务于 UI 预览，不应污染真实 DTO 或持久化语义。

### 5. 弹框统一走共享 backdrop

登录页 modal 背景踩过几个坑：

- RN `filter: blur()` 不适用于 native backdrop。
- iOS `UIVisualEffectView` 的 system material 会额外叠加系统 tint，重启后容易偏灰。
- Android `RenderEffect` 默认只 blur 自己这一层，不能自动 blur 背后的页面。
- 只改 JS 参数但没有重编 native，会误判效果。

最终沉淀：

- iOS：`VividropBlurViewManager.m` 用 `UIVisualEffectView` + 低强度 `UIViewPropertyAnimator`，并在 `didMoveToWindow` 后统一应用，避免重启前后效果不一致。
- Android：`VividropBlurView.kt` 截取 Activity root 的低分辨率背景并做轻量 box blur。
- RN：`NativeModalBlurView.tsx` 按平台使用同名 native component。
- RN：`ModalBlurBackdrop.tsx` 负责叠加参考项目的 overlay 色。

默认 modal backdrop 参数：

```tsx
blurStyle = 'systemUltraThinMaterial'
intensity = 0.08
overlayColor = 'rgba(23,25,28,0.22)'
```

后续 global 弹框不要重复实现遮罩，直接用：

```tsx
<ModalBlurBackdrop />
```

特殊页面如底部 sheet 可按参考源码覆盖 `overlayColor` 或 `intensity`。

## 登录页复盘台账

登录页还原过程中，多处问题是在第一次实现后经反馈才修正。后续页面必须把这些问题当作前置检查项，而不是等视觉验收时再发现。

| 初始偏差 | 具体表现 | 根因 | 已采用方案 | 后续防错规则 |
| --- | --- | --- | --- | --- |
| 未登录入口不对 | 未登录时仍能看到主界面里的登录相关入口，而不是直接进入登录页 | 先改了页面局部 UI，没有先确认 auth shell 和导航入口 | 未登录态直接渲染 global 登录页；主界面不再放登录入口，只保留退出登录 | 每个页面先验证入口状态：未登录、已登录、退出登录后的首屏 |
| cn / global 边界不清 | global 登录页出现 `or phone`，并一度影响 cn 登录逻辑判断 | 没有先固定市场分支，只按当前页面现象补功能 | cn 继续使用 `LoginScreen.tsx`；global 独立使用 `LoginGlobalScreen.tsx` 和 `GlobalAuthScreenShell` | 只还原 global 时，不新增参考项目没有的 cn / phone / fallback 入口 |
| iOS global scheme 被 Debug 配置覆盖 | `SyncFlowMobileGlobal` 跑起来后仍可能显示 CN 登录 | 手动指定 `configuration=Debug` 会覆盖 global scheme 的 `DebugGlobal` 配置，导致 native market 常量仍是 `cn` | iOS global 验收固定使用 `SyncFlowMobileGlobal` + `DebugGlobal`，不要用普通 `Debug` 替代 | 每次 iOS global 冷启动截图前先确认 scheme、bundle id 和 configuration 三者都是 global |
| Android global 包走到 CN 登录 | Android `com.vividrop.mobile.global` 安装后仍显示手机号登录、验证码和 CN 协议 UI | JS market resolver 只读取 iOS `AppleAuthModule.SYNCFLOW_MARKET` / 环境变量；Android debug bundle 没有 native market 常量时 fallback 到 `cn` | Android 新增 `NativeMarketConfig`，由 `BuildConfig.FLAVOR` 暴露 `SYNCFLOW_MARKET`；JS resolver 优先读取该模块 | 每个 global 页面验收必须分别冷启动 iOS `DebugGlobal` 和 Android `globalDebug`，确认入口和 market UI 都是 global |
| QA 登录态只给 Metro env 无效 | Metro 带 `SYNCFLOW_VISUAL_QA=1` 启动后，iOS 仍停在未登录 global 登录页 | React Native app runtime 没有可靠读取 Metro shell 的自定义 env | iOS 通过 app launch env 暴露到 `AppleAuthModule` constants；Android 通过 `adb shell am start -e ...` intent extras 暴露到 `NativeMarketConfig` | 视觉 QA 配置必须进 app runtime：iOS 用 launch env，Android 用 intent extras；Metro 只负责刷新 JS bundle |
| QA mock 登录后又回到登录页 | iOS runtime log 显示 owner user id 已设置为 `99999`，但 UI 最终回到登录页 | 登录后的 TURN credentials 请求不在 dev mock interceptor 内，触发真实 refresh，mock refresh token 被真实 API 拒绝后清空 auth | dev sandbox mock 增加 `/tunnel/turn-credentials` 本地响应，并让 mock refresh token 不访问真实 API | 新增登录态 mock 时，要检查所有启动即发的登录后请求；不能只 mock profile/subscription |
| 登录页结构不完整 | logo、provider 按钮、协议区、能力卡片和 modal 层级与参考页不一致 | 只按截图近似搭了视觉，没有按参考源码逐块拆解 | 按参考源码顺序重建 shell、卡片、provider、协议、弹框 | 开始实现前先列参考组件结构清单，完成后逐项打勾 |
| 图标不完整或不匹配 | provider icon、能力卡片 icon、弹框 icon 与参考页存在差异 | 没有做 icon inventory，部分用现有通用 icon 替代 | 补充 `vividrop-logo.png`、统一 `Icon` 映射和登录页图标用法 | 每页必须先列 icon 清单：名称、来源、尺寸、颜色、所在状态 |
| 协议确认弹框不完整 | 未勾选协议后的确认 modal 和 provider confirmation modal 行为不完整 | 只还原静态登录卡片，遗漏交互状态 | 补齐协议确认 modal、provider confirmation modal 和按钮状态 | 每个弹框要验打开条件、关闭方式、主按钮、取消按钮、backdrop、图标和文案 |
| modal 玻璃遮罩方向错 | 反复调整 modal 本体，但真正不一致的是遮罩层背景 | 没有把 backdrop 和 modal content 分层对比 | 抽出 `ModalBlurBackdrop`，modal 内容继续单独控制 | 弹框验收必须分两层：backdrop 是否一致，content 是否一致 |
| modal 重启后变灰 | Fast Refresh 中看起来接近，重启后系统 material tint 变明显 | iOS native blur 默认值和生命周期没有稳定，且未每次重编验证 | iOS 改为原生 `VividropBlurView` + 低强度 animator；Android 使用 root snapshot blur | native UI 改动必须重新 build/run；截图以冷启动后效果为准 |
| Android 缺少同等效果 | iOS 做了 blur，Android 仍只有普通灰色遮罩 | Android `RenderEffect` 不能直接 blur 背后页面 | Android 原生层截取 Activity root 并轻量 blur，JS 层统一接口 | 共享视觉组件必须明确 iOS / Android 两端实现，不只验证一个平台 |
| mock 数据不足 | 设备管理、同步记录、访问记录看不到分页、筛选和完整列表密度 | 为了快速看 UI 只放少量 demo 数据 | 增加多页 mock 数据，补齐筛选 active、空状态和列表状态 | 页面还原前必须写状态矩阵，数据量要足够触发分页 |
| 筛选 UI 近似但不一致 | 访问记录筛选控件和参考页层级、间距、active 状态不一致 | 把筛选当成普通按钮样式处理，没有单独对照参考控件 | 回到参考源码核对 filter control 的结构和状态 | tab、filter、segmented control 都必须单独截屏对比，不归入普通按钮 |
| 帮助/设备禁用等局部交互偏差 | 点击帮助、禁用/取消禁用设备的弹框或反馈 UI 与参考不一致 | 只关注页面静态态，遗漏 secondary flows | 将帮助弹框、设备操作确认、空数据页纳入页面验收范围 | 页面不仅验首屏，还要验所有可点击入口的弹框、sheet 和反馈态 |

这些条目后续不能只作为背景说明。每还原一个页面，都要先把该页面可能命中的条目复制到页面映射里，作为完成标准的一部分。

## 后续页面还原流程

### Step 0. 建立页面映射

每个页面开始前先写清楚：

- 当前 RN 文件路径。
- 参考项目文件路径。
- global / cn / shared 范围。
- 入口导航位置。
- 页面依赖的 native module / store / API。
- 页面必须保留的业务语义。

示例：

```text
RN: apps/mobile/src/screens/SharedFilesScreen.tsx
Reference: /Volumes/workspace/work/vividrop-ui-mobile/components/global/mobile-app-global.tsx
Market: global
Must keep: shared files API, download gate, current binding state
Can mock: list items, pagination, filter options for UI preview
```

### Step 1. 提取参考结构

从参考项目提取：

- 页面背景。
- header / navigation。
- card / panel 结构。
- list row 结构。
- tab / filter / segmented control。
- button / icon / badge。
- empty / loading / error。
- modal / sheet / popover。

不要只摘色值。需要同时记录 spacing、radius、shadow、border、字体尺寸和交互层级。

### Step 2. 对照当前业务代码

检查当前 RN 文件：

- 状态来源是否来自 zustand / native module / API。
- 是否有已有测试覆盖。
- 是否有权限、订阅、登录态、设备绑定 gate。
- 是否存在 cn / global 复用逻辑。
- 是否有平台差异。

如果页面涉及同步状态、队列、设备绑定、文件下载，不允许为了还原 UI 改协议或状态机。

### Step 3. 先搭骨架

先改无业务风险的视觉骨架：

- shell / background。
- header。
- section layout。
- repeated item component。
- shared style constants。
- shared icon component。

不要在这一步重写数据流。

### Step 4. 补全状态和 mock

确保页面可以看到完整 UI：

- 列表数量足够触发分页。
- 筛选项足够展示 active / inactive。
- 空状态和错误态可触发。
- 弹框和 sheet 可触发。
- loading / disabled / pending 状态可见。

真实逻辑暂时无法触发的状态，优先在 UI 层用 demo/mock 分支隔离，不写入 native / storage / DTO。

### Step 5. 细节对齐

按下面顺序收口：

1. spacing。
2. typography。
3. color。
4. radius。
5. border。
6. shadow。
7. icon。
8. pressed / disabled / loading states。
9. modal / sheet backdrop。

不要反过来先换 icon，再大幅改布局。

### Step 6. 真机/模拟器截图对比

每个页面至少需要：

- 参考项目截图。
- iOS RN 截图。
- Android RN 截图，如果有 emulator。

截图检查项：

- 首屏信息密度是否一致。
- 元素层级是否一致。
- 文字是否换行/溢出。
- 列表行高是否一致。
- 弹框遮罩是否一致。
- 底部 tab / safe area 是否一致。
- 空状态是否一致。

如果截图不一致，先回到参考源码看具体层叠和样式，不要凭感觉调。

### Step 7. 验证

最小验证：

```bash
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
pnpm --filter @lynavo-drive/mobile test -- <相关测试名>
git diff --check
```

iOS native 或 iOS UI 改动：

```bash
# 使用 XcodeBuildMCP 的 build_run_sim / screenshot
```

Android native 或 Android UI 改动：

```bash
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="$HOME/Library/Android/sdk" \
ANDROID_SDK_ROOT="$HOME/Library/Android/sdk" \
./gradlew :app:assembleGlobalDebug --console=plain
```

如果有 emulator：

```bash
$HOME/Library/Android/sdk/platform-tools/adb devices
$HOME/Library/Android/sdk/platform-tools/adb install -r apps/mobile/android/app/build/outputs/apk/global/debug/app-global-debug.apk
```

## 常见问题和处理方式

### 问题 1：global / cn UI 混改

表现：

- global 登录页出现 phone fallback。
- cn 登录逻辑被误删或被 global 样式污染。

处理：

- global 页面独立文件或独立 shell。
- shared 组件只放真正跨市场一致的基础组件。
- 改动前明确市场范围。

### 问题 2：只看截图，不看参考源码

表现：

- backdrop、filter、shadow、border 看起来接近但实际层级不对。
- 重启后效果变化。

处理：

- 必须查参考源码的 className / inline style。
- 必须运行参考页截图。
- native 效果必须重编验证。

### 问题 3：web CSS 不能直接映射到 RN

典型例子：

- `backdrop-filter: blur(3px)`
- `backdrop-blur-xl`
- `box-shadow`
- CSS grid。

处理：

- RN 用 shared component 承接。
- iOS/Android 分别实现 native 能力。
- JS 层统一暴露稳定接口。

### 问题 4：Android blur 和 iOS blur 语义不同

表现：

- Android `RenderEffect` blur 了自己，没有 blur 背景。
- iOS system material 有额外 tint。

处理：

- iOS 使用低强度 native blur。
- Android 使用 root snapshot + blur。
- overlay 颜色在 RN 层统一叠加。

### 问题 5：mock 数据不足

表现：

- 看不到分页。
- 看不到筛选 active 状态。
- 看不到空状态。

处理：

- 每页还原前列出状态矩阵。
- mock 数据覆盖完整 UI。
- mock 不进入协议、native、持久化层。

### 问题 6：native 改动没有重编

表现：

- Fast Refresh 后看起来对，重启后又不对。
- JS 参数变了，但 native 默认值仍旧。

处理：

- 改 iOS `.m/.swift` 后必须重新 build/run。
- 改 Android `.kt` 后必须重新 assemble/install。
- 截图以重启后结果为准。

## 页面交付 Checklist

每个页面还原完成前，必须确认：

- [ ] 已确认 market 范围。
- [ ] 已记录 RN 页面和参考页面映射。
- [ ] 已读参考源码，不只看截图。
- [ ] 已列出本页结构清单和 icon inventory。
- [ ] 未新增参考项目不存在的入口、文案或 fallback。
- [ ] 已验证未登录 / 已登录 / 退出登录后的入口状态，或说明本页不涉及登录态。
- [ ] 已覆盖空 / loading / error / 多数据 / 分页 / 弹框状态。
- [ ] 已单独核对 tab / filter / segmented control 的 active / inactive 样式。
- [ ] 已单独核对 modal backdrop 和 modal content。
- [ ] 已覆盖所有可点击 secondary flows，例如帮助、确认、禁用、取消、关闭。
- [ ] 未改 DTO、协议、同步状态机、队列语义。
- [ ] 未污染 cn 逻辑。
- [ ] iOS 截图已核对。
- [ ] Android 截图已核对，或说明没有 emulator。
- [ ] TypeScript 通过。
- [ ] 相关测试通过。
- [ ] native 改动已执行对应平台构建。
- [ ] 最终回复包含影响范围、污染检查、验证结果。

## 建议页面推进顺序

按用户感知和复用价值排序：

1. 登录页和 auth shell。
2. 通用 modal / sheet / backdrop。
3. Home / SyncActivity 主同步页。
4. History / Sync records。
5. Device management。
6. Remote access / Shared files。
7. Help / Settings。
8. 订阅、权限、异常恢复等低频页面。

优先把通用组件抽出来，再逐页替换，避免每个页面重复实现玻璃卡片、弹框遮罩、列表行和 filter controls。
