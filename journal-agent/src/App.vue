<script setup lang="ts">
import { computed, ref } from 'vue';
import type { CalendarDay } from './utils/date';
import type { JournalEntry } from './types/journal';
import type { KnowledgeBase, KnowledgeNote } from './types/knowledge';
import {
  createAgentMessage,
  getAgentModeLabel,
  getAgentModelLabel,
  isAgentUsingPlaceholder,
  sendAgentMessage,
  type AgentChatMessage,
} from './services/agentClient';
import { getJournalRagIndexStatus } from './services/journalRagSearch';
import {
  appendAgentConversationMessage,
  createAgentConversation,
  getActiveAgentConversationId,
  getAgentConversations,
  setActiveAgentConversationId,
  type AgentConversation,
} from './storage/agentConversationStore';
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

interface ParkSummary {
  id: ActivePark;
  label: string;
  eyebrow: string;
  title: string;
  description: string;
  caption: string;
  metricValue: string;
  metricLabel: string;
}

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
const activePark = ref<ActivePark>('journal');
const activeView = ref<ActiveView>('timeline');
const draftTitle = ref('');
const draftContent = ref('');
const editingId = ref<string | null>(null);
const editingContent = ref('');
const activeKnowledgeBaseId = ref<string | null>(knowledgeBases.value[0]?.id ?? null);
const newKnowledgeBaseName = ref('');
const newKnowledgeBaseDescription = ref('');
const newKnowledgeBaseTags = ref('');
const editingKnowledgeBaseName = ref(knowledgeBases.value[0]?.name ?? '');
const editingKnowledgeBaseDescription = ref(knowledgeBases.value[0]?.description ?? '');
const editingKnowledgeBaseTags = ref(knowledgeBases.value[0]?.tags.join('，') ?? '');
const newKnowledgeNoteTitle = ref('');
const newKnowledgeNoteContent = ref('');
const newKnowledgeNoteSourceUrl = ref('');
const newKnowledgeNoteTags = ref('');
const editingKnowledgeNoteId = ref<string | null>(null);
const editingKnowledgeNoteTitle = ref('');
const editingKnowledgeNoteContent = ref('');
const editingKnowledgeNoteSourceUrl = ref('');
const editingKnowledgeNoteTags = ref('');
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

const groupedEntries = computed(() => groupEntriesByDate(entries.value));

const entryCountByDate = computed(() => {
  const counts = new Map<string, number>();

  for (const entry of entries.value) {
    const key = getLocalDateKey(entry.createdAt);
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

const knowledgeNoteCount = computed(() => knowledgeNotes.value.length);
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

const parkSummaries = computed<ParkSummary[]>(() => [
  {
    id: 'journal',
    label: '日记区',
    eyebrow: '个人记录',
    title: '心记',
    description: formatTodayHeader(),
    caption: '写下每天发生的事',
    metricValue: String(todayCount.value),
    metricLabel: '今日',
  },
  {
    id: 'knowledge',
    label: '知识库',
    eyebrow: '学习资料',
    title: '知识库',
    description: '学习库和知识记录会放在这里，不混入日记时间线。',
    caption: '整理长期知识',
    metricValue: String(knowledgeBases.value.length),
    metricLabel: '知识库',
  },
  {
    id: 'lab',
    label: '项目实验库',
    eyebrow: '进度追踪',
    title: '项目实验库',
    description: '项目、实验、决策和复盘会在这里聚合。',
    caption: '项目与实验',
    metricValue: 'Park',
    metricLabel: '规划',
  },
  {
    id: 'plan',
    label: '计划区',
    eyebrow: '未来安排',
    title: '计划区',
    description: '目标、计划和待办后续会进入这里。',
    caption: '目标与计划',
    metricValue: 'Park',
    metricLabel: '规划',
  },
]);

const activeParkSummary = computed(
  () =>
    parkSummaries.value.find((park) => park.id === activePark.value) ??
    parkSummaries.value[0],
);

const draftCharacterCount = computed(() => draftContent.value.trim().length);
const canSaveDraft = computed(() => draftCharacterCount.value > 0);
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
const canSendAgentMessage = computed(
  () => agentInput.value.trim().length > 0 && !agentIsThinking.value,
);

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
  entries.value.filter((entry) => getLocalDateKey(entry.createdAt) === selectedDateKey.value),
);

const selectedDateLabel = computed(() => {
  const firstEntry = selectedDateEntries.value[0];

  if (firstEntry) {
    return getDateGroupLabel(firstEntry.createdAt);
  }

  return formatDateLabel(new Date(`${selectedDateKey.value}T00:00:00`));
});

function refreshEntries() {
  entries.value = getEntries();
}

function parseKnowledgeTags(rawTags: string): string[] {
  return rawTags
    .split(/[,，、\n]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function resetKnowledgeBaseEditor(base: KnowledgeBase | null) {
  editingKnowledgeBaseName.value = base?.name ?? '';
  editingKnowledgeBaseDescription.value = base?.description ?? '';
  editingKnowledgeBaseTags.value = base?.tags.join('，') ?? '';
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

  resetKnowledgeBaseEditor(activeKnowledgeBase.value);
}

function getKnowledgeNoteCount(baseId: string): number {
  return knowledgeNotes.value.filter((note) => note.baseId === baseId).length;
}

function selectKnowledgeBase(baseId: string) {
  activeKnowledgeBaseId.value = baseId;
  cancelKnowledgeNoteEditing();
  resetKnowledgeBaseEditor(activeKnowledgeBase.value);
}

function saveNewKnowledgeBase() {
  const base = createKnowledgeBase(
    newKnowledgeBaseName.value,
    newKnowledgeBaseDescription.value,
    parseKnowledgeTags(newKnowledgeBaseTags.value),
  );

  if (!base) {
    return;
  }

  activeKnowledgeBaseId.value = base.id;
  newKnowledgeBaseName.value = '';
  newKnowledgeBaseDescription.value = '';
  newKnowledgeBaseTags.value = '';
  refreshKnowledgeData();
}

function saveKnowledgeBaseDetails() {
  if (!activeKnowledgeBase.value) {
    return;
  }

  const updatedBase = updateKnowledgeBase(activeKnowledgeBase.value.id, {
    name: editingKnowledgeBaseName.value,
    description: editingKnowledgeBaseDescription.value,
    tags: parseKnowledgeTags(editingKnowledgeBaseTags.value),
  });

  if (!updatedBase) {
    return;
  }

  activeKnowledgeBaseId.value = updatedBase.id;
  refreshKnowledgeData();
}

function removeKnowledgeBase(base: KnowledgeBase) {
  const shouldDelete = window.confirm(
    `确定删除「${base.name}」知识库吗？库下知识记录也会从知识库区移除。`,
  );

  if (!shouldDelete) {
    return;
  }

  deleteKnowledgeBase(base.id);
  cancelKnowledgeNoteEditing();
  refreshKnowledgeData();
}

function saveNewKnowledgeNote() {
  if (!activeKnowledgeBase.value) {
    return;
  }

  const note = createKnowledgeNote(activeKnowledgeBase.value.id, {
    title: newKnowledgeNoteTitle.value,
    content: newKnowledgeNoteContent.value,
    sourceUrl: newKnowledgeNoteSourceUrl.value,
    tags: parseKnowledgeTags(newKnowledgeNoteTags.value),
  });

  if (!note) {
    return;
  }

  newKnowledgeNoteTitle.value = '';
  newKnowledgeNoteContent.value = '';
  newKnowledgeNoteSourceUrl.value = '';
  newKnowledgeNoteTags.value = '';
  refreshKnowledgeData();
}

function startKnowledgeNoteEditing(note: KnowledgeNote) {
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
    tags: parseKnowledgeTags(editingKnowledgeNoteTags.value),
  });

  if (!updatedNote) {
    return;
  }

  cancelKnowledgeNoteEditing();
  refreshKnowledgeData();
}

function removeKnowledgeNote(note: KnowledgeNote) {
  const shouldDelete = window.confirm(`确定删除「${note.title}」这条知识记录吗？`);

  if (!shouldDelete) {
    return;
  }

  deleteKnowledgeNote(note.id);

  if (editingKnowledgeNoteId.value === note.id) {
    cancelKnowledgeNoteEditing();
  }

  refreshKnowledgeData();
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
}

function saveDraft() {
  const entry = createEntry(draftContent.value, draftTitle.value);

  if (!entry) {
    return;
  }

  draftTitle.value = '';
  draftContent.value = '';
  refreshEntries();
}

function startEditing(entry: JournalEntry) {
  editingId.value = entry.id;
  editingContent.value = entry.content;
}

function cancelEditing() {
  editingId.value = null;
  editingContent.value = '';
}

function saveEditing() {
  if (!editingId.value) {
    return;
  }

  const updated = updateEntry(editingId.value, editingContent.value);

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
    const assistantMessage = await sendAgentMessage({
      messages: requestConversation?.messages ?? [userMessage],
      entries: entries.value,
    });
    appendAgentConversationMessage(conversation.id, assistantMessage);
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
</script>

<template>
  <main class="journal-app">
    <section class="hero-panel" aria-labelledby="app-title">
      <div>
        <p class="eyebrow">{{ activeParkSummary.eyebrow }}</p>
        <h1 id="app-title">{{ activeParkSummary.title }}</h1>
        <p class="today-line">{{ activeParkSummary.description }}</p>
      </div>

      <div class="header-actions" aria-label="快捷操作">
        <div class="today-pill">
          <span>{{ activeParkSummary.metricValue }}</span>
          <small>{{ activeParkSummary.metricLabel }}</small>
        </div>
      </div>
    </section>

    <nav class="park-switcher" aria-label="记录 Park">
      <button
        v-for="park in parkSummaries"
        :key="park.id"
        type="button"
        :class="{ active: activePark === park.id }"
        @click="setActivePark(park.id)"
      >
        <span>{{ park.label }}</span>
        <small>{{ park.caption }}</small>
      </button>
    </nav>

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
      <div class="section-heading">
        <div>
          <p class="eyebrow">新的记录</p>
          <h2 id="compose-title">今天想记点什么？</h2>
        </div>
        <span class="counter">{{ draftCharacterCount }} 字</span>
      </div>

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
        <article v-for="entry in searchResults" :key="entry.id" class="entry-card">
          <template v-if="editingId === entry.id">
            <textarea v-model="editingContent" class="journal-input edit-input" rows="7" />
            <div class="entry-actions">
              <button class="ghost-action" type="button" @click="cancelEditing">取消</button>
              <button
                class="primary-action small"
                type="button"
                :disabled="editingContent.trim().length === 0"
                @click="saveEditing"
              >
                保存修改
              </button>
            </div>
          </template>

          <template v-else>
            <button class="entry-body" type="button" @click="startEditing(entry)">
              <span class="entry-time">
                {{ getDateGroupLabel(entry.createdAt) }} · {{ formatEntryTime(entry.createdAt) }}
              </span>
              <strong>{{ entry.title }}</strong>
              <p>{{ entry.content }}</p>
            </button>

            <div class="entry-footer">
              <span>{{ entry.content.length }} 字</span>
              <button class="delete-action" type="button" @click="removeEntry(entry)">
                删除
              </button>
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
          <span class="counter">{{ selectedDateEntries.length }} 条</span>
        </div>

        <div v-if="selectedDateEntries.length === 0" class="empty-state">
          <p>这一天还没有记录。</p>
          <span>可以回到时间线，为这一天之后补上回忆。</span>
        </div>

        <div v-else class="entry-groups">
          <article v-for="entry in selectedDateEntries" :key="entry.id" class="entry-card">
            <template v-if="editingId === entry.id">
              <textarea v-model="editingContent" class="journal-input edit-input" rows="7" />
              <div class="entry-actions">
                <button class="ghost-action" type="button" @click="cancelEditing">取消</button>
                <button
                  class="primary-action small"
                  type="button"
                  :disabled="editingContent.trim().length === 0"
                  @click="saveEditing"
                >
                  保存修改
                </button>
              </div>
            </template>

            <template v-else>
              <button class="entry-body" type="button" @click="startEditing(entry)">
                <span class="entry-time">{{ formatEntryTime(entry.createdAt) }}</span>
                <strong>{{ entry.title }}</strong>
                <p>{{ entry.content }}</p>
              </button>

              <div class="entry-footer">
                <span>{{ entry.content.length }} 字</span>
                <button class="delete-action" type="button" @click="removeEntry(entry)">
                  删除
                </button>
              </div>
            </template>
          </article>
        </div>
      </div>
    </section>

    <section v-if="activeView === 'timeline'" class="timeline" aria-labelledby="timeline-title">
      <div class="section-heading compact">
        <div>
          <p class="eyebrow">回顾</p>
          <h2 id="timeline-title">日志时间线</h2>
        </div>
        <span class="counter">{{ entries.length }} 条</span>
      </div>

      <div v-if="entries.length === 0" class="empty-state">
        <p>还没有日志。</p>
        <span>先写下第一条，之后这里会按时间整理你的记录。</span>
      </div>

      <div v-else class="entry-groups">
        <section v-for="group in groupedEntries" :key="group.label" class="entry-group">
          <h3>{{ group.label }}</h3>

          <article v-for="entry in group.entries" :key="entry.id" class="entry-card">
            <template v-if="editingId === entry.id">
              <textarea v-model="editingContent" class="journal-input edit-input" rows="7" />
              <div class="entry-actions">
                <button class="ghost-action" type="button" @click="cancelEditing">取消</button>
                <button
                  class="primary-action small"
                  type="button"
                  :disabled="editingContent.trim().length === 0"
                  @click="saveEditing"
                >
                  保存修改
                </button>
              </div>
            </template>

            <template v-else>
              <button class="entry-body" type="button" @click="startEditing(entry)">
                <span class="entry-time">{{ formatEntryTime(entry.createdAt) }}</span>
                <strong>{{ entry.title }}</strong>
                <p>{{ entry.content }}</p>
              </button>

              <div class="entry-footer">
                <span>{{ entry.content.length }} 字</span>
                <button class="delete-action" type="button" @click="removeEntry(entry)">
                  删除
                </button>
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
      aria-labelledby="knowledge-park-title"
    >
      <section class="tool-card" aria-labelledby="knowledge-park-title">
        <div class="section-heading">
          <div>
            <p class="eyebrow">知识库 Park</p>
            <h2 id="knowledge-park-title">创建学习库</h2>
          </div>
          <span class="counter">{{ knowledgeBases.length }} 库</span>
        </div>

        <input
          v-model="newKnowledgeBaseName"
          class="title-input"
          type="text"
          maxlength="40"
          placeholder="知识库名称，例如：GitHub 学习库"
          aria-label="知识库名称"
        />

        <textarea
          v-model="newKnowledgeBaseDescription"
          class="journal-input knowledge-description-input"
          placeholder="这个库用来沉淀哪类知识？"
          rows="3"
        />

        <input
          v-model="newKnowledgeBaseTags"
          class="search-input compact-input"
          type="text"
          placeholder="标签，可选，用逗号分隔"
          aria-label="知识库标签"
        />

        <button
          class="primary-action"
          type="button"
          :disabled="!canCreateKnowledgeBase"
          @click="saveNewKnowledgeBase"
        >
          新建知识库
        </button>
      </section>

      <section class="knowledge-layout" aria-label="知识库工作区">
        <aside class="tool-card knowledge-sidebar" aria-label="知识库列表">
          <div class="section-heading compact">
            <div>
              <p class="eyebrow">学习库</p>
              <h2>知识库列表</h2>
            </div>
            <span class="counter">{{ knowledgeNoteCount }} 条</span>
          </div>

          <div v-if="knowledgeBases.length === 0" class="empty-state">
            <p>还没有知识库。</p>
            <span>先创建一个“GitHub 学习库”，再往里面追加知识记录。</span>
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
              <span>{{ getKnowledgeNoteCount(base.id) }} 条记录</span>
              <small>
                {{ getDateGroupLabel(base.updatedAt) }} · {{ formatEntryTime(base.updatedAt) }}
              </small>
              <small v-if="base.tags.length > 0">{{ base.tags.join(' / ') }}</small>
            </button>
          </div>
        </aside>

        <section
          v-if="activeKnowledgeBase"
          class="tool-card knowledge-detail"
          aria-labelledby="active-knowledge-base-title"
        >
          <div class="section-heading">
            <div>
              <p class="eyebrow">当前知识库</p>
              <h2 id="active-knowledge-base-title">{{ activeKnowledgeBase.name }}</h2>
            </div>
            <span class="counter">{{ activeKnowledgeNotes.length }} 条</span>
          </div>

          <div class="knowledge-edit-panel">
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
              rows="3"
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
                删除知识库
              </button>
              <button
                class="primary-action small"
                type="button"
                :disabled="!canSaveKnowledgeBase"
                @click="saveKnowledgeBaseDetails"
              >
                保存知识库
              </button>
            </div>
          </div>

          <section class="knowledge-note-composer" aria-labelledby="knowledge-note-compose-title">
            <div class="section-heading compact">
              <div>
                <p class="eyebrow">新增知识</p>
                <h2 id="knowledge-note-compose-title">追加一条知识记录</h2>
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
              rows="6"
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
            <button
              class="primary-action"
              type="button"
              :disabled="!canCreateKnowledgeNote"
              @click="saveNewKnowledgeNote"
            >
              保存知识记录
            </button>
          </section>

          <section class="knowledge-note-list" aria-label="知识记录列表">
            <div class="section-heading compact">
              <div>
                <p class="eyebrow">库内记录</p>
                <h2>知识记录</h2>
              </div>
            </div>

            <div v-if="activeKnowledgeNotes.length === 0" class="empty-state">
              <p>这个知识库还是空的。</p>
              <span>把第一条知识记录放进来，它就不会混进日记区。</span>
            </div>

            <div v-else class="knowledge-note-items">
              <article
                v-for="note in activeKnowledgeNotes"
                :key="note.id"
                class="entry-card knowledge-note-card"
              >
                <template v-if="editingKnowledgeNoteId === note.id">
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
                    rows="7"
                  />
                  <input
                    v-model="editingKnowledgeNoteSourceUrl"
                    class="search-input compact-input"
                    type="url"
                    placeholder="来源链接，可选"
                  />
                  <input
                    v-model="editingKnowledgeNoteTags"
                    class="search-input compact-input"
                    type="text"
                    placeholder="标签，用逗号分隔"
                  />
                  <div class="entry-actions">
                    <button class="ghost-action" type="button" @click="cancelKnowledgeNoteEditing">
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
                  <button class="entry-body" type="button" @click="startKnowledgeNoteEditing(note)">
                    <span class="entry-time">
                      {{ formatEntryTime(note.updatedAt) }}
                      <template v-if="note.sourceUrl"> · 有来源</template>
                    </span>
                    <strong>{{ note.title }}</strong>
                    <p>{{ note.content }}</p>
                  </button>

                  <div v-if="note.tags.length > 0" class="tag-row">
                    <span v-for="tag in note.tags" :key="tag">{{ tag }}</span>
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

                  <div class="entry-footer">
                    <span>{{ note.content.length }} 字</span>
                    <button class="delete-action" type="button" @click="removeKnowledgeNote(note)">
                      删除
                    </button>
                  </div>
                </template>
              </article>
            </div>
          </section>
        </section>
      </section>
    </section>

    <section
      v-else-if="activePark === 'lab'"
      class="park-placeholder"
      aria-labelledby="lab-park-title"
    >
      <div class="section-heading">
        <div>
          <p class="eyebrow">后续 Park</p>
          <h2 id="lab-park-title">项目实验库</h2>
        </div>
        <span class="counter">规划中</span>
      </div>

      <div class="park-intro">
        <p>项目进展、实验观察、关键决策和阶段复盘会在这里聚合。</p>
      </div>

      <div class="park-boundary-list" aria-label="项目实验库 Park 边界">
        <div>
          <strong>实验进度</strong>
          <span>按主题持续记录目标、过程、观察、结果和下一步。</span>
        </div>
        <div>
          <strong>项目记录</strong>
          <span>按项目聚合目标、里程碑、问题、决策和复盘。</span>
        </div>
      </div>
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
            placeholder="问问今天该怎么记录..."
            aria-label="输入给 Agent 的消息"
          />
          <button type="submit" :disabled="!canSendAgentMessage">发送</button>
        </form>
      </section>
    </div>
  </main>
</template>
