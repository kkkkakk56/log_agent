<script setup lang="ts">
import { computed, ref } from 'vue';
import type { CalendarDay } from './utils/date';
import type { JournalEntry } from './types/journal';
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

type ActiveView = 'timeline' | 'search' | 'calendar';

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
const activeView = ref<ActiveView>('timeline');
const draftTitle = ref('');
const draftContent = ref('');
const editingId = ref<string | null>(null);
const editingContent = ref('');
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
        <p class="eyebrow">今日</p>
        <h1 id="app-title">心记</h1>
        <p class="today-line">{{ formatTodayHeader() }}</p>
      </div>

      <div class="header-actions" aria-label="快捷操作">
        <button class="icon-button" type="button" @click="setActiveView('search')">
          搜索
        </button>
        <button class="icon-button" type="button" @click="setActiveView('calendar')">
          日历
        </button>
        <div class="today-pill">
          <span>{{ todayCount }}</span>
          <small>今日</small>
        </div>
      </div>
    </section>

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
