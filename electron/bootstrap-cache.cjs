/**
 * Must run before `require("electron")` so Chromium picks up custom cache paths.
 * Fixes "Unable to move the cache: Access denied" on Windows (OneDrive, duplicate instance).
 */
const path = require("path");
const fs = require("fs");
const os = require("os");

const APP_NAME = "SuperNova";
const localAppData =
  process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const userDataDir = path.join(localAppData, APP_NAME);
const diskCache = path.join(userDataDir, "DiskCache");
const gpuCache = path.join(userDataDir, "GPUCache");

for (const dir of [userDataDir, diskCache, gpuCache]) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
}

function pushSwitch(name, value) {
  const prefix = `--${name}=`;
  if (!process.argv.some((a) => a.startsWith(prefix))) {
    process.argv.push(`${prefix}${value}`);
  }
}

pushSwitch("user-data-dir", userDataDir);
pushSwitch("disk-cache-dir", diskCache);
pushSwitch("gpu-disk-cache-dir", gpuCache);
if (!process.argv.includes("--disable-gpu-shader-disk-cache")) {
  process.argv.push("--disable-gpu-shader-disk-cache");
}

module.exports = { userDataDir, diskCache, gpuCache, appName: APP_NAME };
