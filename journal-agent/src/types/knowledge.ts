export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface KnowledgeNote {
  id: string;
  baseId: string;
  branchId: string | null;
  pinnedAt: string | null;
  title: string;
  content: string;
  sourceUrl: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
