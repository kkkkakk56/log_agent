import type { JournalEntry } from '../types/journal';

export type AgentMessageRole = 'user' | 'assistant';

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

export const AGENT_API_CONFIG = {
  baseUrl: 'https://api.placeholder.local/v1/chat/completions',
  apiKey: 'sk-placeholder-do-not-use-in-client',
  model: 'journal-agent-placeholder-model',
};

const isPlaceholderConfig = (): boolean =>
  AGENT_API_CONFIG.baseUrl.includes('placeholder') ||
  AGENT_API_CONFIG.apiKey.includes('placeholder');

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

const createMockReply = (message: string, entries: JournalEntry[]): string => {
  const latestEntry = entries[0];
  const entryHint = latestEntry
    ? `我也看到你最近写过「${latestEntry.title}」。`
    : '等你写下第一条日志后，我可以帮你一起整理线索。';

  return [
    `我先用占位模型回应你：${message}`,
    entryHint,
    '真实大模型接入时，我们会把 API Key 放在后端代理里，而不是直接放进 App 客户端。',
  ].join('\n\n');
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

  if (isPlaceholderConfig()) {
    await wait(520);
    return createAgentMessage(
      'assistant',
      createMockReply(latestUserMessage.content, entries),
    );
  }

  // 真实生产版本不要把 API Key 放在客户端；后续应替换为你的后端代理地址。
  const response = await fetch(AGENT_API_CONFIG.baseUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${AGENT_API_CONFIG.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: AGENT_API_CONFIG.model,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
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
