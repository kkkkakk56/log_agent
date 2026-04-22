import type { RecordReminder, ReminderTargetType } from '../types/reminder';

const STORAGE_KEY = 'journal-agent.record-reminders.v1';
const MAX_TITLE_LENGTH = 80;
const MAX_QUOTE_LENGTH = 180;

type ReminderCreateFields = Pick<
  RecordReminder,
  | 'targetType'
  | 'targetId'
  | 'parentId'
  | 'targetTitle'
  | 'reminderTitle'
  | 'quote'
  | 'anchorStart'
  | 'scheduledAt'
>;

type ReminderUpdateFields = Pick<
  RecordReminder,
  'reminderTitle' | 'quote' | 'anchorStart' | 'scheduledAt'
>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isReminderTargetType = (value: unknown): value is ReminderTargetType =>
  value === 'journal-entry' ||
  value === 'knowledge-note' ||
  value === 'lab-record';

const isRecordReminder = (value: unknown): value is RecordReminder =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.notificationId === 'number' &&
  Number.isInteger(value.notificationId) &&
  isReminderTargetType(value.targetType) &&
  typeof value.targetId === 'string' &&
  (typeof value.parentId === 'string' || value.parentId === null) &&
  typeof value.targetTitle === 'string' &&
  typeof value.reminderTitle === 'string' &&
  typeof value.quote === 'string' &&
  (typeof value.anchorStart === 'number' || value.anchorStart === null) &&
  typeof value.scheduledAt === 'string' &&
  typeof value.createdAt === 'string' &&
  typeof value.updatedAt === 'string' &&
  (typeof value.canceledAt === 'string' || value.canceledAt === null);

const readReminders = (): RecordReminder[] => {
  try {
    const rawItems = localStorage.getItem(STORAGE_KEY);

    if (!rawItems) {
      return [];
    }

    const parsedItems: unknown = JSON.parse(rawItems);

    if (!Array.isArray(parsedItems)) {
      return [];
    }

    return parsedItems.filter(isRecordReminder);
  } catch {
    return [];
  }
};

const writeReminders = (reminders: RecordReminder[]): boolean => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reminders));
    return true;
  } catch {
    return false;
  }
};

const createId = (prefix: string): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const createNotificationId = (existingIds: Set<number>): number => {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const nowPart = Date.now() % 1_000_000_000;
    const randomPart = Math.floor(Math.random() * 100_000);
    const candidateId = nowPart + randomPart;

    if (!existingIds.has(candidateId)) {
      return candidateId;
    }
  }

  let fallbackId = Date.now() % 1_000_000_000;

  while (existingIds.has(fallbackId)) {
    fallbackId += 1;
  }

  return fallbackId;
};

const normalizeTitle = (value: string, fallback: string): string => {
  const normalizedValue = value.trim() || fallback.trim() || '心记提醒';

  return normalizedValue.slice(0, MAX_TITLE_LENGTH);
};

const normalizeQuote = (value: string): string =>
  value.trim().slice(0, MAX_QUOTE_LENGTH);

const sortByScheduledAtAsc = (reminders: RecordReminder[]): RecordReminder[] =>
  reminders.sort(
    (firstReminder, secondReminder) =>
      new Date(firstReminder.scheduledAt).getTime() -
      new Date(secondReminder.scheduledAt).getTime(),
  );

export const getReminders = (): RecordReminder[] =>
  sortByScheduledAtAsc(readReminders());

export const getActiveReminders = (): RecordReminder[] =>
  sortByScheduledAtAsc(
    readReminders().filter((reminder) => reminder.canceledAt === null),
  );

export const getUpcomingActiveReminders = (): RecordReminder[] => {
  const now = Date.now();

  return sortByScheduledAtAsc(
    readReminders().filter((reminder) => {
      if (reminder.canceledAt !== null) {
        return false;
      }

      const scheduledAt = new Date(reminder.scheduledAt).getTime();
      return !Number.isNaN(scheduledAt) && scheduledAt > now;
    }),
  );
};

export const getReminderById = (id: string): RecordReminder | null =>
  readReminders().find((reminder) => reminder.id === id) ?? null;

export const createReminder = (
  fields: ReminderCreateFields,
): RecordReminder | null => {
  const scheduledAt = new Date(fields.scheduledAt);

  if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
    return null;
  }

  const reminders = readReminders();
  const now = new Date().toISOString();
  const reminder: RecordReminder = {
    id: createId('record-reminder'),
    notificationId: createNotificationId(
      new Set(reminders.map((reminderItem) => reminderItem.notificationId)),
    ),
    targetType: fields.targetType,
    targetId: fields.targetId,
    parentId: fields.parentId,
    targetTitle: normalizeTitle(fields.targetTitle, '未命名记录'),
    reminderTitle: normalizeTitle(fields.reminderTitle, fields.targetTitle),
    quote: normalizeQuote(fields.quote),
    anchorStart:
      typeof fields.anchorStart === 'number' && fields.anchorStart >= 0
        ? fields.anchorStart
        : null,
    scheduledAt: scheduledAt.toISOString(),
    createdAt: now,
    updatedAt: now,
    canceledAt: null,
  };

  return writeReminders([...reminders, reminder]) ? reminder : null;
};

export const updateReminder = (
  id: string,
  fields: ReminderUpdateFields,
): RecordReminder | null => {
  const scheduledAt = new Date(fields.scheduledAt);

  if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
    return null;
  }

  const reminders = readReminders();
  const reminderIndex = reminders.findIndex(
    (reminder) => reminder.id === id && reminder.canceledAt === null,
  );

  if (reminderIndex === -1) {
    return null;
  }

  const updatedReminder: RecordReminder = {
    ...reminders[reminderIndex],
    reminderTitle: normalizeTitle(
      fields.reminderTitle,
      reminders[reminderIndex].targetTitle,
    ),
    quote: normalizeQuote(fields.quote),
    anchorStart:
      typeof fields.anchorStart === 'number' && fields.anchorStart >= 0
        ? fields.anchorStart
        : null,
    scheduledAt: scheduledAt.toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const nextReminders = [...reminders];
  nextReminders[reminderIndex] = updatedReminder;

  return writeReminders(nextReminders) ? updatedReminder : null;
};

export const cancelReminder = (id: string): RecordReminder | null => {
  const reminders = readReminders();
  const reminderIndex = reminders.findIndex(
    (reminder) => reminder.id === id && reminder.canceledAt === null,
  );

  if (reminderIndex === -1) {
    return null;
  }

  const now = new Date().toISOString();
  const canceledReminder: RecordReminder = {
    ...reminders[reminderIndex],
    canceledAt: now,
    updatedAt: now,
  };
  const nextReminders = [...reminders];
  nextReminders[reminderIndex] = canceledReminder;

  return writeReminders(nextReminders) ? canceledReminder : null;
};

export const cancelRemindersForTarget = (
  targetType: ReminderTargetType,
  targetId: string,
): RecordReminder[] => {
  const reminders = readReminders();
  const now = new Date().toISOString();
  const canceledReminders: RecordReminder[] = [];
  const nextReminders = reminders.map((reminder) => {
    if (
      reminder.targetType !== targetType ||
      reminder.targetId !== targetId ||
      reminder.canceledAt !== null
    ) {
      return reminder;
    }

    const canceledReminder: RecordReminder = {
      ...reminder,
      canceledAt: now,
      updatedAt: now,
    };
    canceledReminders.push(canceledReminder);

    return canceledReminder;
  });

  writeReminders(nextReminders);

  return canceledReminders;
};
