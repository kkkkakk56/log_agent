# 功能清单

这个文件是 `journal-agent` 的人类可读路线图。机器可读的任务源是 [`feature_list.json`](feature_list.json)。

JSON 里的字段名会继续保留英文，例如 `status`、`priority`、`verify_cmd`。这是为了让 Codex 和脚本稳定读取；字段里的说明、标题、验收标准和流程规则会尽量使用中文。

## 产品方向

`journal-agent` 不再只定位为日志 App。长期方向是一个本地优先的个人信息记录中枢，用多个彼此隔开的 Park 组织信息：日记区、知识库区、项目实验库、计划区等。

Park 是顶层区域概念。日记内容留在日记区，知识笔记进入知识库区，项目和实验进入项目实验库，计划类内容后续进入计划区。不同 Park 在导航、数据归属、搜索筛选和 Agent 读取来源上都应该能区分，不把所有东西混成一条日志流。

知识笔记的核心组织方式是“知识库 / 学习库”。例如用户先进入知识库 Park，创建一个“GitHub 学习库”，然后进入该知识库，在里面持续追加 GitHub 相关的知识记录；产品层面不设置固定条数上限，实际容量由设备存储和后续存储方案决定。

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
| `TASK-017` | `done` | 记录 Park 框架：把日记区、知识库区、项目实验库和计划区设计为彼此隔开的顶层区域 | `cd journal-agent && npm run build` |
| `TASK-018` | `done` | 知识库 Park 与知识笔记：用户可以进入独立知识库区域，创建学习库，并在每个知识库下持续追加知识记录 | `cd journal-agent && npm run build && npx cap sync ios` |
| `TASK-022` | `done` | 知识库界面简化重构：改为左上角图标呼出的仓库抽屉导航，以及笔记列表与详情布局 | `cd journal-agent && npm run build && npx cap sync ios` |
| `TASK-005` | `ready` | 草稿自动保存：未提交的日志内容在刷新、关闭或切后台后可以恢复 | `cd journal-agent && npm run build && npx cap sync ios` |
| `TASK-006` | `planned` | 本地数据导出：把日志导出为 JSON 和 Markdown，便于备份 | `cd journal-agent && npm run build` |
| `TASK-007` | `planned` | 心情与标签：日志支持 mood 和 tags，并在列表、搜索、日历中展示 | `cd journal-agent && npm run build && npx cap sync ios` |
| `TASK-008` | `planned` | 搜索体验优化：高亮关键词、清空查询、显示命中片段 | `cd journal-agent && npm run build` |
| `TASK-019` | `planned` | 项目实验库里的实验进度记录：按实验主题持续记录目标、过程、观察、结果和下一步 | `cd journal-agent && npm run build` |
| `TASK-020` | `done` | 做记 Park 项目记录：按项目聚合操作与复盘，并用颜色类型标记区分记录 | `cd journal-agent && npm run build && npx cap sync ios` |
| `TASK-025` | `planned` | 做记仓库目标卡片：为每个仓库新增目标卡片来存放目标清单，并在完成时提供可交互动效 | `cd journal-agent && npm run build && npx cap sync ios` |
| `TASK-026` | `planned` | 笔记与做记多分支层级：知识库和做记项目内部支持最多 4 层分支树，用于组织主题、章节、模块或阶段 | `cd journal-agent && npm run build && npx cap sync ios` |
| `TASK-027` | `done` | 系统提醒与句子级定时提醒：为某条记录或记录中的某句话设置系统定时提醒，点击后回到对应位置 | `cd journal-agent && npm run build && npx cap sync ios` |
| `TASK-028` | `done` | 日记未来日期编辑：心记可以指定记录归属日期，并在未来任意日期下新增或编辑日记 | `cd journal-agent && npm run build && npx cap sync ios` |
| `TASK-021` | `planned` | 多类型资料检索与 Agent 读取：让搜索和 Agent 能理解日志、知识库、实验、项目等不同记录来源 | `cd journal-agent && npm run build && npm run test:agent-api` |
| `TASK-023` | `planned` | 共同 Workspace 与权限控制：支持邀请他人加入共享 workspace，并只允许有权限的成员操作其中内容 | `cd journal-agent && npm run build` |
| `TASK-024` | `done` | Agent 三记写入工具：允许 Agent 在受限协议下新增或编辑心记、笔记和做记记录，但不提供删除能力 | `cd journal-agent && npm run build && npm run test:agent-api` |

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

### F017：Agent 多对话与存储

状态：`done`

让 Agent 支持新建多个独立对话，并把对话消息持久化保存到本地。

验收标准：

- Agent 浮窗有“新对话”入口。
- 新对话拥有独立消息记录，不混入上一段聊天。
- 对话数据包含 `id`、`title`、`createdAt`、`updatedAt` 和 `messages`。
- 关闭并重新打开 App 后，历史对话仍然存在。
- 用户可以在多个历史对话之间切换。
- 每次发送消息时仍然可以使用日志读取工具读取当前日志上下文。

验证结果：

- `npm run build` 通过。
- `npx cap sync ios` 通过。

实现记录：

- 已新增 `agentConversationStore`。
- 使用独立 localStorage key：`journal-agent.agent.conversations.v1`。
- 第一版标题由第一条用户消息自动生成。
- 后续可以再补删除、重命名、搜索对话。

### F018：Agent embedding RAG 日志检索

状态：`done`

为日志建立本地 embedding 索引，Agent 先检索 topK 片段，再基于少量证据回答问题。

验收标准：

- `.env` 支持 `embedding_model`，URL 和 key 复用 `api_url` / `api_key`。
- 每条日志会被切成 chunk 并生成 embedding。
- 本地索引保存 `entryId`、`title`、`createdAt`、`excerpt`、`contentHash`、`embeddingModel` 和 `embedding`。
- 日志内容或 `embedding_model` 变化时，会重新索引对应 chunk。
- 用户提问时先生成 query embedding，再用 cosine similarity 检索 topK 片段。
- Agent 请求只携带 `journal.search` 检索结果，不发送完整日志库。
- embedding 不可用时只使用少量关键词/最近片段兜底。
- 缺少证据时，Agent 必须说明当前日志里没有足够依据。

实现思路：

- 直接进入第三阶段 embedding RAG。
- 日志 chunk 会发送给 embedding 服务生成向量。
- 本地保存 embedding 索引，聊天时只发送 topK 命中片段给模型。
- 保留关键词兜底，以防 embedding 服务不可用。
- 参考 CC 类 agent prompt 的工具协议思想：说明可用工具、何时调用、必须基于工具结果回答、缺失证据不要编造。
- 不复制任何专有系统 prompt，只借鉴工具调用约束和证据优先的结构。

验证结果：

- `npm run build` 通过。
- `npm run test:agent-api` 通过，embedding 向量维度为 3072。
- `npx cap sync ios` 通过。

### F019：日志自定义标题

状态：`done`

移除写作提示卡片，在记录框上方增加可选标题输入行，用户可以自己拟标题。

验收标准：

- 时间线记录区不再展示写作提示卡片。
- 正文输入框上方有一行可选标题输入。
- 保存日志时优先使用用户输入的标题。
- 未输入标题时继续根据正文自动生成标题。
- 保存成功后标题和正文都会清空。

验证结果：

- `npm run build` 通过。
- `npx cap sync ios` 通过。

### F020：iOS 缓冲动效

状态：`done`

让主要点击动作、卡片、面板和消息拥有更像 Apple 系统的轻量缓冲与过渡反馈。

验收标准：

- 按钮点击时有按压缩放、透明度或阴影反馈。
- 日志卡片、日历日期、视图卡片进入时有轻微淡入上浮效果。
- 输入框聚焦时有平滑边框、阴影和位移动效。
- Agent 头像、对话面板和新消息出现时有轻量弹性反馈。
- 系统开启减少动态效果时，动画会自动降级。

验证结果：

- `npm run build` 通过。
- `npx cap sync ios` 通过。

### F021：记录 Park 框架

状态：`done`

把 App 从单一日志扩展为多个彼此隔开的顶层区域，例如日记区、知识库区、项目实验库和计划区。

验收标准：

- 主界面能表达 Park 概念，至少区分日记区和知识库区。
- 日记内容继续留在日记区，不混入知识库列表。
- 知识库区拥有独立入口，用于承载多个知识库和知识记录。
- 项目实验库和计划区可以先作为后续 Park 记录在路线图中，不必第一版全部实现。
- 不同 Park 在导航、数据归属、搜索筛选和 Agent 读取来源上都要能区分。
- 现有日志数据可以继续读取，不因新增 Park 丢失。

验证结果：

- `npm run build` 通过。
- `npx cap sync ios` 通过。

### F022：知识库 Park 与知识笔记

状态：`done`

用户可以进入独立知识库区域，按知识库或学习库分类管理知识。例如创建一个“GitHub 学习库”，然后进入该库，在里面持续追加 GitHub 相关的知识记录。

验收标准：

- 主界面或导航中有独立知识库 Park 入口，和日记区分开。
- 用户可以创建、重命名和删除知识库。
- 知识库包含名称、简介、标签、创建时间、更新时间和记录数量。
- 进入某个知识库后，可以新增、编辑、删除该库下的知识记录。
- 知识记录包含标题、正文、来源链接、标签和可选备注。
- 知识库下的记录数量不设置产品层面的固定上限，实际容量受设备存储限制。
- 知识库列表展示最近更新时间，方便继续学习。
- 日记区不会展示知识笔记，知识库区也不会展示普通日记。

验证结果：

- `npm run build` 通过。
- `npx cap sync ios` 通过。

### F026：知识库抽屉导航与简洁笔记流

状态：`done`

把知识库区收敛为更简洁的抽屉导航结构：左上角图标呼出仓库列表，主区展示笔记列表与详情，并提供新仓库和新笔记快捷入口。

验收标准：

- 知识库页面左上角有导航图标，点击后才展开仓库侧边抽屉。
- 仓库列表默认收起，不常驻占用主内容区。
- 抽屉底部有添加新仓库入口，点击后可填写仓库名称、简介、标签等基础信息。
- 当前知识库总览卡片被移除，页面左上角只保留一个标题。
- 点击某个仓库后，主内容区显示该仓库下的知识笔记列表。
- 点击某条笔记后，默认优先展示详情，并提供进入编辑状态的入口。
- 笔记列表旁有轻量浮动新增按钮，用于快速添加笔记。
- 整体页面保持简洁，减少多余装饰和层层卡片。

验证结果：

- `npm run build` 通过。
- `npx cap sync ios` 通过。

### F028：Agent 三记写入工具

状态：`done`

允许 Agent 在受限协议下帮你新增或编辑心记、知识笔记和做记记录，并在执行完成后回到对话里确认结果；整个工具层不提供删除能力。

验收标准：

- Agent 可以读取心记、知识库、知识笔记、做记项目和做记记录上下文。
- 当用户明确要求新增心记、笔记或做记时，Agent 可以发起 `journal.entry.create`、`knowledge.note.create` 或 `lab.record.create`。
- 当用户明确要求编辑心记、笔记或做记时，Agent 可以发起 `journal.entry.update`、`knowledge.note.update` 或 `lab.record.update`。
- 新增和编辑由客户端本地执行，再把 `tool_result` 回传给 Agent 生成确认回复。
- 工具层不暴露任何删除能力，也不允许 Agent 承诺已经删除三记内容。
- 成功写入后，对应 Park 可以刷新并看到最新内容。

验证结果：

- `npm run build` 通过。
- `npm run test:agent-api` 通过。
- `npx cap sync ios` 通过。

## 准备实现

### F005：草稿自动保存

状态：`ready`

当 App 关闭、刷新或进入后台时，保留尚未提交的日志草稿。

验收标准：

- 未提交的标题、正文或标签草稿可以在重启 App 后恢复。
- 成功保存日志后自动清空草稿。
- 用户可以手动清空草稿。
- 草稿存储与正式日志存储分离。

## 已计划

### F006：本地数据导出

状态：`done`

允许用户把日志导出为 JSON 和 Markdown，方便备份。

### F007：心情与标签

状态：`planned`

为日志增加轻量心情和标签元数据。

### F008：搜索体验优化

状态：`planned`

增加搜索命中高亮、清空按钮和结果摘要片段。

### F023：实验进度记录

状态：`planned`

在项目实验库 Park 下，按实验主题持续记录目标、过程、观察、结果和下一步，适合科研、学习实验、产品实验或个人测试。

验收标准：

- 用户可以创建一个实验记录集合。
- 实验集合包含目标、假设、材料或环境、步骤、观察、结果和下一步。
- 用户可以按时间追加实验进展。
- 实验状态支持计划中、进行中、已暂停、已完成。
- 列表展示最近一次进展和当前状态。

### F024：项目记录

状态：`done`

在做记 Park 下，按项目沉淀操作与复盘记录，适合长期项目、学习计划、开发任务或个人事务管理。

验收标准：

- 用户可以创建一个项目记录空间。
- 做记 Park 左上角有导航图标，点击后才展开项目侧边抽屉。
- 项目包含名称、简介、标签和更新时间。
- 项目下可以追加两类记录：操作与复盘。
- 新增或编辑记录时，用户可以明确选择操作或复盘。
- 列表和详情里会用绿色和红色的类型标记区分记录。
- 项目列表展示最近更新和记录数量。

### F029：做记仓库目标卡片与完成动效

状态：`planned`

为每个做记仓库新增目标卡片来集中管理目标清单，并在勾选完成时提供可交互的完成动效。

验收标准：

- 每个做记仓库都有独立的目标卡片，用于展示该仓库的目标清单。
- 用户可以新增、编辑、删除目标项，并看到当前完成进度。
- 目标项支持勾选完成和取消完成，完成状态有清晰的视觉区分。
- 勾选完成时有轻量、可交互的完成动效，增强反馈但不显得喧宾夺主。
- 系统开启减少动态效果时，完成动效会自动降级。
- 目标清单只归属当前仓库，不和其他做记仓库混淆。

### F030：笔记与做记多分支层级

状态：`planned`

在知识库和做记项目内部加入可管理的分支树，让内容不只停留在“库 / 项目 -> 记录”两层，而是可以按主题、章节、模块或阶段继续细分。产品层面最多支持 4 层，避免变成难维护的无限文件夹。

验收标准：

- 每个知识库可以创建分支和子分支，用于组织主题、章节或专题笔记。
- 每个做记项目可以创建分支和子分支，用于组织模块、阶段、任务组或复盘区域。
- 分支树产品上最多展示和创建 4 层；超过 4 层时需要阻止继续新增并给出清晰提示。
- 知识笔记和做记记录都可以选择归属分支；未选择时进入“未分组”。
- 每个库或项目保留“全部”和“未分组”入口，用户不必强制分类。
- 分支支持新增、重命名、移动、归档或删除前确认；删除分支时不能静默删除已有记录。
- 移动端使用折叠树或二级抽屉管理分支，避免常驻挤占主内容区。
- Agent 新增或编辑笔记、做记时可以读取分支上下文；目标分支不明确时先追问，不要猜。

### F031：系统提醒与句子级定时提醒

状态：`done`

与系统提醒能力挂钩，让用户可以对某条心记、知识笔记或做记记录设置定时提醒；更细时，可以选中记录里的某句话设置提醒，像微信定时提醒一样在指定时间收到系统通知。点击通知后回到 App，并打开对应记录、定位到目标句子。

验收标准：

- 用户可以为心记、知识笔记和做记记录设置一次性定时提醒。
- 用户可以选中记录中的某句话或一段文本，并基于该文本创建提醒。
- 提醒数据保存记录类型、记录 id、提醒时间、提醒标题、句子摘录和句子锚点。
- 到达提醒时间时，系统通知能展示记录标题和目标句子的简短摘录。
- 点击通知后，App 打开对应 Park、对应记录，并尽量滚动和高亮到目标句子。
- 如果原记录内容被编辑导致句子锚点失效，App 能退回到打开对应记录，并提示原句可能已变化。
- 用户可以查看、修改、取消已有提醒；取消提醒必须同步取消系统通知。
- 首次使用前请求系统通知权限；用户拒绝权限时提供清晰提示，不阻塞普通记录功能。

验证结果：

- `npm run build` 通过。
- `npx cap sync ios` 通过，并识别到 `@capacitor/local-notifications@8.0.2`。

### F032：日记未来日期编辑

状态：`done`

心记支持选择过去、今天或未来任意日期作为记录归属日期，并能在编辑时调整归属日期。这里会把“记录日期”和“真实创建 / 修改时间”拆开：时间线、日历和搜索按记录日期归档，创建时间只作为元信息保留。

第一版只作用于心记 Park，不改变笔记和做记的数据结构。

验收标准：

- 心记记录有独立的 `entryDate / 记录日期` 字段，和 `createdAt`、`updatedAt` 分开保存。
- 已有旧心记没有 `entryDate` 时，读取时自动用 `createdAt` 推导记录日期，不丢失历史记录。
- 用户新增心记时可以选择过去、今天或未来任意日期。
- 用户在日历里选中未来日期后，可以直接把新心记写到那一天。
- 用户编辑已有心记时可以修改归属日期；保存后该心记会移动到新的时间线分组和日历日期。
- 日历标记、选中日期列表、时间线分组和搜索结果都能展示正确的记录日期。
- 第一版仅作用于心记 Park，不改变笔记和做记的数据结构。

验证结果：

- `npm run build` 通过。
- `npx cap sync ios` 通过。

### F025：多类型资料检索与 Agent 读取

状态：`planned`

让搜索和 Agent 能理解日志、知识库、实验、项目等不同记录来源，并基于来源回答。

验收标准：

- 搜索结果展示记录类型和所属知识库、实验或项目。
- Agent 检索上下文时保留来源类型。
- RAG 索引支持不同 `record type` 的 chunk 元数据。
- Agent 回答时可以说明信息来自哪个知识库、实验或项目。
- 用户可以选择只检索某一类资料。

### F027：共同 Workspace 与权限控制

状态：`planned`

支持和他人共享一个 workspace，并通过成员权限控制谁可以查看、编辑、删除和管理其中内容。

验收标准：

- 用户可以创建一个可邀请他人的共同 workspace。
- `workspace` 至少支持 `owner`、`editor`、`viewer` 等角色区分。
- 只有有权限的成员才能查看、新增、编辑、删除或管理该 workspace 内的内容。
- 成员列表可以管理；移除成员或降权后，对应访问权限立即失效。
- 搜索、Agent 读取和内容操作都遵守 workspace 权限边界，不把无权内容暴露给其他人。

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

知识库抽屉导航、做记 Park 项目记录、Agent 代写三记、系统提醒和日记未来日期编辑都已经可用。下一步可以回到 `TASK-005 / F005：草稿自动保存`，或者继续补 `F023：实验进度记录`。

计划区仍然作为后续 Park 保留在路线图里。
