require("./bootstrap-cache.cjs");
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const {
  configureElectronCachePaths,
  warnIfProjectOnOneDrive,
} = require("./electron-cache.cjs");

function acquireSingleInstanceLock(onSecondInstance) {
  const got = app.requestSingleInstanceLock();
  if (got) app.on("second-instance", onSecondInstance);
  return got;
}

const ROOT = path.resolve(__dirname, "..");

// Configura userData e cache Chromium prima di whenReady
configureElectronCachePaths(app, { appName: "SuperNova" });
warnIfProjectOnOneDrive(ROOT);
const PYTHON = path.join(ROOT, ".venv", "Scripts", "python.exe");
const API_PORT = 8765;
const API_URL = `http://127.0.0.1:${API_PORT}`;

function readApiToken() {
  const fromEnv = (process.env.SUPERNOVA_API_TOKEN || "").trim();
  if (fromEnv) return fromEnv;
  const tokenFile = path.join(ROOT, ".supernova_api_token");
  try {
    if (fs.existsSync(tokenFile)) {
      return fs.readFileSync(tokenFile, "utf8").trim();
    }
  } catch {
    /* ignore */
  }
  return "";
}

const API_TOKEN = readApiToken();

let apiProcess = null;
let mainWindow = null;

if (
  !acquireSingleInstanceLock(() => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  })
) {
  process.exit(0);
}

function waitForApi(maxMs = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`${API_URL}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on("error", retry);
      req.setTimeout(2000, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - start > maxMs) {
        reject(new Error("API Python non risponde"));
        return;
      }
      setTimeout(tick, 400);
    };
    tick();
  });
}

function startApi() {
  if (apiProcess) return;
  const bindAll = /^(1|true|yes|on)$/i.test(process.env.SUPERNOVA_BIND_ALL || "");
  const host = bindAll ? "0.0.0.0" : "127.0.0.1";
  const apiEnv = { ...process.env, PYTHONUNBUFFERED: "1" };
  if (API_TOKEN) apiEnv.SUPERNOVA_API_TOKEN = API_TOKEN;
  apiProcess = spawn(
    PYTHON,
    ["-m", "uvicorn", "supernova_api:app", "--host", host, "--port", String(API_PORT)],
    { cwd: ROOT, windowsHide: true, env: apiEnv }
  );
  apiProcess.stdout?.on("data", (d) => console.log("[api]", d.toString()));
  apiProcess.stderr?.on("data", (d) => console.error("[api]", d.toString()));
  apiProcess.on("exit", (code) => {
    console.log("[api] exit", code);
    apiProcess = null;
  });
}

function stopApi() {
  if (apiProcess) {
    apiProcess.kill();
    apiProcess = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: "SuperNova",
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

ipcMain.handle("get-api-url", () => API_URL);
ipcMain.handle("get-api-token", () => API_TOKEN);

app.whenReady().then(async () => {
  startApi();
  try {
    await waitForApi();
    createWindow();
  } catch (err) {
    console.error(err);
    dialog.showErrorBox(
      "SuperNova — API non avviata",
      `${err.message}\n\nVerifica .venv e:\n  pip install -r requirements-electron.txt\n\nPoi: scripts\\Avvia_SuperNova_Electron.bat`
    );
    app.exit(1);
  }
});

app.on("window-all-closed", () => {
  stopApi();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => stopApi());
