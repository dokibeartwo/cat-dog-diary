# Supabase 同步服务

这里是猫狗日记 Android 内测版的可选同步后端定义。客户端仍然可以完全离线使用；只有用户登录并开启同步后，任务、习惯、专注记录和提醒规则才会写入自己的 Supabase 项目。

## 部署

1. 在 Supabase 创建一个新项目，并启用邮箱验证码登录。
2. 使用 Supabase CLI 关联项目，再执行 `supabase db push`。
3. 把项目 URL 和 publishable/anon key 放在本机环境变量或未提交的 `.env.local` 中。不要把 service-role key 放进 APK、EXE 或 Git。
4. 客户端只调用迁移文件授予 authenticated 角色的 RPC；不要给客户端 service-role 权限。

迁移文件会创建严格按 `auth.uid()` 隔离的 RLS 表，以及以下 RPC：

- `push_mutations`：带版本检查、幂等 ID 和冲突记录的批量写入。
- `resolve_conflict`：在服务端锁定冲突实体，以新的可审计 revision 写入用户选择的字段，并标记冲突已解决。
- `pull_changes`：按更新时间和实体 ID 分页拉取变更。
- `ack_sync_cursor`：保存设备同步游标。
- `record_habit_event`：以事件形式记录习惯完成，重复提交不会重复计数。
- `acquire_focus_lease` / `release_focus_lease`：同一账号同时只允许一台设备持有专注租约。
- `delete_account`：删除 Supabase Auth 账号，相关公开数据通过外键级联删除。

## 安全边界

- 迁移中没有真实项目 URL、token 或 service-role key。
- `sync_*`、习惯事件和设备会话表均启用 RLS；普通客户端不能直接写入同步表，写入必须走 RPC 的 revision 检查。
- `delete_account` 会让当前登录会话失效。正式部署前请在测试项目验证 Auth 删除权限；如果项目策略禁止 SQL 删除 `auth.users`，应改为受保护的 Supabase Edge Function，并保留同样的调用权限。
- 任务正文、备注和习惯内容属于用户数据。公开 GitHub 仓库只包含 schema，不包含任何用户数据、导出文件或私有配置。

## 客户端变量示例

复制到未提交的 `.env.local` 后填写自己的项目值：

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=replace-with-your-publishable-key
```

`EXPO_PUBLIC_` 变量会进入移动端包，因此只能放 publishable/anon key。任何 service-role key 都必须留在服务端环境。

同步 mutation 的 `patch` 是本次修改的字段片段，同时带 `basePayload` 和 `baseRevision`。服务端会把不重叠的字段自动合并；同一字段发生并发修改时写入 `sync_conflicts`，客户端选择结果后再以新 revision 提交。`delete` 和 `restore` 也必须带当前 base revision。
