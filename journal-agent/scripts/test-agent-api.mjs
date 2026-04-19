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
const apiKey = env.api_key ?? '';
const model = env.model ?? '';

if (!apiUrl || !apiKey || !model) {
  console.error(
    'Agent API test failed: .env must contain api_url, api_key, and model.',
  );
  process.exit(1);
}

console.log(`Testing Agent API endpoint: ${redactUrl(apiUrl)}`);
console.log(`Testing Agent API model: ${model}`);
console.log('API key loaded: yes, value hidden');

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
          '你是心记 Agent。你可以读取 App 注入的 journal.read_context 工具结果，但不能编造工具结果之外的日志。',
      },
      {
        role: 'system',
        content: [
          '[tool_result: journal.read_context]',
          '日志总数: 1',
          '本次提供日志数: 1',
          '### 日志 1',
          'title: API 测试日志',
          'content: 心记 API 测试成功。',
          '[/tool_result]',
        ].join('\n'),
      },
      {
        role: 'user',
        content: '请根据日志工具内容，用一句中文回复测试结果。',
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
