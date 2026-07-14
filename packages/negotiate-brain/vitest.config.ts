import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Map the workspace package name to its source root so nested
      // imports like @finality/negotiate/src/room.js resolve in tests.
      "@finality/negotiate": resolve(root, "../negotiate/src"),
    },
  },
  test: {
    include: ["src/tests/**/*.test.ts"],
    environment: "node",
  },
});
