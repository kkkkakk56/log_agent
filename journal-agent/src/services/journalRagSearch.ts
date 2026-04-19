import type { JournalEntry } from '../types/journal';

const INDEX_STORAGE_KEY = 'journal-agent.rag.embeddingIndex.v1';
const MAX_CHUNK_LENGTH = 860;
const CHUNK_OVERLAP = 120;
const MAX_RESULTS = 6;
const MAX_EXCERPT_LENGTH = 520;
const EMBEDDING_BATCH_SIZE = 12;

interface EmbeddingRequestConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
}

export interface JournalEmbeddingIndexItem {
  id: string;
  entryId: string;
  chunkIndex: number;
  title: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  mood: string | null;
  contentHash: string;
  embeddingModel: string;
  embedding: number[];
  indexedAt: string;
}

export interface JournalRagSearchResult {
  entryId: string;
  title: string;
  createdAt: string;
  excerpt: string;
  score: number;
  matchReason: string;
}

export interface JournalRagContextToolResult {
  totalEntries: number;
  indexedChunks: number;
  includedResults: number;
  embeddingConfigured: boolean;
  embeddingModel: string;
  statusLabel: string;
  toolMessage: string;
}

const normalizeEmbeddingEndpoint = (apiUrl: string): string => {
  const normalizedUrl = apiUrl.trim().replace(/\/+$/, '');

  if (!normalizedUrl) {
    return '';
  }

  if (normalizedUrl.endsWith('/embeddings')) {
    return normalizedUrl;
  }

  if (normalizedUrl.endsWith('/chat/completions')) {
    return normalizedUrl.replace(/\/chat\/completions$/, '/embeddings');
  }

  if (normalizedUrl.endsWith('/responses')) {
    return normalizedUrl.replace(/\/responses$/, '/embeddings');
  }

  try {
    const parsedUrl = new URL(normalizedUrl);

    if (parsedUrl.pathname === '/') {
      return `${parsedUrl.origin}/v1/embeddings`;
    }
  } catch {
    return normalizedUrl;
  }

  if (normalizedUrl.endsWith('/v1')) {
    return `${normalizedUrl}/embeddings`;
  }

  return normalizedUrl;
};

const getEmbeddingConfig = (): EmbeddingRequestConfig => ({
  apiUrl: normalizeEmbeddingEndpoint(import.meta.env.api_url ?? ''),
  apiKey: import.meta.env.api_key ?? '',
  model: import.meta.env.embedding_model ?? import.meta.env.embeddingmodel ?? '',
});

export const getEmbeddingModelLabel = (): string =>
  getEmbeddingConfig().model || '未配置 embedding_model';

export const isEmbeddingConfigured = (): boolean => {
  const config = getEmbeddingConfig();

  return Boolean(config.apiUrl && config.apiKey && config.model);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isNumberArray = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'number');

const isIndexItem = (value: unknown): value is JournalEmbeddingIndexItem =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.entryId === 'string' &&
  typeof value.chunkIndex === 'number' &&
  typeof value.title === 'string' &&
  typeof value.text === 'string' &&
  typeof value.createdAt === 'string' &&
  typeof value.updatedAt === 'string' &&
  Array.isArray(value.tags) &&
  value.tags.every((tag) => typeof tag === 'string') &&
  (typeof value.mood === 'string' || value.mood === null) &&
  typeof value.contentHash === 'string' &&
  typeof value.embeddingModel === 'string' &&
  isNumberArray(value.embedding) &&
  typeof value.indexedAt === 'string';

const readIndex = (): JournalEmbeddingIndexItem[] => {
  try {
    const rawIndex = localStorage.getItem(INDEX_STORAGE_KEY);

    if (!rawIndex) {
      return [];
    }

    const parsedIndex: unknown = JSON.parse(rawIndex);

    if (!Array.isArray(parsedIndex)) {
      return [];
    }

    return parsedIndex.filter(isIndexItem);
  } catch {
    return [];
  }
};

const writeIndex = (items: JournalEmbeddingIndexItem[]): boolean => {
  try {
    localStorage.setItem(INDEX_STORAGE_KEY, JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
};

const hashText = (value: string): string => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16);
};

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

const getEntryHash = (entry: JournalEntry): string =>
  hashText(
    [
      entry.id,
      entry.title,
      entry.content,
      entry.updatedAt,
      entry.tags.join(','),
      entry.mood ?? '',
    ].join('\n'),
  );

const createChunkSource = (entry: JournalEntry): string =>
  [
    `标题: ${entry.title || '无标题'}`,
    `日期: ${formatDateTime(entry.createdAt)}`,
    `标签: ${entry.tags.length > 0 ? entry.tags.join(', ') : '无'}`,
    `心情: ${entry.mood ?? '未设置'}`,
    '',
    entry.content,
  ].join('\n');

const splitTextIntoChunks = (text: string): string[] => {
  const normalizedText = text.trim();

  if (normalizedText.length <= MAX_CHUNK_LENGTH) {
    return [normalizedText];
  }

  const chunks: string[] = [];
  let startIndex = 0;

  while (startIndex < normalizedText.length) {
    const endIndex = Math.min(startIndex + MAX_CHUNK_LENGTH, normalizedText.length);
    chunks.push(normalizedText.slice(startIndex, endIndex));

    if (endIndex === normalizedText.length) {
      break;
    }

    startIndex = Math.max(endIndex - CHUNK_OVERLAP, startIndex + 1);
  }

  return chunks;
};

const buildEntryChunks = (entry: JournalEntry): string[] =>
  splitTextIntoChunks(createChunkSource(entry));

const createIndexItemId = (
  entry: JournalEntry,
  chunkIndex: number,
  contentHash: string,
  embeddingModel: string,
): string => `${entry.id}:${chunkIndex}:${contentHash}:${embeddingModel}`;

const readEmbeddings = (data: unknown): number[][] => {
  if (!isRecord(data) || !Array.isArray(data.data)) {
    return [];
  }

  return data.data
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      return isNumberArray(item.embedding) ? item.embedding : null;
    })
    .filter((embedding): embedding is number[] => embedding !== null);
};

const fetchEmbeddings = async (
  input: string[],
  config: EmbeddingRequestConfig,
): Promise<number[][]> => {
  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      input,
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding request failed with ${response.status}`);
  }

  const data: unknown = await response.json();
  const embeddings = readEmbeddings(data);

  if (embeddings.length !== input.length) {
    throw new Error('Embedding response count did not match request count');
  }

  return embeddings;
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

const cosineSimilarity = (firstVector: number[], secondVector: number[]): number => {
  const length = Math.min(firstVector.length, secondVector.length);

  if (length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let firstMagnitude = 0;
  let secondMagnitude = 0;

  for (let index = 0; index < length; index += 1) {
    const firstValue = firstVector[index];
    const secondValue = secondVector[index];
    dotProduct += firstValue * secondValue;
    firstMagnitude += firstValue * firstValue;
    secondMagnitude += secondValue * secondValue;
  }

  if (firstMagnitude === 0 || secondMagnitude === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(firstMagnitude) * Math.sqrt(secondMagnitude));
};

const extractKeywordTokens = (query: string): string[] => {
  const matches = query.toLocaleLowerCase().match(/[\p{Script=Han}A-Za-z0-9]{2,}/gu);

  return Array.from(new Set(matches ?? [])).slice(0, 8);
};

const calculateKeywordBonus = (text: string, query: string): number => {
  const tokens = extractKeywordTokens(query);

  if (tokens.length === 0) {
    return 0;
  }

  const normalizedText = text.toLocaleLowerCase();
  const matchedTokenCount = tokens.filter((token) => normalizedText.includes(token)).length;

  return Math.min(0.12, matchedTokenCount * 0.03);
};

const getValidIndexItems = (
  entries: JournalEntry[],
  indexItems: JournalEmbeddingIndexItem[],
  embeddingModel: string,
): JournalEmbeddingIndexItem[] => {
  const entryHashes = new Map(entries.map((entry) => [entry.id, getEntryHash(entry)]));

  return indexItems.filter((item) => {
    const entryHash = entryHashes.get(item.entryId);

    return item.embeddingModel === embeddingModel && entryHash === item.contentHash;
  });
};

const syncEmbeddingIndex = async (
  entries: JournalEntry[],
): Promise<JournalEmbeddingIndexItem[]> => {
  const config = getEmbeddingConfig();

  if (!config.apiUrl || !config.apiKey || !config.model) {
    return [];
  }

  const currentIndex = getValidIndexItems(entries, readIndex(), config.model);
  const currentItemIds = new Set(currentIndex.map((item) => item.id));
  const pendingItems: Array<{
    entry: JournalEntry;
    chunkIndex: number;
    contentHash: string;
    text: string;
  }> = [];

  for (const entry of entries) {
    const contentHash = getEntryHash(entry);
    const chunks = buildEntryChunks(entry);

    chunks.forEach((text, chunkIndex) => {
      const id = createIndexItemId(entry, chunkIndex, contentHash, config.model);

      if (!currentItemIds.has(id)) {
        pendingItems.push({
          entry,
          chunkIndex,
          contentHash,
          text,
        });
      }
    });
  }

  if (pendingItems.length === 0) {
    writeIndex(currentIndex);
    return currentIndex;
  }

  const indexedAt = new Date().toISOString();
  const newItems: JournalEmbeddingIndexItem[] = [];

  for (const batch of chunkArray(pendingItems, EMBEDDING_BATCH_SIZE)) {
    const embeddings = await fetchEmbeddings(
      batch.map((item) => item.text),
      config,
    );

    batch.forEach((item, index) => {
      newItems.push({
        id: createIndexItemId(
          item.entry,
          item.chunkIndex,
          item.contentHash,
          config.model,
        ),
        entryId: item.entry.id,
        chunkIndex: item.chunkIndex,
        title: item.entry.title || '无标题',
        text: item.text,
        createdAt: item.entry.createdAt,
        updatedAt: item.entry.updatedAt,
        tags: item.entry.tags,
        mood: item.entry.mood ?? null,
        contentHash: item.contentHash,
        embeddingModel: config.model,
        embedding: embeddings[index],
        indexedAt,
      });
    });
  }

  const nextIndex = [...currentIndex, ...newItems];
  writeIndex(nextIndex);

  return nextIndex;
};

const fallbackKeywordSearch = (
  entries: JournalEntry[],
  query: string,
): JournalRagSearchResult[] => {
  const tokens = extractKeywordTokens(query);
  const sortedEntries = [...entries].sort(
    (firstEntry, secondEntry) =>
      new Date(secondEntry.createdAt).getTime() -
      new Date(firstEntry.createdAt).getTime(),
  );
  const scoredEntries = sortedEntries.map((entry) => {
    const text = createChunkSource(entry);
    const score = calculateKeywordBonus(text, query);

    return {
      entry,
      text,
      score,
    };
  });

  const filteredEntries = scoredEntries.filter((item) =>
    tokens.length > 0 ? item.score > 0 : true,
  );
  const searchEntries = filteredEntries.length > 0 ? filteredEntries : scoredEntries;

  return searchEntries.slice(0, MAX_RESULTS).map((item) => ({
    entryId: item.entry.id,
    title: item.entry.title || '无标题',
    createdAt: item.entry.createdAt,
    excerpt: truncateText(item.text, MAX_EXCERPT_LENGTH),
    score: item.score,
    matchReason: item.score > 0 ? '关键词兜底命中' : '无关键词命中，返回最近日志兜底',
  }));
};

const searchEmbeddingIndex = async (
  entries: JournalEntry[],
  query: string,
): Promise<JournalRagSearchResult[]> => {
  const config = getEmbeddingConfig();
  const indexItems = await syncEmbeddingIndex(entries);

  if (indexItems.length === 0) {
    return fallbackKeywordSearch(entries, query);
  }

  const [queryEmbedding] = await fetchEmbeddings([query], config);
  const scoredItems = indexItems
    .map((item) => {
      const vectorScore = cosineSimilarity(queryEmbedding, item.embedding);
      const keywordBonus = calculateKeywordBonus(item.text, query);

      return {
        item,
        score: vectorScore + keywordBonus,
        vectorScore,
        keywordBonus,
      };
    })
    .sort((firstItem, secondItem) => secondItem.score - firstItem.score);
  const seenEntryIds = new Set<string>();
  const results: JournalRagSearchResult[] = [];

  for (const scoredItem of scoredItems) {
    if (results.length >= MAX_RESULTS) {
      break;
    }

    if (seenEntryIds.has(scoredItem.item.entryId)) {
      continue;
    }

    seenEntryIds.add(scoredItem.item.entryId);
    results.push({
      entryId: scoredItem.item.entryId,
      title: scoredItem.item.title,
      createdAt: scoredItem.item.createdAt,
      excerpt: truncateText(scoredItem.item.text, MAX_EXCERPT_LENGTH),
      score: scoredItem.score,
      matchReason:
        scoredItem.keywordBonus > 0
          ? 'embedding 语义相似 + 关键词加权'
          : 'embedding 语义相似',
    });
  }

  return results;
};

const serializeResult = (result: JournalRagSearchResult, index: number): string =>
  [
    `### 检索结果 ${index + 1}`,
    `entryId: ${result.entryId}`,
    `title: ${result.title}`,
    `createdAt: ${formatDateTime(result.createdAt)}`,
    `score: ${result.score.toFixed(4)}`,
    `matchReason: ${result.matchReason}`,
    `excerpt: ${result.excerpt}`,
  ].join('\n');

export const getJournalRagIndexStatus = (
  entries: JournalEntry[],
): JournalRagContextToolResult => {
  const config = getEmbeddingConfig();
  const indexItems = config.model
    ? getValidIndexItems(entries, readIndex(), config.model)
    : [];
  const embeddingConfigured = Boolean(config.apiUrl && config.apiKey && config.model);
  const statusLabel =
    entries.length === 0
      ? 'RAG：暂无日志'
      : embeddingConfigured
        ? `RAG：${indexItems.length} 个索引片段 / ${entries.length} 篇日志`
        : 'RAG：embedding 未配置，使用关键词兜底';

  return {
    totalEntries: entries.length,
    indexedChunks: indexItems.length,
    includedResults: 0,
    embeddingConfigured,
    embeddingModel: config.model || '未配置',
    statusLabel,
    toolMessage: '',
  };
};

export const buildJournalRagContextTool = async (
  entries: JournalEntry[],
  query: string,
): Promise<JournalRagContextToolResult> => {
  const config = getEmbeddingConfig();
  const embeddingConfigured = Boolean(config.apiUrl && config.apiKey && config.model);
  let results: JournalRagSearchResult[] = [];
  let statusLabel = '';

  if (entries.length === 0) {
    statusLabel = 'RAG：暂无日志';
  } else if (!embeddingConfigured) {
    results = fallbackKeywordSearch(entries, query);
    statusLabel = `RAG：embedding 未配置，关键词兜底返回 ${results.length} 条`;
  } else {
    try {
      results = await searchEmbeddingIndex(entries, query);
      statusLabel = `RAG：embedding 检索返回 ${results.length} 条`;
    } catch {
      results = fallbackKeywordSearch(entries, query);
      statusLabel = `RAG：embedding 检索失败，关键词兜底返回 ${results.length} 条`;
    }
  }

  const indexStatus = getJournalRagIndexStatus(entries);
  const toolMessage = [
    '[tool_result: journal.search]',
    '权限: 用户已允许 Agent 在本次请求中检索本地日志。',
    '检索策略: embedding RAG 优先；失败或未配置时使用关键词兜底。',
    `日志总数: ${entries.length}`,
    `索引片段数: ${indexStatus.indexedChunks}`,
    `本次返回结果数: ${results.length}`,
    `embeddingModel: ${config.model || '未配置'}`,
    '',
    '使用规则:',
    '- 只能基于下方检索结果回答与日志有关的问题。',
    '- 如果检索结果没有足够依据，请明确说明当前日志里没有足够证据。',
    '- 不要编造不存在的日志、日期、心情或事件。',
    '- 回答时可以自然引用相关日期或标题，但不要暴露内部 score，除非用户询问。',
    '',
    results.length > 0
      ? results.map(serializeResult).join('\n\n')
      : '没有检索到可提供给 Agent 的日志片段。',
    '[/tool_result]',
  ].join('\n');

  return {
    totalEntries: entries.length,
    indexedChunks: indexStatus.indexedChunks,
    includedResults: results.length,
    embeddingConfigured,
    embeddingModel: config.model || '未配置',
    statusLabel,
    toolMessage,
  };
};
