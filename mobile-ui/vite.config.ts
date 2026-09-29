import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const base = env.VITE_MOBILE_BASE?.trim() || "/";
  const proxyTarget =
    env.VITE_PROXY_TARGET?.trim() ||
    env.VITE_DEFAULT_REMOTE_HOST?.trim() ||
    "http://91.99.15.48:8765";
  return {
    base: base.endsWith("/") ? base : `${base}/`,
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5174,
      strictPort: true,
      proxy: {
        "/api": {
          target: proxyTarget.replace(/\/$/, ""),
          changeOrigin: true,
          timeout: 120_000,
          proxyTimeout: 120_000,
        },
      },
    },
    preview: {
      host: "0.0.0.0",
      port: 5174,
    },
  };
});
