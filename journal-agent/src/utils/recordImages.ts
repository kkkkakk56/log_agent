import type { RecordImageAttachment } from '../types/media';

const MAX_IMAGE_EDGE = 1440;
const MAX_IMAGE_BYTES = 360_000;
const MIN_IMAGE_EDGE = 720;
const QUALITY_STEPS = [0.86, 0.78, 0.7, 0.62];
const SCALE_STEP = 0.86;
const DATA_URL_PREFIX_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,/i;

export const MAX_RECORD_IMAGES = 4;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const createImageId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `record-image-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const getApproximateDataUrlBytes = (dataUrl: string): number => {
  const base64 = dataUrl.split(',', 2)[1] ?? '';
  const padding =
    base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;

  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
};

const clampDimension = (width: number, height: number): { width: number; height: number } => {
  const longestEdge = Math.max(width, height);

  if (longestEdge <= MAX_IMAGE_EDGE) {
    return {
      width,
      height,
    };
  }

  const scale = MAX_IMAGE_EDGE / longestEdge;

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

const loadFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('image-read-failed'));
    };

    reader.onerror = () => reject(new Error('image-read-failed'));
    reader.readAsDataURL(file);
  });

const loadImageElement = (source: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image-decode-failed'));
    image.src = source;
  });

const renderCompressedImage = (
  image: HTMLImageElement,
  initialWidth: number,
  initialHeight: number,
): { dataUrl: string; width: number; height: number; byteSize: number } | null => {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) {
    return null;
  }

  let width = initialWidth;
  let height = initialHeight;
  let bestDataUrl = '';
  let bestByteSize = Number.POSITIVE_INFINITY;
  let bestWidth = width;
  let bestHeight = height;

  while (true) {
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    for (const quality of QUALITY_STEPS) {
      const candidateDataUrl = canvas.toDataURL('image/jpeg', quality);
      const candidateByteSize = getApproximateDataUrlBytes(candidateDataUrl);

      if (candidateByteSize < bestByteSize) {
        bestDataUrl = candidateDataUrl;
        bestByteSize = candidateByteSize;
        bestWidth = width;
        bestHeight = height;
      }

      if (candidateByteSize <= MAX_IMAGE_BYTES) {
        return {
          dataUrl: candidateDataUrl,
          width,
          height,
          byteSize: candidateByteSize,
        };
      }
    }

    const nextWidth = Math.round(width * SCALE_STEP);
    const nextHeight = Math.round(height * SCALE_STEP);

    if (
      Math.max(nextWidth, nextHeight) < MIN_IMAGE_EDGE ||
      (nextWidth === width && nextHeight === height)
    ) {
      break;
    }

    width = Math.max(1, nextWidth);
    height = Math.max(1, nextHeight);
  }

  return bestDataUrl
    ? {
        dataUrl: bestDataUrl,
        width: bestWidth,
        height: bestHeight,
        byteSize: bestByteSize,
      }
    : null;
};

const importSingleImage = async (file: File): Promise<RecordImageAttachment> => {
  const sourceDataUrl = await loadFileAsDataUrl(file);
  const image = await loadImageElement(sourceDataUrl);
  const dimensions = clampDimension(
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
  );
  const renderedImage = renderCompressedImage(image, dimensions.width, dimensions.height);

  if (!renderedImage) {
    throw new Error('image-render-failed');
  }

  return {
    id: createImageId(),
    name: file.name || '导入图片',
    dataUrl: renderedImage.dataUrl,
    mimeType: 'image/jpeg',
    width: renderedImage.width,
    height: renderedImage.height,
    byteSize: renderedImage.byteSize,
    createdAt: new Date().toISOString(),
  };
};

export const normalizeRecordImages = (value: unknown): RecordImageAttachment[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      typeof item.name !== 'string' ||
      typeof item.dataUrl !== 'string' ||
      typeof item.mimeType !== 'string' ||
      typeof item.width !== 'number' ||
      typeof item.height !== 'number' ||
      typeof item.createdAt !== 'string'
    ) {
      return [];
    }

    if (!DATA_URL_PREFIX_PATTERN.test(item.dataUrl)) {
      return [];
    }

    const byteSize =
      typeof item.byteSize === 'number' && Number.isFinite(item.byteSize)
        ? item.byteSize
        : getApproximateDataUrlBytes(item.dataUrl);

    return [
      {
        id: item.id,
        name: item.name,
        dataUrl: item.dataUrl,
        mimeType: item.mimeType,
        width: Math.max(1, Math.round(item.width)),
        height: Math.max(1, Math.round(item.height)),
        byteSize,
        createdAt: item.createdAt,
      },
    ];
  });
};

export const importRecordImages = async (
  files: File[],
): Promise<{ images: RecordImageAttachment[]; warnings: string[] }> => {
  const warnings: string[] = [];
  const images: RecordImageAttachment[] = [];

  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      warnings.push(`已跳过 ${file.name || '一个文件'}，因为它不是图片。`);
      continue;
    }

    try {
      images.push(await importSingleImage(file));
    } catch {
      warnings.push(`导入 ${file.name || '一张图片'} 失败，请换一张再试。`);
    }
  }

  return {
    images,
    warnings,
  };
};
