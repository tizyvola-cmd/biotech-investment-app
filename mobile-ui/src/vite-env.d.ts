/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_DEFAULT_REMOTE_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
