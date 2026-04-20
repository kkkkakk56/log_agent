export type BranchParkType = 'knowledge' | 'lab';

export interface RecordBranch {
  id: string;
  parkType: BranchParkType;
  containerId: string;
  parentId: string | null;
  name: string;
  description: string;
  order: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
