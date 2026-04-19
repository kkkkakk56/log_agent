# 日记 Agent App：本地日志功能计划

## 阶段目标

下一阶段先做“本地日志功能”，不依赖云、不依赖 Apple Developer Program、不引入原生数据库插件。

第一版目标：

```text
打开 App -> 写一条日志 -> 保存到手机本地 -> 关闭再打开还在 -> 可以编辑/删除
```

这一步的重点是先让 App 从“空壳”变成真正可用的个人记录工具。电脑关机后，手机 App 仍然可以打开和记录；数据保存在手机 App 本地，不会自动同步到电脑或 iCloud。

## 成功标准

| 功能 | 标准 |
|---|---|
| 新建日志 | 可以输入正文并保存 |
| 日志列表 | 能看到所有已保存日志 |
| 编辑日志 | 点进日志后可以修改并保存 |
| 删除日志 | 可以删除不想保留的日志 |
| 本地持久化 | 关 App、关电脑、重启手机后日志仍然存在 |
| 无网络可用 | 断网也能写日志 |
| 手机体验 | iPhone 上输入、保存、编辑都顺畅 |

## 存储方案

第一版建议使用 `localStorage`，但不要在 Vue 组件里直接到处读写。应该封装一个独立的 `journalStore`。

这样做的好处：

- 不需要新增依赖。
- 不需要 Capacitor 原生插件。
- 不需要改 Xcode 权限配置。
- 最快验证日志产品体验。
- 后续可以把底层替换成 IndexedDB、SQLite 或 CloudKit，而不重写 UI。

方案对比：

| 方案 | 是否现在用 | 原因 |
|---|---|---|
| `localStorage` | 推荐第一版 | 无需依赖、无需原生配置、最快验证功能 |
| IndexedDB | 第二阶段考虑 | 更适合大量数据和附件，但实现复杂一点 |
| SQLite 插件 | 暂缓 | 会引入 Capacitor 插件和原生配置 |
| iCloud / CloudKit | 暂缓 | 通常需要 Apple Developer Program，适合后续同步 |

## 数据模型

从第一版开始就按“未来可同步”设计数据结构。

```ts
type JournalEntry = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  mood?: 'great' | 'calm' | 'tired' | 'low';
  tags: string[];
  syncStatus: 'local' | 'pending' | 'synced';
};
```

字段说明：

| 字段 | 说明 |
|---|---|
| `id` | 本地唯一 ID |
| `title` | 标题，第一版可以自动从正文第一行生成 |
| `content` | 日志正文 |
| `createdAt` | 创建时间，ISO 字符串 |
| `updatedAt` | 最后更新时间，ISO 字符串 |
| `deletedAt` | 软删除时间，后续同步时有用 |
| `mood` | 可选心情，第一版可以先不在 UI 暴露 |
| `tags` | 标签列表，第一版可以先为空 |
| `syncStatus` | 同步状态，未来接 iCloud 或后端时使用 |

`syncStatus`、`updatedAt`、`deletedAt` 这些字段现在看起来有点提前，但以后接 iCloud 很有用，可以避免大规模重构数据。

## UI 设计方向

设计关键词：

```text
温暖纸张 / 手机优先 / 快速记录 / 时间线 / 低压力
```

不要做后台管理风格，也不要一开始就做复杂编辑器。第一版要让用户打开 App 后马上能写。

### 主屏结构

```text
顶部：心记 / 今天日期 / 今日记录数
中间：快速记录卡片
下方：按日期分组的日志时间线
底部：新增按钮或固定输入入口
```

示意：

```text
心记
4月19日 周日

今天想记点什么？
[ 多行输入框              ]
[ 保存这一刻 ]

今天
09:42  跑通了手机真机 App，很开心...
08:10  想先做本地日志，不急着上云...

昨天
23:18  关于 iCloud 的想法...
```

### 视觉风格

| 设计点 | 方向 |
|---|---|
| 色彩 | 暖米色、深咖、柔和橙，不走默认蓝紫风 |
| 字体 | 保持 iOS 中文清晰，使用 `Avenir Next + PingFang SC` |
| 形态 | 圆角卡片、纸张质感、轻微阴影 |
| 信息密度 | 手机优先，一屏内先能快速写，不让用户找按钮 |
| 动效 | 保存后轻微反馈，卡片淡入，不做花哨动画 |

### 交互原则

- 新建时先只显示正文输入，不强迫填标题。
- 标题自动取正文第一行或前 18 个字。
- 空内容不保存。
- 保存后立即出现在列表顶部。
- 点击日志卡片进入编辑状态。
- 删除需要确认，避免误删。
- 每条卡片显示时间、摘要、字数或心情。
- 先保证输入顺畅，不要把第一版做成复杂富文本编辑器。

## 第一版功能清单

建议 MVP 包含：

1. 新建日志。
2. 自动保存到本地。
3. 日志列表按时间倒序显示。
4. 按“今天 / 昨天 / 日期”分组。
5. 点击日志进入编辑。
6. 修改后保存。
7. 删除日志。
8. 顶部显示今日日志数量。
9. 空状态提示“写下第一条”。
10. 重新打开 App 后数据仍在。

暂时不做：

| 暂缓功能 | 原因 |
|---|---|
| iCloud 同步 | 需要付费开发者账号和 CloudKit 配置 |
| 图片/语音 | 会涉及权限和附件存储 |
| 搜索 | 等日志数量多一点再做 |
| 标签系统 | 第一版先不增加输入负担 |
| 密码锁 / Face ID | 需要原生能力，后面再加 |
| AI agent | 先有数据，再做分析 |

## 推荐文件结构

当前项目还很轻量，第一版不需要 Vue Router，也不需要 Pinia。

建议新增：

| 文件 | 作用 |
|---|---|
| `src/types/journal.ts` | 定义日志数据类型 |
| `src/storage/journalStore.ts` | 封装本地读写、创建、更新、删除 |
| `src/utils/date.ts` | 日期格式化、按日期分组 |

改造：

| 文件 | 作用 |
|---|---|
| `src/App.vue` | 日志主界面和交互 |
| `src/style.css` | 移动端 UI 样式 |

暂时不新增：

- Vue Router
- Pinia
- SQLite 插件
- CloudKit 插件
- 原生权限配置

## 实现步骤

### Step 1：定义类型和存储层

新增 `src/types/journal.ts`：

- 定义 `JournalEntry`。
- 定义 `JournalMood`。
- 定义 `JournalSyncStatus`。

新增 `src/storage/journalStore.ts`：

- `getEntries()`
- `createEntry(content: string)`
- `updateEntry(id: string, content: string)`
- `deleteEntry(id: string)`
- `clearEntries()`，仅开发调试使用

要求：

- 所有数据读写都通过 `journalStore`。
- 本地存储 key 固定，例如 `journal-agent.entries.v1`。
- 读取失败时返回空数组，不让 App 崩溃。
- 写入前过滤掉已软删除的数据，或 UI 层默认不展示 `deletedAt` 不为空的数据。

### Step 2：实现主界面

改造 `src/App.vue`：

- 顶部显示 App 名称、日期、今日日志数量。
- 中间放快速输入框。
- 保存按钮在内容为空时禁用。
- 保存后清空输入框。
- 下方显示日志列表。
- 列表为空时显示空状态。

### Step 3：实现编辑和删除

在 `src/App.vue` 中增加：

- 当前编辑中的日志 ID。
- 编辑文本。
- 保存编辑。
- 取消编辑。
- 删除确认。

第一版可以使用 `window.confirm` 做删除确认，后续再换成自定义弹窗。

### Step 4：日期分组和格式化

新增 `src/utils/date.ts`：

- `formatTodayHeader(date: Date)`
- `formatEntryTime(iso: string)`
- `getDateGroupLabel(iso: string)`
- `groupEntriesByDate(entries: JournalEntry[])`

分组规则：

- 今天显示 `今天`
- 昨天显示 `昨天`
- 其他日期显示 `M月D日 周X`

### Step 5：验证

本地验证：

```bash
npm run build
```

iPhone 验证：

```bash
npx cap sync ios
```

然后在 Xcode 里重新 Run 到手机。

手机上验证：

1. 新建一条日志。
2. 关闭 App 再打开。
3. 确认日志还在。
4. 编辑日志。
5. 删除日志。
6. 断网后再写一条。
7. 重启手机后确认数据还在。

## 后续功能想法

等本地日志稳定后，可以逐步加：

| 功能 | 价值 |
|---|---|
| 草稿自动保存 | 写到一半退出也不丢 |
| 搜索 | 找历史记录 |
| 标签 | `#工作`、`#情绪`、`#灵感` |
| 心情选择 | 做情绪趋势 |
| 日历视图 | 看哪天写过 |
| Markdown 支持 | 更适合长文 |
| 导出 JSON / Markdown | 防止数据被锁在 App 里 |
| iCloud 同步 | 多设备同步 |
| Face ID 锁 | 日记隐私保护 |
| AI 总结 | 每日/每周自动回顾 |
| Agent 提问 | 根据历史日志追问、整理、提醒 |

## iCloud 预留思路

第一版先不接 iCloud，但从数据结构上预留同步能力。

未来可以做：

```text
Vue/Capacitor UI
        ↓
本地存储层 localStorage / IndexedDB / SQLite
        ↓
同步层 CloudKit
        ↓
用户自己的 iCloud
```

关键原则：

- 本地优先，没网也能写。
- 每条日志保留 `createdAt`、`updatedAt`、`deletedAt`。
- 删除使用软删除，方便多设备同步。
- 未来同步冲突时，以 `updatedAt` 或更精细的版本字段处理。
- iCloud 同步前再购买 Apple Developer Program。

## 当前建议

下一步直接实现 MVP：

```text
本地日志增删改查 + 手机持久化
```

实现后执行：

```bash
npm run build
npx cap sync ios
```

然后在 Xcode 里重新 Run 到手机，就可以开始真正写日志。
