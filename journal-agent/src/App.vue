<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  type CSSProperties,
} from 'vue';
import JournalWeatherHeroCard from './components/JournalWeatherHeroCard.vue';
import type { CalendarDay } from './utils/date';
import type { RecordBranch } from './types/branch';
import type { JournalEntry } from './types/journal';
import type { KnowledgeBase, KnowledgeNote } from './types/knowledge';
import type { LabProject, LabRecord, LabRecordType } from './types/lab';
import type { RecordImageAttachment } from './types/media';
import type { DailyJournalReminderSettings } from './types/dailyReminder';
import type { RecordReminder, ReminderTargetType } from './types/reminder';
import type { TodoMark, TodoParkType, TodoTargetType } from './types/todo';
import type { VaultEntry } from './types/vault';
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
  fetchWeatherSnapshot,
  resolveWeatherLocation,
  type WeatherSnapshot,
} from './services/weatherService';
import {
  appendAgentConversationMessage,
  createAgentConversation,
  getActiveAgentConversationId,
  getAgentConversations,
  setActiveAgentConversationId,
  type AgentConversation,
} from './storage/agentConversationStore';
import {
  cancelRemindersForTarget,
  createReminder,
  getActiveReminders,
  getReminderById,
  updateReminder,
} from './storage/reminderStore';
import {
  getDailyJournalReminderSettings,
  setDailyJournalReminderEnabled,
} from './storage/dailyReminderStore';
import {
  initializeVault,
  isVaultConfigured,
  isVaultFeatureSupported,
  saveVaultEntries,
  unlockVault,
  type VaultSession,
} from './storage/vaultStore';
import {
  completeTodo,
  createTodo,
  deleteDoneTodos,
  deleteTodo,
  deleteTodosForNote,
  deleteTodosForNotes,
  getTodos,
  reopenTodo,
  updateTodoDoneNote,
} from './storage/todoStore';
import {
  createEntry,
  deleteEntry,
  getEntries,
  setEntryFlagged,
  updateEntry,
} from './storage/journalStore';
import {
  archiveRecordBranch,
  createRecordBranch,
  deleteRecordBranch,
  getRecordBranches,
  unarchiveRecordBranch,
  updateRecordBranch,
} from './storage/branchStore';
import {
  MAX_PINNED_KNOWLEDGE_NOTES_PER_BASE,
  createKnowledgeBase,
  clearKnowledgeNoteBranchAssignments,
  createKnowledgeNote,
  deleteKnowledgeBase,
  deleteKnowledgeNote,
  getKnowledgeBases,
  getKnowledgeNotes,
  setKnowledgeNoteFlagged,
  setKnowledgeNotePinned,
  updateKnowledgeBase,
  updateKnowledgeNote,
} from './storage/knowledgeStore';
import {
  MAX_PINNED_LAB_RECORDS_PER_PROJECT,
  clearLabRecordBranchAssignments,
  createLabProject,
  createLabRecord,
  deleteLabProject,
  deleteLabRecord,
  getLabProjects,
  getLabRecords,
  setLabRecordFlagged,
  setLabRecordPinned,
  updateLabProject,
  updateLabRecord,
} from './storage/labStore';
import {
  cancelDailyJournalReminderNotification,
  cancelReminderNotification,
  listenForReminderNotificationActions,
  scheduleDailyJournalReminderNotification,
  scheduleReminderNotification,
} from './services/reminderNotifications';
import { createAnchor, resolveAnchor, type TextAnchor } from './utils/textAnchor';
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
import {
  MAX_BRANCH_DEPTH,
  flattenBranchTree,
  getBranchDepth,
  getBranchDescendantIds,
  getBranchPathLabel,
} from './utils/branchTree';
import { MAX_RECORD_IMAGES, importRecordImages } from './utils/recordImages';

type ActivePark = 'journal' | 'knowledge' | 'lab' | 'todo' | 'vault' | 'plan';
type ActiveView = 'timeline' | 'search' | 'calendar';
type TodoParkFilter = 'all' | TodoParkType;
type TodoQuickFilter = 'all' | 'reminder' | 'today';
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
type BranchFilterId = 'all' | 'ungrouped' | string;
type CardActionId = 'flag' | 'pin' | 'todo' | 'reminder' | 'edit' | 'delete';
type ImageImportTarget =
  | 'journal-draft'
  | 'journal-edit'
  | 'knowledge-create'
  | 'knowledge-edit'
  | 'lab-create'
  | 'lab-edit';

type CardActionMenuTarget =
  | {
      kind: 'journal';
      entryId: string;
    }
  | {
      kind: 'knowledge';
      noteId: string;
    }
  | {
      kind: 'lab';
      recordId: string;
    };

type ResolvedCardActionMenuTarget =
  | {
      kind: 'journal';
      record: JournalEntry;
    }
  | {
      kind: 'knowledge';
      record: KnowledgeNote;
    }
  | {
      kind: 'lab';
      record: LabRecord;
    };

interface CardActionMenuItem {
  id: CardActionId;
  label: string;
  tone?: 'danger';
}

interface CardActionMenuPlacement {
  top: number;
  left: number;
  transformOrigin: string;
}

interface ParkSummary {
  id: ActivePark;
  label: string;
  title: string;
  description: string;
}

interface ReminderTargetDraft {
  type: ReminderTargetType;
  id: string;
  parentId: string | null;
  title: string;
  content: string;
}

interface TodoTargetDraft {
  parkType: TodoParkType;
  noteId: string;
  title: string;
  content: string;
}

interface TodoSourceItem {
  todo: TodoMark;
  title: string;
  content: string;
  parkLabel: string;
  sourceLabel: string;
  createdLabel: string;
  hasReminder: boolean;
  isMissing: boolean;
}

interface BranchTreeItem {
  branch: RecordBranch;
  depth: number;
  itemCount: number;
  pathLabel: string;
}

interface SearchMatchRange {
  start: number;
  end: number;
}

interface JournalSearchResult {
  entry: JournalEntry;
  titleHtml: string;
  previewHtml: string;
  fullContentHtml: string;
  matchedTagsHtml: string[];
}

const LAB_RECORD_TYPE_META: Record<LabRecordType, { label: string }> = {
  operation: { label: '操作' },
  review: { label: '复盘' },
};
const AGENT_POSITION_STORAGE_KEY = 'journal-agent.agent.fab-position.v1';
const AGENT_FAB_SAFE_MARGIN = 16;
const AGENT_FAB_DEFAULT_WIDTH = 112;
const AGENT_FAB_DEFAULT_HEIGHT = 52;
const AGENT_DRAG_THRESHOLD = 6;
const BRANCH_UNGROUPED_VALUE = '__ungrouped__';
const SEARCH_KEYWORD_SPLIT_PATTERN = /[\s,，、/／]+/;
const SEARCH_EXCERPT_CONTEXT_LENGTH = 56;
const SEARCH_EXCERPT_FALLBACK_LENGTH = 120;
const WEATHER_REFRESH_INTERVAL = 30 * 60 * 1000;

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
const recordBranches = ref<RecordBranch[]>(getRecordBranches({ includeArchived: true }));
const reminders = ref<RecordReminder[]>(getActiveReminders());
const dailyJournalReminder = ref<DailyJournalReminderSettings>(
  getDailyJournalReminderSettings(),
);
const todos = ref<TodoMark[]>(getTodos());
const vaultConfigured = ref(isVaultConfigured());
const vaultCryptoSupported = isVaultFeatureSupported();
const vaultEntries = ref<VaultEntry[]>([]);
const vaultSession = ref<VaultSession | null>(null);
const activePark = ref<ActivePark>('journal');
const activeView = ref<ActiveView>('timeline');
const journalWeatherSnapshot = ref<WeatherSnapshot | null>(null);
const journalWeatherLoading = ref(false);
const journalWeatherStatusMessage = ref('Open-Meteo · 正在获取天气');
const journalWeatherLastLoadedAt = ref<number | null>(null);
const draftTitle = ref('');
const draftContent = ref('');
const draftEntryDate = ref(getLocalDateKey(new Date()));
const draftImages = ref<RecordImageAttachment[]>([]);
const editingId = ref<string | null>(null);
const editingContent = ref('');
const editingEntryDate = ref('');
const editingImages = ref<RecordImageAttachment[]>([]);
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
const activeKnowledgeBranchFilterId = ref<BranchFilterId>('all');
const knowledgeBranchPanelOpen = ref(false);
const knowledgeArchivedBranchesOpen = ref(false);
const knowledgeInspectorMode = ref<KnowledgeInspectorMode>('base');
const newKnowledgeNoteTitle = ref('');
const newKnowledgeNoteContent = ref('');
const newKnowledgeNoteSourceUrl = ref('');
const newKnowledgeNoteTags = ref('');
const newKnowledgeNoteBranchValue = ref(BRANCH_UNGROUPED_VALUE);
const newKnowledgeNoteImages = ref<RecordImageAttachment[]>([]);
const editingKnowledgeNoteId = ref<string | null>(null);
const editingKnowledgeNoteTitle = ref('');
const editingKnowledgeNoteContent = ref('');
const editingKnowledgeNoteSourceUrl = ref('');
const editingKnowledgeNoteTags = ref('');
const editingKnowledgeNoteBranchValue = ref(BRANCH_UNGROUPED_VALUE);
const editingKnowledgeNoteImages = ref<RecordImageAttachment[]>([]);
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
const activeLabBranchFilterId = ref<BranchFilterId>('all');
const labBranchPanelOpen = ref(false);
const labArchivedBranchesOpen = ref(false);
const labInspectorMode = ref<LabInspectorMode>('project');
const newLabRecordTitle = ref('');
const newLabRecordContent = ref('');
const newLabRecordType = ref<LabRecordType>('operation');
const newLabRecordTags = ref('');
const newLabRecordBranchValue = ref(BRANCH_UNGROUPED_VALUE);
const newLabRecordImages = ref<RecordImageAttachment[]>([]);
const editingLabRecordId = ref<string | null>(null);
const editingLabRecordTitle = ref('');
const editingLabRecordContent = ref('');
const editingLabRecordType = ref<LabRecordType>('operation');
const editingLabRecordTags = ref('');
const editingLabRecordBranchValue = ref(BRANCH_UNGROUPED_VALUE);
const editingLabRecordImages = ref<RecordImageAttachment[]>([]);
const searchQuery = ref('');
const searchInputRef = ref<HTMLInputElement | null>(null);
const imageImportInputRef = ref<HTMLInputElement | null>(null);
const calendarMonth = ref(startOfMonth(new Date()));
const selectedDateKey = ref(getLocalDateKey(new Date()));
const agentPanelOpen = ref(false);
const agentFabRef = ref<HTMLElement | null>(null);
const agentPositionReady = ref(false);
const agentViewportSize = ref({
  width: typeof window === 'undefined' ? 0 : window.innerWidth,
  height: typeof window === 'undefined' ? 0 : window.innerHeight,
});
const agentFabPosition = ref({ x: 0, y: 0 });
const agentDragState = ref<{
  pointerId: number;
  startX: number;
  startY: number;
  initialX: number;
  initialY: number;
  moved: boolean;
} | null>(null);
const agentSuppressClick = ref(false);
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
const dailyJournalReminderStatusMessage = ref('');
const dailyJournalReminderIsSaving = ref(false);
const highlightedReminderTarget = ref<{
  targetType: ReminderTargetType;
  targetId: string;
  quote: string;
} | null>(null);
const recordImagePreview = ref<RecordImageAttachment | null>(null);
const pendingImageImportTarget = ref<ImageImportTarget | null>(null);
const imageImportBusyTarget = ref<ImageImportTarget | null>(null);
const highlightedTodoId = ref<string | null>(null);
const expandedJournalEntryIds = ref<Set<string>>(new Set());
const cardActionMenuTarget = ref<CardActionMenuTarget | null>(null);
const cardActionMenuAnchorElement = ref<HTMLElement | null>(null);
const cardActionMenuPanel = ref<HTMLElement | null>(null);
const cardActionMenuPlacement = ref<CardActionMenuPlacement | null>(null);
const todoStatusMessage = ref('');
const todoCompletionDraft = ref<TodoMark | null>(null);
const todoCompletionNote = ref('');
const todoCompletionTimer = ref<number | null>(null);
const journalCompletedOpen = ref(false);
const selectedDateCompletedOpen = ref(false);
const labCompletedOpen = ref(false);
const globalCompletedOpen = ref(false);
const hideDoneSentenceTodos = ref(false);
const expandedHiddenTodoIds = ref<Set<string>>(new Set());
const todoParkFilter = ref<TodoParkFilter>('all');
const todoQuickFilter = ref<TodoQuickFilter>('all');
const cachedTodoSelection = ref<{
  parkType: TodoParkType;
  noteId: string;
  text: string;
  anchor: TextAnchor;
  capturedAt: number;
} | null>(null);
const vaultStatusMessage = ref('');
const vaultIsBusy = ref(false);
const vaultSetupPassword = ref('');
const vaultSetupPasswordConfirm = ref('');
const vaultUnlockPassword = ref('');
const editingVaultEntryId = ref<string | null>(null);
const vaultEntryTitle = ref('');
const vaultEntryAccount = ref('');
const vaultEntryPassword = ref('');
const vaultEntryWebsite = ref('');
const vaultEntryNote = ref('');
const revealedVaultEntryIds = ref<Set<string>>(new Set());

const visibleJournalEntries = computed(() =>
  entries.value.filter((entry) => !isCardTodoDone('journal', entry.id)),
);

const groupedEntries = computed(() => groupEntriesByDate(visibleJournalEntries.value));

const completedJournalEntryItems = computed(() =>
  entries.value
    .map((entry) => ({
      entry,
      todo: getCardTodo('journal', entry.id),
    }))
    .filter(
      (item): item is { entry: JournalEntry; todo: TodoMark } =>
        item.todo?.status === 'done',
    )
    .sort((firstItem, secondItem) => (secondItem.todo.doneAt ?? 0) - (firstItem.todo.doneAt ?? 0)),
);

const entryCountByDate = computed(() => {
  const counts = new Map<string, number>();

  for (const entry of entries.value) {
    const key = getJournalEntryDateKey(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
});

const activeKnowledgeBase = computed(
  () =>
    knowledgeBases.value.find((base) => base.id === activeKnowledgeBaseId.value) ??
    null,
);

const activeKnowledgeBaseBranches = computed(() => {
  const baseId = activeKnowledgeBase.value?.id;

  if (!baseId) {
    return [];
  }

  return recordBranches.value.filter(
    (branch) =>
      branch.parkType === 'knowledge' && branch.containerId === baseId,
  );
});

const activeKnowledgeBranches = computed(() =>
  activeKnowledgeBaseBranches.value.filter((branch) => branch.archivedAt === null),
);

const archivedKnowledgeBranches = computed(() =>
  activeKnowledgeBaseBranches.value.filter((branch) => branch.archivedAt !== null),
);

const activeKnowledgeBaseNotes = computed(() => {
  const baseId = activeKnowledgeBase.value?.id;

  if (!baseId) {
    return [];
  }

  return knowledgeNotes.value.filter((note) => note.baseId === baseId);
});

const activeKnowledgeNotes = computed(() =>
  activeKnowledgeBaseNotes.value.filter((note) =>
    matchesBranchFilter(
      note.branchId,
      activeKnowledgeBranches.value,
      activeKnowledgeBranchFilterId.value,
    ),
  ),
);

const activeKnowledgePinnedCount = computed(
  () => activeKnowledgeBaseNotes.value.filter((note) => note.pinnedAt !== null).length,
);

const knowledgeBranchTreeItems = computed(() =>
  buildBranchTreeItems(
    activeKnowledgeBranches.value,
    activeKnowledgeBaseNotes.value.map((note) => note.branchId),
  ),
);

const selectedKnowledgeBranch = computed(
  () =>
    activeKnowledgeBranches.value.find(
      (branch) => branch.id === activeKnowledgeBranchFilterId.value,
    ) ?? null,
);

const selectedKnowledgeNote = computed(
  () =>
    activeKnowledgeBaseNotes.value.find(
      (note) => note.id === selectedKnowledgeNoteId.value,
    ) ?? null,
);
const showKnowledgeInspector = computed(() => {
  if (!activeKnowledgeBase.value) {
    return true;
  }

  return (
    knowledgeInspectorMode.value === 'base' ||
    knowledgeInspectorMode.value === 'base-edit' ||
    knowledgeInspectorMode.value === 'note-create'
  );
});

const knowledgeBranchSelectOptions = computed(() =>
  buildBranchSelectOptions(
    activeKnowledgeBranches.value,
    activeKnowledgeBaseBranches.value,
    selectedKnowledgeNote.value?.branchId ?? null,
  ),
);

const activeLabProject = computed(
  () =>
    labProjects.value.find((project) => project.id === activeLabProjectId.value) ??
    null,
);

const activeLabProjectBranches = computed(() => {
  const projectId = activeLabProject.value?.id;

  if (!projectId) {
    return [];
  }

  return recordBranches.value.filter(
    (branch) => branch.parkType === 'lab' && branch.containerId === projectId,
  );
});

const activeLabBranches = computed(() =>
  activeLabProjectBranches.value.filter((branch) => branch.archivedAt === null),
);

const archivedLabBranches = computed(() =>
  activeLabProjectBranches.value.filter((branch) => branch.archivedAt !== null),
);

const activeLabProjectRecords = computed(() => {
  const projectId = activeLabProject.value?.id;

  if (!projectId) {
    return [];
  }

  return labRecords.value.filter((record) => record.projectId === projectId);
});

const activeLabRecords = computed(() =>
  activeLabProjectRecords.value.filter((record) =>
    matchesBranchFilter(
      record.branchId,
      activeLabBranches.value,
      activeLabBranchFilterId.value,
    ),
  ),
);

const activeLabPinnedCount = computed(
  () => activeLabProjectRecords.value.filter((record) => record.pinnedAt !== null).length,
);

const labBranchTreeItems = computed(() =>
  buildBranchTreeItems(
    activeLabBranches.value,
    activeLabProjectRecords.value.map((record) => record.branchId),
  ),
);

const selectedLabBranch = computed(
  () =>
    activeLabBranches.value.find(
      (branch) => branch.id === activeLabBranchFilterId.value,
    ) ?? null,
);

const activeOpenLabRecords = computed(() =>
  activeLabRecords.value.filter((record) => !isCardTodoDone('project', record.id)),
);

const activeCompletedLabRecordItems = computed(() =>
  activeLabRecords.value
    .map((record) => ({
      record,
      todo: getCardTodo('project', record.id),
    }))
    .filter(
      (item): item is { record: LabRecord; todo: TodoMark } =>
        item.todo?.status === 'done',
    )
    .sort((firstItem, secondItem) => {
      const firstPinned = isPinned(firstItem.record.pinnedAt);
      const secondPinned = isPinned(secondItem.record.pinnedAt);

      if (firstPinned !== secondPinned) {
        return firstPinned ? -1 : 1;
      }

      return (secondItem.todo.doneAt ?? 0) - (firstItem.todo.doneAt ?? 0);
    }),
);

const selectedLabRecord = computed(
  () =>
    activeLabProjectRecords.value.find(
      (record) => record.id === selectedLabRecordId.value,
    ) ??
    null,
);
const showLabInspector = computed(() => {
  if (!activeLabProject.value) {
    return true;
  }

  return (
    labInspectorMode.value === 'project' ||
    labInspectorMode.value === 'project-edit' ||
    labInspectorMode.value === 'record-create'
  );
});

const resolvedCardActionMenuTarget = computed<ResolvedCardActionMenuTarget | null>(() => {
  const activeTarget = cardActionMenuTarget.value;

  if (!activeTarget) {
    return null;
  }

  if (activeTarget.kind === 'journal') {
    const record = entries.value.find((entry) => entry.id === activeTarget.entryId) ?? null;

    return record
      ? {
          kind: 'journal',
          record,
        }
      : null;
  }

  if (activeTarget.kind === 'knowledge') {
    const record = knowledgeNotes.value.find((note) => note.id === activeTarget.noteId) ?? null;

    return record
      ? {
          kind: 'knowledge',
          record,
        }
      : null;
  }

  const record = labRecords.value.find((item) => item.id === activeTarget.recordId) ?? null;

  return record
    ? {
        kind: 'lab',
        record,
      }
    : null;
});

const cardActionMenuTitle = computed(() => {
  const target = resolvedCardActionMenuTarget.value;

  if (!target) {
    return '';
  }

  return target.record.title || '未命名记录';
});

const cardActionMenuStyle = computed<CSSProperties>(() => {
  const placement = cardActionMenuPlacement.value;

  if (!placement) {
    return {
      visibility: 'hidden',
      pointerEvents: 'none',
    };
  }

  return {
    top: `${placement.top}px`,
    left: `${placement.left}px`,
    transformOrigin: placement.transformOrigin,
  };
});

const cardActionMenuItems = computed<CardActionMenuItem[]>(() => {
  const target = resolvedCardActionMenuTarget.value;

  if (!target) {
    return [];
  }

  if (target.kind === 'journal') {
    const cardTodo = getCardTodo('journal', target.record.id);

    return [
      {
        id: 'flag',
        label: isFlagged(target.record.flaggedAt) ? '取消 Flag' : 'Flag',
      },
      {
        id: 'todo',
        label:
          cardTodo === null
            ? '待办'
            : cardTodo.status === 'open'
              ? '取消待办'
              : '恢复待办',
      },
      {
        id: 'reminder',
        label: '提醒',
      },
      {
        id: 'edit',
        label: '编辑',
      },
      {
        id: 'delete',
        label: '删除',
        tone: 'danger',
      },
    ];
  }

  if (target.kind === 'knowledge') {
    return [
      {
        id: 'flag',
        label: isFlagged(target.record.flaggedAt) ? '取消 Flag' : 'Flag',
      },
      {
        id: 'pin',
        label: isPinned(target.record.pinnedAt) ? '取消置顶' : '置顶',
      },
      {
        id: 'reminder',
        label: '提醒',
      },
      {
        id: 'edit',
        label: '编辑',
      },
      {
        id: 'delete',
        label: '删除',
        tone: 'danger',
      },
    ];
  }

  const cardTodo = getCardTodo('project', target.record.id);

  return [
    {
      id: 'flag',
      label: isFlagged(target.record.flaggedAt) ? '取消 Flag' : 'Flag',
    },
    {
      id: 'pin',
      label: isPinned(target.record.pinnedAt) ? '取消置顶' : '置顶',
    },
    {
      id: 'todo',
      label:
        cardTodo === null
          ? '待办'
          : cardTodo.status === 'open'
            ? '取消待办'
            : '恢复待办',
    },
    {
      id: 'reminder',
      label: '提醒',
    },
    {
      id: 'edit',
      label: '编辑',
    },
    {
      id: 'delete',
      label: '删除',
      tone: 'danger',
    },
  ];
});

const labBranchSelectOptions = computed(() =>
  buildBranchSelectOptions(
    activeLabBranches.value,
    activeLabProjectBranches.value,
    selectedLabRecord.value?.branchId ?? null,
  ),
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
const isVaultUnlocked = computed(() => vaultSession.value !== null);
const vaultEntryCount = computed(() => vaultEntries.value.length);
const vaultLockStatusLabel = computed(() => {
  if (!vaultConfigured.value) {
    return '未设置';
  }

  return isVaultUnlocked.value ? '已解锁' : '已上锁';
});
const canCreateVault = computed(
  () =>
    vaultCryptoSupported &&
    vaultSetupPassword.value.trim().length >= 4 &&
    vaultSetupPassword.value === vaultSetupPasswordConfirm.value,
);
const canUnlockVault = computed(
  () => vaultCryptoSupported && vaultUnlockPassword.value.trim().length > 0,
);
const canSaveVaultEntry = computed(
  () =>
    isVaultUnlocked.value &&
    vaultEntryTitle.value.trim().length > 0 &&
    vaultEntryAccount.value.trim().length > 0 &&
    vaultEntryPassword.value.trim().length > 0,
);

const parkSummaries = computed<ParkSummary[]>(() => [
  {
    id: 'journal',
    label: '心记',
    title: '心记',
    description: formatTodayHeader(),
  },
  {
    id: 'knowledge',
    label: '笔记',
    title: '笔记',
    description: '学习库和知识记录会放在这里，不混入日记时间线。',
  },
  {
    id: 'lab',
    label: '做记',
    title: '做记',
    description: '项目操作和阶段复盘会按项目沉淀在这里。',
  },
  {
    id: 'todo',
    label: '✓ 待办',
    title: '我的待办',
    description: '从心记和做记里自然长出的行动项。',
  },
  {
    id: 'vault',
    label: '密库',
    title: '密库',
    description: vaultConfigured.value
      ? isVaultUnlocked.value
        ? '本地加密保存账号与密码；离开后会自动重新上锁。'
        : '本地加密保存账号与密码；进入前需要先解锁。'
      : '先设置一个解锁密码，再把项目账号和密码收进来。',
  },
]);

const activeParkSummary = computed(
  () =>
    parkSummaries.value.find((park) => park.id === activePark.value) ??
    parkSummaries.value[0],
);
const journalWeatherMetaText = computed(() => {
  if (journalWeatherSnapshot.value && !journalWeatherStatusMessage.value) {
    return [
      journalWeatherSnapshot.value.locationSourceLabel,
      journalWeatherSnapshot.value.updatedLabel,
    ].join(' · ');
  }

  return journalWeatherStatusMessage.value;
});

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
      activeKnowledgeBranchFilterId: activeKnowledgeBranchFilterId.value,
      selectedKnowledgeNoteId: selectedKnowledgeNote.value?.id ?? null,
      activeLabProjectId: activeLabProject.value?.id ?? null,
      activeLabBranchFilterId: activeLabBranchFilterId.value,
      selectedLabRecordId: selectedLabRecord.value?.id ?? null,
    },
  );
});
const canSendAgentMessage = computed(
  () => agentInput.value.trim().length > 0 && !agentIsThinking.value,
);
const agentLayerStyle = computed<CSSProperties>(() => ({
  left: `${agentFabPosition.value.x}px`,
  top: `${agentFabPosition.value.y}px`,
  visibility: agentPositionReady.value ? 'visible' : 'hidden',
}));
const agentLayerClasses = computed(() => ({
  'opens-up': agentFabPosition.value.y > agentViewportSize.value.height * 0.48,
  'opens-down': agentFabPosition.value.y <= agentViewportSize.value.height * 0.48,
  'align-right': agentFabPosition.value.x > agentViewportSize.value.width * 0.5,
  'align-left': agentFabPosition.value.x <= agentViewportSize.value.width * 0.5,
  'is-dragging': Boolean(agentDragState.value?.moved),
}));
const activeReminders = computed(() =>
  reminders.value.filter(
    (reminder) =>
      reminder.canceledAt === null &&
      new Date(reminder.scheduledAt).getTime() > Date.now(),
  ),
);
const todoSourceItems = computed(() =>
  todos.value.map((todo) => resolveTodoSource(todo)).filter((item) => !item.isMissing),
);
const filteredOpenTodoItems = computed(() =>
  todoSourceItems.value.filter(
    (item) =>
      item.todo.status === 'open' &&
      matchesTodoParkFilter(item.todo) &&
      matchesTodoQuickFilter(item),
  ),
);
const filteredDoneTodoItems = computed(() =>
  todoSourceItems.value
    .filter(
      (item) =>
        item.todo.status === 'done' &&
        matchesTodoParkFilter(item.todo) &&
        matchesTodoQuickFilter(item),
    )
    .sort((firstItem, secondItem) => (secondItem.todo.doneAt ?? 0) - (firstItem.todo.doneAt ?? 0)),
);
const reminderMinDateTime = computed(() =>
  toDateTimeLocalInputValue(new Date(Date.now() + 60_000)),
);
const dailyJournalReminderTimeLabel = computed(() =>
  formatClockTimeLabel(
    dailyJournalReminder.value.hour,
    dailyJournalReminder.value.minute,
  ),
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

const searchKeywords = computed(() => buildSearchKeywords(searchQuery.value));

const searchableJournalEntries = computed(() =>
  visibleJournalEntries.value.map((entry) => ({
    entry,
    searchableText: normalizeSearchText([entry.title, entry.content, ...entry.tags].join('\n')),
  })),
);

const searchResults = computed(() => {
  const keywords = searchKeywords.value;

  if (keywords.length === 0) {
    return [];
  }

  return searchableJournalEntries.value.reduce<JournalSearchResult[]>((results, item) => {
    if (!keywords.every((keyword) => item.searchableText.includes(keyword))) {
      return results;
    }

    results.push(buildJournalSearchResult(item.entry, keywords));
    return results;
  }, []);
});

const calendarDays = computed(() => buildCalendarDays(calendarMonth.value));
const currentMonthTitle = computed(() => formatMonthTitle(calendarMonth.value));

const selectedDateEntries = computed(() =>
  visibleJournalEntries.value.filter(
    (entry) => getJournalEntryDateKey(entry) === selectedDateKey.value,
  ),
);

const selectedDateCompletedEntryItems = computed(() =>
  completedJournalEntryItems.value.filter(
    (item) => getJournalEntryDateKey(item.entry) === selectedDateKey.value,
  ),
);

const selectedDateLabel = computed(() => {
  return formatJournalDateKeyLabel(selectedDateKey.value);
});

function clearSearchQuery() {
  searchQuery.value = '';

  nextTick(() => {
    searchInputRef.value?.focus();
  });
}

function getImagesForTarget(target: ImageImportTarget): RecordImageAttachment[] {
  switch (target) {
    case 'journal-draft':
      return draftImages.value;
    case 'journal-edit':
      return editingImages.value;
    case 'knowledge-create':
      return newKnowledgeNoteImages.value;
    case 'knowledge-edit':
      return editingKnowledgeNoteImages.value;
    case 'lab-create':
      return newLabRecordImages.value;
    case 'lab-edit':
      return editingLabRecordImages.value;
  }
}

function setImagesForTarget(target: ImageImportTarget, images: RecordImageAttachment[]) {
  switch (target) {
    case 'journal-draft':
      draftImages.value = images;
      return;
    case 'journal-edit':
      editingImages.value = images;
      return;
    case 'knowledge-create':
      newKnowledgeNoteImages.value = images;
      return;
    case 'knowledge-edit':
      editingKnowledgeNoteImages.value = images;
      return;
    case 'lab-create':
      newLabRecordImages.value = images;
      return;
    case 'lab-edit':
      editingLabRecordImages.value = images;
  }
}

function isImportingImages(target: ImageImportTarget): boolean {
  return imageImportBusyTarget.value === target;
}

function openImageImporter(target: ImageImportTarget) {
  if (imageImportBusyTarget.value) {
    return;
  }

  pendingImageImportTarget.value = target;

  if (imageImportInputRef.value) {
    imageImportInputRef.value.value = '';
    imageImportInputRef.value.click();
  }
}

function removeImportedImage(target: ImageImportTarget, imageId: string) {
  setImagesForTarget(
    target,
    getImagesForTarget(target).filter((image) => image.id !== imageId),
  );
}

async function handleImageImportChange(event: Event) {
  const target = pendingImageImportTarget.value;
  const input = event.target;

  if (!target || !(input instanceof HTMLInputElement)) {
    return;
  }

  const files = Array.from(input.files ?? []);

  if (files.length === 0) {
    pendingImageImportTarget.value = null;
    return;
  }

  imageImportBusyTarget.value = target;

  try {
    const { images, warnings } = await importRecordImages(files);
    const existingImages = getImagesForTarget(target);
    const availableSlots = Math.max(0, MAX_RECORD_IMAGES - existingImages.length);
    const acceptedImages = images.slice(0, availableSlots);

    if (acceptedImages.length > 0) {
      setImagesForTarget(target, [...existingImages, ...acceptedImages]);
    }

    if (images.length > acceptedImages.length) {
      warnings.push(`单条记录最多保留 ${MAX_RECORD_IMAGES} 张图片，多出的图片已跳过。`);
    }

    if (warnings.length > 0) {
      window.alert(warnings.join('\n'));
    }
  } finally {
    imageImportBusyTarget.value = null;
    pendingImageImportTarget.value = null;
    input.value = '';
  }
}

function openRecordImagePreview(image: RecordImageAttachment) {
  recordImagePreview.value = image;
}

function closeRecordImagePreview() {
  recordImagePreview.value = null;
}

function refreshEntries() {
  entries.value = getEntries();
}

function refreshReminders() {
  reminders.value = getActiveReminders();
}

function refreshDailyJournalReminder() {
  dailyJournalReminder.value = getDailyJournalReminderSettings();
}

function refreshTodos() {
  todos.value = getTodos();
}

function sortVaultItems(items: VaultEntry[]): VaultEntry[] {
  return [...items].sort(
    (firstItem, secondItem) =>
      new Date(secondItem.updatedAt).getTime() - new Date(firstItem.updatedAt).getTime(),
  );
}

function createVaultEntryId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `vault-entry-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function resetVaultEntryDraft() {
  editingVaultEntryId.value = null;
  vaultEntryTitle.value = '';
  vaultEntryAccount.value = '';
  vaultEntryPassword.value = '';
  vaultEntryWebsite.value = '';
  vaultEntryNote.value = '';
}

function lockVault(message = '') {
  vaultSession.value = null;
  vaultEntries.value = [];
  vaultUnlockPassword.value = '';
  revealedVaultEntryIds.value = new Set();
  resetVaultEntryDraft();

  if (message) {
    vaultStatusMessage.value = message;
  }
}

async function persistVaultItems(
  nextItems: VaultEntry[],
  successMessage: string,
): Promise<boolean> {
  if (!vaultSession.value) {
    vaultStatusMessage.value = '请先解锁密库。';
    return false;
  }

  vaultIsBusy.value = true;

  try {
    const didSave = await saveVaultEntries(nextItems, vaultSession.value);

    if (!didSave) {
      vaultStatusMessage.value = '密库保存失败，请稍后再试。';
      return false;
    }

    vaultEntries.value = sortVaultItems(nextItems);
    vaultConfigured.value = isVaultConfigured();
    vaultStatusMessage.value = successMessage;
    return true;
  } finally {
    vaultIsBusy.value = false;
  }
}

function startVaultEntryEditing(entry: VaultEntry) {
  editingVaultEntryId.value = entry.id;
  vaultEntryTitle.value = entry.title;
  vaultEntryAccount.value = entry.account;
  vaultEntryPassword.value = entry.password;
  vaultEntryWebsite.value = entry.website ?? '';
  vaultEntryNote.value = entry.note ?? '';
}

function cancelVaultEntryEditing() {
  resetVaultEntryDraft();
}

async function saveVaultEntryDraft() {
  if (!canSaveVaultEntry.value || vaultIsBusy.value) {
    return;
  }

  const now = new Date().toISOString();
  const title = vaultEntryTitle.value.trim().slice(0, 80);
  const account = vaultEntryAccount.value.trim().slice(0, 160);
  const password = vaultEntryPassword.value.trim().slice(0, 200);
  const website = vaultEntryWebsite.value.trim().slice(0, 200);
  const note = vaultEntryNote.value.trim().slice(0, 500);
  const existingEntryId = editingVaultEntryId.value;
  const nextItems = existingEntryId
    ? vaultEntries.value.map((entry) =>
        entry.id === existingEntryId
          ? {
              ...entry,
              title,
              account,
              password,
              website: website || undefined,
              note: note || undefined,
              updatedAt: now,
            }
          : entry,
      )
    : [
        {
          id: createVaultEntryId(),
          title,
          account,
          password,
          website: website || undefined,
          note: note || undefined,
          createdAt: now,
          updatedAt: now,
        },
        ...vaultEntries.value,
      ];

  const didSave = await persistVaultItems(
    nextItems,
    existingEntryId ? '密码卡片已更新。' : '密码卡片已保存。',
  );

  if (didSave) {
    resetVaultEntryDraft();
  }
}

async function removeVaultEntry(entry: VaultEntry) {
  const shouldDelete = window.confirm(`删除「${entry.title}」这张密码卡片？`);

  if (!shouldDelete) {
    return;
  }

  const didSave = await persistVaultItems(
    vaultEntries.value.filter((item) => item.id !== entry.id),
    '密码卡片已删除。',
  );

  if (didSave && editingVaultEntryId.value === entry.id) {
    resetVaultEntryDraft();
  }
}

function toggleVaultPasswordVisibility(entryId: string) {
  const nextIds = new Set(revealedVaultEntryIds.value);

  if (nextIds.has(entryId)) {
    nextIds.delete(entryId);
  } else {
    nextIds.add(entryId);
  }

  revealedVaultEntryIds.value = nextIds;
}

function isVaultPasswordVisible(entryId: string): boolean {
  return revealedVaultEntryIds.value.has(entryId);
}

function getVaultPasswordDisplay(entry: VaultEntry): string {
  return isVaultPasswordVisible(entry.id) ? entry.password : '••••••••';
}

async function copyTextToClipboard(value: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the legacy selection-based copy path.
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const didCopy = document.execCommand('copy');
    document.body.removeChild(textarea);
    return didCopy;
  } catch {
    return false;
  }
}

async function copyVaultField(value: string, label: '账号' | '密码') {
  if (!value.trim()) {
    vaultStatusMessage.value = `没有可复制的${label}。`;
    return;
  }

  const didCopy = await copyTextToClipboard(value);
  vaultStatusMessage.value = didCopy
    ? `${label}已复制。`
    : `${label}复制失败，请稍后再试。`;
}

async function submitVaultSetup() {
  if (!vaultCryptoSupported) {
    vaultStatusMessage.value = '当前环境不支持本地加密密库。';
    return;
  }

  if (vaultSetupPassword.value.trim().length < 4) {
    vaultStatusMessage.value = '请设置至少 4 位的解锁密码。';
    return;
  }

  if (vaultSetupPassword.value !== vaultSetupPasswordConfirm.value) {
    vaultStatusMessage.value = '两次输入的解锁密码不一致。';
    return;
  }

  vaultIsBusy.value = true;

  try {
    const result = await initializeVault(vaultSetupPassword.value);

    if (!result) {
      vaultStatusMessage.value = '密库初始化失败，请稍后再试。';
      return;
    }

    vaultSession.value = result.session;
    vaultEntries.value = sortVaultItems(result.entries);
    vaultConfigured.value = true;
    vaultSetupPassword.value = '';
    vaultSetupPasswordConfirm.value = '';
    vaultUnlockPassword.value = '';
    vaultStatusMessage.value = '密库已创建并解锁，现在可以开始保存账号密码。';
  } finally {
    vaultIsBusy.value = false;
  }
}

async function submitVaultUnlock() {
  if (!canUnlockVault.value || vaultIsBusy.value) {
    return;
  }

  vaultIsBusy.value = true;

  try {
    const result = await unlockVault(vaultUnlockPassword.value);

    if (!result) {
      vaultStatusMessage.value = '解锁失败，请确认密码是否正确。';
      return;
    }

    vaultSession.value = result.session;
    vaultEntries.value = sortVaultItems(result.entries);
    vaultUnlockPassword.value = '';
    vaultStatusMessage.value = '密库已解锁。';
  } finally {
    vaultIsBusy.value = false;
  }
}

function handleDocumentVisibilityChange() {
  if (document.hidden && isVaultUnlocked.value) {
    lockVault('密库已自动上锁。');
  }

  if (!document.hidden && shouldRefreshJournalWeather()) {
    void refreshJournalWeather({ background: true });
  }
}

function shouldRefreshJournalWeather(): boolean {
  return (
    journalWeatherLastLoadedAt.value === null ||
    Date.now() - journalWeatherLastLoadedAt.value >= WEATHER_REFRESH_INTERVAL
  );
}

function clearWeatherRefreshTimer() {
  if (weatherRefreshTimer !== null) {
    window.clearInterval(weatherRefreshTimer);
    weatherRefreshTimer = null;
  }
}

function scheduleWeatherRefresh() {
  if (typeof window === 'undefined') {
    return;
  }

  clearWeatherRefreshTimer();
  weatherRefreshTimer = window.setInterval(() => {
    if (!document.hidden) {
      void refreshJournalWeather({ background: true });
    }
  }, WEATHER_REFRESH_INTERVAL);
}

async function refreshJournalWeather(options: { background?: boolean } = {}) {
  if (typeof window === 'undefined') {
    return;
  }

  const shouldShowSpinner =
    journalWeatherSnapshot.value === null || options.background !== true;

  if (shouldShowSpinner) {
    journalWeatherLoading.value = true;
  }

  if (journalWeatherSnapshot.value === null) {
    journalWeatherStatusMessage.value = 'Open-Meteo · 正在获取天气';
  }

  weatherAbortController?.abort();
  const controller = new AbortController();
  weatherAbortController = controller;

  try {
    const location = await resolveWeatherLocation();

    if (controller.signal.aborted) {
      return;
    }

    const snapshot = await fetchWeatherSnapshot(location, controller.signal);

    if (controller.signal.aborted) {
      return;
    }

    journalWeatherSnapshot.value = snapshot;
    journalWeatherStatusMessage.value = '';
    journalWeatherLastLoadedAt.value = Date.now();
  } catch (error) {
    if (controller.signal.aborted) {
      return;
    }

    const fallbackMessage =
      error instanceof Error && error.message
        ? error.message
        : '天气暂时不可用，请稍后重试。';

    journalWeatherStatusMessage.value = journalWeatherSnapshot.value
      ? `${journalWeatherSnapshot.value.locationSourceLabel} · 展示最近一次天气`
      : fallbackMessage;
  } finally {
    if (weatherAbortController === controller) {
      weatherAbortController = null;
    }

    journalWeatherLoading.value = false;
  }
}

function getReminderTargetTypeForTodo(todo: TodoMark): ReminderTargetType {
  return todo.parkType === 'journal' ? 'journal-entry' : 'lab-record';
}

function getTodoParkLabel(parkType: TodoParkType): string {
  return parkType === 'journal' ? '心记' : '做记';
}

function getTodoTargetTypeLabel(targetType: TodoTargetType): string {
  return targetType === 'card' ? '卡片' : '句子';
}

function parseTodoSourceDataset(value: string | undefined): {
  parkType: TodoParkType;
  noteId: string;
} | null {
  if (!value) {
    return null;
  }

  const [parkType, noteId] = value.split(':');

  if ((parkType !== 'journal' && parkType !== 'project') || !noteId) {
    return null;
  }

  return {
    parkType,
    noteId,
  };
}

function getTodoSourceContent(
  parkType: TodoParkType,
  noteId: string,
): string | null {
  if (parkType === 'journal') {
    return entries.value.find((entry) => entry.id === noteId)?.content ?? null;
  }

  return labRecords.value.find((record) => record.id === noteId)?.content ?? null;
}

function captureTodoSelectionFromWindow() {
  const selection = window.getSelection();
  const selectedText = selection?.toString().trim() ?? '';

  if (!selection || !selectedText || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0);
  const sourceElement =
    range.commonAncestorContainer instanceof HTMLElement
      ? range.commonAncestorContainer.closest<HTMLElement>('[data-todo-source]')
      : range.commonAncestorContainer.parentElement?.closest<HTMLElement>(
          '[data-todo-source]',
        );
  const source = parseTodoSourceDataset(sourceElement?.dataset.todoSource);

  if (!source) {
    return;
  }

  const content = getTodoSourceContent(source.parkType, source.noteId);
  const anchor = content ? createAnchor(selectedText, content) : null;

  if (!anchor) {
    return;
  }

  cachedTodoSelection.value = {
    ...source,
    text: selectedText,
    anchor,
    capturedAt: Date.now(),
  };
}

function getCachedTodoAnchor(target: TodoTargetDraft): TextAnchor | null {
  const cachedSelection = cachedTodoSelection.value;

  if (
    !cachedSelection ||
    cachedSelection.parkType !== target.parkType ||
    cachedSelection.noteId !== target.noteId ||
    !target.content.includes(cachedSelection.anchor.sentenceText)
  ) {
    return null;
  }

  return cachedSelection.anchor;
}

function getCardTodo(parkType: TodoParkType, noteId: string): TodoMark | null {
  return (
    todos.value.find(
      (todo) =>
        todo.parkType === parkType &&
        todo.noteId === noteId &&
        todo.targetType === 'card',
    ) ?? null
  );
}

function getSentenceTodosForTarget(
  parkType: TodoParkType,
  noteId: string,
): TodoMark[] {
  return todos.value.filter(
    (todo) =>
      todo.parkType === parkType &&
      todo.noteId === noteId &&
      todo.targetType === 'sentence',
  );
}

function isCardTodoDone(parkType: TodoParkType, noteId: string): boolean {
  return getCardTodo(parkType, noteId)?.status === 'done';
}

function hasDoneSentenceTodosForPark(parkType: TodoParkType): boolean {
  return todos.value.some(
    (todo) =>
      todo.parkType === parkType &&
      todo.targetType === 'sentence' &&
      todo.status === 'done',
  );
}

function isCardTodoHighlighted(parkType: TodoParkType, noteId: string): boolean {
  const todo = getCardTodo(parkType, noteId);

  return Boolean(todo && isTodoHighlighted(todo.id));
}

function getTodoStatusIcon(todo: TodoMark): string {
  if (todo.targetType === 'sentence') {
    return todo.status === 'done' ? '☑' : '☐';
  }

  return todo.status === 'done' ? '●' : '○';
}

function getCardTodoIcon(parkType: TodoParkType, noteId: string): string {
  const todo = getCardTodo(parkType, noteId);

  return todo ? getTodoStatusIcon(todo) : '';
}

function getCardTodoDoneLabel(parkType: TodoParkType, noteId: string): string {
  const todo = getCardTodo(parkType, noteId);

  if (!todo || todo.status !== 'done') {
    return '';
  }

  return `${formatTodoDateTime(todo.doneAt)} 完成`;
}

function toggleCardTodo(parkType: TodoParkType, noteId: string) {
  const todo = getCardTodo(parkType, noteId);

  if (!todo) {
    return;
  }

  toggleTodoStatus(todo);
}

function isTodoHighlighted(todoId: string): boolean {
  return highlightedTodoId.value === todoId;
}

function formatTodoDateTime(timestamp?: number): string {
  if (!timestamp) {
    return '';
  }

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return `${getDateGroupLabel(date.toISOString())} ${formatEntryTime(date.toISOString())}`;
}

function isTodayTimestamp(timestamp: number): boolean {
  return getLocalDateKey(new Date(timestamp)) === getLocalDateKey(new Date());
}

function todoHasReminder(todo: TodoMark): boolean {
  if (todo.reminderId) {
    return true;
  }

  return activeReminders.value.some(
    (reminder) =>
      reminder.targetType === getReminderTargetTypeForTodo(todo) &&
      reminder.targetId === todo.noteId,
  );
}

function todoHasTodayReminder(todo: TodoMark): boolean {
  const today = getLocalDateKey(new Date());

  return activeReminders.value.some(
    (reminder) =>
      reminder.targetType === getReminderTargetTypeForTodo(todo) &&
      reminder.targetId === todo.noteId &&
      getLocalDateKey(reminder.scheduledAt) === today,
  );
}

function resolveTodoSource(todo: TodoMark): TodoSourceItem {
  const missingSource: TodoSourceItem = {
    todo,
    title: '来源记录不可用',
    content: todo.sentenceText ?? '',
    parkLabel: getTodoParkLabel(todo.parkType),
    sourceLabel: '来源已删除',
    createdLabel: `${formatTodoDateTime(todo.createdAt)} 创建`,
    hasReminder: todoHasReminder(todo),
    isMissing: true,
  };

  if (todo.parkType === 'journal') {
    const entry = entries.value.find((item) => item.id === todo.noteId);

    if (!entry) {
      return missingSource;
    }

    return {
      todo,
      title: entry.title,
      content: todo.targetType === 'sentence' ? todo.sentenceText ?? entry.content : entry.content,
      parkLabel: '心记',
      sourceLabel: `心记 / ${formatJournalDateKeyLabel(getJournalEntryDateKey(entry))}`,
      createdLabel: `${formatTodoDateTime(todo.createdAt)} 创建`,
      hasReminder: todoHasReminder(todo),
      isMissing: false,
    };
  }

  const record = labRecords.value.find((item) => item.id === todo.noteId);

  if (!record) {
    return missingSource;
  }

  const project = labProjects.value.find((item) => item.id === record.projectId);

  return {
    todo,
    title: record.title,
    content: todo.targetType === 'sentence' ? todo.sentenceText ?? record.content : record.content,
    parkLabel: '做记',
    sourceLabel: `做记 / ${project?.name ?? '未知项目'}`,
    createdLabel: `${formatTodoDateTime(todo.createdAt)} 创建`,
    hasReminder: todoHasReminder(todo),
    isMissing: false,
  };
}

function matchesTodoParkFilter(todo: TodoMark): boolean {
  return todoParkFilter.value === 'all' || todo.parkType === todoParkFilter.value;
}

function matchesTodoQuickFilter(item: TodoSourceItem): boolean {
  if (todoQuickFilter.value === 'reminder') {
    return item.hasReminder;
  }

  if (todoQuickFilter.value === 'today') {
    return isTodayTimestamp(item.todo.createdAt) || todoHasTodayReminder(item.todo);
  }

  return true;
}

function getTodoSelectedAnchor(target: TodoTargetDraft) {
  return (
    getCachedTodoAnchor(target) ??
    createAnchor(window.getSelection()?.toString() ?? '', target.content)
  );
}

function getMatchingSentenceTodo(
  parkType: TodoParkType,
  noteId: string,
  anchor: TextAnchor,
): TodoMark | null {
  const sentenceTodos = getSentenceTodosForTarget(parkType, noteId);

  return (
    sentenceTodos.find(
      (todo) =>
        todo.sentenceText === anchor.sentenceText &&
        todo.sentenceApproxOffset === anchor.sentenceApproxOffset,
    ) ??
    sentenceTodos.find((todo) => todo.sentenceText === anchor.sentenceText) ??
    null
  );
}

function removeTodoMark(todo: TodoMark, message: string): boolean {
  const didDelete = deleteTodo(todo.id);

  if (!didDelete) {
    return false;
  }

  if (highlightedTodoId.value === todo.id) {
    highlightedTodoId.value = null;
  }

  if (todoCompletionDraft.value?.id === todo.id) {
    closeTodoCompletionDraft();
  }

  expandedHiddenTodoIds.value = new Set(
    [...expandedHiddenTodoIds.value].filter((todoId) => todoId !== todo.id),
  );
  refreshTodos();
  todoStatusMessage.value = message;

  return true;
}

function createTodoForTarget(target: TodoTargetDraft) {
  const selectedAnchor = getTodoSelectedAnchor(target);
  const existingCardTodo = getCardTodo(target.parkType, target.noteId);
  let todo: TodoMark | null = null;

  if (selectedAnchor) {
    cachedTodoSelection.value = null;
    const existingSentenceTodo = getMatchingSentenceTodo(
      target.parkType,
      target.noteId,
      selectedAnchor,
    );

    if (existingSentenceTodo) {
      if (existingSentenceTodo.status === 'open') {
        if (!removeTodoMark(existingSentenceTodo, '已取消这段文字的待办。')) {
          todoStatusMessage.value = '待办取消失败，请稍后再试。';
        }

        return;
      }

      highlightedTodoId.value = existingSentenceTodo.id;
      todoStatusMessage.value = '这段文字已在已完成待办里，可点击方框恢复为待办。';
      return;
    }

    todo = createTodo({
      parkType: target.parkType,
      noteId: target.noteId,
      targetType: 'sentence',
      sentenceText: selectedAnchor.sentenceText,
      sentenceApproxOffset: selectedAnchor.sentenceApproxOffset,
    });
  } else if (existingCardTodo) {
    if (existingCardTodo.status === 'open') {
      if (
        !removeTodoMark(
          existingCardTodo,
          `已取消「${target.title || '这张卡片'}」待办。`,
        )
      ) {
        todoStatusMessage.value = '待办取消失败，请稍后再试。';
      }

      return;
    }

    highlightedTodoId.value = existingCardTodo.id;
    todoStatusMessage.value = '这张卡片已在已完成待办里，可点击圆点恢复为待办。';
    return;
  } else {
    todo = createTodo({
      parkType: target.parkType,
      noteId: target.noteId,
      targetType: 'card',
    });
  }

  if (!todo) {
    todoStatusMessage.value = '待办创建失败，请稍后再试。';
    return;
  }

  highlightedTodoId.value = todo.id;
  todoStatusMessage.value =
    todo.targetType === 'sentence'
      ? '已把选中的文字标记为待办。'
      : `已把「${target.title}」标记为待办。`;
  refreshTodos();
}

function createLabTodo(record: LabRecord) {
  createTodoForTarget({
    parkType: 'project',
    noteId: record.id,
    title: record.title,
    content: record.content,
  });
}

function toggleCardTodoFromMenu(
  parkType: TodoParkType,
  noteId: string,
  title: string,
) {
  const existingCardTodo = getCardTodo(parkType, noteId);

  if (!existingCardTodo) {
    const todo = createTodo({
      parkType,
      noteId,
      targetType: 'card',
    });

    if (!todo) {
      todoStatusMessage.value = '待办创建失败，请稍后再试。';
      return;
    }

    highlightedTodoId.value = todo.id;
    todoStatusMessage.value = `已把「${title}」标记为待办。`;
    refreshTodos();
    return;
  }

  if (existingCardTodo.status === 'open') {
    if (
      !removeTodoMark(
        existingCardTodo,
        `已取消「${title || '这张卡片'}」待办。`,
      )
    ) {
      todoStatusMessage.value = '待办取消失败，请稍后再试。';
    }

    return;
  }

  toggleTodoStatus(existingCardTodo);
}

function clearTodoCompletionTimer() {
  if (todoCompletionTimer.value !== null) {
    window.clearTimeout(todoCompletionTimer.value);
    todoCompletionTimer.value = null;
  }
}

function closeTodoCompletionDraft() {
  clearTodoCompletionTimer();
  todoCompletionDraft.value = null;
  todoCompletionNote.value = '';
}

function openTodoCompletionDraft(todo: TodoMark) {
  closeTodoCompletionDraft();
  todoCompletionDraft.value = todo;
  todoCompletionNote.value = todo.doneNote ?? '';
  todoCompletionTimer.value = window.setTimeout(() => {
    closeTodoCompletionDraft();
  }, 2000);
}

function keepTodoCompletionPanelOpen() {
  clearTodoCompletionTimer();
}

function saveTodoCompletionNote() {
  if (!todoCompletionDraft.value) {
    return;
  }

  updateTodoDoneNote(todoCompletionDraft.value.id, todoCompletionNote.value);
  todoStatusMessage.value = todoCompletionNote.value.trim()
    ? '完成备注已保存。'
    : '已完成，未添加备注。';
  refreshTodos();
  closeTodoCompletionDraft();
}

function toggleTodoStatus(todo: TodoMark) {
  if (todo.status === 'done') {
    const shouldReopen = window.confirm('取消完成？会恢复为待办状态');

    if (!shouldReopen) {
      return;
    }

    const reopenedTodo = reopenTodo(todo.id);

    if (!reopenedTodo) {
      return;
    }

    highlightedTodoId.value = reopenedTodo.id;
    todoStatusMessage.value = '已恢复为待办。';
    refreshTodos();
    return;
  }

  const completedTodo = completeTodo(todo.id);

  if (!completedTodo) {
    return;
  }

  highlightedTodoId.value = completedTodo.id;
  todoStatusMessage.value = '完成啦。';
  refreshTodos();
  openTodoCompletionDraft(completedTodo);
}

function toggleTodoById(todoId: string) {
  const todo = todos.value.find((item) => item.id === todoId);

  if (!todo) {
    return;
  }

  toggleTodoStatus(todo);
}

function expandHiddenTodo(todoId: string) {
  expandedHiddenTodoIds.value = new Set([...expandedHiddenTodoIds.value, todoId]);
}

function handleTodoContentClick(event: MouseEvent) {
  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  const expandTarget = target.closest<HTMLElement>('[data-todo-expand]');

  if (expandTarget?.dataset.todoExpand) {
    expandHiddenTodo(expandTarget.dataset.todoExpand);
    return;
  }

  const toggleTarget = target.closest<HTMLElement>('[data-todo-id]');

  if (toggleTarget?.dataset.todoId) {
    toggleTodoById(toggleTarget.dataset.todoId);
  }
}

function getUnresolvedSentenceTodos(
  parkType: TodoParkType,
  noteId: string,
  content: string,
): TodoMark[] {
  return getSentenceTodosForTarget(parkType, noteId).filter(
    (todo) => !resolveAnchor(todo, content).found,
  );
}

function showUnresolvedTodoOriginals(
  parkType: TodoParkType,
  noteId: string,
  content: string,
) {
  const unresolvedTodos = getUnresolvedSentenceTodos(parkType, noteId, content);

  if (unresolvedTodos.length === 0) {
    return;
  }

  window.alert(
    unresolvedTodos
      .map((todo, index) => `${index + 1}. ${todo.sentenceText ?? '原文不可用'}`)
      .join('\n\n'),
  );
}

function removeUnresolvedSentenceTodos(
  parkType: TodoParkType,
  noteId: string,
  content: string,
) {
  const unresolvedTodos = getUnresolvedSentenceTodos(parkType, noteId, content);

  if (unresolvedTodos.length === 0) {
    return;
  }

  const shouldDelete = window.confirm(
    `删除 ${unresolvedTodos.length} 个无法定位的待办？此操作不可恢复。`,
  );

  if (!shouldDelete) {
    return;
  }

  unresolvedTodos.forEach((todo) => deleteTodo(todo.id));
  refreshTodos();
  todoStatusMessage.value = '无法定位的待办已删除。';
}

function deleteDoneTodosWithConfirm(count: number, queryLabel: string, query: Parameters<typeof deleteDoneTodos>[0]) {
  if (count === 0) {
    return;
  }

  const shouldDelete = window.confirm(
    `清空 ${count} 条已完成待办？此操作不可恢复。`,
  );

  if (!shouldDelete) {
    return;
  }

  deleteDoneTodos(query);
  refreshTodos();
  todoStatusMessage.value = `${queryLabel}的已完成待办已清空。`;
}

function clearJournalDoneCardTodos() {
  deleteDoneTodosWithConfirm(
    completedJournalEntryItems.value.length,
    '心记',
    { parkType: 'journal', targetType: 'card' },
  );
}

function clearSelectedDateDoneCardTodos() {
  deleteDoneTodosWithConfirm(
    selectedDateCompletedEntryItems.value.length,
    '这一天',
    {
      parkType: 'journal',
      targetType: 'card',
      noteIds: selectedDateCompletedEntryItems.value.map((item) => item.entry.id),
    },
  );
}

function clearLabDoneCardTodos() {
  deleteDoneTodosWithConfirm(
    activeCompletedLabRecordItems.value.length,
    '当前项目',
    {
      parkType: 'project',
      targetType: 'card',
      noteIds: activeCompletedLabRecordItems.value.map((item) => item.record.id),
    },
  );
}

function clearGlobalDoneTodos() {
  const count = filteredDoneTodoItems.value.length;

  if (count === 0) {
    return;
  }

  const shouldDelete = window.confirm(
    `清空 ${count} 条已完成待办？此操作不可恢复。`,
  );

  if (!shouldDelete) {
    return;
  }

  filteredDoneTodoItems.value.forEach((item) => deleteTodo(item.todo.id));
  refreshTodos();
  todoStatusMessage.value = '当前筛选的已完成待办已清空。';
}

function focusTodoSource(todo: TodoMark) {
  highlightedTodoId.value = todo.id;

  if (todo.parkType === 'journal') {
    const entry = entries.value.find((item) => item.id === todo.noteId);

    activePark.value = 'journal';
    activeView.value = 'timeline';

    if (entry) {
      selectedDateKey.value = getJournalEntryDateKey(entry);
      calendarMonth.value = startOfMonth(new Date(`${selectedDateKey.value}T00:00:00`));
    }

    if (todo.status === 'done' && todo.targetType === 'card') {
      journalCompletedOpen.value = true;
    }

    void scrollTodoTargetIntoView(todo);
    return;
  }

  const record = labRecords.value.find((item) => item.id === todo.noteId);

  activePark.value = 'lab';
  activeLabProjectId.value = record?.projectId ?? activeLabProjectId.value;
  if (record) {
    ensureLabBranchFilterForRecord(record);
  }
  selectedLabRecordId.value = todo.noteId;
  labInspectorMode.value = 'record-view';
  labDrawerOpen.value = false;

  if (todo.status === 'done' && todo.targetType === 'card') {
    labCompletedOpen.value = true;
  }

  void scrollTodoTargetIntoView(todo);
}

async function scrollTodoTargetIntoView(todo: TodoMark) {
  await nextTick();

  window.setTimeout(() => {
    const targetElement =
      document.querySelector(`[data-todo-target="${todo.id}"]`) ??
      document.querySelector(
        `[data-todo-source="${todo.parkType}:${todo.noteId}"]`,
      );

    targetElement?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, 80);
}

function renderTodoContent(
  content: string,
  parkType: TodoParkType,
  noteId: string,
  reminderTargetType: ReminderTargetType,
): string {
  type ContentRange = {
    offset: number;
    length: number;
    kind: 'todo' | 'reminder';
    todo?: TodoMark;
  };

  const ranges: ContentRange[] = [];

  for (const todo of getSentenceTodosForTarget(parkType, noteId)) {
    const resolvedAnchor = resolveAnchor(todo, content);

    if (
      resolvedAnchor.found &&
      resolvedAnchor.offset !== undefined &&
      resolvedAnchor.length !== undefined
    ) {
      ranges.push({
        offset: resolvedAnchor.offset,
        length: resolvedAnchor.length,
        kind: 'todo',
        todo,
      });
    }
  }

  const highlightedTarget = highlightedReminderTarget.value;

  if (
    highlightedTarget &&
    highlightedTarget.targetType === reminderTargetType &&
    highlightedTarget.targetId === noteId &&
    highlightedTarget.quote
  ) {
    const quoteIndex = content.indexOf(highlightedTarget.quote);

    if (quoteIndex >= 0) {
      ranges.push({
        offset: quoteIndex,
        length: highlightedTarget.quote.length,
        kind: 'reminder',
      });
    }
  }

  const normalizedRanges = ranges
    .sort((firstRange, secondRange) => firstRange.offset - secondRange.offset)
    .reduce<ContentRange[]>((acceptedRanges, range) => {
      const previousRange = acceptedRanges[acceptedRanges.length - 1];
      const previousEnd = previousRange
        ? previousRange.offset + previousRange.length
        : -1;

      if (range.offset < previousEnd) {
        return acceptedRanges;
      }

      return [...acceptedRanges, range];
    }, []);

  if (normalizedRanges.length === 0) {
    return escapeHtml(content);
  }

  let renderedContent = '';
  let cursor = 0;

  for (const range of normalizedRanges) {
    renderedContent += escapeHtml(content.slice(cursor, range.offset));

    const rangeText = content.slice(range.offset, range.offset + range.length);

    if (range.kind === 'todo' && range.todo) {
      const todo = range.todo;
      const isDone = todo.status === 'done';
      const isHidden =
        isDone &&
        hideDoneSentenceTodos.value &&
        !expandedHiddenTodoIds.value.has(todo.id);
      const todoClasses = [
        'todo-sentence-mark',
        isDone ? 'is-done' : 'is-open',
        isTodoHighlighted(todo.id) ? 'is-highlighted' : '',
      ]
        .filter(Boolean)
        .join(' ');

      if (isHidden) {
        renderedContent += [
          `<span class="todo-hidden-placeholder" data-todo-expand="${escapeHtml(todo.id)}">`,
          '⋯',
          '</span>',
        ].join('');
      } else {
        renderedContent += [
          `<span class="${todoClasses}" data-todo-target="${escapeHtml(todo.id)}">`,
          `<span class="todo-inline-toggle" data-todo-id="${escapeHtml(todo.id)}">`,
          getTodoStatusIcon(todo),
          '</span>',
          `<span class="todo-sentence-text">${escapeHtml(rangeText)}</span>`,
          '</span>',
        ].join('');
      }
    } else {
      renderedContent += [
        '<mark class="reminder-target-highlight">',
        escapeHtml(rangeText),
        '</mark>',
      ].join('');
    }

    cursor = range.offset + range.length;
  }

  renderedContent += escapeHtml(content.slice(cursor));

  return renderedContent;
}

function toDateTimeLocalInputValue(date: Date): string {
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  const localDate = new Date(date.getTime() - timezoneOffset);

  return localDate.toISOString().slice(0, 16);
}

function formatClockTimeLabel(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, '0')}:${minute
    .toString()
    .padStart(2, '0')}`;
}

function hasActiveTextSelection(): boolean {
  const selection = window.getSelection();

  return Boolean(selection && selection.toString().trim().length > 0);
}

function isJournalEntryExpanded(entryId: string): boolean {
  return expandedJournalEntryIds.value.has(entryId);
}

function setJournalEntryExpanded(entryId: string, expanded: boolean) {
  const nextExpandedIds = new Set(expandedJournalEntryIds.value);

  if (expanded) {
    nextExpandedIds.add(entryId);
  } else {
    nextExpandedIds.delete(entryId);
  }

  expandedJournalEntryIds.value = nextExpandedIds;
}

function toggleJournalEntryExpanded(entryId: string) {
  if (hasActiveTextSelection()) {
    return;
  }

  setJournalEntryExpanded(entryId, !isJournalEntryExpanded(entryId));
}

function handleJournalEntryContentClick(entryId: string, event: MouseEvent) {
  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.closest('[data-todo-expand], [data-todo-id]')) {
    handleTodoContentClick(event);
    return;
  }

  toggleJournalEntryExpanded(entryId);
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
  focusJournalComposer();
}

function getDefaultReminderDateTime(): string {
  return toDateTimeLocalInputValue(new Date(Date.now() + 60 * 60_000));
}

function focusJournalComposer() {
  void nextTick(() => {
    document.querySelector('.compose-card')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });

    window.setTimeout(() => {
      document
        .querySelector<HTMLTextAreaElement>('.compose-card .journal-input')
        ?.focus();
    }, 120);
  });
}

function openDailyJournalReminderComposer() {
  const today = getLocalDateKey(new Date());

  activePark.value = 'journal';
  selectedDateKey.value = today;
  draftEntryDate.value = today;
  activeView.value = 'timeline';
  cancelEditing();
  focusJournalComposer();
  dailyJournalReminderStatusMessage.value = '已经把你带回今晚的记录入口。';
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

async function enableDailyJournalReminder() {
  if (dailyJournalReminderIsSaving.value) {
    return;
  }

  dailyJournalReminderIsSaving.value = true;
  dailyJournalReminderStatusMessage.value = '正在开启每日提醒...';

  const scheduleResult = await scheduleDailyJournalReminderNotification(
    dailyJournalReminder.value.hour,
    dailyJournalReminder.value.minute,
  );

  if (!scheduleResult.ok) {
    dailyJournalReminderStatusMessage.value = scheduleResult.message;
    dailyJournalReminderIsSaving.value = false;
    return;
  }

  const savedSettings = setDailyJournalReminderEnabled(true);

  if (!savedSettings) {
    await cancelDailyJournalReminderNotification();
    dailyJournalReminderStatusMessage.value = '每日提醒已经向系统申请，但本地状态保存失败，请再试一次。';
    dailyJournalReminderIsSaving.value = false;
    return;
  }

  refreshDailyJournalReminder();
  dailyJournalReminderStatusMessage.value = scheduleResult.message;
  dailyJournalReminderIsSaving.value = false;
}

async function disableDailyJournalReminder() {
  if (dailyJournalReminderIsSaving.value) {
    return;
  }

  dailyJournalReminderIsSaving.value = true;

  const savedSettings = setDailyJournalReminderEnabled(false);

  if (!savedSettings) {
    dailyJournalReminderStatusMessage.value = '关闭失败，本地状态暂时没有保存下来。';
    dailyJournalReminderIsSaving.value = false;
    return;
  }

  refreshDailyJournalReminder();
  await cancelDailyJournalReminderNotification();
  dailyJournalReminderStatusMessage.value = `已关闭每日 ${dailyJournalReminderTimeLabel.value} 系统提醒。`;
  dailyJournalReminderIsSaving.value = false;
}

async function syncDailyJournalReminderOnLaunch() {
  refreshDailyJournalReminder();

  if (!dailyJournalReminder.value.enabled) {
    return;
  }

  const scheduleResult = await scheduleDailyJournalReminderNotification(
    dailyJournalReminder.value.hour,
    dailyJournalReminder.value.minute,
  );

  if (!scheduleResult.ok) {
    setDailyJournalReminderEnabled(false);
    refreshDailyJournalReminder();
    dailyJournalReminderStatusMessage.value = `${scheduleResult.message} 你可以稍后再重新开启。`;
  }
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
    if (note) {
      ensureKnowledgeBranchFilterForNote(note);
    }
    selectedKnowledgeNoteId.value = reminder.targetId;
    knowledgeInspectorMode.value = 'note-view';
    knowledgeDrawerOpen.value = false;
    void scrollReminderTargetIntoView(reminder.targetType, reminder.targetId);
    return;
  }

  const record = labRecords.value.find((item) => item.id === reminder.targetId);

  activePark.value = 'lab';
  activeLabProjectId.value = record?.projectId ?? reminder.parentId;
  if (record) {
    ensureLabBranchFilterForRecord(record);
  }
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

function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase();
}

function buildSearchKeywords(rawQuery: string): string[] {
  const seenKeywords = new Set<string>();

  return rawQuery
    .split(SEARCH_KEYWORD_SPLIT_PATTERN)
    .map((keyword) => normalizeSearchText(keyword.trim()))
    .filter((keyword) => keyword.length > 0)
    .filter((keyword) => {
      if (seenKeywords.has(keyword)) {
        return false;
      }

      seenKeywords.add(keyword);
      return true;
    })
    .sort((firstKeyword, secondKeyword) => secondKeyword.length - firstKeyword.length);
}

function normalizeSearchMatchRanges(ranges: SearchMatchRange[]): SearchMatchRange[] {
  return [...ranges]
    .sort((firstRange, secondRange) => {
      if (firstRange.start !== secondRange.start) {
        return firstRange.start - secondRange.start;
      }

      return secondRange.end - firstRange.end;
    })
    .reduce<SearchMatchRange[]>((acceptedRanges, range) => {
      const previousRange = acceptedRanges[acceptedRanges.length - 1];

      if (!previousRange) {
        acceptedRanges.push({ ...range });
        return acceptedRanges;
      }

      if (range.start <= previousRange.end) {
        previousRange.end = Math.max(previousRange.end, range.end);
        return acceptedRanges;
      }

      acceptedRanges.push({ ...range });
      return acceptedRanges;
    }, []);
}

function collectSearchMatchRanges(
  text: string,
  keywords: string[],
): SearchMatchRange[] {
  if (!text || keywords.length === 0) {
    return [];
  }

  const normalizedText = normalizeSearchText(text);
  const ranges: SearchMatchRange[] = [];

  for (const keyword of keywords) {
    let fromIndex = 0;

    while (fromIndex < normalizedText.length) {
      const matchIndex = normalizedText.indexOf(keyword, fromIndex);

      if (matchIndex === -1) {
        break;
      }

      ranges.push({
        start: matchIndex,
        end: matchIndex + keyword.length,
      });
      fromIndex = matchIndex + Math.max(keyword.length, 1);
    }
  }

  return normalizeSearchMatchRanges(ranges);
}

function renderSearchHighlightedHtml(
  text: string,
  ranges: SearchMatchRange[],
): string {
  if (!text) {
    return '';
  }

  const normalizedRanges = normalizeSearchMatchRanges(ranges);

  if (normalizedRanges.length === 0) {
    return escapeHtml(text);
  }

  let renderedHtml = '';
  let cursor = 0;

  for (const range of normalizedRanges) {
    renderedHtml += escapeHtml(text.slice(cursor, range.start));
    renderedHtml += [
      '<mark class="search-keyword-highlight">',
      escapeHtml(text.slice(range.start, range.end)),
      '</mark>',
    ].join('');
    cursor = range.end;
  }

  renderedHtml += escapeHtml(text.slice(cursor));
  return renderedHtml;
}

function buildSearchPreview(
  content: string,
  contentMatches: SearchMatchRange[],
): { text: string; ranges: SearchMatchRange[] } {
  if (!content) {
    return { text: '', ranges: [] };
  }

  if (contentMatches.length === 0) {
    const previewText =
      content.length > SEARCH_EXCERPT_FALLBACK_LENGTH
        ? `${content.slice(0, SEARCH_EXCERPT_FALLBACK_LENGTH).trimEnd()}…`
        : content;

    return {
      text: previewText,
      ranges: [],
    };
  }

  const firstMatch = contentMatches[0];
  const rawStart = Math.max(0, firstMatch.start - SEARCH_EXCERPT_CONTEXT_LENGTH);
  const rawEnd = Math.min(content.length, firstMatch.end + SEARCH_EXCERPT_CONTEXT_LENGTH);
  const rawPreview = content.slice(rawStart, rawEnd);
  const leadingWhitespaceLength = rawPreview.match(/^\s*/)?.[0].length ?? 0;
  const trailingWhitespaceLength = rawPreview.match(/\s*$/)?.[0].length ?? 0;
  const previewStart = rawStart + leadingWhitespaceLength;
  const previewEnd =
    trailingWhitespaceLength > 0 ? rawEnd - trailingWhitespaceLength : rawEnd;
  const previewCore = content.slice(previewStart, previewEnd);
  const hasLeadingEllipsis = previewStart > 0;
  const hasTrailingEllipsis = previewEnd < content.length;
  const prefixLength = hasLeadingEllipsis ? 1 : 0;

  return {
    text: `${hasLeadingEllipsis ? '…' : ''}${previewCore}${hasTrailingEllipsis ? '…' : ''}`,
    ranges: contentMatches
      .filter((range) => range.end > previewStart && range.start < previewEnd)
      .map((range) => ({
        start: Math.max(range.start, previewStart) - previewStart + prefixLength,
        end: Math.min(range.end, previewEnd) - previewStart + prefixLength,
      })),
  };
}

function buildJournalSearchResult(
  entry: JournalEntry,
  keywords: string[],
): JournalSearchResult {
  const titleMatches = collectSearchMatchRanges(entry.title, keywords);
  const contentMatches = collectSearchMatchRanges(entry.content, keywords);
  const matchedTagsHtml = entry.tags
    .map((tag) => ({
      tag,
      matches: collectSearchMatchRanges(tag, keywords),
    }))
    .filter((tagItem) => tagItem.matches.length > 0)
    .map((tagItem) => renderSearchHighlightedHtml(tagItem.tag, tagItem.matches));
  const preview = buildSearchPreview(entry.content, contentMatches);

  return {
    entry,
    titleHtml: renderSearchHighlightedHtml(entry.title || '无标题', titleMatches),
    previewHtml: renderSearchHighlightedHtml(preview.text, preview.ranges),
    fullContentHtml: renderSearchHighlightedHtml(entry.content, contentMatches),
    matchedTagsHtml,
  };
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

function isPinned(pinnedAt: string | null | undefined): boolean {
  return Boolean(pinnedAt);
}

function isFlagged(flaggedAt: string | null | undefined): boolean {
  return Boolean(flaggedAt);
}

function isCardActionMenuOpenFor(target: CardActionMenuTarget): boolean {
  const activeTarget = cardActionMenuTarget.value;

  if (!activeTarget) {
    return false;
  }

  if (target.kind === 'journal') {
    return activeTarget.kind === 'journal' && activeTarget.entryId === target.entryId;
  }

  if (target.kind === 'knowledge') {
    return activeTarget.kind === 'knowledge' && activeTarget.noteId === target.noteId;
  }

  return activeTarget.kind === 'lab' && activeTarget.recordId === target.recordId;
}

function getCardActionMenuTriggerElement(event: Event): HTMLElement | null {
  return event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
}

function positionCardActionMenu() {
  const anchorElement = cardActionMenuAnchorElement.value;
  const panelElement = cardActionMenuPanel.value;

  if (!anchorElement || !panelElement) {
    cardActionMenuPlacement.value = null;
    return;
  }

  const anchorRect = anchorElement.getBoundingClientRect();
  const panelRect = panelElement.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const viewportMargin = 12;
  const offset = 8;
  const spaceBelow = viewportHeight - anchorRect.bottom - viewportMargin;
  const spaceAbove = anchorRect.top - viewportMargin;
  const shouldOpenUpward = panelRect.height > spaceBelow && spaceAbove > spaceBelow;

  let left = anchorRect.right - panelRect.width;
  left = Math.min(
    Math.max(left, viewportMargin),
    viewportWidth - panelRect.width - viewportMargin,
  );

  let top = shouldOpenUpward
    ? anchorRect.top - panelRect.height - offset
    : anchorRect.bottom + offset;
  top = Math.min(
    Math.max(top, viewportMargin),
    viewportHeight - panelRect.height - viewportMargin,
  );

  cardActionMenuPlacement.value = {
    top,
    left,
    transformOrigin: `right ${shouldOpenUpward ? 'bottom' : 'top'}`,
  };
}

function handleCardActionMenuViewportChange() {
  if (!resolvedCardActionMenuTarget.value) {
    return;
  }

  void nextTick(positionCardActionMenu);
}

function handleCardActionMenuPointerDown(event: PointerEvent) {
  if (!resolvedCardActionMenuTarget.value) {
    return;
  }

  const targetNode = event.target;

  if (!(targetNode instanceof Node)) {
    closeCardActionMenu();
    return;
  }

  if (cardActionMenuPanel.value?.contains(targetNode)) {
    return;
  }

  if (cardActionMenuAnchorElement.value?.contains(targetNode)) {
    return;
  }

  closeCardActionMenu();
}

function handleCardActionMenuEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !resolvedCardActionMenuTarget.value) {
    return;
  }

  closeCardActionMenu();
}

function openCardActionMenu(target: CardActionMenuTarget, event: Event) {
  const triggerElement = getCardActionMenuTriggerElement(event);

  if (!triggerElement) {
    cardActionMenuTarget.value = target;
    cardActionMenuAnchorElement.value = null;
    cardActionMenuPlacement.value = null;
    return;
  }

  const triggerRect = triggerElement.getBoundingClientRect();

  cardActionMenuTarget.value = target;
  cardActionMenuAnchorElement.value = triggerElement;
  cardActionMenuPlacement.value = {
    top: triggerRect.bottom + 8,
    left: Math.max(triggerRect.right - 216, 12),
    transformOrigin: 'right top',
  };
  void nextTick(positionCardActionMenu);
}

function toggleCardActionMenu(target: CardActionMenuTarget, event: Event) {
  if (isCardActionMenuOpenFor(target)) {
    closeCardActionMenu();
    return;
  }

  openCardActionMenu(target, event);
}

function closeCardActionMenu() {
  cardActionMenuTarget.value = null;
  cardActionMenuAnchorElement.value = null;
  cardActionMenuPlacement.value = null;
}

function refreshRecordBranches() {
  recordBranches.value = getRecordBranches({ includeArchived: true });
}

function encodeBranchValue(branchId: string | null): string {
  return branchId ?? BRANCH_UNGROUPED_VALUE;
}

function decodeBranchValue(branchValue: string): string | null {
  return branchValue === BRANCH_UNGROUPED_VALUE ? null : branchValue;
}

function isSpecificBranchFilter(filterId: BranchFilterId): boolean {
  return filterId !== 'all' && filterId !== 'ungrouped';
}

function matchesBranchFilter(
  branchId: string | null,
  activeBranches: RecordBranch[],
  filterId: BranchFilterId,
): boolean {
  if (filterId === 'all') {
    return true;
  }

  if (filterId === 'ungrouped') {
    return branchId === null;
  }

  if (branchId === null) {
    return false;
  }

  const scopedBranchIds = new Set<string>([
    filterId,
    ...getBranchDescendantIds(activeBranches, filterId),
  ]);

  return scopedBranchIds.has(branchId);
}

function countItemsInBranchScope(
  itemBranchIds: Array<string | null>,
  activeBranches: RecordBranch[],
  filterId: BranchFilterId,
): number {
  return itemBranchIds.filter((branchId) =>
    matchesBranchFilter(branchId, activeBranches, filterId),
  ).length;
}

function buildBranchTreeItems(
  activeBranches: RecordBranch[],
  itemBranchIds: Array<string | null>,
): BranchTreeItem[] {
  return flattenBranchTree(activeBranches).map(({ branch, depth }) => ({
    branch,
    depth,
    itemCount: countItemsInBranchScope(itemBranchIds, activeBranches, branch.id),
    pathLabel: getBranchPathLabel(activeBranches, branch.id),
  }));
}

function buildBranchSelectOptions(
  activeBranches: RecordBranch[],
  allBranches: RecordBranch[],
  currentBranchId: string | null,
): Array<{ value: string; label: string }> {
  const options = flattenBranchTree(activeBranches).map(({ branch }) => ({
    value: branch.id,
    label: getBranchPathLabel(activeBranches, branch.id),
  }));

  if (
    currentBranchId &&
    !options.some((option) => option.value === currentBranchId)
  ) {
    const archivedBranch =
      allBranches.find((branch) => branch.id === currentBranchId) ?? null;

    if (archivedBranch) {
      options.unshift({
        value: archivedBranch.id,
        label: `${getBranchPathLabel(allBranches, archivedBranch.id)}（已归档）`,
      });
    }
  }

  return options;
}

function describeBranchFilter(
  filterId: BranchFilterId,
  allBranches: RecordBranch[],
): string {
  if (filterId === 'all') {
    return '全部';
  }

  if (filterId === 'ungrouped') {
    return '未分组';
  }

  return getBranchPathLabel(allBranches, filterId);
}

function promptForBranchName(title: string, defaultValue = ''): string | null {
  const branchName = window.prompt(title, defaultValue)?.trim() ?? '';

  return branchName ? branchName : null;
}

function promptForBranchParent(
  branchLabel: string,
  activeBranches: RecordBranch[],
  excludedBranchIds: string[] = [],
  currentParentId: string | null = null,
): string | null | undefined {
  const options = flattenBranchTree(activeBranches)
    .filter(({ branch }) => !excludedBranchIds.includes(branch.id))
    .map(({ branch }) => `${branch.id}  ${getBranchPathLabel(activeBranches, branch.id)}`);
  const promptMessage = [
    `给「${branchLabel}」选择新的上级分支。`,
    `输入 root 或留空，表示放到第 1 层。`,
    `当前上级: ${
      currentParentId ? getBranchPathLabel(activeBranches, currentParentId) : '第 1 层'
    }`,
    '',
    ...options,
  ].join('\n');
  const input = window.prompt(promptMessage, currentParentId ?? 'root');

  if (input === null) {
    return undefined;
  }

  const normalizedInput = input.trim();

  if (!normalizedInput || normalizedInput === 'root') {
    return null;
  }

  return activeBranches.some((branch) => branch.id === normalizedInput)
    ? normalizedInput
    : undefined;
}

function setKnowledgeBranchFilter(filterId: BranchFilterId) {
  activeKnowledgeBranchFilterId.value = filterId;

  if (
    selectedKnowledgeNote.value &&
    !matchesBranchFilter(
      selectedKnowledgeNote.value.branchId,
      activeKnowledgeBranches.value,
      filterId,
    )
  ) {
    selectedKnowledgeNoteId.value = null;
    knowledgeInspectorMode.value = 'base';
    cancelKnowledgeNoteEditing();
  }
}

function setLabBranchFilter(filterId: BranchFilterId) {
  activeLabBranchFilterId.value = filterId;

  if (
    selectedLabRecord.value &&
    !matchesBranchFilter(
      selectedLabRecord.value.branchId,
      activeLabBranches.value,
      filterId,
    )
  ) {
    selectedLabRecordId.value = null;
    labInspectorMode.value = 'project';
    cancelLabRecordEditing();
  }
}

function ensureKnowledgeBranchFilterForNote(note: KnowledgeNote) {
  if (
    !matchesBranchFilter(
      note.branchId,
      activeKnowledgeBranches.value,
      activeKnowledgeBranchFilterId.value,
    )
  ) {
    setKnowledgeBranchFilter(note.branchId ?? 'ungrouped');
  }
}

function ensureLabBranchFilterForRecord(record: LabRecord) {
  if (
    !matchesBranchFilter(
      record.branchId,
      activeLabBranches.value,
      activeLabBranchFilterId.value,
    )
  ) {
    setLabBranchFilter(record.branchId ?? 'ungrouped');
  }
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
  newKnowledgeNoteImages.value = [];
  newKnowledgeNoteBranchValue.value =
    activeKnowledgeBranchFilterId.value === 'all'
      ? BRANCH_UNGROUPED_VALUE
      : encodeBranchValue(
          activeKnowledgeBranchFilterId.value === 'ungrouped'
            ? null
            : activeKnowledgeBranchFilterId.value,
        );
}

function refreshKnowledgeData() {
  knowledgeBases.value = getKnowledgeBases();
  knowledgeNotes.value = getKnowledgeNotes();
  refreshRecordBranches();

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
    isSpecificBranchFilter(activeKnowledgeBranchFilterId.value) &&
    !activeKnowledgeBranches.value.some(
      (branch) => branch.id === activeKnowledgeBranchFilterId.value,
    )
  ) {
    activeKnowledgeBranchFilterId.value = 'all';
  }

  if (
    selectedKnowledgeNoteId.value &&
    !activeKnowledgeBaseNotes.value.some(
      (note) => note.id === selectedKnowledgeNoteId.value,
    )
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

function toggleKnowledgeBranchPanel() {
  knowledgeBranchPanelOpen.value = !knowledgeBranchPanelOpen.value;
}

function createKnowledgeBranch(parentId: string | null = null) {
  if (!activeKnowledgeBase.value) {
    return;
  }

  if (
    parentId &&
    getBranchDepth(activeKnowledgeBranches.value, parentId) >= MAX_BRANCH_DEPTH
  ) {
    window.alert(`分支最多支持 ${MAX_BRANCH_DEPTH} 层，当前分支下面不能继续新增。`);
    return;
  }

  const parentLabel = parentId
    ? `给「${getBranchPathLabel(activeKnowledgeBranches.value, parentId)}」新增子分支`
    : '新增知识分支';
  const branchName = promptForBranchName(parentLabel);

  if (!branchName) {
    return;
  }

  const branch = createRecordBranch({
    parkType: 'knowledge',
    containerId: activeKnowledgeBase.value.id,
    parentId,
    name: branchName,
  });

  if (!branch) {
    window.alert('分支创建失败，可能是名称为空，或者层级已经超过 4 层。');
    return;
  }

  refreshKnowledgeData();
  knowledgeBranchPanelOpen.value = true;
  setKnowledgeBranchFilter(branch.id);
}

function renameSelectedKnowledgeBranch() {
  if (!selectedKnowledgeBranch.value) {
    return;
  }

  const nextName = promptForBranchName(
    '重命名知识分支',
    selectedKnowledgeBranch.value.name,
  );

  if (!nextName) {
    return;
  }

  const updatedBranch = updateRecordBranch(selectedKnowledgeBranch.value.id, {
    name: nextName,
    description: selectedKnowledgeBranch.value.description,
    parentId: selectedKnowledgeBranch.value.parentId,
  });

  if (!updatedBranch) {
    window.alert('分支重命名失败。');
    return;
  }

  refreshKnowledgeData();
  setKnowledgeBranchFilter(updatedBranch.id);
}

function moveSelectedKnowledgeBranch() {
  if (!selectedKnowledgeBranch.value) {
    return;
  }

  const nextParentId = promptForBranchParent(
    selectedKnowledgeBranch.value.name,
    activeKnowledgeBranches.value,
    [
      selectedKnowledgeBranch.value.id,
      ...getBranchDescendantIds(
        activeKnowledgeBranches.value,
        selectedKnowledgeBranch.value.id,
      ),
    ],
    selectedKnowledgeBranch.value.parentId,
  );

  if (nextParentId === undefined) {
    return;
  }

  const updatedBranch = updateRecordBranch(selectedKnowledgeBranch.value.id, {
    name: selectedKnowledgeBranch.value.name,
    description: selectedKnowledgeBranch.value.description,
    parentId: nextParentId,
  });

  if (!updatedBranch) {
    window.alert(`移动失败。请确认目标分支存在，并且不会超过 ${MAX_BRANCH_DEPTH} 层。`);
    return;
  }

  refreshKnowledgeData();
  setKnowledgeBranchFilter(updatedBranch.id);
}

function archiveSelectedKnowledgeBranch() {
  if (!selectedKnowledgeBranch.value) {
    return;
  }

  const shouldArchive = window.confirm(
    `确定归档「${selectedKnowledgeBranch.value.name}」吗？这个分支和它下面的子分支会先从分支树里收起，记录不会被删除。`,
  );

  if (!shouldArchive) {
    return;
  }

  const archivedBranch = archiveRecordBranch(selectedKnowledgeBranch.value.id);

  if (!archivedBranch) {
    window.alert('分支归档失败。');
    return;
  }

  refreshKnowledgeData();
  setKnowledgeBranchFilter('all');
}

function restoreKnowledgeBranch(branch: RecordBranch) {
  const restoredBranch = unarchiveRecordBranch(branch.id);

  if (!restoredBranch) {
    window.alert('恢复分支失败。');
    return;
  }

  refreshKnowledgeData();
  knowledgeArchivedBranchesOpen.value = false;
  knowledgeBranchPanelOpen.value = true;
  setKnowledgeBranchFilter(restoredBranch.id);
}

function deleteSelectedKnowledgeBranch() {
  if (!activeKnowledgeBase.value || !selectedKnowledgeBranch.value) {
    return;
  }

  const shouldDelete = window.confirm(
    `确定删除「${selectedKnowledgeBranch.value.name}」吗？直属笔记会回到未分组，子分支会自动上移，不会删除任何笔记。`,
  );

  if (!shouldDelete) {
    return;
  }

  clearKnowledgeNoteBranchAssignments(
    activeKnowledgeBase.value.id,
    selectedKnowledgeBranch.value.id,
  );
  const deletedBranch = deleteRecordBranch(selectedKnowledgeBranch.value.id);

  if (!deletedBranch) {
    window.alert('删除分支失败。');
    return;
  }

  refreshKnowledgeData();
  setKnowledgeBranchFilter('all');
}

function selectKnowledgeBase(baseId: string) {
  activeKnowledgeBaseId.value = baseId;
  knowledgeDrawerOpen.value = false;
  activeKnowledgeBranchFilterId.value = 'all';
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
  activeKnowledgeBranchFilterId.value = 'all';
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
  activeKnowledgeBranchFilterId.value = 'all';
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
    branchId: decodeBranchValue(newKnowledgeNoteBranchValue.value),
    images: newKnowledgeNoteImages.value,
  });

  if (!note) {
    window.alert('笔记保存失败。请确认分支仍然可用，或减少图片后再试。');
    return;
  }

  ensureKnowledgeBranchFilterForNote(note);
  selectedKnowledgeNoteId.value = note.id;
  knowledgeInspectorMode.value = 'note-view';
  resetNewKnowledgeNoteForm();
  refreshKnowledgeData();
}

function selectKnowledgeNote(note: KnowledgeNote) {
  ensureKnowledgeBranchFilterForNote(note);
  selectedKnowledgeNoteId.value = note.id;
  knowledgeInspectorMode.value = 'note-view';
  resetNewKnowledgeNoteForm();
  cancelKnowledgeNoteEditing();
}

function isKnowledgeNoteExpanded(noteId: string): boolean {
  return (
    selectedKnowledgeNoteId.value === noteId &&
    (knowledgeInspectorMode.value === 'note-view' ||
      knowledgeInspectorMode.value === 'note-edit')
  );
}

function isKnowledgeNoteEditing(noteId: string): boolean {
  return (
    editingKnowledgeNoteId.value === noteId &&
    knowledgeInspectorMode.value === 'note-edit'
  );
}

function toggleKnowledgeNoteExpanded(note: KnowledgeNote) {
  if (hasActiveTextSelection() || isKnowledgeNoteEditing(note.id)) {
    return;
  }

  if (isKnowledgeNoteExpanded(note.id)) {
    showKnowledgeBaseSummary();
    return;
  }

  selectKnowledgeNote(note);
}

function startKnowledgeNoteEditing(note: KnowledgeNote) {
  ensureKnowledgeBranchFilterForNote(note);
  selectedKnowledgeNoteId.value = note.id;
  knowledgeInspectorMode.value = 'note-edit';
  editingKnowledgeNoteId.value = note.id;
  editingKnowledgeNoteTitle.value = note.title;
  editingKnowledgeNoteContent.value = note.content;
  editingKnowledgeNoteSourceUrl.value = note.sourceUrl;
  editingKnowledgeNoteTags.value = note.tags.join('，');
  editingKnowledgeNoteBranchValue.value = encodeBranchValue(note.branchId);
  editingKnowledgeNoteImages.value = [...note.images];
}

function cancelKnowledgeNoteEditing() {
  editingKnowledgeNoteId.value = null;
  editingKnowledgeNoteTitle.value = '';
  editingKnowledgeNoteContent.value = '';
  editingKnowledgeNoteSourceUrl.value = '';
  editingKnowledgeNoteTags.value = '';
  editingKnowledgeNoteBranchValue.value = BRANCH_UNGROUPED_VALUE;
  editingKnowledgeNoteImages.value = [];
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
    branchId: decodeBranchValue(editingKnowledgeNoteBranchValue.value),
    images: editingKnowledgeNoteImages.value,
  });

  if (!updatedNote) {
    window.alert('笔记更新失败。请确认分支仍然可用，或减少图片后再试。');
    return;
  }

  ensureKnowledgeBranchFilterForNote(updatedNote);
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

function toggleKnowledgeNotePinned(note: KnowledgeNote) {
  const shouldPin = !isPinned(note.pinnedAt);

  if (
    shouldPin &&
    activeKnowledgePinnedCount.value >= MAX_PINNED_KNOWLEDGE_NOTES_PER_BASE
  ) {
    window.alert(
      `每个知识库最多置顶 ${MAX_PINNED_KNOWLEDGE_NOTES_PER_BASE} 条笔记，请先取消其他置顶。`,
    );
    return;
  }

  const updatedNote = setKnowledgeNotePinned(note.id, shouldPin);

  if (!updatedNote) {
    window.alert(shouldPin ? '笔记置顶失败，请稍后再试。' : '取消置顶失败，请稍后再试。');
    return;
  }

  selectedKnowledgeNoteId.value = updatedNote.id;
  refreshKnowledgeData();
}

function toggleKnowledgeNoteFlag(note: KnowledgeNote) {
  const shouldFlag = !isFlagged(note.flaggedAt);
  const updatedNote = setKnowledgeNoteFlagged(note.id, shouldFlag);

  if (!updatedNote) {
    window.alert(shouldFlag ? '笔记 Flag 失败，请稍后再试。' : '取消笔记 Flag 失败，请稍后再试。');
    return;
  }

  selectedKnowledgeNoteId.value = updatedNote.id;
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
  newLabRecordImages.value = [];
  newLabRecordBranchValue.value =
    activeLabBranchFilterId.value === 'all'
      ? BRANCH_UNGROUPED_VALUE
      : encodeBranchValue(
          activeLabBranchFilterId.value === 'ungrouped'
            ? null
            : activeLabBranchFilterId.value,
        );
}

function refreshLabData() {
  labProjects.value = getLabProjects();
  labRecords.value = getLabRecords();
  refreshRecordBranches();

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
    isSpecificBranchFilter(activeLabBranchFilterId.value) &&
    !activeLabBranches.value.some(
      (branch) => branch.id === activeLabBranchFilterId.value,
    )
  ) {
    activeLabBranchFilterId.value = 'all';
  }

  if (
    selectedLabRecordId.value &&
    !activeLabProjectRecords.value.some(
      (record) => record.id === selectedLabRecordId.value,
    )
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

function toggleLabBranchPanel() {
  labBranchPanelOpen.value = !labBranchPanelOpen.value;
}

function createLabBranch(parentId: string | null = null) {
  if (!activeLabProject.value) {
    return;
  }

  if (
    parentId &&
    getBranchDepth(activeLabBranches.value, parentId) >= MAX_BRANCH_DEPTH
  ) {
    window.alert(`分支最多支持 ${MAX_BRANCH_DEPTH} 层，当前分支下面不能继续新增。`);
    return;
  }

  const parentLabel = parentId
    ? `给「${getBranchPathLabel(activeLabBranches.value, parentId)}」新增子分支`
    : '新增做记分支';
  const branchName = promptForBranchName(parentLabel);

  if (!branchName) {
    return;
  }

  const branch = createRecordBranch({
    parkType: 'lab',
    containerId: activeLabProject.value.id,
    parentId,
    name: branchName,
  });

  if (!branch) {
    window.alert('分支创建失败，可能是名称为空，或者层级已经超过 4 层。');
    return;
  }

  refreshLabData();
  labBranchPanelOpen.value = true;
  setLabBranchFilter(branch.id);
}

function renameSelectedLabBranch() {
  if (!selectedLabBranch.value) {
    return;
  }

  const nextName = promptForBranchName(
    '重命名做记分支',
    selectedLabBranch.value.name,
  );

  if (!nextName) {
    return;
  }

  const updatedBranch = updateRecordBranch(selectedLabBranch.value.id, {
    name: nextName,
    description: selectedLabBranch.value.description,
    parentId: selectedLabBranch.value.parentId,
  });

  if (!updatedBranch) {
    window.alert('分支重命名失败。');
    return;
  }

  refreshLabData();
  setLabBranchFilter(updatedBranch.id);
}

function moveSelectedLabBranch() {
  if (!selectedLabBranch.value) {
    return;
  }

  const nextParentId = promptForBranchParent(
    selectedLabBranch.value.name,
    activeLabBranches.value,
    [
      selectedLabBranch.value.id,
      ...getBranchDescendantIds(
        activeLabBranches.value,
        selectedLabBranch.value.id,
      ),
    ],
    selectedLabBranch.value.parentId,
  );

  if (nextParentId === undefined) {
    return;
  }

  const updatedBranch = updateRecordBranch(selectedLabBranch.value.id, {
    name: selectedLabBranch.value.name,
    description: selectedLabBranch.value.description,
    parentId: nextParentId,
  });

  if (!updatedBranch) {
    window.alert(`移动失败。请确认目标分支存在，并且不会超过 ${MAX_BRANCH_DEPTH} 层。`);
    return;
  }

  refreshLabData();
  setLabBranchFilter(updatedBranch.id);
}

function archiveSelectedLabBranch() {
  if (!selectedLabBranch.value) {
    return;
  }

  const shouldArchive = window.confirm(
    `确定归档「${selectedLabBranch.value.name}」吗？这个分支和它下面的子分支会先从分支树里收起，记录不会被删除。`,
  );

  if (!shouldArchive) {
    return;
  }

  const archivedBranch = archiveRecordBranch(selectedLabBranch.value.id);

  if (!archivedBranch) {
    window.alert('分支归档失败。');
    return;
  }

  refreshLabData();
  setLabBranchFilter('all');
}

function restoreLabBranch(branch: RecordBranch) {
  const restoredBranch = unarchiveRecordBranch(branch.id);

  if (!restoredBranch) {
    window.alert('恢复分支失败。');
    return;
  }

  refreshLabData();
  labArchivedBranchesOpen.value = false;
  labBranchPanelOpen.value = true;
  setLabBranchFilter(restoredBranch.id);
}

function deleteSelectedLabBranch() {
  if (!activeLabProject.value || !selectedLabBranch.value) {
    return;
  }

  const shouldDelete = window.confirm(
    `确定删除「${selectedLabBranch.value.name}」吗？直属记录会回到未分组，子分支会自动上移，不会删除任何做记记录。`,
  );

  if (!shouldDelete) {
    return;
  }

  clearLabRecordBranchAssignments(
    activeLabProject.value.id,
    selectedLabBranch.value.id,
  );
  const deletedBranch = deleteRecordBranch(selectedLabBranch.value.id);

  if (!deletedBranch) {
    window.alert('删除分支失败。');
    return;
  }

  refreshLabData();
  setLabBranchFilter('all');
}

function selectLabProject(projectId: string) {
  activeLabProjectId.value = projectId;
  labDrawerOpen.value = false;
  activeLabBranchFilterId.value = 'all';
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
  activeLabBranchFilterId.value = 'all';
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
  activeLabBranchFilterId.value = 'all';
  deleteTodosForNotes(
    'project',
    labRecords.value
      .filter((record) => record.projectId === project.id)
      .map((record) => record.id),
  );
  selectedLabRecordId.value = null;
  labInspectorMode.value = 'project';
  cancelLabRecordEditing();
  refreshLabData();
  refreshTodos();
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
    branchId: decodeBranchValue(newLabRecordBranchValue.value),
    images: newLabRecordImages.value,
  });

  if (!record) {
    window.alert('记录保存失败。请确认分支仍然可用，或减少图片后再试。');
    return;
  }

  ensureLabBranchFilterForRecord(record);
  selectedLabRecordId.value = record.id;
  labInspectorMode.value = 'record-view';
  resetNewLabRecordForm();
  refreshLabData();
}

function selectLabRecord(record: LabRecord) {
  ensureLabBranchFilterForRecord(record);
  selectedLabRecordId.value = record.id;
  labInspectorMode.value = 'record-view';
  resetNewLabRecordForm();
  cancelLabRecordEditing();
}

function isLabRecordExpanded(recordId: string): boolean {
  return (
    selectedLabRecordId.value === recordId &&
    (labInspectorMode.value === 'record-view' ||
      labInspectorMode.value === 'record-edit')
  );
}

function isLabRecordEditing(recordId: string): boolean {
  return (
    editingLabRecordId.value === recordId &&
    labInspectorMode.value === 'record-edit'
  );
}

function toggleLabRecordExpanded(record: LabRecord) {
  if (hasActiveTextSelection() || isLabRecordEditing(record.id)) {
    return;
  }

  if (isLabRecordExpanded(record.id)) {
    showLabProjectSummary();
    return;
  }

  selectLabRecord(record);
}

function handleLabRecordContentClick(record: LabRecord, event: MouseEvent) {
  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.closest('[data-todo-expand], [data-todo-id]')) {
    handleTodoContentClick(event);
    return;
  }

  toggleLabRecordExpanded(record);
}

function startLabRecordEditing(record: LabRecord) {
  ensureLabBranchFilterForRecord(record);
  selectedLabRecordId.value = record.id;
  labInspectorMode.value = 'record-edit';
  editingLabRecordId.value = record.id;
  editingLabRecordTitle.value = record.title;
  editingLabRecordContent.value = record.content;
  editingLabRecordType.value = record.type;
  editingLabRecordTags.value = record.tags.join('，');
  editingLabRecordBranchValue.value = encodeBranchValue(record.branchId);
  editingLabRecordImages.value = [...record.images];
}

function cancelLabRecordEditing() {
  editingLabRecordId.value = null;
  editingLabRecordTitle.value = '';
  editingLabRecordContent.value = '';
  editingLabRecordType.value = 'operation';
  editingLabRecordTags.value = '';
  editingLabRecordBranchValue.value = BRANCH_UNGROUPED_VALUE;
  editingLabRecordImages.value = [];
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
    branchId: decodeBranchValue(editingLabRecordBranchValue.value),
    images: editingLabRecordImages.value,
  });

  if (!updatedRecord) {
    window.alert('记录更新失败。请确认分支仍然可用，或减少图片后再试。');
    return;
  }

  ensureLabBranchFilterForRecord(updatedRecord);
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
  deleteTodosForNote('project', record.id);

  if (
    editingLabRecordId.value === record.id ||
    selectedLabRecordId.value === record.id
  ) {
    selectedLabRecordId.value = null;
    labInspectorMode.value = 'project';
    cancelLabRecordEditing();
  }

  refreshLabData();
  refreshTodos();
}

function toggleLabRecordPinned(record: LabRecord) {
  const shouldPin = !isPinned(record.pinnedAt);

  if (
    shouldPin &&
    activeLabPinnedCount.value >= MAX_PINNED_LAB_RECORDS_PER_PROJECT
  ) {
    window.alert(
      `每个做记项目最多置顶 ${MAX_PINNED_LAB_RECORDS_PER_PROJECT} 条记录，请先取消其他置顶。`,
    );
    return;
  }

  const updatedRecord = setLabRecordPinned(record.id, shouldPin);

  if (!updatedRecord) {
    window.alert(shouldPin ? '记录置顶失败，请稍后再试。' : '取消置顶失败，请稍后再试。');
    return;
  }

  selectedLabRecordId.value = updatedRecord.id;
  refreshLabData();
}

function toggleLabRecordFlag(record: LabRecord) {
  const shouldFlag = !isFlagged(record.flaggedAt);
  const updatedRecord = setLabRecordFlagged(record.id, shouldFlag);

  if (!updatedRecord) {
    window.alert(shouldFlag ? '记录 Flag 失败，请稍后再试。' : '取消记录 Flag 失败，请稍后再试。');
    return;
  }

  selectedLabRecordId.value = updatedRecord.id;
  refreshLabData();
}

function runCardAction(actionId: CardActionId) {
  const target = resolvedCardActionMenuTarget.value;

  if (!target) {
    closeCardActionMenu();
    return;
  }

  closeCardActionMenu();

  if (target.kind === 'journal') {
    if (actionId === 'flag') {
      toggleJournalEntryFlag(target.record);
      return;
    }

    if (actionId === 'todo') {
      toggleCardTodoFromMenu('journal', target.record.id, target.record.title);
      return;
    }

    if (actionId === 'reminder') {
      openJournalReminderComposer(target.record);
      return;
    }

    if (actionId === 'edit') {
      startEditing(target.record);
      return;
    }

    if (actionId === 'delete') {
      removeEntry(target.record);
    }

    return;
  }

  if (target.kind === 'knowledge') {
    if (actionId === 'flag') {
      toggleKnowledgeNoteFlag(target.record);
      return;
    }

    if (actionId === 'pin') {
      toggleKnowledgeNotePinned(target.record);
      return;
    }

    if (actionId === 'reminder') {
      openKnowledgeReminderComposer(target.record);
      return;
    }

    if (actionId === 'edit') {
      startKnowledgeNoteEditing(target.record);
      return;
    }

    if (actionId === 'delete') {
      removeKnowledgeNote(target.record);
    }

    return;
  }

  if (actionId === 'flag') {
    toggleLabRecordFlag(target.record);
    return;
  }

  if (actionId === 'pin') {
    toggleLabRecordPinned(target.record);
    return;
  }

  if (actionId === 'todo') {
    toggleCardTodoFromMenu('project', target.record.id, target.record.title);
    return;
  }

  if (actionId === 'reminder') {
    openLabReminderComposer(target.record);
    return;
  }

  if (actionId === 'edit') {
    startLabRecordEditing(target.record);
    return;
  }

  if (actionId === 'delete') {
    removeLabRecord(target.record);
  }
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
  if (activePark.value === 'vault' && park !== 'vault' && isVaultUnlocked.value) {
    lockVault('密库已自动上锁。');
  }

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
    draftImages.value,
  );

  if (!entry) {
    window.alert('保存失败。可以试试减少图片后再保存。');
    return;
  }

  draftTitle.value = '';
  draftContent.value = '';
  draftImages.value = [];
  selectedDateKey.value = entry.entryDate;
  calendarMonth.value = startOfMonth(new Date(`${entry.entryDate}T00:00:00`));
  refreshEntries();
}

function startEditing(entry: JournalEntry) {
  setJournalEntryExpanded(entry.id, false);
  editingId.value = entry.id;
  editingContent.value = entry.content;
  editingEntryDate.value = getJournalEntryDateKey(entry);
  editingImages.value = [...entry.images];
}

function cancelEditing() {
  editingId.value = null;
  editingContent.value = '';
  editingEntryDate.value = '';
  editingImages.value = [];
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
    images: editingImages.value,
  });

  if (!updated) {
    window.alert('更新失败。可以试试减少图片后再保存。');
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
  setJournalEntryExpanded(entry.id, false);
  void cancelTargetReminders('journal-entry', entry.id);
  deleteTodosForNote('journal', entry.id);

  if (editingId.value === entry.id) {
    cancelEditing();
  }

  refreshEntries();
  refreshTodos();
}

function toggleJournalEntryFlag(entry: JournalEntry) {
  const shouldFlag = !isFlagged(entry.flaggedAt);
  const updatedEntry = setEntryFlagged(entry.id, shouldFlag);

  if (!updatedEntry) {
    window.alert(shouldFlag ? 'Flag 失败，请稍后再试。' : '取消 Flag 失败，请稍后再试。');
    return;
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

function readSavedAgentPosition(): { x: number; y: number } | null {
  try {
    const rawPosition = localStorage.getItem(AGENT_POSITION_STORAGE_KEY);

    if (!rawPosition) {
      return null;
    }

    const parsedPosition: unknown = JSON.parse(rawPosition);

    if (
      typeof parsedPosition !== 'object' ||
      parsedPosition === null ||
      typeof (parsedPosition as { x?: unknown }).x !== 'number' ||
      typeof (parsedPosition as { y?: unknown }).y !== 'number'
    ) {
      return null;
    }

    return {
      x: (parsedPosition as { x: number }).x,
      y: (parsedPosition as { y: number }).y,
    };
  } catch {
    return null;
  }
}

function saveAgentPosition() {
  try {
    localStorage.setItem(
      AGENT_POSITION_STORAGE_KEY,
      JSON.stringify(agentFabPosition.value),
    );
  } catch {
    // Position persistence is nice-to-have; dragging should still work.
  }
}

function getAgentFabSize(): { width: number; height: number } {
  const fabRect = agentFabRef.value?.getBoundingClientRect();

  return {
    width: fabRect?.width ?? AGENT_FAB_DEFAULT_WIDTH,
    height: fabRect?.height ?? AGENT_FAB_DEFAULT_HEIGHT,
  };
}

function clampAgentPosition(position: { x: number; y: number }): { x: number; y: number } {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const fabSize = getAgentFabSize();
  const maxX = Math.max(
    AGENT_FAB_SAFE_MARGIN,
    viewportWidth - fabSize.width - AGENT_FAB_SAFE_MARGIN,
  );
  const maxY = Math.max(
    AGENT_FAB_SAFE_MARGIN,
    viewportHeight - fabSize.height - AGENT_FAB_SAFE_MARGIN,
  );

  return {
    x: Math.min(Math.max(position.x, AGENT_FAB_SAFE_MARGIN), maxX),
    y: Math.min(Math.max(position.y, AGENT_FAB_SAFE_MARGIN), maxY),
  };
}

function updateAgentViewportSize() {
  agentViewportSize.value = {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function initializeAgentFabPosition() {
  updateAgentViewportSize();

  const fabSize = getAgentFabSize();
  const savedPosition = readSavedAgentPosition();
  const defaultPosition = {
    x: window.innerWidth - fabSize.width - 20,
    y: window.innerHeight - fabSize.height - 20,
  };

  agentFabPosition.value = clampAgentPosition(savedPosition ?? defaultPosition);
  agentPositionReady.value = true;
  saveAgentPosition();
}

function handleAgentViewportResize() {
  updateAgentViewportSize();
  agentFabPosition.value = clampAgentPosition(agentFabPosition.value);
  saveAgentPosition();
}

function handleAgentFabPointerDown(event: PointerEvent) {
  if (event.button !== 0) {
    return;
  }

  const target = event.currentTarget;

  if (target instanceof HTMLElement) {
    target.setPointerCapture(event.pointerId);
  }

  agentDragState.value = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    initialX: agentFabPosition.value.x,
    initialY: agentFabPosition.value.y,
    moved: false,
  };
}

function handleAgentFabPointerMove(event: PointerEvent) {
  const dragState = agentDragState.value;

  if (!dragState || dragState.pointerId !== event.pointerId) {
    return;
  }

  const deltaX = event.clientX - dragState.startX;
  const deltaY = event.clientY - dragState.startY;
  const hasMoved =
    Math.abs(deltaX) > AGENT_DRAG_THRESHOLD ||
    Math.abs(deltaY) > AGENT_DRAG_THRESHOLD;

  if (!dragState.moved && !hasMoved) {
    return;
  }

  event.preventDefault();
  dragState.moved = true;
  agentFabPosition.value = clampAgentPosition({
    x: dragState.initialX + deltaX,
    y: dragState.initialY + deltaY,
  });
}

function finishAgentFabDrag(event: PointerEvent) {
  const dragState = agentDragState.value;

  if (!dragState || dragState.pointerId !== event.pointerId) {
    return;
  }

  const target = event.currentTarget;

  if (target instanceof HTMLElement) {
    target.releasePointerCapture(event.pointerId);
  }

  if (dragState.moved) {
    agentSuppressClick.value = true;
    saveAgentPosition();
    window.setTimeout(() => {
      agentSuppressClick.value = false;
    }, 120);
  }

  agentDragState.value = null;
}

function toggleAgentPanel() {
  agentPanelOpen.value = !agentPanelOpen.value;
}

function handleAgentFabClick() {
  if (agentSuppressClick.value) {
    return;
  }

  toggleAgentPanel();
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
      activeKnowledgeBranchFilterId: activeKnowledgeBranchFilterId.value,
      selectedKnowledgeNoteId: selectedKnowledgeNote.value?.id ?? null,
      activeLabProjectId: activeLabProject.value?.id ?? null,
      activeLabBranchFilterId: activeLabBranchFilterId.value,
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
        const mutatedNote =
          knowledgeNotes.value.find((note) => note.id === result.mutatedKnowledgeNoteId) ??
          null;
        activePark.value = 'knowledge';
        if (mutatedNote) {
          ensureKnowledgeBranchFilterForNote(mutatedNote);
        }
        selectedKnowledgeNoteId.value = result.mutatedKnowledgeNoteId;
        knowledgeInspectorMode.value = 'note-view';
      }

      if (result.mutatedLabProjectId) {
        activeLabProjectId.value = result.mutatedLabProjectId;
      }

      if (result.mutatedLabRecordId) {
        const mutatedRecord =
          labRecords.value.find((record) => record.id === result.mutatedLabRecordId) ??
          null;
        activePark.value = 'lab';
        if (mutatedRecord) {
          ensureLabBranchFilterForRecord(mutatedRecord);
        }
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

let removeReminderNotificationActionListener: (() => void) | null = null;
let weatherRefreshTimer: number | null = null;
let weatherAbortController: AbortController | null = null;

onMounted(() => {
  document.addEventListener('selectionchange', captureTodoSelectionFromWindow);
  document.addEventListener('pointerdown', handleCardActionMenuPointerDown);
  document.addEventListener('keydown', handleCardActionMenuEscape);
  document.addEventListener('visibilitychange', handleDocumentVisibilityChange);
  window.addEventListener('scroll', handleCardActionMenuViewportChange, true);
  window.addEventListener('resize', handleCardActionMenuViewportChange);
  window.addEventListener('resize', handleAgentViewportResize);
  void nextTick(initializeAgentFabPosition);
  void refreshJournalWeather();
  scheduleWeatherRefresh();
  void syncDailyJournalReminderOnLaunch();
  void listenForReminderNotificationActions((action) => {
    if (action.kind === 'daily-journal-reminder') {
      openDailyJournalReminderComposer();
      return;
    }

    if (action.reminderId) {
      focusReminderById(action.reminderId);
    }
  }).then((removeListener) => {
    removeReminderNotificationActionListener = removeListener;
  });
});

onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', captureTodoSelectionFromWindow);
  document.removeEventListener('pointerdown', handleCardActionMenuPointerDown);
  document.removeEventListener('keydown', handleCardActionMenuEscape);
  document.removeEventListener('visibilitychange', handleDocumentVisibilityChange);
  window.removeEventListener('scroll', handleCardActionMenuViewportChange, true);
  window.removeEventListener('resize', handleCardActionMenuViewportChange);
  window.removeEventListener('resize', handleAgentViewportResize);
  removeReminderNotificationActionListener?.();
  removeReminderNotificationActionListener = null;
  weatherAbortController?.abort();
  weatherAbortController = null;
  clearWeatherRefreshTimer();
  clearTodoCompletionTimer();
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
            <div class="hero-content-stack">
              <div class="hero-headline-row">
                <div class="hero-title-block">
                <h1 id="app-title">{{ activeParkSummary.title }}</h1>
                </div>

                <JournalWeatherHeroCard
                  v-if="activePark === 'journal'"
                  class="hero-weather-inline"
                  :snapshot="journalWeatherSnapshot"
                  :loading="journalWeatherLoading"
                  :meta-text="journalWeatherMetaText"
                  @retry="refreshJournalWeather"
                />
              </div>

              <p class="today-line">{{ activeParkSummary.description }}</p>
            </div>
          </div>
        </template>
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

      <div class="record-image-toolbar">
        <button
          class="ghost-action"
          type="button"
          :disabled="isImportingImages('journal-draft') || draftImages.length >= MAX_RECORD_IMAGES"
          @click="openImageImporter('journal-draft')"
        >
          {{ isImportingImages('journal-draft') ? '导入中...' : '导入图片' }}
        </button>
        <small>最多 {{ MAX_RECORD_IMAGES }} 张，导入后会自动压缩并保存在本地。</small>
      </div>

      <div v-if="draftImages.length > 0" class="record-image-grid is-editor">
        <div v-for="image in draftImages" :key="image.id" class="record-image-card is-editor">
          <button
            class="record-image-button"
            type="button"
            :aria-label="`预览 ${image.name}`"
            @click="openRecordImagePreview(image)"
          >
            <img :src="image.dataUrl" :alt="image.name" />
          </button>
          <button
            class="record-image-remove"
            type="button"
            @click="removeImportedImage('journal-draft', image.id)"
          >
            移除
          </button>
        </div>
      </div>

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

      <div class="search-input-row">
        <input
          ref="searchInputRef"
          v-model="searchQuery"
          class="search-input"
          type="search"
          placeholder="搜索关键词，例如：iCloud / 工作 / 灵感"
          @keydown.escape.stop="clearSearchQuery"
        />
        <button
          v-if="searchQuery.trim().length > 0"
          class="search-clear-button"
          type="button"
          @click="clearSearchQuery"
        >
          清空
        </button>
      </div>

      <div v-if="searchKeywords.length === 0" class="empty-state">
        <p>输入关键词开始查找。</p>
        <span>会同时搜索标题、正文和未来的标签。</span>
      </div>

      <div v-else-if="searchResults.length === 0" class="empty-state">
        <p>没有找到匹配日志。</p>
        <span>换一个关键词试试，或者回到时间线继续记录。</span>
      </div>

      <div v-else class="entry-groups search-results">
        <article
          v-for="result in searchResults"
          :key="result.entry.id"
          class="entry-card"
          :data-reminder-target="`journal-entry:${result.entry.id}`"
          :data-todo-source="`journal:${result.entry.id}`"
          :class="{
            'is-expanded': isJournalEntryExpanded(result.entry.id),
            'is-flagged': isFlagged(result.entry.flaggedAt),
            'is-reminder-target': isReminderHighlighted('journal-entry', result.entry.id),
            'is-todo-highlighted': isCardTodoHighlighted('journal', result.entry.id),
          }"
        >
          <template v-if="editingId === result.entry.id">
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
            <div class="record-image-toolbar">
              <button
                class="ghost-action"
                type="button"
                :disabled="isImportingImages('journal-edit') || editingImages.length >= MAX_RECORD_IMAGES"
                @click="openImageImporter('journal-edit')"
              >
                {{ isImportingImages('journal-edit') ? '导入中...' : '导入图片' }}
              </button>
              <small>最多 {{ MAX_RECORD_IMAGES }} 张。</small>
            </div>
            <div v-if="editingImages.length > 0" class="record-image-grid is-editor">
              <div v-for="image in editingImages" :key="image.id" class="record-image-card is-editor">
                <button
                  class="record-image-button"
                  type="button"
                  :aria-label="`预览 ${image.name}`"
                  @click="openRecordImagePreview(image)"
                >
                  <img :src="image.dataUrl" :alt="image.name" />
                </button>
                <button
                  class="record-image-remove"
                  type="button"
                  @click="removeImportedImage('journal-edit', image.id)"
                >
                  移除
                </button>
              </div>
            </div>
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
            <div
              v-if="getCardTodo('journal', result.entry.id)"
              class="todo-card-strip"
              :data-todo-target="getCardTodo('journal', result.entry.id)?.id"
            >
              <button
                class="todo-card-toggle"
                type="button"
                @click="toggleCardTodo('journal', result.entry.id)"
              >
                {{ getCardTodoIcon('journal', result.entry.id) }}
              </button>
              <span>卡片待办</span>
              <small v-if="isCardTodoDone('journal', result.entry.id)">
                {{ getCardTodoDoneLabel('journal', result.entry.id) }}
              </small>
            </div>
            <div
              class="entry-body selectable-entry-body"
              @click="toggleJournalEntryExpanded(result.entry.id)"
            >
              <span class="entry-time">
                {{ getJournalEntryDateLabel(result.entry) }} · 创建 {{ formatEntryTime(result.entry.createdAt) }}
              </span>
              <div class="entry-title-row">
                <strong v-html="result.titleHtml"></strong>
                <div class="entry-title-actions">
                  <div v-if="isFlagged(result.entry.flaggedAt)" class="entry-title-badges">
                    <span class="flag-pill" aria-label="已标记重要">⚑</span>
                  </div>
                  <button
                    class="card-menu-trigger"
                    :class="{ 'is-open': isCardActionMenuOpenFor({ kind: 'journal', entryId: result.entry.id }) }"
                    type="button"
                    aria-haspopup="menu"
                    :aria-expanded="isCardActionMenuOpenFor({ kind: 'journal', entryId: result.entry.id })"
                    aria-label="打开这条心记的操作菜单"
                    @click.stop="toggleCardActionMenu({ kind: 'journal', entryId: result.entry.id }, $event)"
                  >
                    ⋯
                  </button>
                </div>
              </div>
              <p
                v-if="result.previewHtml || result.fullContentHtml"
                class="search-result-preview"
                v-html="
                  isJournalEntryExpanded(result.entry.id)
                    ? result.fullContentHtml
                    : result.previewHtml
                "
              ></p>
              <div
                v-if="isJournalEntryExpanded(result.entry.id) && result.entry.images.length > 0"
                class="record-image-grid"
              >
                <button
                  v-for="image in result.entry.images"
                  :key="image.id"
                  class="record-image-button"
                  type="button"
                  :aria-label="`查看 ${image.name}`"
                  @click.stop="openRecordImagePreview(image)"
                >
                  <img :src="image.dataUrl" :alt="image.name" />
                </button>
              </div>
              <div
                v-if="result.matchedTagsHtml.length > 0"
                class="search-tag-hit-list"
              >
                <span class="search-hit-label">匹配标签</span>
                <span
                  v-for="(tagHtml, index) in result.matchedTagsHtml"
                  :key="`${result.entry.id}-tag-${index}`"
                  class="search-tag-hit"
                  v-html="tagHtml"
                ></span>
              </div>
            </div>

            <div
              v-if="getUnresolvedSentenceTodos('journal', result.entry.id, result.entry.content).length > 0"
              class="todo-unresolved"
            >
              <span>
                有 {{ getUnresolvedSentenceTodos('journal', result.entry.id, result.entry.content).length }} 个待办无法定位
              </span>
              <button
                type="button"
                @click="showUnresolvedTodoOriginals('journal', result.entry.id, result.entry.content)"
              >
                查看原文
              </button>
              <button
                type="button"
                @click="removeUnresolvedSentenceTodos('journal', result.entry.id, result.entry.content)"
              >
                删除
              </button>
            </div>

            <div class="entry-footer">
              <span class="entry-footnote">
                {{ result.entry.content.length }} 字
                <i
                  v-if="isFutureDateKey(getJournalEntryDateKey(result.entry))"
                  class="future-entry-badge"
                >
                  未来
                </i>
              </span>
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
          :data-todo-source="`journal:${entry.id}`"
          :class="{
            'is-expanded': isJournalEntryExpanded(entry.id),
            'is-flagged': isFlagged(entry.flaggedAt),
            'is-reminder-target': isReminderHighlighted('journal-entry', entry.id),
            'is-todo-highlighted': isCardTodoHighlighted('journal', entry.id),
          }"
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
              <div class="record-image-toolbar">
                <button
                  class="ghost-action"
                  type="button"
                  :disabled="isImportingImages('journal-edit') || editingImages.length >= MAX_RECORD_IMAGES"
                  @click="openImageImporter('journal-edit')"
                >
                  {{ isImportingImages('journal-edit') ? '导入中...' : '导入图片' }}
                </button>
                <small>最多 {{ MAX_RECORD_IMAGES }} 张。</small>
              </div>
              <div v-if="editingImages.length > 0" class="record-image-grid is-editor">
                <div v-for="image in editingImages" :key="image.id" class="record-image-card is-editor">
                  <button
                    class="record-image-button"
                    type="button"
                    :aria-label="`预览 ${image.name}`"
                    @click="openRecordImagePreview(image)"
                  >
                    <img :src="image.dataUrl" :alt="image.name" />
                  </button>
                  <button
                    class="record-image-remove"
                    type="button"
                    @click="removeImportedImage('journal-edit', image.id)"
                  >
                    移除
                  </button>
                </div>
              </div>
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
              <div
                v-if="getCardTodo('journal', entry.id)"
                class="todo-card-strip"
                :data-todo-target="getCardTodo('journal', entry.id)?.id"
              >
                <button
                  class="todo-card-toggle"
                  type="button"
                  @click="toggleCardTodo('journal', entry.id)"
                >
                  {{ getCardTodoIcon('journal', entry.id) }}
                </button>
                <span>卡片待办</span>
                <small v-if="isCardTodoDone('journal', entry.id)">
                  {{ getCardTodoDoneLabel('journal', entry.id) }}
                </small>
              </div>
              <div
                class="entry-body selectable-entry-body"
                @click="toggleJournalEntryExpanded(entry.id)"
              >
                <span class="entry-time">创建 {{ formatEntryTime(entry.createdAt) }}</span>
                <div class="entry-title-row">
                  <strong>{{ entry.title }}</strong>
                  <div class="entry-title-actions">
                    <div v-if="isFlagged(entry.flaggedAt)" class="entry-title-badges">
                      <span class="flag-pill" aria-label="已标记重要">⚑</span>
                    </div>
                    <button
                      class="card-menu-trigger"
                      :class="{ 'is-open': isCardActionMenuOpenFor({ kind: 'journal', entryId: entry.id }) }"
                      type="button"
                      aria-haspopup="menu"
                      :aria-expanded="isCardActionMenuOpenFor({ kind: 'journal', entryId: entry.id })"
                      aria-label="打开这条心记的操作菜单"
                      @click.stop="toggleCardActionMenu({ kind: 'journal', entryId: entry.id }, $event)"
                    >
                      ⋯
                    </button>
                  </div>
                </div>
                <p
                  @click.stop="handleJournalEntryContentClick(entry.id, $event)"
                  v-html="renderTodoContent(entry.content, 'journal', entry.id, 'journal-entry')"
                ></p>
                <div
                  v-if="isJournalEntryExpanded(entry.id) && entry.images.length > 0"
                  class="record-image-grid"
                >
                  <button
                    v-for="image in entry.images"
                    :key="image.id"
                    class="record-image-button"
                    type="button"
                    :aria-label="`查看 ${image.name}`"
                    @click.stop="openRecordImagePreview(image)"
                  >
                    <img :src="image.dataUrl" :alt="image.name" />
                  </button>
                </div>
              </div>

              <div
                v-if="getUnresolvedSentenceTodos('journal', entry.id, entry.content).length > 0"
                class="todo-unresolved"
              >
                <span>
                  有 {{ getUnresolvedSentenceTodos('journal', entry.id, entry.content).length }} 个待办无法定位
                </span>
                <button type="button" @click="showUnresolvedTodoOriginals('journal', entry.id, entry.content)">
                  查看原文
                </button>
                <button type="button" @click="removeUnresolvedSentenceTodos('journal', entry.id, entry.content)">
                  删除
                </button>
              </div>

              <div class="entry-footer">
                <span class="entry-footnote">
                  {{ entry.content.length }} 字
                  <i v-if="isFutureDateKey(getJournalEntryDateKey(entry))" class="future-entry-badge">
                    未来
                  </i>
                </span>
              </div>
            </template>
          </article>
        </div>

        <section
          v-if="selectedDateCompletedEntryItems.length > 0"
          class="completed-todo-group"
        >
          <button
            class="completed-todo-heading"
            type="button"
            @click="selectedDateCompletedOpen = !selectedDateCompletedOpen"
          >
            <span>{{ selectedDateCompletedOpen ? '▾' : '▸' }} 已完成</span>
            <small>{{ selectedDateCompletedEntryItems.length }}</small>
          </button>
          <div v-if="selectedDateCompletedOpen" class="completed-todo-actions">
            <button class="delete-action" type="button" @click="clearSelectedDateDoneCardTodos">
              清空已完成
            </button>
          </div>
          <div v-if="selectedDateCompletedOpen" class="entry-groups">
          <article
            v-for="item in selectedDateCompletedEntryItems"
            :key="item.todo.id"
            class="entry-card is-todo-done"
            :data-todo-source="`journal:${item.entry.id}`"
            :data-todo-target="item.todo.id"
            :class="{
              'is-expanded': isJournalEntryExpanded(item.entry.id),
              'is-flagged': isFlagged(item.entry.flaggedAt),
            }"
          >
              <div class="todo-card-strip is-done">
                <button
                  class="todo-card-toggle is-done"
                  type="button"
                  @click="toggleTodoStatus(item.todo)"
                >
                  {{ getTodoStatusIcon(item.todo) }}
                </button>
                <span>卡片待办</span>
                <small>{{ formatTodoDateTime(item.todo.doneAt) }} 完成</small>
              </div>
              <div
                class="entry-body selectable-entry-body"
                @click="toggleJournalEntryExpanded(item.entry.id)"
              >
              <span class="entry-time">创建 {{ formatEntryTime(item.entry.createdAt) }}</span>
              <div class="entry-title-row">
                <strong>{{ item.entry.title }}</strong>
                <div class="entry-title-actions">
                  <div v-if="isFlagged(item.entry.flaggedAt)" class="entry-title-badges">
                    <span class="flag-pill" aria-label="已标记重要">⚑</span>
                  </div>
                  <button
                    class="card-menu-trigger"
                    :class="{ 'is-open': isCardActionMenuOpenFor({ kind: 'journal', entryId: item.entry.id }) }"
                    type="button"
                    aria-haspopup="menu"
                    :aria-expanded="isCardActionMenuOpenFor({ kind: 'journal', entryId: item.entry.id })"
                    aria-label="打开这条心记的操作菜单"
                    @click.stop="toggleCardActionMenu({ kind: 'journal', entryId: item.entry.id }, $event)"
                  >
                    ⋯
                  </button>
                </div>
              </div>
                <p
                  @click.stop="handleJournalEntryContentClick(item.entry.id, $event)"
                  v-html="renderTodoContent(item.entry.content, 'journal', item.entry.id, 'journal-entry')"
                ></p>
              </div>
            </article>
          </div>
        </section>
      </div>
    </section>

    <section v-if="activeView === 'timeline'" class="timeline" aria-labelledby="timeline-title">
      <h2 id="timeline-title" class="journal-section-title">日志时间线</h2>

      <label
        v-if="hasDoneSentenceTodosForPark('journal')"
        class="todo-hide-toggle"
      >
        <input v-model="hideDoneSentenceTodos" type="checkbox" />
        <span>隐藏已完成的句子待办</span>
      </label>

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
            :data-todo-source="`journal:${entry.id}`"
            :class="{
              'is-expanded': isJournalEntryExpanded(entry.id),
              'is-flagged': isFlagged(entry.flaggedAt),
              'is-reminder-target': isReminderHighlighted('journal-entry', entry.id),
              'is-todo-highlighted': isCardTodoHighlighted('journal', entry.id),
            }"
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
              <div class="record-image-toolbar">
                <button
                  class="ghost-action"
                  type="button"
                  :disabled="isImportingImages('journal-edit') || editingImages.length >= MAX_RECORD_IMAGES"
                  @click="openImageImporter('journal-edit')"
                >
                  {{ isImportingImages('journal-edit') ? '导入中...' : '导入图片' }}
                </button>
                <small>最多 {{ MAX_RECORD_IMAGES }} 张。</small>
              </div>
              <div v-if="editingImages.length > 0" class="record-image-grid is-editor">
                <div v-for="image in editingImages" :key="image.id" class="record-image-card is-editor">
                  <button
                    class="record-image-button"
                    type="button"
                    :aria-label="`预览 ${image.name}`"
                    @click="openRecordImagePreview(image)"
                  >
                    <img :src="image.dataUrl" :alt="image.name" />
                  </button>
                  <button
                    class="record-image-remove"
                    type="button"
                    @click="removeImportedImage('journal-edit', image.id)"
                  >
                    移除
                  </button>
                </div>
              </div>
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
              <div
                v-if="getCardTodo('journal', entry.id)"
                class="todo-card-strip"
                :data-todo-target="getCardTodo('journal', entry.id)?.id"
              >
                <button
                  class="todo-card-toggle"
                  type="button"
                  @click="toggleCardTodo('journal', entry.id)"
                >
                  {{ getCardTodoIcon('journal', entry.id) }}
                </button>
                <span>卡片待办</span>
                <small v-if="isCardTodoDone('journal', entry.id)">
                  {{ getCardTodoDoneLabel('journal', entry.id) }}
                </small>
              </div>
              <div
                class="entry-body selectable-entry-body"
                @click="toggleJournalEntryExpanded(entry.id)"
              >
                <span class="entry-time">创建 {{ formatEntryTime(entry.createdAt) }}</span>
                <div class="entry-title-row">
                  <strong>{{ entry.title }}</strong>
                  <div class="entry-title-actions">
                    <div v-if="isFlagged(entry.flaggedAt)" class="entry-title-badges">
                      <span class="flag-pill" aria-label="已标记重要">⚑</span>
                    </div>
                    <button
                      class="card-menu-trigger"
                      :class="{ 'is-open': isCardActionMenuOpenFor({ kind: 'journal', entryId: entry.id }) }"
                      type="button"
                      aria-haspopup="menu"
                      :aria-expanded="isCardActionMenuOpenFor({ kind: 'journal', entryId: entry.id })"
                      aria-label="打开这条心记的操作菜单"
                      @click.stop="toggleCardActionMenu({ kind: 'journal', entryId: entry.id }, $event)"
                    >
                      ⋯
                    </button>
                  </div>
                </div>
                <p
                  @click.stop="handleJournalEntryContentClick(entry.id, $event)"
                  v-html="renderTodoContent(entry.content, 'journal', entry.id, 'journal-entry')"
                ></p>
                <div
                  v-if="isJournalEntryExpanded(entry.id) && entry.images.length > 0"
                  class="record-image-grid"
                >
                  <button
                    v-for="image in entry.images"
                    :key="image.id"
                    class="record-image-button"
                    type="button"
                    :aria-label="`查看 ${image.name}`"
                    @click.stop="openRecordImagePreview(image)"
                  >
                    <img :src="image.dataUrl" :alt="image.name" />
                  </button>
                </div>
              </div>

              <div
                v-if="getUnresolvedSentenceTodos('journal', entry.id, entry.content).length > 0"
                class="todo-unresolved"
              >
                <span>
                  有 {{ getUnresolvedSentenceTodos('journal', entry.id, entry.content).length }} 个待办无法定位
                </span>
                <button type="button" @click="showUnresolvedTodoOriginals('journal', entry.id, entry.content)">
                  查看原文
                </button>
                <button type="button" @click="removeUnresolvedSentenceTodos('journal', entry.id, entry.content)">
                  删除
                </button>
              </div>

              <div class="entry-footer">
                <span class="entry-footnote">
                  {{ entry.content.length }} 字
                  <i v-if="isFutureDateKey(getJournalEntryDateKey(entry))" class="future-entry-badge">
                    未来
                  </i>
                </span>
              </div>
            </template>
          </article>
        </section>
      </div>

      <section
        v-if="completedJournalEntryItems.length > 0"
        class="completed-todo-group"
      >
        <button
          class="completed-todo-heading"
          type="button"
          @click="journalCompletedOpen = !journalCompletedOpen"
        >
          <span>{{ journalCompletedOpen ? '▾' : '▸' }} 已完成</span>
          <small>{{ completedJournalEntryItems.length }}</small>
        </button>
        <div v-if="journalCompletedOpen" class="completed-todo-actions">
          <button class="delete-action" type="button" @click="clearJournalDoneCardTodos">
            清空已完成
          </button>
        </div>
        <div v-if="journalCompletedOpen" class="entry-groups">
          <article
            v-for="item in completedJournalEntryItems"
            :key="item.todo.id"
            class="entry-card is-todo-done"
            :data-todo-source="`journal:${item.entry.id}`"
            :data-todo-target="item.todo.id"
            :class="{
              'is-expanded': isJournalEntryExpanded(item.entry.id),
              'is-flagged': isFlagged(item.entry.flaggedAt),
            }"
          >
            <div class="todo-card-strip is-done">
              <button
                class="todo-card-toggle is-done"
                type="button"
                @click="toggleTodoStatus(item.todo)"
              >
                {{ getTodoStatusIcon(item.todo) }}
              </button>
              <span>卡片待办</span>
              <small>{{ formatTodoDateTime(item.todo.doneAt) }} 完成</small>
            </div>
            <div
              class="entry-body selectable-entry-body"
              @click="toggleJournalEntryExpanded(item.entry.id)"
            >
              <span class="entry-time">
                {{ getJournalEntryDateLabel(item.entry) }} · 创建 {{ formatEntryTime(item.entry.createdAt) }}
              </span>
              <div class="entry-title-row">
                <strong>{{ item.entry.title }}</strong>
                <div class="entry-title-actions">
                  <div v-if="isFlagged(item.entry.flaggedAt)" class="entry-title-badges">
                    <span class="flag-pill" aria-label="已标记重要">⚑</span>
                  </div>
                  <button
                    class="card-menu-trigger"
                    :class="{ 'is-open': isCardActionMenuOpenFor({ kind: 'journal', entryId: item.entry.id }) }"
                    type="button"
                    aria-haspopup="menu"
                    :aria-expanded="isCardActionMenuOpenFor({ kind: 'journal', entryId: item.entry.id })"
                    aria-label="打开这条心记的操作菜单"
                    @click.stop="toggleCardActionMenu({ kind: 'journal', entryId: item.entry.id }, $event)"
                  >
                    ⋯
                  </button>
                </div>
              </div>
                <p
                  @click.stop="handleJournalEntryContentClick(item.entry.id, $event)"
                  v-html="renderTodoContent(item.entry.content, 'journal', item.entry.id, 'journal-entry')"
                ></p>
                <div
                  v-if="isJournalEntryExpanded(item.entry.id) && item.entry.images.length > 0"
                  class="record-image-grid"
                >
                  <button
                    v-for="image in item.entry.images"
                    :key="image.id"
                    class="record-image-button"
                    type="button"
                    :aria-label="`查看 ${image.name}`"
                    @click.stop="openRecordImagePreview(image)"
                  >
                    <img :src="image.dataUrl" :alt="image.name" />
                  </button>
                </div>
              </div>
          </article>
        </div>
      </section>
    </section>
    </section>

    <section
      v-else-if="activePark === 'todo'"
      class="todo-workspace"
      aria-label="我的待办"
    >
      <section class="tool-card todo-home-card" aria-labelledby="todo-home-title">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Action from notes</p>
            <h2 id="todo-home-title">我的待办</h2>
          </div>
          <span class="counter">{{ filteredOpenTodoItems.length }} 条</span>
        </div>

        <div class="todo-filter-group" aria-label="待办 Park 筛选">
          <button
            type="button"
            :class="{ active: todoParkFilter === 'all' }"
            @click="todoParkFilter = 'all'"
          >
            全部
          </button>
          <button
            type="button"
            :class="{ active: todoParkFilter === 'journal' }"
            @click="todoParkFilter = 'journal'"
          >
            心记
          </button>
          <button
            type="button"
            :class="{ active: todoParkFilter === 'project' }"
            @click="todoParkFilter = 'project'"
          >
            做记
          </button>
        </div>

        <div class="todo-filter-group soft" aria-label="待办快捷筛选">
          <button
            type="button"
            :class="{ active: todoQuickFilter === 'reminder' }"
            @click="todoQuickFilter = 'reminder'"
          >
            开启提醒的
          </button>
          <button
            type="button"
            :class="{ active: todoQuickFilter === 'today' }"
            @click="todoQuickFilter = 'today'"
          >
            今天
          </button>
          <button
            type="button"
            :class="{ active: todoQuickFilter === 'all' }"
            @click="todoQuickFilter = 'all'"
          >
            全部
          </button>
        </div>

        <div v-if="filteredOpenTodoItems.length === 0" class="empty-state">
          <p>现在没有打开的待办。</p>
          <span>在心记或做记里选中文字，再点“待办”，一句话就能变成行动。</span>
        </div>

        <div v-else class="todo-list">
          <article
            v-for="item in filteredOpenTodoItems"
            :key="item.todo.id"
            class="todo-list-item"
            :data-todo-target="item.todo.id"
          >
            <button
              class="todo-list-toggle"
              type="button"
              @click="toggleTodoStatus(item.todo)"
            >
              {{ getTodoStatusIcon(item.todo) }}
            </button>
            <button
              class="todo-list-main"
              type="button"
              @click="focusTodoSource(item.todo)"
            >
              <strong>{{ item.content }}</strong>
              <span>
                来自：{{ item.sourceLabel }} · {{ getTodoTargetTypeLabel(item.todo.targetType) }}
              </span>
              <small>
                {{ item.createdLabel }}
                <i v-if="item.hasReminder">已关联提醒</i>
              </small>
            </button>
          </article>
        </div>

        <section
          v-if="filteredDoneTodoItems.length > 0"
          class="completed-todo-group global"
        >
          <button
            class="completed-todo-heading"
            type="button"
            @click="globalCompletedOpen = !globalCompletedOpen"
          >
            <span>{{ globalCompletedOpen ? '▾' : '▸' }} 已完成</span>
            <small>{{ filteredDoneTodoItems.length }}</small>
          </button>
          <div v-if="globalCompletedOpen" class="completed-todo-actions">
            <button class="delete-action" type="button" @click="clearGlobalDoneTodos">
              清空已完成
            </button>
          </div>
          <div v-if="globalCompletedOpen" class="todo-list">
            <article
              v-for="item in filteredDoneTodoItems"
              :key="item.todo.id"
              class="todo-list-item is-done"
              :data-todo-target="item.todo.id"
            >
              <button
                class="todo-list-toggle is-done"
                type="button"
                @click="toggleTodoStatus(item.todo)"
              >
                {{ getTodoStatusIcon(item.todo) }}
              </button>
              <button
                class="todo-list-main"
                type="button"
                @click="focusTodoSource(item.todo)"
              >
                <strong>{{ item.content }}</strong>
                <span>
                  来自：{{ item.sourceLabel }} · {{ getTodoTargetTypeLabel(item.todo.targetType) }}
                </span>
                <small>
                  {{ formatTodoDateTime(item.todo.doneAt) }} 完成
                  <i v-if="item.todo.doneNote">{{ item.todo.doneNote }}</i>
                </small>
              </button>
            </article>
          </div>
        </section>
      </section>
    </section>

    <section
      v-else-if="activePark === 'vault'"
      class="park-workspace vault-workspace"
      aria-label="密库"
    >
      <section class="tool-card vault-access-card" aria-labelledby="vault-access-title">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Password Park</p>
            <h2 id="vault-access-title">
              {{
                !vaultConfigured
                  ? '创建密库'
                  : isVaultUnlocked
                    ? '账号密码卡片'
                    : '解锁密库'
              }}
            </h2>
          </div>
          <span class="counter">{{ vaultLockStatusLabel }}</span>
        </div>

        <p class="vault-copy">
          这个 Park 专门存放项目的账号和密码。当前版本先用自定义解锁密码作为 Face ID 的降级方案，数据会在本地加密保存。
        </p>

        <p v-if="vaultStatusMessage" class="vault-status">
          {{ vaultStatusMessage }}
        </p>

        <template v-if="!vaultCryptoSupported">
          <div class="empty-state vault-empty">
            <p>当前环境暂不支持本地加密密库。</p>
            <span>请在支持 Web Crypto 的浏览器或 iOS WebView 中使用这个 Park。</span>
          </div>
        </template>

        <template v-else-if="!vaultConfigured">
          <div class="vault-lock-grid">
            <label class="vault-field">
              <span>设置解锁密码</span>
              <input
                v-model="vaultSetupPassword"
                type="password"
                maxlength="32"
                placeholder="至少 4 位，用来进入密库"
              />
            </label>
            <label class="vault-field">
              <span>再次输入密码</span>
              <input
                v-model="vaultSetupPasswordConfirm"
                type="password"
                maxlength="32"
                placeholder="再输一次，避免手滑"
                @keyup.enter="submitVaultSetup"
              />
            </label>
          </div>

          <div class="vault-lock-hint">
            <span>这组密码会用于本地加密你的密库数据。</span>
            <span>先落地自定义密码，后续如果要接 Face ID，可以在这个门禁上继续加。</span>
          </div>

          <div class="entry-actions">
            <button
              class="primary-action small"
              type="button"
              :disabled="vaultIsBusy || !canCreateVault"
              @click="submitVaultSetup"
            >
              {{ vaultIsBusy ? '创建中...' : '创建密库' }}
            </button>
          </div>
        </template>

        <template v-else-if="!isVaultUnlocked">
          <label class="vault-field">
            <span>输入解锁密码</span>
            <input
              v-model="vaultUnlockPassword"
              type="password"
              maxlength="32"
              placeholder="输入你设置过的密码"
              @keyup.enter="submitVaultUnlock"
            />
          </label>

          <div class="vault-lock-hint">
            <span>每次重新进入这个 Park 都需要解锁。</span>
            <span>切到其他 Park 或 App 退到后台后，密库会自动上锁。</span>
          </div>

          <div class="entry-actions">
            <button class="ghost-action" type="button" @click="vaultUnlockPassword = ''">
              清空
            </button>
            <button
              class="primary-action small"
              type="button"
              :disabled="vaultIsBusy || !canUnlockVault"
              @click="submitVaultUnlock"
            >
              {{ vaultIsBusy ? '解锁中...' : '解锁密库' }}
            </button>
          </div>
        </template>

        <template v-else>
          <div class="vault-summary-row">
            <div class="park-boundary-list vault-summary-cards" aria-label="密库摘要">
              <div>
                <strong>{{ vaultEntryCount }} 条密码卡片</strong>
                <span>建议按项目、网站或服务拆卡，一张卡里放一组账号和密码。</span>
              </div>
              <div>
                <strong>离开自动上锁</strong>
                <span>切到别的 Park 或切后台后，会清掉本次解锁状态。</span>
              </div>
            </div>

            <div class="entry-actions vault-summary-actions">
              <button class="ghost-action" type="button" @click="lockVault('密库已上锁。')">
                立即上锁
              </button>
            </div>
          </div>
        </template>
      </section>

      <template v-if="isVaultUnlocked">
        <section class="tool-card vault-editor-card" aria-labelledby="vault-editor-title">
          <div class="section-heading">
            <div>
              <p class="eyebrow">
                {{ editingVaultEntryId ? '编辑卡片' : '新增卡片' }}
              </p>
              <h2 id="vault-editor-title">
                {{ editingVaultEntryId ? '更新账号密码' : '新建账号密码卡片' }}
              </h2>
            </div>
          </div>

          <div class="vault-form-grid">
            <label class="vault-field">
              <span>项目 / 服务名称</span>
              <input
                v-model="vaultEntryTitle"
                type="text"
                maxlength="80"
                placeholder="例如：GitHub / 飞书 / 测试服务器"
              />
            </label>

            <label class="vault-field">
              <span>账号</span>
              <input
                v-model="vaultEntryAccount"
                type="text"
                maxlength="160"
                placeholder="邮箱、用户名或手机号"
              />
            </label>

            <label class="vault-field">
              <span>密码</span>
              <input
                v-model="vaultEntryPassword"
                type="text"
                maxlength="200"
                placeholder="项目对应的密码"
              />
            </label>

            <label class="vault-field">
              <span>入口地址，可选</span>
              <input
                v-model="vaultEntryWebsite"
                type="text"
                maxlength="200"
                placeholder="例如：https://github.com/login"
              />
            </label>
          </div>

          <label class="vault-field">
            <span>备注，可选</span>
            <textarea
              v-model="vaultEntryNote"
              rows="3"
              maxlength="500"
              placeholder="例如：这是测试环境账号，记得每月轮换密码。"
            ></textarea>
          </label>

          <div class="entry-actions">
            <button
              v-if="editingVaultEntryId"
              class="ghost-action"
              type="button"
              @click="cancelVaultEntryEditing"
            >
              取消编辑
            </button>
            <button
              class="primary-action small"
              type="button"
              :disabled="vaultIsBusy || !canSaveVaultEntry"
              @click="saveVaultEntryDraft"
            >
              {{
                vaultIsBusy
                  ? '保存中...'
                  : editingVaultEntryId
                    ? '保存修改'
                    : '保存卡片'
              }}
            </button>
          </div>
        </section>

        <section class="tool-card vault-list-card" aria-labelledby="vault-list-title">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Encrypted cards</p>
              <h2 id="vault-list-title">账号密码列表</h2>
            </div>
            <span class="counter">{{ vaultEntryCount }} 条</span>
          </div>

          <div v-if="vaultEntryCount === 0" class="empty-state vault-empty">
            <p>现在还没有账号密码卡片。</p>
            <span>先新建一张卡片，后面每张卡都会提供“复制账号”和“复制密码”按钮。</span>
          </div>

          <div v-else class="vault-entry-list">
            <article
              v-for="entry in vaultEntries"
              :key="entry.id"
              class="vault-entry-card"
            >
              <div class="section-heading compact vault-entry-heading">
                <div>
                  <p class="eyebrow">密码卡片</p>
                  <h3 class="vault-entry-title">{{ entry.title }}</h3>
                </div>
                <div class="vault-card-actions">
                  <button class="ghost-action" type="button" @click="startVaultEntryEditing(entry)">
                    编辑
                  </button>
                  <button class="delete-action" type="button" @click="removeVaultEntry(entry)">
                    删除
                  </button>
                </div>
              </div>

              <div class="vault-entry-meta">
                <span>
                  更新于 {{ getDateGroupLabel(entry.updatedAt) }} ·
                  {{ formatEntryTime(entry.updatedAt) }}
                </span>
                <small v-if="entry.website">入口：{{ entry.website }}</small>
              </div>

              <div class="vault-entry-grid">
                <div class="vault-copy-card">
                  <span>账号</span>
                  <strong>{{ entry.account }}</strong>
                  <button
                    class="ghost-action"
                    type="button"
                    @click="copyVaultField(entry.account, '账号')"
                  >
                    复制账号
                  </button>
                </div>

                <div class="vault-copy-card">
                  <span>密码</span>
                  <strong class="vault-password-value">
                    {{ getVaultPasswordDisplay(entry) }}
                  </strong>
                  <div class="vault-copy-actions">
                    <button
                      class="ghost-action"
                      type="button"
                      @click="toggleVaultPasswordVisibility(entry.id)"
                    >
                      {{ isVaultPasswordVisible(entry.id) ? '隐藏' : '显示' }}
                    </button>
                    <button
                      class="ghost-action"
                      type="button"
                      @click="copyVaultField(entry.password, '密码')"
                    >
                      复制密码
                    </button>
                  </div>
                </div>
              </div>

              <p v-if="entry.note" class="vault-note">
                {{ entry.note }}
              </p>
            </article>
          </div>
        </section>
      </template>
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

      <section
        class="knowledge-shell"
        :class="{ 'has-inspector': showKnowledgeInspector }"
        aria-label="知识笔记工作台"
      >
        <section class="knowledge-notes-pane" aria-labelledby="knowledge-notes-title">
          <div class="section-heading compact knowledge-pane-heading knowledge-pane-toolbar">
            <div>
              <h2 id="knowledge-notes-title">
                {{ activeKnowledgeBase ? activeKnowledgeBase.name : '选择仓库' }}
              </h2>
              <small v-if="activeKnowledgeBase" class="branch-scope-label">
                {{ describeBranchFilter(activeKnowledgeBranchFilterId, activeKnowledgeBaseBranches) }}
                ·
                {{ activeKnowledgeNotes.length }} 条
                ·
                已置顶 {{ activeKnowledgePinnedCount }}/{{ MAX_PINNED_KNOWLEDGE_NOTES_PER_BASE }}
              </small>
            </div>
            <div v-if="activeKnowledgeBase" class="knowledge-pane-actions">
              <button class="ghost-action" type="button" @click="toggleKnowledgeBranchPanel">
                {{ knowledgeBranchPanelOpen ? '收起分支' : '分支' }}
              </button>
            </div>
          </div>

          <div v-if="!activeKnowledgeBase" class="empty-state knowledge-empty-state">
            <p>先从左上角打开仓库列表。</p>
            <span>选中一个仓库之后，这里才会显示对应笔记。</span>
            <button class="ghost-action knowledge-empty-action" type="button" @click="openKnowledgeDrawer">
              打开仓库列表
            </button>
          </div>

          <template v-else>
            <section v-if="knowledgeBranchPanelOpen" class="branch-panel" aria-label="知识分支管理">
              <div class="branch-panel-header">
                <div>
                  <p class="eyebrow">分支筛选</p>
                  <strong>
                    {{ describeBranchFilter(activeKnowledgeBranchFilterId, activeKnowledgeBaseBranches) }}
                  </strong>
                </div>
                <div class="branch-panel-actions">
                  <button class="ghost-action" type="button" @click="createKnowledgeBranch(null)">
                    新建根分支
                  </button>
                  <button
                    class="ghost-action"
                    type="button"
                    :disabled="!selectedKnowledgeBranch"
                    @click="createKnowledgeBranch(selectedKnowledgeBranch?.id ?? null)"
                  >
                    子分支
                  </button>
                </div>
              </div>

              <div class="branch-filter-list">
                <button
                  type="button"
                  class="branch-filter-item"
                  :class="{ active: activeKnowledgeBranchFilterId === 'all' }"
                  @click="setKnowledgeBranchFilter('all')"
                >
                  <span>全部</span>
                  <small>{{ activeKnowledgeBaseNotes.length }}</small>
                </button>
                <button
                  type="button"
                  class="branch-filter-item"
                  :class="{ active: activeKnowledgeBranchFilterId === 'ungrouped' }"
                  @click="setKnowledgeBranchFilter('ungrouped')"
                >
                  <span>未分组</span>
                  <small>
                    {{
                      countItemsInBranchScope(
                        activeKnowledgeBaseNotes.map((note) => note.branchId),
                        activeKnowledgeBranches,
                        'ungrouped',
                      )
                    }}
                  </small>
                </button>
                <button
                  v-for="item in knowledgeBranchTreeItems"
                  :key="item.branch.id"
                  type="button"
                  class="branch-filter-item"
                  :class="{ active: activeKnowledgeBranchFilterId === item.branch.id }"
                  :style="{ paddingLeft: `${12 + (item.depth - 1) * 18}px` }"
                  @click="setKnowledgeBranchFilter(item.branch.id)"
                >
                  <span>{{ item.branch.name }}</span>
                  <small>{{ item.itemCount }}</small>
                </button>
              </div>

              <div v-if="selectedKnowledgeBranch" class="branch-selection-card">
                <div>
                  <strong>{{ selectedKnowledgeBranch.name }}</strong>
                  <small>{{ getBranchPathLabel(activeKnowledgeBaseBranches, selectedKnowledgeBranch.id) }}</small>
                </div>
                <div class="branch-selection-actions">
                  <button class="ghost-action" type="button" @click="renameSelectedKnowledgeBranch">
                    重命名
                  </button>
                  <button class="ghost-action" type="button" @click="moveSelectedKnowledgeBranch">
                    移动
                  </button>
                  <button class="ghost-action" type="button" @click="archiveSelectedKnowledgeBranch">
                    归档
                  </button>
                  <button class="delete-action" type="button" @click="deleteSelectedKnowledgeBranch">
                    删除
                  </button>
                </div>
              </div>

              <section
                v-if="archivedKnowledgeBranches.length > 0"
                class="branch-archived-panel"
              >
                <button
                  class="completed-todo-heading branch-archived-toggle"
                  type="button"
                  @click="knowledgeArchivedBranchesOpen = !knowledgeArchivedBranchesOpen"
                >
                  <span>{{ knowledgeArchivedBranchesOpen ? '▾' : '▸' }} 已归档</span>
                  <small>{{ archivedKnowledgeBranches.length }}</small>
                </button>
                <div v-if="knowledgeArchivedBranchesOpen" class="branch-archived-list">
                  <div
                    v-for="branch in archivedKnowledgeBranches"
                    :key="branch.id"
                    class="branch-archived-item"
                  >
                    <div>
                      <strong>{{ branch.name }}</strong>
                      <small>{{ getBranchPathLabel(activeKnowledgeBaseBranches, branch.id) }}</small>
                    </div>
                    <button class="ghost-action" type="button" @click="restoreKnowledgeBranch(branch)">
                      恢复
                    </button>
                  </div>
                </div>
              </section>
            </section>

            <div
              v-if="activeKnowledgeNotes.length === 0"
              class="empty-state knowledge-empty-state"
            >
              <p>
                {{
                  activeKnowledgeBranchFilterId === 'all'
                    ? '这个仓库还没有笔记。'
                    : '这个分支范围里还没有笔记。'
                }}
              </p>
              <span>
                {{
                  activeKnowledgeBranchFilterId === 'all'
                    ? '点右下角的浮动按钮，先写下第一条知识记录。'
                    : '可以把笔记写进这个分支，或者切回全部看看其他内容。'
                }}
              </span>
            </div>

            <div v-else class="knowledge-note-items">
              <article
                v-for="note in activeKnowledgeNotes"
                :key="note.id"
                class="knowledge-note-list-item"
                :class="{
                  active: isKnowledgeNoteExpanded(note.id),
                  'is-expanded': isKnowledgeNoteExpanded(note.id),
                  'is-flagged': isFlagged(note.flaggedAt),
                  'is-pinned': isPinned(note.pinnedAt),
                }"
              >
                <div
                  class="knowledge-note-summary"
                  role="button"
                  :tabindex="isKnowledgeNoteEditing(note.id) ? -1 : 0"
                  :aria-expanded="isKnowledgeNoteExpanded(note.id)"
                  @click="toggleKnowledgeNoteExpanded(note)"
                  @keydown.enter.prevent="toggleKnowledgeNoteExpanded(note)"
                  @keydown.space.prevent="toggleKnowledgeNoteExpanded(note)"
                >
                  <span class="entry-time">
                    {{ getDateGroupLabel(note.updatedAt) }} · {{ formatEntryTime(note.updatedAt) }}
                  </span>
                  <div class="list-title-row">
                    <strong>{{ note.title }}</strong>
                    <div class="entry-title-actions">
                      <div class="list-title-badges">
                        <span v-if="isFlagged(note.flaggedAt)" class="flag-pill" aria-label="已标记重要">⚑</span>
                        <span v-if="isPinned(note.pinnedAt)" class="pin-pill">置顶</span>
                      </div>
                      <button
                        class="card-menu-trigger"
                        :class="{ 'is-open': isCardActionMenuOpenFor({ kind: 'knowledge', noteId: note.id }) }"
                        type="button"
                        aria-haspopup="menu"
                        :aria-expanded="isCardActionMenuOpenFor({ kind: 'knowledge', noteId: note.id })"
                        aria-label="打开这条知识笔记的操作菜单"
                        @click.stop="toggleCardActionMenu({ kind: 'knowledge', noteId: note.id }, $event)"
                      >
                        ⋯
                      </button>
                    </div>
                  </div>
                  <p
                    v-if="isKnowledgeNoteExpanded(note.id)"
                    class="knowledge-note-preview"
                    :data-reminder-target="`knowledge-note:${note.id}`"
                    :class="{ 'has-reminder-target': isReminderHighlighted('knowledge-note', note.id) }"
                    v-html="renderReminderHighlightedContent(note.content, 'knowledge-note', note.id)"
                  ></p>
                  <p v-else class="knowledge-note-preview">{{ note.content }}</p>
                </div>

                <div
                  v-if="isKnowledgeNoteExpanded(note.id)"
                  class="record-inline-panel"
                >
                  <template v-if="isKnowledgeNoteEditing(note.id)">
                    <p class="eyebrow">编辑笔记</p>

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
                    <div class="record-image-toolbar">
                      <button
                        class="ghost-action"
                        type="button"
                        :disabled="isImportingImages('knowledge-edit') || editingKnowledgeNoteImages.length >= MAX_RECORD_IMAGES"
                        @click="openImageImporter('knowledge-edit')"
                      >
                        {{ isImportingImages('knowledge-edit') ? '导入中...' : '导入图片' }}
                      </button>
                      <small>最多 {{ MAX_RECORD_IMAGES }} 张。</small>
                    </div>
                    <div v-if="editingKnowledgeNoteImages.length > 0" class="record-image-grid is-editor">
                      <div
                        v-for="image in editingKnowledgeNoteImages"
                        :key="image.id"
                        class="record-image-card is-editor"
                      >
                        <button
                          class="record-image-button"
                          type="button"
                          :aria-label="`预览 ${image.name}`"
                          @click="openRecordImagePreview(image)"
                        >
                          <img :src="image.dataUrl" :alt="image.name" />
                        </button>
                        <button
                          class="record-image-remove"
                          type="button"
                          @click="removeImportedImage('knowledge-edit', image.id)"
                        >
                          移除
                        </button>
                      </div>
                    </div>
                    <label class="branch-field">
                      <span>归属分支</span>
                      <select v-model="editingKnowledgeNoteBranchValue" class="branch-select">
                        <option :value="BRANCH_UNGROUPED_VALUE">未分组</option>
                        <option
                          v-for="option in knowledgeBranchSelectOptions"
                          :key="option.value"
                          :value="option.value"
                        >
                          {{ option.label }}
                        </option>
                      </select>
                    </label>
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
                      <button class="ghost-action" type="button" @click="selectKnowledgeNote(note)">
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

                  <template v-else>
                    <div
                      v-if="note.branchId"
                      class="record-inline-meta"
                    >
                      <span>{{ getBranchPathLabel(activeKnowledgeBaseBranches, note.branchId) }}</span>
                    </div>

                    <div
                      v-if="note.tags.length > 0"
                      class="tag-row knowledge-detail-tags"
                    >
                      <span v-for="tag in note.tags" :key="tag">{{ tag }}</span>
                    </div>

                    <div v-if="note.images.length > 0" class="record-image-grid">
                      <button
                        v-for="image in note.images"
                        :key="image.id"
                        class="record-image-button"
                        type="button"
                        :aria-label="`查看 ${image.name}`"
                        @click.stop="openRecordImagePreview(image)"
                      >
                        <img :src="image.dataUrl" :alt="image.name" />
                      </button>
                    </div>

                    <a
                      v-if="note.sourceUrl"
                      class="source-link"
                      :href="note.sourceUrl"
                      target="_blank"
                      rel="noreferrer"
                    >
                      打开来源
                    </a>
                  </template>
                </div>
              </article>
            </div>
          </template>

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

        <section
          v-if="showKnowledgeInspector"
          class="knowledge-inspector"
          aria-labelledby="knowledge-inspector-title"
        >
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
            <div class="record-image-toolbar">
              <button
                class="ghost-action"
                type="button"
                :disabled="isImportingImages('knowledge-create') || newKnowledgeNoteImages.length >= MAX_RECORD_IMAGES"
                @click="openImageImporter('knowledge-create')"
              >
                {{ isImportingImages('knowledge-create') ? '导入中...' : '导入图片' }}
              </button>
              <small>最多 {{ MAX_RECORD_IMAGES }} 张。</small>
            </div>
            <div v-if="newKnowledgeNoteImages.length > 0" class="record-image-grid is-editor">
              <div
                v-for="image in newKnowledgeNoteImages"
                :key="image.id"
                class="record-image-card is-editor"
              >
                <button
                  class="record-image-button"
                  type="button"
                  :aria-label="`预览 ${image.name}`"
                  @click="openRecordImagePreview(image)"
                >
                  <img :src="image.dataUrl" :alt="image.name" />
                </button>
                <button
                  class="record-image-remove"
                  type="button"
                  @click="removeImportedImage('knowledge-create', image.id)"
                >
                  移除
                </button>
              </div>
            </div>
            <label class="branch-field">
              <span>归属分支</span>
              <select v-model="newKnowledgeNoteBranchValue" class="branch-select">
                <option :value="BRANCH_UNGROUPED_VALUE">未分组</option>
                <option
                  v-for="option in knowledgeBranchSelectOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </label>
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
            <div class="record-image-toolbar">
              <button
                class="ghost-action"
                type="button"
                :disabled="isImportingImages('knowledge-edit') || editingKnowledgeNoteImages.length >= MAX_RECORD_IMAGES"
                @click="openImageImporter('knowledge-edit')"
              >
                {{ isImportingImages('knowledge-edit') ? '导入中...' : '导入图片' }}
              </button>
              <small>最多 {{ MAX_RECORD_IMAGES }} 张。</small>
            </div>
            <div v-if="editingKnowledgeNoteImages.length > 0" class="record-image-grid is-editor">
              <div
                v-for="image in editingKnowledgeNoteImages"
                :key="image.id"
                class="record-image-card is-editor"
              >
                <button
                  class="record-image-button"
                  type="button"
                  :aria-label="`预览 ${image.name}`"
                  @click="openRecordImagePreview(image)"
                >
                  <img :src="image.dataUrl" :alt="image.name" />
                </button>
                <button
                  class="record-image-remove"
                  type="button"
                  @click="removeImportedImage('knowledge-edit', image.id)"
                >
                  移除
                </button>
              </div>
            </div>
            <label class="branch-field">
              <span>归属分支</span>
              <select v-model="editingKnowledgeNoteBranchValue" class="branch-select">
                <option :value="BRANCH_UNGROUPED_VALUE">未分组</option>
                <option
                  v-for="option in knowledgeBranchSelectOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </label>
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
              <span>
                {{ selectedKnowledgeNote.branchId ? getBranchPathLabel(activeKnowledgeBaseBranches, selectedKnowledgeNote.branchId) : '未分组' }}
              </span>
              <span v-if="isFlagged(selectedKnowledgeNote.flaggedAt)" class="flag-meta-label">⚑ Flag</span>
              <span v-if="isPinned(selectedKnowledgeNote.pinnedAt)" class="pin-meta-label">已置顶</span>
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
                <button class="ghost-action" type="button" @click="toggleKnowledgeNoteFlag(selectedKnowledgeNote)">
                  {{ isFlagged(selectedKnowledgeNote.flaggedAt) ? '取消 Flag' : 'Flag' }}
                </button>
                <button class="ghost-action" type="button" @click="toggleKnowledgeNotePinned(selectedKnowledgeNote)">
                  {{ isPinned(selectedKnowledgeNote.pinnedAt) ? '取消置顶' : '置顶' }}
                </button>
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

      <section
        class="lab-shell"
        :class="{ 'has-inspector': showLabInspector }"
        aria-label="做记项目工作台"
      >
        <section class="lab-records-pane" aria-labelledby="lab-records-title">
          <div class="section-heading compact knowledge-pane-heading knowledge-pane-toolbar">
            <div>
              <h2 id="lab-records-title">
                {{ activeLabProject ? activeLabProject.name : '选择项目' }}
              </h2>
              <small v-if="activeLabProject" class="branch-scope-label">
                {{ describeBranchFilter(activeLabBranchFilterId, activeLabProjectBranches) }}
                ·
                {{ activeLabRecords.length }} 条
                ·
                已置顶 {{ activeLabPinnedCount }}/{{ MAX_PINNED_LAB_RECORDS_PER_PROJECT }}
              </small>
            </div>
            <div v-if="activeLabProject" class="knowledge-pane-actions">
              <button class="ghost-action" type="button" @click="toggleLabBranchPanel">
                {{ labBranchPanelOpen ? '收起分支' : '分支' }}
              </button>
            </div>
          </div>

          <div v-if="!activeLabProject" class="empty-state knowledge-empty-state">
            <p>先从左上角打开项目列表。</p>
            <span>选中一个项目之后，这里才会显示对应的操作和复盘记录。</span>
            <button class="ghost-action knowledge-empty-action" type="button" @click="openLabDrawer">
              打开项目列表
            </button>
          </div>

          <template v-else>
            <section v-if="labBranchPanelOpen" class="branch-panel" aria-label="做记分支管理">
              <div class="branch-panel-header">
                <div>
                  <p class="eyebrow">分支筛选</p>
                  <strong>
                    {{ describeBranchFilter(activeLabBranchFilterId, activeLabProjectBranches) }}
                  </strong>
                </div>
                <div class="branch-panel-actions">
                  <button class="ghost-action" type="button" @click="createLabBranch(null)">
                    新建根分支
                  </button>
                  <button
                    class="ghost-action"
                    type="button"
                    :disabled="!selectedLabBranch"
                    @click="createLabBranch(selectedLabBranch?.id ?? null)"
                  >
                    子分支
                  </button>
                </div>
              </div>

              <div class="branch-filter-list">
                <button
                  type="button"
                  class="branch-filter-item"
                  :class="{ active: activeLabBranchFilterId === 'all' }"
                  @click="setLabBranchFilter('all')"
                >
                  <span>全部</span>
                  <small>{{ activeLabProjectRecords.length }}</small>
                </button>
                <button
                  type="button"
                  class="branch-filter-item"
                  :class="{ active: activeLabBranchFilterId === 'ungrouped' }"
                  @click="setLabBranchFilter('ungrouped')"
                >
                  <span>未分组</span>
                  <small>
                    {{
                      countItemsInBranchScope(
                        activeLabProjectRecords.map((record) => record.branchId),
                        activeLabBranches,
                        'ungrouped',
                      )
                    }}
                  </small>
                </button>
                <button
                  v-for="item in labBranchTreeItems"
                  :key="item.branch.id"
                  type="button"
                  class="branch-filter-item"
                  :class="{ active: activeLabBranchFilterId === item.branch.id }"
                  :style="{ paddingLeft: `${12 + (item.depth - 1) * 18}px` }"
                  @click="setLabBranchFilter(item.branch.id)"
                >
                  <span>{{ item.branch.name }}</span>
                  <small>{{ item.itemCount }}</small>
                </button>
              </div>

              <div v-if="selectedLabBranch" class="branch-selection-card">
                <div>
                  <strong>{{ selectedLabBranch.name }}</strong>
                  <small>{{ getBranchPathLabel(activeLabProjectBranches, selectedLabBranch.id) }}</small>
                </div>
                <div class="branch-selection-actions">
                  <button class="ghost-action" type="button" @click="renameSelectedLabBranch">
                    重命名
                  </button>
                  <button class="ghost-action" type="button" @click="moveSelectedLabBranch">
                    移动
                  </button>
                  <button class="ghost-action" type="button" @click="archiveSelectedLabBranch">
                    归档
                  </button>
                  <button class="delete-action" type="button" @click="deleteSelectedLabBranch">
                    删除
                  </button>
                </div>
              </div>

              <section
                v-if="archivedLabBranches.length > 0"
                class="branch-archived-panel"
              >
                <button
                  class="completed-todo-heading branch-archived-toggle"
                  type="button"
                  @click="labArchivedBranchesOpen = !labArchivedBranchesOpen"
                >
                  <span>{{ labArchivedBranchesOpen ? '▾' : '▸' }} 已归档</span>
                  <small>{{ archivedLabBranches.length }}</small>
                </button>
                <div v-if="labArchivedBranchesOpen" class="branch-archived-list">
                  <div
                    v-for="branch in archivedLabBranches"
                    :key="branch.id"
                    class="branch-archived-item"
                  >
                    <div>
                      <strong>{{ branch.name }}</strong>
                      <small>{{ getBranchPathLabel(activeLabProjectBranches, branch.id) }}</small>
                    </div>
                    <button class="ghost-action" type="button" @click="restoreLabBranch(branch)">
                      恢复
                    </button>
                  </div>
                </div>
              </section>
            </section>

            <div
              v-if="activeOpenLabRecords.length === 0 && activeCompletedLabRecordItems.length === 0"
              class="empty-state knowledge-empty-state"
            >
              <p>
                {{
                  activeLabBranchFilterId === 'all'
                    ? '这个项目还没有记录。'
                    : '这个分支范围里还没有记录。'
                }}
              </p>
              <span>
                {{
                  activeLabBranchFilterId === 'all'
                    ? '点右下角按钮，先补一条操作或复盘。'
                    : '可以把记录写进这个分支，或者切回全部看看其他内容。'
                }}
              </span>
            </div>

            <div v-else class="knowledge-note-items">
              <article
                v-for="record in activeOpenLabRecords"
                :key="record.id"
                class="lab-record-list-item"
                :class="[
                  { active: isLabRecordExpanded(record.id) },
                  { 'is-expanded': isLabRecordExpanded(record.id) },
                  { 'is-flagged': isFlagged(record.flaggedAt) },
                  { 'has-card-todo': Boolean(getCardTodo('project', record.id)) },
                  { 'is-pinned': isPinned(record.pinnedAt) },
                  `is-${record.type}`,
                ]"
                :data-todo-source="`project:${record.id}`"
              >
                <div
                  class="lab-record-summary"
                  role="button"
                  :tabindex="isLabRecordEditing(record.id) ? -1 : 0"
                  :aria-expanded="isLabRecordExpanded(record.id)"
                  @click="toggleLabRecordExpanded(record)"
                  @keydown.enter.prevent="toggleLabRecordExpanded(record)"
                  @keydown.space.prevent="toggleLabRecordExpanded(record)"
                >
                  <div class="lab-record-list-header">
                    <span class="entry-time">
                      {{ getDateGroupLabel(record.updatedAt) }} · {{ formatEntryTime(record.updatedAt) }}
                    </span>
                    <div class="lab-record-list-badges">
                      <span v-if="isFlagged(record.flaggedAt)" class="flag-pill" aria-label="已标记重要">⚑</span>
                      <span v-if="isPinned(record.pinnedAt)" class="pin-pill">置顶</span>
                      <span
                        v-if="getCardTodo('project', record.id)"
                        class="todo-mini-badge"
                      >
                        {{ getCardTodoIcon('project', record.id) }}
                      </span>
                      <span class="record-type-pill" :class="`is-${record.type}`">
                        {{ getLabRecordTypeLabel(record.type) }}
                      </span>
                      <button
                        class="card-menu-trigger"
                        :class="{ 'is-open': isCardActionMenuOpenFor({ kind: 'lab', recordId: record.id }) }"
                        type="button"
                        aria-haspopup="menu"
                        :aria-expanded="isCardActionMenuOpenFor({ kind: 'lab', recordId: record.id })"
                        aria-label="打开这条做记记录的操作菜单"
                        @click.stop="toggleCardActionMenu({ kind: 'lab', recordId: record.id }, $event)"
                      >
                        ⋯
                      </button>
                    </div>
                  </div>
                  <strong>{{ record.title }}</strong>
                  <p
                    v-if="isLabRecordExpanded(record.id)"
                    class="lab-record-preview"
                    :data-reminder-target="`lab-record:${record.id}`"
                    :data-todo-source="`project:${record.id}`"
                    :class="{
                      'has-reminder-target': isReminderHighlighted('lab-record', record.id),
                      'has-todo-target': isCardTodoHighlighted('project', record.id),
                    }"
                    @click.stop="handleLabRecordContentClick(record, $event)"
                    v-html="renderTodoContent(record.content, 'project', record.id, 'lab-record')"
                  ></p>
                  <p v-else class="lab-record-preview">{{ record.content }}</p>
                </div>

                <div
                  v-if="isLabRecordExpanded(record.id)"
                  class="record-inline-panel"
                >
                  <template v-if="isLabRecordEditing(record.id)">
                    <p class="eyebrow">编辑记录</p>

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
                    <div class="record-image-toolbar">
                      <button
                        class="ghost-action"
                        type="button"
                        :disabled="isImportingImages('lab-edit') || editingLabRecordImages.length >= MAX_RECORD_IMAGES"
                        @click="openImageImporter('lab-edit')"
                      >
                        {{ isImportingImages('lab-edit') ? '导入中...' : '导入图片' }}
                      </button>
                      <small>最多 {{ MAX_RECORD_IMAGES }} 张。</small>
                    </div>
                    <div v-if="editingLabRecordImages.length > 0" class="record-image-grid is-editor">
                      <div
                        v-for="image in editingLabRecordImages"
                        :key="image.id"
                        class="record-image-card is-editor"
                      >
                        <button
                          class="record-image-button"
                          type="button"
                          :aria-label="`预览 ${image.name}`"
                          @click="openRecordImagePreview(image)"
                        >
                          <img :src="image.dataUrl" :alt="image.name" />
                        </button>
                        <button
                          class="record-image-remove"
                          type="button"
                          @click="removeImportedImage('lab-edit', image.id)"
                        >
                          移除
                        </button>
                      </div>
                    </div>
                    <label class="branch-field">
                      <span>归属分支</span>
                      <select v-model="editingLabRecordBranchValue" class="branch-select">
                        <option :value="BRANCH_UNGROUPED_VALUE">未分组</option>
                        <option
                          v-for="option in labBranchSelectOptions"
                          :key="option.value"
                          :value="option.value"
                        >
                          {{ option.label }}
                        </option>
                      </select>
                    </label>
                    <input
                      v-model="editingLabRecordTags"
                      class="search-input compact-input"
                      type="text"
                      placeholder="标签，用逗号分隔"
                      aria-label="编辑项目记录标签"
                    />
                    <div class="entry-actions">
                      <button class="ghost-action" type="button" @click="selectLabRecord(record)">
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

                  <template v-else>
                    <div
                      v-if="getCardTodo('project', record.id)"
                      class="todo-card-strip"
                      :data-todo-target="getCardTodo('project', record.id)?.id"
                    >
                      <button
                        class="todo-card-toggle"
                        type="button"
                        @click="toggleCardTodo('project', record.id)"
                      >
                        {{ getCardTodoIcon('project', record.id) }}
                      </button>
                      <span>卡片待办</span>
                      <small v-if="isCardTodoDone('project', record.id)">
                        {{ getCardTodoDoneLabel('project', record.id) }}
                      </small>
                    </div>

                    <div
                      v-if="record.branchId"
                      class="record-inline-meta"
                    >
                      <span>{{ getBranchPathLabel(activeLabProjectBranches, record.branchId) }}</span>
                    </div>

                    <div
                      v-if="record.tags.length > 0"
                      class="tag-row knowledge-detail-tags"
                    >
                      <span v-for="tag in record.tags" :key="tag">{{ tag }}</span>
                    </div>

                    <div v-if="record.images.length > 0" class="record-image-grid">
                      <button
                        v-for="image in record.images"
                        :key="image.id"
                        class="record-image-button"
                        type="button"
                        :aria-label="`查看 ${image.name}`"
                        @click.stop="openRecordImagePreview(image)"
                      >
                        <img :src="image.dataUrl" :alt="image.name" />
                      </button>
                    </div>

                    <label
                      v-if="getSentenceTodosForTarget('project', record.id).some((todo) => todo.status === 'done')"
                      class="todo-hide-toggle"
                    >
                      <input v-model="hideDoneSentenceTodos" type="checkbox" />
                      <span>隐藏已完成的待办</span>
                    </label>

                    <div
                      v-if="getUnresolvedSentenceTodos('project', record.id, record.content).length > 0"
                      class="todo-unresolved"
                    >
                      <span>
                        有 {{ getUnresolvedSentenceTodos('project', record.id, record.content).length }} 个待办无法定位
                      </span>
                      <button type="button" @click="showUnresolvedTodoOriginals('project', record.id, record.content)">
                        查看原文
                      </button>
                      <button type="button" @click="removeUnresolvedSentenceTodos('project', record.id, record.content)">
                        删除
                      </button>
                    </div>
                  </template>
                </div>
              </article>
            </div>

            <section
              v-if="activeCompletedLabRecordItems.length > 0"
              class="completed-todo-group"
            >
              <button
                class="completed-todo-heading"
                type="button"
                @click="labCompletedOpen = !labCompletedOpen"
              >
                <span>{{ labCompletedOpen ? '▾' : '▸' }} 已完成</span>
                <small>{{ activeCompletedLabRecordItems.length }}</small>
              </button>
              <div v-if="labCompletedOpen" class="completed-todo-actions">
                <button class="delete-action" type="button" @click="clearLabDoneCardTodos">
                  清空已完成
                </button>
              </div>
              <div v-if="labCompletedOpen" class="knowledge-note-items">
                <article
                  v-for="item in activeCompletedLabRecordItems"
                  :key="item.todo.id"
                  class="lab-record-list-item is-todo-done"
                  :class="[
                    `is-${item.record.type}`,
                    { active: isLabRecordExpanded(item.record.id) },
                    { 'is-expanded': isLabRecordExpanded(item.record.id) },
                    { 'is-flagged': isFlagged(item.record.flaggedAt) },
                    { 'is-pinned': isPinned(item.record.pinnedAt) },
                  ]"
                  :data-todo-source="`project:${item.record.id}`"
                  :data-todo-target="item.todo.id"
                >
                  <div
                    class="lab-record-summary"
                    role="button"
                    :tabindex="isLabRecordEditing(item.record.id) ? -1 : 0"
                    :aria-expanded="isLabRecordExpanded(item.record.id)"
                    @click="toggleLabRecordExpanded(item.record)"
                    @keydown.enter.prevent="toggleLabRecordExpanded(item.record)"
                    @keydown.space.prevent="toggleLabRecordExpanded(item.record)"
                  >
                    <div class="lab-record-list-header">
                      <span class="entry-time">{{ formatTodoDateTime(item.todo.doneAt) }} 完成</span>
                      <div class="lab-record-list-badges">
                        <span v-if="isFlagged(item.record.flaggedAt)" class="flag-pill" aria-label="已标记重要">⚑</span>
                        <span v-if="isPinned(item.record.pinnedAt)" class="pin-pill">置顶</span>
                        <button
                          class="todo-card-toggle is-done"
                          type="button"
                          @click.stop="toggleTodoStatus(item.todo)"
                        >
                          {{ getTodoStatusIcon(item.todo) }}
                        </button>
                        <button
                          class="card-menu-trigger"
                          :class="{ 'is-open': isCardActionMenuOpenFor({ kind: 'lab', recordId: item.record.id }) }"
                          type="button"
                          aria-haspopup="menu"
                          :aria-expanded="isCardActionMenuOpenFor({ kind: 'lab', recordId: item.record.id })"
                          aria-label="打开这条做记记录的操作菜单"
                          @click.stop="toggleCardActionMenu({ kind: 'lab', recordId: item.record.id }, $event)"
                        >
                          ⋯
                        </button>
                      </div>
                    </div>
                    <strong>{{ item.record.title }}</strong>
                    <p
                      v-if="isLabRecordExpanded(item.record.id)"
                      class="lab-record-preview"
                      :data-reminder-target="`lab-record:${item.record.id}`"
                      :data-todo-source="`project:${item.record.id}`"
                      :class="{
                        'has-reminder-target': isReminderHighlighted('lab-record', item.record.id),
                        'has-todo-target': isCardTodoHighlighted('project', item.record.id),
                      }"
                      @click.stop="handleLabRecordContentClick(item.record, $event)"
                      v-html="renderTodoContent(item.record.content, 'project', item.record.id, 'lab-record')"
                    ></p>
                    <p v-else class="lab-record-preview">{{ item.record.content }}</p>
                  </div>

                  <div
                    v-if="isLabRecordExpanded(item.record.id)"
                    class="record-inline-panel"
                  >
                    <template v-if="isLabRecordEditing(item.record.id)">
                      <p class="eyebrow">编辑记录</p>

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
                      <label class="branch-field">
                        <span>归属分支</span>
                        <select v-model="editingLabRecordBranchValue" class="branch-select">
                          <option :value="BRANCH_UNGROUPED_VALUE">未分组</option>
                          <option
                            v-for="option in labBranchSelectOptions"
                            :key="option.value"
                            :value="option.value"
                          >
                            {{ option.label }}
                          </option>
                        </select>
                      </label>
                      <input
                        v-model="editingLabRecordTags"
                        class="search-input compact-input"
                        type="text"
                        placeholder="标签，用逗号分隔"
                        aria-label="编辑项目记录标签"
                      />
                      <div class="entry-actions">
                        <button class="ghost-action" type="button" @click="selectLabRecord(item.record)">
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

                    <template v-else>
                      <div
                        v-if="getCardTodo('project', item.record.id)"
                        class="todo-card-strip"
                        :data-todo-target="getCardTodo('project', item.record.id)?.id"
                      >
                        <button
                          class="todo-card-toggle"
                          type="button"
                          @click="toggleCardTodo('project', item.record.id)"
                        >
                          {{ getCardTodoIcon('project', item.record.id) }}
                        </button>
                        <span>卡片待办</span>
                        <small v-if="isCardTodoDone('project', item.record.id)">
                          {{ getCardTodoDoneLabel('project', item.record.id) }}
                        </small>
                      </div>

                      <div
                        v-if="item.record.branchId"
                        class="record-inline-meta"
                      >
                        <span>{{ getBranchPathLabel(activeLabProjectBranches, item.record.branchId) }}</span>
                      </div>

                      <div
                        v-if="item.record.tags.length > 0"
                        class="tag-row knowledge-detail-tags"
                      >
                        <span v-for="tag in item.record.tags" :key="tag">{{ tag }}</span>
                      </div>

                      <div v-if="item.record.images.length > 0" class="record-image-grid">
                        <button
                          v-for="image in item.record.images"
                          :key="image.id"
                          class="record-image-button"
                          type="button"
                          :aria-label="`查看 ${image.name}`"
                          @click.stop="openRecordImagePreview(image)"
                        >
                          <img :src="image.dataUrl" :alt="image.name" />
                        </button>
                      </div>

                      <label
                        v-if="getSentenceTodosForTarget('project', item.record.id).some((todo) => todo.status === 'done')"
                        class="todo-hide-toggle"
                      >
                        <input v-model="hideDoneSentenceTodos" type="checkbox" />
                        <span>隐藏已完成的待办</span>
                      </label>

                      <div
                        v-if="getUnresolvedSentenceTodos('project', item.record.id, item.record.content).length > 0"
                        class="todo-unresolved"
                      >
                        <span>
                          有 {{ getUnresolvedSentenceTodos('project', item.record.id, item.record.content).length }} 个待办无法定位
                        </span>
                        <button type="button" @click="showUnresolvedTodoOriginals('project', item.record.id, item.record.content)">
                          查看原文
                        </button>
                        <button type="button" @click="removeUnresolvedSentenceTodos('project', item.record.id, item.record.content)">
                          删除
                        </button>
                      </div>
                    </template>
                  </div>
                </article>
              </div>
            </section>
          </template>

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

        <section
          v-if="showLabInspector"
          class="lab-inspector"
          aria-labelledby="lab-inspector-title"
        >
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
            <div class="record-image-toolbar">
              <button
                class="ghost-action"
                type="button"
                :disabled="isImportingImages('lab-create') || newLabRecordImages.length >= MAX_RECORD_IMAGES"
                @click="openImageImporter('lab-create')"
              >
                {{ isImportingImages('lab-create') ? '导入中...' : '导入图片' }}
              </button>
              <small>最多 {{ MAX_RECORD_IMAGES }} 张。</small>
            </div>
            <div v-if="newLabRecordImages.length > 0" class="record-image-grid is-editor">
              <div
                v-for="image in newLabRecordImages"
                :key="image.id"
                class="record-image-card is-editor"
              >
                <button
                  class="record-image-button"
                  type="button"
                  :aria-label="`预览 ${image.name}`"
                  @click="openRecordImagePreview(image)"
                >
                  <img :src="image.dataUrl" :alt="image.name" />
                </button>
                <button
                  class="record-image-remove"
                  type="button"
                  @click="removeImportedImage('lab-create', image.id)"
                >
                  移除
                </button>
              </div>
            </div>
            <label class="branch-field">
              <span>归属分支</span>
              <select v-model="newLabRecordBranchValue" class="branch-select">
                <option :value="BRANCH_UNGROUPED_VALUE">未分组</option>
                <option
                  v-for="option in labBranchSelectOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </label>
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
            <div class="record-image-toolbar">
              <button
                class="ghost-action"
                type="button"
                :disabled="isImportingImages('lab-edit') || editingLabRecordImages.length >= MAX_RECORD_IMAGES"
                @click="openImageImporter('lab-edit')"
              >
                {{ isImportingImages('lab-edit') ? '导入中...' : '导入图片' }}
              </button>
              <small>最多 {{ MAX_RECORD_IMAGES }} 张。</small>
            </div>
            <div v-if="editingLabRecordImages.length > 0" class="record-image-grid is-editor">
              <div
                v-for="image in editingLabRecordImages"
                :key="image.id"
                class="record-image-card is-editor"
              >
                <button
                  class="record-image-button"
                  type="button"
                  :aria-label="`预览 ${image.name}`"
                  @click="openRecordImagePreview(image)"
                >
                  <img :src="image.dataUrl" :alt="image.name" />
                </button>
                <button
                  class="record-image-remove"
                  type="button"
                  @click="removeImportedImage('lab-edit', image.id)"
                >
                  移除
                </button>
              </div>
            </div>
            <label class="branch-field">
              <span>归属分支</span>
              <select v-model="editingLabRecordBranchValue" class="branch-select">
                <option :value="BRANCH_UNGROUPED_VALUE">未分组</option>
                <option
                  v-for="option in labBranchSelectOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </label>
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
              <span>
                {{ selectedLabRecord.branchId ? getBranchPathLabel(activeLabProjectBranches, selectedLabRecord.branchId) : '未分组' }}
              </span>
              <span v-if="isFlagged(selectedLabRecord.flaggedAt)" class="flag-meta-label">⚑ Flag</span>
              <span v-if="isPinned(selectedLabRecord.pinnedAt)" class="pin-meta-label">已置顶</span>
              <span class="record-type-pill" :class="`is-${selectedLabRecord.type}`">
                {{ getLabRecordTypeLabel(selectedLabRecord.type) }}
              </span>
            </div>

            <div
              v-if="getCardTodo('project', selectedLabRecord.id)"
              class="todo-card-strip"
              :data-todo-target="getCardTodo('project', selectedLabRecord.id)?.id"
            >
              <button
                class="todo-card-toggle"
                type="button"
                @click="toggleCardTodo('project', selectedLabRecord.id)"
              >
                {{ getCardTodoIcon('project', selectedLabRecord.id) }}
              </button>
              <span>卡片待办</span>
              <small v-if="isCardTodoDone('project', selectedLabRecord.id)">
                {{ getCardTodoDoneLabel('project', selectedLabRecord.id) }}
              </small>
            </div>

            <div
              v-if="selectedLabRecord.tags.length > 0"
              class="tag-row knowledge-detail-tags"
            >
              <span v-for="tag in selectedLabRecord.tags" :key="tag">{{ tag }}</span>
            </div>

            <label
              v-if="getSentenceTodosForTarget('project', selectedLabRecord.id).some((todo) => todo.status === 'done')"
              class="todo-hide-toggle"
            >
              <input v-model="hideDoneSentenceTodos" type="checkbox" />
              <span>隐藏已完成的待办</span>
            </label>

            <p
              class="knowledge-note-content"
              :data-reminder-target="`lab-record:${selectedLabRecord.id}`"
              :data-todo-source="`project:${selectedLabRecord.id}`"
              :class="{
                'has-reminder-target': isReminderHighlighted('lab-record', selectedLabRecord.id),
                'has-todo-target': isCardTodoHighlighted('project', selectedLabRecord.id),
              }"
              @click="handleTodoContentClick"
              v-html="renderTodoContent(selectedLabRecord.content, 'project', selectedLabRecord.id, 'lab-record')"
            ></p>

            <div
              v-if="getUnresolvedSentenceTodos('project', selectedLabRecord.id, selectedLabRecord.content).length > 0"
              class="todo-unresolved"
            >
              <span>
                有 {{ getUnresolvedSentenceTodos('project', selectedLabRecord.id, selectedLabRecord.content).length }} 个待办无法定位
              </span>
              <button type="button" @click="showUnresolvedTodoOriginals('project', selectedLabRecord.id, selectedLabRecord.content)">
                查看原文
              </button>
              <button type="button" @click="removeUnresolvedSentenceTodos('project', selectedLabRecord.id, selectedLabRecord.content)">
                删除
              </button>
            </div>

            <div class="entry-actions knowledge-detail-actions">
              <button class="delete-action" type="button" @click="removeLabRecord(selectedLabRecord)">
                删除
              </button>
              <div class="knowledge-inline-actions">
                <button class="ghost-action" type="button" @click="toggleLabRecordFlag(selectedLabRecord)">
                  {{ isFlagged(selectedLabRecord.flaggedAt) ? '取消 Flag' : 'Flag' }}
                </button>
                <button class="ghost-action" type="button" @click="toggleLabRecordPinned(selectedLabRecord)">
                  {{ isPinned(selectedLabRecord.pinnedAt) ? '取消置顶' : '置顶' }}
                </button>
                <button
                  class="ghost-action"
                  type="button"
                  @pointerdown="captureTodoSelectionFromWindow"
                  @click="createLabTodo(selectedLabRecord)"
                >
                  待办
                </button>
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
        <span class="counter">提醒可用</span>
      </div>

      <div class="park-intro">
        <p>目标、计划、待办和周期回顾后续会放在这里；现在先放一个每日记录提醒入口，帮你养成晚间回顾习惯。</p>
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

      <section class="tool-card daily-reminder-card" aria-labelledby="daily-reminder-title">
        <div class="section-heading compact">
          <div>
            <p class="eyebrow">固定提醒</p>
            <h2 id="daily-reminder-title">每日记录提醒</h2>
          </div>
          <span class="counter">
            {{ dailyJournalReminder.enabled ? '已开启' : '未开启' }}
          </span>
        </div>

        <p class="daily-reminder-copy">
          每天晚上 {{ dailyJournalReminderTimeLabel }} 发一条系统通知，提醒你回来记一下今天。
        </p>

        <div class="daily-reminder-meta">
          <span>固定时间 {{ dailyJournalReminderTimeLabel }}</span>
          <span v-if="dailyJournalReminder.updatedAt">
            上次调整 {{ getDateGroupLabel(dailyJournalReminder.updatedAt) }} ·
            {{ formatEntryTime(dailyJournalReminder.updatedAt) }}
          </span>
        </div>

        <p v-if="dailyJournalReminderStatusMessage" class="daily-reminder-status">
          {{ dailyJournalReminderStatusMessage }}
        </p>

        <div class="entry-actions">
          <button class="ghost-action" type="button" @click="openDailyJournalReminderComposer">
            去记录
          </button>
          <button
            class="primary-action small"
            type="button"
            :disabled="dailyJournalReminderIsSaving"
            @click="
              dailyJournalReminder.enabled
                ? disableDailyJournalReminder()
                : enableDailyJournalReminder()
            "
          >
            {{
              dailyJournalReminderIsSaving
                ? '处理中...'
                : dailyJournalReminder.enabled
                  ? '关闭提醒'
                  : '开启提醒'
            }}
          </button>
        </div>
      </section>
    </section>

    <section
      v-if="resolvedCardActionMenuTarget"
      ref="cardActionMenuPanel"
      class="card-action-menu-popover"
      :style="cardActionMenuStyle"
      :aria-label="`${cardActionMenuTitle} 的操作菜单`"
      role="menu"
      @click.stop
    >
      <button
        v-for="item in cardActionMenuItems"
        :key="item.id"
        class="card-action-menu-item"
        :class="{ 'is-danger': item.tone === 'danger' }"
        type="button"
        role="menuitem"
        @click="runCardAction(item.id)"
      >
        {{ item.label }}
      </button>
    </section>

    <input
      ref="imageImportInputRef"
      class="visually-hidden-input"
      type="file"
      accept="image/*"
      multiple
      @change="handleImageImportChange"
    />

    <div
      v-if="recordImagePreview"
      class="image-preview-backdrop"
      role="presentation"
      @click="closeRecordImagePreview"
    >
      <section
        class="image-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-preview-title"
        @click.stop
      >
        <div class="image-preview-header">
          <div>
            <p class="eyebrow">图片预览</p>
            <h2 id="image-preview-title">{{ recordImagePreview.name }}</h2>
            <small>{{ recordImagePreview.width }} × {{ recordImagePreview.height }}</small>
          </div>
          <button class="panel-close" type="button" @click="closeRecordImagePreview">
            关闭
          </button>
        </div>

        <img
          class="image-preview-image"
          :src="recordImagePreview.dataUrl"
          :alt="recordImagePreview.name"
        />
      </section>
    </div>

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

    <div
      v-if="todoCompletionDraft"
      class="todo-completion-sheet"
      role="dialog"
      aria-modal="false"
      aria-labelledby="todo-completion-title"
    >
      <div class="todo-completion-card">
        <div>
          <p class="eyebrow">完成啦</p>
          <h2 id="todo-completion-title">加个完成备注？</h2>
        </div>
        <input
          v-model="todoCompletionNote"
          type="text"
          maxlength="80"
          placeholder="可选，例如：已测试通过"
          @input="keepTodoCompletionPanelOpen"
          @focus="keepTodoCompletionPanelOpen"
        />
        <p>{{ resolveTodoSource(todoCompletionDraft).content }}</p>
        <div class="todo-completion-actions">
          <button class="ghost-action" type="button" @click="closeTodoCompletionDraft">
            跳过
          </button>
          <button class="primary-action small" type="button" @click="saveTodoCompletionNote">
            完成
          </button>
        </div>
      </div>
    </div>

    <div
      class="agent-layer"
      :class="agentLayerClasses"
      :style="agentLayerStyle"
    >
      <button
        ref="agentFabRef"
        class="agent-fab"
        type="button"
        :aria-expanded="agentPanelOpen"
        aria-controls="agent-panel"
        aria-label="拖动调整 Agent 浮钮位置，点击打开 Agent"
        @pointerdown="handleAgentFabPointerDown"
        @pointermove="handleAgentFabPointerMove"
        @pointerup="finishAgentFabDrag"
        @pointercancel="finishAgentFabDrag"
        @click="handleAgentFabClick"
      >
        <span class="anime-avatar" aria-hidden="true">
          <span class="avatar-hair"></span>
          <span class="avatar-face">
            <i></i>
            <i></i>
            <b></b>
          </span>
        </span>
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
