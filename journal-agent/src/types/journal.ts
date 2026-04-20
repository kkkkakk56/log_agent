export type JournalMood = 'great' | 'calm' | 'tired' | 'low';

export type JournalSyncStatus = 'local' | 'pending' | 'synced';

export interface JournalEntry {
  id: string;
  title: string;
  content: string;
  entryDate: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  tags: string[];
  syncStatus: JournalSyncStatus;
  mood?: JournalMood | null;
}
