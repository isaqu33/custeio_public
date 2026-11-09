/**
 * @jest-environment node
 */

import fs from 'fs';
import path from 'path';

const modelsDir = path.join(process.cwd(), 'app', 'models');

describe('model contracts', () => {
  // `!f.startsWith('.')` excludes AppleDouble sidecar files (`._foo.ts`) that
  // exFAT/HFS+ external drives grow next to a real file on every write.
  const files = fs.readdirSync(modelsDir).filter((f) => f.endsWith('.ts') && !f.startsWith('.'));

  it('uses kebab-case model filenames', () => {
    for (const file of files) {
      expect(file).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*\.ts$/);
    }
  });

  it('sets explicit snake_case plural collection name on each schema', () => {
    for (const file of files) {
      const source = fs.readFileSync(path.join(modelsDir, file), 'utf8');
      expect(source).toMatch(/collection:\s*'[a-z0-9_]+s'/);
    }
  });

  it('declares at least one explicit index per model', () => {
    for (const file of files) {
      const source = fs.readFileSync(path.join(modelsDir, file), 'utf8');
      expect(source.includes('.index(')).toBe(true);
    }
  });
});
