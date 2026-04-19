import { Capacitor } from '@capacitor/core';
import {
  LocalNotifications,
  type ActionPerformed,
} from '@capacitor/local-notifications';
import type { RecordReminder } from '../types/reminder';

export interface ReminderNotificationAction {
  reminderId: string;
}

export interface ReminderScheduleResult {
  ok: boolean;
  message: string;
}

const NOTIFICATION_BODY_FALLBACK = '点开回到对应记录。';
const LOCAL_NOTIFICATIONS_PLUGIN = 'LocalNotifications';
const NATIVE_PLUGIN_UNAVAILABLE_MESSAGE =
  '提醒已保存失败：当前 App 壳还没有加载系统通知插件。请重新运行 npx cap sync ios 后，在 Xcode 里 Clean Build 并重新安装到手机。';
const NATIVE_CALL_TIMEOUT_MS = 3500;

const getReminderBody = (reminder: RecordReminder): string =>
  reminder.quote
    ? `“${reminder.quote}”`
    : NOTIFICATION_BODY_FALLBACK;

const getReminderExtra = (reminder: RecordReminder): Record<string, string> => ({
  reminderId: reminder.id,
  targetType: reminder.targetType,
  targetId: reminder.targetId,
});

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

export const scheduleReminderNotification = async (
  reminder: RecordReminder,
): Promise<ReminderScheduleResult> => {
  const scheduledAt = new Date(reminder.scheduledAt);

  if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
    return {
      ok: false,
      message: '提醒时间需要晚于当前时间。',
    };
  }

  if (!Capacitor.isNativePlatform()) {
    return {
      ok: true,
      message: '提醒已保存；浏览器预览不会在 App 关闭后弹系统通知，真机同步后会使用系统提醒。',
    };
  }

  if (!isLocalNotificationsAvailable()) {
    return {
      ok: false,
      message: NATIVE_PLUGIN_UNAVAILABLE_MESSAGE,
    };
  }

  try {
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

    if (finalPermission.display !== 'granted') {
      return {
        ok: false,
        message: '系统通知权限未开启，暂时不能创建定时提醒。',
      };
    }

    await withTimeout(
      LocalNotifications.schedule({
        notifications: [
          {
            id: reminder.notificationId,
            title: reminder.reminderTitle,
            body: getReminderBody(reminder),
            largeBody: getReminderBody(reminder),
            schedule: {
              at: scheduledAt,
              allowWhileIdle: true,
            },
            extra: getReminderExtra(reminder),
          },
        ],
      }),
      'schedule local notification',
    );

    return {
      ok: true,
      message: '提醒已交给系统，到点会通知你。',
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
          const reminderId = getExtraReminderId(notificationAction);

          if (!reminderId) {
            return;
          }

          onAction({ reminderId });
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
