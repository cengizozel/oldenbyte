import { defineConfig } from "vitest/config";
import path from "path";

// Unit tests for pure logic (tests/*.test.ts). The "@/..." alias mirrors
// tsconfig paths. `npm test` pins TZ=UTC so date math is deterministic.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
