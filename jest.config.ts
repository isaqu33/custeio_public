import type { Config } from 'jest';
import nextJest from 'next/jest.js';

const createJestConfig = nextJest({ dir: './' });

const config: Config = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^uuid$': '<rootDir>/jest.uuid.ts',
  },
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.next/',
    '/build/',
    '/.claude/',
    '/e2e/',
    // Needs Docker: run with `npm run test:int`.
    '/__tests__/integration/',
    '/_archive/',
    // AppleDouble sidecar files (this repo lives on an exFAT/HFS+ external
    // drive, which grows a `._foo.spec.ts` next to `foo.spec.ts` on every
    // write) — junk, never a real test.
    '/\\._',
  ],
  modulePathIgnorePatterns: ['/.claude/worktrees/'],
  passWithNoTests: true,
};

export default createJestConfig(config);
