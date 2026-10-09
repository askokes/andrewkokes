import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    // `npm run dev:ui` for frontend hot reload; API calls go to `wrangler dev`.
    proxy: { "/api": "http://localhost:8787" },
  },
});
