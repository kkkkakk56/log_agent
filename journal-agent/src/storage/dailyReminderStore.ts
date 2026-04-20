import type { DailyJournalReminderSettings } from '../types/dailyReminder';

const STORAGE_KEY = 'journal-agent.daily-journal-reminder.v1';
const DEFAULT_HOUR = 23;
const DEFAULT_MINUTE = 0;

const DEFAULT_SETTINGS: DailyJournalReminderSettings = {
  enabled: true,
  hour: DEFAULT_HOUR,
  minute: DEFAULT_MINUTE,
  updatedAt: null,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const normalizeSettings = (value: unknown): DailyJournalReminderSettings => {
  if (!isRecord(value)) {
    return DEFAULT_SETTINGS;
  }

  const hour =
    typeof value.hour === 'number' &&
    Number.isInteger(value.hour) &&
    value.hour >= 0 &&
    value.hour <= 23
      ? value.hour
      : DEFAULT_HOUR;
  const minute =
    typeof value.minute === 'number' &&
    Number.isInteger(value.minute) &&
    value.minute >= 0 &&
    value.minute <= 59
      ? value.minute
      : DEFAULT_MINUTE;

  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_SETTINGS.enabled,
    hour,
    minute,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
  };
};

const writeSettings = (settings: DailyJournalReminderSettings): boolean => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
};

export const getDailyJournalReminderSettings = (): DailyJournalReminderSettings => {
  try {
    const rawValue = localStorage.getItem(STORAGE_KEY);

    if (!rawValue) {
      return DEFAULT_SETTINGS;
    }

    return normalizeSettings(JSON.parse(rawValue));
  } catch {
    return DEFAULT_SETTINGS;
  }
};

export const setDailyJournalReminderEnabled = (
  enabled: boolean,
): DailyJournalReminderSettings | null => {
  const currentSettings = getDailyJournalReminderSettings();
  const nextSettings: DailyJournalReminderSettings = {
    ...currentSettings,
    enabled,
    updatedAt: new Date().toISOString(),
  };

  return writeSettings(nextSettings) ? nextSettings : null;
};
