const CACHE_PATHS = require("./bootstrap-cache.cjs");
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  net,
  shell,
} = require("electron");
const {
  configureElectronCachePaths,
  warnIfProjectOnOneDrive,
  acquireSingleInstanceLock,
} = require("./electron-cache.cjs");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const http = require("http");
const { pathToFileURL } = require("url");

configureElectronCachePaths(app, { appName: "SuperNova" });
console.log("[electron] userData:", CACHE_PATHS.userDataDir);

// Sharper rendering on Windows HiDPI / fractional scaling displays.
app.commandLine.appendSwitch("high-dpi-support", "1");

const ROOT = path.resolve(__dirname, "..");
warnIfProjectOnOneDrive(ROOT);

function resolveAppIconPath() {
  const candidates = [
    path.join(ROOT, "assets", "SuperNova_Desktop.ico"),
    path.join(ROOT, "assets", "supernova_app_icon.ico"),
    path.join(__dirname, "app-icon.ico"),
    path.join(ROOT, "refresh_desktop", "BiotechRefresh.ico"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const APP_ICON = resolveAppIconPath();
const SPLASH_HTML = path.join(__dirname, "splash.html");
/** Minimo tempo splash disclaimer visibile (ms). */
const SPLASH_MIN_MS = 4000;
const DATA_DIR = path.join(ROOT, "data");
const DESKTOP_UI_DIST = path.join(ROOT, "desktop-ui", "dist", "index.html");
const API_PORT = Number(process.env.SUPERNOVA_PORT || 8765);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const DEV_UI_URL = "http://127.0.0.1:5173";
const IS_DEV_UI = /^(1|true|yes|on)$/i.test(process.env.ELECTRON_DEV || "");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "project-data",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

function resolvePython() {
  const venvPy = path.join(ROOT, ".venv", "Scripts", "python.exe");
  if (fs.existsSync(venvPy)) return venvPy;
  return process.platform === "win32" ? "python.exe" : "python3";
}

const PYTHON = resolvePython();

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
let apiStartedByUs = false;
let mainWindow = null;
let splashWindow = null;
let consoleHookedForSplash = false;
let splashVisibleAt = 0;

if (
  !acquireSingleInstanceLock(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      return;
    }
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.show();
      splashWindow.focus();
      return;
    }
    console.warn("[electron] second-instance: nessuna finestra — riavvio UI");
    createSplashWindow();
    hookConsoleForSplash();
    createWindow();
    scheduleRevealMainWindow();
  })
) {
  process.exit(0);
}

if (process.platform === "win32") {
  app.setAppUserModelId("com.supernova.biotech.desktop");
}

function splashLog(line) {
  const text = String(line ?? "").trim();
  if (!text || !splashWindow || splashWindow.isDestroyed()) return;
  splashWindow.webContents.send("splash-log", text);
}

function hookConsoleForSplash() {
  if (consoleHookedForSplash) return;
  consoleHookedForSplash = true;
  for (const level of ["log", "warn", "error"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      try {
        splashLog(
          args
            .map((a) => {
              if (typeof a === "string") return a;
              try {
                return JSON.stringify(a);
              } catch {
                return String(a);
              }
            })
            .join(" "),
        );
      } catch {
        /* ignore */
      }
    };
  }
}

function createSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) return;
  if (!fs.existsSync(SPLASH_HTML)) {
    console.warn("[splash] splash.html non trovato — skip");
    return;
  }
  splashWindow = new BrowserWindow({
    width: 560,
    height: 720,
    frame: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#0c1929",
    title: "SuperNova",
    ...(APP_ICON ? { icon: APP_ICON } : {}),
    webPreferences: {
      preload: path.join(__dirname, "splash-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  splashWindow.loadFile(SPLASH_HTML);
  splashWindow.once("ready-to-show", () => {
    splashVisibleAt = Date.now();
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.show();
  });
  splashWindow.on("closed", () => {
    splashWindow = null;
  });
}

function closeSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = null;
}

const PROJECT_DATA_HOSTS = new Set(["", "local", "localhost", "data"]);

function relativePathFromProjectDataUrl(requestUrl) {
  const u = new URL(requestUrl);
  let rel = decodeURIComponent(u.pathname || "").replace(/^\/+/, "");
  const host = (u.hostname || "").toLowerCase();
  // Chromium normalizza project-data:///file.json → project-data://file.json
  // (hostname = nome file, pathname vuoto) → altrimenti HTTP 400.
  if (host && !PROJECT_DATA_HOSTS.has(host)) {
    rel = rel ? `${host}/${rel}` : host;
  }
  return rel;
}

function isPathUnderDir(filePath, dir) {
  const f = path.resolve(filePath);
  const d = path.resolve(dir);
  if (process.platform === "win32") {
    const fl = f.toLowerCase();
    const dl = d.toLowerCase();
    return fl === dl || fl.startsWith(dl + path.sep);
  }
  return f === d || f.startsWith(d + path.sep);
}

function registerProjectDataProtocol() {
  const dataResolved = path.resolve(DATA_DIR);
  protocol.handle("project-data", async (request) => {
    const rel = relativePathFromProjectDataUrl(request.url);
    if (!rel || rel.includes("..")) {
      return new Response(`bad path: ${request.url}`, { status: 400 });
    }
    const filePath = path.resolve(dataResolved, rel);
    if (!isPathUnderDir(filePath, dataResolved)) {
      return new Response("bad path", { status: 400 });
    }
    if (!fs.existsSync(filePath)) {
      return new Response("not found", { status: 404 });
    }
    const fetched = await net.fetch(pathToFileURL(filePath).href);
    if (!rel.endsWith(".json")) return fetched;
    const headers = new Headers(fetched.headers);
    headers.set("Content-Type", "application/json; charset=utf-8");
    return new Response(fetched.body, {
      status: fetched.status,
      statusText: fetched.statusText,
      headers,
    });
  });
}

function listMissingDataFiles() {
  const required = [
    "past_catalyst_predictions.json",
    "simulation_sheet_snapshot.json",
    "accuracy_sheet_snapshot.json",
    "financial_sheet_snapshot.json",
  ];
  return required.filter((name) => !fs.existsSync(path.join(DATA_DIR, name)));
}

function postExportSnapshots() {
  return new Promise((resolve) => {
    const headers = {};
    if (API_TOKEN) headers["X-SuperNova-Token"] = API_TOKEN;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: API_PORT,
        path: "/api/desktop/export-snapshots",
        method: "POST",
        headers,
        timeout: 600_000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
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

function pingApi(maxMs = 2500) {
  return waitForApi(maxMs);
}

/** Windows: PIDs in ascolto su una porta (EN LISTENING / IT IN ASCOLTO). */
function getPidsListeningOnPort(port) {
  if (process.platform !== "win32") return [];
  try {
    const { execSync } = require("child_process");
    const out = execSync("netstat -ano", { encoding: "utf8", windowsHide: true });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes(`:${port}`)) continue;
      const m = line.match(/\s(?:LISTENING|IN ASCOLTO)\s+(\d+)\s*$/);
      if (m) pids.add(Number(m[1]));
    }
    return [...pids];
  } catch {
    return [];
  }
}

function killPids(pids) {
  if (!pids.length) return;
  const { execSync } = require("child_process");
  for (const pid of pids) {
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore", windowsHide: true });
      } else {
        process.kill(pid);
      }
      console.log("[api] killed stale listener pid=", pid);
    } catch {
      /* already gone */
    }
  }
}

function startApi() {
  if (apiProcess) return;
  apiStartedByUs = true;
  const apiEnv = {
    ...process.env,
    PYTHONUNBUFFERED: "1",
    SUPERNOVA_PORT: String(API_PORT),
  };
  if (API_TOKEN) apiEnv.SUPERNOVA_API_TOKEN = API_TOKEN;
  apiProcess = spawn(PYTHON, ["-m", "supernova_api"], {
    cwd: ROOT,
    windowsHide: true,
    env: apiEnv,
  });
  apiProcess.stdout?.on("data", (d) => console.log("[api]", d.toString()));
  apiProcess.stderr?.on("data", (d) => console.error("[api]", d.toString()));
  apiProcess.on("exit", (code) => {
    console.log("[api] exit", code);
    apiProcess = null;
  });
}

function stopApi() {
  if (apiProcess && apiStartedByUs) {
    apiProcess.kill();
    apiProcess = null;
    apiStartedByUs = false;
  }
}

/** API gia in ascolto su :8765 oppure avvio nuovo processo. */
async function ensureApi() {
  try {
    await pingApi(3000);
    console.log("[api] Gia attiva su", API_URL);
    return true;
  } catch {
    /* non risponde — libera porta zombie prima di riavviare */
    killPids(getPidsListeningOnPort(API_PORT));
    await new Promise((r) => setTimeout(r, 600));
    try {
      await pingApi(2500);
      console.log("[api] Attiva dopo cleanup porta", API_PORT);
      return true;
    } catch {
      /* serve nuovo processo */
    }
  }

  startApi();
  try {
    await waitForApi(60000);
    return true;
  } catch (firstErr) {
    console.warn("[api] Avvio figlio fallito o lento:", firstErr.message);
    try {
      await pingApi(4000);
      console.log("[api] Risposta da istanza gia presente sulla porta", API_PORT);
      return true;
    } catch {
      return false;
    }
  }
}

function revealMainWindow() {
  closeSplashWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
}

function scheduleRevealMainWindow() {
  const base = splashVisibleAt || Date.now();
  const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - base));
  setTimeout(revealMainWindow, wait);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1680,
    height: 1020,
    minWidth: 1200,
    minHeight: 760,
    show: false,
    backgroundColor: "#0f1419",
    title: "SuperNova",
    ...(APP_ICON ? { icon: APP_ICON } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload-modern.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    scheduleRevealMainWindow();
  });

  const wc = mainWindow.webContents;

  if (IS_DEV_UI) {
    wc.on("did-fail-load", (_event, code, desc) => {
      console.error("[ui] Dev load failed:", code, desc);
      dialog.showErrorBox(
        "SuperNova — UI dev non disponibile",
        `Impossibile caricare ${DEV_UI_URL}\n(${code}: ${desc})\n\n` +
          "Avvia Vite in un altro terminale:\n  cd desktop-ui\n  npm run dev\n\n" +
          "Oppure usa scripts\\Avvia_Biotech_Desktop.bat (build produzione)."
      );
    });
    mainWindow.loadURL(DEV_UI_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else if (!fs.existsSync(DESKTOP_UI_DIST)) {
    dialog.showErrorBox(
      "SuperNova — UI mancante",
      `File non trovato:\n${DESKTOP_UI_DIST}\n\nEsegui dalla root del progetto:\n  cd desktop-ui\n  npm run build:electron`
    );
    app.exit(1);
    return;
  } else {
    mainWindow.loadFile(DESKTOP_UI_DIST);
    wc.on("did-finish-load", () => {
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        void wc
          .executeJavaScript("Boolean(document.getElementById('root')?.innerHTML?.trim())")
          .then((hasContent) => {
            if (hasContent || !mainWindow || mainWindow.isDestroyed()) return;
            dialog.showMessageBox(mainWindow, {
              type: "error",
              title: "SuperNova — UI non caricata",
              message:
                "La finestra e' vuota: il bundle JavaScript non si e' avviato.\n\n" +
                "Ricompila la UI:\n  cd desktop-ui\n  npm run build:electron\n\n" +
                "Poi riapri con scripts\\Avvia_Biotech_Desktop.bat",
            });
          })
          .catch(() => { /* ignore */ });
      }, 5000);
    });
  }

  wc.on("render-process-gone", (_event, details) => {
    console.error("[ui] render-process-gone", details);
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox(
        "SuperNova — crash interfaccia",
        `Il processo grafico si e' chiuso (${details.reason || "unknown"}).\n` +
          "Riavvia l'app. Se succede sulla scheda AI clinico, apri DevTools (F12) e segnala l'errore in console."
      );
    }
  });

  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
  wc.on("will-navigate", (event, url) => {
    const current = wc.getURL();
    if (/^https?:\/\//i.test(url) && url !== current) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
}

ipcMain.handle("get-api-token", () => API_TOKEN);
ipcMain.on("get-project-root", (evt) => {
  evt.returnValue = ROOT;
});
ipcMain.on("get-data-dir", (evt) => {
  evt.returnValue = DATA_DIR;
});

/** Lettura JSON da data/ (bypass se fetch su project-data:// fallisce). */
ipcMain.handle("read-project-data-file", (_evt, relativePath) => {
  const rel = String(relativePath || "").replace(/^\/+/, "");
  if (!rel || rel.includes("..")) {
    throw new Error("Percorso non valido");
  }
  const filePath = path.resolve(DATA_DIR, rel);
  if (!isPathUnderDir(filePath, DATA_DIR)) {
    throw new Error("Percorso non valido");
  }
  if (!fs.existsSync(filePath)) {
    return { ok: false, status: 404, error: `File non trovato: ${filePath}` };
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return { ok: true, data: JSON.parse(raw) };
});

ipcMain.handle("write-project-data-file", (_evt, relativePath, data) => {
  const rel = String(relativePath || "").replace(/^\/+/, "");
  if (!rel || rel.includes("..")) {
    throw new Error("Percorso non valido");
  }
  const filePath = path.resolve(DATA_DIR, rel);
  if (!isPathUnderDir(filePath, DATA_DIR)) {
    throw new Error("Percorso non valido");
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
  return { ok: true, path: filePath };
});

function openPathInExcel(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`File non trovato: ${filePath}`);
  }
  if (process.platform === "win32") {
    const { spawn } = require("child_process");
    spawn("cmd", ["/c", "start", "", filePath], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    return;
  }
  return shell.openPath(filePath);
}

ipcMain.handle("desktop-open-workbook", () => {
  const wb = path.join(DATA_DIR, "biotech_orchestrated_output.xlsx");
  return openPathInExcel(wb);
});

ipcMain.handle("desktop-open-path", (_evt, filePath) => {
  return openPathInExcel(String(filePath || ""));
});

ipcMain.handle("desktop-open-data-dir", () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  return shell.openPath(DATA_DIR);
});

ipcMain.handle("desktop-open-external", (_evt, url) => {
  const u = String(url || "").trim();
  if (!/^https?:\/\//i.test(u)) {
    throw new Error("URL non valido");
  }
  return shell.openExternal(u);
});

app.whenReady().then(async () => {
  createSplashWindow();
  hookConsoleForSplash();
  splashLog("SuperNova — avvio…");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  registerProjectDataProtocol();
  splashLog("Connessione API Python…");
  const apiOk = await ensureApi();
  splashLog(apiOk ? "API pronta" : "API non disponibile — modalità offline");
  const missing = listMissingDataFiles();
  if (apiOk && missing.length > 0) {
    const wb = path.join(DATA_DIR, "biotech_orchestrated_output.xlsx");
    if (fs.existsSync(wb)) {
      splashLog("Export snapshot da workbook…");
      console.log("[data] Snapshot mancanti, export da workbook…", missing.join(", "));
      await postExportSnapshots();
    }
  }
  splashLog("Caricamento interfaccia…");
  createWindow();
  const missingAfter = listMissingDataFiles();
  if (mainWindow && missingAfter.length > 0) {
    const lines = missingAfter.map((f) => `  • data\\${f}`).join("\n");
    dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "Dati non trovati",
      message:
        "Alcuni file JSON non sono in:\n" +
        DATA_DIR +
        "\n\n" +
        lines +
        "\n\n" +
        "Se il progetto è su OneDrive, apri la cartella con i dati (es. C:\\coding\\Biotech_Investment app 6) " +
        "oppure esegui scripts\\Export_Desktop_Snapshots.bat dopo un refresh.",
    });
  }
  if (!apiOk && mainWindow) {
    dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "Refresh non disponibile",
      message:
        "L'app si apre con i dati in data/ (snapshot JSON).\n\n" +
        "L'API su porta " +
        API_PORT +
        " non risponde: per «Refresh giornaliero» chiudi altre istanze Python su quella porta " +
        "o riavvia il PC, poi riapri l'app.",
    });
  }
});

// ── Watcher: notifica renderer quando accuracy monitor JSON cambia ────────────
// Controlla ogni 5 min il mtime del file. Quando il task settimanale domenica
// (accuracy_monitor_snapshot.py) scrive un nuovo snapshot, il renderer riceve
// "accuracy-monitor-updated" e ricarica automaticamente la vista.
(function startAccuracyMonitorWatcher() {
  const monitorJson = path.join(DATA_DIR, "model_accuracy_monitor_history.json");
  let lastMtime = 0;
  try {
    if (fs.existsSync(monitorJson)) lastMtime = fs.statSync(monitorJson).mtimeMs;
  } catch { /* ignore */ }

  setInterval(() => {
    try {
      if (!fs.existsSync(monitorJson)) return;
      const mtime = fs.statSync(monitorJson).mtimeMs;
      if (mtime <= lastMtime) return;
      lastMtime = mtime;
      if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send("accuracy-monitor-updated");
        console.log("[watcher] model_accuracy_monitor_history.json aggiornato → notifica renderer");
      }
    } catch { /* ignore */ }
  }, 15_000); // ogni 15 s (run manuale + task settimanale)
})();

app.on("window-all-closed", () => {
  stopApi();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => stopApi());
