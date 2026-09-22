# 猫狗日记 Android 内测 0.1.1

采用 Expo SDK 54、React Native 0.81 和 TypeScript，配套 Windows 同步内测源码为 1.1.0-beta.3。Windows 1.0.0 稳定版不受影响。

当前交付阶段为**离线内测**：不必创建 Supabase 项目、不需要账号。GitHub 原生构建明确留空云端配置；任务与提醒只在本机运行。下列同步模块已进入源码测试，但不代表公开云端服务已经部署或完成双设备实测。

## 当前能力

- 今天、清单、每日坚持、专注、提醒、设置六个页面；任务详情、小步骤、搜索与阶段排期预览。
- 执行日期／时间、仅日期、每天推进、稍后分配和最晚截止分开；重复任务使用跨设备一致的下一期 ID。
- 六套原有主题与四张原屏保；前台全屏提醒完整展示图片，模糊铺底。不增加素材。
- SQLite 保存实体、不可变待上传操作和首次合并备份；并发写入使用版本检查。
- Supabase 邮箱验证码、先预览后合并、账号隔离、离线编辑、冲突逐字段选择、暂停／恢复同步、退出及删除云端账号。
- 专注使用现实结束时间与有效计时片段，暂停不计时，提前结束不增加完成轮数；登录时先获取单设备专注租约。
- 循环提醒未处理只保留一条，关闭后重新计算间隔；专注期间暂缓习惯及循环检查。
- 前台／联网恢复同步、实时订阅与 WorkManager 机会性后台同步（最短请求间隔 15 分钟，由系统实际调度）。
- 本机数据导出为 JSON 文件，系统分享保存。会话令牌分段存于 SecureStore。

## 安装包和签名

GitHub Actions → **Android native internal APK** → Run workflow。工作流测试源码、编译自包含 APK，再在 Android 15 模拟器安装并截图，不需要 Metro 服务器或 Expo 账号。

产物 `cat-dog-diary-android-internal` 使用 Expo 模板调试签名，仅供内测，不是正式发行签名。公开发行前维护者须创建、备份长期签名密钥；后续升级必须使用相同密钥。请先导出备份，不要让内测包成为重要数据的唯一副本。

本次不启用云同步。后续同步联调须按 [后端说明](../../supabase/README.md) 部署全部迁移，再明确切换构建配置，填入 `EXPO_PUBLIC_SUPABASE_URL` 和 `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`。

两变量会进入 APK：它们是公开客户端配置，安全依赖 RLS 和账号认证。**绝不能填 service role 或 secret key**，构建检查会拒绝；真实值不提交 Git。

## 本地开发

需要 Node.js 22+，原生构建另需 JDK 17 与 Android SDK。仓库根目录和此目录分别运行 `npm ci`。复制 `.env.example` 为 `.env.local` 配置云端，离线开发可不填。

```powershell
npm run verify:config
npm run typecheck
npm test
npm run prebuild
npm run android
```

`npm run start` 启动 Metro。WorkManager 与 SQLite 验收使用原生构建，不以 Expo Go 为准。EAS 是可选方案，需自行配置 Expo 项目与 EXPO_TOKEN。

## 提醒和验收边界

Android 13+ 由用户主动允许通知；Android 12+ 可进入“闹钟和提醒”特殊权限设置。高重要性通知频道支持声音、震动和锁屏显示，震动可关闭。拒绝权限不伪装成功。

前台使用主题全屏提醒，后台使用系统通知，不能保证所有品牌强制全屏。WorkManager 不是秒级推送；强制停止、Doze、厂商省电可能推迟同步，已排程本地提醒不依赖 FCM。

自动测试覆盖 SQLite、合并保护、队列重试、并发写入、账号隔离、通知适配器去重和专注片段。真实 OTP、双设备、Android 12–15、无 Google 服务手机、重启／省电／闹钟权限撤销仍需真机验收。

## 数据隔离

换账号使用独立数据集，不要求清除应用数据。退出保留本机资料，同一账号重新登录继续上传离线修改。首次关联仍需确认合并。删除云端账号不删除本机资料；导出包含任务正文，只交给信任的人。
