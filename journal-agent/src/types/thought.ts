export interface ThoughtQuestion {
  id: string;
  title: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ThoughtEcho {
  id: string;
  questionId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
