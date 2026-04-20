import type {
  TodoMark,
  TodoParkType,
  TodoStatus,
  TodoTargetType,
} from '../types/todo';

const STORAGE_KEY = 'journal-agent.todos.v1';

interface TodoQuery {
  parkType?: TodoParkType;
  noteId?: string;
  noteIds?: string[];
  targetType?: TodoTargetType;
}

interface CreateTodoFields {
  parkType: TodoParkType;
  noteId: string;
  targetType: TodoTargetType;
  sentenceText?: string;
  sentenceApproxOffset?: number;
  reminderId?: string;
}

const TODO_STATUSES: readonly TodoStatus[] = ['open', 'done'];
const TODO_PARK_TYPES: readonly TodoParkType[] = ['journal', 'project'];
const TODO_TARGET_TYPES: readonly TodoTargetType[] = ['card', 'sentence'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const createId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `todo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const isTodoMark = (value: unknown): value is TodoMark =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  TODO_PARK_TYPES.includes(value.parkType as TodoParkType) &&
  typeof value.noteId === 'string' &&
  TODO_TARGET_TYPES.includes(value.targetType as TodoTargetType) &&
  TODO_STATUSES.includes(value.status as TodoStatus) &&
  typeof value.createdAt === 'number' &&
  (value.doneAt === undefined || typeof value.doneAt === 'number') &&
  (value.doneNote === undefined || typeof value.doneNote === 'string') &&
  (value.reminderId === undefined || typeof value.reminderId === 'string') &&
  (value.sentenceText === undefined || typeof value.sentenceText === 'string') &&
  (value.sentenceApproxOffset === undefined ||
    typeof value.sentenceApproxOffset === 'number');

const readTodos = (): TodoMark[] => {
  try {
    const rawTodos = localStorage.getItem(STORAGE_KEY);

    if (!rawTodos) {
      return [];
    }

    const parsedTodos: unknown = JSON.parse(rawTodos);

    if (!Array.isArray(parsedTodos)) {
      return [];
    }

    return parsedTodos.filter(isTodoMark);
  } catch {
    return [];
  }
};

const writeTodos = (todos: TodoMark[]): boolean => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
    return true;
  } catch {
    return false;
  }
};

const matchesQuery = (todo: TodoMark, query: TodoQuery): boolean => {
  if (query.parkType && todo.parkType !== query.parkType) {
    return false;
  }

  if (query.noteId && todo.noteId !== query.noteId) {
    return false;
  }

  if (query.noteIds && !query.noteIds.includes(todo.noteId)) {
    return false;
  }

  if (query.targetType && todo.targetType !== query.targetType) {
    return false;
  }

  return true;
};

export const getTodos = (): TodoMark[] =>
  readTodos().sort((firstTodo, secondTodo) => {
    if (firstTodo.status !== secondTodo.status) {
      return firstTodo.status === 'open' ? -1 : 1;
    }

    const firstTime = firstTodo.status === 'done' ? firstTodo.doneAt ?? 0 : firstTodo.createdAt;
    const secondTime =
      secondTodo.status === 'done' ? secondTodo.doneAt ?? 0 : secondTodo.createdAt;

    return secondTime - firstTime;
  });

export const createTodo = (fields: CreateTodoFields): TodoMark | null => {
  if (!fields.noteId || !TODO_PARK_TYPES.includes(fields.parkType)) {
    return null;
  }

  if (!TODO_TARGET_TYPES.includes(fields.targetType)) {
    return null;
  }

  if (fields.targetType === 'sentence' && !fields.sentenceText?.trim()) {
    return null;
  }

  const todo: TodoMark = {
    id: createId(),
    parkType: fields.parkType,
    noteId: fields.noteId,
    targetType: fields.targetType,
    sentenceText: fields.sentenceText?.trim(),
    sentenceApproxOffset: fields.sentenceApproxOffset,
    status: 'open',
    createdAt: Date.now(),
    reminderId: fields.reminderId,
  };

  return writeTodos([...readTodos(), todo]) ? todo : null;
};

export const completeTodo = (id: string, doneNote = ''): TodoMark | null => {
  const todos = readTodos();
  const todoIndex = todos.findIndex((todo) => todo.id === id);

  if (todoIndex === -1) {
    return null;
  }

  const completedTodo: TodoMark = {
    ...todos[todoIndex],
    status: 'done',
    doneAt: todos[todoIndex].doneAt ?? Date.now(),
    doneNote: doneNote.trim() || undefined,
  };
  const nextTodos = [...todos];
  nextTodos[todoIndex] = completedTodo;

  return writeTodos(nextTodos) ? completedTodo : null;
};

export const reopenTodo = (id: string): TodoMark | null => {
  const todos = readTodos();
  const todoIndex = todos.findIndex((todo) => todo.id === id);

  if (todoIndex === -1) {
    return null;
  }

  const reopenedTodo: TodoMark = {
    ...todos[todoIndex],
    status: 'open',
    doneAt: undefined,
    doneNote: undefined,
  };
  const nextTodos = [...todos];
  nextTodos[todoIndex] = reopenedTodo;

  return writeTodos(nextTodos) ? reopenedTodo : null;
};

export const updateTodoDoneNote = (id: string, doneNote: string): TodoMark | null => {
  const todos = readTodos();
  const todoIndex = todos.findIndex((todo) => todo.id === id);

  if (todoIndex === -1 || todos[todoIndex].status !== 'done') {
    return null;
  }

  const updatedTodo: TodoMark = {
    ...todos[todoIndex],
    doneNote: doneNote.trim() || undefined,
  };
  const nextTodos = [...todos];
  nextTodos[todoIndex] = updatedTodo;

  return writeTodos(nextTodos) ? updatedTodo : null;
};

export const deleteTodosForNote = (
  parkType: TodoParkType,
  noteId: string,
): number => {
  const todos = readTodos();
  const nextTodos = todos.filter(
    (todo) => !(todo.parkType === parkType && todo.noteId === noteId),
  );

  return writeTodos(nextTodos) ? todos.length - nextTodos.length : 0;
};

export const deleteTodo = (id: string): boolean => {
  const todos = readTodos();
  const nextTodos = todos.filter((todo) => todo.id !== id);

  return writeTodos(nextTodos);
};

export const deleteTodosForNotes = (
  parkType: TodoParkType,
  noteIds: string[],
): number => {
  const noteIdSet = new Set(noteIds);
  const todos = readTodos();
  const nextTodos = todos.filter(
    (todo) => !(todo.parkType === parkType && noteIdSet.has(todo.noteId)),
  );

  return writeTodos(nextTodos) ? todos.length - nextTodos.length : 0;
};

export const deleteDoneTodos = (query: TodoQuery = {}): number => {
  const todos = readTodos();
  const nextTodos = todos.filter(
    (todo) => !(todo.status === 'done' && matchesQuery(todo, query)),
  );

  return writeTodos(nextTodos) ? todos.length - nextTodos.length : 0;
};
