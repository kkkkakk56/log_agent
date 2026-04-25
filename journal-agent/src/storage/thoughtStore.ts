import type { ThoughtEcho, ThoughtQuestion } from '../types/thought';

const QUESTIONS_STORAGE_KEY = 'journal-agent.thought.questions.v1';
const ECHOES_STORAGE_KEY = 'journal-agent.thought.echoes.v1';
const MAX_QUESTION_TITLE_LENGTH = 120;
const MAX_QUESTION_NOTE_LENGTH = 240;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const createId = (prefix: string): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const parseQuestion = (value: unknown): ThoughtQuestion | null => {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.note !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    (typeof value.deletedAt !== 'string' && value.deletedAt !== null)
  ) {
    return null;
  }

  return {
    id: value.id,
    title: value.title,
    note: value.note,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    deletedAt: value.deletedAt,
  };
};

const parseEcho = (value: unknown): ThoughtEcho | null => {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.questionId !== 'string' ||
    typeof value.content !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    (typeof value.deletedAt !== 'string' && value.deletedAt !== null)
  ) {
    return null;
  }

  return {
    id: value.id,
    questionId: value.questionId,
    content: value.content,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    deletedAt: value.deletedAt,
  };
};

const readCollection = <T>(
  storageKey: string,
  parser: (value: unknown) => T | null,
): T[] => {
  try {
    const rawItems = localStorage.getItem(storageKey);

    if (!rawItems) {
      return [];
    }

    const parsedItems: unknown = JSON.parse(rawItems);

    if (!Array.isArray(parsedItems)) {
      return [];
    }

    return parsedItems.flatMap((item) => {
      const parsedItem = parser(item);
      return parsedItem ? [parsedItem] : [];
    });
  } catch {
    return [];
  }
};

const writeCollection = <T>(storageKey: string, items: T[]): boolean => {
  try {
    localStorage.setItem(storageKey, JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
};

const readQuestions = (): ThoughtQuestion[] =>
  readCollection(QUESTIONS_STORAGE_KEY, parseQuestion);

const writeQuestions = (questions: ThoughtQuestion[]): boolean =>
  writeCollection(QUESTIONS_STORAGE_KEY, questions);

const readEchoes = (): ThoughtEcho[] =>
  readCollection(ECHOES_STORAGE_KEY, parseEcho);

const writeEchoes = (echoes: ThoughtEcho[]): boolean =>
  writeCollection(ECHOES_STORAGE_KEY, echoes);

const sortByUpdatedAtDesc = <T extends { updatedAt: string }>(items: T[]): T[] =>
  [...items].sort(
    (firstItem, secondItem) =>
      new Date(secondItem.updatedAt).getTime() -
      new Date(firstItem.updatedAt).getTime(),
  );

const touchQuestion = (questionId: string, updatedAt: string): void => {
  const questions = readQuestions();
  const questionIndex = questions.findIndex(
    (question) => question.id === questionId && question.deletedAt === null,
  );

  if (questionIndex === -1) {
    return;
  }

  const nextQuestions = [...questions];
  nextQuestions[questionIndex] = {
    ...nextQuestions[questionIndex],
    updatedAt,
  };
  writeQuestions(nextQuestions);
};

export const getThoughtQuestions = (): ThoughtQuestion[] =>
  sortByUpdatedAtDesc(
    readQuestions().filter((question) => question.deletedAt === null),
  );

export const getThoughtEchoes = (questionId?: string): ThoughtEcho[] =>
  sortByUpdatedAtDesc(
    readEchoes().filter(
      (echo) =>
        echo.deletedAt === null &&
        (!questionId || echo.questionId === questionId),
    ),
  );

export const createThoughtQuestion = (
  title: string,
  note = '',
): ThoughtQuestion | null => {
  const normalizedTitle = title.trim().slice(0, MAX_QUESTION_TITLE_LENGTH);

  if (!normalizedTitle) {
    return null;
  }

  const now = new Date().toISOString();
  const question: ThoughtQuestion = {
    id: createId('thought-question'),
    title: normalizedTitle,
    note: note.trim().slice(0, MAX_QUESTION_NOTE_LENGTH),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  return writeQuestions([...readQuestions(), question]) ? question : null;
};

export const createThoughtEcho = (
  questionId: string,
  content: string,
): ThoughtEcho | null => {
  const normalizedContent = content.trim();

  if (!normalizedContent) {
    return null;
  }

  const question = readQuestions().find(
    (item) => item.id === questionId && item.deletedAt === null,
  );

  if (!question) {
    return null;
  }

  const now = new Date().toISOString();
  const echo: ThoughtEcho = {
    id: createId('thought-echo'),
    questionId,
    content: normalizedContent,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  if (!writeEchoes([...readEchoes(), echo])) {
    return null;
  }

  touchQuestion(questionId, now);

  return echo;
};
