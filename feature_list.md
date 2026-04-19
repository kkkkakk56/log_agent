# Feature Backlog

This file is the human-readable roadmap for `journal-agent`. The machine-readable source of truth is [`feature_list.json`](feature_list.json).

## Iteration Workflow

Use this loop for each Codex iteration. The preferred source is the `implementationQueue` array in [`feature_list.json`](feature_list.json), because it is closer to the CORE/FEAT style task cards you described.

1. Pick the highest-priority task with status `ready`.
2. Implement that feature end-to-end in a focused change.
3. Update `feature_list.json` and this file with status, notes, and verification.
4. Run required verification:

```bash
cd journal-agent
npm run build
npx cap sync ios
```

5. Optionally run native verification when Xcode/iOS support is available:

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

6. Commit with a focused message, for example:

```bash
git add feature_list.json feature_list.md journal-agent/src
git commit -m "feat: add draft auto-save"
```

7. Push only after verification passes and pushing is intended:

```bash
git push origin main
```

### Autonomous Iteration

Codex can work in this rhythm when you say something like `继续下一个功能`, `开始自动迭代`, or `按 feature_list 往下做`:

1. Read `implementationQueue`.
2. Pick the first `ready` task whose dependencies are complete.
3. Implement the task.
4. Run the task's `verify_cmd`.
5. If verification passes, mark `passes: true`, update the task/feature status, and commit.
6. Move to the next ready task only if you explicitly asked for autonomous iteration.

Stop conditions:

- Verification fails and the fix is not obvious.
- The next task requires paid accounts, certificates, secrets, or external credentials.
- The next task involves a product decision with real tradeoffs.
- Git contains unexpected unrelated changes that may be your work.

## Requirement Card Format

You can paste requirements in a compact format like this:

```json
{
  "id": "TASK-009",
  "category": "feature",
  "description": "搜索结果高亮：命中的关键词在列表中被明显标记",
  "steps": [
    "在搜索框输入关键词",
    "验证标题和正文里的命中词被高亮",
    "验证清空搜索后高亮消失"
  ],
  "passes": false,
  "verify_cmd": "cd journal-agent && npm run build"
}
```

For this project, the recommended fields are:

| Field | Meaning |
|---|---|
| `id` | Stable id, such as `TASK-005`, `CORE-11`, or `FEAT-01` |
| `featureId` | Optional link to a product feature like `F005` |
| `category` | `core`, `feature`, `workflow`, `test`, `docs`, or `bugfix` |
| `description` | One-sentence outcome |
| `status` | `ready`, `planned`, `blocked`, `deferred`, or `done` |
| `priority` | Lower number runs earlier |
| `dependsOn` | Task ids or feature ids that must be complete first |
| `steps` | Concrete behavior and acceptance checks |
| `passes` | `true` only after verification passes |
| `verify_cmd` | Primary command Codex should run after implementation |

## Automation Policy

Current policy:

| Setting | Value |
|---|---|
| Auto commit | Yes, after verification passes |
| Auto push | No, only when the user explicitly approves or `autoPush` is changed to `true` |
| Required checks | `npm run build`, `npx cap sync ios` |
| Optional native check | `xcodebuild` simulator build |

Safe-commit rules:

- Do not commit `node_modules`, `dist`, Xcode `DerivedData`, or generated simulator build outputs.
- Do not commit private keys, certificates, provisioning profiles, API keys, or App Store Connect secrets.
- Keep each commit focused on one feature or one maintenance task.
- Update both backlog files when a feature changes status.

## Implementation Queue

These are the current task cards Codex should read first:

| Task | Status | Description | Verify |
|---|---|---|---|
| `TASK-005` | `ready` | 草稿自动保存：未提交的日志内容在刷新、关闭或切后台后可以恢复 | `cd journal-agent && npm run build && npx cap sync ios` |
| `TASK-006` | `planned` | 本地数据导出：把日志导出为 JSON 和 Markdown，便于备份 | `cd journal-agent && npm run build` |
| `TASK-007` | `planned` | 心情与标签：日志支持 mood 和 tags，并在列表、搜索、日历中展示 | `cd journal-agent && npm run build && npx cap sync ios` |
| `TASK-008` | `planned` | 搜索体验优化：高亮关键词、清空查询、显示命中片段 | `cd journal-agent && npm run build` |

## Status Legend

| Status | Meaning |
|---|---|
| `done` | Implemented and verified |
| `ready` | Ready for the next implementation pass |
| `planned` | Desired, but not the next task |
| `blocked` | Waiting on account, dependency, or product decision |
| `deferred` | Intentionally postponed |

## Completed

### F001: Free Apple Account iPhone Shell

Status: `done`

Run a minimal Capacitor/Vue shell app on an iPhone using Xcode and a free Apple Account.

Acceptance:

- The app installs on a real iPhone through Xcode Run.
- The app opens without a white screen.
- The shell page displays the app name and version.

### F002: Local Journal CRUD

Status: `done`

Create, list, edit, and soft-delete journal entries stored locally.

Acceptance:

- Users can create a text journal entry.
- Entries persist after closing and reopening the app.
- Users can edit existing entries.
- Users can delete entries with confirmation.
- Entries are grouped by date in the timeline.

### F003: Search And Calendar Lookup

Status: `done`

Add keyword search and monthly calendar lookup with marked days that contain journal entries.

Acceptance:

- Users can switch between timeline, search, and calendar views.
- Search matches journal title, content, and tags.
- Calendar shows current month with previous and next month navigation.
- Days with entries are visually marked.
- Marker intensity changes based on entry count.
- Selecting a date displays entries from that day.

### F004: Repository Hygiene And Backlog System

Status: `done`

Track features in machine-readable JSON and human-readable Markdown, and keep generated files out of git.

Acceptance:

- `feature_list.json` exists and contains prioritized feature metadata.
- `feature_list.md` exists and explains the iteration workflow.
- Root `.gitignore` prevents generated build artifacts from being committed.
- Already tracked Xcode build artifacts are removed from the git index while preserved locally.

## Ready

### F005: Draft Auto-Save

Status: `ready`

Preserve unfinished draft text if the app is closed, refreshed, or backgrounded.

Acceptance:

- Unsubmitted draft text is restored after app restart.
- Saving a journal entry clears the draft.
- Users can manually clear the draft.
- Draft storage is separate from saved journal entries.

## Planned

### F006: Export Local Data

Status: `planned`

Allow users to export journal entries as JSON and Markdown for backup.

### F007: Mood And Tags

Status: `planned`

Add lightweight mood and tag metadata to entries.

### F008: Search Polish

Status: `planned`

Improve search with highlighted matches, a clear button, and result snippets.

### F009: IndexedDB Storage Adapter

Status: `planned`

Move from `localStorage` to an async storage adapter suited for larger journal history.

### F010: iCloud Sync Design Spike

Status: `planned`

Research and design CloudKit/iCloud sync architecture before implementation.

### F011: Privacy Lock

Status: `planned`

Protect the app with Face ID / passcode style local authentication.

### F012: TestFlight Distribution

Status: `planned`

Move from free-account local install to TestFlight distribution.

## Next Recommendation

Implement `TASK-005 / F005: Draft Auto-Save`, then run its verification command and commit the result.
