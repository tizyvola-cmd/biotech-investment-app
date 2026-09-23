import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = path.resolve(__dirname, "index.html");
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data");

/** Public `/project-data/` allowlist — keep in sync with `cdn_snapshots.is_public_project_data_path`. */
const PROJECT_DATA_PUBLIC_RE =
  /(?:^|.*\/)(?:.*_snapshot\.json|desktop_data_manifest\.json|cdn_manifest\.json|market_context(?:_snapshot)?\.json|eis_super_score_learning\.json|catalyst_sim_entries\.json|catalyst_interest_watchlist\.json)$/i;
const PROJECT_DATA_PRIVATE_RE =
  /(?:^|.*\/)(?:tester_|invest_sim_inputs\.json|invest_sim_history\.json|desktop_ui_prefs\.json|ai_secrets|.*secret|.*credential|manual_feed|.*\.env|.*\.pem|.*\.key$)/i;

function isPublicProjectDataPath(rel: string): boolean {
  const clean = rel.replace(/\\/g, "/").replace(/^\//, "");
  if (!clean || clean.split("/").includes("..") || !clean.toLowerCase().endsWith(".json")) {
    return false;
  }
  if (PROJECT_DATA_PRIVATE_RE.test(clean)) return false;
  return PROJECT_DATA_PUBLIC_RE.test(clean);
}

/** Serve allowlisted ``../data/*.json`` in dev (Windows-friendly absolute paths). */
function serveProjectData(): Plugin {
  return {
    name: "serve-project-data",
    configureServer(server) {
      server.middlewares.use("/project-data", (req, res, next) => {
        const rel = (req.url || "/").replace(/^\//, "").split("?")[0];
        if (!isPublicProjectDataPath(rel)) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        const filePath = path.join(DATA_DIR, rel);
        if (!filePath.startsWith(DATA_DIR) || !fs.existsSync(filePath)) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}

/** Append browser debug NDJSON to `.cursor/debug-ae3756.log` in dev (same-origin, no CORS). */
function debugIngestPlugin(): Plugin {
  const logPath = path.join(PROJECT_ROOT, ".cursor", "debug-ae3756.log");
  return {
    name: "debug-ingest",
    configureServer(server) {
      server.middlewares.use("/debug-ingest", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          try {
            fs.mkdirSync(path.dirname(logPath), { recursive: true });
            const line = body.trim();
            if (line) fs.appendFileSync(logPath, `${line}\n`);
          } catch {
            /* ignore */
          }
          res.statusCode = 204;
          res.end();
        });
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
    plugins: [react(), serveProjectData(), debugIngestPlugin()],
    resolve: {
      alias: { "@": path.resolve(__dirname, "src") },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: INDEX_HTML,
        output: forElectron
          ? {
              // Electron carica file:// — un solo bundle evita chunk hash stale
              // (es. investSim-XXXX.js mancante dopo ricompilazione parziale).
              inlineDynamicImports: true,
            }
          : {
              manualChunks(id) {
                if (
                  id.includes("node_modules/recharts") ||
                  id.includes("node_modules/recharts-scale") ||
                  id.includes("node_modules/victory-vendor")
                ) {
                  return "recharts";
                }
                if (
                  id.includes("node_modules/chart.js") ||
                  id.includes("node_modules/react-chartjs-2")
                ) {
                  return "chart.js";
                }
              },
            },
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
