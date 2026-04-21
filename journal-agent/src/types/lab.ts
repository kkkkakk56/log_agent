import type { RecordImageAttachment } from './media';

export type LabRecordType = 'operation' | 'review';

export interface LabProject {
  id: string;
  name: string;
  description: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface LabRecord {
  id: string;
  projectId: string;
  branchId: string | null;
  flaggedAt: string | null;
  pinnedAt: string | null;
  title: string;
  content: string;
  type: LabRecordType;
  tags: string[];
  images: RecordImageAttachment[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
