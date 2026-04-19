# 日记 Agent App：先用免费 Apple Account 跑通真机空壳

## 当前最重要目标

先不急着购买 Apple Developer Program。

第一阶段只做一件事：

**用免费 Apple Account + Xcode，把一个空壳 iOS App 直接跑到自己的 iPhone 上，并确认可以正常打开。**

这一步不需要 TestFlight，也不需要 App Store Connect。它的价值是先验证：

- 前端工程能构建成功
- Capacitor 能生成 iOS 工程
- Xcode 能完成签名
- iPhone 能安装并打开 App
- 空壳页面不会白屏

只有当这个本地真机闭环跑通后，再考虑是否购买 Apple Developer Program，用 TestFlight 做更正式的内测分发。

## 当前阶段成功标准

完成后应该满足：

| 检查项 | 标准 |
|---|---|
| App 工程 | 本地有一个最小 Capacitor + Vue iOS 工程 |
| 本地构建 | `npm run build` 成功 |
| iOS 同步 | `npx cap sync ios` 成功 |
| Xcode 签名 | 免费 Apple Account 可以完成自动签名 |
| 真机运行 | iPhone 通过 Xcode Run 安装并打开 App |
| 启动体验 | 打开后显示空壳页面，不白屏、不闪退 |

空壳页面只需要显示：

```text
心记
Local iPhone Shell
Version 0.1.0
```

## 重要判断

现在不买会员的原因：

- 我们还没有验证工程能不能在真机上正常跑起来。
- 免费 Apple Account 已经足够做“自己手机上的本地开发测试”。
- Apple Developer Program 主要用于 TestFlight、App Store Connect 上传、正式分发和更多系统能力。
- 如果现在直接买会员，仍然可能先卡在工程构建、Xcode 签名、Capacitor 同步或白屏问题上。

免费 Apple Account 的限制：

- 不能上传到 App Store Connect。
- 不能使用 TestFlight 分发。
- 不适合作为长期安装方式。
- 安装到手机上的 App 可能需要定期重新用 Xcode 跑一次。
- 可用的系统能力比付费开发者账号少。

所以当前策略是：

```text
先免费真机跑通 -> 再决定是否买会员 -> 再上 TestFlight
```

## 推荐执行顺序

### 0. 准备账号和工具

| 项目 | 要求 | 备注 |
|---|---|---|
| Apple Account | 必须 | 免费账号即可，先不买 Developer Program |
| Mac | 必须 | Xcode 只能在 macOS 上使用 |
| Xcode | 必须 | 从 App Store 安装 |
| Node.js | 必须 | 建议使用 LTS 版本 |
| iPhone | 必须 | 用来验证真机运行 |
| 数据线或无线调试 | 必须 | 第一次建议用数据线，变量最少 |

当前阶段不需要：

- Apple Developer Program 付费会员
- App Store Connect App 记录
- TestFlight App
- GitHub Actions
- App Store 上架资料

### 1. 创建最小 Web App

如果还没有前端工程，先创建一个最小 Vue/Vite 项目：

```bash
npm create vite@latest journal-agent -- --template vue-ts
cd journal-agent
npm install
npm run build
```

第一版页面不要做复杂 UI。只保留一个可识别的空壳页面，方便确认安装的确实是我们自己的 App。

建议页面内容：

```text
心记
Local iPhone Shell
Version 0.1.0
```

### 2. 加入 Capacitor

在项目根目录执行：

```bash
npm install @capacitor/core @capacitor/cli
npx cap init
npm install @capacitor/ios
npx cap add ios
```

`capacitor.config.ts` 建议先保持最小配置：

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.yourname.journalagent',
  appName: '心记',
  webDir: 'dist',
};

export default config;
```

注意：

- `appId` 仍然建议使用反域名格式，后面如果买会员和上 TestFlight，可以继续沿用。
- 第一阶段不要配置 SQLite、相册、麦克风、定位、后台模式。
- 第一阶段不要改复杂的 `Info.plist` 权限声明。
- 第一阶段不要引入额外 Capacitor 插件，先减少变量。

### 3. 构建并同步到 iOS

每次改 Web 代码后执行：

```bash
npm run build
npx cap sync ios
```

然后打开 Xcode：

```bash
npx cap open ios
```

### 4. 在 Xcode 登录免费 Apple Account

打开 Xcode：

```text
Xcode -> Settings -> Accounts
```

添加你的 Apple Account。

如果还没有付费会员，Xcode 里通常会显示为 Personal Team。当前阶段选择这个 Personal Team 即可。

### 5. Xcode 签名配置

在 Xcode 中打开：

```text
App -> TARGETS -> App -> Signing & Capabilities
```

配置：

| 配置项 | 建议 |
|---|---|
| Automatically manage signing | 勾选 |
| Team | 选择你的 Personal Team |
| Bundle Identifier | 与 `capacitor.config.ts` 的 `appId` 一致 |
| Signing Certificate | 让 Xcode 自动管理 |
| Provisioning Profile | 让 Xcode 自动管理 |

然后到：

```text
App -> TARGETS -> App -> General
```

配置：

| 配置项 | 第一版建议 |
|---|---|
| Display Name | 心记 |
| Version | 0.1.0 |
| Build | 1 |
| Deployment Target | 先使用项目默认值，除非 Xcode 或 Capacitor 明确要求调整 |

如果 Xcode 提示 Bundle Identifier 已被占用，可以把 `appId` 改得更唯一，例如：

```text
com.yourname.journalagent.local
```

修改后重新执行：

```bash
npx cap sync ios
```

### 6. 连接 iPhone 并运行

用数据线连接 iPhone，首次连接时按提示信任电脑。

在 Xcode 顶部设备选择器中选择你的 iPhone，然后点击 Run。

这一步的目标是排除：

- Apple Account 登录问题
- Personal Team 签名问题
- Bundle ID 冲突问题
- Provisioning Profile 问题
- iPhone 信任电脑问题
- App 启动白屏问题
- Capacitor Web 产物未同步问题

如果 iPhone 上出现“未受信任的开发者”之类提示，按手机系统提示到设置里信任对应开发者账号后再打开。

### 7. 修改页面并再次运行

真机能打开后，做一个小验证：

1. 修改空壳页面文案，例如把 `Version 0.1.0` 改成 `Version 0.1.1`。
2. 执行 `npm run build`。
3. 执行 `npx cap sync ios`。
4. 回到 Xcode 再点 Run。
5. 确认 iPhone 上显示新文案。

这个验证能确认后续开发循环是通的：

```text
改 Web 代码 -> build -> sync ios -> Xcode Run -> iPhone 看到变化
```

## 当前阶段不要做的事

这些先不要做，等免费真机空壳跑通后再决定下一步：

| 暂缓事项 | 原因 |
|---|---|
| 购买 Apple Developer Program | 先验证免费账号真机运行是否可行 |
| TestFlight | 需要付费会员和 App Store Connect，当前不是最短路径 |
| App Store Connect App 记录 | 本地真机运行不需要 |
| Xcode Archive 上传 | 当前只需要 Run 到自己的 iPhone |
| SQLite | 会引入插件、原生配置和数据迁移变量 |
| 相册、相机、麦克风、定位权限 | 会引入 `Info.plist`、隐私文案和权限弹窗变量 |
| Background Modes | 第一版空壳不需要后台能力 |
| Keychain Sharing | 第一版空壳不需要 |
| GitHub Actions | CI 证书配置比本地 Xcode 更复杂，不适合第一步 |
| 外部测试 | 现在还没有进入 TestFlight 阶段 |
| App Store 正式上架资料 | 当前目标不是上架 |

## 推荐里程碑

### Milestone 0：免费账号真机空壳闭环

目标：不买会员，用 Xcode 把空壳 App 跑到自己的 iPhone 上。

交付物：

- 最小 Vue/Capacitor 工程
- iOS 原生工程
- Xcode Personal Team 自动签名配置
- iPhone 可打开的本地安装 App

验收：

- iPhone 上能安装
- App 能打开
- 页面能显示空壳文案
- 修改文案后能重新 Run 并看到变化

### Milestone 1：决定是否进入 TestFlight

触发条件：

- 免费真机空壳已经跑通
- 你希望不用每次插线和 Xcode Run
- 你希望通过 TestFlight 安装到自己的手机
- 你希望之后邀请朋友、家人或测试用户体验

这时再购买 Apple Developer Program。

进入 TestFlight 后要做：

- 创建 App Store Connect App 记录
- 使用付费 Team 签名
- Xcode Archive
- Upload 到 App Store Connect
- 配置 TestFlight Internal Testing
- iPhone 通过 TestFlight 安装

### Milestone 2：最小日记功能

目标：开始做真正的日记 App，但仍然保持简单。

建议功能：

- 新建一条文字日记
- 本地保存
- 日记列表
- 日记详情

这时再选择存储方案。可以先用浏览器本地存储验证交互，再决定是否接 SQLite。

### Milestone 3：本地持久化和数据结构

目标：把数据可靠存在 App 沙盒内。

可能内容：

- SQLite 或其他本地数据库
- 数据表结构
- 数据迁移策略
- 导出和备份策略

### Milestone 4：多媒体和权限

目标：加入更像日记产品的能力。

可能内容：

- 相册选图
- 拍照
- 语音日记
- 地理位置
- 权限引导页
- `Info.plist` 权限声明

### Milestone 5：自动化构建和 TestFlight 迭代

目标：减少每次手动上传的成本。

可能内容：

- 命令行 Archive
- ExportOptions.plist
- App Store Connect API Key
- GitHub Actions macOS Runner
- 自动递增 Build Number
- 自动上传 TestFlight

## 免费真机运行检查清单

| 检查项 | 状态 |
|---|---|
| Xcode 已安装 | ☐ |
| Xcode 已登录 Apple Account | ☐ |
| iPhone 已连接并信任电脑 | ☐ |
| `npm install` 成功 | ☐ |
| `npm run build` 成功 | ☐ |
| `npx cap add ios` 成功 | ☐ |
| `npx cap sync ios` 成功 | ☐ |
| Xcode 已选择 Personal Team | ☐ |
| Bundle ID 没有冲突 | ☐ |
| Xcode Run 成功 | ☐ |
| iPhone 能打开 App | ☐ |
| 页面不白屏 | ☐ |
| 修改文案后能重新看到变化 | ☐ |

## 之后进入 TestFlight 前检查清单

| 检查项 | 状态 |
|---|---|
| 已购买 Apple Developer Program | ☐ |
| Xcode 已切换到付费 Team | ☐ |
| Bundle ID 与付费 Team 绑定成功 | ☐ |
| App Store Connect App 记录已创建 | ☐ |
| `npm run build` 成功 | ☐ |
| `npx cap sync ios` 已执行 | ☐ |
| Version 正确 | ☐ |
| Build Number 比上一次更大 | ☐ |
| Archive 成功 | ☐ |
| Upload 成功 | ☐ |
| App Store Connect build 处理完成 | ☐ |
| TestFlight 手机安装成功 | ☐ |

## 决策记录

当前决策：

- 第一优先级是免费账号真机空壳跑通，不是 TestFlight。
- 现在先不购买 Apple Developer Program。
- 第一版不创建 App Store Connect App 记录。
- 第一版不做 Archive 上传。
- 第一版只用 Xcode Run 到自己的 iPhone。
- 第一版不申请任何隐私权限。
- 第一版不接 SQLite。

这样做的好处是成本最低、问题边界最清楚。如果失败，基本只需要排查本地工程、Capacitor 同步、Xcode 签名、设备连接和启动白屏，而不是同时排查 App Store Connect、TestFlight、证书上传和会员配置。
