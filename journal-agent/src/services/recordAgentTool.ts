import type { JournalEntry } from '../types/journal';
import type { RecordBranch } from '../types/branch';
import type { KnowledgeBase, KnowledgeNote } from '../types/knowledge';
import type { LabProject, LabRecord, LabRecordType } from '../types/lab';
import { createEntry, getEntries, updateEntry } from '../storage/journalStore';
import { getRecordBranches } from '../storage/branchStore';
import {
  createKnowledgeNote,
  getKnowledgeBases,
  getKnowledgeNotes,
  updateKnowledgeNote,
} from '../storage/knowledgeStore';
import {
  createLabRecord,
  getLabProjects,
  getLabRecords,
  updateLabRecord,
} from '../storage/labStore';
import { getBranchPathLabel } from '../utils/branchTree';

const MAX_JOURNAL_ENTRIES = 12;
const MAX_KNOWLEDGE_BASES = 12;
const MAX_KNOWLEDGE_NOTES = 20;
const MAX_LAB_PROJECTS = 12;
const MAX_LAB_RECORDS = 20;
const MAX_BRANCHES_PER_SCOPE = 20;
const MAX_CONTENT_PREVIEW_LENGTH = 220;

type AgentWritableToolName =
  | 'journal.entry.create'
  | 'journal.entry.update'
  | 'knowledge.note.create'
  | 'knowledge.note.update'
  | 'lab.record.create'
  | 'lab.record.update';
type RecordContentMode = 'keep' | 'replace' | 'append' | 'prepend';
export type RecordAgentMutationKind =
  | 'journal-entry'
  | 'knowledge-note'
  | 'lab-record';

interface ParsedToolCall {
  name: AgentWritableToolName;
  rawBlock: string;
  rawArgs: string;
}

interface JournalCreateArgs {
  title?: string;
  content: string;
}

interface JournalUpdateArgs {
  entryId: string;
  title?: string;
  contentMode?: RecordContentMode;
  content?: string;
}

interface KnowledgeCreateArgs {
  baseId: string;
  branchId?: string | null;
  title?: string;
  content: string;
  sourceUrl?: string;
  tags?: string[];
}

interface KnowledgeUpdateArgs {
  noteId: string;
  branchId?: string | null;
  title?: string;
  contentMode?: RecordContentMode;
  content?: string;
  sourceUrl?: string;
  clearSourceUrl?: boolean;
  tags?: string[];
}

interface LabCreateArgs {
  projectId: string;
  branchId?: string | null;
  title?: string;
  content: string;
  type: LabRecordType;
  tags?: string[];
}

interface LabUpdateArgs {
  recordId: string;
  branchId?: string | null;
  title?: string;
  contentMode?: RecordContentMode;
  content?: string;
  type?: LabRecordType;
  tags?: string[];
}

interface ToolExecutionResult {
  resultMessage: string;
  mutationKind: RecordAgentMutationKind | null;
  mutatedJournalEntryId: string | null;
  mutatedKnowledgeBaseId: string | null;
  mutatedKnowledgeNoteId: string | null;
  mutatedLabProjectId: string | null;
  mutatedLabRecordId: string | null;
}

export interface RecordAgentContextOptions {
  activeJournalEntryId?: string | null;
  activeKnowledgeBaseId?: string | null;
  activeKnowledgeBranchFilterId?: 'all' | 'ungrouped' | string | null;
  selectedKnowledgeNoteId?: string | null;
  activeLabProjectId?: string | null;
  activeLabBranchFilterId?: 'all' | 'ungrouped' | string | null;
  selectedLabRecordId?: string | null;
}

export interface RecordAgentContextToolResult {
  totalJournalEntries: number;
  totalKnowledgeBases: number;
  totalKnowledgeNotes: number;
  totalLabProjects: number;
  totalLabRecords: number;
  statusLabel: string;
  toolMessage: string;
}

export interface RecordAgentToolRunResult {
  toolResultMessage: string;
  mutationKind: RecordAgentMutationKind | null;
  mutatedJournalEntryId: string | null;
  mutatedKnowledgeBaseId: string | null;
  mutatedKnowledgeNoteId: string | null;
  mutatedLabProjectId: string | null;
  mutatedLabRecordId: string | null;
  toolCallCount: number;
}

const LAB_RECORD_TYPE_LABELS: Record<LabRecordType, string> = {
  operation: '操作',
  review: '复盘',
};

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

const formatDateTime = (value: string): string => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

const truncateText = (value: string, maxLength: number): string => {
  const normalizedValue = value.trim().replace(/\s+/g, ' ');

  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, maxLength)}...`;
};

const sortByUpdatedAtDesc = <T extends { updatedAt: string }>(items: T[]): T[] =>
  [...items].sort(
    (firstItem, secondItem) =>
      new Date(secondItem.updatedAt).getTime() -
      new Date(firstItem.updatedAt).getTime(),
  );

const buildSelectedItemLabel = <T extends { id: string; name?: string; title?: string }>(
  items: T[],
  selectedId: string | null | undefined,
  emptyLabel: string,
  missingLabel: string,
  prefix: string,
): string => {
  if (!selectedId) {
    return emptyLabel;
  }

  const activeItem = items.find((item) => item.id === selectedId);

  if (!activeItem) {
    return missingLabel;
  }

  return `${prefix}: ${(activeItem.name ?? activeItem.title) || '未命名'} (${activeItem.id})`;
};

const parseJsonObject = (value: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const parseContentMode = (value: unknown): RecordContentMode | null => {
  if (
    value === 'keep' ||
    value === 'replace' ||
    value === 'append' ||
    value === 'prepend'
  ) {
    return value;
  }

  return null;
};

const parseBranchId = (value: unknown): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return typeof value === 'string' ? value : undefined;
};

const parseJournalCreateArgs = (rawArgs: string): JournalCreateArgs | null => {
  const parsed = parseJsonObject(rawArgs);

  if (!parsed || typeof parsed.content !== 'string') {
    return null;
  }

  if (parsed.title !== undefined && typeof parsed.title !== 'string') {
    return null;
  }

  return {
    title: typeof parsed.title === 'string' ? parsed.title : undefined,
    content: parsed.content,
  };
};

const parseJournalUpdateArgs = (rawArgs: string): JournalUpdateArgs | null => {
  const parsed = parseJsonObject(rawArgs);

  if (!parsed || typeof parsed.entryId !== 'string') {
    return null;
  }

  if (parsed.title !== undefined && typeof parsed.title !== 'string') {
    return null;
  }

  if (parsed.content !== undefined && typeof parsed.content !== 'string') {
    return null;
  }

  return {
    entryId: parsed.entryId,
    title: typeof parsed.title === 'string' ? parsed.title : undefined,
    contentMode:
      parseContentMode(parsed.contentMode) ??
      (typeof parsed.content === 'string' ? 'replace' : 'keep'),
    content: typeof parsed.content === 'string' ? parsed.content : undefined,
  };
};

const parseKnowledgeCreateArgs = (rawArgs: string): KnowledgeCreateArgs | null => {
  const parsed = parseJsonObject(rawArgs);

  if (
    !parsed ||
    typeof parsed.baseId !== 'string' ||
    typeof parsed.content !== 'string'
  ) {
    return null;
  }

  if (parsed.title !== undefined && typeof parsed.title !== 'string') {
    return null;
  }

  if (parsed.sourceUrl !== undefined && typeof parsed.sourceUrl !== 'string') {
    return null;
  }

  if (parsed.tags !== undefined && !isStringArray(parsed.tags)) {
    return null;
  }

  const branchId = parseBranchId(parsed.branchId);

  if (parsed.branchId !== undefined && branchId === undefined) {
    return null;
  }

  return {
    baseId: parsed.baseId,
    branchId,
    title: typeof parsed.title === 'string' ? parsed.title : undefined,
    content: parsed.content,
    sourceUrl: typeof parsed.sourceUrl === 'string' ? parsed.sourceUrl : undefined,
    tags: isStringArray(parsed.tags) ? parsed.tags : undefined,
  };
};

const parseKnowledgeUpdateArgs = (rawArgs: string): KnowledgeUpdateArgs | null => {
  const parsed = parseJsonObject(rawArgs);

  if (!parsed || typeof parsed.noteId !== 'string') {
    return null;
  }

  if (parsed.title !== undefined && typeof parsed.title !== 'string') {
    return null;
  }

  if (parsed.content !== undefined && typeof parsed.content !== 'string') {
    return null;
  }

  if (parsed.sourceUrl !== undefined && typeof parsed.sourceUrl !== 'string') {
    return null;
  }

  if (
    parsed.clearSourceUrl !== undefined &&
    typeof parsed.clearSourceUrl !== 'boolean'
  ) {
    return null;
  }

  if (parsed.tags !== undefined && !isStringArray(parsed.tags)) {
    return null;
  }

  const branchId = parseBranchId(parsed.branchId);

  if (parsed.branchId !== undefined && branchId === undefined) {
    return null;
  }

  return {
    noteId: parsed.noteId,
    branchId,
    title: typeof parsed.title === 'string' ? parsed.title : undefined,
    contentMode:
      parseContentMode(parsed.contentMode) ??
      (typeof parsed.content === 'string' ? 'replace' : 'keep'),
    content: typeof parsed.content === 'string' ? parsed.content : undefined,
    sourceUrl: typeof parsed.sourceUrl === 'string' ? parsed.sourceUrl : undefined,
    clearSourceUrl: parsed.clearSourceUrl === true,
    tags: isStringArray(parsed.tags) ? parsed.tags : undefined,
  };
};

const parseLabCreateArgs = (rawArgs: string): LabCreateArgs | null => {
  const parsed = parseJsonObject(rawArgs);

  if (
    !parsed ||
    typeof parsed.projectId !== 'string' ||
    typeof parsed.content !== 'string' ||
    !isLabRecordType(parsed.type)
  ) {
    return null;
  }

  if (parsed.title !== undefined && typeof parsed.title !== 'string') {
    return null;
  }

  if (parsed.tags !== undefined && !isStringArray(parsed.tags)) {
    return null;
  }

  const branchId = parseBranchId(parsed.branchId);

  if (parsed.branchId !== undefined && branchId === undefined) {
    return null;
  }

  return {
    projectId: parsed.projectId,
    branchId,
    title: typeof parsed.title === 'string' ? parsed.title : undefined,
    content: parsed.content,
    type: parsed.type,
    tags: isStringArray(parsed.tags) ? parsed.tags : undefined,
  };
};

const parseLabUpdateArgs = (rawArgs: string): LabUpdateArgs | null => {
  const parsed = parseJsonObject(rawArgs);

  if (!parsed || typeof parsed.recordId !== 'string') {
    return null;
  }

  if (parsed.title !== undefined && typeof parsed.title !== 'string') {
    return null;
  }

  if (parsed.content !== undefined && typeof parsed.content !== 'string') {
    return null;
  }

  if (parsed.type !== undefined && !isLabRecordType(parsed.type)) {
    return null;
  }

  if (parsed.tags !== undefined && !isStringArray(parsed.tags)) {
    return null;
  }

  const branchId = parseBranchId(parsed.branchId);

  if (parsed.branchId !== undefined && branchId === undefined) {
    return null;
  }

  return {
    recordId: parsed.recordId,
    branchId,
    title: typeof parsed.title === 'string' ? parsed.title : undefined,
    contentMode:
      parseContentMode(parsed.contentMode) ??
      (typeof parsed.content === 'string' ? 'replace' : 'keep'),
    content: typeof parsed.content === 'string' ? parsed.content : undefined,
    type: isLabRecordType(parsed.type) ? parsed.type : undefined,
    tags: isStringArray(parsed.tags) ? parsed.tags : undefined,
  };
};

const parseRecordToolCalls = (content: string): ParsedToolCall[] => {
  const toolCalls: ParsedToolCall[] = [];
  const pattern =
    /\[tool_call:\s*(journal\.entry\.(?:create|update)|knowledge\.note\.(?:create|update)|lab\.record\.(?:create|update))\]\s*([\s\S]*?)\[\/tool_call\]/g;
  let match: RegExpExecArray | null = pattern.exec(content);

  while (match) {
    const rawName = match[1];
    const rawArgs = match[2]?.trim() ?? '';

    if (
      rawName === 'journal.entry.create' ||
      rawName === 'journal.entry.update' ||
      rawName === 'knowledge.note.create' ||
      rawName === 'knowledge.note.update' ||
      rawName === 'lab.record.create' ||
      rawName === 'lab.record.update'
    ) {
      toolCalls.push({
        name: rawName,
        rawBlock: match[0],
        rawArgs,
      });
    }

    match = pattern.exec(content);
  }

  return toolCalls;
};

const buildToolResultMessage = (
  name: AgentWritableToolName,
  status: 'success' | 'error',
  messageLines: string[],
): string =>
  [
    `[tool_result: ${name}]`,
    `status: ${status}`,
    ...messageLines,
    '[/tool_result]',
  ].join('\n');

const applyContentMode = (
  previousContent: string,
  contentMode: RecordContentMode,
  nextContentInput: string | undefined,
): string | null => {
  if (contentMode === 'keep') {
    return previousContent;
  }

  const normalizedInput = nextContentInput?.trim() ?? '';

  if (!normalizedInput) {
    return null;
  }

  if (contentMode === 'replace') {
    return normalizedInput;
  }

  if (contentMode === 'append') {
    return `${previousContent.trim()}\n\n${normalizedInput}`.trim();
  }

  return `${normalizedInput}\n\n${previousContent.trim()}`.trim();
};

const emptyExecutionResult = (resultMessage: string): ToolExecutionResult => ({
  resultMessage,
  mutationKind: null,
  mutatedJournalEntryId: null,
  mutatedKnowledgeBaseId: null,
  mutatedKnowledgeNoteId: null,
  mutatedLabProjectId: null,
  mutatedLabRecordId: null,
});

const getScopedBranches = (
  parkType: 'knowledge' | 'lab',
  containerId: string,
): RecordBranch[] =>
  getRecordBranches({
    parkType,
    containerId,
    includeArchived: true,
  });

const buildBranchSummary = (
  parkType: 'knowledge' | 'lab',
  containerId: string,
  branchId: string | null,
): string =>
  branchId
    ? (() => {
        const branches = getScopedBranches(parkType, containerId);
        const branch = branches.find((item) => item.id === branchId) ?? null;

        if (!branch) {
          return `branchId: ${branchId}`;
        }

        return `branch: ${getBranchPathLabel(branches, branch.id)} (${branch.id})`;
      })()
    : 'branch: 未分组';

const describeBranchFilter = (
  branches: RecordBranch[],
  filterId: 'all' | 'ungrouped' | string | null | undefined,
): string => {
  if (!filterId || filterId === 'all') {
    return '全部';
  }

  if (filterId === 'ungrouped') {
    return '未分组';
  }

  return getBranchPathLabel(branches, filterId);
};

const executeJournalCreateTool = (args: JournalCreateArgs): ToolExecutionResult => {
  const entry = createEntry(args.content, args.title ?? '');

  if (!entry) {
    return emptyExecutionResult(
      buildToolResultMessage('journal.entry.create', 'error', [
        'message: 心记创建失败，可能是正文为空或本地存储写入失败。',
      ]),
    );
  }

  return {
    resultMessage: buildToolResultMessage('journal.entry.create', 'success', [
      `entryId: ${entry.id}`,
      `title: ${entry.title}`,
      'message: 已成功新增心记日志。',
    ]),
    mutationKind: 'journal-entry',
    mutatedJournalEntryId: entry.id,
    mutatedKnowledgeBaseId: null,
    mutatedKnowledgeNoteId: null,
    mutatedLabProjectId: null,
    mutatedLabRecordId: null,
  };
};

const executeJournalUpdateTool = (args: JournalUpdateArgs): ToolExecutionResult => {
  const entries = getEntries();
  const entry = entries.find((item) => item.id === args.entryId);

  if (!entry) {
    return emptyExecutionResult(
      buildToolResultMessage('journal.entry.update', 'error', [
        `message: 未找到 id 为 ${args.entryId} 的心记日志，不能编辑。`,
      ]),
    );
  }

  const nextContent = applyContentMode(
    entry.content,
    args.contentMode ?? 'replace',
    args.content,
  );

  if (!nextContent) {
    return emptyExecutionResult(
      buildToolResultMessage('journal.entry.update', 'error', [
        'message: 编辑心记时需要有效正文；当前参数无法生成新的正文内容。',
      ]),
    );
  }

  const updatedEntry = updateEntry(entry.id, {
    title: args.title,
    content: nextContent,
  });

  if (!updatedEntry) {
    return emptyExecutionResult(
      buildToolResultMessage('journal.entry.update', 'error', [
        'message: 心记更新失败，可能是正文为空或本地存储写入失败。',
      ]),
    );
  }

  return {
    resultMessage: buildToolResultMessage('journal.entry.update', 'success', [
      `entryId: ${updatedEntry.id}`,
      `title: ${updatedEntry.title}`,
      `contentMode: ${args.contentMode ?? 'replace'}`,
      'message: 已成功更新心记日志。',
    ]),
    mutationKind: 'journal-entry',
    mutatedJournalEntryId: updatedEntry.id,
    mutatedKnowledgeBaseId: null,
    mutatedKnowledgeNoteId: null,
    mutatedLabProjectId: null,
    mutatedLabRecordId: null,
  };
};

const executeKnowledgeCreateTool = (args: KnowledgeCreateArgs): ToolExecutionResult => {
  const bases = getKnowledgeBases();
  const targetBase = bases.find((base) => base.id === args.baseId);

  if (!targetBase) {
    return emptyExecutionResult(
      buildToolResultMessage('knowledge.note.create', 'error', [
        `message: 未找到 id 为 ${args.baseId} 的知识库，不能新增笔记。`,
      ]),
    );
  }

  const note = createKnowledgeNote(args.baseId, {
    branchId: args.branchId ?? null,
    title: args.title ?? '',
    content: args.content,
    sourceUrl: args.sourceUrl ?? '',
    tags: normalizeTags(args.tags ?? []),
  });

  if (!note) {
    return emptyExecutionResult(
      buildToolResultMessage('knowledge.note.create', 'error', [
        'message: 笔记创建失败，可能是正文为空或本地存储写入失败。',
      ]),
    );
  }

  return {
    resultMessage: buildToolResultMessage('knowledge.note.create', 'success', [
      `baseId: ${targetBase.id}`,
      `baseName: ${targetBase.name}`,
      buildBranchSummary('knowledge', targetBase.id, note.branchId),
      `noteId: ${note.id}`,
      `title: ${note.title}`,
      'message: 已成功新增知识笔记。',
    ]),
    mutationKind: 'knowledge-note',
    mutatedJournalEntryId: null,
    mutatedKnowledgeBaseId: targetBase.id,
    mutatedKnowledgeNoteId: note.id,
    mutatedLabProjectId: null,
    mutatedLabRecordId: null,
  };
};

const executeKnowledgeUpdateTool = (args: KnowledgeUpdateArgs): ToolExecutionResult => {
  const notes = getKnowledgeNotes();
  const note = notes.find((item) => item.id === args.noteId);

  if (!note) {
    return emptyExecutionResult(
      buildToolResultMessage('knowledge.note.update', 'error', [
        `message: 未找到 id 为 ${args.noteId} 的知识笔记，不能编辑。`,
      ]),
    );
  }

  const nextContent = applyContentMode(
    note.content,
    args.contentMode ?? 'replace',
    args.content,
  );

  if (!nextContent) {
    return emptyExecutionResult(
      buildToolResultMessage('knowledge.note.update', 'error', [
        'message: 编辑笔记时需要有效正文；当前参数无法生成新的正文内容。',
      ]),
    );
  }

  const updatedNote = updateKnowledgeNote(note.id, {
    branchId: args.branchId ?? note.branchId,
    title: args.title ?? note.title,
    content: nextContent,
    sourceUrl: args.clearSourceUrl ? '' : args.sourceUrl ?? note.sourceUrl,
    tags: args.tags ? normalizeTags(args.tags) : note.tags,
  });

  if (!updatedNote) {
    return emptyExecutionResult(
      buildToolResultMessage('knowledge.note.update', 'error', [
        'message: 笔记更新失败，可能是正文为空或本地存储写入失败。',
      ]),
    );
  }

  const bases = getKnowledgeBases();
  const targetBase = bases.find((base) => base.id === updatedNote.baseId);

  return {
    resultMessage: buildToolResultMessage('knowledge.note.update', 'success', [
      `baseId: ${updatedNote.baseId}`,
      `baseName: ${targetBase?.name ?? '未知知识库'}`,
      buildBranchSummary('knowledge', updatedNote.baseId, updatedNote.branchId),
      `noteId: ${updatedNote.id}`,
      `title: ${updatedNote.title}`,
      `contentMode: ${args.contentMode ?? 'replace'}`,
      'message: 已成功更新知识笔记。',
    ]),
    mutationKind: 'knowledge-note',
    mutatedJournalEntryId: null,
    mutatedKnowledgeBaseId: updatedNote.baseId,
    mutatedKnowledgeNoteId: updatedNote.id,
    mutatedLabProjectId: null,
    mutatedLabRecordId: null,
  };
};

const executeLabCreateTool = (args: LabCreateArgs): ToolExecutionResult => {
  const projects = getLabProjects();
  const targetProject = projects.find((project) => project.id === args.projectId);

  if (!targetProject) {
    return emptyExecutionResult(
      buildToolResultMessage('lab.record.create', 'error', [
        `message: 未找到 id 为 ${args.projectId} 的做记项目，不能新增记录。`,
      ]),
    );
  }

  const record = createLabRecord(args.projectId, {
    branchId: args.branchId ?? null,
    title: args.title ?? '',
    content: args.content,
    type: args.type,
    tags: normalizeTags(args.tags ?? []),
  });

  if (!record) {
    return emptyExecutionResult(
      buildToolResultMessage('lab.record.create', 'error', [
        'message: 做记记录创建失败，可能是正文为空、类型无效或本地存储写入失败。',
      ]),
    );
  }

  return {
    resultMessage: buildToolResultMessage('lab.record.create', 'success', [
      `projectId: ${targetProject.id}`,
      `projectName: ${targetProject.name}`,
      buildBranchSummary('lab', targetProject.id, record.branchId),
      `recordId: ${record.id}`,
      `title: ${record.title}`,
      `type: ${LAB_RECORD_TYPE_LABELS[record.type]}`,
      'message: 已成功新增做记记录。',
    ]),
    mutationKind: 'lab-record',
    mutatedJournalEntryId: null,
    mutatedKnowledgeBaseId: null,
    mutatedKnowledgeNoteId: null,
    mutatedLabProjectId: targetProject.id,
    mutatedLabRecordId: record.id,
  };
};

const executeLabUpdateTool = (args: LabUpdateArgs): ToolExecutionResult => {
  const records = getLabRecords();
  const record = records.find((item) => item.id === args.recordId);

  if (!record) {
    return emptyExecutionResult(
      buildToolResultMessage('lab.record.update', 'error', [
        `message: 未找到 id 为 ${args.recordId} 的做记记录，不能编辑。`,
      ]),
    );
  }

  const nextContent = applyContentMode(
    record.content,
    args.contentMode ?? 'replace',
    args.content,
  );

  if (!nextContent) {
    return emptyExecutionResult(
      buildToolResultMessage('lab.record.update', 'error', [
        'message: 编辑做记记录时需要有效正文；当前参数无法生成新的正文内容。',
      ]),
    );
  }

  const updatedRecord = updateLabRecord(record.id, {
    branchId: args.branchId ?? record.branchId,
    title: args.title ?? record.title,
    content: nextContent,
    type: args.type ?? record.type,
    tags: args.tags ? normalizeTags(args.tags) : record.tags,
  });

  if (!updatedRecord) {
    return emptyExecutionResult(
      buildToolResultMessage('lab.record.update', 'error', [
        'message: 做记记录更新失败，可能是正文为空、类型无效或本地存储写入失败。',
      ]),
    );
  }

  const projects = getLabProjects();
  const targetProject = projects.find((project) => project.id === updatedRecord.projectId);

  return {
    resultMessage: buildToolResultMessage('lab.record.update', 'success', [
      `projectId: ${updatedRecord.projectId}`,
      `projectName: ${targetProject?.name ?? '未知项目'}`,
      buildBranchSummary('lab', updatedRecord.projectId, updatedRecord.branchId),
      `recordId: ${updatedRecord.id}`,
      `title: ${updatedRecord.title}`,
      `type: ${LAB_RECORD_TYPE_LABELS[updatedRecord.type]}`,
      `contentMode: ${args.contentMode ?? 'replace'}`,
      'message: 已成功更新做记记录。',
    ]),
    mutationKind: 'lab-record',
    mutatedJournalEntryId: null,
    mutatedKnowledgeBaseId: null,
    mutatedKnowledgeNoteId: null,
    mutatedLabProjectId: updatedRecord.projectId,
    mutatedLabRecordId: updatedRecord.id,
  };
};

const serializeJournalEntryPreview = (entry: JournalEntry, index: number): string =>
  [
    `### 心记目录 ${index + 1}`,
    `id: ${entry.id}`,
    `title: ${entry.title || '无标题'}`,
    `createdAt: ${formatDateTime(entry.createdAt)}`,
    `updatedAt: ${formatDateTime(entry.updatedAt)}`,
    `contentPreview: ${truncateText(entry.content, MAX_CONTENT_PREVIEW_LENGTH)}`,
  ].join('\n');

const serializeSelectedJournalEntry = (entry: JournalEntry): string =>
  [
    '### 当前选中的心记',
    `id: ${entry.id}`,
    `title: ${entry.title || '无标题'}`,
    `createdAt: ${formatDateTime(entry.createdAt)}`,
    `updatedAt: ${formatDateTime(entry.updatedAt)}`,
    `content: ${entry.content}`,
  ].join('\n');

const serializeKnowledgeBase = (base: KnowledgeBase, index: number): string =>
  [
    `### 知识库 ${index + 1}`,
    `id: ${base.id}`,
    `name: ${base.name}`,
    `updatedAt: ${formatDateTime(base.updatedAt)}`,
    `tags: ${base.tags.length > 0 ? base.tags.join(', ') : '无'}`,
    `description: ${base.description || '无'}`,
  ].join('\n');

const serializeBranch = (
  branch: RecordBranch,
  branches: RecordBranch[],
  index: number,
): string =>
  [
    `### 分支 ${index + 1}`,
    `id: ${branch.id}`,
    `name: ${branch.name}`,
    `path: ${getBranchPathLabel(branches, branch.id)}`,
    `depth: ${getBranchPathLabel(branches, branch.id).split(' / ').length}`,
    `archived: ${branch.archivedAt ? '是' : '否'}`,
    `updatedAt: ${formatDateTime(branch.updatedAt)}`,
  ].join('\n');

const serializeKnowledgeNotePreview = (
  note: KnowledgeNote,
  baseName: string,
  branchLabel: string,
  index: number,
): string =>
  [
    `### 笔记目录 ${index + 1}`,
    `id: ${note.id}`,
    `baseId: ${note.baseId}`,
    `baseName: ${baseName}`,
    `branch: ${branchLabel}`,
    `title: ${note.title}`,
    `updatedAt: ${formatDateTime(note.updatedAt)}`,
    `sourceUrl: ${note.sourceUrl || '无'}`,
    `tags: ${note.tags.length > 0 ? note.tags.join(', ') : '无'}`,
    `contentPreview: ${truncateText(note.content, MAX_CONTENT_PREVIEW_LENGTH)}`,
  ].join('\n');

const serializeSelectedKnowledgeNote = (
  note: KnowledgeNote,
  baseName: string,
  branchLabel: string,
): string =>
  [
    '### 当前选中的笔记',
    `id: ${note.id}`,
    `baseId: ${note.baseId}`,
    `baseName: ${baseName}`,
    `branch: ${branchLabel}`,
    `title: ${note.title}`,
    `updatedAt: ${formatDateTime(note.updatedAt)}`,
    `sourceUrl: ${note.sourceUrl || '无'}`,
    `tags: ${note.tags.length > 0 ? note.tags.join(', ') : '无'}`,
    `content: ${note.content}`,
  ].join('\n');

const serializeLabProject = (project: LabProject, index: number): string =>
  [
    `### 做记项目 ${index + 1}`,
    `id: ${project.id}`,
    `name: ${project.name}`,
    `updatedAt: ${formatDateTime(project.updatedAt)}`,
    `tags: ${project.tags.length > 0 ? project.tags.join(', ') : '无'}`,
    `description: ${project.description || '无'}`,
  ].join('\n');

const serializeLabRecordPreview = (
  record: LabRecord,
  projectName: string,
  branchLabel: string,
  index: number,
): string =>
  [
    `### 做记目录 ${index + 1}`,
    `id: ${record.id}`,
    `projectId: ${record.projectId}`,
    `projectName: ${projectName}`,
    `branch: ${branchLabel}`,
    `title: ${record.title}`,
    `type: ${LAB_RECORD_TYPE_LABELS[record.type]}`,
    `updatedAt: ${formatDateTime(record.updatedAt)}`,
    `tags: ${record.tags.length > 0 ? record.tags.join(', ') : '无'}`,
    `contentPreview: ${truncateText(record.content, MAX_CONTENT_PREVIEW_LENGTH)}`,
  ].join('\n');

const serializeSelectedLabRecord = (
  record: LabRecord,
  projectName: string,
  branchLabel: string,
): string =>
  [
    '### 当前选中的做记记录',
    `id: ${record.id}`,
    `projectId: ${record.projectId}`,
    `projectName: ${projectName}`,
    `branch: ${branchLabel}`,
    `title: ${record.title}`,
    `type: ${LAB_RECORD_TYPE_LABELS[record.type]}`,
    `updatedAt: ${formatDateTime(record.updatedAt)}`,
    `tags: ${record.tags.length > 0 ? record.tags.join(', ') : '无'}`,
    `content: ${record.content}`,
  ].join('\n');

export const buildRecordAgentContextTool = (
  entries: JournalEntry[],
  knowledgeBases: KnowledgeBase[],
  knowledgeNotes: KnowledgeNote[],
  labProjects: LabProject[],
  labRecords: LabRecord[],
  options: RecordAgentContextOptions = {},
): RecordAgentContextToolResult => {
  const totalKnowledgeBranches = getRecordBranches({ parkType: 'knowledge' }).length;
  const totalLabBranches = getRecordBranches({ parkType: 'lab' }).length;
  const listedJournalEntries = sortByUpdatedAtDesc(entries).slice(0, MAX_JOURNAL_ENTRIES);
  const selectedJournalEntry =
    entries.find((entry) => entry.id === options.activeJournalEntryId) ?? null;
  const listedKnowledgeBases = sortByUpdatedAtDesc(knowledgeBases).slice(
    0,
    MAX_KNOWLEDGE_BASES,
  );
  const selectedKnowledgeNote =
    knowledgeNotes.find((note) => note.id === options.selectedKnowledgeNoteId) ?? null;
  const listedKnowledgeNotes = sortByUpdatedAtDesc(
    knowledgeNotes.filter((note) => note.id !== selectedKnowledgeNote?.id),
  ).slice(0, MAX_KNOWLEDGE_NOTES);
  const listedLabProjects = sortByUpdatedAtDesc(labProjects).slice(0, MAX_LAB_PROJECTS);
  const selectedLabRecord =
    labRecords.find((record) => record.id === options.selectedLabRecordId) ?? null;
  const listedLabRecords = sortByUpdatedAtDesc(
    labRecords.filter((record) => record.id !== selectedLabRecord?.id),
  ).slice(0, MAX_LAB_RECORDS);
  const activeKnowledgeScopeBranches = options.activeKnowledgeBaseId
    ? getScopedBranches('knowledge', options.activeKnowledgeBaseId)
    : [];
  const activeKnowledgeVisibleBranches = activeKnowledgeScopeBranches
    .filter((branch) => branch.archivedAt === null)
    .slice(0, MAX_BRANCHES_PER_SCOPE);
  const activeLabScopeBranches = options.activeLabProjectId
    ? getScopedBranches('lab', options.activeLabProjectId)
    : [];
  const activeLabVisibleBranches = activeLabScopeBranches
    .filter((branch) => branch.archivedAt === null)
    .slice(0, MAX_BRANCHES_PER_SCOPE);
  const knowledgeBaseNameMap = new Map(
    knowledgeBases.map((base) => [base.id, base.name]),
  );
  const labProjectNameMap = new Map(
    labProjects.map((project) => [project.id, project.name]),
  );
  const readKnowledgeBranchLabel = (baseId: string, branchId: string | null): string =>
    getBranchPathLabel(getScopedBranches('knowledge', baseId), branchId);
  const readLabBranchLabel = (projectId: string, branchId: string | null): string =>
    getBranchPathLabel(getScopedBranches('lab', projectId), branchId);
  const statusLabel = [
    `心记 ${entries.length} 条`,
    `笔记 ${knowledgeBases.length} 库 / ${knowledgeNotes.length} 条 / ${totalKnowledgeBranches} 分支`,
    `做记 ${labProjects.length} 项 / ${labRecords.length} 条 / ${totalLabBranches} 分支`,
  ].join(' · ');

  const toolMessage = [
    '[tool_result: record.write_context]',
    '权限: 用户已允许 Agent 在本次请求中读取三记目录，并通过受限工具新增或编辑心记、笔记、做记记录。',
    `心记总数: ${entries.length}`,
    `知识库总数: ${knowledgeBases.length}`,
    `知识笔记总数: ${knowledgeNotes.length}`,
    `知识分支总数: ${totalKnowledgeBranches}`,
    `做记项目总数: ${labProjects.length}`,
    `做记记录总数: ${labRecords.length}`,
    `做记分支总数: ${totalLabBranches}`,
    buildSelectedItemLabel(
      entries,
      options.activeJournalEntryId,
      '当前界面没有进入心记编辑态。',
      '当前界面选中的心记已不可用。',
      '当前界面选中的心记',
    ),
    buildSelectedItemLabel(
      knowledgeBases,
      options.activeKnowledgeBaseId,
      '当前界面没有选中知识库。',
      '当前界面选中的知识库已不可用。',
      '当前界面选中的知识库',
    ),
    `当前界面知识分支范围: ${describeBranchFilter(
      activeKnowledgeScopeBranches.filter((branch) => branch.archivedAt === null),
      options.activeKnowledgeBranchFilterId,
    )}`,
    selectedKnowledgeNote
      ? `当前界面选中的笔记: ${selectedKnowledgeNote.title} (${selectedKnowledgeNote.id})`
      : '当前界面没有选中知识笔记。',
    buildSelectedItemLabel(
      labProjects,
      options.activeLabProjectId,
      '当前界面没有选中做记项目。',
      '当前界面选中的做记项目已不可用。',
      '当前界面选中的做记项目',
    ),
    `当前界面做记分支范围: ${describeBranchFilter(
      activeLabScopeBranches.filter((branch) => branch.archivedAt === null),
      options.activeLabBranchFilterId,
    )}`,
    selectedLabRecord
      ? `当前界面选中的做记记录: ${selectedLabRecord.title} (${selectedLabRecord.id})`
      : '当前界面没有选中做记记录。',
    '',
    '写入规则:',
    '- 只允许使用 journal.entry.create / journal.entry.update / knowledge.note.create / knowledge.note.update / lab.record.create / lab.record.update。',
    '- 严禁尝试删除任何心记、知识笔记、做记记录、知识库或做记项目，也不要承诺已经删除。',
    '- 只有当用户明确要求“新增”或“编辑”时，才允许发起写入。',
    '- 如果目标知识库、目标做记项目、目标分支、目标记录或目标日志不明确，先向用户追问，不要猜。',
    '- 编辑时如果只改标题、标签、链接或做记类型，可以使用 contentMode: "keep" 并省略 content。',
    '- 每次需要写入时先输出 tool_call；等收到 tool_result 后，再用自然语言向用户确认。',
    '',
    'tool_call 格式:',
    '[tool_call: journal.entry.create]',
    '{"title":"可选标题","content":"正文"}',
    '[/tool_call]',
    '[tool_call: journal.entry.update]',
    '{"entryId":"心记id","title":"可选新标题","contentMode":"replace|append|prepend|keep","content":"正文"}',
    '[/tool_call]',
    '[tool_call: knowledge.note.create]',
    '{"baseId":"知识库id","branchId":"可选分支id或null","title":"可选标题","content":"正文","sourceUrl":"可选链接","tags":["标签1","标签2"]}',
    '[/tool_call]',
    '[tool_call: knowledge.note.update]',
    '{"noteId":"笔记id","branchId":"可选分支id或null","title":"可选新标题","contentMode":"replace|append|prepend|keep","content":"正文","sourceUrl":"可选新链接","clearSourceUrl":false,"tags":["标签1","标签2"]}',
    '[/tool_call]',
    '[tool_call: lab.record.create]',
    '{"projectId":"做记项目id","branchId":"可选分支id或null","title":"可选标题","content":"正文","type":"operation|review","tags":["标签1","标签2"]}',
    '[/tool_call]',
    '[tool_call: lab.record.update]',
    '{"recordId":"做记记录id","branchId":"可选分支id或null","title":"可选新标题","contentMode":"replace|append|prepend|keep","content":"正文","type":"operation|review","tags":["标签1","标签2"]}',
    '[/tool_call]',
    '',
    '## 心记区',
    selectedJournalEntry
      ? serializeSelectedJournalEntry(selectedJournalEntry)
      : '当前没有选中的心记全文。',
    listedJournalEntries.length > 0
      ? listedJournalEntries.map(serializeJournalEntryPreview).join('\n\n')
      : '当前没有可写入参考的心记目录。',
    '',
    '## 笔记区',
    listedKnowledgeBases.length > 0
      ? listedKnowledgeBases.map(serializeKnowledgeBase).join('\n\n')
      : '当前没有可用知识库。',
    '',
    activeKnowledgeVisibleBranches.length > 0
      ? activeKnowledgeVisibleBranches
          .map((branch, index) =>
            serializeBranch(branch, activeKnowledgeScopeBranches, index),
          )
          .join('\n\n')
      : options.activeKnowledgeBaseId
        ? '当前知识库还没有可用分支。'
        : '当前没有选中的知识库分支。',
    '',
    selectedKnowledgeNote
      ? serializeSelectedKnowledgeNote(
          selectedKnowledgeNote,
          knowledgeBaseNameMap.get(selectedKnowledgeNote.baseId) ?? '未知知识库',
          readKnowledgeBranchLabel(
            selectedKnowledgeNote.baseId,
            selectedKnowledgeNote.branchId,
          ),
        )
      : '当前没有选中的知识笔记全文。',
    '',
    listedKnowledgeNotes.length > 0
      ? listedKnowledgeNotes
          .map((note, index) =>
            serializeKnowledgeNotePreview(
              note,
              knowledgeBaseNameMap.get(note.baseId) ?? '未知知识库',
              readKnowledgeBranchLabel(note.baseId, note.branchId),
              index,
            ),
          )
          .join('\n\n')
      : '当前没有额外可供参考的知识笔记目录。',
    '',
    '## 做记区',
    listedLabProjects.length > 0
      ? listedLabProjects.map(serializeLabProject).join('\n\n')
      : '当前没有可用做记项目。',
    '',
    activeLabVisibleBranches.length > 0
      ? activeLabVisibleBranches
          .map((branch, index) =>
            serializeBranch(branch, activeLabScopeBranches, index),
          )
          .join('\n\n')
      : options.activeLabProjectId
        ? '当前做记项目还没有可用分支。'
        : '当前没有选中的做记项目分支。',
    '',
    selectedLabRecord
      ? serializeSelectedLabRecord(
          selectedLabRecord,
          labProjectNameMap.get(selectedLabRecord.projectId) ?? '未知项目',
          readLabBranchLabel(
            selectedLabRecord.projectId,
            selectedLabRecord.branchId,
          ),
        )
      : '当前没有选中的做记记录全文。',
    '',
    listedLabRecords.length > 0
      ? listedLabRecords
          .map((record, index) =>
            serializeLabRecordPreview(
              record,
              labProjectNameMap.get(record.projectId) ?? '未知项目',
              readLabBranchLabel(record.projectId, record.branchId),
              index,
            ),
          )
          .join('\n\n')
      : '当前没有额外可供参考的做记记录目录。',
    '[/tool_result]',
  ].join('\n');

  return {
    totalJournalEntries: entries.length,
    totalKnowledgeBases: knowledgeBases.length,
    totalKnowledgeNotes: knowledgeNotes.length,
    totalLabProjects: labProjects.length,
    totalLabRecords: labRecords.length,
    statusLabel,
    toolMessage,
  };
};

export const runRecordToolCalls = (
  assistantContent: string,
): RecordAgentToolRunResult | null => {
  const toolCalls = parseRecordToolCalls(assistantContent);

  if (toolCalls.length === 0) {
    return null;
  }

  const toolResultMessages: string[] = [];
  let mutationKind: RecordAgentMutationKind | null = null;
  let mutatedJournalEntryId: string | null = null;
  let mutatedKnowledgeBaseId: string | null = null;
  let mutatedKnowledgeNoteId: string | null = null;
  let mutatedLabProjectId: string | null = null;
  let mutatedLabRecordId: string | null = null;

  for (const toolCall of toolCalls) {
    let result: ToolExecutionResult;

    if (toolCall.name === 'journal.entry.create') {
      const parsedArgs = parseJournalCreateArgs(toolCall.rawArgs);

      result = parsedArgs
        ? executeJournalCreateTool(parsedArgs)
        : emptyExecutionResult(
            buildToolResultMessage('journal.entry.create', 'error', [
              `rawToolCall: ${toolCall.rawBlock}`,
              'message: tool_call 参数不是合法 JSON，或缺少 content。',
            ]),
          );
    } else if (toolCall.name === 'journal.entry.update') {
      const parsedArgs = parseJournalUpdateArgs(toolCall.rawArgs);

      result = parsedArgs
        ? executeJournalUpdateTool(parsedArgs)
        : emptyExecutionResult(
            buildToolResultMessage('journal.entry.update', 'error', [
              `rawToolCall: ${toolCall.rawBlock}`,
              'message: tool_call 参数不是合法 JSON，或缺少 entryId。',
            ]),
          );
    } else if (toolCall.name === 'knowledge.note.create') {
      const parsedArgs = parseKnowledgeCreateArgs(toolCall.rawArgs);

      result = parsedArgs
        ? executeKnowledgeCreateTool(parsedArgs)
        : emptyExecutionResult(
            buildToolResultMessage('knowledge.note.create', 'error', [
              `rawToolCall: ${toolCall.rawBlock}`,
              'message: tool_call 参数不是合法 JSON，或缺少 baseId / content。',
            ]),
          );
    } else if (toolCall.name === 'knowledge.note.update') {
      const parsedArgs = parseKnowledgeUpdateArgs(toolCall.rawArgs);

      result = parsedArgs
        ? executeKnowledgeUpdateTool(parsedArgs)
        : emptyExecutionResult(
            buildToolResultMessage('knowledge.note.update', 'error', [
              `rawToolCall: ${toolCall.rawBlock}`,
              'message: tool_call 参数不是合法 JSON，或缺少 noteId。',
            ]),
          );
    } else if (toolCall.name === 'lab.record.create') {
      const parsedArgs = parseLabCreateArgs(toolCall.rawArgs);

      result = parsedArgs
        ? executeLabCreateTool(parsedArgs)
        : emptyExecutionResult(
            buildToolResultMessage('lab.record.create', 'error', [
              `rawToolCall: ${toolCall.rawBlock}`,
              'message: tool_call 参数不是合法 JSON，或缺少 projectId / content / type。',
            ]),
          );
    } else {
      const parsedArgs = parseLabUpdateArgs(toolCall.rawArgs);

      result = parsedArgs
        ? executeLabUpdateTool(parsedArgs)
        : emptyExecutionResult(
            buildToolResultMessage('lab.record.update', 'error', [
              `rawToolCall: ${toolCall.rawBlock}`,
              'message: tool_call 参数不是合法 JSON，或缺少 recordId。',
            ]),
          );
    }

    toolResultMessages.push(result.resultMessage);

    if (result.mutationKind) {
      mutationKind = result.mutationKind;
    }

    if (result.mutatedJournalEntryId) {
      mutatedJournalEntryId = result.mutatedJournalEntryId;
    }

    if (result.mutatedKnowledgeBaseId) {
      mutatedKnowledgeBaseId = result.mutatedKnowledgeBaseId;
    }

    if (result.mutatedKnowledgeNoteId) {
      mutatedKnowledgeNoteId = result.mutatedKnowledgeNoteId;
    }

    if (result.mutatedLabProjectId) {
      mutatedLabProjectId = result.mutatedLabProjectId;
    }

    if (result.mutatedLabRecordId) {
      mutatedLabRecordId = result.mutatedLabRecordId;
    }
  }

  return {
    toolResultMessage: toolResultMessages.join('\n\n'),
    mutationKind,
    mutatedJournalEntryId,
    mutatedKnowledgeBaseId,
    mutatedKnowledgeNoteId,
    mutatedLabProjectId,
    mutatedLabRecordId,
    toolCallCount: toolCalls.length,
  };
};
