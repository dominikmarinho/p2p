import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    projects: [
      { test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      { test: { name: 'integration', include: ['tests/integration/**/*.test.ts', 'src/tests/**/*.test.ts'], testTimeout: 15000, hookTimeout: 30000 } },
    ],
  },
});
