import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../.env');

const parseEnv = (content) =>
  Object.fromEntries(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separatorIndex = line.indexOf('=');
        const key = line.slice(0, separatorIndex).trim();
        const rawValue = line.slice(separatorIndex + 1).trim();
        const value = rawValue.replace(/^['"]|['"]$/g, '');

        return [key, value];
      }),
  );

const normalizeChatEndpoint = (apiUrl) => {
  const normalizedUrl = apiUrl.trim().replace(/\/+$/, '');

  if (!normalizedUrl) {
    return '';
  }

  if (
    normalizedUrl.endsWith('/chat/completions') ||
    normalizedUrl.endsWith('/responses')
  ) {
    return normalizedUrl;
  }

  try {
    const parsedUrl = new URL(normalizedUrl);

    if (parsedUrl.pathname === '/') {
      return `${parsedUrl.origin}/v1/chat/completions`;
    }
  } catch {
    return normalizedUrl;
  }

  if (normalizedUrl.endsWith('/v1')) {
    return `${normalizedUrl}/chat/completions`;
  }

  return normalizedUrl;
};

const normalizeEmbeddingEndpoint = (apiUrl) => {
  const normalizedUrl = apiUrl.trim().replace(/\/+$/, '');

  if (!normalizedUrl) {
    return '';
  }

  if (normalizedUrl.endsWith('/embeddings')) {
    return normalizedUrl;
  }

  if (normalizedUrl.endsWith('/chat/completions')) {
    return normalizedUrl.replace(/\/chat\/completions$/, '/embeddings');
  }

  if (normalizedUrl.endsWith('/responses')) {
    return normalizedUrl.replace(/\/responses$/, '/embeddings');
  }

  try {
    const parsedUrl = new URL(normalizedUrl);

    if (parsedUrl.pathname === '/') {
      return `${parsedUrl.origin}/v1/embeddings`;
    }
  } catch {
    return normalizedUrl;
  }

  if (normalizedUrl.endsWith('/v1')) {
    return `${normalizedUrl}/embeddings`;
  }

  return normalizedUrl;
};

const readAssistantContent = (data) => {
  if (!data || typeof data !== 'object') {
    return null;
  }

  if (typeof data.content === 'string') {
    return data.content;
  }

  if (typeof data.output_text === 'string') {
    return data.output_text;
  }

  const firstChoice = Array.isArray(data.choices) ? data.choices[0] : null;

  if (
    firstChoice &&
    typeof firstChoice === 'object' &&
    firstChoice.message &&
    typeof firstChoice.message === 'object' &&
    typeof firstChoice.message.content === 'string'
  ) {
    return firstChoice.message.content;
  }

  return null;
};

const readEmbedding = (data) => {
  if (!data || typeof data !== 'object' || !Array.isArray(data.data)) {
    return null;
  }

  const firstItem = data.data[0];

  if (
    !firstItem ||
    typeof firstItem !== 'object' ||
    !Array.isArray(firstItem.embedding)
  ) {
    return null;
  }

  return firstItem.embedding.every((item) => typeof item === 'number')
    ? firstItem.embedding
    : null;
};

const redactUrl = (url) => {
  try {
    const parsedUrl = new URL(url);
    return `${parsedUrl.origin}${parsedUrl.pathname}`;
  } catch {
    return '[invalid-url]';
  }
};

let env;

try {
  env = parseEnv(readFileSync(rootEnvPath, 'utf8'));
} catch {
  console.error('Agent API test failed: root .env was not found.');
  process.exit(1);
}

const apiUrl = normalizeChatEndpoint(env.api_url ?? '');
const embeddingUrl = normalizeEmbeddingEndpoint(env.api_url ?? '');
const apiKey = env.api_key ?? '';
const model = env.model ?? '';
const embeddingModel = env.embedding_model ?? env.embeddingmodel ?? '';

if (!apiUrl || !embeddingUrl || !apiKey || !model || !embeddingModel) {
  console.error(
    'Agent API test failed: .env must contain api_url, api_key, model, and embedding_model.',
  );
  process.exit(1);
}

console.log(`Testing Agent API endpoint: ${redactUrl(apiUrl)}`);
console.log(`Testing Agent API model: ${model}`);
console.log(`Testing embedding endpoint: ${redactUrl(embeddingUrl)}`);
console.log(`Testing embedding model: ${embeddingModel}`);
console.log('API key loaded: yes, value hidden');

const embeddingResponse = await fetch(embeddingUrl, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: embeddingModel,
    input: '心记 embedding RAG 测试。',
  }),
});

const embeddingResponseText = await embeddingResponse.text();
let embeddingData = null;

try {
  embeddingData = JSON.parse(embeddingResponseText);
} catch {
  embeddingData = null;
}

if (!embeddingResponse.ok) {
  console.error(`Embedding API test failed with HTTP ${embeddingResponse.status}.`);
  console.error(embeddingResponseText.slice(0, 500));
  process.exit(1);
}

const embedding = readEmbedding(embeddingData);

if (!embedding) {
  console.error('Embedding API test failed: response did not contain an embedding.');
  console.error(embeddingResponseText.slice(0, 500));
  process.exit(1);
}

console.log(`Embedding API test passed. Vector dimensions: ${embedding.length}`);

const response = await fetch(apiUrl, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model,
    messages: [
      {
        role: 'system',
        content:
          '你是心记 Agent。你可以读取 App 注入的 journal.search 检索结果，但不能编造检索结果之外的日志。',
      },
      {
        role: 'system',
        content: [
          '[tool_result: journal.search]',
          '日志总数: 1',
          '索引片段数: 1',
          '本次返回结果数: 1',
          'embeddingModel: test-hidden',
          '### 检索结果 1',
          'entryId: test-entry',
          'title: API 测试日志',
          'score: 0.99',
          'matchReason: embedding 语义相似',
          'excerpt: 心记 embedding RAG API 测试成功。',
          '[/tool_result]',
        ].join('\n'),
      },
      {
        role: 'user',
        content: '请根据 journal.search 检索结果，用一句中文回复测试结果。',
      },
    ],
  }),
});

const responseText = await response.text();
let data = null;

try {
  data = JSON.parse(responseText);
} catch {
  data = null;
}

if (!response.ok) {
  console.error(`Agent API test failed with HTTP ${response.status}.`);

  if (data && typeof data === 'object' && data.error) {
    console.error(`Provider error: ${JSON.stringify(data.error)}`);
  } else {
    console.error(responseText.slice(0, 500));
  }

  process.exit(1);
}

const content = readAssistantContent(data);

if (!content) {
  console.error('Agent API test failed: response did not contain assistant text.');
  console.error(responseText.slice(0, 500));
  process.exit(1);
}

console.log('Agent API test passed.');
console.log(`Assistant preview: ${content.slice(0, 120)}`);
