import type { Config } from 'jest';
import nextJest from 'next/jest.js';

const createJestConfig = nextJest({ dir: './' });

// Integration suite: runs against a REAL MongoDB started by Testcontainers
// (needs a running Docker daemon). Kept apart from `npm test` so the default
// run stays fast and needs nothing but Node.
const config: Config = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'node',
  testMatch: ['<rootDir>/__tests__/integration/**/*.int.spec.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^uuid$': '<rootDir>/jest.uuid.ts',
  },
  testTimeout: 120_000,
  // One container per suite file; never share state between them.
  maxWorkers: 1,
};

export default createJestConfig(config);
