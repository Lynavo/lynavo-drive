# 上传任务控制后续行动

本文件整理这一轮 mobile iOS 上传任务控制相关修改后的当前状态、剩余事项与建议执行顺序。

说明：

- 这里以当前代码实现为准，不再把历史产品文档当作唯一 source of truth
- 重点范围是 `apps/mobile/ios/SyncEngine/` 与 `apps/mobile/src/screens/`

## 1. 当前结论

目前这轮修改后，核心行为已经接近目标语义：

1. 手动任务优先于自动任务
2. 暂停自动上传不会中断当前已经进入 TCP 传输的文件
3. 当前文件传完后，会重新检查队首，优先执行手动任务
4. 取消手动批次时：
   - 已经进入 TCP 传输的当前文件会传完
   - 尚未进入 TCP 传输的当前文件会被跳过
   - 同批次后续文件会被跳过
5. 相册分页后的“已上传 / 排队中”状态，已从“继续拉下一页”改为“重刷当前可见范围”

## 2. 已经修到的点

### 2.1 手动任务优先级

当前队列已按 `priority DESC, id ASC` 排序，且每个文件完成后会重新检查 DB 队首；如果队首变化，会打断当前批次并重新取队列。

这表示：

- 自动批次进行中插入手动任务，不会打断当前文件
- 当前文件结束后，会尽快切到手动任务

### 2.2 取消手动批次

当前 `cancelManualBatch` 已将以下状态纳入取消：

- `queued`
- `discovered`
- `preparing`
- `ready`
- `uploading`
- `cloud_downloading`

同时上传循环新增了两层防护：

1. 切换到下一个文件前，先查 DB 是否已被标记 `cancelled`
2. 当前文件 export 完成后、TCP 上传开始前，再查一次 DB；若已取消则直接跳过并清理临时文件

这已经补上之前“当前文件还没进 TCP，但仍会继续进入上传”的缺口。

### 2.3 相册分页状态刷新

当前事件刷新逻辑改为从 offset `0` 重新拉到 `offsetRef.current`，再用 `setAssets(...)` 覆盖现有列表，而不是 append 下一页。

这可以修掉：

- 已显示项目状态不更新
- 翻页后状态错位
- 列表重复追加

## 3. 剩余事项

### 3.1 ~~更新注释与语义说明~~ ✅ 已完成

注释已同步更新。`UploadStore.cancelManualBatch()` 当前注释（line 500-504）准确描述三个检查点：
1. 文件之间（index > 0）：跳过 cancelled 项
2. export 完成后、TCP 开始前：跳过并清理临时文件
3. 已进入 TCP：当前文件传完后停止

### 3.2 补回归测试

这轮修改主要在 iOS 原生上传状态机，建议至少补一轮针对性验证，不要只靠手看代码。

最低建议覆盖这 6 个场景：

1. 自动上传进行中，当前文件 A 正在 TCP 传输，此时提交手动批次
结果：A 传完后，下一项应切到手动任务，不继续跑 auto 的 B/C

2. 自动上传进行中，当前文件 A 正在 TCP 传输，此时暂停自动上传
结果：A 传完；后续 auto 项不再继续

3. 手动批次当前文件卡在 `cloud_downloading`
此时点击“取消本次手动上传”
结果：当前文件不进入 TCP，后续同批次全部停止

4. 手动批次当前文件已 export 完、但尚未开始 TCP
此时点击“取消本次手动上传”
结果：当前文件不进入 TCP，临时文件被清理

5. 手动批次当前文件已进入 TCP
此时点击“取消本次手动上传”
结果：当前文件传完，后续同批次停止

6. 相册工作台加载多页后，某些素材在后台完成上传
结果：当前已显示页签状态刷新正确，不重复、不丢标记

### 3.3 检查前端按钮文案与可见性

虽然这轮核心状态机已经更稳，但建议再做一轮 UI 对照，确认 `SyncActivityScreen` 在以下状态下按钮展示符合预期：

1. 当前任务是 manual，auto 为 active
2. 当前任务是 manual，auto 为 paused
3. 当前任务是 auto，auto 为 active
4. 当前没有上传任务，但 auto 为 paused

重点确认：

- 不会再出现“切 tab 后恢复按钮消失”
- 不会把“取消本次手动上传”错误隐藏

## 4. 建议执行顺序

建议按这个顺序收尾：

1. 跑一轮上述 6 个回归场景
2. 如果第 6 点仍有异常，再继续查 `AlbumWorkbenchScreen` 的事件刷新与分页边界
3. 回归通过后，再决定是否需要补自动化测试或诊断日志增强

## 5. 现在不建议再动的地方

在没有新问题前，先不要继续扩大改动范围到：

1. Android 上传实现
2. Desktop 端队列模型
3. 传输层中途 abort TCP

原因：

- 当前目标已经聚焦在 iOS SyncEngine 的状态切换正确性
- 中途 abort TCP 会显著增加状态机复杂度，现阶段收益不高

## 6. 相关代码位置

- `apps/mobile/ios/SyncEngine/SyncEngineManager.swift`
- `apps/mobile/ios/SyncEngine/UploadStore.swift`
- `apps/mobile/src/screens/AlbumWorkbenchScreen.tsx`
- `apps/mobile/src/screens/SyncActivityScreen.tsx`
- `apps/mobile/ios/SyncEngine/AlbumBrowserService.swift`
