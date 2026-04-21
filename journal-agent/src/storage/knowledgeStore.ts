import type { KnowledgeBase, KnowledgeNote } from '../types/knowledge';
import { normalizeRecordImages } from '../utils/recordImages';
import { deleteBranchesForContainer, getRecordBranches } from './branchStore';

const BASES_STORAGE_KEY = 'journal-agent.knowledge.bases.v1';
const NOTES_STORAGE_KEY = 'journal-agent.knowledge.notes.v1';
const MAX_BASE_NAME_LENGTH = 40;
const MAX_NOTE_TITLE_LENGTH = 80;
export const MAX_PINNED_KNOWLEDGE_NOTES_PER_BASE = 5;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const normalizeTags = (tags: string[]): string[] =>
  Array.from(
    new Set(
      tags
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
        .map((tag) => tag.slice(0, 24)),
    ),
  ).slice(0, 12);

const isKnowledgeBase = (value: unknown): value is KnowledgeBase =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.name === 'string' &&
  typeof value.description === 'string' &&
  isStringArray(value.tags) &&
  typeof value.createdAt === 'string' &&
  typeof value.updatedAt === 'string' &&
  (typeof value.deletedAt === 'string' || value.deletedAt === null);

const parseKnowledgeNote = (value: unknown): KnowledgeNote | null => {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.baseId !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.content !== 'string' ||
    typeof value.sourceUrl !== 'string' ||
    !isStringArray(value.tags) ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    (typeof value.deletedAt !== 'string' && value.deletedAt !== null) ||
    (typeof value.flaggedAt !== 'string' &&
      value.flaggedAt !== null &&
      value.flaggedAt !== undefined) ||
    (typeof value.pinnedAt !== 'string' &&
      value.pinnedAt !== null &&
      value.pinnedAt !== undefined) ||
    (typeof value.branchId !== 'string' &&
      value.branchId !== null &&
      value.branchId !== undefined)
  ) {
    return null;
  }

  return {
    id: value.id,
    baseId: value.baseId,
    branchId: typeof value.branchId === 'string' ? value.branchId : null,
    flaggedAt: typeof value.flaggedAt === 'string' ? value.flaggedAt : null,
    pinnedAt: typeof value.pinnedAt === 'string' ? value.pinnedAt : null,
    title: value.title,
    content: value.content,
    sourceUrl: value.sourceUrl,
    tags: value.tags,
    images: normalizeRecordImages(value.images),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    deletedAt: value.deletedAt,
  };
};

const createId = (prefix: string): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

const readBases = (): KnowledgeBase[] =>
  readCollection(BASES_STORAGE_KEY, (value) =>
    isKnowledgeBase(value) ? value : null,
  );

const writeBases = (bases: KnowledgeBase[]): boolean =>
  writeCollection(BASES_STORAGE_KEY, bases);

const readNotes = (): KnowledgeNote[] =>
  readCollection(NOTES_STORAGE_KEY, parseKnowledgeNote);

const isAvailableBranch = (baseId: string, branchId: string | null): boolean => {
  if (branchId === null) {
    return true;
  }

  return getRecordBranches({
    parkType: 'knowledge',
    containerId: baseId,
  }).some((branch) => branch.id === branchId);
};

const writeNotes = (notes: KnowledgeNote[]): boolean =>
  writeCollection(NOTES_STORAGE_KEY, notes);

const sortByUpdatedAtDesc = <T extends { updatedAt: string }>(items: T[]): T[] =>
  [...items].sort(
    (firstItem, secondItem) =>
      new Date(secondItem.updatedAt).getTime() -
      new Date(firstItem.updatedAt).getTime(),
  );

const sortPinnedNotes = (notes: KnowledgeNote[]): KnowledgeNote[] =>
  [...notes].sort((firstNote, secondNote) => {
    const firstPinnedAt = firstNote.pinnedAt ? new Date(firstNote.pinnedAt).getTime() : 0;
    const secondPinnedAt = secondNote.pinnedAt ? new Date(secondNote.pinnedAt).getTime() : 0;

    if (firstPinnedAt !== secondPinnedAt) {
      return secondPinnedAt - firstPinnedAt;
    }

    return (
      new Date(secondNote.updatedAt).getTime() -
      new Date(firstNote.updatedAt).getTime()
    );
  });

const createNoteTitle = (content: string, title = ''): string => {
  const normalizedTitle = title.trim();

  if (normalizedTitle) {
    return normalizedTitle.slice(0, MAX_NOTE_TITLE_LENGTH);
  }

  const firstLine = content.trim().split(/\r?\n/, 1)[0]?.trim() ?? '';
  const titleSource = firstLine || '未命名知识';

  return titleSource.slice(0, MAX_NOTE_TITLE_LENGTH);
};

const touchKnowledgeBase = (baseId: string, updatedAt: string): void => {
  const bases = readBases();
  const baseIndex = bases.findIndex(
    (base) => base.id === baseId && base.deletedAt === null,
  );

  if (baseIndex === -1) {
    return;
  }

  const nextBases = [...bases];
  nextBases[baseIndex] = {
    ...nextBases[baseIndex],
    updatedAt,
  };

  writeBases(nextBases);
};

export const getKnowledgeBases = (): KnowledgeBase[] =>
  sortByUpdatedAtDesc(
    readBases().filter((base) => base.deletedAt === null),
  );

export const getKnowledgeNotes = (baseId?: string): KnowledgeNote[] =>
  sortPinnedNotes(
    readNotes().filter(
      (note) =>
        note.deletedAt === null &&
        (!baseId || note.baseId === baseId),
    ),
  );

export const createKnowledgeBase = (
  name: string,
  description = '',
  tags: string[] = [],
): KnowledgeBase | null => {
  const normalizedName = name.trim().slice(0, MAX_BASE_NAME_LENGTH);

  if (!normalizedName) {
    return null;
  }

  const now = new Date().toISOString();
  const base: KnowledgeBase = {
    id: createId('knowledge-base'),
    name: normalizedName,
    description: description.trim(),
    tags: normalizeTags(tags),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  return writeBases([...readBases(), base]) ? base : null;
};

export const updateKnowledgeBase = (
  id: string,
  fields: Pick<KnowledgeBase, 'name' | 'description' | 'tags'>,
): KnowledgeBase | null => {
  const normalizedName = fields.name.trim().slice(0, MAX_BASE_NAME_LENGTH);

  if (!normalizedName) {
    return null;
  }

  const bases = readBases();
  const baseIndex = bases.findIndex(
    (base) => base.id === id && base.deletedAt === null,
  );

  if (baseIndex === -1) {
    return null;
  }

  const updatedBase: KnowledgeBase = {
    ...bases[baseIndex],
    name: normalizedName,
    description: fields.description.trim(),
    tags: normalizeTags(fields.tags),
    updatedAt: new Date().toISOString(),
  };
  const nextBases = [...bases];
  nextBases[baseIndex] = updatedBase;

  return writeBases(nextBases) ? updatedBase : null;
};

export const deleteKnowledgeBase = (id: string): void => {
  const now = new Date().toISOString();
  const bases = readBases();
  const baseIndex = bases.findIndex(
    (base) => base.id === id && base.deletedAt === null,
  );

  if (baseIndex === -1) {
    return;
  }

  const nextBases = [...bases];
  nextBases[baseIndex] = {
    ...nextBases[baseIndex],
    deletedAt: now,
    updatedAt: now,
  };

  const nextNotes = readNotes().map((note) =>
    note.baseId === id && note.deletedAt === null
      ? {
          ...note,
          deletedAt: now,
          updatedAt: now,
        }
      : note,
  );

  writeBases(nextBases);
  writeNotes(nextNotes);
  deleteBranchesForContainer('knowledge', id);
};

export const createKnowledgeNote = (
  baseId: string,
  fields: Pick<
    KnowledgeNote,
    'title' | 'content' | 'sourceUrl' | 'tags' | 'branchId' | 'images'
  >,
): KnowledgeNote | null => {
  const activeBase = getKnowledgeBases().find((base) => base.id === baseId);
  const normalizedContent = fields.content.trim();

  if (
    !activeBase ||
    !normalizedContent ||
    !isAvailableBranch(baseId, fields.branchId)
  ) {
    return null;
  }

  const now = new Date().toISOString();
  const note: KnowledgeNote = {
    id: createId('knowledge-note'),
    baseId,
    branchId: fields.branchId,
    flaggedAt: null,
    pinnedAt: null,
    title: createNoteTitle(normalizedContent, fields.title),
    content: normalizedContent,
    sourceUrl: fields.sourceUrl.trim(),
    tags: normalizeTags(fields.tags),
    images: normalizeRecordImages(fields.images),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  if (!writeNotes([...readNotes(), note])) {
    return null;
  }

  touchKnowledgeBase(baseId, now);

  return note;
};

export const updateKnowledgeNote = (
  id: string,
  fields: Pick<
    KnowledgeNote,
    'title' | 'content' | 'sourceUrl' | 'tags' | 'branchId' | 'images'
  >,
): KnowledgeNote | null => {
  const normalizedContent = fields.content.trim();

  if (!normalizedContent) {
    return null;
  }

  const notes = readNotes();
  const noteIndex = notes.findIndex(
    (note) => note.id === id && note.deletedAt === null,
  );

  if (noteIndex === -1) {
    return null;
  }

  if (
    !isAvailableBranch(notes[noteIndex].baseId, fields.branchId) &&
    fields.branchId !== notes[noteIndex].branchId
  ) {
    return null;
  }

  const updatedNote: KnowledgeNote = {
    ...notes[noteIndex],
    branchId: fields.branchId,
    title: createNoteTitle(normalizedContent, fields.title),
    content: normalizedContent,
    sourceUrl: fields.sourceUrl.trim(),
    tags: normalizeTags(fields.tags),
    images: normalizeRecordImages(fields.images),
    updatedAt: new Date().toISOString(),
  };
  const nextNotes = [...notes];
  nextNotes[noteIndex] = updatedNote;

  if (!writeNotes(nextNotes)) {
    return null;
  }

  touchKnowledgeBase(updatedNote.baseId, updatedNote.updatedAt);

  return updatedNote;
};

export const setKnowledgeNotePinned = (
  id: string,
  pinned: boolean,
): KnowledgeNote | null => {
  const notes = readNotes();
  const noteIndex = notes.findIndex(
    (note) => note.id === id && note.deletedAt === null,
  );

  if (noteIndex === -1) {
    return null;
  }

  const currentNote = notes[noteIndex];

  if (
    pinned &&
    currentNote.pinnedAt === null &&
    notes.filter(
      (note) =>
        note.baseId === currentNote.baseId &&
        note.deletedAt === null &&
        note.pinnedAt !== null,
    ).length >= MAX_PINNED_KNOWLEDGE_NOTES_PER_BASE
  ) {
    return null;
  }

  const updatedNote: KnowledgeNote = {
    ...currentNote,
    pinnedAt: pinned ? currentNote.pinnedAt ?? new Date().toISOString() : null,
  };
  const nextNotes = [...notes];
  nextNotes[noteIndex] = updatedNote;

  return writeNotes(nextNotes) ? updatedNote : null;
};

export const setKnowledgeNoteFlagged = (
  id: string,
  flagged: boolean,
): KnowledgeNote | null => {
  const notes = readNotes();
  const noteIndex = notes.findIndex(
    (note) => note.id === id && note.deletedAt === null,
  );

  if (noteIndex === -1) {
    return null;
  }

  const currentNote = notes[noteIndex];
  const updatedNote: KnowledgeNote = {
    ...currentNote,
    flaggedAt: flagged ? currentNote.flaggedAt ?? new Date().toISOString() : null,
  };
  const nextNotes = [...notes];
  nextNotes[noteIndex] = updatedNote;

  return writeNotes(nextNotes) ? updatedNote : null;
};

export const deleteKnowledgeNote = (id: string): void => {
  const notes = readNotes();
  const noteIndex = notes.findIndex(
    (note) => note.id === id && note.deletedAt === null,
  );

  if (noteIndex === -1) {
    return;
  }

  const now = new Date().toISOString();
  const nextNotes = [...notes];
  nextNotes[noteIndex] = {
    ...nextNotes[noteIndex],
    deletedAt: now,
    updatedAt: now,
  };

  writeNotes(nextNotes);
  touchKnowledgeBase(nextNotes[noteIndex].baseId, now);
};

export const clearKnowledgeNoteBranchAssignments = (
  baseId: string,
  branchId: string,
): void => {
  const notes = readNotes();
  const now = new Date().toISOString();
  const nextNotes = notes.map((note) =>
    note.baseId === baseId && note.branchId === branchId && note.deletedAt === null
      ? {
          ...note,
          branchId: null,
          updatedAt: now,
        }
      : note,
  );

  writeNotes(nextNotes);
  touchKnowledgeBase(baseId, now);
};
