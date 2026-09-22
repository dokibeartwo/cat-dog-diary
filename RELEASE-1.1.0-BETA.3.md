# 猫狗日记离线内测：Windows 1.1.0-beta.3 / Android 0.1.1

完善跨设备数据层及安卓实际界面，不替换 Windows 1.0.0 稳定下载，不改维护者当前安装目录和私人数据。

2026-09-22 确认先完成**离线内测**。APK 不连接 Supabase，无需注册账号。同步模块保留，真实云端联调另行安排。

Windows 内测包使用旁边的 `本地数据` 目录；解压到 E 盘即将任务 JSON、同步 SQLite 与每日备份保存在 E 盘。新目录初始为空，不会冒充正式版任务丢失；如需试用旧任务，请从正式版导出，再在内测版预览导入。不要将“本地数据”发给朋友或上传 GitHub。正式版数据与快捷方式保持原状。

## 下载与安装

- 安卓手机：[cat-dog-diary-android-0.1.1-internal.apk](https://github.com/dokibeartwo/cat-dog-diary/releases/download/v1.1.0-beta.3/cat-dog-diary-android-0.1.1-internal.apk)，约 43 MiB，包含 ARM64 与 x86_64。安装后直接离线使用，不需要开发服务器。
- Windows 内测：[cat-dog-diary-1.1.0-beta.3-windows-x64.zip](https://github.com/dokibeartwo/cat-dog-diary/releases/download/v1.1.0-beta.3/cat-dog-diary-1.1.0-beta.3-windows-x64.zip)，完整解压后运行 EXE。
- [安装与手机验收清单](https://github.com/dokibeartwo/cat-dog-diary/blob/main/OFFLINE-BETA.md)。发布页附有 `SHA256SUMS.txt`。

这是 **Pre-release / 内测版**，不替换 1.0.0 稳定版。不含作者真实任务，不自动搬移旧数据；两端数据暂时独立。

## 改进

- Android 任务／步骤／阶段规划、习惯、番茄钟、提醒中心、账号和主题界面；前台提醒使用原屏保。
- 共用不可变同步日志，首轮合并先备份，未上传修改不被下载覆盖，删除不被旧设备自动复活。
- Windows 同步元数据与待上传队列落入 SQLite，凭据使用 Electron 系统安全存储加密，旧 JSON 保留。
- 服务端按账号串行提交，保留微秒游标、批量上限及字段白名单；解决冲突前检查版本，专注租约适配后台。
- 修复已处理提醒重现、清理系统通知后不排程、手机专注记录在 Windows 变成零时长等联调问题。
- 原生 APK 构建与 Android 15 模拟器启动／添加弹层／暂停专注／主题切换检查，不依赖 EAS 账号。
- 修复原素材 JPEG 内容误用 PNG 文件名导致 AAPT 编译失败；画面内容没有更改，增加格式回归检查。
- 提醒排程与处理使用同一操作队列，避免慢请求覆盖“我知道了”；旧提醒的连续点击不误处理下一周期，提前提醒处理后仍保留到点提醒。
- Windows 同一提醒的重复就绪回调不再重复聚焦／调整窗口，避免关闭已展开的稍后提醒选项。
- 安卓切换页面回到顶部，表单底部避让系统导航栏；安装测试严格定位真实输入框，不再误点文字标签或误发返回键。

## 本地已执行

- 根目录 `npm test`：127 项通过，包含真实 PostgreSQL WASM 执行 RPC／RLS 与实际 SQLite 持久化测试。
- 根目录 `npm run check` 通过。
- Android TypeScript 检查通过；26 项测试通过。
- 桌面源码和打包版实际窗口验收各 169 项通过：六主题、控件、Esc、主程序／小组件／全屏往返和常用窗口尺寸。
- Windows 打包版手动／登录启动检查通过；实际 Electron 运行时 SQLite 写入、重开及便携路径校验通过，全部使用隔离测试数据。
- Android 导出成功：820 个模块、Hermes 运行包、11 个原有图片资源。

## APK 实际安装验收

同一份 APK 在 Android 15 / API 35 模拟器上完成安装、离线新增任务、强制停止后任务保留、专注启动／暂停／重启恢复，以及六主题真实点击与截图检查。[通过的 Actions 运行](https://github.com/dokibeartwo/cat-dog-diary/actions/runs/35731025059)。验收未向应用注入任务、未伪造计时状态。

APK 源码提交：`d0d2a64d5a41503e47ee91ed22ded9853740d95b`；验收脚本后续修订没有重编译 APK。APK SHA-256：

```text
af144f9f6ea4052a8668cbfa8f39f8497aef90f96e3f772fb76c169ccd6d05f6
```

实际界面来自隔离模拟器，不含私人数据：

<img src="https://raw.githubusercontent.com/dokibeartwo/cat-dog-diary/main/docs/screenshots/android/today.png" width="250" alt="安卓今天页面" /> <img src="https://raw.githubusercontent.com/dokibeartwo/cat-dog-diary/main/docs/screenshots/android/focus.png" width="250" alt="安卓专注计时" /> <img src="https://raw.githubusercontent.com/dokibeartwo/cat-dog-diary/main/docs/screenshots/android/settings.png" width="250" alt="安卓主题与通知设置" />

模拟器通过不等于所有真机通过，也不等于真实 Supabase 已验证。

## 尚需配置与验收

1. 离线内测完成后，再提供 Supabase URL、publishable key，部署全部迁移及邮件验证码模板，实测邮件投递与两端同步。
2. 创建并保管 Android 长期签名。当前原生工作流产物仅为调试签名内测 APK。
3. 在 Android 12–15 及无 Google 服务设备验证通知、震动、精确闹钟撤销、省电、重启及时区变化。
4. 用备份数据验证 Windows 打包版与 APK 的离线冲突、回收恢复、换账号及删除。通过前不替换稳定版及快捷方式。
5. 安卓状态栏在浅色主题上偏浅；后续随真机反馈继续完善系统栏配色与不同屏幕适配。此版本不支持 32 位 ARM 设备，也没有 iOS 安装包。
