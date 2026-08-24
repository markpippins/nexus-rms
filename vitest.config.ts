import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // LAC contract tests only. The repo also carries bun:test files
    // (src/app/utils/*.test.ts) that run under `bun test`, not vitest.
    include: ['src/lac.contract.test.ts'],
  },
});
