const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("splash", {
  onLog: (cb) => {
    ipcRenderer.on("splash-log", (_event, line) => cb(String(line ?? "")));
  },
});
