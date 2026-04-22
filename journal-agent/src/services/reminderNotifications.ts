import { Capacitor } from '@capacitor/core';
import {
  LocalNotifications,
  type ActionPerformed,
} from '@capacitor/local-notifications';
import type { RecordReminder } from '../types/reminder';

export interface ReminderNotificationAction {
  kind: 'record-reminder' | 'daily-journal-reminder';
  reminderId?: string;
}

export interface ReminderScheduleResult {
  ok: boolean;
  message: string;
}

const NOTIFICATION_BODY_FALLBACK = '点开回到对应记录。';
const LOCAL_NOTIFICATIONS_PLUGIN = 'LocalNotifications';
const RECORD_REMINDER_NOTIFICATION_KIND = 'record-reminder';
const DAILY_JOURNAL_NOTIFICATION_KIND = 'daily-journal-reminder';
const DAILY_JOURNAL_NOTIFICATION_ID = 1_923_000_000;
const DAILY_JOURNAL_NOTIFICATION_TITLE = '心记提醒';
const DAILY_JOURNAL_NOTIFICATION_BODY = '晚上 11 点了，花一点时间记一下今天吧。';
const NATIVE_PLUGIN_UNAVAILABLE_MESSAGE =
  '提醒已保存失败：当前 App 壳还没有加载系统通知插件。请重新运行 npx cap sync ios 后，在 Xcode 里 Clean Build 并重新安装到手机。';
const NATIVE_CALL_TIMEOUT_MS = 3500;

const getReminderBody = (reminder: RecordReminder): string =>
  reminder.quote
    ? `“${reminder.quote}”`
    : NOTIFICATION_BODY_FALLBACK;

const getReminderExtra = (reminder: RecordReminder): Record<string, string> => ({
  notificationKind: RECORD_REMINDER_NOTIFICATION_KIND,
  reminderId: reminder.id,
  targetType: reminder.targetType,
  targetId: reminder.targetId,
});

const getDailyJournalReminderExtra = (): Record<string, string> => ({
  notificationKind: DAILY_JOURNAL_NOTIFICATION_KIND,
});

const getNotificationActionKind = (
  notificationAction: ActionPerformed,
): string | null => {
  const extra = notificationAction.notification.extra;

  if (
    extra &&
    typeof extra === 'object' &&
    'notificationKind' in extra &&
    typeof extra.notificationKind === 'string'
  ) {
    return extra.notificationKind;
  }

  return null;
};

const getExtraReminderId = (notificationAction: ActionPerformed): string | null => {
  const extra = notificationAction.notification.extra;

  if (
    extra &&
    typeof extra === 'object' &&
    'reminderId' in extra &&
    typeof extra.reminderId === 'string'
  ) {
    return extra.reminderId;
  }

  return null;
};

const isLocalNotificationsAvailable = (): boolean =>
  Capacitor.isNativePlatform() &&
  Capacitor.isPluginAvailable(LOCAL_NOTIFICATIONS_PLUGIN);

const isPluginMissingError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  return (
    'code' in error &&
    (error as { code?: unknown }).code === 'UNIMPLEMENTED'
  );
};

const withTimeout = async <T>(promise: Promise<T>, label: string): Promise<T> => {
  let timeoutId: ReturnType<typeof window.setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`${label} timed out`));
    }, NATIVE_CALL_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
};

const ensureLocalNotificationPermissionGranted = async (): Promise<boolean> => {
  const permission = await withTimeout(
    LocalNotifications.checkPermissions(),
    'check local notification permissions',
  );
  const finalPermission =
    permission.display === 'granted'
      ? permission
      : await withTimeout(
          LocalNotifications.requestPermissions(),
          'request local notification permissions',
        );

  return finalPermission.display === 'granted';
};

const getFutureReminders = (reminders: RecordReminder[]): RecordReminder[] =>
  reminders.filter((reminder) => {
    const scheduledAt = new Date(reminder.scheduledAt).getTime();
    return !Number.isNaN(scheduledAt) && scheduledAt > Date.now();
  });

const buildRecordNotification = (reminder: RecordReminder) => ({
  id: reminder.notificationId,
  title: reminder.reminderTitle,
  body: getReminderBody(reminder),
  largeBody: getReminderBody(reminder),
  schedule: {
    at: new Date(reminder.scheduledAt),
    allowWhileIdle: true,
  },
  extra: getReminderExtra(reminder),
});

export const scheduleReminderNotifications = async (
  reminders: RecordReminder[],
): Promise<ReminderScheduleResult> => {
  const futureReminders = getFutureReminders(reminders);

  if (futureReminders.length === 0) {
    return {
      ok: false,
      message: '提醒时间需要晚于当前时间。',
    };
  }

  if (!Capacitor.isNativePlatform()) {
    return {
      ok: true,
      message:
        futureReminders.length === 1
          ? '提醒已保存；浏览器预览不会在 App 关闭后弹系统通知，真机同步后会使用系统提醒。'
          : `已保存 ${futureReminders.length} 条提醒；浏览器预览不会在 App 关闭后弹系统通知，真机同步后会使用系统提醒。`,
    };
  }

  if (!isLocalNotificationsAvailable()) {
    return {
      ok: false,
      message: NATIVE_PLUGIN_UNAVAILABLE_MESSAGE,
    };
  }

  try {
    const hasPermission = await ensureLocalNotificationPermissionGranted();

    if (!hasPermission) {
      return {
        ok: false,
        message: '系统通知权限未开启，暂时不能创建定时提醒。',
      };
    }

    await withTimeout(
      LocalNotifications.schedule({
        notifications: futureReminders.map(buildRecordNotification),
      }),
      'schedule local notifications',
    );

    return {
      ok: true,
      message:
        futureReminders.length === 1
          ? '提醒已交给系统，到点会通知你。'
          : `已把 ${futureReminders.length} 条提醒重新交给系统，到点会依次通知你。`,
    };
  } catch (error) {
    return {
      ok: false,
      message: isPluginMissingError(error)
        ? NATIVE_PLUGIN_UNAVAILABLE_MESSAGE
        : '系统提醒暂时没有响应，请重新安装 App 后再试一次。',
    };
  }
};

export const scheduleReminderNotification = async (
  reminder: RecordReminder,
): Promise<ReminderScheduleResult> =>
  scheduleReminderNotifications([reminder]);

export const scheduleDailyJournalReminderNotification = async (
  hour: number,
  minute: number,
): Promise<ReminderScheduleResult> => {
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return {
      ok: false,
      message: '每日提醒时间无效，暂时不能开启。',
    };
  }

  if (!Capacitor.isNativePlatform()) {
    return {
      ok: true,
      message: `每日 ${hour.toString().padStart(2, '0')}:${minute
        .toString()
        .padStart(2, '0')} 提醒已开启；浏览器预览不会在 App 关闭后弹系统通知，真机同步后会使用系统提醒。`,
    };
  }

  if (!isLocalNotificationsAvailable()) {
    return {
      ok: false,
      message: NATIVE_PLUGIN_UNAVAILABLE_MESSAGE,
    };
  }

  try {
    const hasPermission = await ensureLocalNotificationPermissionGranted();

    if (!hasPermission) {
      return {
        ok: false,
        message: '系统通知权限未开启，暂时不能开启每日提醒。',
      };
    }

    await withTimeout(
      LocalNotifications.schedule({
        notifications: [
          {
            id: DAILY_JOURNAL_NOTIFICATION_ID,
            title: DAILY_JOURNAL_NOTIFICATION_TITLE,
            body: DAILY_JOURNAL_NOTIFICATION_BODY,
            largeBody: DAILY_JOURNAL_NOTIFICATION_BODY,
            schedule: {
              on: {
                hour,
                minute,
              },
              allowWhileIdle: true,
            },
            extra: getDailyJournalReminderExtra(),
          },
        ],
      }),
      'schedule daily journal reminder',
    );

    return {
      ok: true,
      message: `已开启每日 ${hour.toString().padStart(2, '0')}:${minute
        .toString()
        .padStart(2, '0')} 系统提醒。`,
    };
  } catch (error) {
    return {
      ok: false,
      message: isPluginMissingError(error)
        ? NATIVE_PLUGIN_UNAVAILABLE_MESSAGE
        : '每日提醒暂时没有响应，请重新安装 App 后再试一次。',
    };
  }
};

export const cancelDailyJournalReminderNotification = async (): Promise<void> => {
  if (!isLocalNotificationsAvailable()) {
    return;
  }

  try {
    await withTimeout(
      LocalNotifications.cancel({
        notifications: [
          {
            id: DAILY_JOURNAL_NOTIFICATION_ID,
          },
        ],
      }),
      'cancel daily journal reminder',
    );
  } catch {
    // The setting is already removed locally; native cancellation can be retried
    // after reinstalling or syncing the shell again.
  }
};

export const cancelReminderNotification = async (
  notificationId: number,
): Promise<void> => {
  if (!isLocalNotificationsAvailable()) {
    return;
  }

  try {
    await withTimeout(
      LocalNotifications.cancel({
        notifications: [
          {
            id: notificationId,
          },
        ],
      }),
      'cancel local notification',
    );
  } catch {
    // The reminder has already been removed locally; native cancellation can
    // safely be retried by reinstalling/syncing the app if the shell was stale.
  }
};

export const listenForReminderNotificationActions = async (
  onAction: (action: ReminderNotificationAction) => void,
): Promise<(() => void) | null> => {
  if (!isLocalNotificationsAvailable()) {
    return null;
  }

  try {
    const handle = await withTimeout(
      LocalNotifications.addListener(
        'localNotificationActionPerformed',
        (notificationAction) => {
          const actionKind = getNotificationActionKind(notificationAction);
          if (actionKind === DAILY_JOURNAL_NOTIFICATION_KIND) {
            onAction({ kind: DAILY_JOURNAL_NOTIFICATION_KIND });
            return;
          }

          const reminderId = getExtraReminderId(notificationAction);

          if (!reminderId) {
            return;
          }

          onAction({
            kind: RECORD_REMINDER_NOTIFICATION_KIND,
            reminderId,
          });
        },
      ),
      'listen local notification actions',
    );

    return () => {
      void handle.remove();
    };
  } catch {
    return null;
  }
};
