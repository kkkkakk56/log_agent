import type { JournalEntry, JournalSyncStatus } from '../types/journal';

const STORAGE_KEY = 'journal-agent.entries.v1';
const MAX_TITLE_LENGTH = 18;
const SYNC_STATUSES: readonly JournalSyncStatus[] = [
  'local',
  'pending',
  'synced',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isSyncStatus = (value: unknown): value is JournalSyncStatus =>
  typeof value === 'string' &&
  SYNC_STATUSES.includes(value as JournalSyncStatus);

const isJournalEntry = (value: unknown): value is JournalEntry =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.title === 'string' &&
  typeof value.content === 'string' &&
  typeof value.createdAt === 'string' &&
  typeof value.updatedAt === 'string' &&
  (typeof value.deletedAt === 'string' || value.deletedAt === null) &&
  isStringArray(value.tags) &&
  isSyncStatus(value.syncStatus);

const readEntries = (): JournalEntry[] => {
  try {
    const rawEntries = localStorage.getItem(STORAGE_KEY);

    if (!rawEntries) {
      return [];
    }

    const parsedEntries: unknown = JSON.parse(rawEntries);

    if (!Array.isArray(parsedEntries)) {
      return [];
    }

    return parsedEntries.filter(isJournalEntry);
  } catch {
    return [];
  }
};

const writeEntries = (entries: JournalEntry[]): boolean => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
};

const createId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `entry-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const createTitle = (content: string, title = ''): string => {
  const normalizedTitle = title.trim();

  if (normalizedTitle) {
    return normalizedTitle.slice(0, MAX_TITLE_LENGTH);
  }

  const normalizedContent = content.trim();
  const firstLine = normalizedContent.split(/\r?\n/, 1)[0]?.trim() ?? '';
  const titleSource = firstLine || normalizedContent;

  return titleSource.slice(0, MAX_TITLE_LENGTH);
};

const sortByCreatedAtDesc = (entries: JournalEntry[]): JournalEntry[] =>
  entries.sort(
    (firstEntry, secondEntry) =>
      new Date(secondEntry.createdAt).getTime() -
      new Date(firstEntry.createdAt).getTime(),
  );

export const getEntries = (): JournalEntry[] =>
  sortByCreatedAtDesc(
    readEntries().filter((entry) => entry.deletedAt === null),
  );

export const createEntry = (
  content: string,
  title = '',
): JournalEntry | null => {
  const normalizedContent = content.trim();

  if (!normalizedContent) {
    return null;
  }

  const now = new Date().toISOString();
  const entry: JournalEntry = {
    id: createId(),
    title: createTitle(normalizedContent, title),
    content: normalizedContent,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    tags: [],
    syncStatus: 'local',
  };
  const entries = [...readEntries(), entry];

  return writeEntries(entries) ? entry : null;
};

export const updateEntry = (
  id: string,
  content: string,
): JournalEntry | null => {
  const normalizedContent = content.trim();

  if (!normalizedContent) {
    return null;
  }

  const entries = readEntries();
  const entryIndex = entries.findIndex(
    (entry) => entry.id === id && entry.deletedAt === null,
  );

  if (entryIndex === -1) {
    return null;
  }

  const updatedEntry: JournalEntry = {
    ...entries[entryIndex],
    content: normalizedContent,
    title: createTitle(normalizedContent),
    updatedAt: new Date().toISOString(),
  };
  const nextEntries = [...entries];
  nextEntries[entryIndex] = updatedEntry;

  return writeEntries(nextEntries) ? updatedEntry : null;
};

export const deleteEntry = (id: string): void => {
  const entries = readEntries();
  const entryIndex = entries.findIndex(
    (entry) => entry.id === id && entry.deletedAt === null,
  );

  if (entryIndex === -1) {
    return;
  }

  const now = new Date().toISOString();
  const deletedEntry: JournalEntry = {
    ...entries[entryIndex],
    deletedAt: now,
    updatedAt: now,
  };

  const nextEntries = [...entries];
  nextEntries[entryIndex] = deletedEntry;

  writeEntries(nextEntries);
};

export const clearEntries = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures so callers can safely request a reset.
  }
};
