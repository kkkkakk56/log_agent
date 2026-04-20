import type { TodoMark } from '../types/todo';

export interface TextAnchor {
  sentenceText: string;
  sentenceApproxOffset: number;
}

export interface ResolvedAnchor {
  found: boolean;
  offset?: number;
  length?: number;
  score?: number;
}

const NEARBY_WINDOW = 200;
const MIN_SIMILARITY = 0.9;
const MAX_FUZZY_SOURCE_LENGTH = 160;

const createWhitespaceNormalizedIndex = (
  value: string,
): { text: string; indexMap: number[] } => {
  let normalizedText = '';
  const indexMap: number[] = [];
  let isInsideWhitespace = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (/\s/.test(character)) {
      if (!isInsideWhitespace) {
        normalizedText += ' ';
        indexMap.push(index);
        isInsideWhitespace = true;
      }

      continue;
    }

    normalizedText += character;
    indexMap.push(index);
    isInsideWhitespace = false;
  }

  return {
    text: normalizedText,
    indexMap,
  };
};

const createWhitespaceTolerantAnchor = (
  selectedText: string,
  currentContent: string,
): TextAnchor | null => {
  const normalizedSelection = selectedText.replace(/\s+/g, ' ').trim();

  if (!normalizedSelection) {
    return null;
  }

  const normalizedContent = createWhitespaceNormalizedIndex(currentContent);
  const normalizedIndex = normalizedContent.text.indexOf(normalizedSelection);

  if (normalizedIndex === -1) {
    return null;
  }

  const originalOffset = normalizedContent.indexMap[normalizedIndex] ?? 0;
  const normalizedEndIndex = normalizedIndex + normalizedSelection.length - 1;
  const originalEndOffset =
    normalizedContent.indexMap[normalizedEndIndex] ?? originalOffset;

  return {
    sentenceText: currentContent.slice(originalOffset, originalEndOffset + 1),
    sentenceApproxOffset: originalOffset,
  };
};

export const createAnchor = (
  selectedText: string,
  currentContent: string,
): TextAnchor | null => {
  const sentenceText = selectedText.trim();

  if (!sentenceText) {
    return null;
  }

  const exactIndex = currentContent.indexOf(sentenceText);

  if (exactIndex === -1) {
    return createWhitespaceTolerantAnchor(sentenceText, currentContent);
  }

  return {
    sentenceText,
    sentenceApproxOffset: exactIndex,
  };
};

const calculateLevenshteinDistance = (source: string, target: string): number => {
  if (source === target) {
    return 0;
  }

  if (source.length === 0) {
    return target.length;
  }

  if (target.length === 0) {
    return source.length;
  }

  const previousRow = Array.from({ length: target.length + 1 }, (_, index) => index);
  const currentRow = Array.from({ length: target.length + 1 }, () => 0);

  for (let sourceIndex = 1; sourceIndex <= source.length; sourceIndex += 1) {
    currentRow[0] = sourceIndex;

    for (let targetIndex = 1; targetIndex <= target.length; targetIndex += 1) {
      const substitutionCost =
        source[sourceIndex - 1] === target[targetIndex - 1] ? 0 : 1;

      currentRow[targetIndex] = Math.min(
        previousRow[targetIndex] + 1,
        currentRow[targetIndex - 1] + 1,
        previousRow[targetIndex - 1] + substitutionCost,
      );
    }

    for (let index = 0; index < previousRow.length; index += 1) {
      previousRow[index] = currentRow[index];
    }
  }

  return previousRow[target.length];
};

const calculateSimilarity = (source: string, target: string): number => {
  const longestLength = Math.max(source.length, target.length);

  if (longestLength === 0) {
    return 1;
  }

  return 1 - calculateLevenshteinDistance(source, target) / longestLength;
};

const resolveFuzzyAnchor = (
  sentenceText: string,
  currentContent: string,
): ResolvedAnchor => {
  if (
    sentenceText.length === 0 ||
    sentenceText.length > MAX_FUZZY_SOURCE_LENGTH ||
    currentContent.length < sentenceText.length
  ) {
    return { found: false };
  }

  let bestMatch: ResolvedAnchor = { found: false };
  const minLength = Math.max(1, Math.floor(sentenceText.length * 0.9));
  const maxLength = Math.ceil(sentenceText.length * 1.1);

  for (let offset = 0; offset <= currentContent.length - minLength; offset += 1) {
    for (
      let length = minLength;
      length <= maxLength && offset + length <= currentContent.length;
      length += 1
    ) {
      const candidate = currentContent.slice(offset, offset + length);
      const score = calculateSimilarity(sentenceText, candidate);

      if (score >= MIN_SIMILARITY && score > (bestMatch.score ?? 0)) {
        bestMatch = {
          found: true,
          offset,
          length,
          score,
        };
      }
    }
  }

  return bestMatch;
};

export const resolveAnchor = (
  todo: Pick<TodoMark, 'sentenceText' | 'sentenceApproxOffset'>,
  currentContent: string,
): ResolvedAnchor => {
  if (!todo.sentenceText) {
    return { found: false };
  }

  const approxOffset = todo.sentenceApproxOffset ?? 0;
  const approxStart = Math.max(0, approxOffset - NEARBY_WINDOW);
  const approxEnd = Math.min(
    currentContent.length,
    approxOffset + NEARBY_WINDOW + todo.sentenceText.length,
  );
  const nearbySlice = currentContent.slice(approxStart, approxEnd);
  const localIndex = nearbySlice.indexOf(todo.sentenceText);

  if (localIndex >= 0) {
    return {
      found: true,
      offset: approxStart + localIndex,
      length: todo.sentenceText.length,
      score: 1,
    };
  }

  const globalIndex = currentContent.indexOf(todo.sentenceText);

  if (globalIndex >= 0) {
    return {
      found: true,
      offset: globalIndex,
      length: todo.sentenceText.length,
      score: 1,
    };
  }

  return resolveFuzzyAnchor(todo.sentenceText, currentContent);
};
