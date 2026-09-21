# 猫狗日记 1.1.0-beta.1（Android 同步内测）

这是 1.0.0 Windows 稳定版之后的跨设备同步开发基线，暂不替换稳定版安装包，也没有把未验证的 APK 冒充为正式发布物。

## 已加入

- Windows 可选 Supabase 邮箱验证码登录、同步状态、待上传数量、退出和删除云端账号。
- Windows 与 Android 共用实体白名单、v1 数据迁移、软删除、版本号、幂等 mutation、字段冲突记录和专注租约规则。
- Android Expo/React Native 客户端：今天、清单、每日坚持、专注、六套主题、SQLite 本地优先队列。
- Android SecureStore 会话保存、高重要性提醒、震动、锁屏显示、通知和精确闹钟权限入口。
- Supabase RLS、push/pull/游标、冲突解决、习惯事件、专注租约和账号删除 RPC。

## 当前限制

- 仓库没有真实 Supabase URL、publishable key 或用户数据；需要内测者自行创建项目并执行迁移。
- 当前环境未安装 Android SDK、Expo/EAS 和真机，因此没有可下载 APK，也未宣称通过 Android 12–15 真机验收。
- Android 14 及各厂商对后台全屏通知有系统限制；后台以高优先级通知、震动和锁屏显示为准，前台才显示主题化全屏提醒。
- 首版账号切换为安全优先：同一安装切换不同账号前需确认本机资料并清理应用数据，避免把本地队列误传给新账号。

## 验证

- Windows Node 回归：111 项通过。
- Android 静态结构测试：6 项通过。
- JavaScript 语法检查：通过。

详见 [README.md](README.md)、[apps/android/README.md](apps/android/README.md)、[PRIVACY.md](PRIVACY.md) 和 [supabase/README.md](supabase/README.md)。
