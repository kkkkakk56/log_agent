import type { AgentChatMessage } from '../services/agentClient';

const STORAGE_KEY = 'journal-agent.agent.conversations.v1';
const ACTIVE_CONVERSATION_KEY = 'journal-agent.agent.activeConversationId.v1';
const DEFAULT_TITLE = '新对话';
const MAX_TITLE_LENGTH = 18;

export interface AgentConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AgentChatMessage[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isAgentChatMessage = (value: unknown): value is AgentChatMessage =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  (value.role === 'user' || value.role === 'assistant') &&
  typeof value.content === 'string' &&
  typeof value.createdAt === 'string';

const isAgentConversation = (value: unknown): value is AgentConversation =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.title === 'string' &&
  typeof value.createdAt === 'string' &&
  typeof value.updatedAt === 'string' &&
  Array.isArray(value.messages) &&
  value.messages.every(isAgentChatMessage);

const createId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `conversation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const readConversations = (): AgentConversation[] => {
  try {
    const rawConversations = localStorage.getItem(STORAGE_KEY);

    if (!rawConversations) {
      return [];
    }

    const parsedConversations: unknown = JSON.parse(rawConversations);

    if (!Array.isArray(parsedConversations)) {
      return [];
    }

    return parsedConversations.filter(isAgentConversation);
  } catch {
    return [];
  }
};

const writeConversations = (conversations: AgentConversation[]): boolean => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    return true;
  } catch {
    return false;
  }
};

const sortByUpdatedAtDesc = (
  conversations: AgentConversation[],
): AgentConversation[] =>
  [...conversations].sort(
    (firstConversation, secondConversation) =>
      new Date(secondConversation.updatedAt).getTime() -
      new Date(firstConversation.updatedAt).getTime(),
  );

const createTitleFromContent = (content: string): string => {
  const normalizedContent = content.trim().replace(/\s+/g, ' ');

  if (!normalizedContent) {
    return DEFAULT_TITLE;
  }

  return normalizedContent.slice(0, MAX_TITLE_LENGTH);
};

const getNextTitle = (
  conversation: AgentConversation,
  message: AgentChatMessage,
): string => {
  if (conversation.title !== DEFAULT_TITLE || message.role !== 'user') {
    return conversation.title;
  }

  return createTitleFromContent(message.content);
};

export const getAgentConversations = (): AgentConversation[] =>
  sortByUpdatedAtDesc(readConversations());

export const getActiveAgentConversationId = (
  conversations = getAgentConversations(),
): string | null => {
  try {
    const activeConversationId = localStorage.getItem(ACTIVE_CONVERSATION_KEY);

    if (
      activeConversationId &&
      conversations.some((conversation) => conversation.id === activeConversationId)
    ) {
      return activeConversationId;
    }
  } catch {
    // Fall through to the most recently updated conversation.
  }

  return conversations[0]?.id ?? null;
};

export const setActiveAgentConversationId = (id: string): void => {
  try {
    localStorage.setItem(ACTIVE_CONVERSATION_KEY, id);
  } catch {
    // Ignore storage failures so switching conversations stays safe.
  }
};

export const createAgentConversation = (
  initialMessages: AgentChatMessage[] = [],
): AgentConversation => {
  const now = new Date().toISOString();
  const conversation: AgentConversation = {
    id: createId(),
    title: DEFAULT_TITLE,
    createdAt: now,
    updatedAt: now,
    messages: initialMessages,
  };
  const conversations = [conversation, ...readConversations()];

  writeConversations(conversations);
  setActiveAgentConversationId(conversation.id);

  return conversation;
};

export const appendAgentConversationMessage = (
  id: string,
  message: AgentChatMessage,
): AgentConversation | null => {
  const conversations = readConversations();
  const conversationIndex = conversations.findIndex(
    (conversation) => conversation.id === id,
  );

  if (conversationIndex === -1) {
    return null;
  }

  const now = new Date().toISOString();
  const currentConversation = conversations[conversationIndex];
  const updatedConversation: AgentConversation = {
    ...currentConversation,
    title: getNextTitle(currentConversation, message),
    updatedAt: now,
    messages: [...currentConversation.messages, message],
  };
  const nextConversations = [...conversations];
  nextConversations[conversationIndex] = updatedConversation;

  return writeConversations(nextConversations) ? updatedConversation : null;
};
