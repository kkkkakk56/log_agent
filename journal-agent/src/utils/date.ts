import type { JournalEntry } from '../types/journal';

export const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const;

export type CalendarDay = {
  date: Date;
  dateKey: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
};

type JournalDateGroup = {
  label: string;
  entries: JournalEntry[];
};

const parseDate = (value: Date | string): Date | null => {
  const date = value instanceof Date ? new Date(value) : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
};

const formatMonthDayWeek = (date: Date): string =>
  `${date.getMonth() + 1}月${date.getDate()}日 周${WEEKDAY_LABELS[date.getDay()]}`;

const isSameLocalDay = (firstDate: Date, secondDate: Date): boolean =>
  firstDate.getFullYear() === secondDate.getFullYear() &&
  firstDate.getMonth() === secondDate.getMonth() &&
  firstDate.getDate() === secondDate.getDate();

const getYesterday = (date: Date): Date => {
  const yesterday = new Date(date);
  yesterday.setDate(date.getDate() - 1);

  return yesterday;
};

const getTimestamp = (iso: string): number => parseDate(iso)?.getTime() ?? 0;

const getEntryDateKey = (entry: JournalEntry): string =>
  entry.entryDate || getLocalDateKey(entry.createdAt);

const getDateKeyTimestamp = (dateKey: string): number =>
  parseDate(`${dateKey}T00:00:00`)?.getTime() ?? 0;

export const getLocalDateKey = (value: Date | string): string => {
  const date = parseDate(value);

  if (!date) {
    return '';
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

export const startOfMonth = (date: Date = new Date()): Date =>
  new Date(date.getFullYear(), date.getMonth(), 1);

export const addMonths = (date: Date, offset: number): Date =>
  new Date(date.getFullYear(), date.getMonth() + offset, 1);

export const formatMonthTitle = (date: Date): string =>
  `${date.getFullYear()}年${date.getMonth() + 1}月`;

export const formatTodayHeader = (date: Date = new Date()): string =>
  formatMonthDayWeek(date);

export const formatDateLabel = (value: Date | string): string => {
  const date = parseDate(value);

  return date ? formatMonthDayWeek(date) : '';
};

export const formatEntryTime = (iso: string): string => {
  const date = parseDate(iso);

  if (!date) {
    return '';
  }

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${hours}:${minutes}`;
};

export const getDateGroupLabel = (iso: string): string => {
  const date = parseDate(iso);

  if (!date) {
    return '';
  }

  const today = new Date();

  if (isSameLocalDay(date, today)) {
    return '今天';
  }

  if (isSameLocalDay(date, getYesterday(today))) {
    return '昨天';
  }

  return formatMonthDayWeek(date);
};

export const buildCalendarDays = (monthDate: Date): CalendarDay[] => {
  const monthStart = startOfMonth(monthDate);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - monthStart.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);

    return {
      date,
      dateKey: getLocalDateKey(date),
      dayNumber: date.getDate(),
      isCurrentMonth: date.getMonth() === monthStart.getMonth(),
      isToday: isSameLocalDay(date, new Date()),
    };
  });
};

export const groupEntriesByDate = (
  entries: JournalEntry[],
): Array<{ label: string; entries: JournalEntry[] }> => {
  const groups = new Map<string, JournalDateGroup>();
  const sortedEntries = [...entries].sort(
    (firstEntry, secondEntry) =>
      getDateKeyTimestamp(getEntryDateKey(secondEntry)) -
        getDateKeyTimestamp(getEntryDateKey(firstEntry)) ||
      getTimestamp(secondEntry.createdAt) - getTimestamp(firstEntry.createdAt),
  );

  for (const entry of sortedEntries) {
    const key = getEntryDateKey(entry) || 'invalid-date';
    const label = getDateGroupLabel(`${key}T00:00:00`);
    const group = groups.get(key);

    if (group) {
      group.entries.push(entry);
    } else {
      groups.set(key, { label, entries: [entry] });
    }
  }

  return Array.from(groups.values());
};
