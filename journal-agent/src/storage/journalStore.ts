import type { JournalEntry, JournalMood, JournalSyncStatus } from '../types/journal';

const STORAGE_KEY = 'journal-agent.entries.v1';
const MAX_TITLE_LENGTH = 18;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const JOURNAL_MOODS: readonly JournalMood[] = ['great', 'calm', 'tired', 'low'];
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

const isJournalMood = (value: unknown): value is JournalMood =>
  typeof value === 'string' && JOURNAL_MOODS.includes(value as JournalMood);

const getLocalDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

const isDateKey = (value: unknown): value is string => {
  if (typeof value !== 'string' || !DATE_KEY_PATTERN.test(value)) {
    return false;
  }

  return !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
};

const createEntryDateFromIso = (iso: string): string =>
  getLocalDateKey(new Date(Number.isNaN(new Date(iso).getTime()) ? Date.now() : iso));

const normalizeJournalEntry = (value: unknown): JournalEntry | null => {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.content !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    (typeof value.deletedAt !== 'string' && value.deletedAt !== null) ||
    !isStringArray(value.tags) ||
    !isSyncStatus(value.syncStatus)
  ) {
    return null;
  }

  return {
    id: value.id,
    title: value.title,
    content: value.content,
    entryDate: isDateKey(value.entryDate)
      ? value.entryDate
      : createEntryDateFromIso(value.createdAt),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    deletedAt: value.deletedAt,
    tags: value.tags,
    syncStatus: value.syncStatus,
    mood: isJournalMood(value.mood) ? value.mood : null,
  };
};

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

    return parsedEntries
      .map(normalizeJournalEntry)
      .filter((entry): entry is JournalEntry => entry !== null);
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

const sortByEntryDateDesc = (entries: JournalEntry[]): JournalEntry[] =>
  entries.sort(
    (firstEntry, secondEntry) =>
      secondEntry.entryDate.localeCompare(firstEntry.entryDate) ||
      new Date(secondEntry.createdAt).getTime() -
        new Date(firstEntry.createdAt).getTime(),
  );

export const getEntries = (): JournalEntry[] =>
  sortByEntryDateDesc(
    readEntries().filter((entry) => entry.deletedAt === null),
  );

export const createEntry = (
  content: string,
  title = '',
  entryDate = getLocalDateKey(new Date()),
): JournalEntry | null => {
  const normalizedContent = content.trim();

  if (!normalizedContent || !isDateKey(entryDate)) {
    return null;
  }

  const now = new Date().toISOString();
  const entry: JournalEntry = {
    id: createId(),
    title: createTitle(normalizedContent, title),
    content: normalizedContent,
    entryDate,
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
  fieldsOrContent: string | { title?: string; content: string; entryDate?: string },
): JournalEntry | null => {
  const normalizedContent =
    typeof fieldsOrContent === 'string'
      ? fieldsOrContent.trim()
      : fieldsOrContent.content.trim();

  if (
    !normalizedContent ||
    (typeof fieldsOrContent !== 'string' &&
      fieldsOrContent.entryDate !== undefined &&
      !isDateKey(fieldsOrContent.entryDate))
  ) {
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
    entryDate:
      typeof fieldsOrContent === 'string' || fieldsOrContent.entryDate === undefined
        ? entries[entryIndex].entryDate
        : fieldsOrContent.entryDate,
    title:
      typeof fieldsOrContent === 'string'
        ? createTitle(normalizedContent)
        : fieldsOrContent.title === undefined
          ? entries[entryIndex].title
          : createTitle(normalizedContent, fieldsOrContent.title),
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
