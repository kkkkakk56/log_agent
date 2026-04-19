/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly api_url?: string;
  readonly api_key?: string;
  readonly model?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
