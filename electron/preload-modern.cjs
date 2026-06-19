const { contextBridge, ipcRenderer } = require("electron");

const API_BASE = "http://127.0.0.1:8765";

contextBridge.exposeInMainWorld("supernova", {
  apiBase: API_BASE,
  projectDataBase: "project-data://local/",
  projectRoot: ipcRenderer.sendSync("get-project-root"),
  dataDir: ipcRenderer.sendSync("get-data-dir"),
  getApiToken: () => ipcRenderer.invoke("get-api-token"),
  readProjectDataFile: (relativePath) =>
    ipcRenderer.invoke("read-project-data-file", relativePath),
  writeProjectDataFile: (relativePath, data) =>
    ipcRenderer.invoke("write-project-data-file", relativePath, data),
  /**
   * Iscrive un callback all'evento "accuracy-monitor-updated" inviato dal main-process
   * quando model_accuracy_monitor_history.json viene modificato.
   * Restituisce una funzione di cleanup (removeListener).
   */
  onAccuracyMonitorUpdated: (callback) => {
    const wrapped = () => callback();
    ipcRenderer.on("accuracy-monitor-updated", wrapped);
    return () => ipcRenderer.removeListener("accuracy-monitor-updated", wrapped);
  },
  shell: {
    openWorkbook: () => ipcRenderer.invoke("desktop-open-workbook"),
    openPath: (filePath) => ipcRenderer.invoke("desktop-open-path", filePath),
    openDataDir: () => ipcRenderer.invoke("desktop-open-data-dir"),
    openExternal: (url) => ipcRenderer.invoke("desktop-open-external", url),
  },
});
