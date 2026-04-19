# 功能清单

这个文件是 `journal-agent` 的人类可读路线图。机器可读的任务源是 [`feature_list.json`](feature_list.json)。

JSON 里的字段名会继续保留英文，例如 `status`、`priority`、`verify_cmd`。这是为了让 Codex 和脚本稳定读取；字段里的说明、标题、验收标准和流程规则会尽量使用中文。

## 我们的协作方式

以后你可以直接用自然语言告诉我需求，不需要自己写完整任务卡。

我的默认流程是：

1. 先理解你的需求，并判断是否需要拆分。
2. 把需求整理为 `implementationQueue` 里的任务卡。
3. 同步更新这个 Markdown，让你能快速看懂计划。
4. 选择最高优先级的 `ready` 任务开始实现。
5. 运行任务里的 `verify_cmd` 和必要检查。
6. 验证通过后更新任务状态、记录结果并 commit。
7. 只有你明确同意，或 `autoPush=true` 时，才 push 到 GitHub。

如果需求会影响产品方向、数据结构、付费账号、证书、密钥或云服务，我会先停下来和你确认，不会悄悄做高风险决定。

## 迭代流程

每次 Codex 迭代优先读取 [`feature_list.json`](feature_list.json) 里的 `implementationQueue`，因为它更接近你之前给的 `CORE-11 / FEAT-01` 那种任务卡格式。

1. 选择状态为 `ready` 且依赖已完成的最高优先级任务。
2. 如果任务太大，先拆成更小的任务卡。
3. 实现该任务，并尽量保持改动聚焦。
4. 更新 `feature_list.json` 和 `feature_list.md`。
5. 运行该任务的 `verify_cmd`。
6. 需要时运行项目通用检查：

```bash
cd journal-agent
npm run build
npx cap sync ios
```

7. 如果 Xcode/iOS 环境可用，可额外运行原生构建检查：

```bash
cd journal-agent
xcodebuild -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination "platform=iOS Simulator,name=iPhone 16,OS=18.4" \
  -derivedDataPath build/DerivedData \
  CODE_SIGNING_ALLOWED=NO \
  build
```

8. 验证通过后创建聚焦提交，例如：

```bash
git add feature_list.json feature_list.md journal-agent/src
git commit -m "feat: add draft auto-save"
```

9. 只有准备同步到远端时才 push：

```bash
git push origin main
```

## 自动迭代规则

当你说 `继续下一个功能`、`开始自动迭代`、`按 feature_list 往下做` 这类话时，我可以进入连续迭代模式。

连续迭代时我会这样做：

1. 读取 `implementationQueue`。
2. 选择第一个可执行的 `ready` 任务。
3. 实现、验证、更新清单并 commit。
4. 如果你允许继续，就推进下一个任务。
5. 单次自动迭代最多处理 3 个任务，避免范围失控。

遇到这些情况我会停止并询问你：

- 验证失败，而且修复方式不明显。
- 下一个任务需要付费账号、证书、密钥、云服务或外部凭据。
- 任务涉及明显产品取舍。
- Git 里出现可能属于你的非相关改动。
- 下一步会改变已有数据格式，并存在迁移风险。

## 需求卡格式

你不需要手写任务卡，但如果你想贴结构化需求，可以用这个格式：

```json
{
  "id": "TASK-009",
  "category": "feature",
  "description": "搜索结果高亮：命中的关键词在列表中被明显标记",
  "status": "ready",
  "priority": 9,
  "dependsOn": ["F003"],
  "steps": [
    "在搜索框输入关键词",
    "验证标题和正文里的命中词被高亮",
    "验证清空搜索后高亮消失"
  ],
  "passes": false,
  "verify_cmd": "cd journal-agent && npm run build"
}
```

推荐字段说明：

| 字段 | 含义 |
|---|---|
| `id` | 稳定编号，例如 `TASK-005`、`CORE-11` 或 `FEAT-01` |
| `featureId` | 可选，用于关联产品功能，例如 `F005` |
| `category` | 类别，例如 `core`、`feature`、`workflow`、`test`、`docs`、`bugfix` |
| `description` | 一句话描述用户能感知到的结果 |
| `status` | 状态，例如 `ready`、`planned`、`blocked`、`deferred`、`done` |
| `priority` | 优先级数字，数字越小越先做 |
| `dependsOn` | 必须先完成的任务或功能 |
| `steps` | 具体行为、验收步骤或测试步骤 |
| `passes` | 只有验证通过后才标为 `true` |
| `verify_cmd` | 实现后要运行的主要验证命令 |

## 自动化策略

当前策略：

| 设置 | 当前值 |
|---|---|
| 自动 commit | 是，验证通过后可以自动提交 |
| 自动 push | 否，除非你明确批准或把 `autoPush` 改成 `true` |
| 必跑检查 | `npm run build`、`npx cap sync ios` |
| 可选原生检查 | `xcodebuild` 模拟器构建 |

安全提交规则：

- 不提交 `node_modules`、`dist`、Xcode `DerivedData` 或生成的模拟器构建产物。
- 不提交私钥、证书、配置描述文件、API Key 或 App Store Connect 凭据。
- 每个 commit 尽量只包含一个功能或一个维护任务。
- 功能状态变化时，同时更新 `feature_list.json` 和 `feature_list.md`。
- push 到 GitHub 前需要你明确同意，除非我们之后主动开启 `autoPush`。

## 当前任务队列

Codex 会优先读取这些任务卡：

| 任务 | 状态 | 描述 | 验证 |
|---|---|---|---|
| `TASK-013` | `ready` | Agent 多对话与存储：支持打开新对话，并把不同对话的消息记录持久化保存 | `cd journal-agent && npm run build && npx cap sync ios` |
| `TASK-005` | `ready` | 草稿自动保存：未提交的日志内容在刷新、关闭或切后台后可以恢复 | `cd journal-agent && npm run build && npx cap sync ios` |
| `TASK-014` | `planned` | Agent 检索式日志访问：使用 RAG / 搜索工具检索相关日志，而不是把所有日志一次性输入给模型 | `cd journal-agent && npm run build && npm run test:agent-api` |
| `TASK-006` | `planned` | 本地数据导出：把日志导出为 JSON 和 Markdown，便于备份 | `cd journal-agent && npm run build` |
| `TASK-007` | `planned` | 心情与标签：日志支持 mood 和 tags，并在列表、搜索、日历中展示 | `cd journal-agent && npm run build && npx cap sync ios` |
| `TASK-008` | `planned` | 搜索体验优化：高亮关键词、清空查询、显示命中片段 | `cd journal-agent && npm run build` |

## 状态说明

| 状态 | 含义 |
|---|---|
| `done` | 已完成并验证 |
| `ready` | 可以开始实现 |
| `planned` | 已计划，但不是当前要做的任务 |
| `blocked` | 被账号、依赖或产品决策阻塞 |
| `deferred` | 有意延后 |

## 已完成

### F001：免费 Apple Account 真机空壳

状态：`done`

使用 Xcode 和免费 Apple Account，把最小 Capacitor/Vue 空壳 App 跑到 iPhone 上。

验收标准：

- App 可以通过 Xcode Run 安装到真实 iPhone。
- App 打开后不是白屏。
- 空壳页面能展示 App 名称和基础版本信息。

### F002：本地日志增删改查

状态：`done`

支持创建、查看、编辑和软删除本地日志。

验收标准：

- 用户可以创建文本日志。
- 关闭并重新打开 App 后，日志仍然存在。
- 用户可以编辑已有日志。
- 用户可以在确认后删除日志。
- 时间线按日期分组展示日志。

### F003：搜索与日历查询

状态：`done`

增加关键词搜索和月历查询；有日志的日期会有明显标记。

验收标准：

- 用户可以在时间线、搜索、日历视图之间切换。
- 搜索可以匹配日志标题、正文和标签。
- 日历显示当前月份，并支持切换上个月和下个月。
- 有日志的日期会有视觉标记。
- 标记强度会根据当天日志数量变化。
- 选择某一天后，可以看到当天日志。

### F004：仓库整理与功能清单机制

状态：`done`

用机器可读 JSON 和人类可读 Markdown 管理功能，同时避免把生成文件提交到 Git。

验收标准：

- `feature_list.json` 存在，并包含按优先级排列的功能元数据。
- `feature_list.md` 存在，并解释迭代流程。
- 根目录 `.gitignore` 能阻止生成产物被提交。
- 已经被 Git 跟踪的 Xcode build 产物从索引中移除，但本地文件保留。

### F013：iOS 手记风格视觉重构

状态：`done`

把当前日志 App 重构为简洁、高级、接近 Apple Journal 气质的原生 iOS 风格。

验收标准：

- 整体字体使用 iOS 系统字体栈，优先呈现 San Francisco / 苹方观感。
- 页面使用大留白、轻背景、白色卡片、柔和阴影和分段控制器。
- 时间线、搜索、日历、编辑和删除能力保持可用。
- 不直接复制 Apple 专有素材或逐像素界面。
- iPhone 竖屏下布局稳定、按钮易点。

验证结果：

- `npm run build` 通过。
- `npx cap sync ios` 通过。

### F014：Agent 浮窗聊天入口

状态：`done`

在页面边缘放置小动漫头像，点击后打开与日志 Agent 对话的浮窗聊天界面。

验收标准：

- 存在占位 API URL、API Key 和 model 配置。
- 页面边缘显示小动漫头像入口。
- 点击头像后出现浮窗聊天界面。
- 用户可以输入消息并看到对话记录。
- 占位配置下返回本地模拟回复，不阻塞界面。
- 代码说明真实 API Key 后续应通过后端代理使用。

验证结果：

- `npm run build` 通过。
- `npx cap sync ios` 通过。

### F015：真实大模型 API 接入测试

状态：`done`

从本地 `.env` 读取真实 API 配置，让 Agent 浮窗可以直接调用大模型，并提供命令行连通性测试。

验收标准：

- `.env` 被 `.gitignore` 忽略，不会提交 API Key。
- Vite 可以读取根目录 `.env` 中的 `api_url`、`api_key`、`model`。
- Agent 客户端在配置完整时使用真实 API，缺失时回退占位模式。
- 提供 `npm run test:agent-api` 测试命令，测试时不打印密钥。
- 聊天浮窗能显示当前是占位模型还是真实 API。

验证结果：

- `npm run build` 通过。
- `npm run test:agent-api` 通过。
- `npx cap sync ios` 通过。

### F016：Agent 日志读取工具

状态：`done`

为 Agent 增加本地日志上下文工具，让它可以基于用户日志内容回答问题，而不是只看聊天消息。

验收标准：

- 存在独立的 journal context tool，用于生成日志上下文。
- 真实 API 请求会携带日志工具输出。
- 占位模式也复用同一份日志工具上下文。
- 工具输出限制数量和长度，避免一次发送过多内容。
- Agent 浮窗显示当前日志读取范围。
- 模型提示中明确禁止编造不存在的日志。

验证结果：

- `npm run build` 通过。
- `npm run test:agent-api` 通过，并确认模型可以读取模拟的日志工具上下文。
- `npx cap sync ios` 通过。

## 准备实现

### F017：Agent 多对话与存储

状态：`ready`

让 Agent 支持新建多个独立对话，并把对话消息持久化保存到本地。

验收标准：

- Agent 浮窗有“新对话”入口。
- 新对话拥有独立消息记录，不混入上一段聊天。
- 对话数据包含 `id`、`title`、`createdAt`、`updatedAt` 和 `messages`。
- 关闭并重新打开 App 后，历史对话仍然存在。
- 用户可以在多个历史对话之间切换。
- 每次发送消息时仍然可以使用日志读取工具读取当前日志上下文。

实现提示：

- 建议新增 `agentConversationStore`。
- 使用独立 localStorage key，例如 `journal-agent.agent.conversations.v1`。
- 第一版标题可以由第一条用户消息自动生成。
- 后续可以再补删除、重命名、搜索对话。

### F005：草稿自动保存

状态：`ready`

当 App 关闭、刷新或进入后台时，保留尚未提交的日志草稿。

验收标准：

- 未提交的标题、正文或标签草稿可以在重启 App 后恢复。
- 成功保存日志后自动清空草稿。
- 用户可以手动清空草稿。
- 草稿存储与正式日志存储分离。

## 已计划

### F018：Agent 检索式日志访问 / RAG

状态：`planned`

让 Agent 通过检索工具查找相关日志片段，而不是把全部日志或大量最近日志一次性输入给模型。

验收标准：

- 存在 `journal.search` 工具契约，支持 `query`、`limit`、`dateRange`、`tags`、`mood` 等输入。
- 检索结果包含 `entryId`、`title`、`createdAt`、`excerpt`、`score` 和 `matchReason`。
- Agent 默认只把 topK 命中片段发送给模型，不发送完整日志库。
- 第一版至少支持本地关键词检索，后续可升级 embedding / vector RAG。
- Agent prompt 明确要求先使用检索工具，再基于检索结果回答。
- 缺少证据时，Agent 必须说明当前日志里没有足够依据。
- 真实 API 模式下，UI 或说明中能表达只发送相关片段的隐私边界。

实现思路：

- F016 现在是“上下文注入”，F018 要升级成“检索式 RAG”。
- 先做本地关键词 / BM25-like 检索，不急着引入向量数据库。
- 后续如果日志量变大，再引入 embedding、向量索引和混合检索。
- 参考 CC 类 agent prompt 的工具协议思想：说明可用工具、何时调用、必须基于工具结果回答、缺失证据不要编造。
- 不复制任何专有系统 prompt，只借鉴工具调用约束和证据优先的结构。

### F006：本地数据导出

状态：`planned`

允许用户把日志导出为 JSON 和 Markdown，方便备份。

### F007：心情与标签

状态：`planned`

为日志增加轻量心情和标签元数据。

### F008：搜索体验优化

状态：`planned`

增加搜索命中高亮、清空按钮和结果摘要片段。

### F009：IndexedDB 存储适配器

状态：`planned`

从 `localStorage` 迁移到更适合大量日志的异步 IndexedDB 存储适配器。

### F010：iCloud 同步方案调研

状态：`planned`

在实现前研究并设计 CloudKit/iCloud 同步架构。

### F011：隐私锁

状态：`planned`

用 Face ID / 密码式本地认证保护 App 内容。

### F012：TestFlight 分发

状态：`planned`

从免费账号本地安装，升级到 TestFlight 内测分发。

## 下一步建议

实现 `TASK-013 / F017：Agent 多对话与存储`，然后运行对应验证命令并提交结果。
