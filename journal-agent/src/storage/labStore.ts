import type { LabProject, LabRecord, LabRecordType } from '../types/lab';
import { deleteBranchesForContainer, getRecordBranches } from './branchStore';

const PROJECTS_STORAGE_KEY = 'journal-agent.lab.projects.v1';
const RECORDS_STORAGE_KEY = 'journal-agent.lab.records.v1';
const MAX_PROJECT_NAME_LENGTH = 40;
const MAX_RECORD_TITLE_LENGTH = 80;
export const MAX_PINNED_LAB_RECORDS_PER_PROJECT = 5;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isLabRecordType = (value: unknown): value is LabRecordType =>
  value === 'operation' || value === 'review';

const normalizeTags = (tags: string[]): string[] =>
  Array.from(
    new Set(
      tags
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
        .map((tag) => tag.slice(0, 24)),
    ),
  ).slice(0, 12);

const isLabProject = (value: unknown): value is LabProject =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.name === 'string' &&
  typeof value.description === 'string' &&
  isStringArray(value.tags) &&
  typeof value.createdAt === 'string' &&
  typeof value.updatedAt === 'string' &&
  (typeof value.deletedAt === 'string' || value.deletedAt === null);

const parseLabRecord = (value: unknown): LabRecord | null => {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.projectId !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.content !== 'string' ||
    !isLabRecordType(value.type) ||
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
    projectId: value.projectId,
    branchId: typeof value.branchId === 'string' ? value.branchId : null,
    flaggedAt: typeof value.flaggedAt === 'string' ? value.flaggedAt : null,
    pinnedAt: typeof value.pinnedAt === 'string' ? value.pinnedAt : null,
    title: value.title,
    content: value.content,
    type: value.type,
    tags: value.tags,
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

const readProjects = (): LabProject[] =>
  readCollection(PROJECTS_STORAGE_KEY, (value) =>
    isLabProject(value) ? value : null,
  );

const writeProjects = (projects: LabProject[]): boolean =>
  writeCollection(PROJECTS_STORAGE_KEY, projects);

const readRecords = (): LabRecord[] =>
  readCollection(RECORDS_STORAGE_KEY, parseLabRecord);

const isAvailableBranch = (projectId: string, branchId: string | null): boolean => {
  if (branchId === null) {
    return true;
  }

  return getRecordBranches({
    parkType: 'lab',
    containerId: projectId,
  }).some((branch) => branch.id === branchId);
};

const writeRecords = (records: LabRecord[]): boolean =>
  writeCollection(RECORDS_STORAGE_KEY, records);

const sortByUpdatedAtDesc = <T extends { updatedAt: string }>(items: T[]): T[] =>
  [...items].sort(
    (firstItem, secondItem) =>
      new Date(secondItem.updatedAt).getTime() -
      new Date(firstItem.updatedAt).getTime(),
  );

const sortPinnedRecords = (records: LabRecord[]): LabRecord[] =>
  [...records].sort((firstRecord, secondRecord) => {
    const firstPinnedAt = firstRecord.pinnedAt ? new Date(firstRecord.pinnedAt).getTime() : 0;
    const secondPinnedAt = secondRecord.pinnedAt ? new Date(secondRecord.pinnedAt).getTime() : 0;

    if (firstPinnedAt !== secondPinnedAt) {
      return secondPinnedAt - firstPinnedAt;
    }

    return (
      new Date(secondRecord.updatedAt).getTime() -
      new Date(firstRecord.updatedAt).getTime()
    );
  });

const createRecordTitle = (content: string, title = ''): string => {
  const normalizedTitle = title.trim();

  if (normalizedTitle) {
    return normalizedTitle.slice(0, MAX_RECORD_TITLE_LENGTH);
  }

  const firstLine = content.trim().split(/\r?\n/, 1)[0]?.trim() ?? '';
  const titleSource = firstLine || '未命名项目记录';

  return titleSource.slice(0, MAX_RECORD_TITLE_LENGTH);
};

const touchProject = (projectId: string, updatedAt: string): void => {
  const projects = readProjects();
  const projectIndex = projects.findIndex(
    (project) => project.id === projectId && project.deletedAt === null,
  );

  if (projectIndex === -1) {
    return;
  }

  const nextProjects = [...projects];
  nextProjects[projectIndex] = {
    ...nextProjects[projectIndex],
    updatedAt,
  };

  writeProjects(nextProjects);
};

export const getLabProjects = (): LabProject[] =>
  sortByUpdatedAtDesc(
    readProjects().filter((project) => project.deletedAt === null),
  );

export const getLabRecords = (projectId?: string): LabRecord[] =>
  sortPinnedRecords(
    readRecords().filter(
      (record) =>
        record.deletedAt === null &&
        (!projectId || record.projectId === projectId),
    ),
  );

export const createLabProject = (
  name: string,
  description = '',
  tags: string[] = [],
): LabProject | null => {
  const normalizedName = name.trim().slice(0, MAX_PROJECT_NAME_LENGTH);

  if (!normalizedName) {
    return null;
  }

  const now = new Date().toISOString();
  const project: LabProject = {
    id: createId('lab-project'),
    name: normalizedName,
    description: description.trim(),
    tags: normalizeTags(tags),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  return writeProjects([...readProjects(), project]) ? project : null;
};

export const updateLabProject = (
  id: string,
  fields: Pick<LabProject, 'name' | 'description' | 'tags'>,
): LabProject | null => {
  const normalizedName = fields.name.trim().slice(0, MAX_PROJECT_NAME_LENGTH);

  if (!normalizedName) {
    return null;
  }

  const projects = readProjects();
  const projectIndex = projects.findIndex(
    (project) => project.id === id && project.deletedAt === null,
  );

  if (projectIndex === -1) {
    return null;
  }

  const updatedProject: LabProject = {
    ...projects[projectIndex],
    name: normalizedName,
    description: fields.description.trim(),
    tags: normalizeTags(fields.tags),
    updatedAt: new Date().toISOString(),
  };
  const nextProjects = [...projects];
  nextProjects[projectIndex] = updatedProject;

  return writeProjects(nextProjects) ? updatedProject : null;
};

export const deleteLabProject = (id: string): void => {
  const now = new Date().toISOString();
  const projects = readProjects();
  const projectIndex = projects.findIndex(
    (project) => project.id === id && project.deletedAt === null,
  );

  if (projectIndex === -1) {
    return;
  }

  const nextProjects = [...projects];
  nextProjects[projectIndex] = {
    ...nextProjects[projectIndex],
    deletedAt: now,
    updatedAt: now,
  };

  const nextRecords = readRecords().map((record) =>
    record.projectId === id && record.deletedAt === null
      ? {
          ...record,
          deletedAt: now,
          updatedAt: now,
        }
      : record,
  );

  writeProjects(nextProjects);
  writeRecords(nextRecords);
  deleteBranchesForContainer('lab', id);
};

export const createLabRecord = (
  projectId: string,
  fields: Pick<LabRecord, 'title' | 'content' | 'type' | 'tags' | 'branchId'>,
): LabRecord | null => {
  const activeProject = getLabProjects().find((project) => project.id === projectId);
  const normalizedContent = fields.content.trim();

  if (
    !activeProject ||
    !normalizedContent ||
    !isLabRecordType(fields.type) ||
    !isAvailableBranch(projectId, fields.branchId)
  ) {
    return null;
  }

  const now = new Date().toISOString();
  const record: LabRecord = {
    id: createId('lab-record'),
    projectId,
    branchId: fields.branchId,
    flaggedAt: null,
    pinnedAt: null,
    title: createRecordTitle(normalizedContent, fields.title),
    content: normalizedContent,
    type: fields.type,
    tags: normalizeTags(fields.tags),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  if (!writeRecords([...readRecords(), record])) {
    return null;
  }

  touchProject(projectId, now);

  return record;
};

export const updateLabRecord = (
  id: string,
  fields: Pick<LabRecord, 'title' | 'content' | 'type' | 'tags' | 'branchId'>,
): LabRecord | null => {
  const normalizedContent = fields.content.trim();

  if (!normalizedContent || !isLabRecordType(fields.type)) {
    return null;
  }

  const records = readRecords();
  const recordIndex = records.findIndex(
    (record) => record.id === id && record.deletedAt === null,
  );

  if (recordIndex === -1) {
    return null;
  }

  if (
    !isAvailableBranch(records[recordIndex].projectId, fields.branchId) &&
    fields.branchId !== records[recordIndex].branchId
  ) {
    return null;
  }

  const updatedRecord: LabRecord = {
    ...records[recordIndex],
    branchId: fields.branchId,
    title: createRecordTitle(normalizedContent, fields.title),
    content: normalizedContent,
    type: fields.type,
    tags: normalizeTags(fields.tags),
    updatedAt: new Date().toISOString(),
  };
  const nextRecords = [...records];
  nextRecords[recordIndex] = updatedRecord;

  if (!writeRecords(nextRecords)) {
    return null;
  }

  touchProject(updatedRecord.projectId, updatedRecord.updatedAt);

  return updatedRecord;
};

export const setLabRecordPinned = (
  id: string,
  pinned: boolean,
): LabRecord | null => {
  const records = readRecords();
  const recordIndex = records.findIndex(
    (record) => record.id === id && record.deletedAt === null,
  );

  if (recordIndex === -1) {
    return null;
  }

  const currentRecord = records[recordIndex];

  if (
    pinned &&
    currentRecord.pinnedAt === null &&
    records.filter(
      (record) =>
        record.projectId === currentRecord.projectId &&
        record.deletedAt === null &&
        record.pinnedAt !== null,
    ).length >= MAX_PINNED_LAB_RECORDS_PER_PROJECT
  ) {
    return null;
  }

  const updatedRecord: LabRecord = {
    ...currentRecord,
    pinnedAt: pinned ? currentRecord.pinnedAt ?? new Date().toISOString() : null,
  };
  const nextRecords = [...records];
  nextRecords[recordIndex] = updatedRecord;

  return writeRecords(nextRecords) ? updatedRecord : null;
};

export const setLabRecordFlagged = (
  id: string,
  flagged: boolean,
): LabRecord | null => {
  const records = readRecords();
  const recordIndex = records.findIndex(
    (record) => record.id === id && record.deletedAt === null,
  );

  if (recordIndex === -1) {
    return null;
  }

  const currentRecord = records[recordIndex];
  const updatedRecord: LabRecord = {
    ...currentRecord,
    flaggedAt: flagged ? currentRecord.flaggedAt ?? new Date().toISOString() : null,
  };
  const nextRecords = [...records];
  nextRecords[recordIndex] = updatedRecord;

  return writeRecords(nextRecords) ? updatedRecord : null;
};

export const deleteLabRecord = (id: string): void => {
  const records = readRecords();
  const recordIndex = records.findIndex(
    (record) => record.id === id && record.deletedAt === null,
  );

  if (recordIndex === -1) {
    return;
  }

  const now = new Date().toISOString();
  const nextRecords = [...records];
  nextRecords[recordIndex] = {
    ...nextRecords[recordIndex],
    deletedAt: now,
    updatedAt: now,
  };

  writeRecords(nextRecords);
  touchProject(nextRecords[recordIndex].projectId, now);
};

export const clearLabRecordBranchAssignments = (
  projectId: string,
  branchId: string,
): void => {
  const records = readRecords();
  const now = new Date().toISOString();
  const nextRecords = records.map((record) =>
    record.projectId === projectId &&
    record.branchId === branchId &&
    record.deletedAt === null
      ? {
          ...record,
          branchId: null,
          updatedAt: now,
        }
      : record,
  );

  writeRecords(nextRecords);
  touchProject(projectId, now);
};
