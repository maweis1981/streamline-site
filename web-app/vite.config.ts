import { defineConfig } from "vite";

// Builds into the Jekyll source tree: /web/ loads app.js + app.css, /tools/m3u/ loads tool.js + tool.css.
export default defineConfig({
  build: {
    outDir: "../assets/web",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: { app: "src/main.ts", tool: "src/tool.ts" },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name][extname]",
      },
    },
  },
});
