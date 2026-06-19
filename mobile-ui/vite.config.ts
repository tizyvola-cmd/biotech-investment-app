import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const base = env.VITE_MOBILE_BASE?.trim() || "/";
  return {
    base: base.endsWith("/") ? base : `${base}/`,
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5174,
      strictPort: true,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8765",
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
