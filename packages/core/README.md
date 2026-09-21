# `@cat-dog-diary/core`

这是 Windows 与 Android 共用的离线优先同步核心。它不依赖 Electron、SQLite、Supabase 或 Node 原生模块，方便在桌面端、React Native 和测试环境复用。

入口是 `src/index.js`，主要能力包括：

- `migrateV1ToV2` / `projectV2ToV1`：把 1.0.0 的 `done-data.json` 映射为带账号、设备、版本和软删除字段的实体快照。
- `SyncEngine`：生成本地变更、维护 outbox、提交和拉取变更。
- `InMemorySyncServer`：用于测试同步接口的幂等、游标和冲突行为；生产环境替换成 Supabase 适配器。
- `MemorySyncStore`：SQLite 适配器的同构测试实现。字段和索引见 `src/sqlite-schema.sql`。
- `occurrenceKey`：用 `seriesId + dueAt/planDate` 标识重复任务的一次执行，避免双设备重复生成。
- `occurrenceId`：从 `seriesId + occurrenceKey` 计算稳定的下一期编号，离线双设备不会各自生成一份下一期。
- `projectState` / `applyEntities`：在桌面完整状态和同步实体之间做严格白名单投影。任务步骤、提醒规则、习惯完成事件和专注记录均为独立实体；`nextReminderAt`、已触发标记、离席状态、当前番茄钟和小组件设置不会上传。

`MemorySyncStore` 只允许当前账号读写实体，服务端也会再次校验账号，避免把一个账号的数据拉到另一个账号。

## 同步实体

同步协议只接受以下九种类型：`task`、`step`、`habit`、`habit_event`、`category`、`stage_plan`、`reminder_rule`、`focus_session`、`preference`。`preference` 目前只同步账号级 `themeId`；设备通知、窗口位置、启动项和运行中的提醒仍保存在本机。
