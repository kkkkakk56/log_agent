export type ReminderTargetType =
  | 'journal-entry'
  | 'knowledge-note'
  | 'lab-record';

export interface RecordReminder {
  id: string;
  notificationId: number;
  targetType: ReminderTargetType;
  targetId: string;
  parentId: string | null;
  targetTitle: string;
  reminderTitle: string;
  quote: string;
  anchorStart: number | null;
  scheduledAt: string;
  deliveredAt: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
  updatedAt: string;
  canceledAt: string | null;
}
