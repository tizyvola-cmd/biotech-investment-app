const path = require("path");
const fs = require("fs");
const os = require("os");

/**
 * Avoid Chromium "Unable to move the cache: Access denied" on Windows when the
 * default Electron userData folder is locked (OneDrive, duplicate instance, etc.).
 * Must run at startup, before app.whenReady().
 */
function configureElectronCachePaths(app, { appName = "SuperNova" } = {}) {
  const localAppData =
    process.env.LOCALAPPDATA ||
    path.join(os.homedir(), "AppData", "Local");
  const userDataDir = path.join(localAppData, appName);

  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    app.setPath("userData", userDataDir);
  } catch (err) {
    console.warn(`[${appName}] userData non impostato:`, err.message);
  }

  const diskCache = path.join(userDataDir, "DiskCache");
  const gpuCache = path.join(userDataDir, "GPUCache");
  try {
    fs.mkdirSync(diskCache, { recursive: true });
    fs.mkdirSync(gpuCache, { recursive: true });
    app.commandLine.appendSwitch("disk-cache-dir", diskCache);
    app.commandLine.appendSwitch("gpu-disk-cache-dir", gpuCache);
  } catch (err) {
    console.warn(`[${appName}] cache dirs:`, err.message);
  }

  app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");

  return { userDataDir, diskCache, gpuCache };
}

function warnIfProjectOnOneDrive(projectRoot) {
  if (String(projectRoot).toLowerCase().includes("onedrive")) {
    console.warn(
      "[SuperNova] Progetto sotto OneDrive:",
      projectRoot,
      "— preferisci una copia locale (es. C:\\coding\\...); cache Chromium in %LOCALAPPDATA%\\SuperNova."
    );
  }
}

/**
 * Wrapper "zero-arg" usato da electron/main.cjs:
 *  - risolve `app` da electron (lazy require, così questo modulo resta
 *    importabile anche in test/script non-Electron)
 *  - applica i percorsi cache custom
 *  - segnala se il progetto è sotto OneDrive
 */
function configureElectronCache(opts = {}) {
  let app;
  try {
    ({ app } = require("electron"));
  } catch (err) {
    console.warn("[SuperNova] electron non disponibile:", err.message);
    return null;
  }
  if (!app || typeof app.setPath !== "function") {
    console.warn("[SuperNova] electron.app non disponibile — cache non configurata");
    return null;
  }

  const projectRoot = opts.projectRoot || path.resolve(__dirname, "..");
  warnIfProjectOnOneDrive(projectRoot);
  return configureElectronCachePaths(app, opts);
}

/**
 * Richiede il lock di singola istanza Electron. Quando l'utente lancia una
 * seconda istanza, viene invocato `onSecondInstance` (tipicamente per
 * riportare in primo piano la finestra principale esistente).
 *
 * Ritorna `true` se questa è l'istanza primaria, `false` se un'altra
 * istanza è già attiva (in tal caso il chiamante dovrebbe uscire).
 */
function acquireSingleInstanceLock(onSecondInstance) {
  let app;
  try {
    ({ app } = require("electron"));
  } catch (err) {
    console.warn("[SuperNova] electron non disponibile per single-instance lock:", err.message);
    return true;
  }
  if (!app || typeof app.requestSingleInstanceLock !== "function") return true;

  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) return false;

  if (typeof onSecondInstance === "function") {
    app.on("second-instance", () => {
      try {
        onSecondInstance();
      } catch (err) {
        console.warn("[SuperNova] second-instance handler:", err.message);
      }
    });
  }
  return true;
}

module.exports = {
  configureElectronCachePaths,
  configureElectronCache,
  warnIfProjectOnOneDrive,
  acquireSingleInstanceLock,
};
