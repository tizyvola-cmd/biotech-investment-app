const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("supernova", {
  getApiUrl: () => ipcRenderer.invoke("get-api-url"),
  getApiToken: () => ipcRenderer.invoke("get-api-token"),
});
