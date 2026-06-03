import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/main",
      lib: { entry: resolve(__dirname, "electron/main.ts") }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
      lib: { entry: resolve(__dirname, "electron/preload.ts") }
    }
  },
  renderer: {
    root: ".",
    plugins: [react({ jsxImportSource: "@emotion/react" })],
    build: {
      outDir: "out/renderer",
      rollupOptions: { input: resolve(__dirname, "index.html") }
    }
  }
});
