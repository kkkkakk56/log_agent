import type { JournalEntry } from '../types/journal';

const MAX_CONTEXT_ENTRIES = 18;
const MAX_RELEVANT_ENTRIES = 6;
const MAX_CONTENT_LENGTH = 620;

export interface JournalContextToolResult {
  totalEntries: number;
  includedEntries: number;
  maxEntries: number;
  dateRangeLabel: string;
  statusLabel: string;
  toolMessage: string;
}

const formatDateTime = (value: string): string => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

const truncateText = (value: string, maxLength: number): string => {
  const normalizedValue = value.trim().replace(/\s+/g, ' ');

  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, maxLength)}...`;
};

const normalizeText = (value: string): string => value.toLocaleLowerCase();

const extractSearchTokens = (query: string): string[] => {
  const matches = normalizeText(query).match(/[\p{Script=Han}A-Za-z0-9]{2,}/gu);

  return Array.from(new Set(matches ?? [])).slice(0, 8);
};

const getEntrySearchText = (entry: JournalEntry): string =>
  normalizeText([entry.title, entry.content, ...entry.tags, entry.mood ?? ''].join(' '));

const findRelevantEntries = (
  entries: JournalEntry[],
  latestUserMessage: string,
): JournalEntry[] => {
  const tokens = extractSearchTokens(latestUserMessage);

  if (tokens.length === 0) {
    return [];
  }

  return entries.filter((entry) => {
    const searchableText = getEntrySearchText(entry);

    return tokens.some((token) => searchableText.includes(token));
  });
};

const uniqueEntries = (entries: JournalEntry[]): JournalEntry[] => {
  const seenIds = new Set<string>();
  const uniqueList: JournalEntry[] = [];

  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      continue;
    }

    seenIds.add(entry.id);
    uniqueList.push(entry);
  }

  return uniqueList;
};

const sortByCreatedAtDesc = (entries: JournalEntry[]): JournalEntry[] =>
  [...entries].sort(
    (firstEntry, secondEntry) =>
      new Date(secondEntry.createdAt).getTime() -
      new Date(firstEntry.createdAt).getTime(),
  );

const buildDateRangeLabel = (entries: JournalEntry[]): string => {
  if (entries.length === 0) {
    return '无日志';
  }

  const sortedEntries = sortByCreatedAtDesc(entries);
  const newestEntry = sortedEntries[0];
  const oldestEntry = sortedEntries[sortedEntries.length - 1];

  return `${formatDateTime(oldestEntry.createdAt)} - ${formatDateTime(newestEntry.createdAt)}`;
};

const serializeEntry = (entry: JournalEntry, index: number): string => {
  const tags = entry.tags.length > 0 ? entry.tags.join(', ') : '无';
  const mood = entry.mood ?? '未设置';

  return [
    `### 日志 ${index + 1}`,
    `id: ${entry.id}`,
    `title: ${entry.title || '无标题'}`,
    `createdAt: ${formatDateTime(entry.createdAt)}`,
    `updatedAt: ${formatDateTime(entry.updatedAt)}`,
    `tags: ${tags}`,
    `mood: ${mood}`,
    `content: ${truncateText(entry.content, MAX_CONTENT_LENGTH)}`,
  ].join('\n');
};

export const buildJournalContextTool = (
  entries: JournalEntry[],
  latestUserMessage = '',
): JournalContextToolResult => {
  const sortedEntries = sortByCreatedAtDesc(entries);
  const relevantEntries = findRelevantEntries(sortedEntries, latestUserMessage).slice(
    0,
    MAX_RELEVANT_ENTRIES,
  );
  const recentEntries = sortedEntries.slice(0, MAX_CONTEXT_ENTRIES);
  const includedEntries = uniqueEntries([...relevantEntries, ...recentEntries]).slice(
    0,
    MAX_CONTEXT_ENTRIES,
  );
  const dateRangeLabel = buildDateRangeLabel(includedEntries);
  const statusLabel =
    entries.length === 0
      ? '未读取到日志'
      : `可读取 ${entries.length} 条日志，本次发送 ${includedEntries.length} 条`;

  const toolMessage = [
    '[tool_result: journal.read_context]',
    '权限: 用户已允许 Agent 在本次请求中读取本地日志上下文。',
    `日志总数: ${entries.length}`,
    `本次提供日志数: ${includedEntries.length}`,
    `本次最多提供: ${MAX_CONTEXT_ENTRIES}`,
    `覆盖时间范围: ${dateRangeLabel}`,
    '',
    '使用规则:',
    '- 只能基于下方日志内容回答与日志有关的问题。',
    '- 如果下方日志没有提供足够依据，请明确说明无法从当前日志判断。',
    '- 不要编造不存在的日志、日期、心情或事件。',
    '- 可以帮助用户总结、检索、提问、生成反思提示，但要尊重日志原意。',
    '',
    includedEntries.length > 0
      ? includedEntries.map(serializeEntry).join('\n\n')
      : '当前没有可提供给 Agent 的日志。',
    '[/tool_result]',
  ].join('\n');

  return {
    totalEntries: entries.length,
    includedEntries: includedEntries.length,
    maxEntries: MAX_CONTEXT_ENTRIES,
    dateRangeLabel,
    statusLabel,
    toolMessage,
  };
};
