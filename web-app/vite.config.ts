import { defineConfig } from "vite";

// Builds into the Jekyll source tree; the /web/ pages load /assets/web/app.js and app.css.
export default defineConfig({
  build: {
    outDir: "../assets/web",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: "src/main.ts",
      output: {
        entryFileNames: "app.js",
        chunkFileNames: "[name].js",
        assetFileNames: "app[extname]",
      },
    },
  },
});
