import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Built into the Python package so FastAPI can serve it; `npm run dev`
// proxies /api to the running backend.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "../../src/daily_dash/web/dist", emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8765" } },
});
