import type { RecordBranch } from '../types/branch';

export const MAX_BRANCH_DEPTH = 4;

const sortWithinParent = (branches: RecordBranch[]): RecordBranch[] =>
  [...branches].sort((firstBranch, secondBranch) => {
    if (firstBranch.order !== secondBranch.order) {
      return firstBranch.order - secondBranch.order;
    }

    return (
      new Date(secondBranch.updatedAt).getTime() -
      new Date(firstBranch.updatedAt).getTime()
    );
  });

export const getBranchChildren = (
  branches: RecordBranch[],
  parentId: string | null,
): RecordBranch[] =>
  sortWithinParent(
    branches.filter((branch) => branch.parentId === parentId),
  );

export const flattenBranchTree = (
  branches: RecordBranch[],
  parentId: string | null = null,
  depth = 1,
): Array<{ branch: RecordBranch; depth: number }> => {
  const items: Array<{ branch: RecordBranch; depth: number }> = [];

  for (const branch of getBranchChildren(branches, parentId)) {
    items.push({ branch, depth });
    items.push(...flattenBranchTree(branches, branch.id, depth + 1));
  }

  return items;
};

export const getBranchDepth = (
  branches: RecordBranch[],
  branchOrId: RecordBranch | string | null,
): number => {
  if (!branchOrId) {
    return 0;
  }

  const branch =
    typeof branchOrId === 'string'
      ? branches.find((item) => item.id === branchOrId) ?? null
      : branchOrId;

  if (!branch) {
    return 0;
  }

  let depth = 1;
  let currentParentId = branch.parentId;
  const visitedIds = new Set<string>([branch.id]);

  while (currentParentId) {
    const parentBranch =
      branches.find((item) => item.id === currentParentId) ?? null;

    if (!parentBranch || visitedIds.has(parentBranch.id)) {
      break;
    }

    visitedIds.add(parentBranch.id);
    depth += 1;
    currentParentId = parentBranch.parentId;
  }

  return depth;
};

export const getBranchDescendantIds = (
  branches: RecordBranch[],
  branchId: string,
): string[] => {
  const descendantIds: string[] = [];
  const stack = [branchId];

  while (stack.length > 0) {
    const currentId = stack.pop();

    if (!currentId) {
      continue;
    }

    for (const childBranch of getBranchChildren(branches, currentId)) {
      descendantIds.push(childBranch.id);
      stack.push(childBranch.id);
    }
  }

  return descendantIds;
};

export const getBranchSubtreeHeight = (
  branches: RecordBranch[],
  branchId: string,
): number => {
  const childBranches = getBranchChildren(branches, branchId);

  if (childBranches.length === 0) {
    return 1;
  }

  return (
    1 +
    Math.max(
      ...childBranches.map((childBranch) =>
        getBranchSubtreeHeight(branches, childBranch.id),
      ),
    )
  );
};

export const getBranchPath = (
  branches: RecordBranch[],
  branchId: string | null,
): string[] => {
  if (!branchId) {
    return [];
  }

  const branchMap = new Map(branches.map((branch) => [branch.id, branch]));
  const path: string[] = [];
  let currentBranch = branchMap.get(branchId) ?? null;
  const visitedIds = new Set<string>();

  while (currentBranch && !visitedIds.has(currentBranch.id)) {
    visitedIds.add(currentBranch.id);
    path.unshift(currentBranch.name);
    currentBranch = currentBranch.parentId
      ? branchMap.get(currentBranch.parentId) ?? null
      : null;
  }

  return path;
};

export const getBranchPathLabel = (
  branches: RecordBranch[],
  branchId: string | null,
): string => {
  const path = getBranchPath(branches, branchId);

  return path.length > 0 ? path.join(' / ') : '未分组';
};
