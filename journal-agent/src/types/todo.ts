export type TodoParkType = 'journal' | 'project';

export type TodoTargetType = 'card' | 'sentence';

export type TodoStatus = 'open' | 'done';

export interface TodoMark {
  id: string;
  parkType: TodoParkType;
  noteId: string;
  targetType: TodoTargetType;
  sentenceText?: string;
  sentenceApproxOffset?: number;
  status: TodoStatus;
  createdAt: number;
  doneAt?: number;
  doneNote?: string;
  reminderId?: string;
}
