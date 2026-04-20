import type { BranchParkType, RecordBranch } from '../types/branch';
import {
  MAX_BRANCH_DEPTH,
  getBranchDepth,
  getBranchDescendantIds,
  getBranchSubtreeHeight,
} from '../utils/branchTree';

const BRANCHES_STORAGE_KEY = 'journal-agent.record.branches.v1';
const MAX_BRANCH_NAME_LENGTH = 40;
const MAX_BRANCH_DESCRIPTION_LENGTH = 120;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isBranchParkType = (value: unknown): value is BranchParkType =>
  value === 'knowledge' || value === 'lab';

const parseRecordBranch = (value: unknown): RecordBranch | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.id !== 'string' ||
    !isBranchParkType(value.parkType) ||
    typeof value.containerId !== 'string' ||
    (typeof value.parentId !== 'string' && value.parentId !== null) ||
    typeof value.name !== 'string' ||
    typeof value.order !== 'number' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    (typeof value.archivedAt !== 'string' && value.archivedAt !== null) ||
    (typeof value.deletedAt !== 'string' && value.deletedAt !== null)
  ) {
    return null;
  }

  return {
    id: value.id,
    parkType: value.parkType,
    containerId: value.containerId,
    parentId: value.parentId,
    name: value.name,
    description: typeof value.description === 'string' ? value.description : '',
    order: Number.isFinite(value.order) ? value.order : 0,
    archivedAt: value.archivedAt,
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

const readBranches = (): RecordBranch[] =>
  readCollection(BRANCHES_STORAGE_KEY, parseRecordBranch);

const writeBranches = (branches: RecordBranch[]): boolean =>
  writeCollection(BRANCHES_STORAGE_KEY, branches);

const normalizeName = (value: string): string =>
  value.trim().slice(0, MAX_BRANCH_NAME_LENGTH);

const normalizeDescription = (value: string): string =>
  value.trim().slice(0, MAX_BRANCH_DESCRIPTION_LENGTH);

const getActiveContainerBranches = (
  branches: RecordBranch[],
  parkType: BranchParkType,
  containerId: string,
): RecordBranch[] =>
  branches.filter(
    (branch) =>
      branch.deletedAt === null &&
      branch.parkType === parkType &&
      branch.containerId === containerId,
  );

const getNextOrder = (
  branches: RecordBranch[],
  parkType: BranchParkType,
  containerId: string,
  parentId: string | null,
  ignoredIds: Set<string> = new Set<string>(),
): number =>
  branches
    .filter(
      (branch) =>
        branch.deletedAt === null &&
        branch.parkType === parkType &&
        branch.containerId === containerId &&
        branch.parentId === parentId &&
        !ignoredIds.has(branch.id),
    )
    .reduce((maxOrder, branch) => Math.max(maxOrder, branch.order), -1) + 1;

export const getRecordBranches = (options?: {
  parkType?: BranchParkType;
  containerId?: string;
  includeArchived?: boolean;
}): RecordBranch[] =>
  readBranches().filter((branch) => {
    if (branch.deletedAt !== null) {
      return false;
    }

    if (!options?.includeArchived && branch.archivedAt !== null) {
      return false;
    }

    if (options?.parkType && branch.parkType !== options.parkType) {
      return false;
    }

    if (options?.containerId && branch.containerId !== options.containerId) {
      return false;
    }

    return true;
  });

export const createRecordBranch = (fields: {
  parkType: BranchParkType;
  containerId: string;
  parentId?: string | null;
  name: string;
  description?: string;
}): RecordBranch | null => {
  const normalizedName = normalizeName(fields.name);

  if (!normalizedName) {
    return null;
  }

  const parentId = fields.parentId ?? null;
  const branches = readBranches();
  const containerBranches = getActiveContainerBranches(
    branches,
    fields.parkType,
    fields.containerId,
  );
  const parentBranch =
    parentId !== null
      ? containerBranches.find(
          (branch) => branch.id === parentId && branch.archivedAt === null,
        ) ?? null
      : null;

  if (parentId !== null && !parentBranch) {
    return null;
  }

  const nextDepth = parentBranch
    ? getBranchDepth(containerBranches, parentBranch) + 1
    : 1;

  if (nextDepth > MAX_BRANCH_DEPTH) {
    return null;
  }

  const now = new Date().toISOString();
  const branch: RecordBranch = {
    id: createId('record-branch'),
    parkType: fields.parkType,
    containerId: fields.containerId,
    parentId,
    name: normalizedName,
    description: normalizeDescription(fields.description ?? ''),
    order: getNextOrder(branches, fields.parkType, fields.containerId, parentId),
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  return writeBranches([...branches, branch]) ? branch : null;
};

export const updateRecordBranch = (
  id: string,
  fields: Pick<RecordBranch, 'name' | 'description' | 'parentId'>,
): RecordBranch | null => {
  const normalizedName = normalizeName(fields.name);

  if (!normalizedName) {
    return null;
  }

  const branches = readBranches();
  const branchIndex = branches.findIndex(
    (branch) => branch.id === id && branch.deletedAt === null,
  );

  if (branchIndex === -1) {
    return null;
  }

  const branch = branches[branchIndex];
  const containerBranches = getActiveContainerBranches(
    branches,
    branch.parkType,
    branch.containerId,
  );
  const nextParentId = fields.parentId ?? null;

  if (nextParentId === branch.id) {
    return null;
  }

  const descendantIds = new Set(getBranchDescendantIds(containerBranches, branch.id));

  if (nextParentId !== null && descendantIds.has(nextParentId)) {
    return null;
  }

  const parentBranch =
    nextParentId !== null
      ? containerBranches.find(
          (item) =>
            item.id === nextParentId &&
            item.archivedAt === null &&
            item.deletedAt === null,
        ) ?? null
      : null;

  if (nextParentId !== null && !parentBranch) {
    return null;
  }

  const subtreeHeight = getBranchSubtreeHeight(containerBranches, branch.id);
  const nextDepth = parentBranch ? getBranchDepth(containerBranches, parentBranch) + 1 : 1;

  if (nextDepth + subtreeHeight - 1 > MAX_BRANCH_DEPTH) {
    return null;
  }

  const now = new Date().toISOString();
  const parentChanged = nextParentId !== branch.parentId;
  const updatedBranch: RecordBranch = {
    ...branch,
    name: normalizedName,
    description: normalizeDescription(fields.description),
    parentId: nextParentId,
    order: parentChanged
      ? getNextOrder(
          branches,
          branch.parkType,
          branch.containerId,
          nextParentId,
          new Set<string>([branch.id]),
        )
      : branch.order,
    updatedAt: now,
  };
  const nextBranches = [...branches];
  nextBranches[branchIndex] = updatedBranch;

  return writeBranches(nextBranches) ? updatedBranch : null;
};

export const archiveRecordBranch = (id: string): RecordBranch | null => {
  const branches = readBranches();
  const branch = branches.find(
    (item) => item.id === id && item.deletedAt === null,
  );

  if (!branch) {
    return null;
  }

  const containerBranches = getActiveContainerBranches(
    branches,
    branch.parkType,
    branch.containerId,
  );
  const subtreeIds = new Set<string>([
    branch.id,
    ...getBranchDescendantIds(containerBranches, branch.id),
  ]);
  const now = new Date().toISOString();
  const nextBranches = branches.map((item) =>
    subtreeIds.has(item.id) && item.deletedAt === null
      ? {
          ...item,
          archivedAt: now,
          updatedAt: now,
        }
      : item,
  );

  return writeBranches(nextBranches)
    ? (nextBranches.find((item) => item.id === id) ?? null)
    : null;
};

export const unarchiveRecordBranch = (id: string): RecordBranch | null => {
  const branches = readBranches();
  const branch = branches.find(
    (item) => item.id === id && item.deletedAt === null,
  );

  if (!branch) {
    return null;
  }

  const containerBranches = getActiveContainerBranches(
    branches,
    branch.parkType,
    branch.containerId,
  );
  const subtreeIds = new Set<string>([
    branch.id,
    ...getBranchDescendantIds(containerBranches, branch.id),
  ]);
  const parentStillAvailable =
    branch.parentId === null ||
    containerBranches.some(
      (item) =>
        item.id === branch.parentId &&
        item.archivedAt === null &&
        item.deletedAt === null &&
        !subtreeIds.has(item.id),
    );
  const now = new Date().toISOString();
  const nextBranches = [...branches];
  const branchIndex = nextBranches.findIndex((item) => item.id === id);

  if (branchIndex === -1) {
    return null;
  }

  for (let index = 0; index < nextBranches.length; index += 1) {
    if (!subtreeIds.has(nextBranches[index].id) || nextBranches[index].deletedAt !== null) {
      continue;
    }

    nextBranches[index] = {
      ...nextBranches[index],
      archivedAt: null,
      parentId:
        nextBranches[index].id === id && !parentStillAvailable
          ? null
          : nextBranches[index].parentId,
      order:
        nextBranches[index].id === id && !parentStillAvailable
          ? getNextOrder(
              branches,
              branch.parkType,
              branch.containerId,
              null,
              new Set<string>(subtreeIds),
            )
          : nextBranches[index].order,
      updatedAt: now,
    };
  }

  return writeBranches(nextBranches)
    ? (nextBranches.find((item) => item.id === id) ?? null)
    : null;
};

export const deleteRecordBranch = (id: string): RecordBranch | null => {
  const branches = readBranches();
  const branchIndex = branches.findIndex(
    (branch) => branch.id === id && branch.deletedAt === null,
  );

  if (branchIndex === -1) {
    return null;
  }

  const branch = branches[branchIndex];
  const containerBranches = getActiveContainerBranches(
    branches,
    branch.parkType,
    branch.containerId,
  );
  const directChildren = containerBranches.filter(
    (item) => item.parentId === branch.id,
  );
  const ignoredIds = new Set<string>([branch.id, ...directChildren.map((item) => item.id)]);
  let nextOrder = getNextOrder(
    branches,
    branch.parkType,
    branch.containerId,
    branch.parentId,
    ignoredIds,
  );
  const now = new Date().toISOString();
  const nextBranches = [...branches];

  for (let index = 0; index < nextBranches.length; index += 1) {
    const currentBranch = nextBranches[index];

    if (currentBranch.id === branch.id) {
      nextBranches[index] = {
        ...currentBranch,
        deletedAt: now,
        updatedAt: now,
      };
      continue;
    }

    if (currentBranch.deletedAt !== null || currentBranch.parentId !== branch.id) {
      continue;
    }

    nextBranches[index] = {
      ...currentBranch,
      parentId: branch.parentId,
      order: nextOrder,
      updatedAt: now,
    };
    nextOrder += 1;
  }

  return writeBranches(nextBranches) ? branch : null;
};

export const deleteBranchesForContainer = (
  parkType: BranchParkType,
  containerId: string,
): void => {
  const now = new Date().toISOString();
  const branches = readBranches();
  const nextBranches = branches.map((branch) =>
    branch.parkType === parkType &&
    branch.containerId === containerId &&
    branch.deletedAt === null
      ? {
          ...branch,
          deletedAt: now,
          updatedAt: now,
        }
      : branch,
  );

  writeBranches(nextBranches);
};
