/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPERNOVA_API_TOKEN?: string;
  readonly VITE_API_BASE?: string;
  readonly VITE_DEFAULT_REMOTE_HOST?: string;
  readonly VITE_ELECTRON?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface SupernovaDesktopShell {
  openWorkbook: () => Promise<void>;
  openPath: (filePath: string) => Promise<void>;
  openDataDir: () => Promise<void>;
  openExternal: (url: string) => Promise<void>;
}

interface SupernovaDesktopBridge {
  apiBase: string;
  projectDataBase: string;
  projectRoot?: string;
  dataDir?: string;
  getApiToken: () => Promise<string>;
  readProjectDataFile?: (
    relativePath: string
  ) => Promise<{ ok: boolean; data?: unknown; status?: number; error?: string }>;
  writeProjectDataFile?: (
    relativePath: string,
    data: unknown
  ) => Promise<{ ok: boolean; path?: string; error?: string }>;
  /**
   * Notifica inviata dal main-process quando model_accuracy_monitor_history.json
   * viene aggiornato (es. dal task settimanale domenica).
   * Restituisce una funzione per rimuovere il listener.
   */
  onAccuracyMonitorUpdated?: (callback: () => void) => () => void;
  shell?: SupernovaDesktopShell;
}

interface Window {
  supernova?: SupernovaDesktopBridge;
}
