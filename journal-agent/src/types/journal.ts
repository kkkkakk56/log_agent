import type { RecordImageAttachment } from './media';

export type JournalMood = 'great' | 'calm' | 'tired' | 'low';

export type JournalSyncStatus = 'local' | 'pending' | 'synced';

export interface JournalEntry {
  id: string;
  title: string;
  content: string;
  flaggedAt: string | null;
  entryDate: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  tags: string[];
  images: RecordImageAttachment[];
  syncStatus: JournalSyncStatus;
  mood?: JournalMood | null;
}
