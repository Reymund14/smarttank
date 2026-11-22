import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// "@logic" points to the shared evaluation/rules file used by the Cloud Functions,
// so the dashboard and the backend always use the same Normal/Warning/Critical rules.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@logic": fileURLToPath(new URL("../functions/src/logic.js", import.meta.url)),
    },
  },
  server: { fs: { allow: [".."] } },
});
