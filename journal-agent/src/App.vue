<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import type { CalendarDay } from './utils/date';
import type { JournalEntry } from './types/journal';
import type { KnowledgeBase, KnowledgeNote } from './types/knowledge';
import type { LabProject, LabRecord, LabRecordType } from './types/lab';
import type { RecordReminder, ReminderTargetType } from './types/reminder';
import {
  createAgentMessage,
  getAgentModeLabel,
  getAgentModelLabel,
  isAgentUsingPlaceholder,
  sendAgentMessage,
  type SendAgentMessageResult,
  type AgentChatMessage,
} from './services/agentClient';
import { getJournalRagIndexStatus } from './services/journalRagSearch';
import { buildRecordAgentContextTool } from './services/recordAgentTool';
import {
  appendAgentConversationMessage,
  createAgentConversation,
  getActiveAgentConversationId,
  getAgentConversations,
  setActiveAgentConversationId,
  type AgentConversation,
} from './storage/agentConversationStore';
import {
  cancelReminder,
  cancelRemindersForTarget,
  createReminder,
  getActiveReminders,
  getReminderById,
  updateReminder,
} from './storage/reminderStore';
import {
  createEntry,
  deleteEntry,
  getEntries,
  updateEntry,
} from './storage/journalStore';
import {
  createKnowledgeBase,
  createKnowledgeNote,
  deleteKnowledgeBase,
  deleteKnowledgeNote,
  getKnowledgeBases,
  getKnowledgeNotes,
  updateKnowledgeBase,
  updateKnowledgeNote,
} from './storage/knowledgeStore';
import {
  createLabProject,
  createLabRecord,
  deleteLabProject,
  deleteLabRecord,
  getLabProjects,
  getLabRecords,
  updateLabProject,
  updateLabRecord,
} from './storage/labStore';
import {
  cancelReminderNotification,
  listenForReminderNotificationActions,
  scheduleReminderNotification,
} from './services/reminderNotifications';
import {
  WEEKDAY_LABELS,
  addMonths,
  buildCalendarDays,
  formatDateLabel,
  formatEntryTime,
  formatMonthTitle,
  formatTodayHeader,
  getDateGroupLabel,
  getLocalDateKey,
  groupEntriesByDate,
  startOfMonth,
} from './utils/date';

type ActivePark = 'journal' | 'knowledge' | 'lab' | 'plan';
type ActiveView = 'timeline' | 'search' | 'calendar';
type KnowledgeInspectorMode =
  | 'base'
  | 'base-edit'
  | 'note-view'
  | 'note-edit'
  | 'note-create';
type LabInspectorMode =
  | 'project'
  | 'project-edit'
  | 'record-view'
  | 'record-edit'
  | 'record-create';

interface ParkSummary {
  id: ActivePark;
  label: string;
  title: string;
  description: string;
  metricValue: string;
  metricLabel: string;
}

interface ReminderTargetDraft {
  type: ReminderTargetType;
  id: string;
  parentId: string | null;
  title: string;
  content: string;
}

const LAB_RECORD_TYPE_META: Record<LabRecordType, { label: string }> = {
  operation: { label: '操作' },
  review: { label: '复盘' },
};

const labRecordTypeOptions: Array<{
  value: LabRecordType;
  label: string;
  hint: string;
}> = [
  {
    value: 'operation',
    label: '操作',
    hint: '适合记录动作、步骤、推进和处理结果',
  },
  {
    value: 'review',
    label: '复盘',
    hint: '适合记录判断、反思、结论和下一步',
  },
];

function createAgentWelcomeMessage(): AgentChatMessage {
  return createAgentMessage(
    'assistant',
    isAgentUsingPlaceholder()
      ? '你好，我是心记 Agent。现在我还在使用占位模型，但已经可以先陪你整理想法、生成日志提示。'
      : '你好，我是心记 Agent。已经检测到本地 .env API 配置，可以尝试调用真实模型。',
  );
}

const initialAgentConversations = getAgentConversations();

if (initialAgentConversations.length === 0) {
  createAgentConversation([createAgentWelcomeMessage()]);
}

const entries = ref<JournalEntry[]>(getEntries());
const knowledgeBases = ref<KnowledgeBase[]>(getKnowledgeBases());
const knowledgeNotes = ref<KnowledgeNote[]>(getKnowledgeNotes());
const labProjects = ref<LabProject[]>(getLabProjects());
const labRecords = ref<LabRecord[]>(getLabRecords());
const reminders = ref<RecordReminder[]>(getActiveReminders());
const activePark = ref<ActivePark>('journal');
const activeView = ref<ActiveView>('timeline');
const draftTitle = ref('');
const draftContent = ref('');
const draftEntryDate = ref(getLocalDateKey(new Date()));
const editingId = ref<string | null>(null);
const editingContent = ref('');
const editingEntryDate = ref('');
const activeKnowledgeBaseId = ref<string | null>(knowledgeBases.value[0]?.id ?? null);
const knowledgeDrawerOpen = ref(knowledgeBases.value.length === 0);
const knowledgeBaseComposerOpen = ref(knowledgeBases.value.length === 0);
const newKnowledgeBaseName = ref('');
const newKnowledgeBaseDescription = ref('');
const newKnowledgeBaseTags = ref('');
const editingKnowledgeBaseName = ref(knowledgeBases.value[0]?.name ?? '');
const editingKnowledgeBaseDescription = ref(knowledgeBases.value[0]?.description ?? '');
const editingKnowledgeBaseTags = ref(knowledgeBases.value[0]?.tags.join('，') ?? '');
const selectedKnowledgeNoteId = ref<string | null>(null);
const knowledgeInspectorMode = ref<KnowledgeInspectorMode>('base');
const newKnowledgeNoteTitle = ref('');
const newKnowledgeNoteContent = ref('');
const newKnowledgeNoteSourceUrl = ref('');
const newKnowledgeNoteTags = ref('');
const editingKnowledgeNoteId = ref<string | null>(null);
const editingKnowledgeNoteTitle = ref('');
const editingKnowledgeNoteContent = ref('');
const editingKnowledgeNoteSourceUrl = ref('');
const editingKnowledgeNoteTags = ref('');
const activeLabProjectId = ref<string | null>(labProjects.value[0]?.id ?? null);
const labDrawerOpen = ref(labProjects.value.length === 0);
const labProjectComposerOpen = ref(labProjects.value.length === 0);
const newLabProjectName = ref('');
const newLabProjectDescription = ref('');
const newLabProjectTags = ref('');
const editingLabProjectName = ref(labProjects.value[0]?.name ?? '');
const editingLabProjectDescription = ref(labProjects.value[0]?.description ?? '');
const editingLabProjectTags = ref(labProjects.value[0]?.tags.join('，') ?? '');
const selectedLabRecordId = ref<string | null>(null);
const labInspectorMode = ref<LabInspectorMode>('project');
const newLabRecordTitle = ref('');
const newLabRecordContent = ref('');
const newLabRecordType = ref<LabRecordType>('operation');
const newLabRecordTags = ref('');
const editingLabRecordId = ref<string | null>(null);
const editingLabRecordTitle = ref('');
const editingLabRecordContent = ref('');
const editingLabRecordType = ref<LabRecordType>('operation');
const editingLabRecordTags = ref('');
const searchQuery = ref('');
const calendarMonth = ref(startOfMonth(new Date()));
const selectedDateKey = ref(getLocalDateKey(new Date()));
const agentPanelOpen = ref(false);
const agentInput = ref('');
const agentIsThinking = ref(false);
const ragIndexVersion = ref(0);
const agentConversations = ref<AgentConversation[]>(getAgentConversations());
const activeAgentConversationId = ref<string | null>(
  getActiveAgentConversationId(agentConversations.value),
);
const reminderComposerOpen = ref(false);
const reminderEditingId = ref<string | null>(null);
const reminderTarget = ref<ReminderTargetDraft | null>(null);
const reminderScheduledAt = ref('');
const reminderTitle = ref('');
const reminderQuote = ref('');
const reminderError = ref('');
const reminderStatusMessage = ref('');
const reminderIsSaving = ref(false);
const highlightedReminderTarget = ref<{
  targetType: ReminderTargetType;
  targetId: string;
  quote: string;
} | null>(null);

const groupedEntries = computed(() => groupEntriesByDate(entries.value));

const entryCountByDate = computed(() => {
  const counts = new Map<string, number>();

  for (const entry of entries.value) {
    const key = getJournalEntryDateKey(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
});

const todayCount = computed(() => {
  const today = getLocalDateKey(new Date());

  return entryCountByDate.value.get(today) ?? 0;
});

const activeKnowledgeBase = computed(
  () =>
    knowledgeBases.value.find((base) => base.id === activeKnowledgeBaseId.value) ??
    null,
);

const activeKnowledgeNotes = computed(() => {
  const baseId = activeKnowledgeBase.value?.id;

  if (!baseId) {
    return [];
  }

  return knowledgeNotes.value.filter((note) => note.baseId === baseId);
});

const selectedKnowledgeNote = computed(
  () =>
    activeKnowledgeNotes.value.find(
      (note) => note.id === selectedKnowledgeNoteId.value,
    ) ?? null,
);
const activeLabProject = computed(
  () =>
    labProjects.value.find((project) => project.id === activeLabProjectId.value) ??
    null,
);

const activeLabRecords = computed(() => {
  const projectId = activeLabProject.value?.id;

  if (!projectId) {
    return [];
  }

  return labRecords.value.filter((record) => record.projectId === projectId);
});

const selectedLabRecord = computed(
  () =>
    activeLabRecords.value.find((record) => record.id === selectedLabRecordId.value) ??
    null,
);

const canCreateKnowledgeBase = computed(
  () => newKnowledgeBaseName.value.trim().length > 0,
);
const canSaveKnowledgeBase = computed(
  () =>
    Boolean(activeKnowledgeBase.value) &&
    editingKnowledgeBaseName.value.trim().length > 0,
);
const canCreateKnowledgeNote = computed(
  () =>
    Boolean(activeKnowledgeBase.value) &&
    newKnowledgeNoteContent.value.trim().length > 0,
);
const canSaveKnowledgeNote = computed(
  () =>
    Boolean(editingKnowledgeNoteId.value) &&
    editingKnowledgeNoteContent.value.trim().length > 0,
);
const canCreateLabProject = computed(() => newLabProjectName.value.trim().length > 0);
const canSaveLabProject = computed(
  () => Boolean(activeLabProject.value) && editingLabProjectName.value.trim().length > 0,
);
const canCreateLabRecord = computed(
  () => Boolean(activeLabProject.value) && newLabRecordContent.value.trim().length > 0,
);
const canSaveLabRecord = computed(
  () => Boolean(editingLabRecordId.value) && editingLabRecordContent.value.trim().length > 0,
);

const parkSummaries = computed<ParkSummary[]>(() => [
  {
    id: 'journal',
    label: '心记',
    title: '心记',
    description: formatTodayHeader(),
    metricValue: String(todayCount.value),
    metricLabel: '今日',
  },
  {
    id: 'knowledge',
    label: '笔记',
    title: '笔记',
    description: '学习库和知识记录会放在这里，不混入日记时间线。',
    metricValue: String(knowledgeBases.value.length),
    metricLabel: '知识库',
  },
  {
    id: 'lab',
    label: '做记',
    title: '做记',
    description: '项目操作和阶段复盘会按项目沉淀在这里。',
    metricValue: String(labProjects.value.length),
    metricLabel: '项目',
  },
]);

const activeParkSummary = computed(
  () =>
    parkSummaries.value.find((park) => park.id === activePark.value) ??
    parkSummaries.value[0],
);

const draftCharacterCount = computed(() => draftContent.value.trim().length);
const canSaveDraft = computed(
  () => draftCharacterCount.value > 0 && isJournalDateKey(draftEntryDate.value),
);
const draftDateLabel = computed(() => formatJournalDateKeyLabel(draftEntryDate.value));
const draftDateTone = computed(() => {
  if (!isJournalDateKey(draftEntryDate.value)) {
    return '请选择有效的记录日期。';
  }

  if (isFutureDateKey(draftEntryDate.value)) {
    return '这会作为未来日期记录，归档到对应那一天。';
  }

  if (draftEntryDate.value === getLocalDateKey(new Date())) {
    return '默认记录到今天。';
  }

  return '这会作为补记，归档到选择的日期。';
});
const agentModeLabel = computed(() => getAgentModeLabel());
const agentModelLabel = computed(() => getAgentModelLabel());
const activeAgentConversation = computed(() =>
  agentConversations.value.find(
    (conversation) => conversation.id === activeAgentConversationId.value,
  ) ??
  agentConversations.value[0] ??
  null,
);
const agentMessages = computed(() => activeAgentConversation.value?.messages ?? []);
const activeAgentConversationTitle = computed(
  () => activeAgentConversation.value?.title ?? '新对话',
);
const agentJournalContext = computed(() => {
  ragIndexVersion.value;

  return getJournalRagIndexStatus(entries.value);
});
const agentRecordContext = computed(() => {
  return buildRecordAgentContextTool(
    entries.value,
    knowledgeBases.value,
    knowledgeNotes.value,
    labProjects.value,
    labRecords.value,
    {
      activeJournalEntryId: editingId.value,
      activeKnowledgeBaseId: activeKnowledgeBase.value?.id ?? null,
      selectedKnowledgeNoteId: selectedKnowledgeNote.value?.id ?? null,
      activeLabProjectId: activeLabProject.value?.id ?? null,
      selectedLabRecordId: selectedLabRecord.value?.id ?? null,
    },
  );
});
const canSendAgentMessage = computed(
  () => agentInput.value.trim().length > 0 && !agentIsThinking.value,
);
const activeReminders = computed(() =>
  reminders.value.filter(
    (reminder) =>
      reminder.canceledAt === null &&
      new Date(reminder.scheduledAt).getTime() > Date.now(),
  ),
);
const visibleReminders = computed(() => activeReminders.value.slice(0, 4));
const reminderMinDateTime = computed(() =>
  toDateTimeLocalInputValue(new Date(Date.now() + 60_000)),
);
const canSaveReminder = computed(() => {
  const scheduledAt = new Date(reminderScheduledAt.value);

  return (
    Boolean(reminderTarget.value) &&
    !reminderIsSaving.value &&
    reminderTitle.value.trim().length > 0 &&
    !Number.isNaN(scheduledAt.getTime()) &&
    scheduledAt.getTime() > Date.now()
  );
});

const normalizedSearchQuery = computed(() => searchQuery.value.trim().toLocaleLowerCase());

const searchResults = computed(() => {
  const query = normalizedSearchQuery.value;

  if (!query) {
    return [];
  }

  return entries.value.filter((entry) => {
    const searchableText = [entry.title, entry.content, ...entry.tags]
      .join(' ')
      .toLocaleLowerCase();

    return searchableText.includes(query);
  });
});

const calendarDays = computed(() => buildCalendarDays(calendarMonth.value));
const currentMonthTitle = computed(() => formatMonthTitle(calendarMonth.value));

const selectedDateEntries = computed(() =>
  entries.value.filter((entry) => getJournalEntryDateKey(entry) === selectedDateKey.value),
);

const selectedDateLabel = computed(() => {
  return formatJournalDateKeyLabel(selectedDateKey.value);
});

function refreshEntries() {
  entries.value = getEntries();
}

function refreshReminders() {
  reminders.value = getActiveReminders();
}

function toDateTimeLocalInputValue(date: Date): string {
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  const localDate = new Date(date.getTime() - timezoneOffset);

  return localDate.toISOString().slice(0, 16);
}

function isJournalDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(
    new Date(`${value}T00:00:00`).getTime(),
  );
}

function getJournalEntryDateKey(entry: JournalEntry): string {
  return entry.entryDate || getLocalDateKey(entry.createdAt);
}

function formatJournalDateKeyLabel(dateKey: string): string {
  if (!isJournalDateKey(dateKey)) {
    return '未选择日期';
  }

  return formatDateLabel(new Date(`${dateKey}T00:00:00`));
}

function getJournalEntryDateLabel(entry: JournalEntry): string {
  return getDateGroupLabel(`${getJournalEntryDateKey(entry)}T00:00:00`);
}

function isFutureDateKey(dateKey: string): boolean {
  return isJournalDateKey(dateKey) && dateKey > getLocalDateKey(new Date());
}

function useSelectedDateForDraft() {
  draftEntryDate.value = selectedDateKey.value;
}

function composeForSelectedDate() {
  useSelectedDateForDraft();
  activeView.value = 'timeline';
  cancelEditing();
  void nextTick(() => {
    document.querySelector('.compose-card')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  });
}

function getDefaultReminderDateTime(): string {
  return toDateTimeLocalInputValue(new Date(Date.now() + 60 * 60_000));
}

function formatReminderDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getTargetTypeLabel(targetType: ReminderTargetType): string {
  if (targetType === 'journal-entry') {
    return '心记';
  }

  if (targetType === 'knowledge-note') {
    return '笔记';
  }

  return '做记';
}

function getSelectedQuote(content: string): { quote: string; anchorStart: number | null } {
  const selectedText = window.getSelection()?.toString().trim() ?? '';

  if (!selectedText || !content.includes(selectedText)) {
    return {
      quote: '',
      anchorStart: null,
    };
  }

  return {
    quote: selectedText.slice(0, 180),
    anchorStart: content.indexOf(selectedText),
  };
}

function openReminderComposer(target: ReminderTargetDraft) {
  const selectedQuote = getSelectedQuote(target.content);

  reminderTarget.value = target;
  reminderEditingId.value = null;
  reminderScheduledAt.value = getDefaultReminderDateTime();
  reminderTitle.value = `提醒：${target.title}`;
  reminderQuote.value = selectedQuote.quote;
  reminderError.value = '';
  reminderStatusMessage.value = selectedQuote.quote
    ? '已带入你选中的句子。'
    : '可以直接设置整条记录提醒，也可以在下方填入要定位的那句话。';
  reminderComposerOpen.value = true;
}

function openJournalReminderComposer(entry: JournalEntry) {
  openReminderComposer({
    type: 'journal-entry',
    id: entry.id,
    parentId: null,
    title: entry.title || '未命名心记',
    content: entry.content,
  });
}

function openKnowledgeReminderComposer(note: KnowledgeNote) {
  openReminderComposer({
    type: 'knowledge-note',
    id: note.id,
    parentId: note.baseId,
    title: note.title || '未命名笔记',
    content: note.content,
  });
}

function openLabReminderComposer(record: LabRecord) {
  openReminderComposer({
    type: 'lab-record',
    id: record.id,
    parentId: record.projectId,
    title: record.title || '未命名做记',
    content: record.content,
  });
}

function closeReminderComposer() {
  reminderComposerOpen.value = false;
  reminderEditingId.value = null;
  reminderTarget.value = null;
  reminderScheduledAt.value = '';
  reminderTitle.value = '';
  reminderQuote.value = '';
  reminderError.value = '';
}

function resolveReminderTarget(reminder: RecordReminder): ReminderTargetDraft | null {
  if (reminder.targetType === 'journal-entry') {
    const entry = entries.value.find((item) => item.id === reminder.targetId);

    if (!entry) {
      return null;
    }

    return {
      type: 'journal-entry',
      id: entry.id,
      parentId: null,
      title: entry.title || '未命名心记',
      content: entry.content,
    };
  }

  if (reminder.targetType === 'knowledge-note') {
    const note = knowledgeNotes.value.find((item) => item.id === reminder.targetId);

    if (!note) {
      return null;
    }

    return {
      type: 'knowledge-note',
      id: note.id,
      parentId: note.baseId,
      title: note.title || '未命名笔记',
      content: note.content,
    };
  }

  const record = labRecords.value.find((item) => item.id === reminder.targetId);

  if (!record) {
    return null;
  }

  return {
    type: 'lab-record',
    id: record.id,
    parentId: record.projectId,
    title: record.title || '未命名做记',
    content: record.content,
  };
}

function startReminderEditing(reminder: RecordReminder) {
  const target = resolveReminderTarget(reminder);

  if (!target) {
    reminderStatusMessage.value = '这条提醒对应的记录已经不可用。';
    return;
  }

  reminderTarget.value = target;
  reminderEditingId.value = reminder.id;
  reminderScheduledAt.value = toDateTimeLocalInputValue(new Date(reminder.scheduledAt));
  reminderTitle.value = reminder.reminderTitle;
  reminderQuote.value = reminder.quote;
  reminderError.value = '';
  reminderStatusMessage.value = '正在修改已有提醒。';
  reminderComposerOpen.value = true;
}

function scheduleSavedReminder(reminder: RecordReminder) {
  void scheduleReminderNotification(reminder).then((scheduleResult) => {
    reminderStatusMessage.value = scheduleResult.ok
      ? scheduleResult.message
      : `提醒已保存在 App 内，但系统通知暂未启动：${scheduleResult.message}`;
    refreshReminders();
  });
}

function saveReminder() {
  if (reminderIsSaving.value) {
    return;
  }

  if (!reminderTarget.value || !canSaveReminder.value) {
    reminderError.value = '请填写提醒标题，并选择一个未来时间。';
    return;
  }

  reminderIsSaving.value = true;
  reminderError.value = '';

  const anchorStart = reminderQuote.value.trim()
    ? reminderTarget.value.content.indexOf(reminderQuote.value.trim())
    : -1;
  const normalizedAnchorStart = anchorStart >= 0 ? anchorStart : null;
  const reminder =
    reminderEditingId.value === null
      ? createReminder({
          targetType: reminderTarget.value.type,
          targetId: reminderTarget.value.id,
          parentId: reminderTarget.value.parentId,
          targetTitle: reminderTarget.value.title,
          reminderTitle: reminderTitle.value,
          quote: reminderQuote.value,
          anchorStart: normalizedAnchorStart,
          scheduledAt: new Date(reminderScheduledAt.value).toISOString(),
        })
      : updateReminder(reminderEditingId.value, {
          reminderTitle: reminderTitle.value,
          quote: reminderQuote.value,
          anchorStart: normalizedAnchorStart,
          scheduledAt: new Date(reminderScheduledAt.value).toISOString(),
        });

  if (!reminder) {
    reminderError.value = '提醒保存失败，请确认时间晚于当前时间。';
    reminderIsSaving.value = false;
    return;
  }

  reminderStatusMessage.value = '提醒已保存，正在交给系统通知。';
  highlightedReminderTarget.value = {
    targetType: reminder.targetType,
    targetId: reminder.targetId,
    quote: reminder.quote,
  };
  refreshReminders();
  closeReminderComposer();
  reminderIsSaving.value = false;
  scheduleSavedReminder(reminder);
}

function cancelReminderFromList(reminder: RecordReminder) {
  const canceledReminder = cancelReminder(reminder.id);

  if (!canceledReminder) {
    return;
  }

  reminderStatusMessage.value = '提醒已取消。';
  refreshReminders();
  void cancelReminderNotification(canceledReminder.notificationId);
}

function cancelTargetReminders(
  targetType: ReminderTargetType,
  targetId: string,
) {
  const canceledReminders = cancelRemindersForTarget(targetType, targetId);

  refreshReminders();
  void Promise.all(
    canceledReminders.map((reminder) =>
      cancelReminderNotification(reminder.notificationId),
    ),
  );
}

function focusReminderTarget(reminder: RecordReminder) {
  refreshEntries();
  refreshKnowledgeData();
  refreshLabData();
  highlightedReminderTarget.value = {
    targetType: reminder.targetType,
    targetId: reminder.targetId,
    quote: reminder.quote,
  };
  reminderStatusMessage.value = reminder.quote
    ? `已打开提醒位置：“${reminder.quote}”。`
    : '已打开提醒对应的记录。';

  if (reminder.targetType === 'journal-entry') {
    activePark.value = 'journal';
    activeView.value = 'timeline';
    cancelEditing();
    void scrollReminderTargetIntoView(reminder.targetType, reminder.targetId);
    return;
  }

  if (reminder.targetType === 'knowledge-note') {
    const note = knowledgeNotes.value.find((item) => item.id === reminder.targetId);

    activePark.value = 'knowledge';
    activeKnowledgeBaseId.value = note?.baseId ?? reminder.parentId;
    selectedKnowledgeNoteId.value = reminder.targetId;
    knowledgeInspectorMode.value = 'note-view';
    knowledgeDrawerOpen.value = false;
    void scrollReminderTargetIntoView(reminder.targetType, reminder.targetId);
    return;
  }

  const record = labRecords.value.find((item) => item.id === reminder.targetId);

  activePark.value = 'lab';
  activeLabProjectId.value = record?.projectId ?? reminder.parentId;
  selectedLabRecordId.value = reminder.targetId;
  labInspectorMode.value = 'record-view';
  labDrawerOpen.value = false;
  void scrollReminderTargetIntoView(reminder.targetType, reminder.targetId);
}

async function scrollReminderTargetIntoView(
  targetType: ReminderTargetType,
  targetId: string,
) {
  await nextTick();

  window.setTimeout(() => {
    const targetElement = document.querySelector(
      `[data-reminder-target="${targetType}:${targetId}"]`,
    );

    targetElement?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, 80);
}

function focusReminderById(reminderId: string) {
  const reminder = getReminderById(reminderId);

  if (!reminder || reminder.canceledAt !== null) {
    reminderStatusMessage.value = '这条提醒已经不可用或已取消。';
    refreshReminders();
    return;
  }

  focusReminderTarget(reminder);
}

function isReminderHighlighted(
  targetType: ReminderTargetType,
  targetId: string,
): boolean {
  return (
    highlightedReminderTarget.value?.targetType === targetType &&
    highlightedReminderTarget.value.targetId === targetId
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderReminderHighlightedContent(
  content: string,
  targetType: ReminderTargetType,
  targetId: string,
): string {
  const highlightedTarget = highlightedReminderTarget.value;

  if (
    !highlightedTarget ||
    highlightedTarget.targetType !== targetType ||
    highlightedTarget.targetId !== targetId ||
    !highlightedTarget.quote
  ) {
    return escapeHtml(content);
  }

  const quoteIndex = content.indexOf(highlightedTarget.quote);

  if (quoteIndex === -1) {
    return escapeHtml(content);
  }

  const beforeQuote = content.slice(0, quoteIndex);
  const highlightedQuote = content.slice(
    quoteIndex,
    quoteIndex + highlightedTarget.quote.length,
  );
  const afterQuote = content.slice(quoteIndex + highlightedTarget.quote.length);

  return [
    escapeHtml(beforeQuote),
    '<mark class="reminder-target-highlight">',
    escapeHtml(highlightedQuote),
    '</mark>',
    escapeHtml(afterQuote),
  ].join('');
}

function parseTagInput(rawTags: string): string[] {
  return rawTags
    .split(/[,，、\n]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function getLabRecordTypeLabel(type: LabRecordType): string {
  return LAB_RECORD_TYPE_META[type].label;
}

function resetNewKnowledgeBaseForm() {
  newKnowledgeBaseName.value = '';
  newKnowledgeBaseDescription.value = '';
  newKnowledgeBaseTags.value = '';
}

function resetKnowledgeBaseEditor(base: KnowledgeBase | null) {
  editingKnowledgeBaseName.value = base?.name ?? '';
  editingKnowledgeBaseDescription.value = base?.description ?? '';
  editingKnowledgeBaseTags.value = base?.tags.join('，') ?? '';
}

function resetNewKnowledgeNoteForm() {
  newKnowledgeNoteTitle.value = '';
  newKnowledgeNoteContent.value = '';
  newKnowledgeNoteSourceUrl.value = '';
  newKnowledgeNoteTags.value = '';
}

function refreshKnowledgeData() {
  knowledgeBases.value = getKnowledgeBases();
  knowledgeNotes.value = getKnowledgeNotes();

  if (
    activeKnowledgeBaseId.value &&
    !knowledgeBases.value.some((base) => base.id === activeKnowledgeBaseId.value)
  ) {
    activeKnowledgeBaseId.value = knowledgeBases.value[0]?.id ?? null;
  }

  if (!activeKnowledgeBaseId.value) {
    activeKnowledgeBaseId.value = knowledgeBases.value[0]?.id ?? null;
  }

  if (
    selectedKnowledgeNoteId.value &&
    !activeKnowledgeNotes.value.some((note) => note.id === selectedKnowledgeNoteId.value)
  ) {
    selectedKnowledgeNoteId.value = null;
  }

  if (!activeKnowledgeBase.value) {
    selectedKnowledgeNoteId.value = null;
    knowledgeInspectorMode.value = 'base';
  } else if (
    (knowledgeInspectorMode.value === 'note-view' ||
      knowledgeInspectorMode.value === 'note-edit') &&
    !selectedKnowledgeNote.value
  ) {
    knowledgeInspectorMode.value = 'base';
  }

  if (knowledgeBases.value.length === 0) {
    knowledgeDrawerOpen.value = true;
    knowledgeBaseComposerOpen.value = true;
  }

  resetKnowledgeBaseEditor(activeKnowledgeBase.value);
}

function getKnowledgeNoteCount(baseId: string): number {
  return knowledgeNotes.value.filter((note) => note.baseId === baseId).length;
}

function selectKnowledgeBase(baseId: string) {
  activeKnowledgeBaseId.value = baseId;
  knowledgeDrawerOpen.value = false;
  selectedKnowledgeNoteId.value = null;
  knowledgeInspectorMode.value = 'base';
  resetNewKnowledgeNoteForm();
  cancelKnowledgeNoteEditing();
  resetKnowledgeBaseEditor(activeKnowledgeBase.value);
}

function toggleKnowledgeDrawer() {
  knowledgeDrawerOpen.value = !knowledgeDrawerOpen.value;
}

function openKnowledgeDrawer() {
  knowledgeDrawerOpen.value = true;
}

function closeKnowledgeDrawer() {
  knowledgeDrawerOpen.value = false;
}

function openKnowledgeBaseComposer() {
  knowledgeDrawerOpen.value = true;
  knowledgeBaseComposerOpen.value = true;
}

function closeKnowledgeBaseComposer() {
  if (knowledgeBases.value.length === 0) {
    return;
  }

  knowledgeBaseComposerOpen.value = false;
  resetNewKnowledgeBaseForm();
}

function saveNewKnowledgeBase() {
  const base = createKnowledgeBase(
    newKnowledgeBaseName.value,
    newKnowledgeBaseDescription.value,
    parseTagInput(newKnowledgeBaseTags.value),
  );

  if (!base) {
    return;
  }

  activeKnowledgeBaseId.value = base.id;
  knowledgeDrawerOpen.value = false;
  knowledgeBaseComposerOpen.value = false;
  selectedKnowledgeNoteId.value = null;
  knowledgeInspectorMode.value = 'base';
  resetNewKnowledgeBaseForm();
  refreshKnowledgeData();
}

function showKnowledgeBaseSummary() {
  selectedKnowledgeNoteId.value = null;
  knowledgeInspectorMode.value = 'base';
  resetNewKnowledgeNoteForm();
  cancelKnowledgeNoteEditing();
}

function startKnowledgeBaseEditing() {
  if (!activeKnowledgeBase.value) {
    return;
  }

  selectedKnowledgeNoteId.value = null;
  knowledgeInspectorMode.value = 'base-edit';
  resetKnowledgeBaseEditor(activeKnowledgeBase.value);
}

function saveKnowledgeBaseDetails() {
  if (!activeKnowledgeBase.value) {
    return;
  }

  const updatedBase = updateKnowledgeBase(activeKnowledgeBase.value.id, {
    name: editingKnowledgeBaseName.value,
    description: editingKnowledgeBaseDescription.value,
    tags: parseTagInput(editingKnowledgeBaseTags.value),
  });

  if (!updatedBase) {
    return;
  }

  activeKnowledgeBaseId.value = updatedBase.id;
  knowledgeInspectorMode.value = 'base';
  refreshKnowledgeData();
}

function removeKnowledgeBase(base: KnowledgeBase) {
  const shouldDelete = window.confirm(
    `确定删除「${base.name}」知识库吗？库下知识记录也会从知识库区移除。`,
  );

  if (!shouldDelete) {
    return;
  }

  void Promise.all(
    knowledgeNotes.value
      .filter((note) => note.baseId === base.id)
      .map((note) => cancelTargetReminders('knowledge-note', note.id)),
  );
  deleteKnowledgeBase(base.id);
  selectedKnowledgeNoteId.value = null;
  knowledgeInspectorMode.value = 'base';
  cancelKnowledgeNoteEditing();
  refreshKnowledgeData();
}

function startKnowledgeNoteComposer() {
  if (!activeKnowledgeBase.value) {
    return;
  }

  selectedKnowledgeNoteId.value = null;
  knowledgeInspectorMode.value = 'note-create';
  cancelKnowledgeNoteEditing();
  resetNewKnowledgeNoteForm();
}

function saveNewKnowledgeNote() {
  if (!activeKnowledgeBase.value) {
    return;
  }

  const note = createKnowledgeNote(activeKnowledgeBase.value.id, {
    title: newKnowledgeNoteTitle.value,
    content: newKnowledgeNoteContent.value,
    sourceUrl: newKnowledgeNoteSourceUrl.value,
    tags: parseTagInput(newKnowledgeNoteTags.value),
  });

  if (!note) {
    return;
  }

  selectedKnowledgeNoteId.value = note.id;
  knowledgeInspectorMode.value = 'note-view';
  resetNewKnowledgeNoteForm();
  refreshKnowledgeData();
}

function selectKnowledgeNote(note: KnowledgeNote) {
  selectedKnowledgeNoteId.value = note.id;
  knowledgeInspectorMode.value = 'note-view';
  resetNewKnowledgeNoteForm();
  cancelKnowledgeNoteEditing();
}

function startKnowledgeNoteEditing(note: KnowledgeNote) {
  selectedKnowledgeNoteId.value = note.id;
  knowledgeInspectorMode.value = 'note-edit';
  editingKnowledgeNoteId.value = note.id;
  editingKnowledgeNoteTitle.value = note.title;
  editingKnowledgeNoteContent.value = note.content;
  editingKnowledgeNoteSourceUrl.value = note.sourceUrl;
  editingKnowledgeNoteTags.value = note.tags.join('，');
}

function cancelKnowledgeNoteEditing() {
  editingKnowledgeNoteId.value = null;
  editingKnowledgeNoteTitle.value = '';
  editingKnowledgeNoteContent.value = '';
  editingKnowledgeNoteSourceUrl.value = '';
  editingKnowledgeNoteTags.value = '';
}

function saveKnowledgeNoteEditing() {
  if (!editingKnowledgeNoteId.value) {
    return;
  }

  const updatedNote = updateKnowledgeNote(editingKnowledgeNoteId.value, {
    title: editingKnowledgeNoteTitle.value,
    content: editingKnowledgeNoteContent.value,
    sourceUrl: editingKnowledgeNoteSourceUrl.value,
    tags: parseTagInput(editingKnowledgeNoteTags.value),
  });

  if (!updatedNote) {
    return;
  }

  selectedKnowledgeNoteId.value = updatedNote.id;
  knowledgeInspectorMode.value = 'note-view';
  cancelKnowledgeNoteEditing();
  refreshKnowledgeData();
}

function removeKnowledgeNote(note: KnowledgeNote) {
  const shouldDelete = window.confirm(`确定删除「${note.title}」这条知识记录吗？`);

  if (!shouldDelete) {
    return;
  }

  deleteKnowledgeNote(note.id);
  void cancelTargetReminders('knowledge-note', note.id);

  if (
    editingKnowledgeNoteId.value === note.id ||
    selectedKnowledgeNoteId.value === note.id
  ) {
    selectedKnowledgeNoteId.value = null;
    knowledgeInspectorMode.value = 'base';
    cancelKnowledgeNoteEditing();
  }

  refreshKnowledgeData();
}

function resetNewLabProjectForm() {
  newLabProjectName.value = '';
  newLabProjectDescription.value = '';
  newLabProjectTags.value = '';
}

function resetLabProjectEditor(project: LabProject | null) {
  editingLabProjectName.value = project?.name ?? '';
  editingLabProjectDescription.value = project?.description ?? '';
  editingLabProjectTags.value = project?.tags.join('，') ?? '';
}

function resetNewLabRecordForm() {
  newLabRecordTitle.value = '';
  newLabRecordContent.value = '';
  newLabRecordType.value = 'operation';
  newLabRecordTags.value = '';
}

function refreshLabData() {
  labProjects.value = getLabProjects();
  labRecords.value = getLabRecords();

  if (
    activeLabProjectId.value &&
    !labProjects.value.some((project) => project.id === activeLabProjectId.value)
  ) {
    activeLabProjectId.value = labProjects.value[0]?.id ?? null;
  }

  if (!activeLabProjectId.value) {
    activeLabProjectId.value = labProjects.value[0]?.id ?? null;
  }

  if (
    selectedLabRecordId.value &&
    !activeLabRecords.value.some((record) => record.id === selectedLabRecordId.value)
  ) {
    selectedLabRecordId.value = null;
  }

  if (!activeLabProject.value) {
    selectedLabRecordId.value = null;
    labInspectorMode.value = 'project';
  } else if (
    (labInspectorMode.value === 'record-view' ||
      labInspectorMode.value === 'record-edit') &&
    !selectedLabRecord.value
  ) {
    labInspectorMode.value = 'project';
  }

  if (labProjects.value.length === 0) {
    labDrawerOpen.value = true;
    labProjectComposerOpen.value = true;
  }

  resetLabProjectEditor(activeLabProject.value);
}

function getLabRecordCount(projectId: string): number {
  return labRecords.value.filter((record) => record.projectId === projectId).length;
}

function selectLabProject(projectId: string) {
  activeLabProjectId.value = projectId;
  labDrawerOpen.value = false;
  selectedLabRecordId.value = null;
  labInspectorMode.value = 'project';
  resetNewLabRecordForm();
  cancelLabRecordEditing();
  resetLabProjectEditor(activeLabProject.value);
}

function toggleLabDrawer() {
  labDrawerOpen.value = !labDrawerOpen.value;
}

function openLabDrawer() {
  labDrawerOpen.value = true;
}

function closeLabDrawer() {
  labDrawerOpen.value = false;
}

function openLabProjectComposer() {
  labDrawerOpen.value = true;
  labProjectComposerOpen.value = true;
}

function closeLabProjectComposer() {
  if (labProjects.value.length === 0) {
    return;
  }

  labProjectComposerOpen.value = false;
  resetNewLabProjectForm();
}

function saveNewLabProject() {
  const project = createLabProject(
    newLabProjectName.value,
    newLabProjectDescription.value,
    parseTagInput(newLabProjectTags.value),
  );

  if (!project) {
    return;
  }

  activeLabProjectId.value = project.id;
  labDrawerOpen.value = false;
  labProjectComposerOpen.value = false;
  selectedLabRecordId.value = null;
  labInspectorMode.value = 'project';
  resetNewLabProjectForm();
  refreshLabData();
}

function showLabProjectSummary() {
  selectedLabRecordId.value = null;
  labInspectorMode.value = 'project';
  resetNewLabRecordForm();
  cancelLabRecordEditing();
}

function startLabProjectEditing() {
  if (!activeLabProject.value) {
    return;
  }

  selectedLabRecordId.value = null;
  labInspectorMode.value = 'project-edit';
  resetLabProjectEditor(activeLabProject.value);
}

function saveLabProjectDetails() {
  if (!activeLabProject.value) {
    return;
  }

  const updatedProject = updateLabProject(activeLabProject.value.id, {
    name: editingLabProjectName.value,
    description: editingLabProjectDescription.value,
    tags: parseTagInput(editingLabProjectTags.value),
  });

  if (!updatedProject) {
    return;
  }

  activeLabProjectId.value = updatedProject.id;
  labInspectorMode.value = 'project';
  refreshLabData();
}

function removeLabProject(project: LabProject) {
  const shouldDelete = window.confirm(
    `确定删除「${project.name}」项目吗？项目下的操作和复盘记录也会一起移除。`,
  );

  if (!shouldDelete) {
    return;
  }

  void Promise.all(
    labRecords.value
      .filter((record) => record.projectId === project.id)
      .map((record) => cancelTargetReminders('lab-record', record.id)),
  );
  deleteLabProject(project.id);
  selectedLabRecordId.value = null;
  labInspectorMode.value = 'project';
  cancelLabRecordEditing();
  refreshLabData();
}

function startLabRecordComposer() {
  if (!activeLabProject.value) {
    return;
  }

  selectedLabRecordId.value = null;
  labInspectorMode.value = 'record-create';
  cancelLabRecordEditing();
  resetNewLabRecordForm();
}

function saveNewLabRecord() {
  if (!activeLabProject.value) {
    return;
  }

  const record = createLabRecord(activeLabProject.value.id, {
    title: newLabRecordTitle.value,
    content: newLabRecordContent.value,
    type: newLabRecordType.value,
    tags: parseTagInput(newLabRecordTags.value),
  });

  if (!record) {
    return;
  }

  selectedLabRecordId.value = record.id;
  labInspectorMode.value = 'record-view';
  resetNewLabRecordForm();
  refreshLabData();
}

function selectLabRecord(record: LabRecord) {
  selectedLabRecordId.value = record.id;
  labInspectorMode.value = 'record-view';
  resetNewLabRecordForm();
  cancelLabRecordEditing();
}

function startLabRecordEditing(record: LabRecord) {
  selectedLabRecordId.value = record.id;
  labInspectorMode.value = 'record-edit';
  editingLabRecordId.value = record.id;
  editingLabRecordTitle.value = record.title;
  editingLabRecordContent.value = record.content;
  editingLabRecordType.value = record.type;
  editingLabRecordTags.value = record.tags.join('，');
}

function cancelLabRecordEditing() {
  editingLabRecordId.value = null;
  editingLabRecordTitle.value = '';
  editingLabRecordContent.value = '';
  editingLabRecordType.value = 'operation';
  editingLabRecordTags.value = '';
}

function saveLabRecordEditing() {
  if (!editingLabRecordId.value) {
    return;
  }

  const updatedRecord = updateLabRecord(editingLabRecordId.value, {
    title: editingLabRecordTitle.value,
    content: editingLabRecordContent.value,
    type: editingLabRecordType.value,
    tags: parseTagInput(editingLabRecordTags.value),
  });

  if (!updatedRecord) {
    return;
  }

  selectedLabRecordId.value = updatedRecord.id;
  labInspectorMode.value = 'record-view';
  cancelLabRecordEditing();
  refreshLabData();
}

function removeLabRecord(record: LabRecord) {
  const shouldDelete = window.confirm(`确定删除「${record.title}」这条项目记录吗？`);

  if (!shouldDelete) {
    return;
  }

  deleteLabRecord(record.id);
  void cancelTargetReminders('lab-record', record.id);

  if (
    editingLabRecordId.value === record.id ||
    selectedLabRecordId.value === record.id
  ) {
    selectedLabRecordId.value = null;
    labInspectorMode.value = 'project';
    cancelLabRecordEditing();
  }

  refreshLabData();
}

function refreshAgentConversations() {
  agentConversations.value = getAgentConversations();

  if (
    !activeAgentConversationId.value ||
    !agentConversations.value.some(
      (conversation) => conversation.id === activeAgentConversationId.value,
    )
  ) {
    activeAgentConversationId.value = getActiveAgentConversationId(
      agentConversations.value,
    );
  }
}

function setActiveView(view: ActiveView) {
  activeView.value = view;
  cancelEditing();
}

function setActivePark(park: ActivePark) {
  activePark.value = park;
  cancelEditing();
  cancelKnowledgeNoteEditing();
  cancelLabRecordEditing();

  if (park !== 'knowledge') {
    knowledgeDrawerOpen.value = false;
  }

  if (park !== 'lab') {
    labDrawerOpen.value = false;
  }

  if (park === 'knowledge' && activeKnowledgeBase.value && !selectedKnowledgeNote.value) {
    knowledgeInspectorMode.value = 'base';
  }

  if (park === 'lab' && activeLabProject.value && !selectedLabRecord.value) {
    labInspectorMode.value = 'project';
  }
}

function saveDraft() {
  if (!isJournalDateKey(draftEntryDate.value)) {
    return;
  }

  const entry = createEntry(
    draftContent.value,
    draftTitle.value,
    draftEntryDate.value,
  );

  if (!entry) {
    return;
  }

  draftTitle.value = '';
  draftContent.value = '';
  selectedDateKey.value = entry.entryDate;
  calendarMonth.value = startOfMonth(new Date(`${entry.entryDate}T00:00:00`));
  refreshEntries();
}

function startEditing(entry: JournalEntry) {
  editingId.value = entry.id;
  editingContent.value = entry.content;
  editingEntryDate.value = getJournalEntryDateKey(entry);
}

function cancelEditing() {
  editingId.value = null;
  editingContent.value = '';
  editingEntryDate.value = '';
}

function saveEditing() {
  if (!editingId.value) {
    return;
  }

  if (!isJournalDateKey(editingEntryDate.value)) {
    return;
  }

  const updated = updateEntry(editingId.value, {
    content: editingContent.value,
    entryDate: editingEntryDate.value,
  });

  if (!updated) {
    return;
  }

  cancelEditing();
  refreshEntries();
}

function removeEntry(entry: JournalEntry) {
  const shouldDelete = window.confirm('确定删除这条日志吗？');

  if (!shouldDelete) {
    return;
  }

  deleteEntry(entry.id);
  void cancelTargetReminders('journal-entry', entry.id);

  if (editingId.value === entry.id) {
    cancelEditing();
  }

  refreshEntries();
}

function getEntryCountForDate(dateKey: string): number {
  return entryCountByDate.value.get(dateKey) ?? 0;
}

function getCalendarMarkerClass(count: number): string {
  if (count >= 4) {
    return 'has-many-entries';
  }

  if (count >= 2) {
    return 'has-some-entries';
  }

  if (count === 1) {
    return 'has-one-entry';
  }

  return '';
}

function selectCalendarDay(day: CalendarDay) {
  selectedDateKey.value = day.dateKey;
  draftEntryDate.value = day.dateKey;

  if (!day.isCurrentMonth) {
    calendarMonth.value = startOfMonth(day.date);
  }
}

function goToPreviousMonth() {
  calendarMonth.value = addMonths(calendarMonth.value, -1);
}

function goToNextMonth() {
  calendarMonth.value = addMonths(calendarMonth.value, 1);
}

function jumpToToday() {
  const today = new Date();
  calendarMonth.value = startOfMonth(today);
  selectedDateKey.value = getLocalDateKey(today);
  draftEntryDate.value = selectedDateKey.value;
}

function toggleAgentPanel() {
  agentPanelOpen.value = !agentPanelOpen.value;
}

function closeAgentPanel() {
  agentPanelOpen.value = false;
}

function startNewAgentConversation() {
  const conversation = createAgentConversation([createAgentWelcomeMessage()]);
  activeAgentConversationId.value = conversation.id;
  agentInput.value = '';
  refreshAgentConversations();
}

function selectAgentConversation(id: string) {
  activeAgentConversationId.value = id;
  setActiveAgentConversationId(id);
  agentInput.value = '';
}

function ensureActiveAgentConversation(): AgentConversation {
  if (activeAgentConversation.value) {
    return activeAgentConversation.value;
  }

  const conversation = createAgentConversation([createAgentWelcomeMessage()]);
  activeAgentConversationId.value = conversation.id;
  refreshAgentConversations();

  return conversation;
}

async function submitAgentMessage() {
  const content = agentInput.value.trim();

  if (!content || agentIsThinking.value) {
    return;
  }

  const conversation = ensureActiveAgentConversation();
  const userMessage = createAgentMessage('user', content);
  appendAgentConversationMessage(conversation.id, userMessage);
  refreshAgentConversations();
  agentInput.value = '';
  agentIsThinking.value = true;

  try {
    const requestConversation = agentConversations.value.find(
      (item) => item.id === conversation.id,
    );
    const result: SendAgentMessageResult = await sendAgentMessage({
      messages: requestConversation?.messages ?? [userMessage],
      entries: entries.value,
      knowledgeBases: knowledgeBases.value,
      knowledgeNotes: knowledgeNotes.value,
      labProjects: labProjects.value,
      labRecords: labRecords.value,
      activeJournalEntryId: editingId.value,
      activeKnowledgeBaseId: activeKnowledgeBase.value?.id ?? null,
      selectedKnowledgeNoteId: selectedKnowledgeNote.value?.id ?? null,
      activeLabProjectId: activeLabProject.value?.id ?? null,
      selectedLabRecordId: selectedLabRecord.value?.id ?? null,
    });
    appendAgentConversationMessage(conversation.id, result.assistantMessage);
    if (
      result.mutatedJournalEntryId ||
      result.mutatedKnowledgeBaseId ||
      result.mutatedKnowledgeNoteId ||
      result.mutatedLabProjectId ||
      result.mutatedLabRecordId
    ) {
      refreshEntries();
      refreshKnowledgeData();
      refreshLabData();

      if (result.mutationKind === 'journal-entry') {
        activePark.value = 'journal';
        activeView.value = 'timeline';
      }

      if (result.mutatedKnowledgeBaseId) {
        activeKnowledgeBaseId.value = result.mutatedKnowledgeBaseId;
      }

      if (result.mutatedKnowledgeNoteId) {
        activePark.value = 'knowledge';
        selectedKnowledgeNoteId.value = result.mutatedKnowledgeNoteId;
        knowledgeInspectorMode.value = 'note-view';
      }

      if (result.mutatedLabProjectId) {
        activeLabProjectId.value = result.mutatedLabProjectId;
      }

      if (result.mutatedLabRecordId) {
        activePark.value = 'lab';
        selectedLabRecordId.value = result.mutatedLabRecordId;
        labInspectorMode.value = 'record-view';
      }
    }
    refreshAgentConversations();
  } catch {
    appendAgentConversationMessage(
      conversation.id,
      createAgentMessage(
        'assistant',
        '我刚刚没有连上模型服务。现在先检查占位 URL / API Key / model，之后我们会把真实请求接到后端代理。',
      ),
    );
    refreshAgentConversations();
  } finally {
    agentIsThinking.value = false;
    ragIndexVersion.value += 1;
  }
}

onMounted(() => {
  void listenForReminderNotificationActions((action) => {
    focusReminderById(action.reminderId);
  });
});
</script>

<template>
  <main class="journal-app">
    <section
      class="hero-panel"
      :class="{ 'knowledge-hero-panel': activePark === 'knowledge' || activePark === 'lab' }"
      aria-labelledby="app-title"
    >
      <div class="hero-main">
        <nav class="park-switcher" aria-label="记录 Park">
          <button
            v-for="park in parkSummaries"
            :key="park.id"
            type="button"
            :class="{ active: activePark === park.id }"
            @click="setActivePark(park.id)"
          >
            <span>{{ park.label }}</span>
          </button>
        </nav>

        <template v-if="activePark === 'knowledge'">
          <div class="knowledge-hero-title">
            <button
              class="icon-button knowledge-drawer-toggle"
              type="button"
              :aria-expanded="knowledgeDrawerOpen"
              aria-controls="knowledge-drawer"
              @click="toggleKnowledgeDrawer"
            >
              <span class="knowledge-drawer-icon" aria-hidden="true">
                <i></i>
                <i></i>
                <i></i>
              </span>
            </button>
            <h1 id="app-title" class="knowledge-page-title">{{ activeParkSummary.title }}</h1>
          </div>
        </template>

        <template v-else-if="activePark === 'lab'">
          <div class="knowledge-hero-title">
            <button
              class="icon-button knowledge-drawer-toggle"
              type="button"
              :aria-expanded="labDrawerOpen"
              aria-controls="lab-drawer"
              @click="toggleLabDrawer"
            >
              <span class="knowledge-drawer-icon" aria-hidden="true">
                <i></i>
                <i></i>
                <i></i>
              </span>
            </button>
            <h1 id="app-title" class="knowledge-page-title">{{ activeParkSummary.title }}</h1>
          </div>
        </template>

        <template v-else>
          <div class="hero-content-row">
            <div>
              <h1 id="app-title">{{ activeParkSummary.title }}</h1>
              <p class="today-line">{{ activeParkSummary.description }}</p>
            </div>

            <div
              v-if="activePark === 'journal'"
              class="header-actions"
              aria-label="快捷操作"
            >
              <div class="today-pill">
                <span>{{ activeParkSummary.metricValue }}</span>
                <small>{{ activeParkSummary.metricLabel }}</small>
              </div>
            </div>
          </div>
        </template>
      </div>
    </section>

    <section
      v-if="activeReminders.length > 0 || reminderStatusMessage"
      class="reminder-dock"
      aria-label="系统提醒"
    >
      <div class="section-heading compact">
        <div>
          <p class="eyebrow">提醒</p>
          <h2>系统定时提醒</h2>
        </div>
        <span class="counter">{{ activeReminders.length }} 条</span>
      </div>

      <p v-if="reminderStatusMessage" class="reminder-message">
        {{ reminderStatusMessage }}
      </p>

      <div v-if="visibleReminders.length > 0" class="reminder-list">
        <article
          v-for="reminder in visibleReminders"
          :key="reminder.id"
          class="reminder-item"
        >
          <button type="button" class="reminder-item-main" @click="focusReminderTarget(reminder)">
            <span>{{ getTargetTypeLabel(reminder.targetType) }} · {{ formatReminderDateTime(reminder.scheduledAt) }}</span>
            <strong>{{ reminder.reminderTitle }}</strong>
            <small>{{ reminder.quote || reminder.targetTitle }}</small>
          </button>
          <div class="reminder-item-actions">
            <button class="ghost-action" type="button" @click="startReminderEditing(reminder)">
              修改
            </button>
            <button class="delete-action" type="button" @click="cancelReminderFromList(reminder)">
              取消
            </button>
          </div>
        </article>
      </div>
    </section>

    <section
      v-if="activePark === 'journal'"
      class="park-workspace journal-workspace"
      aria-label="日记区"
    >
      <nav class="view-switcher" aria-label="日志视图">
        <button
          type="button"
          :class="{ active: activeView === 'timeline' }"
          @click="setActiveView('timeline')"
        >
          时间线
        </button>
        <button
          type="button"
          :class="{ active: activeView === 'search' }"
          @click="setActiveView('search')"
        >
          搜索
        </button>
        <button
          type="button"
          :class="{ active: activeView === 'calendar' }"
          @click="setActiveView('calendar')"
        >
          日历
        </button>
      </nav>

      <section v-if="activeView === 'timeline'" class="compose-card" aria-labelledby="compose-title">
      <h2 id="compose-title" class="journal-section-title">写到 {{ draftDateLabel }}</h2>

      <label class="journal-date-field">
        <span>记录日期</span>
        <input
          v-model="draftEntryDate"
          class="date-input"
          type="date"
          aria-label="记录归属日期"
        />
        <small>{{ draftDateTone }}</small>
      </label>

      <input
        v-model="draftTitle"
        class="title-input"
        type="text"
        maxlength="18"
        placeholder="标题，可选"
        aria-label="日志标题"
      />

      <textarea
        v-model="draftContent"
        class="journal-input"
        placeholder="写下刚刚发生的事、一个念头，或者一句想留住的话。"
        rows="6"
      />

      <button class="primary-action" type="button" :disabled="!canSaveDraft" @click="saveDraft">
        保存这一刻
      </button>
    </section>

    <section v-if="activeView === 'search'" class="tool-card" aria-labelledby="search-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">查找</p>
          <h2 id="search-title">搜索日志</h2>
        </div>
        <span class="counter">{{ searchResults.length }} 条</span>
      </div>

      <input
        v-model="searchQuery"
        class="search-input"
        type="search"
        placeholder="搜索关键词，例如：iCloud / 工作 / 灵感"
      />

      <div v-if="!normalizedSearchQuery" class="empty-state">
        <p>输入关键词开始查找。</p>
        <span>会同时搜索标题、正文和未来的标签。</span>
      </div>

      <div v-else-if="searchResults.length === 0" class="empty-state">
        <p>没有找到匹配日志。</p>
        <span>换一个关键词试试，或者回到时间线继续记录。</span>
      </div>

      <div v-else class="entry-groups search-results">
        <article
          v-for="entry in searchResults"
          :key="entry.id"
          class="entry-card"
          :data-reminder-target="`journal-entry:${entry.id}`"
          :class="{ 'is-reminder-target': isReminderHighlighted('journal-entry', entry.id) }"
        >
          <template v-if="editingId === entry.id">
            <label class="journal-date-field compact">
              <span>归属日期</span>
              <input
                v-model="editingEntryDate"
                class="date-input"
                type="date"
                aria-label="编辑记录归属日期"
              />
            </label>
            <textarea v-model="editingContent" class="journal-input edit-input" rows="7" />
            <div class="entry-actions">
              <button class="ghost-action" type="button" @click="cancelEditing">取消</button>
              <button
                class="primary-action small"
                type="button"
                :disabled="editingContent.trim().length === 0 || !isJournalDateKey(editingEntryDate)"
                @click="saveEditing"
              >
                保存修改
              </button>
            </div>
          </template>

          <template v-else>
            <button class="entry-body" type="button" @click="startEditing(entry)">
              <span class="entry-time">
                {{ getJournalEntryDateLabel(entry) }} · 创建 {{ formatEntryTime(entry.createdAt) }}
              </span>
              <strong>{{ entry.title }}</strong>
              <p v-html="renderReminderHighlightedContent(entry.content, 'journal-entry', entry.id)"></p>
            </button>

            <div class="entry-footer">
              <span class="entry-footnote">
                {{ entry.content.length }} 字
                <i v-if="isFutureDateKey(getJournalEntryDateKey(entry))" class="future-entry-badge">
                  未来
                </i>
              </span>
              <div class="entry-footer-actions">
                <button class="ghost-action reminder-action" type="button" @click="openJournalReminderComposer(entry)">
                  提醒
                </button>
                <button class="delete-action" type="button" @click="removeEntry(entry)">
                  删除
                </button>
              </div>
            </div>
          </template>
        </article>
      </div>
    </section>

    <section v-if="activeView === 'calendar'" class="tool-card" aria-labelledby="calendar-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">日历</p>
          <h2 id="calendar-title">{{ currentMonthTitle }}</h2>
        </div>
        <button class="ghost-action" type="button" @click="jumpToToday">回到今天</button>
      </div>

      <div class="calendar-toolbar" aria-label="月份切换">
        <button class="month-action" type="button" @click="goToPreviousMonth">上个月</button>
        <span>有记录的日子会被标记</span>
        <button class="month-action" type="button" @click="goToNextMonth">下个月</button>
      </div>

      <div class="calendar-grid calendar-weekdays" aria-hidden="true">
        <span v-for="weekday in WEEKDAY_LABELS" :key="weekday">周{{ weekday }}</span>
      </div>

      <div class="calendar-grid" role="grid" aria-label="日志日历">
        <button
          v-for="day in calendarDays"
          :key="day.dateKey"
          class="calendar-day"
          type="button"
          :class="[
            {
              'is-outside': !day.isCurrentMonth,
              'is-today': day.isToday,
              'is-selected': selectedDateKey === day.dateKey,
            },
            getCalendarMarkerClass(getEntryCountForDate(day.dateKey)),
          ]"
          :aria-pressed="selectedDateKey === day.dateKey"
          @click="selectCalendarDay(day)"
        >
          <span>{{ day.dayNumber }}</span>
          <small v-if="getEntryCountForDate(day.dateKey) > 0">
            {{ getEntryCountForDate(day.dateKey) }}
          </small>
        </button>
      </div>

      <div class="calendar-legend" aria-label="日历标记说明">
        <span><i class="legend-dot one"></i>1 条</span>
        <span><i class="legend-dot some"></i>2-3 条</span>
        <span><i class="legend-dot many"></i>4 条以上</span>
      </div>

      <div class="selected-day-panel">
        <div class="section-heading compact">
          <div>
            <p class="eyebrow">选中日期</p>
            <h2>{{ selectedDateLabel }}</h2>
          </div>
          <div class="selected-day-actions">
            <button class="ghost-action" type="button" @click="composeForSelectedDate">
              写到这天
            </button>
            <span class="counter">{{ selectedDateEntries.length }} 条</span>
          </div>
        </div>

        <div v-if="selectedDateEntries.length === 0" class="empty-state">
          <p>这一天还没有记录。</p>
          <span>可以直接为这一天写记录，未来日期也会被放进对应日历格。</span>
          <button class="ghost-action empty-action" type="button" @click="composeForSelectedDate">
            写到这一天
          </button>
        </div>

        <div v-else class="entry-groups">
          <article
            v-for="entry in selectedDateEntries"
            :key="entry.id"
            class="entry-card"
            :data-reminder-target="`journal-entry:${entry.id}`"
            :class="{ 'is-reminder-target': isReminderHighlighted('journal-entry', entry.id) }"
          >
            <template v-if="editingId === entry.id">
              <label class="journal-date-field compact">
                <span>归属日期</span>
                <input
                  v-model="editingEntryDate"
                  class="date-input"
                  type="date"
                  aria-label="编辑记录归属日期"
                />
              </label>
              <textarea v-model="editingContent" class="journal-input edit-input" rows="7" />
              <div class="entry-actions">
                <button class="ghost-action" type="button" @click="cancelEditing">取消</button>
                <button
                  class="primary-action small"
                  type="button"
                  :disabled="editingContent.trim().length === 0 || !isJournalDateKey(editingEntryDate)"
                  @click="saveEditing"
                >
                  保存修改
                </button>
              </div>
            </template>

            <template v-else>
              <button class="entry-body" type="button" @click="startEditing(entry)">
                <span class="entry-time">创建 {{ formatEntryTime(entry.createdAt) }}</span>
                <strong>{{ entry.title }}</strong>
                <p v-html="renderReminderHighlightedContent(entry.content, 'journal-entry', entry.id)"></p>
              </button>

              <div class="entry-footer">
                <span class="entry-footnote">
                  {{ entry.content.length }} 字
                  <i v-if="isFutureDateKey(getJournalEntryDateKey(entry))" class="future-entry-badge">
                    未来
                  </i>
                </span>
                <div class="entry-footer-actions">
                  <button class="ghost-action reminder-action" type="button" @click="openJournalReminderComposer(entry)">
                    提醒
                  </button>
                  <button class="delete-action" type="button" @click="removeEntry(entry)">
                    删除
                  </button>
                </div>
              </div>
            </template>
          </article>
        </div>
      </div>
    </section>

    <section v-if="activeView === 'timeline'" class="timeline" aria-labelledby="timeline-title">
      <h2 id="timeline-title" class="journal-section-title">日志时间线</h2>

      <div v-if="entries.length === 0" class="empty-state">
        <p>还没有日志。</p>
        <span>先写下第一条，之后这里会按时间整理你的记录。</span>
      </div>

      <div v-else class="entry-groups">
        <section v-for="group in groupedEntries" :key="group.label" class="entry-group">
          <h3>{{ group.label }}</h3>

          <article
            v-for="entry in group.entries"
            :key="entry.id"
            class="entry-card"
            :data-reminder-target="`journal-entry:${entry.id}`"
            :class="{ 'is-reminder-target': isReminderHighlighted('journal-entry', entry.id) }"
          >
            <template v-if="editingId === entry.id">
              <label class="journal-date-field compact">
                <span>归属日期</span>
                <input
                  v-model="editingEntryDate"
                  class="date-input"
                  type="date"
                  aria-label="编辑记录归属日期"
                />
              </label>
              <textarea v-model="editingContent" class="journal-input edit-input" rows="7" />
              <div class="entry-actions">
                <button class="ghost-action" type="button" @click="cancelEditing">取消</button>
                <button
                  class="primary-action small"
                  type="button"
                  :disabled="editingContent.trim().length === 0 || !isJournalDateKey(editingEntryDate)"
                  @click="saveEditing"
                >
                  保存修改
                </button>
              </div>
            </template>

            <template v-else>
              <button class="entry-body" type="button" @click="startEditing(entry)">
                <span class="entry-time">创建 {{ formatEntryTime(entry.createdAt) }}</span>
                <strong>{{ entry.title }}</strong>
                <p v-html="renderReminderHighlightedContent(entry.content, 'journal-entry', entry.id)"></p>
              </button>

              <div class="entry-footer">
                <span class="entry-footnote">
                  {{ entry.content.length }} 字
                  <i v-if="isFutureDateKey(getJournalEntryDateKey(entry))" class="future-entry-badge">
                    未来
                  </i>
                </span>
                <div class="entry-footer-actions">
                  <button class="ghost-action reminder-action" type="button" @click="openJournalReminderComposer(entry)">
                    提醒
                  </button>
                  <button class="delete-action" type="button" @click="removeEntry(entry)">
                    删除
                  </button>
                </div>
              </div>
            </template>
          </article>
        </section>
      </div>
    </section>
    </section>

    <section
      v-else-if="activePark === 'knowledge'"
      class="knowledge-workspace"
      aria-label="知识库工作区"
    >
      <button
        v-if="knowledgeDrawerOpen"
        class="knowledge-drawer-backdrop"
        type="button"
        aria-label="关闭仓库导航"
        @click="closeKnowledgeDrawer"
      ></button>

      <aside
        id="knowledge-drawer"
        class="knowledge-sidebar"
        :class="{ open: knowledgeDrawerOpen }"
        aria-label="仓库导航"
      >
        <div class="section-heading compact knowledge-pane-heading knowledge-drawer-heading">
          <div>
            <p class="eyebrow">仓库</p>
            <h2>知识仓库</h2>
          </div>
          <div class="knowledge-pane-actions">
            <span class="counter">{{ knowledgeBases.length }} 库</span>
            <button class="ghost-action" type="button" @click="closeKnowledgeDrawer">
              关闭
            </button>
          </div>
        </div>

        <div v-if="knowledgeBases.length === 0" class="empty-state knowledge-empty-state">
          <p>还没有仓库。</p>
          <span>先建一个仓库，再往里面慢慢积累知识笔记。</span>
        </div>

        <div v-else class="knowledge-base-list">
          <button
            v-for="base in knowledgeBases"
            :key="base.id"
            type="button"
            :class="{ active: base.id === activeKnowledgeBaseId }"
            @click="selectKnowledgeBase(base.id)"
          >
            <strong>{{ base.name }}</strong>
            <span>{{ getKnowledgeNoteCount(base.id) }} 条笔记</span>
            <small>
              {{ getDateGroupLabel(base.updatedAt) }} · {{ formatEntryTime(base.updatedAt) }}
            </small>
            <small v-if="base.tags.length > 0">{{ base.tags.join(' / ') }}</small>
          </button>
        </div>

        <div class="knowledge-sidebar-footer">
          <button
            v-if="activeKnowledgeBase"
            class="ghost-action knowledge-sidebar-manage"
            type="button"
            @click="startKnowledgeBaseEditing"
          >
            编辑当前仓库
          </button>
          <button
            class="ghost-action knowledge-sidebar-add"
            type="button"
            @click="openKnowledgeBaseComposer"
          >
            添加新仓库
          </button>
        </div>

        <form
          v-if="knowledgeBaseComposerOpen"
          class="knowledge-base-composer"
          @submit.prevent="saveNewKnowledgeBase"
        >
          <input
            v-model="newKnowledgeBaseName"
            class="title-input"
            type="text"
            maxlength="40"
            placeholder="仓库名称，例如：GitHub 学习库"
            aria-label="知识库名称"
          />
          <textarea
            v-model="newKnowledgeBaseDescription"
            class="journal-input knowledge-description-input"
            placeholder="这个仓库要沉淀什么内容？"
            rows="3"
          />
          <input
            v-model="newKnowledgeBaseTags"
            class="search-input compact-input"
            type="text"
            placeholder="标签，可选，用逗号分隔"
            aria-label="知识库标签"
          />
          <div class="entry-actions">
            <button
              v-if="knowledgeBases.length > 0"
              class="ghost-action"
              type="button"
              @click="closeKnowledgeBaseComposer"
            >
              取消
            </button>
            <button
              class="primary-action small"
              type="submit"
              :disabled="!canCreateKnowledgeBase"
            >
              保存仓库
            </button>
          </div>
        </form>
      </aside>

      <section class="knowledge-shell" aria-label="知识笔记工作台">
        <section class="knowledge-notes-pane" aria-labelledby="knowledge-notes-title">
          <div class="section-heading compact knowledge-pane-heading">
            <h2 id="knowledge-notes-title">
              {{ activeKnowledgeBase ? activeKnowledgeBase.name : '选择仓库' }}
            </h2>
          </div>

          <div v-if="!activeKnowledgeBase" class="empty-state knowledge-empty-state">
            <p>先从左上角打开仓库列表。</p>
            <span>选中一个仓库之后，这里才会显示对应笔记。</span>
            <button class="ghost-action knowledge-empty-action" type="button" @click="openKnowledgeDrawer">
              打开仓库列表
            </button>
          </div>

          <div v-else-if="activeKnowledgeNotes.length === 0" class="empty-state knowledge-empty-state">
            <p>这个仓库还没有笔记。</p>
            <span>点右下角的浮动按钮，先写下第一条知识记录。</span>
          </div>

          <div v-else class="knowledge-note-items">
            <button
              v-for="note in activeKnowledgeNotes"
              :key="note.id"
              type="button"
              class="knowledge-note-list-item"
              :class="{ active: selectedKnowledgeNoteId === note.id }"
              @click="selectKnowledgeNote(note)"
            >
              <span class="entry-time">
                {{ getDateGroupLabel(note.updatedAt) }} · {{ formatEntryTime(note.updatedAt) }}
              </span>
              <strong>{{ note.title }}</strong>
              <p>{{ note.content }}</p>
              <small v-if="note.tags.length > 0">{{ note.tags.join(' / ') }}</small>
            </button>
          </div>

          <button
            v-if="activeKnowledgeBase"
            class="knowledge-note-fab"
            type="button"
            aria-label="新增知识笔记"
            @click="startKnowledgeNoteComposer"
          >
            +
          </button>
        </section>

        <section class="knowledge-inspector" aria-labelledby="knowledge-inspector-title">
          <template v-if="!activeKnowledgeBase">
            <div class="empty-state knowledge-empty-state">
              <p>这里会显示仓库或笔记详情。</p>
              <span>先从左上角打开仓库列表，再选一条知识笔记。</span>
            </div>
          </template>

          <template v-else-if="knowledgeInspectorMode === 'note-create'">
            <div class="section-heading compact knowledge-pane-heading">
              <div>
                <p class="eyebrow">新笔记</p>
                <h2 id="knowledge-inspector-title">写入 {{ activeKnowledgeBase.name }}</h2>
              </div>
            </div>

            <input
              v-model="newKnowledgeNoteTitle"
              class="title-input"
              type="text"
              maxlength="80"
              placeholder="标题，可选"
              aria-label="知识记录标题"
            />
            <textarea
              v-model="newKnowledgeNoteContent"
              class="journal-input"
              placeholder="写下知识点、操作步骤、理解、坑点或结论。"
              rows="10"
            />
            <input
              v-model="newKnowledgeNoteSourceUrl"
              class="search-input compact-input"
              type="url"
              placeholder="来源链接，可选"
              aria-label="知识记录来源链接"
            />
            <input
              v-model="newKnowledgeNoteTags"
              class="search-input compact-input"
              type="text"
              placeholder="标签，可选，用逗号分隔"
              aria-label="知识记录标签"
            />
            <div class="entry-actions">
              <button class="ghost-action" type="button" @click="showKnowledgeBaseSummary">
                取消
              </button>
              <button
                class="primary-action small"
                type="button"
                :disabled="!canCreateKnowledgeNote"
                @click="saveNewKnowledgeNote"
              >
                保存笔记
              </button>
            </div>
          </template>

          <template v-else-if="knowledgeInspectorMode === 'note-edit' && selectedKnowledgeNote">
            <div class="section-heading compact knowledge-pane-heading">
              <div>
                <p class="eyebrow">编辑笔记</p>
                <h2 id="knowledge-inspector-title">{{ selectedKnowledgeNote.title }}</h2>
              </div>
            </div>

            <input
              v-model="editingKnowledgeNoteTitle"
              class="title-input"
              type="text"
              maxlength="80"
              aria-label="编辑知识记录标题"
            />
            <textarea
              v-model="editingKnowledgeNoteContent"
              class="journal-input edit-input"
              rows="10"
            />
            <input
              v-model="editingKnowledgeNoteSourceUrl"
              class="search-input compact-input"
              type="url"
              placeholder="来源链接，可选"
              aria-label="编辑知识记录来源链接"
            />
            <input
              v-model="editingKnowledgeNoteTags"
              class="search-input compact-input"
              type="text"
              placeholder="标签，用逗号分隔"
              aria-label="编辑知识记录标签"
            />
            <div class="entry-actions">
              <button class="ghost-action" type="button" @click="selectKnowledgeNote(selectedKnowledgeNote)">
                取消
              </button>
              <button
                class="primary-action small"
                type="button"
                :disabled="!canSaveKnowledgeNote"
                @click="saveKnowledgeNoteEditing"
              >
                保存修改
              </button>
            </div>
          </template>

          <template v-else-if="selectedKnowledgeNote">
            <div class="section-heading compact knowledge-pane-heading">
              <div>
                <p class="eyebrow">笔记详情</p>
                <h2 id="knowledge-inspector-title">{{ selectedKnowledgeNote.title }}</h2>
              </div>
              <span class="counter">{{ selectedKnowledgeNote.content.length }} 字</span>
            </div>

            <div class="knowledge-meta">
              <span>
                更新于
                {{ getDateGroupLabel(selectedKnowledgeNote.updatedAt) }}
                ·
                {{ formatEntryTime(selectedKnowledgeNote.updatedAt) }}
              </span>
              <span v-if="selectedKnowledgeNote.sourceUrl">带来源链接</span>
            </div>

            <div
              v-if="selectedKnowledgeNote.tags.length > 0"
              class="tag-row knowledge-detail-tags"
            >
              <span v-for="tag in selectedKnowledgeNote.tags" :key="tag">{{ tag }}</span>
            </div>

            <p
              class="knowledge-note-content"
              :data-reminder-target="`knowledge-note:${selectedKnowledgeNote.id}`"
              :class="{ 'has-reminder-target': isReminderHighlighted('knowledge-note', selectedKnowledgeNote.id) }"
              v-html="renderReminderHighlightedContent(selectedKnowledgeNote.content, 'knowledge-note', selectedKnowledgeNote.id)"
            ></p>

            <a
              v-if="selectedKnowledgeNote.sourceUrl"
              class="source-link"
              :href="selectedKnowledgeNote.sourceUrl"
              target="_blank"
              rel="noreferrer"
            >
              打开来源
            </a>

            <div class="entry-actions knowledge-detail-actions">
              <button class="delete-action" type="button" @click="removeKnowledgeNote(selectedKnowledgeNote)">
                删除
              </button>
              <div class="knowledge-inline-actions">
                <button class="ghost-action" type="button" @click="openKnowledgeReminderComposer(selectedKnowledgeNote)">
                  提醒
                </button>
                <button
                  class="primary-action small"
                  type="button"
                  @click="startKnowledgeNoteEditing(selectedKnowledgeNote)"
                >
                  编辑
                </button>
              </div>
            </div>
          </template>

          <template v-else-if="knowledgeInspectorMode === 'base-edit'">
            <div class="section-heading compact knowledge-pane-heading">
              <div>
                <p class="eyebrow">编辑仓库</p>
                <h2 id="knowledge-inspector-title">{{ activeKnowledgeBase.name }}</h2>
              </div>
            </div>

            <input
              v-model="editingKnowledgeBaseName"
              class="title-input"
              type="text"
              maxlength="40"
              aria-label="编辑知识库名称"
            />
            <textarea
              v-model="editingKnowledgeBaseDescription"
              class="journal-input knowledge-description-input"
              placeholder="知识库简介，可选"
              rows="5"
            />
            <input
              v-model="editingKnowledgeBaseTags"
              class="search-input compact-input"
              type="text"
              placeholder="标签，用逗号分隔"
              aria-label="编辑知识库标签"
            />
            <div class="entry-actions">
              <button class="delete-action" type="button" @click="removeKnowledgeBase(activeKnowledgeBase)">
                删除仓库
              </button>
              <div class="knowledge-inline-actions">
                <button class="ghost-action" type="button" @click="showKnowledgeBaseSummary">
                  取消
                </button>
                <button
                  class="primary-action small"
                  type="button"
                  :disabled="!canSaveKnowledgeBase"
                  @click="saveKnowledgeBaseDetails"
                >
                  保存仓库
                </button>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="empty-state knowledge-empty-state">
              <p>选择一条知识笔记。</p>
              <span>右侧只显示具体笔记内容；要新建笔记就点列表区右下角的按钮。</span>
            </div>
          </template>
        </section>
      </section>
    </section>

    <section
      v-else-if="activePark === 'lab'"
      class="lab-workspace"
      aria-label="做记工作区"
    >
      <button
        v-if="labDrawerOpen"
        class="knowledge-drawer-backdrop"
        type="button"
        aria-label="关闭项目导航"
        @click="closeLabDrawer"
      ></button>

      <aside
        id="lab-drawer"
        class="lab-sidebar"
        :class="{ open: labDrawerOpen }"
        aria-label="项目导航"
      >
        <div class="section-heading compact knowledge-pane-heading knowledge-drawer-heading">
          <div>
            <p class="eyebrow">项目</p>
            <h2>做记项目</h2>
          </div>
          <div class="knowledge-pane-actions">
            <span class="counter">{{ labProjects.length }} 项</span>
            <button class="ghost-action" type="button" @click="closeLabDrawer">
              关闭
            </button>
          </div>
        </div>

        <div v-if="labProjects.length === 0" class="empty-state knowledge-empty-state">
          <p>还没有项目。</p>
          <span>先建一个项目，再把操作过程和复盘记录收进来。</span>
        </div>

        <div v-else class="knowledge-base-list">
          <button
            v-for="project in labProjects"
            :key="project.id"
            type="button"
            :class="{ active: project.id === activeLabProjectId }"
            @click="selectLabProject(project.id)"
          >
            <strong>{{ project.name }}</strong>
            <span>{{ getLabRecordCount(project.id) }} 条记录</span>
            <small>
              {{ getDateGroupLabel(project.updatedAt) }} · {{ formatEntryTime(project.updatedAt) }}
            </small>
            <small v-if="project.tags.length > 0">{{ project.tags.join(' / ') }}</small>
          </button>
        </div>

        <div class="knowledge-sidebar-footer">
          <button
            v-if="activeLabProject"
            class="ghost-action knowledge-sidebar-manage"
            type="button"
            @click="startLabProjectEditing"
          >
            编辑当前项目
          </button>
          <button
            class="ghost-action knowledge-sidebar-add"
            type="button"
            @click="openLabProjectComposer"
          >
            添加新项目
          </button>
        </div>

        <form
          v-if="labProjectComposerOpen"
          class="knowledge-base-composer"
          @submit.prevent="saveNewLabProject"
        >
          <input
            v-model="newLabProjectName"
            class="title-input"
            type="text"
            maxlength="40"
            placeholder="项目名称，例如：Journal Agent iOS"
            aria-label="项目名称"
          />
          <textarea
            v-model="newLabProjectDescription"
            class="journal-input knowledge-description-input"
            placeholder="这个项目要推进什么？"
            rows="3"
          />
          <input
            v-model="newLabProjectTags"
            class="search-input compact-input"
            type="text"
            placeholder="标签，可选，用逗号分隔"
            aria-label="项目标签"
          />
          <div class="entry-actions">
            <button
              v-if="labProjects.length > 0"
              class="ghost-action"
              type="button"
              @click="closeLabProjectComposer"
            >
              取消
            </button>
            <button
              class="primary-action small"
              type="submit"
              :disabled="!canCreateLabProject"
            >
              保存项目
            </button>
          </div>
        </form>
      </aside>

      <section class="lab-shell" aria-label="做记项目工作台">
        <section class="lab-records-pane" aria-labelledby="lab-records-title">
          <div class="section-heading compact knowledge-pane-heading">
            <h2 id="lab-records-title">
              {{ activeLabProject ? activeLabProject.name : '选择项目' }}
            </h2>
          </div>

          <div v-if="!activeLabProject" class="empty-state knowledge-empty-state">
            <p>先从左上角打开项目列表。</p>
            <span>选中一个项目之后，这里才会显示对应的操作和复盘记录。</span>
            <button class="ghost-action knowledge-empty-action" type="button" @click="openLabDrawer">
              打开项目列表
            </button>
          </div>

          <div v-else-if="activeLabRecords.length === 0" class="empty-state knowledge-empty-state">
            <p>这个项目还没有记录。</p>
            <span>点右下角按钮，先补一条操作或复盘。</span>
          </div>

          <div v-else class="knowledge-note-items">
            <button
              v-for="record in activeLabRecords"
              :key="record.id"
              type="button"
              class="lab-record-list-item"
              :class="[
                { active: selectedLabRecordId === record.id },
                `is-${record.type}`,
              ]"
              @click="selectLabRecord(record)"
            >
              <div class="lab-record-list-header">
                <span class="entry-time">
                  {{ getDateGroupLabel(record.updatedAt) }} · {{ formatEntryTime(record.updatedAt) }}
                </span>
                <span class="record-type-pill" :class="`is-${record.type}`">
                  {{ getLabRecordTypeLabel(record.type) }}
                </span>
              </div>
              <strong>{{ record.title }}</strong>
              <p>{{ record.content }}</p>
              <small v-if="record.tags.length > 0">{{ record.tags.join(' / ') }}</small>
            </button>
          </div>

          <button
            v-if="activeLabProject"
            class="knowledge-note-fab"
            type="button"
            aria-label="新增项目记录"
            @click="startLabRecordComposer"
          >
            +
          </button>
        </section>

        <section class="lab-inspector" aria-labelledby="lab-inspector-title">
          <template v-if="!activeLabProject">
            <div class="empty-state knowledge-empty-state">
              <p>这里会显示项目概览或具体记录。</p>
              <span>先从左上角打开项目列表，再选一条项目记录。</span>
            </div>
          </template>

          <template v-else-if="labInspectorMode === 'record-create'">
            <div class="section-heading compact knowledge-pane-heading">
              <div>
                <p class="eyebrow">新记录</p>
                <h2 id="lab-inspector-title">写入 {{ activeLabProject.name }}</h2>
              </div>
            </div>

            <input
              v-model="newLabRecordTitle"
              class="title-input"
              type="text"
              maxlength="80"
              placeholder="标题，可选"
              aria-label="项目记录标题"
            />

            <div class="lab-type-switcher" aria-label="选择记录类型">
              <button
                v-for="type in labRecordTypeOptions"
                :key="type.value"
                type="button"
                class="lab-type-option"
                :class="[
                  { active: newLabRecordType === type.value },
                  `is-${type.value}`,
                ]"
                @click="newLabRecordType = type.value"
              >
                <strong>{{ type.label }}</strong>
                <span>{{ type.hint }}</span>
              </button>
            </div>

            <textarea
              v-model="newLabRecordContent"
              class="journal-input"
              placeholder="写下这次做了什么，或者这次复盘看到了什么。"
              rows="10"
            />
            <input
              v-model="newLabRecordTags"
              class="search-input compact-input"
              type="text"
              placeholder="标签，可选，用逗号分隔"
              aria-label="项目记录标签"
            />
            <div class="entry-actions">
              <button class="ghost-action" type="button" @click="showLabProjectSummary">
                取消
              </button>
              <button
                class="primary-action small"
                type="button"
                :disabled="!canCreateLabRecord"
                @click="saveNewLabRecord"
              >
                保存记录
              </button>
            </div>
          </template>

          <template v-else-if="labInspectorMode === 'record-edit' && selectedLabRecord">
            <div class="section-heading compact knowledge-pane-heading">
              <div>
                <p class="eyebrow">编辑记录</p>
                <h2 id="lab-inspector-title">{{ selectedLabRecord.title }}</h2>
              </div>
            </div>

            <input
              v-model="editingLabRecordTitle"
              class="title-input"
              type="text"
              maxlength="80"
              aria-label="编辑项目记录标题"
            />

            <div class="lab-type-switcher" aria-label="编辑记录类型">
              <button
                v-for="type in labRecordTypeOptions"
                :key="type.value"
                type="button"
                class="lab-type-option"
                :class="[
                  { active: editingLabRecordType === type.value },
                  `is-${type.value}`,
                ]"
                @click="editingLabRecordType = type.value"
              >
                <strong>{{ type.label }}</strong>
                <span>{{ type.hint }}</span>
              </button>
            </div>

            <textarea
              v-model="editingLabRecordContent"
              class="journal-input edit-input"
              rows="10"
            />
            <input
              v-model="editingLabRecordTags"
              class="search-input compact-input"
              type="text"
              placeholder="标签，用逗号分隔"
              aria-label="编辑项目记录标签"
            />
            <div class="entry-actions">
              <button class="ghost-action" type="button" @click="selectLabRecord(selectedLabRecord)">
                取消
              </button>
              <button
                class="primary-action small"
                type="button"
                :disabled="!canSaveLabRecord"
                @click="saveLabRecordEditing"
              >
                保存修改
              </button>
            </div>
          </template>

          <template v-else-if="selectedLabRecord">
            <div class="section-heading compact knowledge-pane-heading">
              <div>
                <p class="eyebrow">记录详情</p>
                <h2 id="lab-inspector-title">{{ selectedLabRecord.title }}</h2>
              </div>
              <span class="counter">{{ selectedLabRecord.content.length }} 字</span>
            </div>

            <div class="knowledge-meta">
              <span>
                更新于
                {{ getDateGroupLabel(selectedLabRecord.updatedAt) }}
                ·
                {{ formatEntryTime(selectedLabRecord.updatedAt) }}
              </span>
              <span class="record-type-pill" :class="`is-${selectedLabRecord.type}`">
                {{ getLabRecordTypeLabel(selectedLabRecord.type) }}
              </span>
            </div>

            <div
              v-if="selectedLabRecord.tags.length > 0"
              class="tag-row knowledge-detail-tags"
            >
              <span v-for="tag in selectedLabRecord.tags" :key="tag">{{ tag }}</span>
            </div>

            <p
              class="knowledge-note-content"
              :data-reminder-target="`lab-record:${selectedLabRecord.id}`"
              :class="{ 'has-reminder-target': isReminderHighlighted('lab-record', selectedLabRecord.id) }"
              v-html="renderReminderHighlightedContent(selectedLabRecord.content, 'lab-record', selectedLabRecord.id)"
            ></p>

            <div class="entry-actions knowledge-detail-actions">
              <button class="delete-action" type="button" @click="removeLabRecord(selectedLabRecord)">
                删除
              </button>
              <div class="knowledge-inline-actions">
                <button class="ghost-action" type="button" @click="openLabReminderComposer(selectedLabRecord)">
                  提醒
                </button>
                <button
                  class="primary-action small"
                  type="button"
                  @click="startLabRecordEditing(selectedLabRecord)"
                >
                  编辑
                </button>
              </div>
            </div>
          </template>

          <template v-else-if="labInspectorMode === 'project-edit'">
            <div class="section-heading compact knowledge-pane-heading">
              <div>
                <p class="eyebrow">编辑项目</p>
                <h2 id="lab-inspector-title">{{ activeLabProject.name }}</h2>
              </div>
            </div>

            <input
              v-model="editingLabProjectName"
              class="title-input"
              type="text"
              maxlength="40"
              aria-label="编辑项目名称"
            />
            <textarea
              v-model="editingLabProjectDescription"
              class="journal-input knowledge-description-input"
              placeholder="项目简介，可选"
              rows="5"
            />
            <input
              v-model="editingLabProjectTags"
              class="search-input compact-input"
              type="text"
              placeholder="标签，用逗号分隔"
              aria-label="编辑项目标签"
            />
            <div class="entry-actions">
              <button class="delete-action" type="button" @click="removeLabProject(activeLabProject)">
                删除项目
              </button>
              <div class="knowledge-inline-actions">
                <button class="ghost-action" type="button" @click="showLabProjectSummary">
                  取消
                </button>
                <button
                  class="primary-action small"
                  type="button"
                  :disabled="!canSaveLabProject"
                  @click="saveLabProjectDetails"
                >
                  保存项目
                </button>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="section-heading compact knowledge-pane-heading">
              <div>
                <p class="eyebrow">项目概览</p>
                <h2 id="lab-inspector-title">{{ activeLabProject.name }}</h2>
              </div>
              <span class="counter">{{ activeLabRecords.length }} 条</span>
            </div>

            <div class="knowledge-meta">
              <span>
                更新于
                {{ getDateGroupLabel(activeLabProject.updatedAt) }}
                ·
                {{ formatEntryTime(activeLabProject.updatedAt) }}
              </span>
              <span>绿色是操作，红色是复盘</span>
            </div>

            <div class="lab-project-stats">
              <div>
                <strong>{{ activeLabRecords.filter((record) => record.type === 'operation').length }}</strong>
                <span>操作</span>
              </div>
              <div>
                <strong>{{ activeLabRecords.filter((record) => record.type === 'review').length }}</strong>
                <span>复盘</span>
              </div>
            </div>

            <p class="knowledge-note-content lab-project-description">
              {{ activeLabProject.description || '这个项目还没有简介，你可以先补一句目标或阶段说明。' }}
            </p>

            <div
              v-if="activeLabProject.tags.length > 0"
              class="tag-row knowledge-detail-tags"
            >
              <span v-for="tag in activeLabProject.tags" :key="tag">{{ tag }}</span>
            </div>

            <div class="entry-actions knowledge-detail-actions">
              <button class="ghost-action" type="button" @click="startLabProjectEditing">
                编辑项目
              </button>
              <button class="primary-action small" type="button" @click="startLabRecordComposer">
                新增记录
              </button>
            </div>
          </template>
        </section>
      </section>
    </section>

    <section
      v-else-if="activePark === 'plan'"
      class="park-placeholder"
      aria-labelledby="plan-park-title"
    >
      <div class="section-heading">
        <div>
          <p class="eyebrow">后续 Park</p>
          <h2 id="plan-park-title">计划区</h2>
        </div>
        <span class="counter">规划中</span>
      </div>

      <div class="park-intro">
        <p>目标、计划、待办和周期回顾后续会放在这里，和日记、知识笔记分开。</p>
      </div>

      <div class="park-boundary-list" aria-label="计划区 Park 边界">
        <div>
          <strong>目标与计划</strong>
          <span>承载短期安排、长期目标和计划拆解。</span>
        </div>
        <div>
          <strong>后续关联</strong>
          <span>可以再和日记复盘、项目进度、Agent 提醒联动。</span>
        </div>
      </div>
    </section>

    <div
      v-if="reminderComposerOpen && reminderTarget"
      class="reminder-modal-backdrop"
      role="presentation"
    >
      <section
        class="reminder-modal"
        aria-labelledby="reminder-modal-title"
        aria-modal="true"
        role="dialog"
      >
        <header class="reminder-modal-header">
          <div>
            <p class="eyebrow">
              {{ reminderEditingId ? '修改提醒' : '新增提醒' }}
            </p>
            <h2 id="reminder-modal-title">系统定时提醒</h2>
          </div>
          <button class="panel-close" type="button" @click="closeReminderComposer">
            关闭
          </button>
        </header>

        <div class="reminder-target-card">
          <span>{{ getTargetTypeLabel(reminderTarget.type) }}</span>
          <strong>{{ reminderTarget.title }}</strong>
          <small>选中正文里的某句话后点“提醒”，会自动带入这里。</small>
        </div>

        <label class="reminder-field">
          <span>提醒标题</span>
          <input v-model="reminderTitle" type="text" maxlength="80" />
        </label>

        <label class="reminder-field">
          <span>提醒时间</span>
          <input
            v-model="reminderScheduledAt"
            type="datetime-local"
            :min="reminderMinDateTime"
          />
        </label>

        <label class="reminder-field">
          <span>定位到这句话，可选</span>
          <textarea
            v-model="reminderQuote"
            rows="3"
            placeholder="可以填入记录中的一句话；通知点击后会尝试高亮定位。"
          ></textarea>
        </label>

        <p v-if="reminderError" class="reminder-error">{{ reminderError }}</p>

        <div class="reminder-modal-actions">
          <button class="ghost-action" type="button" @click="closeReminderComposer">
            取消
          </button>
          <button
            class="primary-action small"
            type="button"
            :disabled="!canSaveReminder"
            @click="saveReminder"
          >
            {{ reminderIsSaving ? '保存中...' : '保存提醒' }}
          </button>
        </div>
      </section>
    </div>

    <div class="agent-layer">
      <button
        class="agent-fab"
        type="button"
        :aria-expanded="agentPanelOpen"
        aria-controls="agent-panel"
        @click="toggleAgentPanel"
      >
        <span class="anime-avatar" aria-hidden="true">
          <span class="avatar-hair"></span>
          <span class="avatar-face">
            <i></i>
            <i></i>
            <b></b>
          </span>
        </span>
        <span class="agent-fab-copy">Agent</span>
      </button>

      <section
        v-if="agentPanelOpen"
        id="agent-panel"
        class="agent-panel"
        aria-labelledby="agent-title"
      >
        <header class="agent-panel-header">
          <span class="anime-avatar compact" aria-hidden="true">
            <span class="avatar-hair"></span>
            <span class="avatar-face">
              <i></i>
              <i></i>
              <b></b>
            </span>
          </span>
          <div>
            <p class="eyebrow">{{ agentModeLabel }}</p>
            <h2 id="agent-title">{{ activeAgentConversationTitle }}</h2>
            <span>{{ agentModelLabel }}</span>
            <small>{{ agentJournalContext.statusLabel }}</small>
            <small>{{ agentRecordContext.statusLabel }}</small>
          </div>
          <div class="agent-header-actions">
            <button class="panel-close" type="button" @click="startNewAgentConversation">
              新对话
            </button>
            <button class="panel-close" type="button" aria-label="关闭 Agent 浮窗" @click="closeAgentPanel">
              关闭
            </button>
          </div>
        </header>

        <div class="agent-conversation-list" aria-label="Agent 历史对话">
          <button
            v-for="conversation in agentConversations"
            :key="conversation.id"
            type="button"
            :class="{ active: conversation.id === activeAgentConversationId }"
            @click="selectAgentConversation(conversation.id)"
          >
            <strong>{{ conversation.title }}</strong>
            <span>{{ conversation.messages.length }} 条消息</span>
          </button>
        </div>

        <div class="agent-messages" aria-live="polite">
          <article
            v-for="message in agentMessages"
            :key="message.id"
            class="agent-message"
            :class="message.role"
          >
            <span>{{ message.role === 'user' ? '你' : 'Agent' }}</span>
            <p>{{ message.content }}</p>
          </article>

          <article v-if="agentIsThinking" class="agent-message assistant">
            <span>Agent</span>
            <p>正在整理你的想法...</p>
          </article>
        </div>

        <form class="agent-composer" @submit.prevent="submitAgentMessage">
          <input
            v-model="agentInput"
            type="text"
            placeholder="问问今天该怎么整理，或让 Agent 帮你写三记..."
            aria-label="输入给 Agent 的消息"
          />
          <button type="submit" :disabled="!canSendAgentMessage">发送</button>
        </form>
      </section>
    </div>
  </main>
</template>
