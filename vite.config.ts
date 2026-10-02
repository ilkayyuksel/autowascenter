// Explicit Vite config of the self-hosted web app (TanStack Start, SSR on Node).
// Replaces the former @lovable.dev/vite-tanstack-config preset (phase 7C): only the plugins
// the app needs, no Lovable editor/sandbox hooks and no Cloudflare Workers target.
// See docs/SELF-HOSTED-ARCHITECTURE.md and docs/DEPRECATION-CLEANUP-MAP.md.
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ command }) => ({
  plugins: [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      // Server-only code can never end up in the browser bundle.
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
    }),
    // Production server: a standalone Node server in .output/ (node .output/server/index.mjs).
    ...(command === "build" ? [nitro({ preset: "node-server" })] : []),
    viteReact(),
  ],
  css: { transformer: "lightningcss" },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
  },
  // Dev server on :8080, the origin the API allows by default (CORS_ORIGIN).
  server: { host: "::", port: 8080 },
}));
