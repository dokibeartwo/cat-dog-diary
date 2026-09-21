# 猫狗日记 Android 同步内测客户端

这是猫狗日记 1.0.0 的 Android 同步内测客户端，采用 Expo + React Native + TypeScript。首版设计为本地优先：未配置云端时可以浏览和编辑自己的任务；配置 Supabase 后开启邮箱验证码登录和双向同步。

## 当前能力

- 今天、清单、每日坚持、专注、设置五个基础页面。
- 六套与 Windows 端一致的主题令牌：星糖梦境、晴空蜜桃、莓果心动、奶杏布丁、青柠糖球、蜜桃心语。
- 邮箱验证码登录；未设置环境变量时明确保持离线模式，不伪造云端登录。
- SQLite 持久化任务、习惯、主题和同步待上传队列；断网修改在本机保存，联网后上传。
- 专注轮保存绝对结束时间，应用重启或从后台回来后按现实时间恢复，不重复计时。
- 高重要性通知、声音、震动、锁屏显示、精确提醒权限和前台主题提醒的适配入口。
- 设置页提供退出登录和“删除云端账号”；删除云端资料前会二次确认，本机 SQLite 数据会保留。
- 首次登录或删除云端账号后，自动同步会暂停；在设置中点击“立即同步”先查看本机/云端数量，再选择合并、使用云端或保留本机，确认前不上传也不覆盖本机数据。
- 为避免把本机队列误传给其他账号，退出后切换账号需要先清理应用数据并重新确认本机资料；同一账号重新登录不受影响。
- 不包含任何真实 Supabase URL、publishable key 或用户数据。

## 本地运行

需要 Node.js、Android Studio 和 Expo 工具链。首次安装依赖后：

```powershell
npm install
Copy-Item .env.example .env.local
npm run start
```

在 `.env.local` 中填写 Supabase 项目的 URL 和 publishable key 后，重新启动 Expo。发布 APK 使用 EAS 的 `preview` 配置；真实密钥只放在本地环境变量，不要提交到仓库。

```powershell
npm run typecheck
npm test
npx eas build --profile preview --platform android
```

也可以在 GitHub Actions 手动运行 `Android preview APK` 工作流。首次使用前，需要在 Expo 账号中执行一次 `npx eas init`，把生成的 `extra.eas.projectId` 写回 `app.json`，并在仓库 Settings → Secrets and variables → Actions 中配置 `EXPO_TOKEN`、`EXPO_PUBLIC_SUPABASE_URL` 和 `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`。工作流只把 publishable key 注入构建环境，不能使用 service-role key；EAS 完成后会在日志中提供 APK 下载地址。

## 提醒权限说明

Android 13 及以上需要通知权限；Android 12 及以上的精确到点提醒可能需要“闹钟和提醒”权限。应用会创建高重要性提醒频道并请求震动、锁屏显示等能力。Android 14 对后台全屏通知有系统限制，因此后台提醒以高优先级通知、震动和锁屏显示为准，应用正在前台时才显示主题化全屏页面。

## 数据与隐私

任务和习惯保存在应用私有 SQLite；登录后才会上传到你配置的 Supabase 项目。会话凭据使用 Android Keystore 支持的 SecureStore 保存。没有真实 URL/key 的构建不会连接任何云端。账号删除应通过已部署的 `delete_account` RPC 完成。

`src/core/sync/types.ts` 定义跨设备实体与 mutation 队列，`schema.ts` 负责 v1 JSON 迁移和白名单校验，`services/sync.ts` 已调用 `push_mutations` / `pull_changes` RPC。通知编号、离席状态和当前设备 UI 状态不上传。
