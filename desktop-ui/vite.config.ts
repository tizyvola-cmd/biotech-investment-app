import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = path.resolve(__dirname, "index.html");
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data");

/** Serve ``../data/*.json`` in dev (Windows-friendly absolute paths). */
function serveProjectData(): Plugin {
  return {
    name: "serve-project-data",
    configureServer(server) {
      server.middlewares.use("/project-data", (req, res, next) => {
        const rel = (req.url || "/").replace(/^\//, "").split("?")[0];
        if (!rel || rel.includes("..")) {
          res.statusCode = 400;
          res.end("bad path");
          return;
        }
        const filePath = path.join(DATA_DIR, rel);
        if (!filePath.startsWith(DATA_DIR) || !fs.existsSync(filePath)) {
          next();
          return;
        }
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const forElectron = mode === "electron" || env.VITE_ELECTRON === "1";

  return {
    root: __dirname,
    base: forElectron ? "./" : "/",
    plugins: [react(), serveProjectData()],
    resolve: {
      alias: { "@": path.resolve(__dirname, "src") },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: INDEX_HTML,
      },
    },
    server: {
      // Windows: senza host esplicito Vite può legare solo [::1]; il browser su 127.0.0.1 fallisce.
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      fs: { allow: [PROJECT_ROOT] },
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8765",
          changeOrigin: true,
        },
      },
    },
  };
});
