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

const readToolCallBlock = (content) => {
  const match = content.match(
    /\[tool_call:\s*(journal\.entry\.(?:create|update)|knowledge\.note\.(?:create|update)|lab\.record\.(?:create|update))\]\s*([\s\S]*?)\[\/tool_call\]/,
  );

  if (!match) {
    return null;
  }

  return {
    name: match[1],
    args: match[2].trim(),
  };
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

const requestChatCompletion = async ({ apiUrl, apiKey, model, messages, label }) => {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
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
    console.error(`${label} failed with HTTP ${response.status}.`);

    if (data && typeof data === 'object' && data.error) {
      console.error(`Provider error: ${JSON.stringify(data.error)}`);
    } else {
      console.error(responseText.slice(0, 500));
    }

    process.exit(1);
  }

  const content = readAssistantContent(data);

  if (!content) {
    console.error(`${label} failed: response did not contain assistant text.`);
    console.error(responseText.slice(0, 500));
    process.exit(1);
  }

  return content;
};

const parseToolArgs = (rawArgs, label) => {
  try {
    const parsedArgs = JSON.parse(rawArgs);

    if (!parsedArgs || typeof parsedArgs !== 'object' || Array.isArray(parsedArgs)) {
      throw new Error('tool args must be a JSON object');
    }

    return parsedArgs;
  } catch (error) {
    console.error(`${label} failed: tool_call args were not a JSON object.`);
    console.error(String(error));
    console.error(rawArgs.slice(0, 500));
    process.exit(1);
  }
};

const assertToolProtocol = async ({
  apiUrl,
  apiKey,
  model,
  label,
  expectedName,
  messages,
  validateArgs,
}) => {
  const content = await requestChatCompletion({
    apiUrl,
    apiKey,
    model,
    messages,
    label,
  });
  const toolCallBlock = readToolCallBlock(content);

  if (!toolCallBlock || toolCallBlock.name !== expectedName) {
    console.error(
      `${label} failed: model did not output ${expectedName} tool_call.`,
    );
    console.error(content.slice(0, 500));
    process.exit(1);
  }

  const args = parseToolArgs(toolCallBlock.args, label);
  validateArgs(args);

  console.log(`${label} passed.`);
  console.log(`Tool call preview: ${toolCallBlock.name}`);
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

const content = await requestChatCompletion({
  apiUrl,
  apiKey,
  model,
  label: 'Agent API test',
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
});

console.log('Agent API test passed.');
console.log(`Assistant preview: ${content.slice(0, 120)}`);

const recordContext = [
  '[tool_result: record.write_context]',
  '权限: 用户已允许 Agent 在本次请求中读取三记目录，并通过受限工具新增或编辑心记、笔记、做记记录。',
  '心记总数: 1',
  '知识库总数: 1',
  '知识笔记总数: 1',
  '做记项目总数: 1',
  '做记记录总数: 1',
  '当前界面选中的心记: API 测试日志 (journal-entry-test)',
  '当前界面选中的知识库: GitHub 学习库 (knowledge-base-test)',
  '当前界面选中的笔记: Pull Request 流程 (knowledge-note-test)',
  '当前界面选中的做记项目: Agent 工具项目 (lab-project-test)',
  '当前界面选中的做记记录: 工具协议联调 (lab-record-test)',
  '写入规则:',
  '- 只允许使用 journal.entry.create / journal.entry.update / knowledge.note.create / knowledge.note.update / lab.record.create / lab.record.update。',
  '- 严禁尝试删除任何心记、知识笔记、做记记录、知识库或做记项目，也不要承诺已经删除。',
  'tool_call 格式:',
  '[tool_call: journal.entry.create]',
  '{"title":"可选标题","content":"正文"}',
  '[/tool_call]',
  '[tool_call: knowledge.note.create]',
  '{"baseId":"知识库id","title":"可选标题","content":"正文","sourceUrl":"可选链接","tags":["标签1","标签2"]}',
  '[/tool_call]',
  '[tool_call: lab.record.create]',
  '{"projectId":"做记项目id","title":"可选标题","content":"正文","type":"operation|review","tags":["标签1","标签2"]}',
  '[/tool_call]',
  '## 心记区',
  '### 当前选中的心记',
  'id: journal-entry-test',
  'title: API 测试日志',
  'content: 心记工具协议测试内容。',
  '## 笔记区',
  '### 知识库 1',
  'id: knowledge-base-test',
  'name: GitHub 学习库',
  'description: 记录 GitHub 相关知识。',
  '### 当前选中的笔记',
  'id: knowledge-note-test',
  'baseId: knowledge-base-test',
  'baseName: GitHub 学习库',
  'title: Pull Request 流程',
  'content: 提交分支，创建 PR，等待 review。',
  '## 做记区',
  '### 做记项目 1',
  'id: lab-project-test',
  'name: Agent 工具项目',
  'description: 记录 Agent 工具联调。',
  '### 当前选中的做记记录',
  'id: lab-record-test',
  'projectId: lab-project-test',
  'projectName: Agent 工具项目',
  'title: 工具协议联调',
  'type: 操作',
  'content: 先验证只新增和编辑，不删除。',
  '[/tool_result]',
].join('\n');

const toolSystemPrompt = [
  '你是心记 Agent。',
  '你可以读取 record.write_context，并且只允许通过受限工具协议新增或编辑心记、笔记、做记。',
  '不要删除任何内容，不要输出删除相关工具。',
  '当用户明确要求新增时，只输出对应 tool_call block，不要输出任何解释。',
].join('\n');

await assertToolProtocol({
  apiUrl,
  apiKey,
  model,
  label: 'Agent journal tool protocol test',
  expectedName: 'journal.entry.create',
  messages: [
    {
      role: 'system',
      content: toolSystemPrompt,
    },
    {
      role: 'system',
      content: recordContext,
    },
    {
      role: 'user',
      content: '请新增一条心记，标题是「测试心记」，正文是「记录今天完成了三记工具联调」。',
    },
  ],
  validateArgs: (args) => {
    if (typeof args.content !== 'string' || !args.content.includes('三记工具联调')) {
      console.error('Agent journal tool protocol test failed: content missing.');
      process.exit(1);
    }
  },
});

await assertToolProtocol({
  apiUrl,
  apiKey,
  model,
  label: 'Agent knowledge tool protocol test',
  expectedName: 'knowledge.note.create',
  messages: [
    {
      role: 'system',
      content: toolSystemPrompt,
    },
    {
      role: 'system',
      content: recordContext,
    },
    {
      role: 'user',
      content:
        '请在 GitHub 学习库里新增一条笔记，标题是「Issue 模板」，正文是「记录 issue 模板和提问格式」。',
    },
  ],
  validateArgs: (args) => {
    if (args.baseId !== 'knowledge-base-test') {
      console.error('Agent knowledge tool protocol test failed: baseId mismatch.');
      process.exit(1);
    }
  },
});

await assertToolProtocol({
  apiUrl,
  apiKey,
  model,
  label: 'Agent lab tool protocol test',
  expectedName: 'lab.record.create',
  messages: [
    {
      role: 'system',
      content: toolSystemPrompt,
    },
    {
      role: 'system',
      content: recordContext,
    },
    {
      role: 'user',
      content:
        '请在 Agent 工具项目里新增一条操作类型做记，标题是「验证三记写入」，正文是「确认 Agent 可以新增做记操作记录」。',
    },
  ],
  validateArgs: (args) => {
    if (args.projectId !== 'lab-project-test' || args.type !== 'operation') {
      console.error('Agent lab tool protocol test failed: projectId or type mismatch.');
      process.exit(1);
    }
  },
});
