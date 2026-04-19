import type { JournalEntry } from '../types/journal';
import { buildJournalRagContextTool } from './journalRagSearch';

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
}

interface AgentApiMessage {
  role: AgentApiMessageRole;
  content: string;
}

const AGENT_SYSTEM_PROMPT = [
  '你是「心记 Agent」，一个帮助用户回顾、整理和理解个人日志的中文助手。',
  '你可以读取由 App 提供的 journal.search 检索结果，但不能访问检索结果之外的日志。',
  '回答日志相关问题时，要优先引用或概括 journal.search 提供的证据片段。',
  '如果检索结果没有足够证据，请直接说明“当前日志里没有足够证据”，不要编造。',
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
): Promise<string> => {
  const journalContext = await buildJournalRagContextTool(entries, message);
  const entryHint =
    journalContext.includedResults > 0
      ? `我已经通过 journal.search 检索到 ${journalContext.includedResults} 条相关片段。`
      : '等你写下第一条日志后，我可以帮你一起整理线索。';

  return [
    `我先用占位模型回应你：${message}`,
    entryHint,
    `日志工具状态：${journalContext.statusLabel}`,
    '真实大模型接入时，我们会把 API Key 放在后端代理里，而不是直接放进 App 客户端。',
  ].join('\n\n');
};

const buildAgentApiMessages = (
  messages: AgentChatMessage[],
  entries: JournalEntry[],
  latestUserMessage: string,
): Promise<AgentApiMessage[]> =>
  buildJournalRagContextTool(entries, latestUserMessage).then((journalContext) => [
    {
      role: 'system',
      content: AGENT_SYSTEM_PROMPT,
    },
    {
      role: 'system',
      content: journalContext.toolMessage,
    },
    ...messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ]);


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
}: SendAgentMessageOptions): Promise<AgentChatMessage> => {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === 'user');

  if (!latestUserMessage) {
    return createAgentMessage(
      'assistant',
      '你可以先告诉我今天想整理哪一段心情。',
    );
  }

  if (isAgentUsingPlaceholder()) {
    await wait(520);
    return createAgentMessage(
      'assistant',
      await createMockReply(latestUserMessage.content, entries),
    );
  }

  const apiMessages = await buildAgentApiMessages(
    messages,
    entries,
    latestUserMessage.content,
  );

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
  const content =
    readAssistantContent(data) ??
    '模型返回了结果，但当前客户端还没有解析这个响应格式。';

  return createAgentMessage('assistant', content);
};
