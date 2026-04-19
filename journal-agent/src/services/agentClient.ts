import type { JournalEntry } from '../types/journal';
import type { KnowledgeBase, KnowledgeNote } from '../types/knowledge';
import type { LabProject, LabRecord } from '../types/lab';
import { buildJournalRagContextTool } from './journalRagSearch';
import {
  buildRecordAgentContextTool,
  runRecordToolCalls,
  type RecordAgentMutationKind,
} from './recordAgentTool';

export type AgentMessageRole = 'user' | 'assistant';
type AgentApiMessageRole = AgentMessageRole | 'system';

export interface AgentChatMessage {
  id: string;
  role: AgentMessageRole;
  content: string;
  createdAt: string;
}

interface SendAgentMessageOptions {
  messages: AgentChatMessage[];
  entries: JournalEntry[];
  knowledgeBases: KnowledgeBase[];
  knowledgeNotes: KnowledgeNote[];
  labProjects: LabProject[];
  labRecords: LabRecord[];
  activeJournalEntryId?: string | null;
  activeKnowledgeBaseId?: string | null;
  selectedKnowledgeNoteId?: string | null;
  activeLabProjectId?: string | null;
  selectedLabRecordId?: string | null;
}

export interface SendAgentMessageResult {
  assistantMessage: AgentChatMessage;
  mutationKind: RecordAgentMutationKind | null;
  mutatedJournalEntryId: string | null;
  mutatedKnowledgeBaseId: string | null;
  mutatedKnowledgeNoteId: string | null;
  mutatedLabProjectId: string | null;
  mutatedLabRecordId: string | null;
}

interface AgentApiMessage {
  role: AgentApiMessageRole;
  content: string;
}

const AGENT_SYSTEM_PROMPT = [
  '你是「心记 Agent」，一个帮助用户回顾、整理和理解个人记录的中文助手。',
  '你可以读取由 App 提供的 journal.search 和 record.write_context。',
  '回答日志相关问题时，要优先引用或概括 journal.search 提供的证据片段。',
  '如果检索结果没有足够证据，请直接说明“当前日志里没有足够证据”，不要编造。',
  '你还可以帮助用户新增或编辑三记内容：心记、笔记、做记。',
  '你只能使用受限工具协议，绝不能删除任何心记、知识笔记、做记记录、知识库或做记项目。',
  '当且仅当用户明确要求“新增”或“编辑”时，才允许发起写入。',
  '如果目标区域、目标知识库、目标做记项目或目标记录不明确，先追问，不要猜。',
  '编辑时如果只改标题、标签、链接或做记类型，可以把 contentMode 设为 keep 并省略 content。',
  '可用 tool_call 如下，只输出 block 本身，不要附带解释：',
  '[tool_call: journal.entry.create]',
  '{"title":"可选标题","content":"正文"}',
  '[/tool_call]',
  '[tool_call: journal.entry.update]',
  '{"entryId":"心记id","title":"可选新标题","contentMode":"replace|append|prepend|keep","content":"正文"}',
  '[/tool_call]',
  '[tool_call: knowledge.note.create]',
  '{"baseId":"知识库id","title":"可选标题","content":"正文","sourceUrl":"可选链接","tags":["标签1","标签2"]}',
  '[/tool_call]',
  '[tool_call: knowledge.note.update]',
  '{"noteId":"笔记id","title":"可选新标题","contentMode":"replace|append|prepend|keep","content":"正文","sourceUrl":"可选新链接","clearSourceUrl":false,"tags":["标签1","标签2"]}',
  '[/tool_call]',
  '[tool_call: lab.record.create]',
  '{"projectId":"做记项目id","title":"可选标题","content":"正文","type":"operation|review","tags":["标签1","标签2"]}',
  '[/tool_call]',
  '[tool_call: lab.record.update]',
  '{"recordId":"做记记录id","title":"可选新标题","contentMode":"replace|append|prepend|keep","content":"正文","type":"operation|review","tags":["标签1","标签2"]}',
  '[/tool_call]',
  '收到 tool_result 后，再用自然语言向用户确认是否成功，不要再次输出 tool_call。',
  '语气保持温和、简洁、像一个可靠的私人记录助手。',
].join('\n');

const normalizeChatEndpoint = (apiUrl: string): string => {
  const normalizedUrl = apiUrl.trim().replace(/\/+$/, '');

  if (!normalizedUrl) {
    return '';
  }

  if (
    normalizedUrl.endsWith('/chat/completions') ||
    normalizedUrl.endsWith('/responses')
  ) {
    return normalizedUrl;
  }

  try {
    const parsedUrl = new URL(normalizedUrl);

    if (parsedUrl.pathname === '/') {
      return `${parsedUrl.origin}/v1/chat/completions`;
    }
  } catch {
    return normalizedUrl;
  }

  if (normalizedUrl.endsWith('/v1')) {
    return `${normalizedUrl}/chat/completions`;
  }

  return normalizedUrl;
};

export const AGENT_API_CONFIG = {
  baseUrl: normalizeChatEndpoint(import.meta.env.api_url ?? ''),
  apiKey: import.meta.env.api_key ?? '',
  model: import.meta.env.model ?? '',
};

export const isAgentUsingPlaceholder = (): boolean =>
  !AGENT_API_CONFIG.baseUrl || !AGENT_API_CONFIG.apiKey || !AGENT_API_CONFIG.model;

export const getAgentModeLabel = (): string =>
  isAgentUsingPlaceholder() ? '占位模型' : '真实 API';

export const getAgentModelLabel = (): string =>
  AGENT_API_CONFIG.model || 'journal-agent-placeholder-model';

const createId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `agent-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readAssistantContent = (data: unknown): string | null => {
  if (!isRecord(data)) {
    return null;
  }

  if (typeof data.content === 'string') {
    return data.content;
  }

  if (!Array.isArray(data.choices)) {
    return null;
  }

  const firstChoice = data.choices[0];

  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    return null;
  }

  return typeof firstChoice.message.content === 'string'
    ? firstChoice.message.content
    : null;
};

const createMockReply = async (
  message: string,
  entries: JournalEntry[],
  knowledgeBases: KnowledgeBase[],
  knowledgeNotes: KnowledgeNote[],
  labProjects: LabProject[],
  labRecords: LabRecord[],
  activeJournalEntryId: string | null | undefined,
  activeKnowledgeBaseId: string | null | undefined,
  selectedKnowledgeNoteId: string | null | undefined,
  activeLabProjectId: string | null | undefined,
  selectedLabRecordId: string | null | undefined,
): Promise<string> => {
  const journalContext = await buildJournalRagContextTool(entries, message);
  const recordContext = buildRecordAgentContextTool(
    entries,
    knowledgeBases,
    knowledgeNotes,
    labProjects,
    labRecords,
    {
      activeJournalEntryId,
      activeKnowledgeBaseId,
      selectedKnowledgeNoteId,
      activeLabProjectId,
      selectedLabRecordId,
    },
  );
  const writeHint =
    /心记|笔记|做记|日志|知识库|项目|复盘|操作|新增|添加|编辑|修改/.test(message)
      ? '当前还是占位模型，暂时不会真的改三记内容；接入真实 API 后，Agent 可以调用受限工具新增或编辑心记、笔记、做记。'
      : '真实大模型接入后，Agent 也可以在授权范围内帮你新增或编辑三记内容。';

  return [
    `我先用占位模型回应你：${message}`,
    `日志工具状态：${journalContext.statusLabel}`,
    `三记写入工具状态：${recordContext.statusLabel}`,
    writeHint,
    '真实大模型接入时，我们会把 API Key 放在后端代理里，而不是直接放进 App 客户端。',
  ].join('\n\n');
};

const buildAgentApiMessages = (
  messages: AgentChatMessage[],
  entries: JournalEntry[],
  knowledgeBases: KnowledgeBase[],
  knowledgeNotes: KnowledgeNote[],
  labProjects: LabProject[],
  labRecords: LabRecord[],
  latestUserMessage: string,
  activeJournalEntryId: string | null | undefined,
  activeKnowledgeBaseId: string | null | undefined,
  selectedKnowledgeNoteId: string | null | undefined,
  activeLabProjectId: string | null | undefined,
  selectedLabRecordId: string | null | undefined,
): Promise<AgentApiMessage[]> =>
  Promise.all([
    buildJournalRagContextTool(entries, latestUserMessage),
    buildRecordAgentContextTool(
      entries,
      knowledgeBases,
      knowledgeNotes,
      labProjects,
      labRecords,
      {
        activeJournalEntryId,
        activeKnowledgeBaseId,
        selectedKnowledgeNoteId,
        activeLabProjectId,
        selectedLabRecordId,
      },
    ),
  ]).then(([journalContext, recordContext]) => [
    {
      role: 'system',
      content: AGENT_SYSTEM_PROMPT,
    },
    {
      role: 'system',
      content: journalContext.toolMessage,
    },
    {
      role: 'system',
      content: recordContext.toolMessage,
    },
    ...messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ]);

const requestAgentCompletion = async (
  apiMessages: AgentApiMessage[],
): Promise<string> => {
  // 真实生产版本不要把 API Key 放在客户端；后续应替换为你的后端代理地址。
  const response = await fetch(AGENT_API_CONFIG.baseUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${AGENT_API_CONFIG.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: getAgentModelLabel(),
      messages: apiMessages,
    }),
  });

  if (!response.ok) {
    throw new Error(`Agent request failed with ${response.status}`);
  }

  const data: unknown = await response.json();

  return (
    readAssistantContent(data) ??
    '模型返回了结果，但当前客户端还没有解析这个响应格式。'
  );
};

const createToolExecutionSummary = (
  toolResultMessage: string,
  mutationKind: RecordAgentMutationKind | null,
  mutatedJournalEntryId: string | null,
  mutatedKnowledgeNoteId: string | null,
  mutatedLabRecordId: string | null,
): string => {
  if (!toolResultMessage.includes('status: success')) {
    return '我尝试执行记录操作了，但没有成功完成。你可以换一种更明确的说法再试一次。';
  }

  if (mutationKind === 'journal-entry' && mutatedJournalEntryId) {
    return `心记操作已经执行完成，目标日志 id 是 ${mutatedJournalEntryId}。`;
  }

  if (mutationKind === 'knowledge-note' && mutatedKnowledgeNoteId) {
    return `知识笔记操作已经执行完成，目标笔记 id 是 ${mutatedKnowledgeNoteId}。`;
  }

  if (mutationKind === 'lab-record' && mutatedLabRecordId) {
    return `做记操作已经执行完成，目标记录 id 是 ${mutatedLabRecordId}。`;
  }

  return '三记写入操作已经执行完成。';
};

export const createAgentMessage = (
  role: AgentMessageRole,
  content: string,
): AgentChatMessage => ({
  id: createId(),
  role,
  content,
  createdAt: new Date().toISOString(),
});

export const sendAgentMessage = async ({
  messages,
  entries,
  knowledgeBases,
  knowledgeNotes,
  labProjects,
  labRecords,
  activeJournalEntryId,
  activeKnowledgeBaseId,
  selectedKnowledgeNoteId,
  activeLabProjectId,
  selectedLabRecordId,
}: SendAgentMessageOptions): Promise<SendAgentMessageResult> => {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === 'user');

  if (!latestUserMessage) {
    return {
      assistantMessage: createAgentMessage(
        'assistant',
        '你可以先告诉我今天想整理哪一段心情。',
      ),
      mutationKind: null,
      mutatedJournalEntryId: null,
      mutatedKnowledgeBaseId: null,
      mutatedKnowledgeNoteId: null,
      mutatedLabProjectId: null,
      mutatedLabRecordId: null,
    };
  }

  if (isAgentUsingPlaceholder()) {
    await wait(520);
    return {
      assistantMessage: createAgentMessage(
        'assistant',
        await createMockReply(
          latestUserMessage.content,
          entries,
          knowledgeBases,
          knowledgeNotes,
          labProjects,
          labRecords,
          activeJournalEntryId,
          activeKnowledgeBaseId,
          selectedKnowledgeNoteId,
          activeLabProjectId,
          selectedLabRecordId,
        ),
      ),
      mutationKind: null,
      mutatedJournalEntryId: null,
      mutatedKnowledgeBaseId: null,
      mutatedKnowledgeNoteId: null,
      mutatedLabProjectId: null,
      mutatedLabRecordId: null,
    };
  }

  const apiMessages = await buildAgentApiMessages(
    messages,
    entries,
    knowledgeBases,
    knowledgeNotes,
    labProjects,
    labRecords,
    latestUserMessage.content,
    activeJournalEntryId,
    activeKnowledgeBaseId,
    selectedKnowledgeNoteId,
    activeLabProjectId,
    selectedLabRecordId,
  );
  const assistantContent = await requestAgentCompletion(apiMessages);
  const toolRunResult = runRecordToolCalls(assistantContent);

  if (!toolRunResult) {
    return {
      assistantMessage: createAgentMessage('assistant', assistantContent),
      mutationKind: null,
      mutatedJournalEntryId: null,
      mutatedKnowledgeBaseId: null,
      mutatedKnowledgeNoteId: null,
      mutatedLabProjectId: null,
      mutatedLabRecordId: null,
    };
  }

  const followUpMessages: AgentApiMessage[] = [
    ...apiMessages,
    {
      role: 'assistant',
      content: assistantContent,
    },
    {
      role: 'system',
      content: toolRunResult.toolResultMessage,
    },
    {
      role: 'system',
      content:
        '三记写入工具已经执行完毕。现在只用自然语言向用户说明结果，不要再次输出 tool_call，也不要发起新的写入。',
    },
  ];

  let followUpContent = '';

  try {
    followUpContent = await requestAgentCompletion(followUpMessages);
  } catch {
    followUpContent = createToolExecutionSummary(
      toolRunResult.toolResultMessage,
      toolRunResult.mutationKind,
      toolRunResult.mutatedJournalEntryId,
      toolRunResult.mutatedKnowledgeNoteId,
      toolRunResult.mutatedLabRecordId,
    );
  }

  if (followUpContent.includes('[tool_call:')) {
    followUpContent = createToolExecutionSummary(
      toolRunResult.toolResultMessage,
      toolRunResult.mutationKind,
      toolRunResult.mutatedJournalEntryId,
      toolRunResult.mutatedKnowledgeNoteId,
      toolRunResult.mutatedLabRecordId,
    );
  }

  return {
    assistantMessage: createAgentMessage('assistant', followUpContent),
    mutationKind: toolRunResult.mutationKind,
    mutatedJournalEntryId: toolRunResult.mutatedJournalEntryId,
    mutatedKnowledgeBaseId: toolRunResult.mutatedKnowledgeBaseId,
    mutatedKnowledgeNoteId: toolRunResult.mutatedKnowledgeNoteId,
    mutatedLabProjectId: toolRunResult.mutatedLabProjectId,
    mutatedLabRecordId: toolRunResult.mutatedLabRecordId,
  };
};
