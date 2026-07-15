import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@stellar/stellar-sdk") || id.includes("@stellar/stellar-base")) {
            return "stellar-sdk";
          }
          if (id.includes("@stellar/freighter-api")) {
            return "freighter";
          }
          if (
            id.includes("\\node_modules\\react\\") ||
            id.includes("/node_modules/react/") ||
            id.includes("\\node_modules\\react-dom\\") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("\\node_modules\\scheduler\\") ||
            id.includes("/node_modules/scheduler/")
          ) {
            return "react-vendor";
          }
          return "vendor";
        }
      }
    },
    chunkSizeWarningLimit: 1500
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts"
  }
});
